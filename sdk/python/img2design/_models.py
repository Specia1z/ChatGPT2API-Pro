"""
img2design — IMG2 Design AI 生图平台官方 Python SDK

封装平台原生能力：异步生图(自动轮询取图)、AI 矢量(SVG)、令牌查询、图生图。
OpenAI 兼容端点请直接用 openai 库改 base_url，见 README。

快速开始：
    from img2design import Img2Design
    client = Img2Design(api_key="sk-xxx")
    images = client.generate("夕阳下的海边小屋，水彩风格")  # 自动等待出图
    images[0].save("out.png")
"""
from __future__ import annotations

import base64
import time
from dataclasses import dataclass, field
from typing import Any

import requests

__version__ = "1.0.0"
DEFAULT_BASE_URL = "https://img2.design"


class Img2DesignError(Exception):
    """SDK 统一异常。"""

    def __init__(self, message: str, *, status: int | None = None, code: int | None = None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code


class RateLimitError(Img2DesignError):
    """429：触发限流或令牌不足。retry_after 为建议等待秒数。"""

    def __init__(self, message: str, *, retry_after: int = 1, **kw):
        super().__init__(message, **kw)
        self.retry_after = retry_after


class AuthError(Img2DesignError):
    """401：API Key 无效/缺失/已禁用。"""


@dataclass
class GeneratedImage:
    """一张生成结果。data 为图片二进制(已就绪)，url 为可直接访问的地址(若有)。"""

    id: int
    status: str
    prompt: str = ""
    size: str = ""
    error: str = ""
    url: str = ""
    _b64: str = field(default="", repr=False)
    _client: "Img2Design | None" = field(default=None, repr=False)

    @property
    def data(self) -> bytes:
        """图片二进制。优先用内联 base64，否则经客户端代理拉取。"""
        if self._b64:
            return base64.b64decode(self._b64)
        if self._client is not None:
            return self._client.fetch_image(self.id)
        raise Img2DesignError("图片数据不可用")

    def save(self, path: str) -> None:
        """保存图片到本地文件。"""
        with open(path, "wb") as f:
            f.write(self.data)


@dataclass
class TokenStatus:
    tokens: float
    capacity: int
    refill: int
    plan: str
    concurrency: int
