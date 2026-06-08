"""Img2Design 客户端主体。"""
from __future__ import annotations

import time
from typing import Any

import requests

from ._models import (
    AuthError,
    GeneratedImage,
    Img2DesignError,
    RateLimitError,
    TokenStatus,
    DEFAULT_BASE_URL,
    __version__,
)


class Img2Design:
    """IMG2 Design 平台客户端。

    Args:
        api_key: 形如 sk-xxx 的 API Key。
        base_url: 平台地址，默认 https://img2.design。
        timeout: 单次 HTTP 请求超时(秒)。
    """

    def __init__(self, api_key: str, *, base_url: str = DEFAULT_BASE_URL, timeout: float = 30.0):
        if not api_key or not api_key.startswith("sk-"):
            raise AuthError("api_key 无效：需为 sk- 开头的 API Key")
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._session = requests.Session()
        self._session.headers.update({
            "Authorization": f"Bearer {api_key}",
            "User-Agent": f"img2design-python/{__version__}",
        })

    # ── 内部请求层 ──────────────────────────────
    def _request(self, method: str, path: str, *, json: dict | None = None,
                 params: dict | None = None, raw: bool = False) -> Any:
        url = self.base_url + path
        try:
            resp = self._session.request(method, url, json=json, params=params, timeout=self.timeout)
        except requests.RequestException as e:
            raise Img2DesignError(f"网络请求失败: {e}") from e

        if resp.status_code == 401:
            raise AuthError("API Key 无效或已禁用", status=401)
        if resp.status_code == 429:
            ra = int(resp.headers.get("Retry-After", "1") or "1")
            msg = _extract_msg(resp) or "请求过于频繁"
            raise RateLimitError(msg, status=429, retry_after=ra)
        if raw:
            if resp.status_code >= 400:
                raise Img2DesignError(_extract_msg(resp) or f"HTTP {resp.status_code}", status=resp.status_code)
            return resp.content

        try:
            body = resp.json()
        except ValueError:
            raise Img2DesignError(f"非 JSON 响应 (HTTP {resp.status_code})", status=resp.status_code)
        if resp.status_code >= 400 or (isinstance(body, dict) and body.get("code", 200) >= 400):
            msg = (body.get("message") if isinstance(body, dict) else None) or f"HTTP {resp.status_code}"
            raise Img2DesignError(msg, status=resp.status_code, code=body.get("code") if isinstance(body, dict) else None)
        return body.get("data") if isinstance(body, dict) else body

    # ── 令牌状态 ────────────────────────────────
    def tokens(self) -> TokenStatus:
        """查询当前令牌桶状态(不消耗令牌)。"""
        d = self._request("GET", "/api/v1/user/tokens")
        return TokenStatus(
            tokens=d.get("tokens", 0), capacity=d.get("capacity", 0),
            refill=d.get("refill", 0), plan=d.get("plan", ""), concurrency=d.get("concurrency", 1),
        )

    # ── 图片二进制代理 ──────────────────────────
    def fetch_image(self, image_id: int) -> bytes:
        """按图片 ID 拉取二进制(经平台代理)。"""
        return self._request("GET", f"/api/images/{image_id}", raw=True)

    # ── 原生异步生图 ────────────────────────────
    def submit(self, prompt: str, *, size: str = "1:1", count: int = 1,
               model: str = "", ref_images_b64: list[str] | None = None) -> list[int]:
        """提交生图任务(异步，立即返回任务 ID 列表，不等待出图)。

        Args:
            prompt: 提示词。
            size: 比例/尺寸，如 1:1 / 4:3 / 16:9 / 2K / A4 / HD。
            count: 张数 1-10(受套餐并发上限约束)。
            model: 可选模型 slug，默认平台配置。
            ref_images_b64: 参考图(裸 base64)列表，用于图生图/融合。
        Returns:
            任务 ID 列表，配合 results()/generate() 取图。
        """
        body: dict = {"prompt": prompt, "size": size, "count": count}
        if model:
            body["model"] = model
        if ref_images_b64:
            body["ref_images_b64"] = ref_images_b64
        d = self._request("POST", "/api/v1/images/generations", json=body)
        return d.get("ids", [])

    def results(self, ids: list[int] | None = None, *, page: int = 1, page_size: int = 50) -> list[GeneratedImage]:
        """查询生图记录。传 ids 时只返回这些 ID 的记录(按需过滤)。"""
        d = self._request("GET", "/api/v1/images/generations", params={"page": page, "page_size": page_size})
        items = d.get("items", [])
        want = set(ids) if ids else None
        out = []
        for it in items:
            if want is not None and it.get("id") not in want:
                continue
            out.append(self._to_image(it))
        return out

    def generate(self, prompt: str, *, size: str = "1:1", count: int = 1, model: str = "",
                 ref_images_b64: list[str] | None = None,
                 poll_interval: float = 3.0, timeout: float = 300.0) -> list[GeneratedImage]:
        """一站式生图：提交 + 自动轮询直到全部完成/失败，返回结果。

        这是最常用的方法。内部自动处理"提交→轮询→取图"的样板逻辑。
        Raises:
            Img2DesignError: 超时仍未完成。
        """
        ids = self.submit(prompt, size=size, count=count, model=model, ref_images_b64=ref_images_b64)
        if not ids:
            return []
        deadline = time.time() + timeout
        pending = set(ids)
        done: dict[int, GeneratedImage] = {}
        while pending and time.time() < deadline:
            time.sleep(poll_interval)
            for img in self.results(list(ids)):
                if img.id in pending and img.status in ("completed", "failed"):
                    done[img.id] = img
                    pending.discard(img.id)
        if pending:
            raise Img2DesignError(f"生图超时({timeout}s)，未完成 ID: {sorted(pending)}")
        return [done[i] for i in ids if i in done]

    # ── AI 矢量(SVG) ──────────────────────────
    def vector(self, prompt: str) -> str:
        """生成 SVG 矢量图(同步，返回完整 SVG 文本)。需平台已配置 svg_model。"""
        d = self._request("POST", "/api/v1/vector", json={"prompt": prompt})
        return d.get("svg", "")

    def _to_image(self, it: dict) -> GeneratedImage:
        return GeneratedImage(
            id=it.get("id", 0), status=it.get("status", ""), prompt=it.get("prompt", ""),
            size=it.get("size", ""), error=it.get("error_msg", ""), url=it.get("image_url", ""),
            _b64=it.get("image_b64", ""), _client=self,
        )


def _extract_msg(resp: "requests.Response") -> str:
    try:
        b = resp.json()
        if isinstance(b, dict):
            if isinstance(b.get("error"), dict):  # OpenAI 兼容错误
                return b["error"].get("message", "")
            return b.get("message", "")
    except Exception:
        pass
    return ""
