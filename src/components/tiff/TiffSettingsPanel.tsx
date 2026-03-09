import { useState, useMemo, useCallback, type ReactNode } from "react";
import { usePsdStore } from "../../store/psdStore";
import { useTiffStore } from "../../store/tiffStore";
import { TiffResultDialog } from "./TiffResultDialog";
import { TiffPartialBlurModal } from "./TiffPartialBlurModal";
import { TiffPageRulesEditor } from "./TiffPageRulesEditor";
import { TiffAutoScanDialog } from "./TiffAutoScanDialog";
import { useTiffProcessor } from "../../hooks/useTiffProcessor";
import { usePsdLoader } from "../../hooks/usePsdLoader";
import type { TiffColorMode } from "../../types/tiff";

const ASPECT_W = 640;
const ASPECT_H = 909;
const ASPECT_RATIO = ASPECT_W / ASPECT_H;
const ASPECT_TOLERANCE = 0.01;

// --- Accordion Section ---
function Section({ id, title, badge, openSections, toggle, children }: {
  id: string; title: string; badge?: ReactNode;
  openSections: Set<string>; toggle: (id: string) => void;
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
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
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

const DEFAULT_OPEN = new Set(["output", "color", "blur", "crop", "subfolder", "outputDir"]);

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
  const { loadFolderWithSubfolders, loadFiles } = usePsdLoader();
  const droppedFolderPaths = usePsdStore((state) => state.droppedFolderPaths);

  const hasResults = results.length > 0;
  const [showPartialBlurModal, setShowPartialBlurModal] = useState(false);
  const [showPageRulesEditor, setShowPageRulesEditor] = useState(false);
  const [showAutoScanDialog, setShowAutoScanDialog] = useState<"selected" | "all" | null>(null);

  // Accordion
  const [openSections, setOpenSections] = useState<Set<string>>(() => new Set(DEFAULT_OPEN));
  const toggle = useCallback((id: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
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
        <svg className="w-4 h-4 text-accent-warm" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <h3 className="text-sm font-display font-medium text-text-primary">TIFF化</h3>
        <span className="text-[10px] text-text-muted">Photoshopで一括変換</span>
      </div>

      {/* Scrollable settings */}
      <div className="flex-1 overflow-auto p-2 space-y-1.5">

        {/* ===== 出力形式 ===== */}
        <Section id="output" title="出力形式" openSections={openSections} toggle={toggle}
          badge={
            <span className="text-[10px] text-text-muted mr-1">
              {settings.output.proceedAsTiff && settings.output.outputJpg ? "TIFF + JPG"
                : settings.output.proceedAsTiff ? "TIFF"
                : settings.output.outputJpg ? "JPG" : "PSD"}
            </span>
          }
        >
          <div className="flex gap-2">
            <button
              onClick={() => setSettings({ output: { ...settings.output, proceedAsTiff: !settings.output.proceedAsTiff } })}
              className={`
                flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200
                ${settings.output.proceedAsTiff
                  ? "bg-accent-warm/15 border border-accent-warm/50 text-accent-warm shadow-sm"
                  : "bg-bg-elevated border border-border text-text-secondary hover:border-text-muted/30"
                }
              `}
            >
              <div className="font-medium">TIFF</div>
              <div className="text-[10px] opacity-60 mt-0.5">LZW圧縮</div>
            </button>
            <button
              onClick={() => setSettings({ output: { ...settings.output, outputJpg: !settings.output.outputJpg } })}
              className={`
                flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200
                ${settings.output.outputJpg
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

        {/* ===== カラーモード ===== */}
        <Section id="color" title="カラーモード" openSections={openSections} toggle={toggle}
          badge={
            <span className="text-[10px] text-text-muted mr-1">
              {settings.colorMode === "mono" ? "モノクロ" : settings.colorMode === "color" ? "カラー" : settings.colorMode === "perPage" ? "個別" : "維持"}
            </span>
          }
        >
          <div className="flex gap-0.5 bg-bg-elevated rounded-lg p-0.5">
            {colorModes.map(({ mode, label }) => (
              <button
                key={mode}
                onClick={() => setSettings({ colorMode: mode })}
                className={`
                  flex-1 px-2 py-1.5 text-[11px] rounded-md transition-all duration-200
                  ${settings.colorMode === mode
                    ? "bg-accent-warm text-white shadow-sm font-medium"
                    : "text-text-secondary hover:text-text-primary"
                  }
                `}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-text-muted mt-1.5 px-0.5">
            {settings.colorMode === "mono" ? "Grayscale に変換 (600 dpi)"
              : settings.colorMode === "color" ? "RGB を維持/変換 (350 dpi)"
              : settings.colorMode === "noChange" ? "カラーモードを維持"
              : "ページ範囲ごとに個別指定"
            }
          </p>
          {settings.colorMode === "perPage" && (
            <button
              onClick={() => setShowPageRulesEditor(true)}
              className="mt-2 w-full px-3 py-2 text-xs font-medium text-accent-warm bg-accent-warm/10 border border-accent-warm/30 rounded-lg hover:bg-accent-warm/20 transition-colors"
            >
              ルールを編集 ({settings.pageRangeRules.length}/3)
            </button>
          )}
        </Section>

        {/* ===== ガウスぼかし ===== */}
        <Section id="blur" title="ガウスぼかし" openSections={openSections} toggle={toggle}
          badge={
            <span className={`text-[10px] mr-1 ${settings.blur.enabled ? "text-accent-warm" : "text-text-muted"}`}>
              {settings.blur.enabled ? `${settings.blur.radius} px` : "OFF"}
            </span>
          }
        >
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.blur.enabled}
              onChange={(e) => setSettings({ blur: { ...settings.blur, enabled: e.target.checked } })}
              className="rounded accent-accent-warm"
            />
            <span className="text-xs text-text-primary">背景にぼかしを適用</span>
          </label>
          {settings.blur.enabled && (
            <div className="mt-2 space-y-1.5">
              <div className="flex items-center gap-2">
                <label className="text-xs text-text-secondary">半径:</label>
                <input
                  type="number" min="0" max="100" step="0.1"
                  value={settings.blur.radius}
                  onChange={(e) => setSettings({ blur: { ...settings.blur, radius: parseFloat(e.target.value) || 0 } })}
                  className="w-20 px-2 py-1.5 text-xs bg-bg-elevated border border-border/50 rounded-lg text-text-primary focus:outline-none focus:border-accent-warm/50"
                />
                <span className="text-xs text-text-muted">px</span>
              </div>
              <button
                onClick={() => setShowPartialBlurModal(true)}
                className="w-full px-3 py-1.5 text-xs text-text-secondary bg-bg-elevated border border-border/50 rounded-lg hover:bg-bg-elevated/80 transition-colors"
              >
                部分ぼかし設定 {partialBlurEntries.length > 0 && `(${partialBlurEntries.length}ページ)`}
              </button>
            </div>
          )}
        </Section>

        {/* ===== クロップ ===== */}
        <Section id="crop" title="クロップ範囲" openSections={openSections} toggle={toggle}
          badge={
            <div className="flex items-center gap-1 mr-1" onClick={(e) => e.stopPropagation()}>
              {settings.crop.enabled && (
                <>
                  <button
                    onClick={undoCropBounds}
                    disabled={cropHistory.length === 0}
                    className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    title="元に戻す (Ctrl+Z)"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                    </svg>
                  </button>
                  <button
                    onClick={redoCropBounds}
                    disabled={cropFuture.length === 0}
                    className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    title="やり直す (Ctrl+Y)"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 10H11a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" />
                    </svg>
                  </button>
                </>
              )}
            </div>
          }
        >
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.crop.enabled}
                onChange={(e) => setSettings({ crop: { ...settings.crop, enabled: e.target.checked } })}
                className="rounded accent-accent-warm"
              />
              <span className="text-xs text-text-primary">クロップを適用</span>
              <span className="text-[10px] text-text-muted ml-auto">比率 {settings.crop.aspectRatio.w}:{settings.crop.aspectRatio.h}</span>
            </label>

            {settings.crop.enabled && (
              <>
                {/* Bounds editing */}
                {cropBounds ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-text-muted font-medium">範囲</span>
                      {ratioValid !== null && (
                        <span className={`px-2 py-0.5 text-[10px] font-medium rounded ${
                          ratioValid ? "bg-success/10 text-success" : "bg-error/10 text-error"
                        }`}>
                          {ratioValid ? "比率OK" : "比率NG"}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <BoundsField label="L" value={cropBounds.left} onChange={(v) => { pushCropHistory(); setCropBounds({ ...cropBounds, left: v }); }} />
                      <BoundsField label="T" value={cropBounds.top} onChange={(v) => { pushCropHistory(); setCropBounds({ ...cropBounds, top: v }); }} />
                      <BoundsField label="R" value={cropBounds.right} onChange={(v) => { pushCropHistory(); setCropBounds({ ...cropBounds, right: v }); }} />
                      <BoundsField label="B" value={cropBounds.bottom} onChange={(v) => { pushCropHistory(); setCropBounds({ ...cropBounds, bottom: v }); }} />
                    </div>
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-text-muted">
                        サイズ: <span className="font-mono text-accent-warm">{cropBounds.right - cropBounds.left} x {cropBounds.bottom - cropBounds.top}</span>
                      </span>
                      <button
                        onClick={() => { pushCropHistory(); setCropBounds(null); setCropStep("select"); }}
                        className="text-text-muted hover:text-error transition-colors"
                      >
                        クリア
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-text-muted/60 px-1">範囲未設定 — プレビューでクリックして作成</p>
                )}

                {/* Guides */}
                {cropGuides.length > 0 && (
                  <div className="space-y-1.5 pt-2 border-t border-border/30">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-text-muted font-medium">ガイド ({cropGuides.length})</span>
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
                          onClick={() => setSelectedCropGuideIndex(selectedCropGuideIndex === i ? null : i)}
                        >
                          <span className="text-accent-warm/70 font-mono w-4 text-center">
                            {guide.direction === "horizontal" ? "\u2500" : "\u2502"}
                          </span>
                          <span className="text-text-secondary font-mono flex-1">
                            {Math.round(guide.position)} px
                          </span>
                          <button
                            onClick={(e) => { e.stopPropagation(); removeCropGuide(i); }}
                            className="text-text-muted/50 hover:text-error transition-colors p-0.5"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              </>
            )}
          </div>
        </Section>

        {/* ===== リサイズ ===== */}
        <Section id="resize" title="リサイズ・解像度" openSections={openSections} toggle={toggle}
          badge={<span className="text-[10px] text-accent-warm font-medium mr-1">{dpiDisplay}</span>}
        >
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-[10px] text-text-muted block mb-1">幅 (px)</label>
              <input
                type="number"
                value={settings.resize.targetWidth}
                onChange={(e) => setSettings({ resize: { ...settings.resize, targetWidth: parseInt(e.target.value) || 1280 } })}
                className="w-full px-2 py-1.5 text-xs bg-bg-elevated border border-border/50 rounded-lg text-text-primary focus:outline-none focus:border-accent-warm/50 font-mono"
              />
            </div>
            <div className="flex items-end pb-1 text-text-muted text-xs">x</div>
            <div className="flex-1">
              <label className="text-[10px] text-text-muted block mb-1">高さ (px)</label>
              <input
                type="number"
                value={settings.resize.targetHeight}
                onChange={(e) => setSettings({ resize: { ...settings.resize, targetHeight: parseInt(e.target.value) || 1818 } })}
                className="w-full px-2 py-1.5 text-xs bg-bg-elevated border border-border/50 rounded-lg text-text-primary focus:outline-none focus:border-accent-warm/50 font-mono"
              />
            </div>
          </div>
        </Section>

        {/* ===== テキスト整理 ===== */}
        <Section id="text" title="テキスト整理" openSections={openSections} toggle={toggle}
          badge={
            <span className={`text-[10px] mr-1 ${settings.text.reorganize ? "text-accent-warm" : "text-text-muted"}`}>
              {settings.text.reorganize ? "ON" : "OFF"}
            </span>
          }
        >
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.text.reorganize}
              onChange={(e) => setSettings({ text: { ...settings.text, reorganize: e.target.checked } })}
              className="rounded accent-accent-warm"
            />
            <div>
              <span className="text-xs text-text-primary">テキスト整理を行う</span>
              <p className="text-[10px] text-text-muted">散在するテキストレイヤーを1グループに統合</p>
            </div>
          </label>
        </Section>

        {/* ===== サブフォルダ ===== */}
        <Section id="subfolder" title="ファイル読み込み" openSections={openSections} toggle={toggle}
          badge={
            <span className={`text-[10px] mr-1 ${settings.includeSubfolders ? "text-accent-warm" : "text-text-muted"}`}>
              {settings.includeSubfolders ? "サブフォルダ含む" : "ルートのみ"}
            </span>
          }
        >
          <label className="flex items-center gap-2 cursor-pointer">
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
                      } catch { /* ignore */ }
                    }
                    if (imageFiles.length > 0) await loadFiles(imageFiles);
                  }
                }
              }}
              className="rounded accent-accent-warm"
            />
            <div>
              <span className="text-xs text-text-primary">サブフォルダも含める</span>
              <p className="text-[10px] text-text-muted">親フォルダ内のサブフォルダを1階層まで走査</p>
            </div>
          </label>
        </Section>

        {/* ===== リネーム ===== */}
        <Section id="rename" title="リネーム設定" openSections={openSections} toggle={toggle}
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
                onChange={(e) => setSettings({ rename: { ...settings.rename, keepOriginalName: e.target.checked } })}
                className="rounded accent-accent-warm"
              />
              <div>
                <span className="text-xs text-text-primary">リネームしない</span>
                <p className="text-[10px] text-text-muted">元のファイル名を維持（拡張子のみ変更）</p>
              </div>
            </label>

            {!settings.rename.keepOriginalName && (
              <>
                <label className="flex items-center gap-2 cursor-pointer p-1.5 rounded-lg hover:bg-bg-elevated/50 transition-colors">
                  <input
                    type="checkbox"
                    checked={settings.rename.extractPageNumber}
                    onChange={(e) => setSettings({ rename: { ...settings.rename, extractPageNumber: e.target.checked } })}
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
                      type="number" min="0"
                      value={settings.rename.startNumber}
                      onChange={(e) => setSettings({ rename: { ...settings.rename, startNumber: parseInt(e.target.value) || 0 } })}
                      className="w-full px-2 py-1.5 text-xs bg-bg-elevated border border-border/50 rounded-lg text-text-primary focus:outline-none focus:border-accent-warm/50 font-mono"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-[10px] text-text-muted block mb-1">ゼロ埋め桁数</label>
                    <input
                      type="number" min="1" max="8"
                      value={settings.rename.padding}
                      onChange={(e) => setSettings({ rename: { ...settings.rename, padding: parseInt(e.target.value) || 4 } })}
                      className="w-full px-2 py-1.5 text-xs bg-bg-elevated border border-border/50 rounded-lg text-text-primary focus:outline-none focus:border-accent-warm/50 font-mono"
                    />
                  </div>
                </div>

                {settings.includeSubfolders && (
                  <label className="flex items-center gap-2 cursor-pointer p-1.5 rounded-lg hover:bg-bg-elevated/50 transition-colors">
                    <input
                      type="checkbox"
                      checked={settings.rename.flattenSubfolders}
                      onChange={(e) => setSettings({ rename: { ...settings.rename, flattenSubfolders: e.target.checked } })}
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
          </div>
        </Section>

        {/* ===== 出力先・中間PSD ===== */}
        <Section id="outputDir" title="出力先" openSections={openSections} toggle={toggle}
          badge={
            <span className="text-[10px] text-text-muted font-mono mr-1 truncate max-w-[120px]">
              {settings.output.outputDirectory
                ? settings.output.outputDirectory.split(/[/\\]/).pop()
                : "Script_Output"}
            </span>
          }
        >
          <div className="space-y-2">
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
                  if (dir) setSettings({ output: { ...settings.output, outputDirectory: dir as string } });
                }}
                className="px-2 py-1.5 text-xs text-text-secondary bg-bg-elevated border border-border/50 rounded-lg hover:bg-bg-elevated/80 transition-colors flex-shrink-0"
              >
                変更
              </button>
              {settings.output.outputDirectory && (
                <button
                  onClick={() => setSettings({ output: { ...settings.output, outputDirectory: null } })}
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
                onChange={(e) => setSettings({ output: { ...settings.output, saveIntermediatePsd: e.target.checked } })}
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
                  onChange={(e) => setSettings({ output: { ...settings.output, mergeAfterColorConvert: e.target.checked } })}
                  className="rounded accent-accent-warm"
                />
                <div>
                  <span className="text-xs text-text-primary">画像レイヤーを統合する</span>
                  <p className="text-[10px] text-text-muted">*_merged.psd として保存</p>
                </div>
              </label>
            )}
          </div>
        </Section>

        {/* Processing Status */}
        {isProcessing && (
          <div className="bg-accent-warm/10 rounded-xl p-3 border border-accent-warm/30">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-4 h-4 rounded-full border-2 border-accent-warm/30 border-t-accent-warm animate-spin" />
              <span className="text-xs text-accent-warm font-medium">Photoshopで処理中...</span>
              <span className="text-[10px] text-text-muted ml-auto">{progress}/{totalFiles}</span>
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
                <svg className="w-4 h-4 text-accent-warm" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-xs font-medium text-text-primary">
                  処理完了 {results.filter((r) => r.success).length}/{results.length}
                </span>
              </div>
              <svg className="w-4 h-4 text-text-muted group-hover:text-accent-warm transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </div>
            <p className="text-[10px] text-text-muted mt-1">クリックでレポートを表示</p>
          </button>
        )}

        <TiffResultDialog />
      </div>

      {/* Action Bar */}
      <div className="px-2 py-2 border-t border-border space-y-1.5">
        {/* Quick file selection */}
        <div className="flex items-center gap-2 text-[10px]">
          <span className="text-text-muted">{files.length} ファイル</span>
          <button onClick={selectAll} className="text-text-muted hover:text-accent transition-colors">全選択</button>
          {selectedFileIds.length > 0 && (
            <>
              <button onClick={clearSelection} className="text-text-muted hover:text-accent transition-colors">解除</button>
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
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
              選択のみ ({selectedFileIds.length})
            </button>
            <button
              onClick={() => setShowAutoScanDialog("all")}
              disabled={files.length === 0}
              className="flex-1 px-3 py-3 text-sm font-medium rounded-xl text-white bg-gradient-to-r from-accent-warm to-accent shadow-[0_3px_12px_rgba(255,177,66,0.25)] hover:shadow-[0_5px_16px_rgba(255,177,66,0.35)] hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14" />
              </svg>
              全て実行 ({files.length})
            </button>
          </div>
        )}
        <div className="flex items-center justify-center text-[10px] text-text-muted">
          {settings.output.proceedAsTiff && settings.output.outputJpg ? "TIFF + JPG" : settings.output.proceedAsTiff ? "TIFF (LZW)" : settings.output.outputJpg ? "JPG" : "PSD"} · {settings.colorMode === "mono" ? "モノクロ" : settings.colorMode === "color" ? "カラー" : settings.colorMode === "perPage" ? "個別" : "変更なし"}
        </div>
      </div>

      {/* Modals */}
      {showPartialBlurModal && (
        <TiffPartialBlurModal onClose={() => setShowPartialBlurModal(false)} />
      )}
      {showPageRulesEditor && (
        <TiffPageRulesEditor onClose={() => setShowPageRulesEditor(false)} />
      )}
      {showAutoScanDialog && (
        <TiffAutoScanDialog
          mode={showAutoScanDialog}
          fileCount={showAutoScanDialog === "selected" ? selectedFileIds.length : files.length}
          onExecute={() => {
            if (showAutoScanDialog === "selected") convertSelectedFiles();
            else convertAllFiles();
          }}
          onClose={() => setShowAutoScanDialog(null)}
        />
      )}
    </div>
  );
}

// --- Sub-components ---

function BoundsField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-text-muted font-medium w-3">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value) || 0)}
        className="flex-1 px-2 py-1 text-xs font-mono bg-bg-elevated border border-border/50 rounded-lg text-text-primary focus:outline-none focus:border-accent-warm/50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
      />
    </div>
  );
}
