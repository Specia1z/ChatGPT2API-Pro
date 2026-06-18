/**
 * WASM 验证码提供器 — 纯 Node.js 实现，零浏览器依赖
 * 
 * WASM 模块导出:
 *   add_mouse_event(type, x, y, timestamp) — 采集鼠标行为
 *   record_browser_info(jsonPtr)           — 记录浏览器指纹
 *   get_code() -> stringPtr                — 生成验证码
 * 
 * 依赖: Node.js WASI (wasi_snapshot_preview1)
 */

const fs = require('fs');
const path = require('path');
const { WASI } = require('wasi');

const WASM_PATH = path.join(__dirname, 'reCAPTCHA.wasm');

class CaptchaProvider {
  #instance = null;
  #memory = null;
  #exports = null;

  async init() {
    if (this.#instance) return;

    const wasmBuffer = fs.readFileSync(WASM_PATH);

    const wasi = new WASI({ version: 'preview1', args: [], env: {} });

    const importObject = {
      wasi_snapshot_preview1: wasi.wasiImport,
      env: {
        emscripten_memcpy_big: (dst, src, len) => {
          this.#memory.copy(dst, src, len);
        },
        emscripten_resize_heap: () => 0,
        setTempRet0: () => {},
      },
    };

    const wasmModule = await WebAssembly.compile(wasmBuffer);
    this.#instance = await WebAssembly.instantiate(wasmModule, importObject);
    this.#exports = this.#instance.exports;
    this.#memory = this.#exports.memory;

    if (this.#exports.__wasm_call_ctors) {
      this.#exports.__wasm_call_ctors();
    }
    wasi.initialize(this.#instance);
    if (this.#exports.emscripten_stack_init) {
      this.#exports.emscripten_stack_init();
    }
  }

  /**
   * 模拟真实浏览器行为：先采集鼠标事件，再记录浏览器指纹
   * 这样可以获得有效的验证码
   */
  async warmup(opts = {}) {
    const {
      mouseCount = 1000,
      durationSec = 30,
      ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      lang = 'zh-CN',
      screenW = 1920,
      screenH = 1080,
    } = opts;

    // 1. 先模拟鼠标事件（和浏览器行为一致）
    const baseTime = Math.round(Date.now() / 1000) - durationSec;
    let x = 400 + Math.random() * 400;
    let y = 300 + Math.random() * 300;

    for (let i = 0; i < mouseCount; i++) {
      x += (Math.random() - 0.5) * 30;
      y += (Math.random() - 0.5) * 20;
      x = Math.max(50, Math.min(screenW - 50, Math.round(x)));
      y = Math.max(50, Math.min(screenH - 50, Math.round(y)));
      const t = baseTime + Math.floor(i * (durationSec / mouseCount));

      // mousemove (type=1)
      this.#exports.add_mouse_event(1, x, y, t);

      // 偶尔点击
      if (Math.random() < 0.005) {
        this.#exports.add_mouse_event(2, x, y, t);
        this.#exports.add_mouse_event(3, x, y, t + 1);
      }
    }

    // 2. 然后记录浏览器指纹（前端在 ~1秒后调用）
    const info = JSON.stringify({ ua, lang, w: screenW, h: screenH, tz: new Date().getTimezoneOffset() });
    const enc = new TextEncoder();
    const bytes = enc.encode(info + '\0');
    const sp = this.#exports.stackSave();
    const ptr = this.#exports.stackAlloc(bytes.length);
    new Uint8Array(this.#memory.buffer, ptr, bytes.length).set(bytes);
    this.#exports.record_browser_info(ptr);
    this.#exports.stackRestore(sp);
  }

  /**
   * 获取验证码（必须先调用 warmup）
   */
  getCode() {
    const ptr = this.#exports.get_code();
    // 读取到 null 终止符
    const raw = new Uint8Array(this.#memory.buffer, ptr, 50000);
    let end = 0;
    while (end < raw.length && raw[end] !== 0) end++;
    return new TextDecoder().decode(raw.slice(0, end));
  }
}

module.exports = { CaptchaProvider };
