import { useState, useMemo, useCallback, useEffect, type ReactNode } from "react";
import { usePsdStore } from "../../store/psdStore";
import { useTiffStore } from "../../store/tiffStore";
import { TiffResultDialog } from "./TiffResultDialog";
import { TiffPartialBlurModal } from "./TiffPartialBlurModal";
import { TiffPageRulesEditor } from "./TiffPageRulesEditor";
import { TiffAutoScanDialog } from "./TiffAutoScanDialog";
import { CropJsonLoadDialog } from "./TiffCropSidePanel";
import { useTiffProcessor } from "../../hooks/useTiffProcessor";
import { useCanvasSizeCheck } from "../../hooks/useCanvasSizeCheck";
import type { TiffColorMode, TiffCropPreset } from "../../types/tiff";
import type { LayerNode } from "../../types";

const ASPECT_W = 640;
const ASPECT_H = 909;
const ASPECT_RATIO = ASPECT_W / ASPECT_H;
const ASPECT_TOLERANCE = 0.01;

// --- Accordion Section ---
function Section({
  id,
  title,
  badge,
  openSections,
  toggle,
  children,
}: {
  id: string;
  title: string;
  badge?: ReactNode;
  openSections: Set<string>;
  toggle: (id: string) => void;
  children: ReactNode;
}) {
  const isOpen = openSections.has(id);
  return (
    <div className="bg-bg-tertiary rounded-lg">
      <button
        onClick={() => toggle(id)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left"
      >
        <svg
          className={`w-3 h-3 text-text-muted transition-transform duration-200 flex-shrink-0 ${isOpen ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <h4 className="text-xs font-medium text-text-secondary flex-1">{title}</h4>
        {badge}
      </button>
      {isOpen && <div className="px-3 pb-2">{children}</div>}
    </div>
  );
}

const DEFAULT_OPEN = new Set(["output", "colorBlur", "cropResize", "renameOutput"]);

export function TiffSettingsPanel() {
  const files = usePsdStore((state) => state.files);
  const selectedFileIds = usePsdStore((state) => state.selectedFileIds);
  const selectAll = usePsdStore((state) => state.selectAll);
  const clearSelection = usePsdStore((state) => state.clearSelection);

  const settings = useTiffStore((state) => state.settings);
  const setSettings = useTiffStore((state) => state.setSettings);
  const isProcessing = useTiffStore((state) => state.isProcessing);
  const progress = useTiffStore((state) => state.progress);
  const totalFiles = useTiffStore((state) => state.totalFiles);
  const currentFile = useTiffStore((state) => state.currentFile);
  const results = useTiffStore((state) => state.results);
  const setShowResultDialog = useTiffStore((state) => state.setShowResultDialog);
  const partialBlurEntries = useTiffStore((state) => state.settings.partialBlurEntries);
  const resizeLocked = useTiffStore((state) => state.resizeLocked);

  // Crop
  const cropBounds = useTiffStore((s) => s.settings.crop.bounds);
  const setCropBounds = useTiffStore((s) => s.setCropBounds);
  const pushCropHistory = useTiffStore((s) => s.pushCropHistory);
  const undoCropBounds = useTiffStore((s) => s.undoCropBounds);
  const redoCropBounds = useTiffStore((s) => s.redoCropBounds);
  const cropHistory = useTiffStore((s) => s.cropHistory);
  const cropFuture = useTiffStore((s) => s.cropFuture);
  const cropGuides = useTiffStore((s) => s.cropGuides);
  const clearCropGuides = useTiffStore((s) => s.clearCropGuides);
  const removeCropGuide = useTiffStore((s) => s.removeCropGuide);
  const selectedCropGuideIndex = useTiffStore((s) => s.selectedCropGuideIndex);
  const setSelectedCropGuideIndex = useTiffStore((s) => s.setSelectedCropGuideIndex);
  const applyCropGuidesToBounds = useTiffStore((s) => s.applyCropGuidesToBounds);
  const setCropStep = useTiffStore((s) => s.setCropStep);

  const { convertSelectedFiles, convertAllFiles } = useTiffProcessor();

  const hasResults = results.length > 0;
  const [showPartialBlurModal, setShowPartialBlurModal] = useState(false);
  const [showPageRulesEditor, setShowPageRulesEditor] = useState(false);
  const [showAutoScanDialog, setShowAutoScanDialog] = useState<"selected" | "all" | null>(null);
  const [showJsonLoadDialog, setShowJsonLoadDialog] = useState(false);
  const [blurDiffConfirm, setBlurDiffConfirm] = useState<{
    preset: TiffCropPreset;
    jsonPath?: string;
    jsonBlur: number;
    currentBlur: number;
  } | null>(null);
  const [canvasMismatch, setCanvasMismatch] = useState<{
    preset: TiffCropPreset;
    jsonPath?: string;
    jsonSize: { width: number; height: number };
    psdSize: { width: number; height: number };
  } | null>(null);

  const cropSourceJsonPath = useTiffStore((s) => s.cropSourceJsonPath);
  const loadCropPreset = useTiffStore((s) => s.loadCropPreset);
  const canvasSizeInfo = useCanvasSizeCheck();

  // Accordion
  const [openSections, setOpenSections] = useState<Set<string>>(() => new Set(DEFAULT_OPEN));
  const toggle = useCallback((id: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const dpiDisplay = useMemo(() => {
    if (settings.colorMode === "mono") return "600 dpi";
    if (settings.colorMode === "color") return "350 dpi";
    if (settings.colorMode === "perPage") return "600/350 dpi";
    return "変更なし";
  }, [settings.colorMode]);

  const ratioValid = useMemo(() => {
    if (!cropBounds) return null;
    const w = cropBounds.right - cropBounds.left;
    const h = cropBounds.bottom - cropBounds.top;
    const ratio = w / h;
    return Math.abs(ratio - ASPECT_RATIO) / ASPECT_RATIO <= ASPECT_TOLERANCE;
  }, [cropBounds]);

  const hGuideCount = cropGuides.filter((g) => g.direction === "horizontal").length;
  const vGuideCount = cropGuides.filter((g) => g.direction === "vertical").length;
  const canApplyGuides = hGuideCount >= 2 && vGuideCount >= 2;

  // PSD埋め込みガイドから自動範囲設定
  const referenceFileIndex = useTiffStore((s) => s.referenceFileIndex);
  const refIdx = Math.max(0, Math.min(referenceFileIndex - 1, files.length - 1));
  const refFile = files[refIdx] || null;

  const guideSource = useMemo(() => {
    if (refFile?.metadata?.guides && refFile.metadata.guides.length >= 2) return refFile;
    return files.find((f) => f.metadata?.guides && f.metadata.guides.length >= 2) || null;
  }, [refFile, files]);

  const psdGuides = guideSource?.metadata?.guides;
  const hasPsdGuides = !!(psdGuides && psdGuides.length >= 2);

  // デバッグ: ガイド検出状況
  useEffect(() => {
    if (files.length > 0) {
      console.log("[TiffSettingsPanel] PSD Guide Debug:", {
        totalFiles: files.length,
        refIdx,
        referenceFileIndex,
        hasPsdGuides,
        guideSource: guideSource?.fileName ?? "none",
        fileSamples: files.slice(0, 3).map((f) => ({
          name: f.fileName,
          hasMetadata: !!f.metadata,
          hasGuides: !!f.metadata?.hasGuides,
          guideCount: f.metadata?.guides?.length ?? 0,
        })),
      });
    }
  }, [files, refIdx, referenceFileIndex, hasPsdGuides, guideSource]);

  const handleAutoGuideSelect = useCallback(() => {
    if (!psdGuides || !guideSource?.metadata) return;
    const docWidth = guideSource.metadata.width ?? 0;
    const docHeight = guideSource.metadata.height ?? 0;
    if (!docWidth || !docHeight) return;

    const hPositions = psdGuides.filter((g) => g.direction === "horizontal").map((g) => g.position);
    const vPositions = psdGuides.filter((g) => g.direction === "vertical").map((g) => g.position);

    const getOptimalRange = (positions: number[], docSize: number): [number, number] | null => {
      const center = docSize / 2;
      const filtered = positions.filter((p) => Math.abs(p - center) > 1);
      const sorted = [...new Set(filtered.map((p) => Math.round(p)))].sort((a, b) => a - b);
      if (sorted.length < 2) return null;
      // 二重ガイド（4本以上）の場合は内側のペアを採用
      if (sorted.length >= 4) {
        return [sorted[1], sorted[sorted.length - 2]];
      }
      return [sorted[0], sorted[sorted.length - 1]];
    };

    const hRange = getOptimalRange(hPositions, docHeight);
    const vRange = getOptimalRange(vPositions, docWidth);

    if (!vRange && !hRange) return;

    let left = vRange ? vRange[0] : 0;
    let top = hRange ? hRange[0] : 0;
    let right = vRange ? vRange[1] : docWidth;
    let bottom = hRange ? hRange[1] : docHeight;

    // 640:909アスペクト比に調整（縦を維持、左上基点で横幅を調整）
    const height = bottom - top;
    const targetWidth = Math.round(height * (ASPECT_W / ASPECT_H));
    right = left + targetWidth;

    pushCropHistory();
    setCropBounds({ left, top, right, bottom });
  }, [psdGuides, guideSource, pushCropHistory, setCropBounds]);

  const colorModes: { mode: TiffColorMode; label: string }[] = [
    { mode: "mono", label: "モノクロ" },
    { mode: "color", label: "カラー" },
    { mode: "noChange", label: "維持" },
    { mode: "perPage", label: "個別" },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-2 border-b border-border flex items-center gap-2">
        <svg
          className="w-4 h-4 text-accent-warm"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
        <h3 className="text-sm font-display font-medium text-text-primary">TIFF化</h3>
        <span className="text-[10px] text-text-muted">Photoshopで一括変換</span>
      </div>

      {/* Scrollable settings */}
      <div className="flex-1 overflow-auto p-2 space-y-1.5">
        {/* ===== 出力形式 ===== */}
        <Section
          id="output"
          title="出力形式"
          openSections={openSections}
          toggle={toggle}
          badge={
            <span className="text-[10px] text-text-muted mr-1">
              {settings.output.proceedAsTiff && settings.output.outputJpg
                ? "TIFF + JPG"
                : settings.output.proceedAsTiff
                  ? "TIFF"
                  : settings.output.outputJpg
                    ? "JPG"
                    : "PSD"}
            </span>
          }
        >
          <div className="flex gap-2">
            <button
              onClick={() =>
                setSettings({
                  output: { ...settings.output, proceedAsTiff: !settings.output.proceedAsTiff },
                })
              }
              className={`
                flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200
                ${
                  settings.output.proceedAsTiff
                    ? "bg-accent-warm/15 border border-accent-warm/50 text-accent-warm shadow-sm"
                    : "bg-bg-elevated border border-border text-text-secondary hover:border-text-muted/30"
                }
              `}
            >
              <div className="font-medium">TIFF</div>
              <div className="text-[10px] opacity-60 mt-0.5">LZW圧縮</div>
            </button>
            <button
              onClick={() =>
                setSettings({
                  output: { ...settings.output, outputJpg: !settings.output.outputJpg },
                })
              }
              className={`
                flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200
                ${
                  settings.output.outputJpg
                    ? "bg-accent-warm/15 border border-accent-warm/50 text-accent-warm shadow-sm"
                    : "bg-bg-elevated border border-border text-text-secondary hover:border-text-muted/30"
                }
              `}
            >
              <div className="font-medium">JPG</div>
              <div className="text-[10px] opacity-60 mt-0.5">最高画質</div>
            </button>
          </div>
        </Section>

        {/* ===== カラーモード・ガウスぼかし ===== */}
        <Section
          id="colorBlur"
          title="カラーモード・ぼかし"
          openSections={openSections}
          toggle={toggle}
          badge={
            <div className="flex items-center gap-1.5 mr-1">
              <span className="text-[10px] text-text-muted">
                {settings.colorMode === "mono"
                  ? "モノクロ"
                  : settings.colorMode === "color"
                    ? "カラー"
                    : settings.colorMode === "perPage"
                      ? "個別"
                      : "維持"}
              </span>
              <span className="text-[10px] text-text-muted/40">|</span>
              <span
                className={`text-[10px] ${settings.blur.enabled ? "text-accent-warm" : "text-text-muted"}`}
              >
                {settings.blur.enabled ? `blur ${settings.blur.radius}px` : "blur OFF"}
              </span>
            </div>
          }
        >
          {/* カラーモード */}
          <label className="text-[10px] font-medium text-text-muted block mb-1">カラーモード</label>
          <div className="flex gap-0.5 bg-bg-elevated rounded-lg p-0.5">
            {colorModes.map(({ mode, label }) => (
              <button
                key={mode}
                onClick={() => setSettings({ colorMode: mode })}
                className={`
                  flex-1 px-2 py-1.5 text-[11px] rounded-md transition-all duration-200
                  ${
                    settings.colorMode === mode
                      ? "bg-accent-warm text-white shadow-sm font-medium"
                      : "text-text-secondary hover:text-text-primary"
                  }
                `}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-text-muted mt-1 px-0.5">
            {settings.colorMode === "mono"
              ? "Grayscale に変換 (600 dpi)"
              : settings.colorMode === "color"
                ? "RGB を維持/変換 (350 dpi)"
                : settings.colorMode === "noChange"
                  ? "カラーモードを維持"
                  : "ページ範囲ごとに個別指定"}
          </p>

          {/* 区切り線 */}
          <div className="my-2.5 border-t border-border/40" />

          {/* ガウスぼかし */}
          <label className="text-[10px] font-medium text-text-muted block mb-1">ガウスぼかし</label>
          <div className="flex gap-0.5 bg-bg-elevated rounded-lg p-0.5">
            <button
              onClick={() => setSettings({ blur: { ...settings.blur, enabled: false } })}
              className={`
                flex-1 px-2 py-1.5 text-[11px] rounded-md transition-all duration-200
                ${
                  !settings.blur.enabled
                    ? "bg-error/80 text-white shadow-sm font-medium"
                    : "text-text-secondary hover:text-text-primary"
                }
              `}
            >
              OFF
            </button>
            <button
              onClick={() => setSettings({ blur: { ...settings.blur, enabled: true } })}
              className={`
                flex-1 px-2 py-1.5 text-[11px] rounded-md transition-all duration-200
                ${
                  settings.blur.enabled
                    ? "bg-accent-warm text-white shadow-sm font-medium"
                    : "text-text-secondary hover:text-text-primary"
                }
              `}
            >
              ON
            </button>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <label className="text-xs text-text-secondary">半径:</label>
            <input
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={settings.blur.radius}
              disabled={!settings.blur.enabled}
              onChange={(e) =>
                setSettings({ blur: { ...settings.blur, radius: parseFloat(e.target.value) || 0 } })
              }
              className={`w-20 px-2 py-1.5 text-xs bg-bg-elevated border border-border/50 rounded-lg text-text-primary focus:outline-none focus:border-accent-warm/50 ${!settings.blur.enabled ? "opacity-40 cursor-not-allowed" : ""}`}
            />
            <span
              className={`text-xs text-text-muted ${!settings.blur.enabled ? "opacity-40" : ""}`}
            >
              px
            </span>
          </div>

          {/* ルールを編集（最下位・常時表示） */}
          <button
            onClick={() => setShowPageRulesEditor(true)}
            className="mt-2.5 w-full px-3 py-2 text-xs font-medium text-accent-warm bg-accent-warm/10 border border-accent-warm/30 rounded-lg hover:bg-accent-warm/20 transition-colors"
          >
            ルールを編集
            {settings.colorMode === "perPage" && ` (${settings.pageRangeRules.length}/3)`}
            {partialBlurEntries.length > 0 && ` ・部分ぼかし ${partialBlurEntries.length}P`}
          </button>
        </Section>

        {/* ===== クロップ・リサイズ ===== */}
        <Section
          id="cropResize"
          title="クロップ・リサイズ"
          openSections={openSections}
          toggle={toggle}
          badge={
            <div className="flex items-center gap-1 mr-1" onClick={(e) => e.stopPropagation()}>
              <span className="text-[10px] text-accent-warm font-medium">{dpiDisplay}</span>
              <div
                role="button"
                tabIndex={0}
                onClick={undoCropBounds}
                className={`p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors ${cropHistory.length === 0 ? "opacity-30 cursor-not-allowed pointer-events-none" : ""}`}
                title="元に戻す (Ctrl+Z)"
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
                    d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
                  />
                </svg>
              </div>
              <div
                role="button"
                tabIndex={0}
                onClick={redoCropBounds}
                className={`p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors ${cropFuture.length === 0 ? "opacity-30 cursor-not-allowed pointer-events-none" : ""}`}
                title="やり直す (Ctrl+Y)"
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
                    d="M21 10H11a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6"
                  />
                </svg>
              </div>
            </div>
          }
        >
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.crop.enabled}
                onChange={(e) =>
                  setSettings({ crop: { ...settings.crop, enabled: e.target.checked } })
                }
                className="rounded accent-accent-warm"
              />
              <span className="text-xs text-text-primary">クロップを適用</span>
              <span className="text-[10px] text-text-muted ml-auto">
                比率 {settings.crop.aspectRatio.w}:{settings.crop.aspectRatio.h}
              </span>
            </label>

            <>
              {/* 原稿サイズ一覧 */}
              {canvasSizeInfo.totalChecked > 0 &&
                (() => {
                  const jsonDocSize = useTiffStore.getState().cropSourceDocumentSize;
                  const jsonSizeStr = jsonDocSize
                    ? `${jsonDocSize.width}×${jsonDocSize.height}`
                    : null;
                  const hasJsonMismatch =
                    jsonSizeStr && jsonSizeStr !== canvasSizeInfo.majoritySize;
                  return (
                    <div className="px-2 py-1.5 bg-bg-elevated rounded-lg text-[10px]">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-text-muted font-medium">原稿サイズ</span>
                        {(canvasSizeInfo.outlierFileIds.size > 0 || hasJsonMismatch) && (
                          <span className="px-1.5 py-0.5 rounded bg-warning/10 text-warning text-[9px] font-medium">
                            {hasJsonMismatch
                              ? "JSON不一致"
                              : `${canvasSizeInfo.outlierFileIds.size}件 サイズ違い`}
                          </span>
                        )}
                      </div>

                      {/* JSONのdocumentSize表示 */}
                      {jsonDocSize && (
                        <div
                          className={`flex items-center gap-2 py-0.5 mb-1 px-1.5 rounded ${hasJsonMismatch ? "bg-warning/10" : "bg-success/5"}`}
                        >
                          <span className="text-[9px] text-text-muted">JSON:</span>
                          <span
                            className={`font-mono ${hasJsonMismatch ? "text-warning" : "text-success"}`}
                          >
                            {jsonDocSize.width}×{jsonDocSize.height}
                          </span>
                          {hasJsonMismatch && (
                            <span className="text-[8px] text-warning">≠ PSD</span>
                          )}
                          {!hasJsonMismatch && (
                            <span className="text-[8px] text-success">一致</span>
                          )}
                        </div>
                      )}

                      {[...canvasSizeInfo.sizeGroups.entries()].map(([size, ids]) => {
                        const isMajority = size === canvasSizeInfo.majoritySize;
                        const matchesJson = size === jsonSizeStr;
                        return (
                          <div
                            key={size}
                            className={`flex items-center gap-2 py-0.5 ${isMajority ? "" : "text-warning"}`}
                          >
                            <span className="font-mono text-text-primary">{size}</span>
                            <span className="text-text-muted">({ids.length}件)</span>
                            {isMajority && <span className="text-[8px] text-success">多数派</span>}
                            {matchesJson && !isMajority && (
                              <span className="text-[8px] text-accent-secondary">JSON一致</span>
                            )}
                            {!isMajority && (
                              <button
                                onClick={() => {
                                  for (const id of ids) {
                                    useTiffStore.getState().toggleFileSkip(id);
                                  }
                                }}
                                className="ml-auto text-[9px] text-text-muted hover:text-warning transition-colors"
                              >
                                スキップ切替
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

              {/* JSON読込 */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setShowJsonLoadDialog(true)}
                  className="flex-1 px-2.5 py-1.5 text-[11px] font-medium rounded-lg text-accent-secondary bg-accent-secondary/10 border border-accent-secondary/30 hover:bg-accent-secondary/20 transition-colors"
                >
                  JSONから読込
                </button>
                {cropSourceJsonPath && (
                  <span
                    className="text-[9px] text-text-muted truncate max-w-[140px]"
                    title={cropSourceJsonPath}
                  >
                    {cropSourceJsonPath
                      .split(/[\\/]/)
                      .pop()
                      ?.replace(/\.json$/, "")}
                  </span>
                )}
              </div>

              {/* Bounds editing */}
              {cropBounds ? (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    {ratioValid !== null && (
                      <span
                        className={`px-2 py-0.5 text-[10px] font-medium rounded ${
                          ratioValid ? "bg-success/10 text-success" : "bg-error/10 text-error"
                        }`}
                      >
                        {ratioValid ? "比率OK" : "比率NG"}
                      </span>
                    )}
                    <span className="text-[10px] text-text-muted">
                      サイズ:{" "}
                      <span className="font-mono text-accent-warm">
                        {cropBounds.right - cropBounds.left} x {cropBounds.bottom - cropBounds.top}
                      </span>
                    </span>
                    <button
                      onClick={() => {
                        pushCropHistory();
                        setCropBounds(null);
                        setCropStep("select");
                      }}
                      className="text-[10px] text-text-muted hover:text-error transition-colors"
                    >
                      クリア
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-text-muted/60 px-1">
                  範囲未設定 — プレビューでクリックして作成
                </p>
              )}

              {/* PSD Guide Auto-Select */}
              {files.length > 0 && (
                <button
                  onClick={handleAutoGuideSelect}
                  disabled={!hasPsdGuides}
                  className={`w-full mt-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                    hasPsdGuides
                      ? "text-accent-secondary bg-accent-secondary/10 border border-accent-secondary/30 hover:bg-accent-secondary/20"
                      : "text-text-muted/50 bg-bg-primary border border-transparent cursor-not-allowed"
                  }`}
                >
                  PSDガイドから自動設定
                  {hasPsdGuides ? (
                    <span className="ml-1 text-[10px] text-text-muted">
                      ({psdGuides!.length}本)
                    </span>
                  ) : (
                    <span className="ml-1 text-[10px] text-text-muted/40">(ガイド未検出)</span>
                  )}
                </button>
              )}

              {/* Guides */}
              {cropGuides.length > 0 && (
                <div className="space-y-1.5 pt-2 border-t border-border/30">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-text-muted font-medium">
                      ガイド ({cropGuides.length})
                    </span>
                    <button
                      onClick={clearCropGuides}
                      className="text-[10px] text-text-muted hover:text-error transition-colors"
                    >
                      全削除
                    </button>
                  </div>

                  {canApplyGuides && (
                    <button
                      onClick={applyCropGuidesToBounds}
                      className="w-full px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-accent-warm to-accent rounded-lg hover:-translate-y-0.5 transition-all shadow-sm"
                    >
                      ガイドから範囲を設定
                    </button>
                  )}

                  <div className="space-y-0.5 max-h-28 overflow-auto">
                    {cropGuides.map((guide, i) => (
                      <div
                        key={i}
                        className={`flex items-center gap-2 px-2 py-1 rounded-lg cursor-pointer text-xs transition-colors ${
                          selectedCropGuideIndex === i
                            ? "bg-accent-warm/15 border border-accent-warm/40"
                            : "hover:bg-bg-elevated border border-transparent"
                        }`}
                        onClick={() =>
                          setSelectedCropGuideIndex(selectedCropGuideIndex === i ? null : i)
                        }
                      >
                        <span className="text-accent-warm/70 font-mono w-4 text-center">
                          {guide.direction === "horizontal" ? "\u2500" : "\u2502"}
                        </span>
                        <span className="text-text-secondary font-mono flex-1">
                          {Math.round(guide.position)} px
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeCropGuide(i);
                          }}
                          className="text-text-muted/50 hover:text-error transition-colors p-0.5"
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
                              d="M6 18L18 6M6 6l12 12"
                            />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>

            {/* ===== リサイズ ===== */}
            <div className="pt-2 border-t border-border/40">
              <label className="text-[10px] font-medium text-text-muted block mb-1.5">
                リサイズ・解像度
              </label>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-[10px] text-text-muted block mb-1">幅 (px)</label>
                  <input
                    type="number"
                    value={settings.resize.targetWidth}
                    onChange={(e) =>
                      setSettings({
                        resize: {
                          ...settings.resize,
                          targetWidth: parseInt(e.target.value) || 1280,
                        },
                      })
                    }
                    disabled={resizeLocked}
                    className={`w-full px-2 py-1.5 text-xs bg-bg-elevated border border-border/50 rounded-lg text-text-primary focus:outline-none focus:border-accent-warm/50 font-mono ${resizeLocked ? "opacity-50 cursor-not-allowed" : ""}`}
                  />
                </div>
                <div className="flex flex-col items-center justify-end gap-0.5 pb-1">
                  <button
                    onClick={() => useTiffStore.getState().setResizeLocked(!resizeLocked)}
                    className={`p-1 rounded-md transition-colors hover:bg-bg-elevated ${resizeLocked ? "text-accent-warm" : "text-text-muted"}`}
                    title={resizeLocked ? "ロック解除" : "ロック"}
                  >
                    {resizeLocked ? (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                    ) : (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 9.9-1" />
                      </svg>
                    )}
                  </button>
                </div>
                <div className="flex-1">
                  <label className="text-[10px] text-text-muted block mb-1">高さ (px)</label>
                  <input
                    type="number"
                    value={settings.resize.targetHeight}
                    onChange={(e) =>
                      setSettings({
                        resize: {
                          ...settings.resize,
                          targetHeight: parseInt(e.target.value) || 1818,
                        },
                      })
                    }
                    disabled={resizeLocked}
                    className={`w-full px-2 py-1.5 text-xs bg-bg-elevated border border-border/50 rounded-lg text-text-primary focus:outline-none focus:border-accent-warm/50 font-mono ${resizeLocked ? "opacity-50 cursor-not-allowed" : ""}`}
                  />
                </div>
              </div>
            </div>
          </div>
        </Section>

        {/* ===== リネーム・出力先 ===== */}
        <Section
          id="renameOutput"
          title="リネーム・出力先"
          openSections={openSections}
          toggle={toggle}
          badge={
            <span className="text-[10px] text-text-muted mr-1">
              {settings.rename.keepOriginalName ? "維持" : "リネーム"}
            </span>
          }
        >
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer p-1.5 rounded-lg hover:bg-bg-elevated/50 transition-colors">
              <input
                type="checkbox"
                checked={settings.rename.keepOriginalName}
                onChange={(e) =>
                  setSettings({
                    rename: { ...settings.rename, keepOriginalName: e.target.checked },
                  })
                }
                className="rounded accent-accent-warm"
              />
              <div>
                <span className="text-xs text-text-primary">リネームしない</span>
                <p className="text-[10px] text-text-muted">
                  元のファイル名を維持（拡張子のみ変更）
                </p>
              </div>
            </label>

            {!settings.rename.keepOriginalName && (
              <>
                <label className="flex items-center gap-2 cursor-pointer p-1.5 rounded-lg hover:bg-bg-elevated/50 transition-colors">
                  <input
                    type="checkbox"
                    checked={settings.rename.extractPageNumber}
                    onChange={(e) =>
                      setSettings({
                        rename: { ...settings.rename, extractPageNumber: e.target.checked },
                      })
                    }
                    className="rounded accent-accent-warm"
                  />
                  <div>
                    <span className="text-xs text-text-primary">ファイル名からページ数を計算</span>
                    <p className="text-[10px] text-text-muted">末尾の数字をページ番号として使用</p>
                  </div>
                </label>

                <div className="flex gap-2 pl-1">
                  <div className="flex-1">
                    <label className="text-[10px] text-text-muted block mb-1">開始ページ番号</label>
                    <input
                      type="number"
                      min="0"
                      value={settings.rename.startNumber}
                      onChange={(e) =>
                        setSettings({
                          rename: {
                            ...settings.rename,
                            startNumber: parseInt(e.target.value) || 0,
                          },
                        })
                      }
                      className="w-full px-2 py-1.5 text-xs bg-bg-elevated border border-border/50 rounded-lg text-text-primary focus:outline-none focus:border-accent-warm/50 font-mono"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-[10px] text-text-muted block mb-1">ゼロ埋め桁数</label>
                    <input
                      type="number"
                      min="1"
                      max="8"
                      value={settings.rename.padding}
                      onChange={(e) =>
                        setSettings({
                          rename: { ...settings.rename, padding: parseInt(e.target.value) || 4 },
                        })
                      }
                      className="w-full px-2 py-1.5 text-xs bg-bg-elevated border border-border/50 rounded-lg text-text-primary focus:outline-none focus:border-accent-warm/50 font-mono"
                    />
                  </div>
                </div>

                {settings.includeSubfolders && (
                  <label className="flex items-center gap-2 cursor-pointer p-1.5 rounded-lg hover:bg-bg-elevated/50 transition-colors">
                    <input
                      type="checkbox"
                      checked={settings.rename.flattenSubfolders}
                      onChange={(e) =>
                        setSettings({
                          rename: { ...settings.rename, flattenSubfolders: e.target.checked },
                        })
                      }
                      className="rounded accent-accent-warm"
                    />
                    <div>
                      <span className="text-xs text-text-primary">サブフォルダを一括リネーム</span>
                      <p className="text-[10px] text-text-muted">フォルダ構造なしで通し番号出力</p>
                    </div>
                  </label>
                )}
              </>
            )}

            {/* 出力先 */}
            <div className="pt-2 border-t border-border/40 space-y-2">
              <label className="text-[10px] font-medium text-text-muted block">出力先</label>
              <div className="flex items-center gap-1.5">
                <div className="flex-1 px-2 py-1 text-xs bg-bg-elevated border border-border/50 rounded-lg text-text-secondary truncate font-mono">
                  {settings.output.outputDirectory
                    ? settings.output.outputDirectory.split(/[/\\]/).slice(-2).join("/")
                    : "Desktop/Script_Output"}
                </div>
                <button
                  onClick={async () => {
                    const { open } = await import("@tauri-apps/plugin-dialog");
                    const dir = await open({ directory: true });
                    if (dir)
                      setSettings({
                        output: { ...settings.output, outputDirectory: dir as string },
                      });
                  }}
                  className="px-2 py-1.5 text-xs text-text-secondary bg-bg-elevated border border-border/50 rounded-lg hover:bg-bg-elevated/80 transition-colors flex-shrink-0"
                >
                  変更
                </button>
                {settings.output.outputDirectory && (
                  <button
                    onClick={() =>
                      setSettings({ output: { ...settings.output, outputDirectory: null } })
                    }
                    className="text-[10px] text-text-muted hover:text-error transition-colors flex-shrink-0"
                  >
                    reset
                  </button>
                )}
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.output.saveIntermediatePsd}
                  onChange={(e) =>
                    setSettings({
                      output: { ...settings.output, saveIntermediatePsd: e.target.checked },
                    })
                  }
                  className="rounded accent-accent-warm"
                />
                <div>
                  <span className="text-xs text-text-primary">中間PSDを保存する</span>
                  <p className="text-[10px] text-text-muted">カラー変換後のPSDを別途保存</p>
                </div>
              </label>
              {settings.output.saveIntermediatePsd && (
                <label className="flex items-center gap-2 cursor-pointer pl-6">
                  <input
                    type="checkbox"
                    checked={settings.output.mergeAfterColorConvert}
                    onChange={(e) =>
                      setSettings({
                        output: { ...settings.output, mergeAfterColorConvert: e.target.checked },
                      })
                    }
                    className="rounded accent-accent-warm"
                  />
                  <div>
                    <span className="text-xs text-text-primary">画像レイヤーを統合する</span>
                    <p className="text-[10px] text-text-muted">*_merged.psd として保存</p>
                  </div>
                </label>
              )}

              {/* テキスト整理 */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.text.reorganize}
                  onChange={(e) =>
                    setSettings({ text: { ...settings.text, reorganize: e.target.checked } })
                  }
                  className="rounded accent-accent-warm"
                />
                <div>
                  <span className="text-xs text-text-primary">テキスト整理を行う</span>
                  <p className="text-[10px] text-text-muted">
                    散在するテキストレイヤーを1グループに統合
                  </p>
                </div>
              </label>
            </div>
          </div>
        </Section>

        {/* Processing Status */}
        {isProcessing && (
          <div className="bg-accent-warm/10 rounded-xl p-3 border border-accent-warm/30">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-4 h-4 rounded-full border-2 border-accent-warm/30 border-t-accent-warm animate-spin" />
              <span className="text-xs text-accent-warm font-medium">Photoshopで処理中...</span>
              <span className="text-[10px] text-text-muted ml-auto">
                {progress}/{totalFiles}
              </span>
            </div>
            {currentFile && (
              <p className="text-[10px] text-text-muted truncate mb-2">{currentFile}</p>
            )}
            <div className="bg-bg-elevated rounded-full h-1.5 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-accent-warm to-accent transition-all duration-300"
                style={{ width: `${totalFiles > 0 ? (progress / totalFiles) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}

        {/* Results */}
        {hasResults && !isProcessing && (
          <button
            onClick={() => setShowResultDialog(true)}
            className="w-full bg-gradient-to-r from-accent-warm/10 to-accent/5 rounded-xl p-3 border border-accent-warm/30 hover:border-accent-warm/50 transition-all text-left group"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <svg
                  className="w-4 h-4 text-accent-warm"
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
                <span className="text-xs font-medium text-text-primary">
                  処理完了 {results.filter((r) => r.success).length}/{results.length}
                </span>
              </div>
              <svg
                className="w-4 h-4 text-text-muted group-hover:text-accent-warm transition-colors"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </div>
            <p className="text-[10px] text-text-muted mt-1">クリックでレポートを表示</p>
          </button>
        )}

        <TiffResultDialog />
      </div>

      {/* Text Overflow Warning */}
      {(() => {
        const bounds = cropBounds;
        const cropOn = settings.crop.enabled;
        if (!cropOn || !bounds || files.length === 0) return null;

        const walkLayers = (nodes: LayerNode[]): string[] => {
          const names: string[] = [];
          for (const node of nodes) {
            if (node.type === "text" && node.visible && node.bounds) {
              const b = node.bounds;
              if (
                b.left < bounds.left ||
                b.top < bounds.top ||
                b.right > bounds.right ||
                b.bottom > bounds.bottom
              ) {
                names.push(node.name);
              }
            }
            if (node.children) names.push(...walkLayers(node.children));
          }
          return names;
        };

        let totalOverflows = 0;
        const overflowFiles: string[] = [];
        for (const file of files) {
          if (!file.metadata?.layerTree) continue;
          const overflows = walkLayers(file.metadata.layerTree);
          if (overflows.length > 0) {
            totalOverflows += overflows.length;
            overflowFiles.push(file.fileName);
          }
        }
        if (totalOverflows === 0) return null;

        return (
          <div className="mx-2 mb-1 px-3 py-2 rounded-lg bg-warning/10 border border-warning/30">
            <div className="flex items-center gap-1.5 text-warning text-[11px] font-medium">
              <svg
                className="w-4 h-4 flex-shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
              テキストはみ出し検出: {totalOverflows}件 ({overflowFiles.length}ファイル)
            </div>
            <div className="mt-1 text-[9px] text-text-muted leading-relaxed max-h-12 overflow-auto">
              {overflowFiles.slice(0, 5).join(", ")}
              {overflowFiles.length > 5 && ` 他${overflowFiles.length - 5}件`}
            </div>
          </div>
        );
      })()}

      {/* Action Bar */}
      <div className="px-2 py-2 border-t border-border space-y-1.5">
        {/* Quick file selection */}
        <div className="flex items-center gap-2 text-[10px]">
          <span className="text-text-muted">{files.length} ファイル</span>
          <button
            onClick={selectAll}
            className="text-text-muted hover:text-accent transition-colors"
          >
            全選択
          </button>
          {selectedFileIds.length > 0 && (
            <>
              <button
                onClick={clearSelection}
                className="text-text-muted hover:text-accent transition-colors"
              >
                解除
              </button>
              <span className="text-accent font-medium">{selectedFileIds.length}件選択中</span>
            </>
          )}
        </div>

        {isProcessing ? (
          <button
            disabled
            className="w-full px-4 py-3 text-sm font-medium rounded-xl text-white bg-gradient-to-r from-accent-warm to-accent opacity-80 cursor-not-allowed flex items-center justify-center gap-2"
          >
            <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
            処理中...
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => setShowAutoScanDialog("selected")}
              disabled={selectedFileIds.length === 0}
              className="flex-1 px-3 py-3 text-sm font-medium rounded-xl bg-bg-tertiary text-text-primary border border-accent-warm/40 hover:bg-accent-warm/10 hover:border-accent-warm/60 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
                />
              </svg>
              選択のみ ({selectedFileIds.length})
            </button>
            <button
              onClick={() => setShowAutoScanDialog("all")}
              disabled={files.length === 0}
              className="flex-1 px-3 py-3 text-sm font-medium rounded-xl text-white bg-gradient-to-r from-accent-warm to-accent shadow-[0_3px_12px_rgba(255,177,66,0.25)] hover:shadow-[0_5px_16px_rgba(255,177,66,0.35)] hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center gap-2"
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
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14"
                />
              </svg>
              全て実行 ({files.length})
            </button>
          </div>
        )}
        <div className="flex items-center justify-center text-[10px] text-text-muted">
          {settings.output.proceedAsTiff && settings.output.outputJpg
            ? "TIFF + JPG"
            : settings.output.proceedAsTiff
              ? "TIFF (LZW)"
              : settings.output.outputJpg
                ? "JPG"
                : "PSD"}{" "}
          ·{" "}
          {settings.colorMode === "mono"
            ? "モノクロ"
            : settings.colorMode === "color"
              ? "カラー"
              : settings.colorMode === "perPage"
                ? "個別"
                : "変更なし"}
        </div>
      </div>

      {/* Modals */}
      {showJsonLoadDialog && (
        <CropJsonLoadDialog
          onLoad={(preset, jsonPath) => {
            if (jsonPath) {
              useTiffStore.getState().setCropSourceJsonPath(jsonPath);
            }

            // キャンバスサイズ不一致チェック（参考スクリプト互換）
            const jsonDocSize = preset.documentSize;
            const psdMajority = canvasSizeInfo.majoritySize
              ? { width: canvasSizeInfo.majorityWidth, height: canvasSizeInfo.majorityHeight }
              : null;
            if (
              jsonDocSize &&
              psdMajority &&
              jsonDocSize.width > 0 &&
              jsonDocSize.height > 0 &&
              (jsonDocSize.width !== psdMajority.width || jsonDocSize.height !== psdMajority.height)
            ) {
              setCanvasMismatch({ preset, jsonPath, jsonSize: jsonDocSize, psdSize: psdMajority });
              setShowJsonLoadDialog(false);
              return;
            }

            // ぼかし値差異チェック（参考スクリプト互換）
            const currentBlur = settings.blur.enabled ? settings.blur.radius : 0;
            const jsonBlur = preset.blurRadius;
            if (jsonBlur !== undefined && jsonBlur !== currentBlur) {
              setBlurDiffConfirm({ preset, jsonPath, jsonBlur, currentBlur });
            } else {
              loadCropPreset(preset);
            }
            setShowJsonLoadDialog(false);
          }}
          onClose={() => setShowJsonLoadDialog(false)}
        />
      )}
      {blurDiffConfirm && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setBlurDiffConfirm(null);
          }}
        >
          <div className="bg-bg-secondary border border-border rounded-2xl shadow-xl max-w-sm w-full mx-4 p-5">
            <h3 className="text-sm font-display font-bold text-warning mb-3">
              ぼかし値の差異を検出
            </h3>
            <div className="space-y-1.5 text-xs text-text-secondary mb-4">
              <p>
                JSONに保存されたぼかし値:{" "}
                <span className="font-mono font-bold text-text-primary">
                  {blurDiffConfirm.jsonBlur} px
                </span>
              </p>
              <p>
                現在の設定値:{" "}
                <span className="font-mono font-bold text-text-primary">
                  {blurDiffConfirm.currentBlur} px
                </span>
              </p>
            </div>
            <p className="text-xs text-text-muted mb-4">JSONの値に合わせますか？</p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  // JSONのblurRadius値を採用
                  loadCropPreset(blurDiffConfirm.preset);
                  setBlurDiffConfirm(null);
                }}
                className="flex-1 px-3 py-2 text-xs font-medium rounded-xl text-white bg-gradient-to-r from-accent-warm to-accent hover:opacity-90 transition-opacity"
              >
                はい（JSON値に変更）
              </button>
              <button
                onClick={() => {
                  // 現在の設定値を維持してクロップ範囲だけ適用
                  const { blurRadius: _, ...presetWithoutBlur } = blurDiffConfirm.preset;
                  loadCropPreset(presetWithoutBlur);
                  setBlurDiffConfirm(null);
                }}
                className="flex-1 px-3 py-2 text-xs font-medium rounded-xl text-text-primary bg-bg-tertiary border border-border hover:bg-bg-elevated transition-colors"
              >
                いいえ（現在値を維持）
              </button>
            </div>
          </div>
        </div>
      )}
      {canvasMismatch && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-bg-secondary border border-border rounded-2xl shadow-xl max-w-md w-full mx-4 overflow-hidden">
            <div className="px-6 py-4 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-warning/10 flex items-center justify-center">
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
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-display font-bold text-text-primary">
                    キャンバスサイズの不一致
                  </h3>
                  <p className="text-[10px] text-text-muted">
                    JSONと読み込みPSDのサイズが異なります
                  </p>
                </div>
              </div>
            </div>
            <div className="px-6 py-4">
              <div className="flex items-center gap-4 justify-center mb-4">
                <div className="text-center">
                  <span className="text-[10px] text-text-muted block">JSONのサイズ</span>
                  <span className="text-sm font-mono text-text-primary">
                    {canvasMismatch.jsonSize.width} x {canvasMismatch.jsonSize.height}
                  </span>
                </div>
                <svg
                  className="w-4 h-4 text-warning"
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
                <div className="text-center">
                  <span className="text-[10px] text-text-muted block">PSD多数派サイズ</span>
                  <span className="text-sm font-mono text-error">
                    {canvasMismatch.psdSize.width} x {canvasMismatch.psdSize.height}
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                <button
                  onClick={() => {
                    // そのまま適用
                    loadCropPreset(canvasMismatch.preset);
                    setCanvasMismatch(null);
                  }}
                  className="w-full text-left px-4 py-2.5 rounded-xl border bg-bg-tertiary border-accent-warm/20 hover:border-accent-warm/40 hover:bg-accent-warm/5 transition-all"
                >
                  <span className="text-sm text-text-primary">そのまま適用</span>
                  <p className="text-[10px] text-text-muted">
                    現在の範囲でクロップを適用（推奨しません）
                  </p>
                </button>
                <button
                  onClick={() => {
                    // 別のラベルを選択
                    setCanvasMismatch(null);
                    setShowJsonLoadDialog(true);
                  }}
                  className="w-full text-left px-4 py-2.5 rounded-xl border bg-bg-tertiary border-accent-warm/20 hover:border-accent-warm/40 hover:bg-accent-warm/5 transition-all"
                >
                  <span className="text-sm text-text-primary">別のラベルを選択</span>
                  <p className="text-[10px] text-text-muted">JSONから別のプリセットを選択</p>
                </button>
                <button
                  onClick={() => setCanvasMismatch(null)}
                  className="w-full text-left px-4 py-2.5 rounded-xl border bg-bg-tertiary border-border/50 hover:border-text-muted/30 transition-all"
                >
                  <span className="text-sm text-text-primary">キャンセル</span>
                  <p className="text-[10px] text-text-muted">範囲を適用しない</p>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showPartialBlurModal && (
        <TiffPartialBlurModal onClose={() => setShowPartialBlurModal(false)} />
      )}
      {showPageRulesEditor && <TiffPageRulesEditor onClose={() => setShowPageRulesEditor(false)} />}
      {showAutoScanDialog && (
        <TiffAutoScanDialog
          mode={showAutoScanDialog}
          fileCount={showAutoScanDialog === "selected" ? selectedFileIds.length : files.length}
          onExecute={showAutoScanDialog === "selected" ? convertSelectedFiles : convertAllFiles}
          onClose={() => setShowAutoScanDialog(null)}
        />
      )}
    </div>
  );
}

// --- Sub-components ---
