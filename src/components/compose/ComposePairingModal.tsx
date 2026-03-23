import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { useComposeStore } from "../../store/composeStore";
import { ComposePairingAutoTab } from "./ComposePairingAutoTab";
import { ComposePairingManualTab } from "./ComposePairingManualTab";
import { ComposePairingOutputSettings } from "./ComposePairingOutputSettings";

interface Props {
  onExecute: () => Promise<void>;
  onRescan: () => Promise<void>;
}

/** operationsからマッチしたレイヤー/グループ名を抽出 */
function extractMatchedNames(operations: string[]): string[] {
  const names: string[] = [];
  for (const op of operations) {
    const m = op.match(/^\s+→\s+(?:レイヤー|グループ|テキストフォルダ)「(.+?)」$/);
    if (m) names.push(m[1]);
  }
  return names;
}

export function ComposePairingModal({ onExecute, onRescan }: Props) {
  const closeModal = useComposeStore((s) => s.closeModal);
  const pairingJobs = useComposeStore((s) => s.pairingJobs);
  const phase = useComposeStore((s) => s.phase);
  const progress = useComposeStore((s) => s.progress);
  const totalPairs = useComposeStore((s) => s.totalPairs);
  const currentPair = useComposeStore((s) => s.currentPair);
  const results = useComposeStore((s) => s.results);
  const detectedLinkChar = useComposeStore((s) => s.detectedLinkChar);
  const pairingDialogMode = useComposeStore((s) => s.pairingDialogMode);
  const setPairingDialogMode = useComposeStore((s) => s.setPairingDialogMode);
  const excludedPairIndices = useComposeStore((s) => s.excludedPairIndices);
  const manualPairs = useComposeStore((s) => s.manualPairs);
  const setManualPairs = useComposeStore((s) => s.setManualPairs);

  const totalPairsCount = pairingJobs.reduce((acc, job) => acc + job.pairs.length, 0);
  const successCount = results.filter((r) => r.success).length;
  const errorCount = results.filter((r) => !r.success).length;

  const activePairCount =
    pairingDialogMode === "auto" ? totalPairsCount - excludedPairIndices.size : manualPairs.length;

  // 合成モードでは isReversed は常に false
  const isReversed = false;

  // ESC to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phase !== "processing") {
        closeModal();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [phase, closeModal]);

  // Scroll lock
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const handleExecute = async () => {
    await onExecute();
  };

  const switchToManualMode = () => {
    setManualPairs([]);
    setPairingDialogMode("manual");
  };

  // Per-result matched names
  const resultMatchMap = useMemo(() => {
    if (phase !== "complete") return new Map<number, string[]>();
    const map = new Map<number, string[]>();
    for (const r of results) {
      if (r.success) {
        const names = extractMatchedNames(r.operations);
        if (names.length > 0) {
          map.set(r.pairIndex, names);
        }
      }
    }
    return map;
  }, [phase, results]);

  const modalContent = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={phase !== "processing" ? closeModal : undefined}
    >
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="relative w-full max-w-3xl max-h-[80vh] bg-bg-secondary rounded-2xl border border-border shadow-elevated animate-slide-up flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <h2 className="text-lg font-display font-medium text-text-primary">
            {phase === "processing"
              ? "処理中..."
              : phase === "complete"
                ? "処理完了"
                : "ペアリング確認"}
          </h2>
          {phase !== "processing" && (
            <button
              onClick={closeModal}
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
          )}
        </div>

        {/* Tab Switcher (idle phase only) */}
        {phase === "idle" && (
          <div className="flex border-b border-border flex-shrink-0">
            <button
              onClick={() => setPairingDialogMode("auto")}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                pairingDialogMode === "auto"
                  ? "border-accent text-accent"
                  : "border-transparent text-text-muted hover:text-text-primary"
              }`}
            >
              自動ペアリング
            </button>
            <button
              onClick={switchToManualMode}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                pairingDialogMode === "manual"
                  ? "border-accent text-accent"
                  : "border-transparent text-text-muted hover:text-text-primary"
              }`}
            >
              手動マッチ
            </button>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-auto p-6 space-y-4">
          {/* Operation Summary (idle only) */}
          {phase === "idle" && (
            <div className="bg-bg-tertiary rounded-xl p-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-text-muted text-xs">モード</span>
                  <p className="text-text-primary font-medium">合成</p>
                </div>
                <div>
                  <span className="text-text-muted text-xs">方向</span>
                  <p className="text-text-primary font-medium">原稿A + 原稿B</p>
                </div>
                <div>
                  <span className="text-text-muted text-xs">ペア数</span>
                  <p className="text-text-primary font-medium">
                    {activePairCount} ペア
                    {pairingDialogMode === "auto" &&
                      pairingJobs.length > 1 &&
                      ` (${pairingJobs.length} ジョブ)`}
                  </p>
                </div>
                {detectedLinkChar && (
                  <div>
                    <span className="text-text-muted text-xs">検出リンク文字</span>
                    <p className="text-accent font-medium">「{detectedLinkChar}」</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Idle phase: Tab content */}
          {phase === "idle" && pairingDialogMode === "auto" && (
            <ComposePairingAutoTab isReversed={isReversed} onRescan={onRescan} />
          )}
          {phase === "idle" && pairingDialogMode === "manual" && (
            <ComposePairingManualTab isReversed={isReversed} />
          )}

          {/* Progress (during processing) */}
          {phase === "processing" && (
            <div className="bg-accent/10 rounded-xl p-4 border border-accent/30">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-4 h-4 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
                <span className="text-sm text-accent font-medium">Photoshopで処理中...</span>
              </div>
              {currentPair && (
                <p className="text-xs text-text-muted truncate mb-2">{currentPair}</p>
              )}
              <div className="bg-bg-elevated rounded-full h-2 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-accent to-accent-secondary transition-all duration-300"
                  style={{
                    width: `${totalPairs > 0 ? (progress / totalPairs) * 100 : 0}%`,
                  }}
                />
              </div>
              <p className="text-xs text-text-muted mt-1 text-right">
                {progress} / {totalPairs}
              </p>
            </div>
          )}

          {/* Results Summary (after completion) */}
          {phase === "complete" && (
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
                    <span className="text-sm font-medium text-success">{successCount} 成功</span>
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
          )}

          {/* Results File Pair Table (processing/complete) */}
          {(phase === "processing" || phase === "complete") && (
            <div className="border border-border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-bg-tertiary">
                    <th className="px-3 py-2 text-left text-xs font-medium text-text-muted w-10">
                      #
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-text-muted">
                      原稿A
                    </th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-text-muted w-8">
                      &nbsp;
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-text-muted">
                      原稿B
                    </th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-text-muted w-16">
                      状態
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pairingJobs.map((job, jobIdx) => (
                    <>
                      {pairingJobs.length > 1 && (
                        <tr key={`job-${jobIdx}`}>
                          <td
                            colSpan={5}
                            className="px-3 py-1.5 bg-accent/5 text-[10px] font-medium text-accent"
                          >
                            {job.description}
                          </td>
                        </tr>
                      )}
                      {job.pairs.map((pair) => {
                        const result = results.find((r) => r.pairIndex === pair.pairIndex);
                        return (
                          <tr
                            key={pair.pairIndex}
                            className="border-t border-border/50 hover:bg-bg-tertiary/50"
                          >
                            <td className="px-3 py-2 text-xs text-text-muted">
                              {pair.pairIndex + 1}
                            </td>
                            <td className="px-3 py-2 text-xs text-text-primary truncate max-w-[200px]">
                              {pair.sourceName}
                            </td>
                            <td className="px-3 py-2 text-center text-text-muted">
                              <svg
                                className="w-3 h-3 inline"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth={2}
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M13 7l5 5m0 0l-5 5m5-5H6"
                                />
                              </svg>
                            </td>
                            <td className="px-3 py-2 text-xs">
                              <div className="text-text-primary truncate max-w-[200px]">
                                {pair.targetName}
                              </div>
                              {resultMatchMap.has(pair.pairIndex) && (
                                <div className="flex flex-wrap gap-0.5 mt-0.5">
                                  {resultMatchMap.get(pair.pairIndex)!.map((name, i) => (
                                    <span
                                      key={i}
                                      className="px-1 py-0 text-[9px] rounded bg-accent-secondary/15 text-accent-secondary"
                                    >
                                      {name}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2 text-center">
                              {result ? (
                                result.success ? (
                                  <span className="inline-flex w-5 h-5 items-center justify-center rounded-full bg-success/20">
                                    <svg
                                      className="w-3 h-3 text-success"
                                      fill="none"
                                      viewBox="0 0 24 24"
                                      stroke="currentColor"
                                      strokeWidth={3}
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        d="M5 13l4 4L19 7"
                                      />
                                    </svg>
                                  </span>
                                ) : (
                                  <span
                                    className="inline-flex w-5 h-5 items-center justify-center rounded-full bg-error/20"
                                    title={result.error}
                                  >
                                    <svg
                                      className="w-3 h-3 text-error"
                                      fill="none"
                                      viewBox="0 0 24 24"
                                      stroke="currentColor"
                                      strokeWidth={3}
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        d="M6 18L18 6M6 6l12 12"
                                      />
                                    </svg>
                                  </span>
                                )
                              ) : (
                                <div className="w-3 h-3 mx-auto rounded-full border border-text-muted/20" />
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Error Details */}
          {phase === "complete" && errorCount > 0 && (
            <div className="bg-error/5 rounded-xl p-3 border border-error/20">
              <h4 className="text-xs font-medium text-error mb-2">エラー詳細</h4>
              <div className="space-y-1">
                {results
                  .filter((r) => !r.success)
                  .slice(0, 5)
                  .map((r) => (
                    <p key={r.pairIndex} className="text-[10px] text-error/80 truncate">
                      {r.sourceName} → {r.targetName}: {r.error}
                    </p>
                  ))}
              </div>
            </div>
          )}
        </div>

        {/* Output Settings (idle phase only) */}
        {phase === "idle" && <ComposePairingOutputSettings />}

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex items-center justify-end gap-3 flex-shrink-0">
          {phase === "idle" && (
            <>
              <button
                onClick={closeModal}
                className="px-4 py-2 text-sm rounded-xl text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={handleExecute}
                disabled={activePairCount === 0}
                className="
                  px-6 py-2.5 text-sm font-medium rounded-xl text-white
                  bg-gradient-to-r from-accent to-accent-secondary
                  shadow-glow-pink
                  hover:shadow-[0_6px_20px_rgba(255,90,138,0.4)]
                  hover:-translate-y-0.5
                  transition-all duration-200
                  disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none
                  flex items-center gap-2
                "
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
                    d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                {activePairCount} ペアを処理
              </button>
            </>
          )}
          {phase === "complete" && (
            <>
              {(() => {
                const firstSuccess = results.find((r) => r.success && r.outputFile);
                if (!firstSuccess?.outputFile) return null;
                const parts = firstSuccess.outputFile.replace(/\//g, "\\").split("\\");
                parts.pop();
                const outputFolder = parts.join("\\");
                return (
                  <button
                    onClick={() =>
                      invoke("open_folder_in_explorer", {
                        folderPath: outputFolder,
                      }).catch(() => {})
                    }
                    className="px-4 py-2 text-sm rounded-xl text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors flex items-center gap-1.5"
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
                        d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                      />
                    </svg>
                    出力フォルダを開く
                  </button>
                );
              })()}
              <button
                onClick={closeModal}
                className="px-6 py-2.5 text-sm font-medium rounded-xl text-white bg-gradient-to-r from-accent to-accent-secondary shadow-glow-pink hover:-translate-y-0.5 transition-all duration-200"
              >
                閉じる
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
