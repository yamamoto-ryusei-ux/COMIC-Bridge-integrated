import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useScanPsdStore } from "../../../store/scanPsdStore";

export function GuideLinesTab() {
  const scanData = useScanPsdStore((s) => s.scanData);
  const selectedGuideIndex = useScanPsdStore((s) => s.selectedGuideIndex);
  const excludedGuideIndices = useScanPsdStore((s) => s.excludedGuideIndices);
  const setSelectedGuideIndex = useScanPsdStore((s) => s.setSelectedGuideIndex);
  const toggleExcludedGuide = useScanPsdStore((s) => s.toggleExcludedGuide);
  const selectionRanges = useScanPsdStore((s) => s.selectionRanges);
  const lastUsedLabel = useScanPsdStore((s) => s.lastUsedLabel);

  const [expandedRangeIndex, setExpandedRangeIndex] = useState<number | null>(null);
  const [isApplying, setIsApplying] = useState(false);

  if (!scanData) {
    return (
      <div className="text-center py-8">
        <p className="text-xs text-text-muted">スキャンデータがありません</p>
        <p className="text-[10px] text-text-muted mt-1">
          JSON読み込み時にscandataが見つからない場合は表示できません
        </p>
      </div>
    );
  }

  const guideSets = scanData.guideSets ?? [];
  const focusedIndex = selectedGuideIndex;
  const focusedSet = focusedIndex != null ? (guideSets[focusedIndex] ?? null) : null;

  function isValidTachikiri(gs: (typeof guideSets)[0]): boolean {
    if (!gs.docWidth || !gs.docHeight) return true;
    const centerX = gs.docWidth / 2;
    const centerY = gs.docHeight / 2;
    const tolerance = 1;

    let hasAbove = false,
      hasBelow = false;
    for (const h of gs.horizontal) {
      if (Math.abs(h - centerY) <= tolerance) continue;
      if (h < centerY) hasAbove = true;
      else hasBelow = true;
    }

    let hasLeft = false,
      hasRight = false;
    for (const v of gs.vertical) {
      if (Math.abs(v - centerX) <= tolerance) continue;
      if (v < centerX) hasLeft = true;
      else hasRight = true;
    }

    return hasAbove && hasBelow && hasLeft && hasRight;
  }

  const handleGuideApply = async () => {
    if (!focusedSet) return;

    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: "PSD/PSB",
            extensions: ["psd", "psb"],
          },
        ],
        title: "PSDファイルを選択",
      });

      if (!selected || typeof selected !== "string") return;

      setIsApplying(true);
      const settingsJson = JSON.stringify({
        filePath: selected,
        guides: {
          horizontal: [...focusedSet.horizontal],
          vertical: [...focusedSet.vertical],
        },
      });

      await invoke("run_photoshop_guide_apply", { settingsJson });
    } catch (error) {
      console.error("Failed to apply guides:", error);
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* ガイドセット一覧 */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <h4 className="text-[10px] font-bold text-text-secondary">ガイドセット</h4>
          <span className="text-[9px] font-bold text-accent-tertiary bg-accent-tertiary/10 px-2 py-0.5 rounded-full">
            {guideSets.length}
          </span>
        </div>
        {guideSets.length === 0 ? (
          <p className="text-xs text-text-muted text-center py-4 bg-bg-tertiary/30 rounded-xl border border-dashed border-border">
            ガイドが検出されませんでした
          </p>
        ) : (
          <div className="space-y-1">
            {guideSets.map((gs, i) => {
              const isSelected = selectedGuideIndex === i;
              const isExcluded = excludedGuideIndices.has(i);
              const valid = isValidTachikiri(gs);

              return (
                <button
                  key={i}
                  onClick={() => setSelectedGuideIndex(isSelected ? null : i)}
                  className={`
                    w-full text-left rounded-xl px-3 py-2 transition-all border
                    ${
                      isSelected
                        ? "bg-accent-tertiary/8 border-accent-tertiary/40 shadow-sm"
                        : isExcluded
                          ? "bg-bg-tertiary/30 border-transparent opacity-50"
                          : "bg-bg-tertiary/40 border-border/30 hover:border-accent-tertiary/30 hover:bg-bg-tertiary/60"
                    }
                  `}
                >
                  <div className="flex items-center gap-2">
                    {/* ステータス */}
                    <div
                      className={`w-5 h-5 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        isSelected
                          ? "bg-accent-tertiary/20"
                          : isExcluded
                            ? "bg-error/10"
                            : "bg-bg-primary"
                      }`}
                    >
                      {isSelected ? (
                        <svg
                          className="w-3 h-3 text-accent-tertiary"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={3}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      ) : isExcluded ? (
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
                      ) : (
                        <span className="w-1.5 h-1.5 rounded-full bg-text-muted/40" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-text-primary">
                          H:{gs.horizontal.length} V:{gs.vertical.length}
                        </span>
                        <span className="text-[9px] text-text-muted font-mono">
                          {gs.docWidth}×{gs.docHeight}
                        </span>
                        {!valid && (
                          <span className="text-[8px] font-bold text-warning bg-warning/10 px-1.5 py-0.5 rounded-full border border-warning/20">
                            非タチキリ
                          </span>
                        )}
                      </div>
                    </div>

                    {/* バッジ */}
                    {isSelected ? (
                      <span
                        className="text-[8px] font-bold text-white px-2 py-0.5 rounded-full flex-shrink-0"
                        style={{ background: "linear-gradient(135deg, #00c9a7, #5ce0c9)" }}
                      >
                        選択中
                      </span>
                    ) : isExcluded ? (
                      <span className="text-[8px] font-medium text-error/70 bg-error/8 px-2 py-0.5 rounded-full flex-shrink-0">
                        除外
                      </span>
                    ) : null}

                    <span className="text-[9px] text-text-muted flex-shrink-0 bg-bg-primary px-1.5 py-0.5 rounded">
                      {gs.count}p
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* 操作ボタン */}
        {guideSets.length > 0 && selectedGuideIndex != null && (
          <div className="flex gap-2 mt-2.5">
            {excludedGuideIndices.has(selectedGuideIndex) ? (
              <button
                onClick={() => toggleExcludedGuide(selectedGuideIndex)}
                className="flex-1 py-2 text-[10px] font-bold text-success bg-success/10 rounded-xl
                  hover:bg-success/20 border border-success/20 transition-all"
              >
                除外解除
              </button>
            ) : (
              <button
                onClick={() => toggleExcludedGuide(selectedGuideIndex)}
                className="flex-1 py-2 text-[10px] font-bold text-error bg-error/10 rounded-xl
                  hover:bg-error/20 border border-error/20 transition-all"
              >
                除外
              </button>
            )}
          </div>
        )}
      </div>

      {/* ガイド詳細 */}
      {focusedSet && (
        <div className="bg-bg-tertiary/40 rounded-xl p-3 border border-border/30 space-y-2.5">
          <div className="flex items-center gap-2">
            <h4 className="text-[10px] font-bold text-text-secondary">ガイド詳細</h4>
            {selectedGuideIndex === focusedIndex && (
              <span className="text-[8px] font-bold text-accent-tertiary bg-accent-tertiary/10 px-1.5 py-0.5 rounded-full">
                選択中
              </span>
            )}
          </div>
          <div>
            <span className="text-[10px] text-text-muted font-medium">
              水平ガイド ({focusedSet.horizontal.length}本)
            </span>
            <div className="flex flex-wrap gap-1 mt-1">
              {focusedSet.horizontal.map((h, i) => (
                <span
                  key={i}
                  className="text-[10px] text-guide-h bg-guide-h/8 px-1.5 py-0.5 rounded-lg border border-guide-h/15 font-mono"
                >
                  {h}px
                </span>
              ))}
            </div>
          </div>
          <div>
            <span className="text-[10px] text-text-muted font-medium">
              垂直ガイド ({focusedSet.vertical.length}本)
            </span>
            <div className="flex flex-wrap gap-1 mt-1">
              {focusedSet.vertical.map((v, i) => (
                <span
                  key={i}
                  className="text-[10px] text-guide-v bg-guide-v/8 px-1.5 py-0.5 rounded-lg border border-guide-v/15 font-mono"
                >
                  {v}px
                </span>
              ))}
            </div>
          </div>
          <div className="text-[10px] text-text-muted font-mono">
            ドキュメントサイズ: {focusedSet.docWidth} × {focusedSet.docHeight} px
          </div>
          <details>
            <summary className="text-[10px] text-accent cursor-pointer hover:text-accent-hover font-medium">
              使用ページ ({focusedSet.docNames.length}件)
            </summary>
            <div className="mt-1 space-y-0.5">
              {focusedSet.docNames.map((name, i) => (
                <div
                  key={i}
                  className="text-[9px] text-text-muted truncate pl-2 border-l-2 border-accent-tertiary/20"
                >
                  {name}
                </div>
              ))}
            </div>
          </details>

          {/* Photoshopで確認ボタン */}
          <button
            onClick={handleGuideApply}
            disabled={isApplying}
            className={`
              w-full py-2 text-[10px] font-bold rounded-xl border transition-all
              ${
                isApplying
                  ? "text-text-muted bg-bg-tertiary/60 border-border/30 cursor-not-allowed"
                  : "text-accent-secondary bg-accent-secondary/10 border-accent-secondary/20 hover:bg-accent-secondary/20"
              }
            `}
          >
            {isApplying ? (
              <span className="flex items-center justify-center gap-1.5">
                <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                適用中...
              </span>
            ) : (
              <span className="flex items-center justify-center gap-1.5">
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
                    d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7"
                  />
                </svg>
                Photoshopで確認
              </span>
            )}
          </button>
        </div>
      )}

      {/* タチキリ範囲選択ラベル */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <h4 className="text-[10px] font-bold text-text-secondary">タチキリ範囲選択ラベル</h4>
          <span className="text-[9px] font-bold text-accent-tertiary bg-accent-tertiary/10 px-2 py-0.5 rounded-full">
            {selectionRanges.length}
          </span>
        </div>
        {selectionRanges.length === 0 ? (
          <p className="text-xs text-text-muted text-center py-4 bg-bg-tertiary/30 rounded-xl border border-dashed border-border">
            範囲選択ラベルなし
          </p>
        ) : (
          <div className="space-y-1">
            {selectionRanges.map((range, i) => {
              const isExpanded = expandedRangeIndex === i;
              const isLastUsed = lastUsedLabel === range.label;

              return (
                <button
                  key={i}
                  onClick={() => setExpandedRangeIndex(isExpanded ? null : i)}
                  className={`
                    w-full text-left rounded-xl px-3 py-2 transition-all border
                    ${
                      isExpanded
                        ? "bg-accent/8 border-accent/40 shadow-sm"
                        : "bg-bg-tertiary/40 border-border/30 hover:border-accent/30 hover:bg-bg-tertiary/60"
                    }
                  `}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-5 h-5 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        isExpanded ? "bg-accent/20" : "bg-bg-primary"
                      }`}
                    >
                      {isExpanded ? (
                        <svg
                          className="w-3 h-3 text-accent"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={3}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      ) : (
                        <svg
                          className="w-3 h-3 text-text-muted/60"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={3}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      )}
                    </div>

                    <span className="text-xs font-medium text-text-primary flex-1 min-w-0 truncate">
                      {range.label}
                    </span>

                    {isLastUsed && (
                      <span className="flex items-center gap-0.5 text-[8px] font-bold text-warning bg-warning/10 px-1.5 py-0.5 rounded-full border border-warning/20 flex-shrink-0">
                        <svg
                          className="w-3 h-3 text-warning"
                          fill="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                        </svg>
                        最終使用
                      </span>
                    )}
                  </div>

                  {isExpanded && (
                    <div className="mt-2 pt-2 border-t border-border/20">
                      <div className="grid grid-cols-2 gap-1.5">
                        <div className="text-[9px] text-text-muted">
                          <span className="font-medium">Left:</span>{" "}
                          <span className="font-mono text-text-primary">{range.bounds.left}px</span>
                        </div>
                        <div className="text-[9px] text-text-muted">
                          <span className="font-medium">Top:</span>{" "}
                          <span className="font-mono text-text-primary">{range.bounds.top}px</span>
                        </div>
                        <div className="text-[9px] text-text-muted">
                          <span className="font-medium">Right:</span>{" "}
                          <span className="font-mono text-text-primary">
                            {range.bounds.right}px
                          </span>
                        </div>
                        <div className="text-[9px] text-text-muted">
                          <span className="font-medium">Bottom:</span>{" "}
                          <span className="font-mono text-text-primary">
                            {range.bounds.bottom}px
                          </span>
                        </div>
                      </div>
                      <div className="mt-1.5 text-[9px] text-text-muted font-mono">
                        {range.bounds.right - range.bounds.left} x{" "}
                        {range.bounds.bottom - range.bounds.top} px
                      </div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
