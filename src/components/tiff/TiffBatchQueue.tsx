import { useState, useMemo } from "react";
import { usePsdStore } from "../../store/psdStore";
import { useTiffStore } from "../../store/tiffStore";
import { useCanvasSizeCheck } from "../../hooks/useCanvasSizeCheck";
import { usePsdLoader } from "../../hooks/usePsdLoader";
import { TiffPartialBlurModal } from "./TiffPartialBlurModal";
import type { TiffFileOverride, TiffCropBounds } from "../../types/tiff";

interface TiffBatchQueueProps {
  onSwitchToPreview?: () => void;
}

export function TiffBatchQueue({ onSwitchToPreview }: TiffBatchQueueProps) {
  const files = usePsdStore((state) => state.files);
  const selectedFileIds = usePsdStore((state) => state.selectedFileIds);
  const selectFile = usePsdStore((state) => state.selectFile);
  const selectRange = usePsdStore((state) => state.selectRange);
  const selectAll = usePsdStore((state) => state.selectAll);
  const clearSelection = usePsdStore((state) => state.clearSelection);
  const settings = useTiffStore((state) => state.settings);
  const setSettings = useTiffStore((state) => state.setSettings);
  const fileOverrides = useTiffStore((state) => state.fileOverrides);
  const droppedFolderPaths = usePsdStore((state) => state.droppedFolderPaths);
  const toggleFileSkip = useTiffStore((state) => state.toggleFileSkip);
  const setFileOverride = useTiffStore((state) => state.setFileOverride);
  const removeFileOverride = useTiffStore((state) => state.removeFileOverride);
  const setReferenceFileIndex = useTiffStore((state) => state.setReferenceFileIndex);
  const setPerFileEditTarget = useTiffStore((state) => state.setPerFileEditTarget);
  const results = useTiffStore((state) => state.results);
  const isProcessing = useTiffStore((state) => state.isProcessing);
  const currentFile = useTiffStore((state) => state.currentFile);

  const canvasSizeInfo = useCanvasSizeCheck();
  const { loadFolderWithSubfolders, loadFiles } = usePsdLoader();

  const [expandedFileId, setExpandedFileId] = useState<string | null>(null);
  const [partialBlurFileId, setPartialBlurFileId] = useState<string | null>(null);

  const handleRowClick = (fileId: string, e: React.MouseEvent) => {
    if (e.shiftKey) {
      selectRange(fileId);
    } else if (e.ctrlKey || e.metaKey) {
      selectFile(fileId, true);
    } else {
      selectFile(fileId);
    }
  };

  // ファイル毎の最終設定を計算
  const resolvedFiles = useMemo(() => {
    const flatten = settings.rename.flattenSubfolders;

    // サブフォルダ別インデックスを事前計算（flatten=false時に各サブフォルダで連番リセット）
    const subfolderIndices: number[] = [];
    if (!flatten) {
      const counters = new Map<string, number>();
      for (const file of files) {
        const key = file.subfolderName || "";
        const idx = counters.get(key) ?? 0;
        subfolderIndices.push(idx);
        counters.set(key, idx + 1);
      }
    }

    return files.map((file, index) => {
      const override = fileOverrides.get(file.id);
      const skip = override?.skip ?? false;

      // flatten=false時はサブフォルダ内インデックス、flatten=true時はグローバルインデックス
      const fileIndex = flatten ? index : subfolderIndices[index];

      // カラーモード解決
      let colorMode: string = settings.colorMode;
      if (settings.colorMode === "perPage") {
        const pageNum = fileIndex + 1;
        const matchedRule = settings.pageRangeRules.find(
          (r) => pageNum >= r.fromPage && pageNum <= r.toPage,
        );
        colorMode = matchedRule?.colorMode ?? settings.defaultColorForPerPage;
      }
      if (override?.colorMode && override.colorMode !== "perPage") {
        colorMode = override.colorMode;
      }

      // ぼかし解決（OFF時はradiusを0に強制）
      const blurEnabled = override?.blurEnabled ?? settings.blur.enabled;
      const blurRadius = blurEnabled ? (override?.blurRadius ?? settings.blur.radius) : 0;
      // ボタン群の選択状態用 raw 値
      const blurOverrideEnabled = override?.blurEnabled; // undefined=変更なし, true=ON, false=OFF
      const blurOverrideRadius = override?.blurRadius ?? settings.blur.radius; // raw半径（0強制なし）
      // 部分ぼかし件数: per-file override優先、なければグローバル設定から該当ページを確認
      const globalPageNum = flatten ? index + 1 : subfolderIndices[index] + 1;
      const hasGlobalPartialBlur =
        !override?.partialBlurEntries &&
        settings.partialBlurEntries.some(
          (e) => e.pageNumber === globalPageNum && (e.regions?.length ?? 0) > 0,
        );
      const blurPartialEntriesCount =
        override?.partialBlurEntries?.length ?? (hasGlobalPartialBlur ? 1 : 0);

      // クロップ範囲解決
      const cropBoundsOverride = override?.cropBounds;

      // リネーム解決
      const ext = settings.output.proceedAsTiff
        ? ".tif"
        : settings.output.outputJpg
          ? ".jpg"
          : ".psd";
      let outputName: string;
      if (settings.rename.keepOriginalName) {
        const baseName = file.fileName.replace(/\.[^.]+$/, "");
        outputName = baseName + ext;
      } else if (settings.rename.extractPageNumber) {
        const match = file.fileName.match(/(\d+)\s*\.[^.]+$/);
        const extractedNum = match ? parseInt(match[1]) : fileIndex + 1;
        const pageNum = extractedNum + (settings.rename.startNumber - 1);
        outputName = String(pageNum).padStart(settings.rename.padding, "0") + ext;
      } else {
        const pageNum = fileIndex + settings.rename.startNumber;
        outputName = String(pageNum).padStart(settings.rename.padding, "0") + ext;
      }

      // 処理結果
      const result = results.find((r) => r.fileName === file.fileName);

      // キャンバスサイズ
      const isOutlier = canvasSizeInfo.outlierFileIds.has(file.id);
      const canvasSize = file.metadata ? `${file.metadata.width}×${file.metadata.height}` : null;

      return {
        file,
        index,
        skip,
        colorMode,
        blurEnabled,
        blurRadius,
        blurOverrideEnabled,
        blurOverrideRadius,
        blurPartialEntriesCount,
        cropBoundsOverride,
        outputName,
        result,
        hasOverride:
          !!override &&
          (override.colorMode !== undefined ||
            override.blurEnabled !== undefined ||
            override.blurRadius !== undefined ||
            override.cropBounds !== undefined ||
            override.partialBlurEntries !== undefined),
        subfolderName: file.subfolderName,
        isOutlier,
        canvasSize,
      };
    });
  }, [files, fileOverrides, settings, results, canvasSizeInfo.outlierFileIds]);

  // 統計
  const stats = useMemo(() => {
    const active = resolvedFiles.filter((f) => !f.skip);
    return {
      total: resolvedFiles.length,
      active: active.length,
      skipped: resolvedFiles.length - active.length,
      mono: active.filter((f) => f.colorMode === "mono").length,
      color: active.filter((f) => f.colorMode === "color").length,
      outliers: resolvedFiles.filter((f) => f.isOutlier).length,
    };
  }, [resolvedFiles]);

  // サブフォルダ別ファイル数を計算
  const subfolderCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of resolvedFiles) {
      const key = item.subfolderName || "";
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }, [resolvedFiles]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-border flex items-center gap-3">
        <span className="text-xs font-medium text-text-primary">バッチキュー</span>
        <div className="flex items-center gap-2">
          <button
            onClick={selectAll}
            className="text-[10px] text-text-muted hover:text-accent transition-colors"
          >
            全選択
          </button>
          {selectedFileIds.length > 0 && (
            <>
              <button
                onClick={clearSelection}
                className="text-[10px] text-text-muted hover:text-accent transition-colors"
              >
                解除
              </button>
              <span className="text-[10px] text-accent font-medium">
                {selectedFileIds.length}件
              </span>
            </>
          )}
        </div>
        <div className="flex-1" />
        {stats.outliers > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/10 text-warning font-medium">
            サイズ相違 {stats.outliers}件
          </span>
        )}
        <span className="text-[10px] text-text-muted">
          {stats.active} 対象 / {stats.skipped > 0 && `${stats.skipped} スキップ / `}
          {stats.total} 合計
        </span>
        <label className="flex items-center gap-1 cursor-pointer ml-1">
          <input
            type="checkbox"
            checked={settings.includeSubfolders}
            onChange={async (e) => {
              const newVal = e.target.checked;
              setSettings({ includeSubfolders: newVal });
              if (droppedFolderPaths.length > 0) {
                if (newVal) {
                  await loadFolderWithSubfolders(droppedFolderPaths);
                } else {
                  const { readDir } = await import("@tauri-apps/plugin-fs");
                  const { isSupportedFile } = await import("../../types");
                  const imageFiles: string[] = [];
                  for (const fp of droppedFolderPaths) {
                    try {
                      const entries = await readDir(fp);
                      for (const entry of entries) {
                        if (entry.isFile && entry.name && isSupportedFile(entry.name)) {
                          imageFiles.push(`${fp}\\${entry.name}`);
                        }
                      }
                    } catch {
                      /* ignore */
                    }
                  }
                  if (imageFiles.length > 0) await loadFiles(imageFiles);
                }
              }
            }}
            className="rounded accent-accent-warm"
          />
          <span className="text-[10px] text-text-muted">サブフォルダ</span>
        </label>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="divide-y divide-border/50">
          {resolvedFiles.map((item, idx) => {
            // サブフォルダ区切りヘッダー
            const prevSubfolder = idx > 0 ? resolvedFiles[idx - 1].subfolderName || "" : null;
            const currentSubfolder = item.subfolderName || "";
            const showSubfolderHeader = currentSubfolder && prevSubfolder !== currentSubfolder;
            const fileCount = subfolderCounts.get(currentSubfolder) || 0;

            return (
              <div key={item.file.id}>
                {showSubfolderHeader && (
                  <SubfolderHeader name={currentSubfolder} fileCount={fileCount} />
                )}
                <QueueRow
                  item={item}
                  isSelected={selectedFileIds.includes(item.file.id)}
                  isCurrentProcessing={isProcessing && currentFile === item.file.fileName}
                  isExpanded={expandedFileId === item.file.id}
                  onRowClick={(e) => handleRowClick(item.file.id, e)}
                  onToggleSkip={() => toggleFileSkip(item.file.id)}
                  onToggleExpand={() =>
                    setExpandedFileId(expandedFileId === item.file.id ? null : item.file.id)
                  }
                  onSetOverride={(partial) => setFileOverride(item.file.id, partial)}
                  onResetOverride={() => removeFileOverride(item.file.id)}
                  onOpenCropEditor={() => {
                    setPerFileEditTarget(item.file.id);
                    setReferenceFileIndex(item.index + 1);
                    onSwitchToPreview?.();
                  }}
                  onOpenPartialBlurModal={() => setPartialBlurFileId(item.file.id)}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer Stats */}
      <div className="px-4 py-2 border-t border-border flex items-center gap-3 text-[10px] text-text-muted">
        {stats.mono > 0 && (
          <span className="px-1.5 py-0.5 rounded bg-bg-tertiary">Grayscale: {stats.mono}</span>
        )}
        {stats.color > 0 && (
          <span className="px-1.5 py-0.5 rounded bg-accent-tertiary/10 text-accent-tertiary">
            RGB: {stats.color}
          </span>
        )}
      </div>

      {/* ファイル別部分ぼかしモーダル */}
      {partialBlurFileId && (
        <TiffPartialBlurModal
          onClose={() => setPartialBlurFileId(null)}
          externalEntries={fileOverrides.get(partialBlurFileId)?.partialBlurEntries}
          onSave={(entries) =>
            setFileOverride(partialBlurFileId, {
              partialBlurEntries: entries.length > 0 ? entries : undefined,
            })
          }
        />
      )}
    </div>
  );
}

// --- Subfolder Header ---

function SubfolderHeader({ name, fileCount }: { name: string; fileCount: number }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-accent-warm/5 border-b border-accent-warm/20 sticky top-0 z-10">
      <svg
        className="w-3.5 h-3.5 text-accent-warm/60 flex-shrink-0"
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
      <span className="text-[11px] font-semibold text-accent-warm/80 truncate">{name}</span>
      <span className="text-[10px] text-accent-warm/50 flex-shrink-0">{fileCount}</span>
    </div>
  );
}

// --- Queue Row ---

interface QueueRowItem {
  file: { id: string; fileName: string; thumbnail?: string };
  index: number;
  skip: boolean;
  colorMode: string;
  blurEnabled: boolean;
  blurRadius: number;
  blurOverrideEnabled: boolean | undefined;
  blurOverrideRadius: number;
  blurPartialEntriesCount: number;
  cropBoundsOverride: TiffCropBounds | null | undefined;
  outputName: string;
  result?: { success: boolean; error?: string };
  hasOverride: boolean;
  subfolderName?: string;
  isOutlier: boolean;
  canvasSize: string | null;
}

function QueueRow({
  item,
  isSelected,
  isCurrentProcessing,
  isExpanded,
  onRowClick,
  onToggleSkip,
  onToggleExpand,
  onSetOverride,
  onResetOverride,
  onOpenCropEditor,
  onOpenPartialBlurModal,
}: {
  item: QueueRowItem;
  isSelected: boolean;
  isCurrentProcessing: boolean;
  isExpanded: boolean;
  onRowClick: (e: React.MouseEvent) => void;
  onToggleSkip: () => void;
  onToggleExpand: () => void;
  onSetOverride: (partial: Partial<TiffFileOverride>) => void;
  onResetOverride: () => void;
  onOpenCropEditor: () => void;
  onOpenPartialBlurModal: () => void;
}) {
  return (
    <div
      className={`
        ${item.skip ? "opacity-50" : ""}
        ${isSelected ? "bg-accent/5" : ""}
        ${isCurrentProcessing ? "bg-accent-warm/10" : ""}
      `}
    >
      {/* Main Row */}
      <div
        className="flex items-center gap-2 px-3 py-2 min-h-[44px] cursor-pointer"
        onClick={onRowClick}
      >
        {/* Skip Checkbox */}
        <input
          type="checkbox"
          checked={!item.skip}
          onChange={onToggleSkip}
          onClick={(e) => e.stopPropagation()}
          className="rounded accent-accent-warm flex-shrink-0"
          title="処理対象に含める"
        />

        {/* Thumbnail */}
        <div className="w-8 h-11 rounded bg-bg-tertiary flex-shrink-0 overflow-hidden flex items-center justify-center">
          {item.file.thumbnail ? (
            <img src={item.file.thumbnail} className="w-full h-full object-cover" alt="" />
          ) : (
            <svg
              className="w-4 h-4 text-text-muted/40"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14"
              />
            </svg>
          )}
        </div>

        {/* File Name → Output Name */}
        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          <span
            className="text-xs text-text-secondary truncate max-w-[140px]"
            title={item.file.fileName}
          >
            {item.file.fileName}
          </span>
          {/* サイズ相違バッジ */}
          {item.isOutlier && (
            <span
              className="flex-shrink-0 px-1 py-0.5 text-[9px] rounded bg-warning/15 text-warning font-medium cursor-pointer"
              title={`このファイルのキャンバスサイズが異なります: ${item.canvasSize}`}
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand();
              }}
            >
              ⚠
            </span>
          )}
          <svg
            className="w-3 h-3 text-text-muted/40 flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
          <span
            className="text-xs font-medium text-text-primary truncate max-w-[100px]"
            title={item.outputName}
          >
            {item.outputName}
          </span>
        </div>

        {/* Badges */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Color Mode Badge */}
          <span
            className={`
            px-1.5 py-0.5 text-[10px] font-medium rounded
            ${
              item.colorMode === "mono"
                ? "bg-bg-tertiary text-text-secondary"
                : item.colorMode === "color"
                  ? "bg-accent-tertiary/10 text-accent-tertiary"
                  : "bg-bg-tertiary text-text-muted"
            }
          `}
          >
            {item.colorMode === "mono" ? "Grayscale" : item.colorMode === "color" ? "RGB" : "—"}
          </span>

          {/* Blur Badge */}
          {item.blurEnabled && (
            <span className="px-1.5 py-0.5 text-[10px] rounded bg-accent-secondary/10 text-accent-secondary">
              {item.blurRadius}px
            </span>
          )}

          {/* Per-file Crop Badge */}
          {item.cropBoundsOverride !== undefined && (
            <span
              className={`px-1.5 py-0.5 text-[10px] rounded font-medium ${
                item.cropBoundsOverride === null
                  ? "bg-error/10 text-error"
                  : "bg-accent-warm/15 text-accent-warm"
              }`}
            >
              {item.cropBoundsOverride === null ? "クロップなし" : "個別範囲"}
            </span>
          )}

          {/* Result Status */}
          {item.result &&
            (item.result.success ? (
              <svg
                className="w-4 h-4 text-success"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg
                className="w-4 h-4 text-error"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ))}

          {/* Processing Spinner */}
          {isCurrentProcessing && (
            <div className="w-4 h-4 rounded-full border-2 border-accent-warm/30 border-t-accent-warm animate-spin" />
          )}
        </div>

        {/* Override Toggle */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand();
          }}
          className={`
            p-1 rounded-md transition-all flex-shrink-0
            ${
              item.hasOverride || item.isOutlier
                ? item.isOutlier && !item.hasOverride
                  ? "text-warning bg-warning/10"
                  : "text-accent-warm bg-accent-warm/10"
                : "text-text-muted/40 hover:text-text-muted hover:bg-bg-tertiary"
            }
          `}
          title="ファイル別設定"
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
              d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
            />
          </svg>
        </button>
      </div>

      {/* Expanded Override Panel */}
      {isExpanded && (
        <div className="px-3 pb-3 pt-0">
          <div
            className={`rounded-lg p-3 space-y-3 border ${
              item.isOutlier
                ? "bg-warning/5 border-warning/20"
                : "bg-bg-tertiary border-accent-warm/20"
            }`}
          >
            <div className="flex items-center justify-between">
              <span
                className={`text-[10px] font-medium ${item.isOutlier ? "text-warning" : "text-accent-warm"}`}
              >
                ファイル別上書き
              </span>
              {item.hasOverride && (
                <button
                  onClick={onResetOverride}
                  className="text-[10px] text-text-muted hover:text-error transition-colors"
                >
                  全リセット
                </button>
              )}
            </div>

            {/* サイズ相違の警告 */}
            {item.isOutlier && (
              <div className="flex items-start gap-2 px-2.5 py-2 bg-warning/10 rounded-lg">
                <svg
                  className="w-3.5 h-3.5 text-warning flex-shrink-0 mt-0.5"
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
                <div>
                  <p className="text-[10px] text-warning font-medium">
                    キャンバスサイズが異なります
                  </p>
                  <p className="text-[9px] text-warning/70 mt-0.5">
                    このファイルのサイズ: {item.canvasSize} —
                    個別のクロップ範囲を設定することを推奨します
                  </p>
                </div>
              </div>
            )}

            {/* Color Mode Override */}
            <div>
              <label className="text-[10px] text-text-muted block mb-1">カラーモード</label>
              <div className="flex gap-1">
                {(["mono", "color", "noChange"] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => onSetOverride({ colorMode: mode })}
                    className={`
                      flex-1 px-2 py-1 text-[10px] font-medium rounded-md transition-all
                      ${
                        item.colorMode === mode
                          ? "bg-accent-warm text-white"
                          : "bg-bg-elevated text-text-secondary hover:text-text-primary"
                      }
                    `}
                  >
                    {mode === "mono" ? "Mono" : mode === "color" ? "Color" : "変更なし"}
                  </button>
                ))}
              </div>
            </div>

            {/* Blur Override（カラーモードと同スタイルのボタン群） */}
            <div>
              <label className="text-[10px] text-text-muted block mb-1">ガウスぼかし</label>
              <div className="flex gap-1 mb-1.5">
                <button
                  onClick={() => onSetOverride({ blurEnabled: false })}
                  className={`flex-1 px-2 py-1 text-[10px] font-medium rounded-md transition-all ${
                    item.blurOverrideEnabled === false
                      ? "bg-error/80 text-white"
                      : "bg-bg-elevated text-text-secondary hover:text-text-primary"
                  }`}
                >
                  OFF
                </button>
                <button
                  onClick={() => onSetOverride({ blurEnabled: true })}
                  className={`flex-1 px-2 py-1 text-[10px] font-medium rounded-md transition-all ${
                    item.blurOverrideEnabled === true
                      ? "bg-accent-warm text-white"
                      : "bg-bg-elevated text-text-secondary hover:text-text-primary"
                  }`}
                >
                  ON
                </button>
                <button
                  onClick={() => onSetOverride({ blurEnabled: undefined })}
                  className={`flex-1 px-2 py-1 text-[10px] font-medium rounded-md transition-all ${
                    item.blurOverrideEnabled === undefined
                      ? "bg-accent-warm text-white"
                      : "bg-bg-elevated text-text-secondary hover:text-text-primary"
                  }`}
                >
                  変更なし
                </button>
              </div>
              {/* 半径入力（常時表示・OFFのみ無効） */}
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={item.blurOverrideRadius}
                  disabled={item.blurOverrideEnabled === false}
                  onChange={(e) => onSetOverride({ blurRadius: parseFloat(e.target.value) || 0 })}
                  className={`w-16 px-1.5 py-0.5 text-[10px] bg-bg-elevated border border-border/50 rounded text-text-primary focus:outline-none ${item.blurOverrideEnabled === false ? "opacity-40 cursor-not-allowed" : ""}`}
                />
                <span
                  className={`text-[10px] text-text-muted ${item.blurOverrideEnabled === false ? "opacity-40" : ""}`}
                >
                  px
                </span>
              </div>
              {/* 部分ぼかし設定ボタン */}
              <button
                disabled={item.blurOverrideEnabled === false}
                onClick={onOpenPartialBlurModal}
                className={`w-full flex items-center justify-center gap-1 px-2 py-1 text-[10px] font-medium rounded-md transition-all ${
                  item.blurOverrideEnabled === false
                    ? "opacity-40 cursor-not-allowed bg-bg-elevated text-text-muted"
                    : "bg-accent-secondary/10 text-accent-secondary hover:bg-accent-secondary/20"
                }`}
              >
                部分ぼかし設定
                {item.blurPartialEntriesCount > 0 && (
                  <span className="ml-0.5">({item.blurPartialEntriesCount})</span>
                )}
              </button>
            </div>

            {/* Crop Bounds Override */}
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <label className="text-[10px] text-text-muted">個別クロップ範囲:</label>
                <input
                  type="checkbox"
                  checked={item.cropBoundsOverride !== undefined}
                  onChange={(e) => {
                    if (e.target.checked) {
                      // 個別範囲を有効化: グローバル設定からコピー（nullの場合はデフォルト値を使用）
                      const globalBounds = useTiffStore.getState().settings.crop.bounds;
                      onSetOverride({
                        cropBounds: globalBounds ?? { left: 0, top: 0, right: 0, bottom: 0 },
                      });
                    } else {
                      // 個別範囲を無効化 (undefinedで削除)
                      onSetOverride({ cropBounds: undefined });
                    }
                  }}
                  className="rounded accent-accent-warm"
                />
              </div>

              {item.cropBoundsOverride !== undefined && (
                <div className="space-y-2">
                  {item.cropBoundsOverride === null ? (
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-error">
                        このファイルはクロップをスキップ
                      </span>
                      <button
                        onClick={() => {
                          const globalBounds = useTiffStore.getState().settings.crop.bounds;
                          onSetOverride({
                            cropBounds: globalBounds ?? { left: 0, top: 0, right: 0, bottom: 0 },
                          });
                        }}
                        className="text-[10px] text-text-muted hover:text-accent transition-colors"
                      >
                        範囲を設定
                      </button>
                    </div>
                  ) : (
                    <>
                      {/* L/T/R/B 数値入力 */}
                      <div className="grid grid-cols-2 gap-1.5">
                        {(["left", "top", "right", "bottom"] as const).map((key) => (
                          <div key={key} className="flex items-center gap-1">
                            <span className="text-[9px] text-text-muted w-6 flex-shrink-0 capitalize">
                              {key === "left"
                                ? "左"
                                : key === "top"
                                  ? "上"
                                  : key === "right"
                                    ? "右"
                                    : "下"}
                              :
                            </span>
                            <input
                              type="number"
                              min="0"
                              value={(item.cropBoundsOverride as TiffCropBounds)[key]}
                              onChange={(e) => {
                                const val = parseInt(e.target.value) || 0;
                                onSetOverride({
                                  cropBounds: {
                                    ...(item.cropBoundsOverride as TiffCropBounds),
                                    [key]: val,
                                  },
                                });
                              }}
                              className="flex-1 px-1.5 py-0.5 text-[10px] bg-bg-elevated border border-border/50 rounded text-text-primary focus:outline-none"
                            />
                          </div>
                        ))}
                      </div>

                      {/* 範囲サイズ表示 */}
                      {item.cropBoundsOverride && (
                        <p className="text-[9px] text-text-muted font-mono">
                          サイズ:{" "}
                          {(item.cropBoundsOverride as TiffCropBounds).right -
                            (item.cropBoundsOverride as TiffCropBounds).left}{" "}
                          ×{" "}
                          {(item.cropBoundsOverride as TiffCropBounds).bottom -
                            (item.cropBoundsOverride as TiffCropBounds).top}{" "}
                          px
                        </p>
                      )}
                    </>
                  )}

                  {/* クロップエディタで設定 / スキップ */}
                  <div className="flex gap-1.5">
                    <button
                      onClick={onOpenCropEditor}
                      className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-[10px] font-medium rounded-md bg-accent-warm/10 text-accent-warm hover:bg-accent-warm/20 transition-all"
                    >
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
                          d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
                        />
                      </svg>
                      エディタで設定
                    </button>
                    <button
                      onClick={() => onSetOverride({ cropBounds: null })}
                      className="px-2 py-1.5 text-[10px] rounded-md bg-bg-elevated text-text-muted hover:text-error transition-all"
                      title="このファイルのクロップをスキップ"
                    >
                      スキップ
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
