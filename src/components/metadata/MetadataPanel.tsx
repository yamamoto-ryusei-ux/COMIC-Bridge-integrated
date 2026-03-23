import type { PsdFile } from "../../types";
import { LayerTree } from "./LayerTree";
import { useCanvasSizeCheck } from "../../hooks/useCanvasSizeCheck";

interface MetadataPanelProps {
  file: PsdFile;
}

export function MetadataPanel({ file }: MetadataPanelProps) {
  const { outlierFileIds, majoritySize } = useCanvasSizeCheck();
  const isCanvasOutlier = outlierFileIds.has(file.id);

  return (
    <div className="p-4 space-y-5">
      {file.metadata ? (
        <>
          {/* Color Mode & Bit Depth */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-bg-tertiary rounded-xl p-3">
              <h3 className="text-xs font-medium text-text-muted mb-2">カラーモード</h3>
              <span
                className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium ${
                  file.metadata.colorMode === "RGB"
                    ? "bg-accent-tertiary/20 text-accent-tertiary"
                    : file.metadata.colorMode === "Grayscale"
                      ? "bg-text-secondary/20 text-text-secondary"
                      : file.metadata.colorMode === "CMYK"
                        ? "bg-manga-sky/20 text-manga-sky"
                        : "bg-text-muted/20 text-text-muted"
                }`}
              >
                {file.metadata.colorMode}
              </span>
            </div>
            <div className="bg-bg-tertiary rounded-xl p-3">
              <h3 className="text-xs font-medium text-text-muted mb-2">ビット深度</h3>
              <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-manga-lavender/20 text-manga-lavender">
                {file.metadata.bitsPerChannel}bit
              </span>
            </div>
          </div>

          {/* Canvas Size */}
          <div
            className={`bg-bg-tertiary rounded-xl p-3 ${isCanvasOutlier ? "ring-1 ring-warning/50" : ""}`}
          >
            <h3 className="text-xs font-medium text-text-muted mb-2 flex items-center gap-1.5">
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
                  d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
                />
              </svg>
              キャンバスサイズ
            </h3>
            <div className="flex items-baseline gap-3">
              <p className="text-lg text-text-primary font-mono font-medium">
                {file.metadata.width} × {file.metadata.height}
              </p>
              <span className="text-xs text-text-muted">px</span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-md text-xs bg-manga-peach/20 text-manga-peach">
                {file.metadata.dpi} dpi
              </span>
            </div>
            {isCanvasOutlier && majoritySize && (
              <div className="mt-2 text-xs text-warning flex items-center gap-1.5">
                <svg className="w-3 h-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
                多数派サイズ: {majoritySize} と異なります
              </div>
            )}
          </div>

          {/* トンボ */}
          <div className="bg-bg-tertiary rounded-xl p-3">
            <h3 className="text-xs font-medium text-text-muted mb-2 flex items-center gap-1.5">
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
                  d="M4 4h4M4 4v4M20 4h-4M20 4v4M4 20h4M4 20v-4M20 20h-4M20 20v-4"
                />
              </svg>
              トンボ
            </h3>
            {file.metadata.hasTombo ? (
              <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-manga-peach/20 text-manga-peach">
                あり
              </span>
            ) : (
              <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-text-muted/20 text-text-muted">
                なし
              </span>
            )}
          </div>

          {/* Layer Tree */}
          <div>
            <h3 className="text-xs font-medium text-text-muted mb-2 flex items-center gap-1.5">
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
                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                />
              </svg>
              レイヤー
              <span className="px-1.5 py-0.5 rounded-md text-[10px] bg-accent/20 text-accent">
                {file.metadata.layerCount}
              </span>
            </h3>
            <div className="bg-bg-tertiary rounded-xl p-2 max-h-72 overflow-auto">
              <LayerTree layers={file.metadata.layerTree} />
            </div>
          </div>
        </>
      ) : file.thumbnailStatus === "loading" ? (
        <div className="flex flex-col items-center justify-center py-8">
          <div className="w-10 h-10 rounded-full border-3 border-accent/30 border-t-accent animate-spin mb-3" />
          <span className="text-sm text-text-muted">読み込み中...</span>
        </div>
      ) : file.thumbnailStatus === "error" ? (
        <div className="flex flex-col items-center justify-center py-8">
          <div className="w-12 h-12 rounded-xl bg-error/20 flex items-center justify-center mb-3">
            <svg className="w-6 h-6 text-error" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <span className="text-sm text-error font-medium">読み込みエラー</span>
          {file.error && <p className="text-xs text-text-muted mt-1 text-center">{file.error}</p>}
        </div>
      ) : null}
    </div>
  );
}
