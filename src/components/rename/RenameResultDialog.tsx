import { useEffect } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { useRenameStore } from "../../store/renameStore";

export function RenameResultDialog() {
  const results = useRenameStore((s) => s.results);
  const showResultDialog = useRenameStore((s) => s.showResultDialog);
  const setShowResultDialog = useRenameStore((s) => s.setShowResultDialog);
  const subMode = useRenameStore((s) => s.subMode);

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

  // 最初の成功結果から出力フォルダを取得
  const firstSuccess = results.find((r) => r.success && r.outputFile);
  const outputDir = firstSuccess ? firstSuccess.outputFile.replace(/[\\/][^\\/]+$/, "") : null;

  const modeLabel = subMode === "layer" ? "レイヤーリネーム" : "ファイルリネーム";

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
            リネーム完了
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
            {successCount > 0 && (
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
                    {successCount} ファイル成功
                  </span>
                </div>
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

          {/* Mode info */}
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
                  d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                />
              </svg>
              {modeLabel}
            </span>
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
                    ファイル名
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-text-muted">
                    変更内容
                  </th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, idx) => (
                  <tr key={idx} className="border-t border-border/50 hover:bg-bg-tertiary/50">
                    <td className="px-3 py-2 text-xs text-text-muted">{idx + 1}</td>
                    <td
                      className="px-3 py-2 text-xs text-text-primary max-w-[200px]"
                      title={r.fileName}
                    >
                      <span className="truncate block">{r.fileName}</span>
                      {r.newFileName && (
                        <span className="text-accent-tertiary truncate block">
                          → {r.newFileName}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {r.success ? (
                        <div className="space-y-0.5">
                          {r.changes.map((c, j) => (
                            <p key={j} className="text-text-secondary">
                              {c}
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
                ))}
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
          {outputDir ? (
            <button
              onClick={() =>
                invoke("open_folder_in_explorer", {
                  folderPath: outputDir,
                }).catch(() => {})
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
