"use client";

import { X, Share2, Clock, Image as ImageIcon, Download, Trash2 } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { imageProxyUrl, formatShort } from "@/lib/utils";
import { sizeLabel, shareState } from "../lib/helpers";

type Props = {
  previewGen: any;
  setPreviewGen: (g: any) => void;
  toggleShare: (e: React.MouseEvent, g: any) => Promise<void>;
  editGen: (e: React.MouseEvent, g: any) => void;
  downloadImg: (src: string, i: number) => void;
  setDeleteTarget: (id: number) => void;
};

// 作品预览弹窗：大图 + 提示词/元信息 + 分享/编辑/下载/删除操作。
export function PreviewDialog({ previewGen, setPreviewGen, toggleShare, editGen, downloadImg, setDeleteTarget }: Props) {
  return (
    <Dialog open={!!previewGen} onOpenChange={() => setPreviewGen(null)}>
      <DialogContent className="max-w-3xl p-0 px-3 sm:px-0 bg-transparent border-0 shadow-none [&>button]:hidden">
        {previewGen && (
          <div className="bg-white/80 dark:bg-white/[0.04] backdrop-blur-xl rounded-2xl overflow-hidden shadow-2xl ring-1 ring-zinc-900/[0.08] dark:ring-white/10">
            {/* Close */}
            <div className="relative">
              <button onClick={() => setPreviewGen(null)}
                className="absolute top-3 right-3 md:top-4 md:right-4 z-10 w-9 h-9 md:w-8 md:h-8 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/60 transition-colors">
                <X className="w-4 h-4" />
              </button>
              <img src={imageProxyUrl(previewGen)} className="w-full h-auto" alt={previewGen.prompt} />
            </div>
            {/* Info + Actions */}
            <div className="p-3 sm:p-4 space-y-2 sm:space-y-3">
              <p className="text-xs sm:text-sm text-zinc-900 dark:text-white leading-relaxed line-clamp-2 sm:line-clamp-3">{previewGen.prompt}</p>
              <div className="flex items-center gap-2">
                {previewGen.size && <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-900/[0.05] dark:bg-white/[0.08] text-zinc-500 dark:text-white/55 font-mono">{sizeLabel(previewGen.size, true)}</span>}
                <span className="text-[10px] text-zinc-400 dark:text-white/40">{formatShort(previewGen.created_at)}</span>
              </div>
              {/* Action buttons — mobile: icons only, desktop: icon + label */}
              <div className="flex items-center gap-1 sm:gap-2 pt-2 sm:pt-3 border-t border-zinc-900/[0.07] dark:border-white/10">
                <button onClick={async (e) => {
                    const cur = shareState(previewGen);
                    await toggleShare(e, previewGen);
                    setPreviewGen({ ...previewGen, share_status: cur.active ? "none" : "pending", shared: cur.active ? false : previewGen.shared });
                  }}
                  className="flex items-center justify-center sm:justify-start gap-0.5 sm:gap-1.5 w-9 sm:w-auto h-9 sm:h-auto px-0 sm:px-3 py-2 sm:py-1.5 rounded-lg text-[11px] font-medium bg-zinc-900/[0.05] dark:bg-white/[0.08] text-zinc-600 dark:text-white/70 hover:text-zinc-900 dark:hover:text-white transition-colors">
                  {shareState(previewGen).key === "pending"
                    ? <Clock className="w-4 h-4 sm:w-3.5 sm:h-3.5 shrink-0" />
                    : <Share2 className="w-4 h-4 sm:w-3.5 sm:h-3.5 shrink-0" />}
                  <span className="hidden sm:inline">{shareState(previewGen).label}</span>
                </button>
                <button onClick={(e) => { editGen(e, previewGen); setPreviewGen(null); }}
                  className="flex items-center justify-center sm:justify-start gap-0.5 sm:gap-1.5 w-9 sm:w-auto h-9 sm:h-auto px-0 sm:px-3 py-2 sm:py-1.5 rounded-lg text-[11px] font-medium bg-zinc-900/[0.05] dark:bg-white/[0.08] text-zinc-600 dark:text-white/70 hover:text-zinc-900 dark:hover:text-white transition-colors">
                  <ImageIcon className="w-4 h-4 sm:w-3.5 sm:h-3.5 shrink-0" />
                  <span className="hidden sm:inline">编辑</span>
                </button>
                <button onClick={() => { downloadImg(imageProxyUrl(previewGen), previewGen.id); }}
                  className="flex items-center justify-center sm:justify-start gap-0.5 sm:gap-1.5 w-9 sm:w-auto h-9 sm:h-auto px-0 sm:px-3 py-2 sm:py-1.5 rounded-lg text-[11px] font-medium bg-zinc-900/[0.05] dark:bg-white/[0.08] text-zinc-600 dark:text-white/70 hover:text-zinc-900 dark:hover:text-white transition-colors">
                  <Download className="w-4 h-4 sm:w-3.5 sm:h-3.5 shrink-0" />
                  <span className="hidden sm:inline">下载</span>
                </button>
                <button onClick={() => { setDeleteTarget(previewGen.id); }}
                  className="flex items-center justify-center sm:justify-start gap-0.5 sm:gap-1.5 w-9 sm:w-auto h-9 sm:h-auto px-0 sm:px-3 py-2 sm:py-1.5 rounded-lg text-[11px] font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors ml-auto">
                  <Trash2 className="w-4 h-4 sm:w-3.5 sm:h-3.5 shrink-0" />
                  <span className="hidden sm:inline">删除</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
