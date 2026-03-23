import { useEffect } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { useSplitStore } from "../../store/splitStore";

export function SplitResultDialog() {
  const results = useSplitStore((s) => s.results);
  const showResultDialog = useSplitStore((s) => s.showResultDialog);
  const setShowResultDialog = useSplitStore((s) => s.setShowResultDialog);
  const processingDurationMs = useSplitStore((s) => s.processingDurationMs);
  const lastOutputDir = useSplitStore((s) => s.lastOutputDir);
  const settings = useSplitStore((s) => s.settings);

  const close = () => setShowResultDialog(false);

  // ESC to close
  useEffect(() => {
    if (!showResultDialog) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showResultDialog]);

  // Scroll lock
  useEffect(() => {
    if (!showResultDialog) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [showResultDialog]);

  if (!showResultDialog || results.length === 0) return null;

  const successCount = results.filter((r) => r.success).length;
  const errorCount = results.filter((r) => !r.success).length;
  const skippedCount = results.filter(
    (r) =>
      r.success && r.outputFiles.length === 1 && r.outputFiles[0] === "SKIPPED (already split)",
  ).length;
  const processedCount = successCount - skippedCount;
  const totalOutputFiles = results.reduce((acc, r) => {
    return acc + r.outputFiles.filter((f) => f !== "SKIPPED (already split)").length;
  }, 0);

  const modeLabel =
    settings.mode === "even" ? "均等分割" : settings.mode === "uneven" ? "不均等分割" : "変換のみ";
  const formatLabel = settings.outputFormat.toUpperCase();

  const durationText =
    processingDurationMs != null
      ? processingDurationMs < 1000
        ? `${processingDurationMs}ms`
        : processingDurationMs < 60000
          ? `${(processingDurationMs / 1000).toFixed(1)}秒`
          : `${Math.floor(processingDurationMs / 60000)}分${Math.round((processingDurationMs % 60000) / 1000)}秒`
      : null;

  const dialog = (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={close}>
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="relative w-full max-w-2xl max-h-[80vh] bg-bg-secondary rounded-2xl border border-border shadow-elevated animate-slide-up flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <h2 className="text-lg font-display font-medium text-text-primary flex items-center gap-2">
            <svg
              className="w-5 h-5 text-accent-tertiary"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            分割完了
          </h2>
          <button
            onClick={close}
            className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6 space-y-4">
          {/* Summary badges */}
          <div className="flex gap-3">
            {processedCount > 0 && (
              <div className="flex-1 bg-success/10 rounded-xl p-3 border border-success/30">
                <div className="flex items-center gap-2">
                  <svg
                    className="w-5 h-5 text-success"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-sm font-medium text-success">
                    {processedCount} ファイル処理
                  </span>
                </div>
                <p className="text-xs text-success/70 mt-1">
                  {totalOutputFiles} ファイル出力 ({formatLabel})
                </p>
              </div>
            )}
            {skippedCount > 0 && (
              <div className="flex-1 bg-warning/10 rounded-xl p-3 border border-warning/30">
                <div className="flex items-center gap-2">
                  <svg
                    className="w-5 h-5 text-warning"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <span className="text-sm font-medium text-warning">{skippedCount} スキップ</span>
                </div>
                <p className="text-xs text-warning/70 mt-1">分割済みファイル</p>
              </div>
            )}
            {errorCount > 0 && (
              <div className="flex-1 bg-error/10 rounded-xl p-3 border border-error/30">
                <div className="flex items-center gap-2">
                  <svg
                    className="w-5 h-5 text-error"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
                    />
                  </svg>
                  <span className="text-sm font-medium text-error">{errorCount} 失敗</span>
                </div>
              </div>
            )}
          </div>

          {/* Mode / Duration info */}
          <div className="flex items-center gap-3 text-xs text-text-muted">
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-bg-tertiary border border-border/50">
              <svg
                className="w-3 h-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
                />
              </svg>
              {modeLabel}
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-bg-tertiary border border-border/50">
              {formatLabel}
            </span>
            {durationText && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-bg-tertiary border border-border/50">
                <svg
                  className="w-3 h-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                {durationText}
              </span>
            )}
          </div>

          {/* File-by-file result table */}
          <div className="border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-bg-tertiary">
                  <th className="px-3 py-2 text-left text-xs font-medium text-text-muted w-10">
                    #
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-text-muted">
                    入力ファイル
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-text-muted">
                    出力ファイル名
                  </th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, idx) => {
                  const isSkipped =
                    r.success &&
                    r.outputFiles.length === 1 &&
                    r.outputFiles[0] === "SKIPPED (already split)";
                  return (
                    <tr key={idx} className="border-t border-border/50 hover:bg-bg-tertiary/50">
                      <td className="px-3 py-2 text-xs text-text-muted">{idx + 1}</td>
                      <td
                        className="px-3 py-2 text-xs text-text-primary max-w-[200px]"
                        title={r.fileName}
                      >
                        <span className="truncate block">{r.fileName}</span>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {isSkipped ? (
                          <span className="text-warning">スキップ（分割済み）</span>
                        ) : r.success ? (
                          <div className="space-y-0.5">
                            {r.outputFiles.map((f, j) => (
                              <p key={j} className="text-text-primary" title={f}>
                                {f}
                              </p>
                            ))}
                          </div>
                        ) : (
                          <span className="text-error" title={r.error}>
                            {r.error}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Error Details */}
          {errorCount > 0 && (
            <div className="bg-error/5 rounded-xl p-3 border border-error/20">
              <h4 className="text-xs font-medium text-error mb-2">エラー詳細</h4>
              <div className="space-y-1">
                {results
                  .filter((r) => !r.success)
                  .slice(0, 5)
                  .map((r, idx) => (
                    <p key={idx} className="text-[10px] text-error/80 truncate">
                      {r.fileName}: {r.error}
                    </p>
                  ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex items-center justify-between flex-shrink-0">
          {lastOutputDir ? (
            <button
              onClick={() =>
                invoke("open_folder_in_explorer", { folderPath: lastOutputDir }).catch(() => {})
              }
              className="px-4 py-2 text-sm font-medium rounded-xl text-accent-tertiary bg-accent-tertiary/10 border border-accent-tertiary/30 hover:bg-accent-tertiary/20 transition-all flex items-center gap-1.5"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z"
                />
              </svg>
              出力フォルダを開く
            </button>
          ) : (
            <div />
          )}
          <button
            onClick={close}
            className="px-6 py-2.5 text-sm font-medium rounded-xl text-white bg-gradient-to-r from-accent-tertiary to-accent-secondary shadow-[0_4px_15px_rgba(0,212,170,0.3)] hover:-translate-y-0.5 transition-all duration-200"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}
