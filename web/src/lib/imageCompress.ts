// 参考图上传前的浏览器内压缩。
// 关键事实：上游 gpt-image 只用 ~1.5MP（约 1254×1254 / 长边 ~1900），
// 参考图传超过这个尺寸的像素纯属浪费。压到长边 ~1536px 对上游画质无损，
// 但体积可从数 MB 降到几百 KB，上传提速一个数量级。
//
// 输出统一为「裸 base64」（不含 data: 前缀），与现有 ref_images_b64 契约一致。

export type CompressOptions = {
  maxEdge: number;   // 压缩后最长边像素
  quality: number;   // 0-1（WebP/JPEG 有损质量）
  format: "webp" | "jpeg" | "auto"; // auto=优先 webp，回退 jpeg
  thresholdKB: number; // 小于此体积直接直传，不压缩
};

export const DEFAULT_COMPRESS: CompressOptions = {
  maxEdge: 1536,
  quality: 0.82,
  format: "auto",
  thresholdKB: 100,
};

// 从后端 settings 字段构造压缩选项（带兜底默认）。
export function compressOptionsFromSettings(s: any): CompressOptions {
  const maxEdge = Number(s?.upload_max_edge) > 0 ? Number(s.upload_max_edge) : DEFAULT_COMPRESS.maxEdge;
  const q = Number(s?.upload_quality);
  const quality = q > 0 && q <= 100 ? q / 100 : DEFAULT_COMPRESS.quality;
  const fmt = String(s?.upload_format || "").toLowerCase();
  const format: CompressOptions["format"] = fmt === "webp" || fmt === "jpeg" ? fmt : "auto";
  const thKB = Number(s?.upload_compress_threshold_kb);
  const thresholdKB = thKB > 0 ? thKB : DEFAULT_COMPRESS.thresholdKB;
  return { maxEdge, quality, format, thresholdKB };
}

// 检测浏览器是否支持 WebP 编码（canvas.toDataURL）。结果缓存。
let _webpOk: boolean | null = null;
function supportsWebP(): boolean {
  if (_webpOk !== null) return _webpOk;
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    _webpOk = c.toDataURL("image/webp").startsWith("data:image/webp");
  } catch {
    _webpOk = false;
  }
  return _webpOk;
}

// readAsDataURL → 裸 base64
function fileToBareB64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result as string;
      resolve(r.includes(",") ? r.split(",")[1] : r);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// 把 File/Blob 解码为 ImageBitmap（优先，省内存）或 HTMLImageElement（回退）。
async function decode(file: Blob): Promise<{ w: number; h: number; draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    const bmp = await createImageBitmap(file);
    return {
      w: bmp.width, h: bmp.height,
      draw: (ctx, w, h) => ctx.drawImage(bmp, 0, 0, w, h),
      close: () => bmp.close(),
    };
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = url;
    });
    return {
      w: img.naturalWidth, h: img.naturalHeight,
      draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
      close: () => URL.revokeObjectURL(url),
    };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

// 压缩单个图片文件，返回 { b64, mime, w, h }。
// 若文件本身已小于阈值且尺寸不超标，则原样直传（仅转裸 base64），不重新编码。
export async function compressImage(file: File, opts: CompressOptions): Promise<{ b64: string; mime: string; w: number; h: number }> {
  const sizeKB = file.size / 1024;
  // 小图直传：省去解码/编码开销
  if (sizeKB <= opts.thresholdKB) {
    return { b64: await fileToBareB64(file), mime: file.type || "image/png", w: 0, h: 0 };
  }

  let dec;
  try {
    dec = await decode(file);
  } catch {
    // 解码失败（异常格式）→ 原图直传，不阻断用户
    return { b64: await fileToBareB64(file), mime: file.type || "image/png", w: 0, h: 0 };
  }

  const { w: ow, h: oh } = dec;
  const longEdge = Math.max(ow, oh);
  const scale = longEdge > opts.maxEdge ? opts.maxEdge / longEdge : 1;
  const tw = Math.max(1, Math.round(ow * scale));
  const th = Math.max(1, Math.round(oh * scale));

  const canvas = document.createElement("canvas");
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) {
    dec.close();
    return { b64: await fileToBareB64(file), mime: file.type || "image/png", w: ow, h: oh };
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  dec.draw(ctx, tw, th);
  dec.close();

  // 选格式：auto → webp(若支持) 否则 jpeg
  let mime = "image/jpeg";
  if (opts.format === "webp" || (opts.format === "auto" && supportsWebP())) {
    mime = "image/webp";
  }

  const dataUrl = canvas.toDataURL(mime, opts.quality);
  // 极端兜底：toDataURL 失败回退 png
  const b64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : "";
  if (!b64) {
    return { b64: await fileToBareB64(file), mime: file.type || "image/png", w: ow, h: oh };
  }
  return { b64, mime, w: tw, h: th };
}
