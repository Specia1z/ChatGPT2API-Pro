/**
 * 抠抠图去背景 HTTP 微服务 — 供 Go 后端调用
 * 启动: node server.js [port]
 * 默认端口: 3001
 */

const http = require('http');
const { CaptchaProvider } = require('./captcha');
const { removeBackground } = require('./api');

const PORT = parseInt(process.argv[2]) || parseInt(process.env.REMOVEBG_PORT) || 3001;

let captchaProvider = null;

async function getCaptcha() {
  if (!captchaProvider) {
    captchaProvider = new CaptchaProvider();
    await captchaProvider.init();
    await captchaProvider.warmup({ mouseCount: 1000, durationSec: 30 });
    console.log('[removebg] WASM captcha ready');
  }
  return captchaProvider;
}

async function getFreshCode() {
  const cp = await getCaptcha();
  await cp.warmup({ mouseCount: 100, durationSec: 3 });
  return cp.getCode();
}

// 解析 multipart/form-data
function parseMultipart(contentType, buffer) {
  const boundary = '--' + contentType.split('boundary=')[1];
  const parts = [];
  let pos = buffer.indexOf(boundary);
  while (pos !== -1) {
    pos += boundary.length;
    const nextPos = buffer.indexOf(boundary, pos);
    if (nextPos === -1) break;
    const part = buffer.slice(pos, nextPos);
    // 跳过 \r\n
    let start = 2;
    if (part[0] === 0x0d && part[1] === 0x0a) start = 2;
    else if (part[0] === 0x0d) start = 1;
    else if (part[0] === 0x0a) start = 1;

    const headerEnd = part.indexOf('\r\n\r\n', start);
    if (headerEnd === -1) { pos = nextPos; continue; }
    const headerStr = part.slice(start, headerEnd).toString();
    const bodyStart = headerEnd + 4;
    let bodyEnd = part.length;
    if (part[bodyEnd - 2] === 0x0d && part[bodyEnd - 1] === 0x0a) bodyEnd -= 2;

    // 解析 name
    const nameMatch = headerStr.match(/name="([^"]+)"/);
    const filenameMatch = headerStr.match(/filename="([^"]+)"/);
    parts.push({
      name: nameMatch ? nameMatch[1] : '',
      filename: filenameMatch ? filenameMatch[1] : null,
      data: part.slice(bodyStart, bodyEnd),
    });
    pos = nextPos;
  }
  return parts;
}

// HTTP 服务
const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204); res.end(); return;
  }

  // 健康检查
  if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', captchaReady: !!captchaProvider }));
    return;
  }

  // POST /api/removebg — 抠图
  if (req.method === 'POST' && req.url === '/api/removebg') {
    try {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', async () => {
        try {
          const buffer = Buffer.concat(chunks);
          const contentType = req.headers['content-type'] || '';
          const parts = parseMultipart(contentType, buffer);
          const imagePart = parts.find(p => p.name === 'image');
          if (!imagePart) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '请上传图片 (字段名: image)' }));
            return;
          }

          console.log(`[removebg] 收到图片 ${imagePart.data.length} bytes`);
          const captchaCode = await getFreshCode();
          const resultBuffer = await removeBackground(imagePart.data, captchaCode);

          res.writeHead(200, {
            'Content-Type': 'image/webp',
            'Content-Disposition': 'attachment; filename="removed-bg.webp"',
            'Content-Length': resultBuffer.length,
          });
          res.end(resultBuffer);
        } catch (e) {
          console.error('[removebg] error:', e.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, '127.0.0.1', async () => {
  console.log(`[removebg] 服务启动: http://127.0.0.1:${PORT}`);
  // 预热 WASM
  try {
    await getCaptcha();
    console.log('[removebg] 初始化完成');
  } catch (e) {
    console.error('[removebg] WASM 初始化失败:', e.message);
    console.error('[removebg] 请确认 reCAPTCHA.wasm 文件存在');
  }
});
