import { useState, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useSpecStore } from "../../store/specStore";

export function ConversionToast() {
  const isConverting = useSpecStore((state) => state.isConverting);
  const conversionResults = useSpecStore((state) => state.conversionResults);

  const [toast, setToast] = useState<{
    type: "success" | "error";
    message: string;
    detail?: string;
  } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevIsConvertingRef = useRef(isConverting);

  useEffect(() => {
    if (prevIsConvertingRef.current && !isConverting && conversionResults.length > 0) {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);

      const successCount = conversionResults.filter((r) => r.success).length;
      const errorCount = conversionResults.filter((r) => !r.success).length;
      const errorResults = conversionResults.filter((r) => !r.success);

      // ウィンドウを前面に
      getCurrentWindow()
        .setFocus()
        .catch(() => {});

      if (errorCount > 0) {
        setToast({
          type: "error",
          message: `${successCount}/${conversionResults.length} 件成功 / ${errorCount} 件エラー`,
          detail: errorResults.map((r) => `${r.fileName}: ${r.error}`).join("\n"),
        });
      } else {
        setToast({
          type: "success",
          message: `${successCount} 件すべて変換完了`,
        });
      }

      toastTimerRef.current = setTimeout(() => setToast(null), 6000);
    }
    prevIsConvertingRef.current = isConverting;
  }, [isConverting, conversionResults]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  if (!toast) return null;

  return (
    <div
      className={`fixed top-4 left-1/2 -translate-x-1/2 z-[60] px-5 py-3 rounded-xl shadow-elevated border flex items-center gap-3 ${
        toast.type === "success" ? "bg-white border-success/30" : "bg-white border-error/30"
      }`}
      style={{
        animation: "toast-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)",
        minWidth: "280px",
        maxWidth: "600px",
      }}
    >
      {/* Icon */}
      {toast.type === "success" ? (
        <div
          className="w-8 h-8 rounded-full bg-success/15 flex items-center justify-center flex-shrink-0"
          style={{ animation: "check-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.15s both" }}
        >
          <svg
            className="w-5 h-5 text-success"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
              style={{
                strokeDasharray: 24,
                strokeDashoffset: 24,
                animation: "check-draw 0.4s ease-out 0.3s forwards",
              }}
            />
          </svg>
        </div>
      ) : (
        <div
          className="w-8 h-8 rounded-full bg-error/15 flex items-center justify-center flex-shrink-0"
          style={{ animation: "shake 0.5s ease-in-out 0.15s" }}
        >
          <svg
            className="w-5 h-5 text-error"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
            />
          </svg>
        </div>
      )}

      {/* Message */}
      <div className="flex-1 min-w-0">
        <p
          className={`text-sm font-medium ${toast.type === "success" ? "text-success" : "text-error"}`}
        >
          {toast.message}
        </p>
        {toast.detail && (
          <p className="text-xs text-text-muted mt-0.5 break-words">{toast.detail}</p>
        )}
      </div>

      {/* Close */}
      <button
        className="flex-shrink-0 p-1 rounded-lg hover:bg-bg-tertiary transition-colors"
        onClick={() => setToast(null)}
      >
        <svg className="w-3.5 h-3.5 text-text-muted" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {/* Progress bar (auto-dismiss) */}
      <div className="absolute bottom-0 left-0 right-0 h-0.5 rounded-b-xl overflow-hidden">
        <div
          className={`h-full ${toast.type === "success" ? "bg-success/40" : "bg-error/40"}`}
          style={{ animation: "toast-progress 6s linear forwards" }}
        />
      </div>
    </div>
  );
}
