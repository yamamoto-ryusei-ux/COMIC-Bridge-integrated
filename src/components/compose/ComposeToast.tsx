import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useComposeStore } from "../../store/composeStore";

export function ComposeToast() {
  const phase = useComposeStore((s) => s.phase);
  const results = useComposeStore((s) => s.results);
  const setPhase = useComposeStore((s) => s.setPhase);
  const isModalOpen = useComposeStore((s) => s.isModalOpen);

  const [toast, setToast] = useState<{
    type: "success" | "error" | "partial";
    successCount: number;
    errorCount: number;
    total: number;
    errors: { name: string; error: string }[];
    outputFolder: string | null;
  } | null>(null);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevPhaseRef = useRef(phase);

  useEffect(() => {
    if (prevPhaseRef.current === "processing" && phase === "complete" && results.length > 0) {
      if (isModalOpen) {
        prevPhaseRef.current = phase;
        return;
      }

      if (timerRef.current) clearTimeout(timerRef.current);

      const successCount = results.filter((r) => r.success).length;
      const errorCount = results.filter((r) => !r.success).length;
      const errors = results
        .filter((r) => !r.success)
        .map((r) => ({ name: r.sourceName, error: r.error || "不明なエラー" }));

      const firstSuccess = results.find((r) => r.success && r.outputFile);
      let outputFolder: string | null = null;
      if (firstSuccess?.outputFile) {
        const parts = firstSuccess.outputFile.replace(/\//g, "\\").split("\\");
        parts.pop();
        outputFolder = parts.join("\\");
      }

      setToast({
        type: errorCount === 0 ? "success" : successCount === 0 ? "error" : "partial",
        successCount,
        errorCount,
        total: results.length,
        errors,
        outputFolder,
      });

      requestAnimationFrame(() => setVisible(true));

      const duration = errorCount > 0 ? 10000 : 6000;
      timerRef.current = setTimeout(() => dismiss(), duration);
    }
    prevPhaseRef.current = phase;
  }, [phase, results, isModalOpen]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const dismiss = () => {
    setVisible(false);
    setTimeout(() => {
      setToast(null);
      if (!useComposeStore.getState().isModalOpen) {
        setPhase("idle");
      }
    }, 300);
  };

  const prevModalRef = useRef(isModalOpen);
  useEffect(() => {
    if (prevModalRef.current && !isModalOpen && phase === "complete" && results.length > 0) {
      if (timerRef.current) clearTimeout(timerRef.current);

      const sc = results.filter((r) => r.success).length;
      const ec = results.filter((r) => !r.success).length;
      const errs = results
        .filter((r) => !r.success)
        .map((r) => ({ name: r.sourceName, error: r.error || "不明なエラー" }));

      const firstSuccess = results.find((r) => r.success && r.outputFile);
      let outputFolder: string | null = null;
      if (firstSuccess?.outputFile) {
        const parts = firstSuccess.outputFile.replace(/\//g, "\\").split("\\");
        parts.pop();
        outputFolder = parts.join("\\");
      }

      setToast({
        type: ec === 0 ? "success" : sc === 0 ? "error" : "partial",
        successCount: sc,
        errorCount: ec,
        total: results.length,
        errors: errs,
        outputFolder,
      });

      requestAnimationFrame(() => setVisible(true));
      const duration = ec > 0 ? 10000 : 6000;
      timerRef.current = setTimeout(() => dismiss(), duration);
    }
    prevModalRef.current = isModalOpen;
  }, [isModalOpen, phase, results]);

  const openFolder = async () => {
    if (!toast?.outputFolder) return;
    try {
      await invoke("open_folder_in_explorer", { folderPath: toast.outputFolder });
    } catch (e) {
      console.error("Failed to open folder:", e);
    }
  };

  if (!toast) return null;

  const colors = {
    success: {
      border: "border-success/30",
      iconBg: "bg-success/15",
      iconColor: "text-success",
      textColor: "text-success",
      progressBg: "bg-success/40",
      glow: "shadow-[0_4px_24px_rgba(34,197,94,0.2)]",
      btnBg: "bg-success/10 hover:bg-success/20 text-success",
    },
    error: {
      border: "border-error/30",
      iconBg: "bg-error/15",
      iconColor: "text-error",
      textColor: "text-error",
      progressBg: "bg-error/40",
      glow: "shadow-[0_4px_24px_rgba(239,68,68,0.2)]",
      btnBg: "bg-error/10 hover:bg-error/20 text-error",
    },
    partial: {
      border: "border-warning/30",
      iconBg: "bg-warning/15",
      iconColor: "text-warning",
      textColor: "text-warning",
      progressBg: "bg-warning/40",
      glow: "shadow-[0_4px_24px_rgba(245,158,11,0.2)]",
      btnBg: "bg-warning/10 hover:bg-warning/20 text-warning",
    },
  };

  const c = colors[toast.type];
  const duration = toast.errorCount > 0 ? 10 : 6;

  return (
    <div
      className={`
        fixed top-4 left-1/2 z-[60] px-5 py-3.5 rounded-2xl border
        bg-white ${c.border} ${c.glow}
        flex items-start gap-3.5
        transition-all duration-300
        ${visible ? "opacity-100 -translate-x-1/2 translate-y-0" : "opacity-0 -translate-x-1/2 -translate-y-4"}
      `}
      style={{ minWidth: "340px", maxWidth: "540px" }}
    >
      {/* Icon */}
      {toast.type === "success" ? (
        <div
          className={`w-10 h-10 rounded-xl ${c.iconBg} flex items-center justify-center flex-shrink-0`}
          style={{
            animation: visible
              ? "check-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.15s both"
              : "none",
          }}
        >
          <svg
            className={`w-5 h-5 ${c.iconColor}`}
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
                animation: visible ? "check-draw 0.4s ease-out 0.3s forwards" : "none",
              }}
            />
          </svg>
        </div>
      ) : toast.type === "error" ? (
        <div
          className={`w-10 h-10 rounded-xl ${c.iconBg} flex items-center justify-center flex-shrink-0`}
          style={{ animation: visible ? "shake 0.5s ease-in-out 0.15s" : "none" }}
        >
          <svg
            className={`w-5 h-5 ${c.iconColor}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
      ) : (
        <div
          className={`w-10 h-10 rounded-xl ${c.iconBg} flex items-center justify-center flex-shrink-0`}
          style={{ animation: visible ? "shake 0.3s ease-in-out 0.15s" : "none" }}
        >
          <svg
            className={`w-5 h-5 ${c.iconColor}`}
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

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold ${c.textColor}`}>
          {toast.type === "success"
            ? `${toast.total} 件すべて合成完了`
            : toast.type === "error"
              ? `${toast.total} 件すべてエラー`
              : `${toast.successCount}/${toast.total} 件成功 / ${toast.errorCount} 件エラー`}
        </p>
        <p className="text-xs text-text-muted mt-0.5">
          {toast.type === "success"
            ? "出力フォルダに保存されました"
            : `${toast.errors.length > 0 ? toast.errors[0].error : ""}`}
        </p>
        {toast.errors.length > 1 && (
          <p className="text-[10px] text-text-muted/70 mt-0.5">
            他 {toast.errors.length - 1} 件のエラー
          </p>
        )}

        {toast.outputFolder && toast.successCount > 0 && (
          <button
            onClick={openFolder}
            className={`mt-2 px-3 py-1 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 ${c.btnBg}`}
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
              />
            </svg>
            出力フォルダを開く
          </button>
        )}
      </div>

      {/* Close button */}
      <button
        className="flex-shrink-0 p-1.5 rounded-lg hover:bg-bg-tertiary transition-colors mt-0.5"
        onClick={dismiss}
      >
        <svg className="w-3.5 h-3.5 text-text-muted" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {/* Auto-dismiss progress bar */}
      <div className="absolute bottom-0 left-0 right-0 h-0.5 rounded-b-2xl overflow-hidden">
        <div
          className={`h-full ${c.progressBg}`}
          style={{
            animation: visible ? `toast-progress ${duration}s linear forwards` : "none",
          }}
        />
      </div>
    </div>
  );
}
