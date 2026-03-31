import { useMemo, useEffect, useState, useRef, useCallback } from "react";
import { usePsdStore } from "../../store/psdStore";
import { useSpecStore } from "../../store/specStore";
import { useGuideStore } from "../../store/guideStore";
import { useSpecChecker } from "../../hooks/useSpecChecker";
import { usePhotoshopConverter } from "../../hooks/usePhotoshopConverter";
import { usePreparePsd } from "../../hooks/usePreparePsd";
import { usePhotoshopShortcut, useOpenInPhotoshop } from "../../hooks/useOpenInPhotoshop";
import { useOpenFolder } from "../../hooks/useOpenFolder";
import { useCanvasSizeCheck } from "../../hooks/useCanvasSizeCheck";
import { usePsdLoader } from "../../hooks/usePsdLoader";

import { usePageNumberCheck } from "../../hooks/usePageNumberCheck";
import { PreviewGrid } from "../preview/PreviewGrid";
import { MetadataPanel } from "../metadata/MetadataPanel";
import { FixGuidePanel } from "../spec-checker/FixGuidePanel";
import { GuideSectionPanel } from "../spec-checker/GuideSectionPanel";
import { SpecLayerGrid } from "../spec-checker/SpecLayerGrid";
// LayerSeparationPanel は隔離中 — 統合完了後に削除予定
// import { LayerSeparationPanel } from "../spec-checker/LayerSeparationPanel";
import { DropZone } from "../file-browser/DropZone";

import { THUMBNAIL_SIZES, type ThumbnailSize, type PsdFile, type SpecCheckResult } from "../../types";
import { invoke } from "@tauri-apps/api/core";
import { TextExtractButton } from "../common/TextExtractButton";
import { useHighResPreview } from "../../hooks/useHighResPreview";
import { detectPaperSize } from "../../lib/paperSize";
import { useViewStore, type AppView } from "../../store/viewStore";
import { useUnifiedViewerStore } from "../../store/unifiedViewerStore";

const DOT_MENU_TABS: { id: AppView; label: string }[] = [
  { id: "layers", label: "レイヤー制御" },
  { id: "typesetting", label: "写植関連" },
  { id: "replace", label: "差替え" },
  { id: "compose", label: "合成" },
  { id: "tiff", label: "TIFF化" },
  { id: "scanPsd", label: "スキャナー" },
  { id: "split", label: "見開き分割" },
  { id: "rename", label: "リネーム" },
  // kenban（検版）は隔離中 — 統合ビューアーに移行完了後に削除予定
  { id: "progen", label: "ProGen" },
  { id: "unifiedViewer", label: "ビューアー" },
];

export function SpecCheckView() {
  const files = usePsdStore((state) => state.files);
  const selectedFileIds = usePsdStore((state) => state.selectedFileIds);
  const thumbnailSize = usePsdStore((state) => state.thumbnailSize);
  const setThumbnailSize = usePsdStore((state) => state.setThumbnailSize);
  const activeFile = usePsdStore((state) => state.getActiveFile());

  const specifications = useSpecStore((state) => state.specifications);
  const activeSpecId = useSpecStore((state) => state.activeSpecId);
  const setActiveSpec = useSpecStore((state) => state.setActiveSpec);
  const selectSpecAndCheck = useSpecStore((state) => state.selectSpecAndCheck);
  const checkResults = useSpecStore((state) => state.checkResults);
  const conversionSettings = useSpecStore((state) => state.conversionSettings);
  const setConversionSettings = useSpecStore((state) => state.setConversionSettings);
  const conversionResults = useSpecStore((state) => state.conversionResults);
  const clearConversionResults = useSpecStore((state) => state.clearConversionResults);

  const guides = useGuideStore((state) => state.guides);
  const openEditor = useGuideStore((state) => state.openEditor);

  const [showResults, setShowResults] = useState(false);
  const [showGuidePrompt, setShowGuidePrompt] = useState(false);
  const viewMode = usePsdStore((s) => s.specViewMode);
  const setViewMode = usePsdStore((s) => s.setSpecViewMode);
  const [tachimiError, setTachimiError] = useState<string | null>(null);
  const [showPreviewPanel, setShowPreviewPanel] = useState(true);
  const [previewLocked, setPreviewLocked] = useState(false);
  const [expandedFile, setExpandedFile] = useState<typeof activeFile>(null);
  const [showDotMenu, setShowDotMenu] = useState(false);
  const dotMenuRef = useRef<HTMLDivElement>(null);

  // ドットメニュー: 外部クリックで閉じる
  useEffect(() => {
    if (!showDotMenu) return;
    const handler = (e: MouseEvent) => {
      if (dotMenuRef.current && !dotMenuRef.current.contains(e.target as Node)) {
        setShowDotMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showDotMenu]);
  const [sortMode, setSortMode] = useState<"name" | "name-desc" | "size" | "dpi" | "status">("name");
  const setActiveView = useViewStore((s) => s.setActiveView);
  const [lockedFile, setLockedFile] = useState<typeof activeFile>(null);
  const [lockedTextFile, setLockedTextFile] = useState<{ name: string; path: string; content: string } | null>(null);
  const expandedOverlayRef = useRef<HTMLDivElement>(null);

  // Selected text file
  const [selectedTextFile, setSelectedTextFile] = useState<{ name: string; path: string; content: string } | null>(null);

  // Address bar & explorer
  const currentFolderPath = usePsdStore((state) => state.currentFolderPath);
  const [folderContents, setFolderContents] = useState<{ folders: string[]; allFiles: string[] } | null>(null);
  const psdOnly = usePsdStore((s) => s.psdOnlyFilter);
  const setPsdOnly = usePsdStore((s) => s.setPsdOnlyFilter);
  // singleFolderDrop は現在未使用（将来フォルダ表示フィルタで使用予定）
  const { loadFolder } = usePsdLoader();

  const guidePromptRef = useRef<HTMLDivElement>(null);

  const { checkAllFiles, isChecking } = useSpecChecker();
  const { isPhotoshopInstalled, isConverting } = usePhotoshopConverter();
  const { isProcessing, prepareFiles } = usePreparePsd();
  const { openFileInPhotoshop } = useOpenInPhotoshop();
  const { openFolderForFile, revealFiles } = useOpenFolder();
  const { outlierFileIds } = useCanvasSizeCheck();
  usePageNumberCheck();

  usePhotoshopShortcut();

  // Load folder contents for explorer view (ALL files, not just PSD)
  const loadExplorerContents = useCallback(async (path: string) => {
    try {
      const r = await invoke<{ folders: string[]; json_files: string[] }>("list_folder_contents", { folderPath: path });
      // list_all_files returns ALL file names (not filtered by extension)
      const allFileNames = await invoke<string[]>("list_all_files", { folderPath: path });
      setFolderContents({ folders: r.folders.sort(), allFiles: allFileNames });
    } catch {
      setFolderContents({ folders: [], allFiles: [] });
    }
  }, []);

  // Load explorer on folder change
  useEffect(() => {
    if (currentFolderPath) loadExplorerContents(currentFolderPath);
  }, [currentFolderPath, loadExplorerContents]);

  const setCurrentFolderPath = usePsdStore((state) => state.setCurrentFolderPath);

  // Enter subfolder (single click)
  const handleEnterFolder = useCallback(async (folderName: string) => {
    if (!currentFolderPath) return;
    const newPath = `${currentFolderPath}\\${folderName}`;
    setCurrentFolderPath(newPath);
    usePsdStore.getState().setSingleFolderDrop(null); // アドレス移動でクリア
    await loadExplorerContents(newPath);
    try { await loadFolder(newPath); } catch { /* ignore */ }
  }, [currentFolderPath, loadFolder, loadExplorerContents, setCurrentFolderPath]);

  // Open file — text files open in-app, others with default app
  const handleOpenFile = useCallback(async (fileName: string) => {
    if (!currentFolderPath) return;
    const fullPath = `${currentFolderPath}\\${fileName}`;
    const ext = fileName.substring(fileName.lastIndexOf(".")).toLowerCase();
    // Text files: load content and show in center
    if (ext === ".txt") {
      try {
        const content = await invoke<string>("read_text_file", { filePath: fullPath });
        setSelectedTextFile({ name: fileName, path: fullPath, content });
      } catch { /* ignore */ }
      return;
    }
    // Other files: open with default app
    try {
      await invoke("open_with_default_app", { filePath: fullPath });
    } catch { /* ignore */ }
  }, [currentFolderPath]);

  // 前回選択した仕様を復元（SpecCheckViewマウント時のみ）
  const lastSelectedSpecId = useSpecStore((state) => state.lastSelectedSpecId);
  useEffect(() => {
    if (!activeSpecId && lastSelectedSpecId && files.length > 0) {
      selectSpecAndCheck(lastSelectedSpecId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // アクティブな仕様から変換設定を自動設定
  useEffect(() => {
    if (activeSpecId) {
      const activeSpec = specifications.find((s) => s.id === activeSpecId);
      if (activeSpec) {
        const newSettings: Partial<typeof conversionSettings> = {};
        for (const rule of activeSpec.rules) {
          if (rule.type === "colorMode" && rule.operator === "equals") {
            newSettings.targetColorMode = rule.value as "RGB" | "Grayscale";
          }
          if (rule.type === "bitsPerChannel" && rule.operator === "equals") {
            newSettings.targetBitDepth = rule.value as 8 | 16;
          }
          if (rule.type === "dpi" && rule.operator === "equals") {
            newSettings.targetDpi = rule.value as number;
          }
        }
        setConversionSettings(newSettings);
      }
    }
  }, [activeSpecId, specifications, setConversionSettings]);

  // ポップオーバー外クリックで閉じる
  useEffect(() => {
    if (!showGuidePrompt) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (guidePromptRef.current && !guidePromptRef.current.contains(e.target as Node)) {
        setShowGuidePrompt(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showGuidePrompt]);

  // 変換結果が追加されたらバナーを表示
  useEffect(() => {
    if (conversionResults.length > 0) {
      setShowResults(true);
    }
  }, [conversionResults.length]);

  // トンボ混在判定
  const hasTomboMix = useMemo(() => {
    let has = 0,
      no = 0;
    for (const file of files) {
      if (!file.metadata) continue;
      if (file.metadata.hasTombo) has++;
      else no++;
      if (has > 0 && no > 0) return true;
    }
    return false;
  }, [files]);

  const stats = useMemo(() => {
    let passed = 0;
    let failed = 0;
    let unchecked = 0;
    let noGuides = 0;
    let hasTombo = 0;
    let noTombo = 0;
    let caution = 0;
    files.forEach((file) => {
      const result = checkResults.get(file.id);
      const isNG = result && !result.passed;
      if (!result) unchecked++;
      else if (result.passed) passed++;
      else failed++;
      if (file.metadata) {
        if (!file.metadata.hasGuides) noGuides++;
        if (file.metadata.hasTombo) hasTombo++;
        else noTombo++;
      }
      // 注意判定: NGでない + (サイズ外れ値 OR トンボ混在でトンボなし)
      if (!isNG) {
        const isSizeOutlier = outlierFileIds.has(file.id);
        const isTomboMissing = hasTomboMix && file.metadata && !file.metadata.hasTombo;
        if (isSizeOutlier || isTomboMissing) caution++;
      }
    });
    return { passed, failed, unchecked, noGuides, hasTombo, noTombo, caution };
  }, [files, checkResults, outlierFileIds, hasTomboMix]);

  // 手動再チェック
  const handleRecheck = () => {
    const enabledSpecs = specifications.filter((s) => s.enabled);
    if (enabledSpecs.length > 0) {
      checkAllFiles(enabledSpecs);
    }
  };

  // Tachimi起動（PDF化連携）
  const handleLaunchTachimi = async () => {
    setTachimiError(null);
    try {
      const filePaths = files.map((f) => f.filePath).filter(Boolean);
      if (filePaths.length === 0) return;
      await invoke("launch_tachimi", { filePaths });
    } catch (e) {
      setTachimiError(String(e));
    }
  };

  // 変換結果の集計
  const resultStats = useMemo(() => {
    if (conversionResults.length === 0) return null;
    const successCount = conversionResults.filter((r) => r.success).length;
    const errorCount = conversionResults.filter((r) => !r.success).length;
    const allChanges = conversionResults
      .flatMap((r) => r.changes)
      .filter((c) => c !== "No changes needed");
    return { successCount, errorCount, totalChanges: allChanges.length };
  }, [conversionResults]);

  const hasFiles = files.length > 0;


  const hasChecked = checkResults.size > 0;
  const allPassed = hasChecked && stats.failed === 0 && stats.unchecked === 0;

  // Sorted files
  const sortedFiles = useMemo(() => {
    const sorted = [...files];
    switch (sortMode) {
      case "name":
        return sorted; // already natural-sorted by loader
      case "name-desc":
        return sorted.reverse();
      case "size":
        return sorted.sort((a, b) => {
          const aw = a.metadata?.width || 0;
          const bw = b.metadata?.width || 0;
          return bw - aw;
        });
      case "dpi":
        return sorted.sort((a, b) => (b.metadata?.dpi || 0) - (a.metadata?.dpi || 0));
      case "status": {
        const getOrder = (f: typeof files[0]) => {
          const r = checkResults.get(f.id);
          if (!r) return 2; // unchecked
          return r.passed ? 1 : 0; // NG first, then OK
        };
        return sorted.sort((a, b) => getOrder(a) - getOrder(b));
      }
      default:
        return sorted;
    }
  }, [files, sortMode, checkResults]);

  // Expanded preview: focus overlay for keyboard, navigate with arrow keys / Esc
  useEffect(() => {
    if (expandedFile && expandedOverlayRef.current) {
      expandedOverlayRef.current.focus();
    }
  }, [expandedFile]);

  const handleExpandedKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!expandedFile) return;
    if (e.key === "Escape") {
      setExpandedFile(null);
      return;
    }
    if (["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(e.key)) {
      e.preventDefault();
      const fileIdx = sortedFiles.findIndex((f) => f.id === expandedFile.id);
      if (fileIdx < 0) return;
      const next = (e.key === "ArrowRight" || e.key === "ArrowDown") ? fileIdx + 1 : fileIdx - 1;
      if (next >= 0 && next < sortedFiles.length) {
        setExpandedFile(sortedFiles[next]);
      }
    }
  }, [expandedFile, sortedFiles]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Main 3-column layout */}
      <div className="flex-1 flex overflow-hidden" data-tool-panel>

        {/* ═══ LEFT PANEL: Detail ═══ */}
        {viewMode !== "layerCheck" && (
          <div className="w-[320px] flex-shrink-0 border-r border-border overflow-hidden flex flex-col bg-bg-secondary">
            {activeFile ? (
              <>
                {/* Header */}
                <div className="px-3 py-2 border-b border-border flex items-center gap-2 flex-shrink-0">
                  <div className="w-5 h-5 rounded-md bg-accent-secondary/20 flex items-center justify-center flex-shrink-0">
                    <svg
                      className="w-3 h-3 text-accent-secondary"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  </div>
                  <span className="text-xs font-medium text-text-primary truncate flex-1">
                    {activeFile.fileName}
                  </span>
                  {activeFile.filePath && (
                    <button
                      className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded transition-all text-text-muted hover:text-text-primary hover:bg-bg-tertiary active:scale-95"
                      onClick={() => {
                        if (selectedFileIds.length > 1) {
                          const paths = selectedFileIds
                            .map((id) => files.find((f) => f.id === id)?.filePath)
                            .filter((p): p is string => !!p);
                          revealFiles(paths);
                        } else {
                          openFolderForFile(activeFile.filePath);
                        }
                      }}
                      title={
                        selectedFileIds.length > 1
                          ? `${selectedFileIds.length}件をエクスプローラーで選択 (F)`
                          : "フォルダを開く (F)"
                      }
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
                          d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                        />
                      </svg>
                    </button>
                  )}
                  {isPhotoshopInstalled && activeFile.filePath && (
                    <button
                      className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded transition-all text-[#31A8FF] hover:bg-[#31A8FF]/15 active:scale-95"
                      onClick={() => openFileInPhotoshop(activeFile.filePath)}
                      title="Photoshopで開く (P)"
                    >
                      <span className="text-sm font-bold leading-none">P</span>
                    </button>
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 overflow-auto">
                  {(() => {
                    const activeCheckResult = checkResults.get(activeFile.id);
                    const activeHasError = activeCheckResult && !activeCheckResult.passed;
                    return (
                      <>
                        {activeHasError && activeCheckResult && (
                          <div className="p-3 border-b border-border">
                            <FixGuidePanel checkResult={activeCheckResult} />
                          </div>
                        )}
                      </>
                    );
                  })()}
                  <div className="p-3 border-b border-border">
                    <GuideSectionPanel file={activeFile} />
                  </div>
                  <MetadataPanel file={activeFile} />
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center px-6">
                  <div className="w-10 h-10 mx-auto mb-3 rounded-xl bg-bg-tertiary flex items-center justify-center">
                    <svg
                      className="w-5 h-5 text-text-muted"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"
                      />
                    </svg>
                  </div>
                  <p className="text-xs text-text-muted">ファイルを選択すると詳細が表示されます</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ CENTER COLUMN ═══ */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">

          {/* Bar 1: View mode + Dot menu (right) */}
          <div className="flex-shrink-0 px-2 py-1 bg-bg-secondary border-b border-border/40 flex items-center gap-2">
            <div className="flex bg-bg-elevated rounded-md p-0.5 border border-white/5 flex-shrink-0">
              {([
                { id: "thumbnails" as const, label: "プレビュー" },
                { id: "layers" as const, label: "レイヤー構造" },
                // layerCheck（レイヤー分離確認）は隔離中 — 統合完了後に削除予定
              ]).map((m) => (
                <button
                  key={m.id}
                  onClick={() => setViewMode(m.id)}
                  className={`px-2 py-0.5 text-[10px] rounded transition-all ${
                    viewMode === m.id || (m.id === "thumbnails" && viewMode === "list")
                      ? "bg-bg-tertiary text-text-primary font-medium shadow-sm"
                      : "text-text-muted hover:text-text-secondary"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <div className="flex-1" />
            {/* Dot menu (right end) */}
            <div ref={dotMenuRef} className="relative flex-shrink-0">
              <button
                onClick={() => setShowDotMenu(!showDotMenu)}
                className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${
                  showDotMenu ? "text-accent bg-accent/10" : "text-text-muted hover:text-text-primary hover:bg-bg-tertiary"
                }`}
                title="ツール"
              >
                <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
                  <circle cx="3" cy="3" r="1.3" /><circle cx="8" cy="3" r="1.3" /><circle cx="13" cy="3" r="1.3" />
                  <circle cx="3" cy="8" r="1.3" /><circle cx="8" cy="8" r="1.3" /><circle cx="13" cy="8" r="1.3" />
                  <circle cx="3" cy="13" r="1.3" /><circle cx="8" cy="13" r="1.3" /><circle cx="13" cy="13" r="1.3" />
                </svg>
              </button>
              {showDotMenu && (
                <div className="absolute right-0 top-full mt-1 z-50 bg-bg-secondary border border-border rounded-lg shadow-xl py-1 min-w-[140px]">
                  {DOT_MENU_TABS.map((tab) => (
                    <button
                      key={tab.id}
                      className="w-full text-left px-3 py-1.5 text-[11px] text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
                      onClick={() => { setActiveView(tab.id); setShowDotMenu(false); }}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Bar 2: Spec selection + Size dropdown */}
          <div className="flex-shrink-0 px-2 py-1 bg-bg-tertiary/30 border-b border-border/30 flex items-center gap-2">
            <span className="text-[10px] text-text-muted flex-shrink-0">仕様:</span>
            {specifications.map((spec) => (
              <button
                key={spec.id}
                className={`px-2 py-0.5 text-[10px] font-medium rounded transition-all ${
                  activeSpecId === spec.id
                    ? "text-white bg-gradient-to-r from-accent to-accent-secondary shadow-sm"
                    : "text-text-secondary bg-bg-tertiary hover:text-text-primary border border-border/50"
                }`}
                onClick={() => spec.id === activeSpecId ? setActiveSpec(null) : selectSpecAndCheck(spec.id)}
              >
                {spec.name}
              </button>
            ))}
            {hasChecked && (
              <>
                <div className="w-px h-3 bg-border/40 mx-0.5" />
                <span className="text-[10px] text-success font-medium">{stats.passed}OK</span>
                <span className="text-[10px] text-error font-medium">{stats.failed}NG</span>
                {stats.caution > 0 && <span className="text-[10px] text-warning font-medium">{stats.caution}注意</span>}
                <button onClick={handleRecheck} disabled={isChecking} className="p-0.5 rounded text-text-muted hover:text-text-primary disabled:opacity-50" title="再チェック">
                  <svg className={`w-3 h-3 ${isChecking ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              </>
            )}
            <div className="flex-1" />
            {/* View shortcuts + filters */}
            <button
              onClick={() => setViewMode("list")}
              className={`w-5 h-5 flex items-center justify-center rounded transition-colors flex-shrink-0 ${viewMode === "list" ? "text-accent bg-accent/10" : "text-text-muted hover:text-text-primary hover:bg-bg-tertiary"}`}
              title="リスト表示"
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>
            </button>
            <button
              onClick={() => { setViewMode("thumbnails"); setThumbnailSize("medium"); }}
              className={`w-5 h-5 flex items-center justify-center rounded transition-colors flex-shrink-0 ${viewMode === "thumbnails" ? "text-accent bg-accent/10" : "text-text-muted hover:text-text-primary hover:bg-bg-tertiary"}`}
              title="サムネイル表示（中）"
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" /></svg>
            </button>
            <div className="w-px h-3 bg-border/40" />
            {/* Size dropdown */}
            {(viewMode === "thumbnails" || viewMode === "list") && (
              <select
                className="bg-bg-tertiary border border-border/50 rounded text-[10px] py-0.5 px-1.5 text-text-primary outline-none flex-shrink-0"
                value={viewMode === "list" ? "list" : thumbnailSize}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "list") setViewMode("list");
                  else { setViewMode("thumbnails"); setThumbnailSize(v as ThumbnailSize); }
                }}
              >
                <option value="list">リスト</option>
                {Object.entries(THUMBNAIL_SIZES).map(([key, { label }]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            )}
            {/* Sort dropdown */}
            <select
              className="bg-bg-tertiary border border-border/50 rounded text-[10px] py-0.5 px-1.5 text-text-primary outline-none flex-shrink-0"
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as typeof sortMode)}
            >
              <option value="name">名前 ↑</option>
              <option value="name-desc">名前 ↓</option>
              <option value="size">サイズ順</option>
              <option value="dpi">DPI順</option>
              <option value="status">チェック結果順</option>
            </select>
            <button
              onClick={() => setPsdOnly(!psdOnly)}
              className={`px-1.5 py-0.5 text-[10px] rounded transition-colors flex-shrink-0 ${psdOnly ? "text-accent-secondary bg-accent-secondary/10 font-medium" : "text-text-muted hover:text-text-primary hover:bg-bg-tertiary"}`}
              title={psdOnly ? "全ファイル表示" : "PSDのみ表示"}
            >
              PSD
            </button>
            <PdfModeButton />
          </div>

          {/* Conversion Results (inline) */}
          {showResults && resultStats && (
            <div className={`flex-shrink-0 px-3 py-1 flex items-center gap-2 text-[10px] border-b ${
              resultStats.errorCount > 0 ? "bg-warning/5 border-warning/20" : "bg-success/5 border-success/20"
            }`}>
              <span className="text-text-primary font-medium">処理完了:</span>
              {resultStats.successCount > 0 && <span className="text-success">{resultStats.successCount}件成功</span>}
              {resultStats.errorCount > 0 && <span className="text-error">{resultStats.errorCount}件エラー</span>}
              <button onClick={() => { setShowResults(false); clearConversionResults(); }} className="ml-auto text-text-muted hover:text-text-primary">✕</button>
            </div>
          )}

          {/* Content area */}
          <div className="flex-1 overflow-hidden relative" data-preview-grid>
          {/* Expanded preview overlay */}
          {expandedFile && (
            <div
              ref={expandedOverlayRef}
              tabIndex={0}
              className="absolute inset-0 z-30 bg-[#1a1a1e] flex flex-col outline-none"
              onClick={() => setExpandedFile(null)}
              onKeyDown={handleExpandedKeyDown}
            >
              <div className="flex-shrink-0 h-7 bg-bg-secondary/90 border-b border-border/30 flex items-center px-3 gap-2">
                {(() => { const idx = sortedFiles.findIndex((f) => f.id === expandedFile.id); return idx >= 0 ? <span className="text-[10px] text-text-muted">{idx + 1}/{sortedFiles.length}</span> : null; })()}
                <span className="text-[11px] text-text-primary font-medium truncate flex-1">{expandedFile.fileName}</span>
                {expandedFile.metadata && (
                  <span className="text-[10px] text-text-muted">
                    {expandedFile.metadata.width}×{expandedFile.metadata.height} {expandedFile.metadata.dpi}dpi
                  </span>
                )}
                <span className="text-[10px] text-text-muted">←→ ページ切替 / Esc 閉じる</span>
                <button
                  onClick={(e) => { e.stopPropagation(); setExpandedFile(null); }}
                  className="w-5 h-5 flex items-center justify-center text-text-muted hover:text-text-primary rounded hover:bg-bg-tertiary"
                >
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="flex-1 flex items-center justify-center p-4 overflow-auto">
                <div className="relative inline-block" onClick={(e) => e.stopPropagation()}>
                  <FilePreviewImage file={expandedFile} />
                  {/* Guide lines overlay */}
                  {expandedFile.metadata?.hasGuides && expandedFile.metadata.guides.length > 0 && expandedFile.metadata.width > 0 && expandedFile.metadata.height > 0 && (
                    <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox={`0 0 ${expandedFile.metadata.width} ${expandedFile.metadata.height}`} preserveAspectRatio="xMidYMid meet">
                      {expandedFile.metadata.guides.map((g: { direction: string; position: number }, gi: number) =>
                        g.direction === "horizontal" ? (
                          <line key={gi} x1={0} y1={g.position} x2={expandedFile.metadata!.width} y2={g.position} stroke="#00d4ff" strokeWidth={8} opacity={0.6} />
                        ) : (
                          <line key={gi} x1={g.position} y1={0} x2={g.position} y2={expandedFile.metadata!.height} stroke="#ff6b00" strokeWidth={8} opacity={0.6} />
                        ),
                      )}
                    </svg>
                  )}
                </div>
              </div>
            </div>
          )}
          {viewMode === "thumbnails" && (
            <div className="h-full overflow-auto">
              {/* Folders always shown */}
              {folderContents && folderContents.folders.length > 0 && (
                <div className={`flex flex-wrap gap-2 px-4 pt-3 pb-1 ${!hasFiles ? "gap-3" : ""}`}>
                  {folderContents.folders.map((folder) => (
                    <div
                      key={`d-${folder}`}
                      className={`flex items-center gap-1.5 rounded-lg bg-bg-tertiary/50 hover:bg-bg-tertiary cursor-pointer transition-colors ${
                        hasFiles ? "px-2.5 py-1.5 text-xs" : "px-3 py-2 text-sm"
                      }`}
                      onClick={() => handleEnterFolder(folder)}
                    >
                      <svg className={`text-warning/70 flex-shrink-0 ${hasFiles ? "w-3.5 h-3.5" : "w-5 h-5"}`} viewBox="0 0 24 24" fill="currentColor">
                        <path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z" />
                      </svg>
                      <span className="text-text-primary truncate">{folder}</span>
                    </div>
                  ))}
                </div>
              )}
              {/* Non-PSD files (txt, json, etc.) — 対応拡張子のみ表示 */}
              {folderContents && !psdOnly && (() => {
                const SUPPORTED_BY_STORE = new Set([".psd", ".psb", ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".gif", ".pdf", ".eps"]);
                const ALLOWED_EXTS = new Set([...SUPPORTED_BY_STORE, ".txt", ".json"]);
                const nonPsdFiles = folderContents.allFiles.filter((f) => {
                  const d = f.lastIndexOf(".");
                  if (d < 0) return false; // 拡張子なしは非表示
                  const ext = f.substring(d).toLowerCase();
                  return ALLOWED_EXTS.has(ext) && !SUPPORTED_BY_STORE.has(ext);
                });
                if (nonPsdFiles.length === 0) return null;
                return (
                <div className="flex flex-wrap gap-2 px-4 pt-2 pb-2">
                  {nonPsdFiles.map((file) => {
                    const color = getFileIconColor(file);
                    const ext = getFileExt(file);
                    return (
                      <div
                        key={`f-${file}`}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-bg-tertiary/30 hover:bg-bg-tertiary cursor-pointer transition-colors text-sm"
                        onDoubleClick={() => handleOpenFile(file)}
                        title={file}
                      >
                        <div className="w-5 h-5 rounded-sm flex items-center justify-center text-white text-[8px] font-bold flex-shrink-0" style={{ backgroundColor: color }}>
                          {ext.substring(0, 3)}
                        </div>
                        <span className="text-text-secondary truncate">{file}</span>
                      </div>
                    );
                  })}
                </div>
                );
              })()}
              {!hasFiles && !folderContents && <DropZone />}
              {hasFiles && (
                <PreviewGrid
                  fileFilter={psdOnly ? ((name) => /\.(psd|psb)$/i.test(name)) : undefined}
                  fileSorter={sortMode !== "name" ? ((arr) => {
                    const sorted = [...arr];
                    switch (sortMode) {
                      case "name-desc": return sorted.reverse();
                      case "size": return sorted.sort((a: any, b: any) => (b.metadata?.width || 0) - (a.metadata?.width || 0));
                      case "dpi": return sorted.sort((a: any, b: any) => (b.metadata?.dpi || 0) - (a.metadata?.dpi || 0));
                      case "status": return sorted.sort((a: any, b: any) => {
                        const getOrd = (f: any) => { const r = checkResults.get(f.id); if (!r) return 2; return r.passed ? 1 : 0; };
                        return getOrd(a) - getOrd(b);
                      });
                      default: return sorted;
                    }
                  }) : undefined}
                  onDoubleClickFile={(id) => {
                    const f = files.find((ff) => ff.id === id);
                    if (f) setExpandedFile(f);
                  }}
                />
              )}
            </div>
          )}
          {viewMode === "list" && (
            <>
              <PsdFileListView
                files={psdOnly ? sortedFiles.filter((f) => /\.(psd|psb)$/i.test(f.fileName)) : sortedFiles}
                selectedFileIds={selectedFileIds}
                checkResults={checkResults}
                folders={folderContents?.folders || []}
                allFiles={psdOnly ? [] : (folderContents?.allFiles || [])}
                onEnterFolder={handleEnterFolder}
                onSelectFile={(id) => { usePsdStore.getState().selectFile(id); setSelectedTextFile(null); }}
                onOpenFile={(id) => {
                  const f = files.find((ff) => ff.filePath === id || ff.id === id);
                  if (f) setExpandedFile(f);
                }}
                onOpenExternalFile={handleOpenFile}
              />
            </>
          )}
          {viewMode === "layers" && <SpecLayerGrid />}
          {/* layerCheck は隔離中 — コードを実行しない */}

          {/* Floating Action Buttons (offset right when preview open) */}
          <div className="absolute bottom-6 right-6 flex flex-row flex-wrap items-end justify-end gap-3 z-10">
            {viewMode === "thumbnails" && stats.noGuides > 0 && (
              <button
                className="h-16 min-w-[220px] px-8 text-lg font-bold rounded-2xl shadow-2xl transition-all duration-200 flex items-center justify-center gap-3 bg-bg-secondary border-2 border-guide-v/50 text-guide-v hover:bg-bg-elevated hover:border-guide-v/70 hover:shadow-[0_8px_30px_rgba(0,188,212,0.25)] active:scale-[0.97]"
                onClick={openEditor}
              >
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
                    d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                  />
                </svg>
                ガイドを編集
                <span className="px-2 py-1 rounded-lg bg-warning/15 text-warning text-sm font-bold">
                  {stats.noGuides}
                </span>
              </button>
            )}
            {viewMode === "thumbnails" && stats.failed > 0 && isPhotoshopInstalled && (
              <div className="relative">
                {/* Guide Prompt Popover */}
                {showGuidePrompt && (
                  <div
                    ref={guidePromptRef}
                    className="absolute bottom-full right-0 mb-3 w-72 bg-white rounded-xl shadow-elevated border border-border p-4 space-y-3"
                    style={{ animation: "toast-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)" }}
                  >
                    <div className="flex items-start gap-2.5">
                      <div className="w-6 h-6 rounded-full bg-warning/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <svg
                          className="w-3.5 h-3.5 text-warning"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-text-primary">ガイドが未設定です</p>
                        <p className="text-xs text-text-muted mt-1">
                          {stats.noGuides}件のファイルにガイドがありません
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        className="flex-1 px-3 py-2 text-xs font-medium rounded-lg border-2 border-guide-v/50 text-guide-v hover:bg-guide-v/10 transition-colors"
                        onClick={() => {
                          setShowGuidePrompt(false);
                          openEditor();
                        }}
                      >
                        ガイドを編集
                      </button>
                      <button
                        className="flex-1 px-3 py-2 text-xs font-medium rounded-lg bg-bg-tertiary text-text-secondary hover:bg-bg-elevated transition-colors"
                        onClick={() => {
                          setShowGuidePrompt(false);
                          prepareFiles({
                            fixSpec: true,
                            applyGuides: false,
                            fileIds: selectedFileIds.length > 0 ? selectedFileIds : undefined,
                          });
                        }}
                      >
                        このまま変換
                      </button>
                    </div>
                  </div>
                )}
                <button
                  className="h-16 min-w-[220px] px-8 text-lg font-bold rounded-2xl shadow-2xl transition-all duration-200 flex items-center justify-center gap-3 text-white bg-gradient-to-r from-[#31A8FF] to-[#0066CC] shadow-[0_4px_16px_rgba(49,168,255,0.4)] hover:shadow-[0_6px_24px_rgba(49,168,255,0.55)] hover:brightness-110 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => {
                    if (stats.noGuides > 0 && guides.length === 0) {
                      setShowGuidePrompt(true);
                    } else {
                      prepareFiles({
                        fixSpec: true,
                        applyGuides: stats.noGuides > 0 && guides.length > 0,
                        fileIds: selectedFileIds.length > 0 ? selectedFileIds : undefined,
                      });
                    }
                  }}
                  disabled={isConverting || isProcessing || !activeSpecId}
                >
                  {isConverting || isProcessing ? (
                    <>
                      <div className="w-5 h-5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                      <span className="text-base">処理中...</span>
                    </>
                  ) : (
                    <>
                      <span className="text-base font-bold leading-none">P</span>
                      一括変換
                      <span className="px-2 py-1 rounded-lg bg-white/25 text-sm font-bold">
                        {selectedFileIds.length > 0 ? selectedFileIds.length : stats.failed}
                      </span>
                    </>
                  )}
                </button>
              </div>
            )}
            {viewMode === "thumbnails" && (
              <>
                {/* PDF化ボタン（Tachimi連携） */}
                <button
                  className={`h-16 min-w-[220px] px-8 text-lg font-bold rounded-2xl shadow-2xl transition-all duration-200 flex items-center justify-center gap-3 bg-bg-secondary active:scale-[0.97] ${
                    allPassed
                      ? "border-2 border-[#ff8a6b]/60 text-[#ff8a6b] hover:bg-bg-elevated hover:border-[#ff8a6b]/80 hover:shadow-[0_6px_20px_rgba(255,138,107,0.25)]"
                      : "border-2 border-[#c8806a]/30 text-[#c8806a]/70 hover:bg-bg-elevated hover:border-[#c8806a]/50 hover:text-[#c8806a]"
                  }`}
                  onClick={handleLaunchTachimi}
                  title="Tachimiを起動してPDF作成"
                >
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
                      d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                    />
                  </svg>
                  PDF化
                  <span
                    className={`px-2 py-1 rounded-lg text-sm font-bold ${
                      allPassed ? "bg-[#ff8a6b]/15" : "bg-[#c8806a]/10"
                    }`}
                  >
                    {files.length}
                  </span>
                </button>
                {/* Tachimi起動エラー */}
                {tachimiError && (
                  <div className="px-4 py-2 rounded-xl bg-error/10 border border-error/30 text-xs text-error max-w-xs">
                    {tachimiError}
                    <button onClick={() => setTachimiError(null)} className="ml-2 underline">
                      閉じる
                    </button>
                  </div>
                )}
              </>
            )}
            {/* テキスト抽出ボタン（常時表示） */}
            <TextExtractButton />
          </div>
        </div>
        </div>
        {/* ═══ end CENTER COLUMN ═══ */}

        {/* ═══ RIGHT PANEL: Preview (closable, lockable) ═══ */}
        {showPreviewPanel && (() => {
          // Determine which file to preview (locked or active)
          const previewFile = previewLocked ? lockedFile : activeFile;
          const previewText = previewLocked ? lockedTextFile : selectedTextFile;
          return (
          <div className="w-[320px] flex-shrink-0 border-l border-border flex flex-col overflow-hidden bg-bg-secondary">
            {/* Preview header */}
            <div className="flex-shrink-0 h-8 border-b border-border/50 flex items-center px-2 gap-1">
              <span className="text-[11px] text-text-primary font-medium truncate flex-1">
                {previewFile?.fileName || previewText?.name || "プレビュー"}
              </span>
              {/* Load text into viewer store */}
              {previewText && (
                <button
                  onClick={() => {
                    const vs = useUnifiedViewerStore.getState();
                    vs.setTextContent(previewText.content);
                    vs.setTextFilePath(previewText.path);
                    vs.setIsDirty(false);
                    // Parse COMIC-POT
                    const lines = previewText.content.split(/\r?\n/);
                    const header: string[] = [];
                    const pages: { pageNumber: number; blocks: { id: string; originalIndex: number; lines: string[] }[] }[] = [];
                    let curPage: typeof pages[0] | null = null;
                    let blockLines: string[] = [];
                    let blockIdx = 0;
                    const pageRe = /^<<(\d+)Page>>$/;
                    const flush = () => { if (blockLines.length > 0 && curPage) { curPage.blocks.push({ id: `p${curPage.pageNumber}-b${blockIdx}`, originalIndex: blockIdx, lines: [...blockLines] }); blockIdx++; blockLines = []; } };
                    for (const line of lines) {
                      const m = line.match(pageRe);
                      if (m) { flush(); blockIdx = 0; blockLines = []; curPage = { pageNumber: parseInt(m[1], 10), blocks: [] }; pages.push(curPage); }
                      else if (curPage) { if (line.trim() === "") flush(); else blockLines.push(line); }
                      else header.push(line);
                    }
                    flush();
                    vs.setTextHeader(header);
                    vs.setTextPages(pages);
                  }}
                  className="px-1.5 py-0.5 text-[9px] text-accent hover:text-white hover:bg-accent rounded transition-colors flex-shrink-0"
                  title="テキストをビューアーに読み込む"
                >
                  読込
                </button>
              )}
              {/* Lock button */}
              <button
                onClick={() => {
                  if (previewLocked) {
                    setPreviewLocked(false);
                    setLockedFile(null);
                    setLockedTextFile(null);
                  } else {
                    setPreviewLocked(true);
                    setLockedFile(activeFile);
                    setLockedTextFile(selectedTextFile);
                  }
                }}
                className={`w-5 h-5 flex items-center justify-center rounded transition-colors ${
                  previewLocked ? "text-warning bg-warning/10" : "text-text-muted hover:text-text-primary hover:bg-bg-tertiary"
                }`}
                title={previewLocked ? "ロック解除" : "プレビューをロック"}
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  {previewLocked ? (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                  )}
                </svg>
              </button>
              <button
                onClick={() => setShowPreviewPanel(false)}
                className="w-5 h-5 flex items-center justify-center text-text-muted hover:text-text-primary rounded hover:bg-bg-tertiary"
                title="プレビューを閉じる"
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {/* Lock indicator */}
            {previewLocked && (
              <div className="flex-shrink-0 px-2 py-0.5 bg-warning/5 border-b border-warning/20 text-[9px] text-warning flex items-center gap-1">
                <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                ロック中
              </div>
            )}
            {/* Preview content — double click to expand */}
            {previewFile ? (
              <div className="flex-1 min-h-0 cursor-pointer" onDoubleClick={() => setExpandedFile(previewFile)} title="ダブルクリックで拡大">
                <FilePreviewImage file={previewFile} />
              </div>
            ) : previewText ? (
              <div className="flex-1 overflow-auto p-3 bg-white">
                <pre className="text-xs font-mono text-black whitespace-pre-wrap leading-relaxed">
                  {previewText.content}
                </pre>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center bg-[#1a1a1e] text-text-muted/30 text-xs">
                ファイルを選択
              </div>
            )}
            {/* Metadata summary */}
            {previewFile?.metadata && (
              <div className="flex-shrink-0 px-3 py-2 border-t border-border/30 text-[10px] text-text-muted space-y-0.5">
                <div className="flex justify-between">
                  <span>サイズ</span>
                  <span className="text-text-secondary font-mono">{previewFile.metadata.width} × {previewFile.metadata.height}</span>
                </div>
                <div className="flex justify-between">
                  <span>DPI</span>
                  <span className="text-text-secondary font-mono">{previewFile.metadata.dpi}</span>
                </div>
                <div className="flex justify-between">
                  <span>カラー</span>
                  <span className="text-text-secondary">{previewFile.metadata.colorMode} / {previewFile.metadata.bitsPerChannel}bit</span>
                </div>
                {(() => {
                  const ps = detectPaperSize(previewFile.metadata.width, previewFile.metadata.height, previewFile.metadata.dpi);
                  return ps ? (
                    <div className="flex justify-between">
                      <span>用紙</span>
                      <span className="text-accent-secondary font-medium">{ps}</span>
                    </div>
                  ) : null;
                })()}
                {previewFile.metadata.hasAlphaChannels && (
                  <div className="flex justify-between">
                    <span>αチャンネル</span>
                    <span className={previewFile.metadata.hasOnlyTransparency ? "text-warning" : "text-error"}>
                      {previewFile.metadata.alphaChannelCount}ch
                    </span>
                  </div>
                )}
                {previewFile.metadata.hasGuides && (
                  <div className="flex justify-between">
                    <span>ガイド</span>
                    <span className="text-guide-v">{previewFile.metadata.guides.length}本</span>
                  </div>
                )}
                {/* Check result */}
                {(() => {
                  const result = checkResults.get(previewFile.id);
                  return result ? (
                    <div className="flex justify-between pt-1 border-t border-border/20">
                      <span>チェック</span>
                      <span className={result.passed ? "text-success font-medium" : "text-error font-medium"}>
                        {result.passed ? "OK" : "NG"}
                      </span>
                    </div>
                  ) : null;
                })()}
              </div>
            )}
            {/* Text file info */}
            {!previewFile && previewText && (
              <div className="flex-shrink-0 px-3 py-2 border-t border-border/30 text-[10px] text-text-muted space-y-0.5">
                <div className="flex justify-between">
                  <span>ファイル</span>
                  <span className="text-text-secondary">{previewText.name}</span>
                </div>
                <div className="flex justify-between">
                  <span>文字数</span>
                  <span className="text-text-secondary font-mono">{previewText.content.length.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>行数</span>
                  <span className="text-text-secondary font-mono">{previewText.content.split("\n").length.toLocaleString()}</span>
                </div>
              </div>
            )}
          </div>
          );
        })()}
        {/* Preview toggle button (when panel is closed) */}
        {!showPreviewPanel && (
          <button
            onClick={() => setShowPreviewPanel(true)}
            className="flex-shrink-0 w-6 border-l border-border flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
            title="プレビューを開く"
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

// ═══ Explorer Panel (エクスプローラー風表示) ═══════════

const FILE_ICON_COLORS: Record<string, string> = {
  ".psd": "#7c5cff", ".psb": "#7c5cff",
  ".jpg": "#22c55e", ".jpeg": "#22c55e", ".png": "#22c55e",
  ".tif": "#06b6d4", ".tiff": "#06b6d4",
  ".bmp": "#64748b", ".gif": "#f59e0b",
  ".pdf": "#ef4444", ".eps": "#ec4899",
  ".json": "#f59e0b", ".txt": "#94a3b8",
  ".doc": "#3b82f6", ".docx": "#3b82f6", ".xlsx": "#22c55e", ".xls": "#22c55e",
  ".zip": "#a78bfa", ".rar": "#a78bfa", ".7z": "#a78bfa",
};

function getFileIconColor(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "#64748b";
  return FILE_ICON_COLORS[name.substring(dot).toLowerCase()] || "#64748b";
}

function getFileExt(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.substring(dot + 1).toUpperCase() : "";
}

// ═══ PSD File List View (リスト表示) ═════════════════

function PsdFileListView({
  files,
  selectedFileIds,
  checkResults,
  folders,
  allFiles = [],
  onEnterFolder,
  onSelectFile,
  onOpenFile,
  onOpenExternalFile,
}: {
  files: PsdFile[];
  selectedFileIds: string[];
  checkResults: Map<string, SpecCheckResult>;
  folders: string[];
  allFiles?: string[];
  onEnterFolder: (name: string) => void;
  onSelectFile: (id: string, multi?: boolean) => void;
  onOpenFile: (path: string) => void;
  onOpenExternalFile?: (name: string) => void;
}) {
  return (
    <div className="h-full overflow-auto select-none">
      {/* Folders */}
      {folders.length > 0 && (
        <div className="border-b border-border/30">
          {folders.map((folder) => (
            <div
              key={`d-${folder}`}
              className="flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer hover:bg-bg-tertiary transition-colors"
              onClick={() => onEnterFolder(folder)}
            >
              <svg className="w-4 h-4 text-warning/70 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z" />
              </svg>
              <span className="text-text-primary truncate">{folder}</span>
              <svg className="w-3 h-3 text-text-muted/40 flex-shrink-0 ml-auto" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </div>
          ))}
        </div>
      )}
      {/* PSD file list with metadata + text */}
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 bg-bg-secondary z-10">
          <tr className="text-text-muted border-b border-border">
            <th className="text-left px-3 py-1.5 font-medium">ファイル名</th>
            <th className="text-right px-2 py-1.5 font-medium w-20">サイズ</th>
            <th className="text-right px-2 py-1.5 font-medium w-12">DPI</th>
            <th className="text-center px-2 py-1.5 font-medium w-14">カラー</th>
            <th className="text-center px-2 py-1.5 font-medium w-8">Bit</th>
            <th className="text-center px-2 py-1.5 font-medium w-8">結果</th>
            <th className="text-left px-2 py-1.5 font-medium">テキスト</th>
          </tr>
        </thead>
        <tbody>
          {files.map((file) => {
            const result = checkResults.get(file.id);
            const isActive = selectedFileIds.includes(file.id);
            // Collect text from text layers
            const textSnippets: string[] = [];
            if (file.metadata?.layerTree) {
              const walk = (nodes: any[]) => {
                for (const n of [...nodes].reverse()) {
                  if (n.type === "text" && n.visible && n.textInfo?.text) {
                    textSnippets.push(n.textInfo.text.replace(/\n/g, " ").trim());
                  }
                  if (n.children) walk(n.children);
                }
              };
              walk(file.metadata.layerTree);
            }
            const textPreview = textSnippets.join(" / ");
            return (
              <tr
                key={file.id}
                className={`cursor-pointer transition-colors ${
                  isActive ? "bg-accent/8" : "hover:bg-bg-tertiary/60"
                }`}
                onClick={(e) => onSelectFile(file.id, e.ctrlKey || e.metaKey)}
                onDoubleClick={() => onOpenFile(file.filePath)}
              >
                <td className="px-3 py-1.5 text-text-primary font-medium">
                  <div className="truncate max-w-[180px]">
                    {(() => {
                      const ext = file.fileName.substring(file.fileName.lastIndexOf(".")).toLowerCase();
                      const isPsd = ext === ".psd" || ext === ".psb";
                      const isPdf = ext === ".pdf";
                      return (
                        <span className={`mr-1 text-[9px] ${isPsd ? "text-accent-secondary/60" : isPdf ? "text-error/60" : "text-text-muted/40"}`}>
                          {isPsd ? "PSD" : ext.substring(1).toUpperCase()}
                        </span>
                      );
                    })()}
                    {file.fileName}
                  </div>
                </td>
                <td className="text-right px-2 py-1.5 text-text-muted tabular-nums whitespace-nowrap">
                  {file.metadata ? `${file.metadata.width}×${file.metadata.height}` : "—"}
                </td>
                <td className="text-right px-2 py-1.5 text-text-muted tabular-nums">
                  {file.metadata?.dpi || "—"}
                </td>
                <td className="text-center px-2 py-1.5 text-text-muted">
                  {file.metadata?.colorMode || "—"}
                </td>
                <td className="text-center px-2 py-1.5 text-text-muted">
                  {file.metadata?.bitsPerChannel || "—"}
                </td>
                <td className="text-center px-2 py-1.5">
                  {result ? (
                    result.passed ? (
                      <span className="text-success font-medium">OK</span>
                    ) : (
                      <span className="text-error font-medium">NG</span>
                    )
                  ) : (
                    <span className="text-text-muted/40">—</span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-text-muted/70 truncate max-w-[300px]" title={textPreview}>
                  {textPreview || <span className="opacity-30">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {/* Non-PSD files (txt, json only) — 対応拡張子のみ表示 */}
      {(() => {
        const SUPPORTED_BY_STORE = new Set([".psd", ".psb", ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".gif", ".pdf", ".eps"]);
        const ALLOWED_EXTS = new Set([...SUPPORTED_BY_STORE, ".txt", ".json"]);
        const nonPsd = allFiles.filter((f) => {
          const d = f.lastIndexOf(".");
          if (d < 0) return false;
          const ext = f.substring(d).toLowerCase();
          return ALLOWED_EXTS.has(ext) && !SUPPORTED_BY_STORE.has(ext);
        });
        if (nonPsd.length === 0) return null;
        return (
          <div className="border-t border-border/30">
            {nonPsd.map((file) => {
              const color = getFileIconColor(file);
              const ext = getFileExt(file);
              const isTxt = file.toLowerCase().endsWith(".txt");
              return (
                <div
                  key={`ext-${file}`}
                  className="flex items-center gap-2 px-3 py-1.5 text-[11px] cursor-pointer hover:bg-bg-tertiary transition-colors"
                  onClick={isTxt ? () => onOpenExternalFile?.(file) : undefined}
                  onDoubleClick={!isTxt ? () => onOpenExternalFile?.(file) : undefined}
                  title={file}
                >
                  <div className="w-4 h-4 rounded-sm flex items-center justify-center text-white text-[7px] font-bold flex-shrink-0" style={{ backgroundColor: color }}>
                    {ext.substring(0, 3)}
                  </div>
                  <span className="text-text-primary truncate flex-1">{file}</span>
                  {isTxt && <span className="text-[9px] text-text-muted/50">クリックで表示</span>}
                </div>
              );
            })}
          </div>
        );
      })()}
      {files.length === 0 && allFiles.length === 0 && folders.length === 0 && (
        <div className="p-4 text-[11px] text-text-muted text-center">ファイルがありません</div>
      )}
    </div>
  );
}

// ═══ File Preview Image ══════════════════════════════

function FilePreviewImage({ file }: { file: PsdFile }) {
  const { imageUrl: previewUrl, isLoading } = useHighResPreview(file.filePath, {
    maxSize: 600,
    pdfPageIndex: file.pdfPageIndex,
    pdfSourcePath: file.pdfSourcePath,
  });

  return (
    <div className="flex-1 overflow-hidden flex items-center justify-center bg-[#1a1a1e] min-h-0">
      {isLoading ? (
        <svg className="w-5 h-5 animate-spin text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      ) : previewUrl ? (
        <img
          src={previewUrl}
          alt={file.fileName}
          className="max-w-full max-h-full object-contain"
          draggable={false}
        />
      ) : file.thumbnailUrl ? (
        <img
          src={file.thumbnailUrl}
          alt={file.fileName}
          className="max-w-full max-h-full object-contain opacity-70"
          draggable={false}
        />
      ) : (
        <div className="text-text-muted/30 text-xs">プレビューなし</div>
      )}
    </div>
  );
}

/** PDF表示モード切替ボタン — 切替時に即座にファイルリストを再構築 */
function PdfModeButton() {
  const pdfDisplayMode = usePsdStore((s) => s.pdfDisplayMode);
  const currentFolderPath = usePsdStore((s) => s.currentFolderPath);
  const { loadFolder } = usePsdLoader();

  return (
    <button
      onClick={async () => {
        const newMode = pdfDisplayMode === "page" ? "file" : "page";
        usePsdStore.getState().setPdfDisplayMode(newMode);
        // 即座に再読み込み
        if (currentFolderPath) {
          try { await loadFolder(currentFolderPath); } catch { /* ignore */ }
        }
      }}
      className={`px-1.5 py-0.5 text-[10px] rounded transition-colors flex-shrink-0 ${
        pdfDisplayMode === "file" ? "text-error bg-error/10 font-medium" : "text-text-muted hover:text-text-primary hover:bg-bg-tertiary"
      }`}
      title={pdfDisplayMode === "page" ? "PDF: ページごと → ファイル単位に切替" : "PDF: ファイル単位 → ページごとに切替"}
    >
      PDF{pdfDisplayMode === "page" ? "頁" : "件"}
    </button>
  );
}
