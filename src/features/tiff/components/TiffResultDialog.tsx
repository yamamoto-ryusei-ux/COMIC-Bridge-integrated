import { useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { useTiffStore } from "../tiffStore";
import { usePsdStore } from "../../../store/psdStore";
import { invoke } from "@tauri-apps/api/core";

export function TiffResultDialog() {
  const showResultDialog = useTiffStore((state) => state.showResultDialog);
  const setShowResultDialog = useTiffStore((state) => state.setShowResultDialog);
  const results = useTiffStore((state) => state.results);
  const lastOutputDir = useTiffStore((state) => state.lastOutputDir);
  const lastJpgOutputDir = useTiffStore((state) => state.lastJpgOutputDir);
  const processingDurationMs = useTiffStore((state) => state.processingDurationMs);
  const cropBounds = useTiffStore((state) => state.settings.crop.bounds);
  const autoScanJsonResult = useTiffStore((state) => state.autoScanJsonResult);
  const psdFolderPath = usePsdStore((state) => state.currentFolderPath);
  const psdFiles = usePsdStore((state) => state.files);

  // results の outputPath からユニークなサブフォルダを抽出（2つの場合のみKENBAN差分比較可能）
  const subfolderDirs = useMemo(() => {
    if (!lastOutputDir || results.length === 0) return [];
    const dirs = new Set<string>();
    for (const r of results) {
      if (!r.outputPath) continue;
      const parent = r.outputPath.replace(/\\/g, "/").replace(/\/[^/]+$/, "");
      const base = lastOutputDir.replace(/\\/g, "/");
      if (parent !== base && parent.startsWith(base + "/")) {
        dirs.add(parent);
      }
    }
    return [...dirs].sort();
  }, [results, lastOutputDir]);

  // PSD元フォルダ: currentFolderPathがなければファイルパスから導出
  const effectivePsdFolder = useMemo(() => {
    if (psdFolderPath) return psdFolderPath;
    if (psdFiles.length === 0) return null;
    // 個別ファイル選択時: 最初のファイルの親ディレクトリを使用
    const first = psdFiles[0].filePath;
    return first.replace(/[\\/][^\\/]+$/, "");
  }, [psdFolderPath, psdFiles]);

  // PSD-TIFF差分比較用: TIFF出力フォルダ（cropBoundsがある場合のみ有効）
  const tiffOutputDir = useMemo(() => {
    if (!effectivePsdFolder || !cropBounds || results.length === 0) return null;
    const successResults = results.filter((r) => r.success && r.outputPath);
    if (successResults.length === 0) return null;

    const dirs = new Set<string>();
    for (const r of successResults) {
      const parent = r.outputPath!.replace(/\\/g, "/").replace(/\/[^/]+$/, "");
      dirs.add(parent);
    }
    if (dirs.size === 1) return [...dirs][0];
    return lastOutputDir;
  }, [results, lastOutputDir, effectivePsdFolder, cropBounds]);

  const handleClose = useCallback(() => {
    setShowResultDialog(false);
    useTiffStore.getState().resetAfterConvert();
    usePsdStore.getState().clearFiles();
  }, [setShowResultDialog]);

  // メトリクスカーニング検出結果の集計（TIFF変換直前のPhotoshop解析）
  // hooks は early-return より前に配置
  const kerningSummary = useMemo(() => {
    const perFile: Array<{ fileName: string; layers: string[] }> = [];
    let totalLayers = 0;
    for (const r of results) {
      if (r.metricsKerningLayers && r.metricsKerningLayers.length > 0) {
        perFile.push({ fileName: r.fileName, layers: r.metricsKerningLayers });
        totalLayers += r.metricsKerningLayers.length;
      }
    }
    return { perFile, totalLayers };
  }, [results]);

  // リンクグループ フォントサイズ不整合集計
  const linkSummary = useMemo(() => {
    const perFile: Array<{ fileName: string; issues: NonNullable<(typeof results)[number]["linkGroupIssues"]> }> = [];
    let totalGroups = 0;
    for (const r of results) {
      if (r.linkGroupIssues && r.linkGroupIssues.length > 0) {
        perFile.push({ fileName: r.fileName, issues: r.linkGroupIssues });
        totalGroups += r.linkGroupIssues.length;
      }
    }
    return { perFile, totalGroups };
  }, [results]);

  if (!showResultDialog || results.length === 0) return null;

  const successCount = results.filter((r) => r.success).length;
  const errorCount = results.filter((r) => !r.success).length;
  const allSuccess = errorCount === 0;

  const durationStr = processingDurationMs
    ? processingDurationMs >= 60000
      ? `${Math.floor(processingDurationMs / 60000)}分${Math.round((processingDurationMs % 60000) / 1000)}秒`
      : `${Math.round(processingDurationMs / 1000)}秒`
    : null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          handleClose();
        }
      }}
    >
      <div className="bg-bg-secondary border border-border rounded-2xl shadow-xl max-w-lg w-full mx-4 max-h-[80vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center gap-3">
          <div
            className={`
            w-10 h-10 rounded-xl flex items-center justify-center
            ${allSuccess ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}
          `}
          >
            {allSuccess ? (
              <svg
                className="w-5 h-5"
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
            ) : (
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            )}
          </div>
          <div>
            <h3 className="text-base font-display font-bold text-text-primary">TIFF化完了</h3>
            <p className="text-xs text-text-muted">
              {successCount}/{results.length} 成功
              {errorCount > 0 && <span className="text-error ml-1">({errorCount} エラー)</span>}
              {durationStr && <span className="ml-2">({durationStr})</span>}
            </p>
          </div>
          <div className="flex-1" />
          <button
            onClick={() => {
              handleClose();
            }}
            className="p-1.5 text-text-muted hover:text-text-primary rounded-lg hover:bg-bg-tertiary transition-colors"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* メトリクスカーニング検出警告 */}
        {kerningSummary.perFile.length > 0 && (
          <div className="px-6 py-3 border-b border-border/50 bg-warning/8">
            <div className="flex items-start gap-2">
              <svg className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M4.93 19h14.14c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.2 16c-.77 1.33.19 3 1.73 3z" />
              </svg>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-warning">
                  メトリクスカーニング検出 ({kerningSummary.perFile.length}ファイル / {kerningSummary.totalLayers}レイヤー)
                </p>
                <p className="text-[10px] text-text-muted mb-1.5">
                  TIFF変換前のテキストで「メトリクス」カーニングが使用されていました（「オプティカル」または「0（手動）」が推奨）
                </p>
                <details className="text-[10px]">
                  <summary className="cursor-pointer text-warning hover:underline select-none">詳細を表示</summary>
                  <div className="mt-1.5 max-h-40 overflow-y-auto space-y-1 bg-bg-elevated rounded p-2 border border-border/30">
                    {kerningSummary.perFile.map((entry, i) => (
                      <div key={i} className="text-[10px]">
                        <div className="font-medium text-text-primary truncate">{entry.fileName}</div>
                        <ul className="ml-2 text-text-secondary space-y-0.5">
                          {entry.layers.slice(0, 20).map((layer, j) => (
                            <li key={j} className="truncate">• {layer}</li>
                          ))}
                          {entry.layers.length > 20 && (
                            <li className="text-text-muted">...他 {entry.layers.length - 20}件</li>
                          )}
                        </ul>
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            </div>
          </div>
        )}

        {/* リンクグループ フォントサイズ不整合警告 */}
        {linkSummary.perFile.length > 0 && (
          <div className="px-6 py-3 border-b border-border/50 bg-warning/8">
            <div className="flex items-start gap-2">
              <svg className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M4.93 19h14.14c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.2 16c-.77 1.33.19 3 1.73 3z" />
              </svg>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-warning">
                  リンクグループのフォントサイズ不整合 ({linkSummary.perFile.length}ファイル / {linkSummary.totalGroups}グループ)
                </p>
                <p className="text-[10px] text-text-muted mb-1.5">
                  リンク済みテキスト群のサイズが「同一」でも「ぴったり1:2」でもない構成になっています
                </p>
                <details className="text-[10px]">
                  <summary className="cursor-pointer text-warning hover:underline select-none">詳細を表示</summary>
                  <div className="mt-1.5 max-h-48 overflow-y-auto space-y-1.5 bg-bg-elevated rounded p-2 border border-border/30">
                    {linkSummary.perFile.map((entry, i) => (
                      <div key={i} className="text-[10px] border-b border-border/20 last:border-0 pb-1.5 last:pb-0">
                        <div className="font-medium text-text-primary truncate">{entry.fileName}</div>
                        {entry.issues.map((issue, j) => (
                          <div key={j} className="ml-2 mt-0.5">
                            <div className="flex items-center gap-1.5 text-text-secondary">
                              <span className="text-text-muted">Link #{issue.linkGroup}</span>
                              <span className="ml-auto text-warning font-medium">
                                比率 {issue.ratio.toFixed(3)}x（{issue.minSize}→{issue.maxSize}pt）
                              </span>
                            </div>
                            <ul className="ml-2 mt-0.5 space-y-0.5">
                              {issue.members.map((m, k) => (
                                <li key={k} className="flex items-center gap-1 text-text-secondary">
                                  <span className="text-text-muted">{m.fontSize}pt</span>
                                  <span className="text-text-muted/80 truncate">{m.layerName}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            </div>
          </div>
        )}

        {/* File List */}
        <div className="flex-1 overflow-auto">
          <div className="divide-y divide-border/30">
            {results.map((result, i) => (
              <div key={i} className="flex items-center gap-2.5 px-6 py-2.5">
                {result.success ? (
                  <svg
                    className="w-4 h-4 text-success flex-shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg
                    className="w-4 h-4 text-error flex-shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-text-primary truncate">{result.fileName}</p>
                    {result.success && result.colorMode && (
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span
                          className={`px-1.5 py-0.5 text-[9px] font-medium rounded ${
                            result.colorMode === "mono"
                              ? "bg-text-muted/15 text-text-secondary"
                              : "bg-accent/15 text-accent"
                          }`}
                        >
                          {result.colorMode === "mono" ? "モノクロ" : "カラー"}
                        </span>
                        {result.finalWidth != null && result.finalHeight != null && (
                          <span className="text-[10px] text-text-muted font-mono">
                            {result.finalWidth}x{result.finalHeight}
                          </span>
                        )}
                        {result.dpi != null && (
                          <span className="text-[10px] text-text-muted">{result.dpi}dpi</span>
                        )}
                      </div>
                    )}
                  </div>
                  {result.error && (
                    <p className="text-[10px] text-error truncate">{result.error}</p>
                  )}
                  {result.outputPath && (
                    <p className="text-[10px] text-text-muted truncate">{result.outputPath}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* JSON Auto-Scan Result */}
        {autoScanJsonResult && (
          <div className="px-6 py-3 border-t border-border/50 bg-bg-tertiary/30">
            <div className="flex items-center gap-2">
              {autoScanJsonResult.success ? (
                <svg
                  className="w-4 h-4 text-accent-secondary flex-shrink-0"
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
              ) : (
                <svg
                  className="w-4 h-4 text-warning flex-shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-text-primary">
                  {autoScanJsonResult.success ? "プリセットJSON 保存完了" : "プリセットJSON"}
                </p>
                {autoScanJsonResult.success && autoScanJsonResult.filePath && (
                  <p className="text-[10px] text-text-muted truncate">
                    {autoScanJsonResult.filePath.replace(/^.*[/\\]/, "")}
                  </p>
                )}
                {autoScanJsonResult.error && (
                  <p className="text-[10px] text-warning">{autoScanJsonResult.error}</p>
                )}
                {(autoScanJsonResult.fontCount != null ||
                  autoScanJsonResult.guideSetCount != null) && (
                  <p className="text-[10px] text-text-muted">
                    {autoScanJsonResult.fontCount != null &&
                      `フォント ${autoScanJsonResult.fontCount}種`}
                    {autoScanJsonResult.fontCount != null &&
                      autoScanJsonResult.guideSetCount != null &&
                      " · "}
                    {autoScanJsonResult.guideSetCount != null &&
                      `ガイドセット ${autoScanJsonResult.guideSetCount}件`}
                    {autoScanJsonResult.textLogSaved && " · テキストログ保存済"}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex justify-end gap-2">
          {subfolderDirs.length === 2 && (
            <button
              onClick={async () => {
                try {
                  await invoke("launch_kenban_diff", {
                    folderA: subfolderDirs[0],
                    folderB: subfolderDirs[1],
                    mode: "tiff",
                  });
                } catch (e) {
                  alert(`KENBAN起動エラー: ${e}`);
                }
              }}
              className="px-4 py-2 text-sm font-medium text-accent bg-accent/10 border border-accent/30 rounded-xl hover:bg-accent/20 transition-colors"
            >
              KENBANで差分比較
            </button>
          )}
          {tiffOutputDir && (
            <button
              onClick={async () => {
                try {
                  const successResults = results.filter((r) => r.success && r.outputPath);
                  const psdPaths = successResults
                    .map((r) => psdFiles.find((f) => f.fileName === r.fileName)?.filePath)
                    .filter((p): p is string => !!p);
                  const tiffPaths = successResults
                    .map((r) => r.outputPath)
                    .filter((p): p is string => !!p);

                  const jsonPayload: Record<string, unknown> = {
                    selectionRanges: [{ bounds: cropBounds }],
                  };
                  if (psdPaths.length > 0) jsonPayload.filesA = psdPaths;
                  if (tiffPaths.length > 0) jsonPayload.filesB = tiffPaths;

                  await invoke("launch_kenban_diff", {
                    folderA: effectivePsdFolder,
                    folderB: tiffOutputDir,
                    mode: "psd-tiff",
                    selectionJson: JSON.stringify(jsonPayload),
                  });
                } catch (e) {
                  alert(`KENBAN起動エラー: ${e}`);
                }
              }}
              className="px-4 py-2 text-sm font-medium text-accent bg-accent/10 border border-accent/30 rounded-xl hover:bg-accent/20 transition-colors"
            >
              KENBANで差分比較
            </button>
          )}
          {lastOutputDir && (
            <button
              onClick={async () => {
                try {
                  await invoke("open_folder_in_explorer", { folderPath: lastOutputDir });
                } catch {
                  /* ignore */
                }
              }}
              className="px-4 py-2 text-sm font-medium text-accent-warm bg-accent-warm/10 border border-accent-warm/30 rounded-xl hover:bg-accent-warm/20 transition-colors"
            >
              {lastJpgOutputDir ? "TIFフォルダを開く" : "出力フォルダを開く"}
            </button>
          )}
          {lastJpgOutputDir && (
            <button
              onClick={async () => {
                try {
                  await invoke("open_folder_in_explorer", { folderPath: lastJpgOutputDir });
                } catch {
                  /* ignore */
                }
              }}
              className="px-4 py-2 text-sm font-medium text-accent-warm bg-accent-warm/10 border border-accent-warm/30 rounded-xl hover:bg-accent-warm/20 transition-colors"
            >
              JPGフォルダを開く
            </button>
          )}
          <button
            onClick={() => {
              handleClose();
            }}
            className="px-4 py-2 text-sm font-medium text-text-primary bg-bg-tertiary rounded-xl hover:bg-bg-tertiary/80 transition-colors"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
