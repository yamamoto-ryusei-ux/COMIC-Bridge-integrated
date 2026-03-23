/**
 * TiffFileList — 設定とプレビューの間の原稿リスト
 * ・行クリック → プレビュー連動（referenceFileIndex更新）
 * ・スキップON/OFF チェックボックス
 * ・展開パネル: カラーモード / ガウスぼかし（同スタイルのボタン群）/ 個別クロップ設定
 */
import { useState } from "react";
import { usePsdStore } from "../../store/psdStore";
import { useTiffStore } from "../../store/tiffStore";
import { useCanvasSizeCheck } from "../../hooks/useCanvasSizeCheck";
import { usePsdLoader } from "../../hooks/usePsdLoader";
import { TiffPartialBlurModal } from "./TiffPartialBlurModal";
import type { TiffColorMode } from "../../types/tiff";

interface TiffFileListProps {
  onOpenCropEditor: (fileId: string, fileIndex: number) => void;
}

export function TiffFileList({ onOpenCropEditor }: TiffFileListProps) {
  const files = usePsdStore((state) => state.files);
  const selectedFileIds = usePsdStore((state) => state.selectedFileIds);
  const selectFile = usePsdStore((state) => state.selectFile);
  const selectRange = usePsdStore((state) => state.selectRange);

  const fileOverrides = useTiffStore((state) => state.fileOverrides);
  const toggleFileSkip = useTiffStore((state) => state.toggleFileSkip);
  const setFileOverride = useTiffStore((state) => state.setFileOverride);
  const setReferenceFileIndex = useTiffStore((state) => state.setReferenceFileIndex);
  const settings = useTiffStore((state) => state.settings);
  const setSettings = useTiffStore((state) => state.setSettings);
  const droppedFolderPaths = usePsdStore((state) => state.droppedFolderPaths);
  const { loadFolderWithSubfolders, loadFiles } = usePsdLoader();

  const { outlierFileIds } = useCanvasSizeCheck();
  const [expandedFileId, setExpandedFileId] = useState<string | null>(null);
  const [partialBlurFileId, setPartialBlurFileId] = useState<string | null>(null);

  const handleRowClick = (fileId: string, index: number, e: React.MouseEvent) => {
    if (e.shiftKey) {
      selectRange(fileId);
    } else if (e.ctrlKey || e.metaKey) {
      selectFile(fileId, true);
    } else {
      selectFile(fileId);
    }
    // プレビューを連動
    setReferenceFileIndex(index + 1);
  };

  return (
    <div className="flex flex-col h-full bg-bg-secondary select-none">
      {/* ヘッダー */}
      <div className="px-2.5 py-2 border-b border-border flex items-center gap-2 flex-shrink-0">
        <span className="text-[10px] font-medium text-text-muted">{files.length} ファイル</span>
        <label className="flex items-center gap-1 cursor-pointer">
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
        <div className="flex-1" />
        {outlierFileIds.size > 0 && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-warning/10 text-warning font-medium">
            ⚠ {outlierFileIds.size}件
          </span>
        )}
      </div>

      {/* リスト */}
      <div className="flex-1 overflow-auto">
        {files.map((file, index) => {
          const override = fileOverrides.get(file.id);
          const skip = override?.skip ?? false;
          const isOutlier = outlierFileIds.has(file.id);
          const hasCropOverride = override?.cropBounds !== undefined;
          const cropOverrideIsSkip = override?.cropBounds === null;
          const isSelected = selectedFileIds.includes(file.id);
          const isExpanded = expandedFileId === file.id;

          // raw オーバーライド値（ボタン選択状態の判定に使用）
          const colorOverride = override?.colorMode;
          const blurOverrideEnabled = override?.blurEnabled; // undefined/true/false
          const blurOverrideRadius = override?.blurRadius ?? settings.blur.radius;

          // 何らかのオーバーライドがあるか
          const hasAnyOverride = !!(
            colorOverride !== undefined ||
            blurOverrideEnabled !== undefined ||
            hasCropOverride
          );

          const canvasSize = file.metadata
            ? `${file.metadata.width}×${file.metadata.height}`
            : null;

          const prevSubfolder = index > 0 ? files[index - 1].subfolderName || "" : null;
          const currentSubfolder = file.subfolderName || "";
          const showSubfolderHeader = currentSubfolder && prevSubfolder !== currentSubfolder;

          return (
            <div key={file.id}>
              {/* サブフォルダヘッダー */}
              {showSubfolderHeader && (
                <div className="px-2.5 py-1 bg-accent-warm/5 border-b border-accent-warm/20 sticky top-0 z-10">
                  <span className="text-[9px] font-semibold text-accent-warm/70 truncate block">
                    {currentSubfolder}
                  </span>
                </div>
              )}

              {/* メイン行 */}
              <div
                className={`
                  group flex items-center gap-1 px-2 py-1.5
                  border-b border-border/30 cursor-pointer transition-colors
                  ${skip ? "opacity-40" : ""}
                  ${isSelected ? "bg-accent/8" : "hover:bg-bg-tertiary/50"}
                  ${isOutlier && !skip ? "border-l-2 border-l-warning/60" : "border-l-2 border-l-transparent"}
                `}
                onClick={(e) => handleRowClick(file.id, index, e)}
              >
                {/* スキップ切り替えチェックボックス */}
                <input
                  type="checkbox"
                  checked={!skip}
                  onChange={() => toggleFileSkip(file.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="rounded accent-accent-warm flex-shrink-0 w-3 h-3 cursor-pointer"
                  title={skip ? "処理対象に含める" : "スキップする"}
                />

                {/* ファイル名 + キャンバスサイズ（サイズ相違時のみ） */}
                <div className="flex-1 min-w-0">
                  <span
                    className={`text-[10px] truncate block leading-tight ${
                      skip ? "text-text-muted" : "text-text-primary"
                    }`}
                    title={file.fileName}
                  >
                    {file.fileName}
                  </span>
                  {isOutlier && canvasSize && (
                    <span className="text-[9px] text-warning/70 leading-tight block">
                      {canvasSize}
                    </span>
                  )}
                </div>

                {/* バッジ + 展開ボタン */}
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  {/* 個別クロップ設定済みドット */}
                  {hasCropOverride && (
                    <span
                      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        cropOverrideIsSkip ? "bg-error/70" : "bg-accent-warm"
                      }`}
                      title={
                        cropOverrideIsSkip ? "クロップスキップ設定済み" : "個別クロップ範囲設定済み"
                      }
                    />
                  )}

                  {/* 設定展開ボタン */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedFileId(isExpanded ? null : file.id);
                    }}
                    className={`
                      p-0.5 rounded transition-all
                      ${
                        isExpanded
                          ? "text-accent-warm bg-accent-warm/10"
                          : hasAnyOverride
                            ? "text-accent-warm/70 bg-accent-warm/5"
                            : "opacity-0 group-hover:opacity-100 text-text-muted hover:text-text-secondary"
                      }
                    `}
                    title="ファイル別設定"
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
                        d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
                      />
                    </svg>
                  </button>
                </div>
              </div>

              {/* 展開パネル: カラーモード / ガウスぼかし / クロップ */}
              {isExpanded && (
                <div className="px-2 pb-2 border-b border-border/50 bg-bg-tertiary/20">
                  <div className="rounded-md p-2 space-y-2.5 bg-bg-elevated border border-border/30 mt-1.5">
                    {/* ── カラーモード ── */}
                    <div>
                      <label className="text-[9px] font-medium text-text-muted block mb-1">
                        カラーモード
                      </label>
                      <div className="flex gap-0.5">
                        {(["mono", "color", "noChange"] as TiffColorMode[]).map((mode) => (
                          <button
                            key={mode}
                            onClick={() => setFileOverride(file.id, { colorMode: mode })}
                            className={`
                              flex-1 px-1 py-1 text-[9px] font-medium rounded transition-all
                              ${
                                colorOverride === mode
                                  ? "bg-accent-warm text-white"
                                  : "bg-bg-tertiary text-text-secondary hover:text-text-primary"
                              }
                            `}
                          >
                            {mode === "mono" ? "Mono" : mode === "color" ? "Color" : "—"}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* ── ガウスぼかし ── */}
                    <div>
                      <label className="text-[9px] font-medium text-text-muted block mb-1">
                        ガウスぼかし
                      </label>
                      {/* ON/OFF/変更なし ボタン群（カラーモードと同スタイル） */}
                      <div className="flex gap-0.5 mb-1.5">
                        <button
                          onClick={() => setFileOverride(file.id, { blurEnabled: false })}
                          className={`flex-1 px-1 py-1 text-[9px] font-medium rounded transition-all ${
                            blurOverrideEnabled === false
                              ? "bg-error/80 text-white"
                              : "bg-bg-tertiary text-text-secondary hover:text-text-primary"
                          }`}
                        >
                          OFF
                        </button>
                        <button
                          onClick={() => setFileOverride(file.id, { blurEnabled: true })}
                          className={`flex-1 px-1 py-1 text-[9px] font-medium rounded transition-all ${
                            blurOverrideEnabled === true
                              ? "bg-accent-warm text-white"
                              : "bg-bg-tertiary text-text-secondary hover:text-text-primary"
                          }`}
                        >
                          ON
                        </button>
                        <button
                          onClick={() => setFileOverride(file.id, { blurEnabled: undefined })}
                          className={`flex-1 px-1 py-1 text-[9px] font-medium rounded transition-all ${
                            blurOverrideEnabled === undefined
                              ? "bg-bg-elevated text-accent-warm border border-accent-warm/40"
                              : "bg-bg-tertiary text-text-secondary hover:text-text-primary"
                          }`}
                        >
                          —
                        </button>
                      </div>
                      {/* 半径入力（常時表示、OFFのみ無効化） */}
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={blurOverrideRadius}
                          disabled={blurOverrideEnabled === false}
                          onChange={(e) =>
                            setFileOverride(file.id, {
                              blurRadius: parseFloat(e.target.value) || 0,
                            })
                          }
                          className={`
                            flex-1 px-1.5 py-0.5 text-[9px] bg-bg-elevated border border-border/50
                            rounded text-text-primary focus:outline-none
                            ${blurOverrideEnabled === false ? "opacity-40 cursor-not-allowed" : ""}
                          `}
                        />
                        <span
                          className={`text-[9px] text-text-muted ${blurOverrideEnabled === false ? "opacity-40" : ""}`}
                        >
                          px
                        </span>
                      </div>
                      {/* 部分ぼかし設定ボタン */}
                      <button
                        disabled={blurOverrideEnabled === false}
                        onClick={(e) => {
                          e.stopPropagation();
                          setPartialBlurFileId(file.id);
                        }}
                        className={`w-full flex items-center justify-center gap-1 px-2 py-1 text-[9px] font-medium rounded transition-all ${
                          blurOverrideEnabled === false
                            ? "opacity-40 cursor-not-allowed bg-bg-tertiary text-text-muted"
                            : "bg-accent-secondary/10 text-accent-secondary hover:bg-accent-secondary/20"
                        }`}
                      >
                        部分ぼかし設定
                        {(override?.partialBlurEntries?.length ?? 0) > 0 && (
                          <span className="ml-0.5">({override!.partialBlurEntries!.length})</span>
                        )}
                      </button>
                    </div>

                    {/* ── クロップ範囲 ── */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[9px] font-medium text-text-muted">
                          クロップ範囲
                        </label>
                        {hasCropOverride && (
                          <span
                            className={`text-[9px] font-medium ${cropOverrideIsSkip ? "text-error" : "text-accent-warm"}`}
                          >
                            {cropOverrideIsSkip ? "スキップ" : "個別設定済み"}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenCropEditor(file.id, index);
                        }}
                        className="w-full flex items-center justify-center gap-1 px-2 py-1 text-[9px] font-medium rounded bg-accent-warm/10 text-accent-warm hover:bg-accent-warm/20 transition-all"
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
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {files.length === 0 && (
          <div className="flex items-center justify-center h-16 text-text-muted text-[10px]">
            ファイルなし
          </div>
        )}
      </div>

      {/* フッター */}
      {selectedFileIds.length > 0 && (
        <div className="px-2.5 py-1.5 border-t border-border flex-shrink-0">
          <span className="text-[10px] text-accent font-medium">
            {selectedFileIds.length} 件選択中
          </span>
        </div>
      )}

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
