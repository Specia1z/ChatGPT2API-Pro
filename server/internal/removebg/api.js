/**
 * API 客户端 — 纯 Node.js fetch 实现
 * 封装所有抠抠图后端 API 调用
 */

const fs = require('fs');
const path = require('path');
const { Buffer } = require('buffer');

const BASE = 'https://www.koukoutu.com';

// ============ OSS 配置 ============
const OSS_CONFIG = {
  token: 'TOKEN_20f44506-f2e2-420d-9dde-a46845f95657',
  publicKey: 'ce053148-91fc-4fbf-a93d-7b9db6a7fe76',
  bucket: {
    name: 'rmbghb',
    host: '//upktimghb.koukoutu.com/',
  },
};

/**
 * 简单 HTTP 请求封装 (使用原生 https 模块，避免 Node.js fetch 的 FormData 兼容问题)
 */
const http = require('http');
const https = require('https');

function request(method, url, opts = {}) {
  return new Promise((resolve, reject) => {
    const { body, headers = {}, formData } = opts;
    const fullUrl = url.startsWith('http') ? url : `${BASE}${url}`;
    const urlObj = new URL(fullUrl);
    const isHttps = urlObj.protocol === 'https:';

    let reqBody = null;
    const reqHeaders = { ...headers };

    if (formData) {
      // 手动构建 multipart/form-data
      const boundary = '----Node' + Math.random().toString(36).substring(2);
      reqHeaders['Content-Type'] = 'multipart/form-data; boundary=' + boundary;
      const parts = [];
      for (const [name, value] of formData.entries()) {
        parts.push('--' + boundary + '\r\nContent-Disposition: form-data; name="' + name + '"\r\n\r\n' + value + '\r\n');
      }
      parts.push('--' + boundary + '--\r\n');
      reqBody = parts.join('');
      reqHeaders['Content-Length'] = Buffer.byteLength(reqBody);
    } else if (typeof body === 'string') {
      reqHeaders['Content-Type'] = reqHeaders['Content-Type'] || 'application/json';
      reqBody = body;
      reqHeaders['Content-Length'] = Buffer.byteLength(body);
    } else if (body) {
      reqBody = body;
    }

    const transport = isHttps ? https : http;
    const req = transport.request({
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method,
      headers: reqHeaders,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on('error', reject);
    if (reqBody) req.write(reqBody);
    req.end();
  });
}

/**
 * 步骤 1: 获取 OSS 上传签名
 */
async function getOSSSignature(token = '') {
  const formData = new FormData();
  formData.append('action', 'ucoss');
  formData.append('type', 'rmbg');
  formData.append('token', token);
  formData.append('reqType', 'PUT');
  formData.append('userid', 'PUT');

  const result = await request('POST', '/api/oss/signature', { formData });

  if (!result.success) {
    throw new Error(`OSS 签名获取失败: ${JSON.stringify(result)}`);
  }

  const { host, key, token: ossToken } = result.message;
  return {
    host: host.startsWith('//') ? `https:${host}` : host,
    key,
    ossToken,
    uploadUrl: `https:${host}${key}`,
  };
}

/**
 * 步骤 2: 上传图片到 UCloud OSS
 */
async function uploadToOSS(fileBuffer, fileName, contentType = 'image/jpeg') {
  // 1. 获取签名
  const { uploadUrl, ossToken } = await getOSSSignature();

  // 2. PUT 上传
  const resp = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Authorization': ossToken,
      'Content-Type': 'application/octet-stream',
    },
    body: fileBuffer,
  });

  if (!resp.ok && resp.status !== 200) {
    const text = await resp.text();
    throw new Error(`OSS 上传失败 (${resp.status}): ${text}`);
  }

  // 返回完整 HTTPS URL（服务器需要完整 URL 才能下载）
  console.log(`[API] 图片已上传: ${uploadUrl}`);
  return uploadUrl;
}

/**
 * 步骤 3: 提交抠图任务
 */
async function submitSegment(imageUrl, width, height, captchaCode, token = '') {
  const formData = new FormData();
  formData.append('image', imageUrl);
  formData.append('type', 'rmbg');
  formData.append('width', String(width));
  formData.append('height', String(height));
  formData.append('action', 'zero');
  formData.append('token', token);
  formData.append('captchacode', captchaCode);
  formData.append('filename', '');
  formData.append('model', '3');
  formData.append('edge_enhancement', '0');
  formData.append('aiShadow', '0');

  const result = await request('POST', '/api/segment', {
    formData,
    headers: token ? { Authorization: token } : {},
  });

  if (!result.success) {
    throw new Error(`抠图提交失败: ${JSON.stringify(result)}`);
  }

  console.log(`[API] 抠图任务已提交, taskId: ${result.message.taskId}`);
  return result.message.taskId;
}

/**
 * 步骤 4: 轮询抠图结果
 */
async function pollResult(type, taskId, maxWaitSec = 45, token = '') {
  const startTime = Date.now();
  const timeout = maxWaitSec * 1000;

  while (Date.now() - startTime < timeout) {
    const formData = new FormData();
    formData.append('type', type);
    formData.append('taskId', taskId);
    formData.append('token', token);

    const result = await request('POST', '/api/query', { formData });

    if (!result.success) {
      throw new Error(`查询失败: ${JSON.stringify(result)}`);
    }

    const { code, resultpath, message: errMsg } = result.message;

    if (code === 200) {
      console.log(`[API] 抠图完成: ${resultpath}`);
      return resultpath;
    } else if (code === 500) {
      throw new Error(`抠图失败: ${errMsg || JSON.stringify(result.message)}`);
    }

    // 还在处理中
    const position = result.message.position || '';
    const progress = result.message.progress;
    console.log(`[API] 轮询... code=${code} position=${position} progress=${progress}`);
    await sleep(1000);
  }

  throw new Error(`轮询超时 (${maxWaitSec}s)`);
}

/**
 * 步骤 5: 下载结果图片
 */
async function downloadResult(resultPath) {
  const url = resultPath.startsWith('http') ? resultPath : `https:${resultPath}`;

  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const transport = urlObj.protocol === 'https:' ? https : http;
    const req = transport.request({
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.end();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============ 高级封装: 一键抠图 ============

/**
 * 完整抠图流程
 * @param {Buffer} imageBuffer - 原始图片
 * @param {string} captchaCode - WASM 验证码
 * @param {object} opts
 * @returns {Promise<Buffer>} PNG 透明底结果图
 */
async function removeBackground(imageBuffer, captchaCode, opts = {}) {
  const { token = '' } = opts;

  // 1. 获取图片尺寸
  const { width, height } = await getImageSize(imageBuffer);
  console.log(`[API] 图片尺寸: ${width}x${height}`);

  // 2. 上传到 OSS
  const ossUrl = await uploadToOSS(imageBuffer, 'image.jpg');

  // 3. 提交抠图
  const taskId = await submitSegment(ossUrl, width, height, captchaCode, token);

  // 4. 轮询结果
  const resultPath = await pollResult('rmbg', taskId, 120, token);

  // 5. 下载结果
  const resultBuffer = await downloadResult(resultPath);
  console.log(`[API] 结果已下载, 大小: ${resultBuffer.length} bytes`);

  return resultBuffer;
}

/**
 * 获取图片尺寸（不依赖 sharp 等 native 库）
 */
function getImageSize(buffer) {
  return new Promise((resolve, reject) => {
    // 简易 JPEG/PNG 尺寸解析
    if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
      // JPEG
      let i = 2;
      while (i < buffer.length) {
        if (buffer[i] !== 0xFF) { i++; continue; }
        const marker = buffer[i + 1];
        if (marker === 0xC0 || marker === 0xC2) {
          const h = buffer.readUInt16BE(i + 5);
          const w = buffer.readUInt16BE(i + 7);
          return resolve({ width: w, height: h });
        }
        i += 2 + buffer.readUInt16BE(i + 2);
      }
      return reject(new Error('无法解析 JPEG 尺寸'));
    } else if (buffer[0] === 0x89 && buffer.toString('ascii', 1, 4) === 'PNG') {
      // PNG
      const w = buffer.readUInt32BE(16);
      const h = buffer.readUInt32BE(20);
      return resolve({ width: w, height: h });
    } else if (buffer[0] === 0x52 && buffer[1] === 0x49) {
      // WebP
      if (buffer.toString('ascii', 8, 12) === 'WEBP') {
        if (buffer.toString('ascii', 12, 16) === 'VP8X') {
          const w = buffer.readUIntLE(24, 3) + 1;
          const h = buffer.readUIntLE(27, 3) + 1;
          return resolve({ width: w, height: h });
        } else if (buffer.toString('ascii', 12, 16) === 'VP8 ') {
          const w = buffer.readUInt16LE(26) & 0x3FFF;
          const h = buffer.readUInt16LE(28) & 0x3FFF;
          return resolve({ width: w, height: h });
        }
      }
      return reject(new Error('无法解析 WebP 尺寸'));
    } else if (buffer[0] === 0x47 && buffer[1] === 0x49) {
      // GIF
      const w = buffer.readUInt16LE(6);
      const h = buffer.readUInt16LE(8);
      return resolve({ width: w, height: h });
    }
    reject(new Error('不支持的图片格式'));
  });
}

module.exports = {
  getOSSSignature,
  uploadToOSS,
  submitSegment,
  pollResult,
  downloadResult,
  removeBackground,
  getImageSize,
};
