"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Check, X, Clock, Hash, Coins } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";

/* ── QR Code Canvas ─────────────────── */

function QRCanvas({ text, size = 192 }: { text: string; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, text, {
        width: size,
        margin: 2,
        color: { dark: "#18181b", light: "#ffffff" },
      });
    }
  }, [text, size]);
  return <canvas ref={canvasRef} width={size} height={size} className="w-48 h-48" />;
}

/* ── Scan line overlay ───────────────── */

function ScanLine() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-xl">
      <div className="absolute left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-emerald-500/60 to-transparent animate-scanLine" />
    </div>
  );
}

/* ── Props ──────────────────────────── */

interface QRStateProps {
  plan: any; order: any; qrCode: string; payUrl?: string | null; polling: boolean; onClose: () => void; currencySymbol?: string;
}

interface PaymentDialogProps {
  open: boolean;
  onClose: () => void;
  plan: any;
  order: any;
  qrCode: string | null;
  payUrl?: string | null;
  polling: boolean;
  paid: boolean;
  currencySymbol?: string;
}

/* ── Receipt Dotted Divider ─────────── */

function DottedDivider() {
  return (
    <div className="relative py-3">
      <div className="border-t border-dashed border-zinc-200 dark:border-zinc-700" />
      {/* Receipt tick marks — left/right notches */}
      <div className="absolute left-0 top-1/2 -translate-x-[13px] -translate-y-1/2 w-[10px] h-[10px] rounded-full bg-background border border-zinc-200 dark:border-zinc-700" />
      <div className="absolute right-0 top-1/2 translate-x-[13px] -translate-y-1/2 w-[10px] h-[10px] rounded-full bg-background border border-zinc-200 dark:border-zinc-700" />
    </div>
  );
}

/* ── Loading State ──────────────────── */

function LoadingState() {
  return (
    <div className="flex flex-col items-center py-10 px-6">
      {/* Animated receipt icon */}
      <div className="relative mb-6">
        <div className="w-14 h-14 rounded-2xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
          <div className="w-7 h-7 rounded-lg border-2 border-zinc-300 dark:border-zinc-600 border-t-zinc-900 dark:border-t-zinc-100 animate-spin" />
        </div>
        {/* Decorative corner dots */}
        <div className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-zinc-300 dark:bg-zinc-600 animate-pulse" />
        <div className="absolute -bottom-1 -left-1 w-2 h-2 rounded-full bg-zinc-300 dark:bg-zinc-600 animate-pulse" style={{ animationDelay: "0.5s" }} />
      </div>

      {/* Shimmer text lines */}
      <div className="space-y-2.5 w-full max-w-[160px]">
        <div className="h-3 rounded-full bg-zinc-200 dark:bg-zinc-800 animate-shimmer" />
        <div className="h-3 rounded-full bg-zinc-200 dark:bg-zinc-800 animate-shimmer" style={{ width: "70%", animationDelay: "0.15s" }} />
      </div>

      {/* Progress bar */}
      <div className="mt-6 w-full max-w-[180px] h-1 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
        <div className="h-full w-full bg-zinc-900 dark:bg-zinc-100 rounded-full animate-loadingBar" />
      </div>

      <p className="mt-4 text-[11px] text-zinc-400 dark:text-zinc-500 tracking-wide font-medium">
        正在创建订单...
      </p>
    </div>
  );
}

/* ── QR Code State ──────────────────── */

function QRState({
  plan, order, qrCode, payUrl, polling, onClose, currencySymbol = "¥",
}: QRStateProps) {
  const elapsedRef = useRef(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!polling) return;
    elapsedRef.current = 0;
    setElapsed(0);
    const timer = setInterval(() => {
      elapsedRef.current += 1;
      setElapsed(elapsedRef.current);
    }, 1000);
    return () => clearInterval(timer);
  }, [polling]);

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  return (
    <div>
      {/* ── Header — receipt top ── */}
      <div className="px-6 pt-6 pb-2">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
              <div className="w-3.5 h-3.5 rounded border-2 border-zinc-900 dark:border-zinc-100 flex items-center justify-center">
                <span className="text-[6px] font-black">¥</span>
              </div>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 leading-tight">
                {payUrl ? "积分支付" : "扫码支付"}
              </h3>
              <p className="text-[10px] text-zinc-400 leading-tight">{payUrl ? "Linux Do 积分" : "支付宝"}</p>
            </div>
          </div>

          {/* Close button */}
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Order summary — compact key-value rows */}
        <div className="space-y-1.5 text-[12px]">
          <div className="flex items-center justify-between">
            <span className="text-zinc-400">套餐</span>
            <span className="font-medium text-zinc-900 dark:text-zinc-100">{plan?.name || order?.plan_name}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-400">金额</span>
            <span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
              {currencySymbol}{order?.amount || plan?.price_monthly}
            </span>
          </div>
          {order?.order_no && (
            <div className="flex items-center justify-between">
              <span className="text-zinc-400">订单号</span>
              <span className="text-zinc-500 dark:text-zinc-400 font-mono text-[10px] tracking-tight">
                {order.order_no.slice(-12)}
              </span>
            </div>
          )}
        </div>
      </div>

      <DottedDivider />

      {/* ── QR Code panel ── */}
      <div className="px-6 pb-6">
        <div className="relative bg-zinc-50 dark:bg-zinc-900/50 rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 flex flex-col items-center">
          {payUrl ? (
            /* Linux Do 积分支付：展示跳转支付页入口（替代二维码） */
            <>
              <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center mb-3">
                <Coins className="w-6 h-6 text-amber-500" />
              </div>
              <a href={payUrl} target="_blank" rel="noopener noreferrer"
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 py-2.5 px-4 text-white text-xs font-medium transition-colors">
                <Coins className="w-3.5 h-3.5" />
                前往 Linux Do 积分支付页
              </a>
            </>
          ) : (
            <>
              {/* QR Code */}
              <div className="relative">
                <div className="p-2.5 bg-white rounded-xl shadow-sm">
                  <QRCanvas text={qrCode} />
                </div>
                {/* Scan line animation while polling */}
                {polling && <ScanLine />}
              </div>
            </>
          )}

          {/* Status indicator */}
          <div className="mt-3 flex items-center gap-2">
            {polling ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                <span className="text-[10px] text-zinc-400 tracking-wide">
                  等待支付
                </span>
              </>
            ) : (
              <>
                <Clock className="w-3 h-3 text-zinc-400" />
                <span className="text-[10px] text-zinc-400 tracking-wide">
                  等待支付
                </span>
              </>
            )}
          </div>

          {/* Elapsed timer */}
          {polling && (
            <div className="mt-1.5 text-[10px] text-zinc-300 dark:text-zinc-600 font-mono tabular-nums">
              {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
            </div>
          )}

          {/* Hint */}
          <p className="mt-3 text-[10px] text-zinc-400 dark:text-zinc-500 text-center leading-relaxed max-w-[200px]">
            {payUrl
              ? <>在支付页完成 <span className="font-medium text-zinc-500 dark:text-zinc-400">Linux Do 积分</span> 支付</>
              : <>打开 <span className="font-medium text-zinc-500 dark:text-zinc-400">支付宝</span> 扫码完成支付</>}
          </p>
        </div>

        {/* Footer note */}
        {order?.order_no && (
          <div className="mt-3 flex items-center justify-center gap-1.5 text-[9px] text-zinc-300 dark:text-zinc-600">
            <Hash className="w-2.5 h-2.5" />
            <span className="font-mono">{order.order_no}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Paid State ─────────────────────── */

function PaidState({ plan }: { plan: any }) {
  const [countdown, setCountdown] = useState(3);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  return (
    <div className="flex flex-col items-center py-10 px-6">
      {/* Success icon — animated check with ring */}
      <div className="relative mb-5">
        <div className="w-16 h-16 rounded-full bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center animate-[successPop_0.5s_cubic-bezier(0.16,1,0.3,1)]">
          <Check className="w-7 h-7 text-emerald-500 animate-[successCheck_0.4s_ease-out_0.1s_both]" />
        </div>
        {/* Expanding rings */}
        <div className="absolute inset-0 rounded-full border border-emerald-200 dark:border-emerald-500/20 animate-[successRing_2s_ease-out_0.3s_infinite]" />
        <div className="absolute -inset-2 rounded-full border border-emerald-100 dark:border-emerald-500/10 animate-[successRing_2s_ease-out_0.6s_infinite]" />
      </div>

      {/* Text */}
      <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100 mb-1">
        支付成功
      </h3>
      <p className="text-[13px] text-zinc-500 text-center mb-4">
        {plan?.name || "套餐"} 已开通
      </p>

      {/* Progress — auto-redirect */}
      <div className="w-full max-w-[160px] space-y-2">
        <div className="flex items-center justify-between text-[10px] text-zinc-400">
          <span>即将跳转</span>
          <span className="font-mono tabular-nums">{countdown}秒</span>
        </div>
        <div className="w-full h-1 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
          <div
            className="h-full bg-zinc-900 dark:bg-zinc-100 rounded-full transition-all duration-1000 ease-linear"
            style={{ width: `${((3 - countdown) / 3) * 100}%` }}
          />
        </div>
      </div>

      {/* Decorative dots */}
      <div className="mt-6 flex items-center gap-1.5">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="w-1 h-1 rounded-full bg-zinc-200 dark:bg-zinc-700"
            style={{
              animation: `successDot 1.4s ease-in-out ${i * 0.2}s infinite`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

/* ── Main Component ─────────────────── */

export function PaymentDialog({ open, onClose, plan, order, qrCode, payUrl, polling, paid, currencySymbol = "¥" }: PaymentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !polling) onClose(); }}>
      <DialogContent
        className="max-w-sm p-0 gap-0 overflow-hidden [&>button]:hidden"
        showCloseButton={false}
      >
        {paid ? (
          <PaidState plan={plan} />
        ) : (qrCode || payUrl) ? (
          <QRState plan={plan} order={order} qrCode={qrCode || ""} payUrl={payUrl} polling={polling} onClose={onClose} currencySymbol={currencySymbol} />
        ) : (
          <LoadingState />
        )}
      </DialogContent>

      {/* Inject keyframes for custom animations */}
      <style jsx global>{`
        @keyframes scanLine {
          0%   { top: -2px; opacity: 0; }
          10%  { opacity: 1; }
          90%  { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
        .animate-scanLine {
          animation: scanLine 2.4s ease-in-out infinite;
        }

        @keyframes shimmer {
          0%   { opacity: 1; }
          50%  { opacity: 0.3; }
          100% { opacity: 1; }
        }
        .animate-shimmer {
          animation: shimmer 1.8s ease-in-out infinite;
        }

        @keyframes loadingBar {
          0%   { transform: translateX(-100%); }
          50%  { transform: translateX(0%); }
          100% { transform: translateX(100%); }
        }
        .animate-loadingBar {
          animation: loadingBar 1.8s ease-in-out infinite;
        }

        @keyframes successPop {
          0%   { transform: scale(0.5); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }

        @keyframes successCheck {
          0%   { opacity: 0; transform: scale(0) rotate(-15deg); }
          100% { opacity: 1; transform: scale(1) rotate(0); }
        }

        @keyframes successRing {
          0%   { transform: scale(1); opacity: 0.6; }
          100% { transform: scale(1.3); opacity: 0; }
        }

        @keyframes successDot {
          0%, 100% { opacity: 0.2; transform: translateY(0); }
          50%  { opacity: 0.6; transform: translateY(-4px); }
        }
      `}</style>
    </Dialog>
  );
}
