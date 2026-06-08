# img2design — IMG2 Design Python SDK

IMG2 Design AI 生图平台官方 Python SDK。封装平台**原生能力**：异步生图(自动轮询取图)、AI 矢量(SVG)、图生图、令牌查询。

> OpenAI 兼容端点无需本 SDK，直接用 `openai` 库改 `base_url` 即可，见文末。

## 安装

```bash
pip install img2design
# 或本地开发：
pip install -e ./sdk/python
```

## 快速开始

```python
from img2design import Img2Design

client = Img2Design(api_key="sk-xxxxxxxx")

# 一站式生图：提交 + 自动轮询直到完成
images = client.generate("夕阳下的海边小屋，水彩风格", size="16:9")
images[0].save("out.png")
print(images[0].url)   # 若为外部存储，可直接访问的 URL
```

## 核心方法

### 1. 生图(推荐用 `generate`，自动轮询)

```python
# 自动等待出图（内部处理 提交→轮询→取图）
images = client.generate(
    prompt="赛博朋克城市夜景，霓虹灯",
    size="16:9",        # 1:1 / 4:3 / 16:9 / 9:16 / 2K / 4K / A4 / HD ...
    count=2,            # 张数 1-10（受套餐并发上限约束）
    poll_interval=3.0,  # 轮询间隔(秒)
    timeout=300.0,      # 最长等待(秒)
)
for i, img in enumerate(images):
    if img.status == "completed":
        img.save(f"img_{i}.png")
    else:
        print("失败:", img.error)
```

### 2. 异步生图(手动控制轮询)

```python
ids = client.submit("一只猫", size="1:1", count=1)   # 立即返回任务 ID，不等待
# ... 干别的 ...
results = client.results(ids)                        # 查询这些任务的状态
for img in results:
    print(img.id, img.status)
```

### 3. 图生图 / 参考图

```python
import base64
with open("ref.jpg", "rb") as f:
    ref_b64 = base64.b64encode(f.read()).decode()

images = client.generate(
    "把这张图变成水彩风格",
    ref_images_b64=[ref_b64],
    size="1:1",
)
```

### 4. AI 矢量(SVG)

```python
svg = client.vector("一个极简的山峰 logo，线条风格")
with open("logo.svg", "w", encoding="utf-8") as f:
    f.write(svg)
```

### 5. 查询令牌余额

```python
t = client.tokens()
print(f"套餐 {t.plan} · 剩余令牌 {t.tokens}/{t.capacity} · 每小时恢复 {t.refill} · 并发 {t.concurrency}")
```
<!-- PLACEHOLDER -->

## 错误处理

```python
from img2design import Img2Design, RateLimitError, AuthError, Img2DesignError
import time

client = Img2Design(api_key="sk-xxx")
try:
    images = client.generate("一只猫")
except AuthError:
    print("API Key 无效或已禁用")
except RateLimitError as e:
    print(f"限流/令牌不足，建议 {e.retry_after}s 后重试")
    time.sleep(e.retry_after)
except Img2DesignError as e:
    print(f"出错: {e.message} (HTTP {e.status})")
```

异常层级：
- `AuthError` — 401，API Key 无效
- `RateLimitError` — 429，限流或令牌不足，带 `retry_after`
- `Img2DesignError` — 其它错误(基类)，带 `status` / `code`

## 自托管 / 私有部署

```python
client = Img2Design(api_key="sk-xxx", base_url="https://你的域名")
```

---

## OpenAI 兼容接入(无需本 SDK)

平台的 `/v1/images/generations` **完全兼容 OpenAI Images API**，可直接用官方 `openai` 库，只改 `base_url`：

```python
from openai import OpenAI

client = OpenAI(api_key="sk-xxx", base_url="https://img2.design/v1")
resp = client.images.generate(
    prompt="夕阳下的海边小屋",
    n=1,
    size="1024x1024",          # 也支持 1792x1024 / 1024x1792
    response_format="b64_json", # 或 "url"
)
print(resp.data[0].b64_json[:50])
```

curl：
```bash
curl https://img2.design/v1/images/generations \
  -H "Authorization: Bearer sk-xxx" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"一只猫","n":1,"size":"1024x1024","response_format":"url"}'
```

**OpenAI 兼容端点是同步的**(等待出图完成才返回)；本 SDK 的 `generate()` 走原生异步端点(提交+轮询)，两者择一即可。同步适合简单脚本，异步适合批量/高并发。

## 端点对照

| 能力 | 本 SDK 方法 | 底层端点 |
|---|---|---|
| 异步生图(自动轮询) | `generate()` | `POST /api/v1/images/generations` + 轮询 |
| 异步提交/查询 | `submit()` / `results()` | 同上 |
| AI 矢量 SVG | `vector()` | `POST /api/v1/vector` |
| 令牌查询 | `tokens()` | `GET /api/v1/user/tokens` |
| 图片二进制 | `fetch_image()` | `GET /api/images/{id}` |
| OpenAI 兼容(同步) | 用 `openai` 库 | `POST /v1/images/generations` |

