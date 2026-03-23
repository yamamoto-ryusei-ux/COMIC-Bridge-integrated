import { useState } from "react";
import type { PsdFile } from "../../types";
import { useSpecStore } from "../../store/specStore";

interface ThumbnailCardProps {
  file: PsdFile;
  size: number;
  isSelected: boolean;
  isActive: boolean;
  onClick: (e: React.MouseEvent) => void;
  isCanvasOutlier?: boolean;
  majoritySize?: string;
  isCaution?: boolean;
  cautionReasons?: string[];
}

// ルールタイプの日本語表示
const ruleTypeLabels: Record<string, string> = {
  colorMode: "カラーモード",
  dpi: "解像度",
  bitsPerChannel: "ビット深度",
  hasAlphaChannels: "αチャンネル",
  hasGuides: "ガイド",
};

export function ThumbnailCard({
  file,
  size: _size,
  isSelected,
  isActive,
  onClick,
  isCanvasOutlier,
  majoritySize,
  isCaution,
  cautionReasons,
}: ThumbnailCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const checkResults = useSpecStore((state) => state.checkResults);
  const checkResult = checkResults.get(file.id);
  const hasError = checkResult && !checkResult.passed;
  const isChecked = checkResult !== undefined;
  const isPassed = checkResult?.passed;

  // NG項目のルールタイプを取得
  const failedRuleTypes =
    checkResult?.results.filter((r) => !r.passed).map((r) => r.rule.type) || [];

  return (
    <div
      className={`
        group relative bg-bg-tertiary rounded-2xl overflow-hidden cursor-pointer select-none
        transition-all duration-200 shadow-card border border-border
        hover:-translate-y-1 hover:shadow-elevated
        ${
          isActive
            ? "ring-2 ring-accent shadow-glow-pink"
            : isSelected
              ? "ring-2 ring-accent/50 shadow-md"
              : "hover:ring-1 hover:ring-accent/30"
        }
        ${hasError ? "ring-2 ring-error shadow-glow-error" : ""}
        ${!hasError && isCaution ? "ring-2 ring-warning/60" : ""}
        ${isPassed && isChecked && !isCaution ? "ring-1 ring-success/30" : ""}
      `}
      style={{ aspectRatio: "1 / 1.4142" }} // A4/B5 aspect ratio
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Thumbnail Image */}
      <div className="absolute inset-0 flex items-center justify-center bg-bg-elevated">
        {file.thumbnailStatus === "loading" && (
          <div className="flex flex-col items-center gap-2">
            <div className="w-10 h-10 rounded-full border-3 border-accent/30 border-t-accent animate-spin" />
            <span className="text-xs text-text-muted">読み込み中...</span>
          </div>
        )}
        {file.thumbnailStatus === "error" && (
          <div className="text-error text-xs text-center p-4">
            <div className="w-12 h-12 mx-auto mb-2 rounded-xl bg-error/20 flex items-center justify-center">
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            読込エラー
          </div>
        )}
        {file.thumbnailStatus === "ready" && file.thumbnailUrl && (
          <img
            src={file.thumbnailUrl}
            alt={file.fileName}
            className="max-w-full max-h-full object-contain"
            draggable={false}
          />
        )}
        {file.thumbnailStatus === "pending" && (
          <div className="text-text-muted text-xs flex flex-col items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-bg-tertiary flex items-center justify-center">
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            待機中
          </div>
        )}
      </div>

      {/* Overlay with file info */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-3 pt-8">
        <p className="text-xs text-white font-medium truncate mb-1.5" title={file.fileName}>
          {file.fileName}
        </p>
        {file.metadata && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium ${
                failedRuleTypes.includes("colorMode")
                  ? "bg-error/30 text-error"
                  : file.metadata.colorMode === "RGB"
                    ? "bg-accent-tertiary/30 text-accent-tertiary"
                    : file.metadata.colorMode === "Grayscale"
                      ? "bg-white/20 text-white/80"
                      : "bg-manga-sky/30 text-manga-sky"
              }`}
            >
              {file.metadata.colorMode}
            </span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded-md ${
                failedRuleTypes.includes("dpi")
                  ? "bg-error/30 text-error font-medium"
                  : "text-white/70 bg-white/10"
              }`}
            >
              {file.metadata.dpi}dpi
            </span>
            {file.metadata.hasAlphaChannels ? (
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium ${
                  failedRuleTypes.includes("hasAlphaChannels")
                    ? "bg-error/30 text-error"
                    : "bg-warning/25 text-warning"
                }`}
              >
                α{file.metadata.alphaChannelCount}
              </span>
            ) : null}
            {file.metadata.hasGuides && (
              <span className="text-[10px] text-guide-v bg-guide-v/20 px-1.5 py-0.5 rounded-md">
                Guide
              </span>
            )}
            {file.metadata.hasTombo && (
              <span className="text-[10px] text-manga-peach bg-manga-peach/20 px-1.5 py-0.5 rounded-md">
                トンボ
              </span>
            )}
          </div>
        )}
      </div>

      {/* Selection Checkbox */}
      <div
        className={`
          absolute top-3 left-3 w-6 h-6 rounded-lg transition-all duration-200
          flex items-center justify-center
          ${
            isSelected
              ? "bg-gradient-to-br from-accent to-accent-secondary shadow-glow-pink"
              : "border-2 border-white/40 bg-black/40 opacity-0 group-hover:opacity-100"
          }
        `}
      >
        {isSelected && (
          <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        )}
      </div>

      {/* Caution Badges (stacked vertically) */}
      {(isCanvasOutlier || cautionReasons?.includes("tombo")) && (
        <div className="absolute top-10 left-3 flex flex-col gap-1">
          {isCanvasOutlier && (
            <div className="px-1.5 py-0.5 rounded-md bg-warning/90 text-white text-[9px] font-bold shadow-sm w-fit">
              サイズ異
            </div>
          )}
          {cautionReasons?.includes("tombo") && (
            <div className="px-1.5 py-0.5 rounded-md bg-warning/90 text-white text-[9px] font-bold shadow-sm w-fit">
              トンボなし？
            </div>
          )}
        </div>
      )}

      {/* Spec Check / Caution Indicator */}
      {hasError ? (
        <div className="absolute top-3 right-3 w-6 h-6 bg-error rounded-lg flex items-center justify-center shadow-lg animate-pulse">
          <span className="text-white text-xs font-bold">!</span>
        </div>
      ) : isCaution ? (
        <div className="absolute top-3 right-3 w-6 h-6 bg-warning rounded-lg flex items-center justify-center shadow-lg">
          <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
        </div>
      ) : isChecked && isPassed ? (
        <div className="absolute top-3 right-3 w-6 h-6 bg-success rounded-lg flex items-center justify-center shadow-lg">
          <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        </div>
      ) : file.fileChanged ? (
        <div
          className="absolute top-3 right-3 w-6 h-6 bg-accent-secondary rounded-lg flex items-center justify-center shadow-lg animate-pulse"
          title="ファイルが更新されました"
        >
          <svg
            className="w-3.5 h-3.5 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M2.985 19.644l3.182-3.182"
            />
          </svg>
        </div>
      ) : null}

      {/* NG Reason Overlay on Hover */}
      {hasError && isHovered && checkResult && (
        <div className="absolute inset-0 bg-black/85 flex flex-col items-center justify-center px-3 py-4 rounded-2xl z-10">
          <div className="text-error font-bold text-lg mb-3">NG</div>
          <div className="space-y-2 text-center w-full">
            {checkResult.results
              .filter((r) => !r.passed)
              .map((r, i) => (
                <div key={i} className="text-xs">
                  <div className="text-white/80">{ruleTypeLabels[r.rule.type] || r.rule.type}</div>
                  <div>
                    <span className="text-error font-medium">{String(r.actualValue)}</span>
                    <span className="text-white/50 mx-1">→</span>
                    <span className="text-success font-medium">{String(r.rule.value)}</span>
                  </div>
                </div>
              ))}
            {isCanvasOutlier && file.metadata && majoritySize && (
              <div className="text-xs">
                <div className="text-white/80">サイズ</div>
                <div>
                  <span className="text-warning font-medium">
                    {file.metadata.width}×{file.metadata.height}
                  </span>
                  <span className="text-white/50 mx-1">→</span>
                  <span className="text-white/70">{majoritySize}</span>
                </div>
              </div>
            )}
          </div>
          {checkResult.matchedSpec && (
            <div className="mt-3 text-[10px] text-white/50 truncate max-w-full">
              仕様: {checkResult.matchedSpec}
            </div>
          )}
        </div>
      )}

      {/* Caution Overlay on Hover (when no spec error but has caution) */}
      {!hasError && isCaution && isHovered && file.metadata && (
        <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center p-4 rounded-2xl z-10">
          <div className="text-warning font-bold text-base mb-3">要確認</div>
          <div className="space-y-2.5 text-center">
            {isCanvasOutlier && majoritySize && (
              <div>
                <div className="text-sm whitespace-nowrap">
                  <span className="text-white/80">サイズ:</span>
                  <span className="text-warning font-medium ml-1">
                    {file.metadata.width}×{file.metadata.height}
                  </span>
                </div>
                <div className="text-xs text-white/50 mt-1">
                  多数派: <span className="text-white/70">{majoritySize}</span>
                </div>
              </div>
            )}
            {cautionReasons?.includes("tombo") && (
              <div className="text-sm whitespace-nowrap">
                <span className="text-white/80">トンボ:</span>
                <span className="text-warning font-medium ml-1">なし？</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Active indicator glow */}
      {isActive && (
        <div className="absolute inset-0 pointer-events-none border-2 border-accent rounded-2xl" />
      )}
    </div>
  );
}
