import { useMemo, useEffect, useState, useRef, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
import { MetadataPanel, LayerSectionPanel } from "../metadata/MetadataPanel";
import { FixGuidePanel } from "../spec-checker/FixGuidePanel";
import { GuideSectionPanel } from "../spec-checker/GuideSectionPanel";
import { SpecLayerGrid } from "../spec-checker/SpecLayerGrid";
// LayerSeparationPanel は隔離中 — 統合完了後に削除予定
// import { LayerSeparationPanel } from "../spec-checker/LayerSeparationPanel";
import { DropZone } from "../file-browser/DropZone";

import { THUMBNAIL_SIZES, type ThumbnailSize, type PsdFile, type SpecCheckResult } from "../../types";
import { invoke } from "@tauri-apps/api/core";
import { TextExtractButton } from "../common/TextExtractButton";
import { useTextExtract } from "../../hooks/useTextExtract";
import { useHighResPreview } from "../../hooks/useHighResPreview";
import { detectPaperSize } from "../../lib/paperSize";
import { showPromptDialog } from "../../store/viewStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useUnifiedViewerStore } from "../../store/unifiedViewerStore";
// useScanPsdStore は SpecScanJsonDialog 内で使用
// JsonFileBrowser / PresetJsonData は JSON登録（SpecScanJsonDialog）に統合済み
import { SpecScanJsonDialog } from "../spec-checker/SpecScanJsonDialog";
import { FileContextMenu } from "../common/FileContextMenu";

// DOT_MENU_TABSはGlobalAddressBarに移動済み

export function SpecCheckView() {
  const files = usePsdStore((state) => state.files);
  const selectedFileIds = usePsdStore((state) => state.selectedFileIds);
  const thumbnailSize = usePsdStore((state) => state.thumbnailSize);
  const setThumbnailSize = usePsdStore((state) => state.setThumbnailSize);
  const activeFile = usePsdStore((state) => state.getActiveFile());

  const specifications = useSpecStore((state) => state.specifications);
  const activeSpecId = useSpecStore((state) => state.activeSpecId);
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
  const [showScanJsonInPanel, setShowScanJsonInPanel] = useState(false);
  const [showTextExtractInPanel, setShowTextExtractInPanel] = useState(false);
  const textExtract = useTextExtract();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [previewLocked, setPreviewLocked] = useState(false);

  // Tauri D&D オーバーレイ
  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout>;
    win.onDragDropEvent((e) => {
      if (e.payload.type === "enter" || e.payload.type === "over") {
        clearTimeout(timer);
        setIsDragOver(true);
      } else {
        // leave / drop
        timer = setTimeout(() => setIsDragOver(false), 100);
      }
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); clearTimeout(timer); };
  }, []);
  const [expandedFile, setExpandedFile] = useState<typeof activeFile>(null);
  const settingsDefaultFolder = useSettingsStore((s) => s.defaultFolderPath);
  const [desktopPath, setDesktopPath] = useState("C:\\Users");
  useEffect(() => {
    if (settingsDefaultFolder) { setDesktopPath(settingsDefaultFolder); return; }
    import("@tauri-apps/api/path").then(({ desktopDir }) => desktopDir().then((p) => setDesktopPath(p))).catch(() => {});
  }, [settingsDefaultFolder]);
  // ドットメニューはGlobalAddressBarに移動済み
  const [sortKey, setSortKey] = useState<"name" | "modified" | "type">("name");
  const [sortAsc, setSortAsc] = useState(true);
  // sortMode removed — sortKey + sortAsc used directly
  // setActiveViewはGlobalAddressBarに移動済み
  const [lockedFile, setLockedFile] = useState<typeof activeFile>(null);
  const [lockedTextFile, setLockedTextFile] = useState<{ name: string; path: string; content: string } | null>(null);
  const expandedOverlayRef = useRef<HTMLDivElement>(null);

  // Selected text file
  const [selectedTextFile, setSelectedTextFile] = useState<{ name: string; path: string; content: string } | null>(null);
  // Selected non-PSD item (folder or txt/json) for highlight
  const [selectedNonPsdItem, setSelectedNonPsdItem] = useState<string | null>(null);

  // Address bar & explorer
  const currentFolderPath = usePsdStore((state) => state.currentFolderPath);
  const [folderContents, setFolderContents] = useState<{ folders: string[]; allFiles: string[] } | null>(null);
  // psdOnly removed — fileTypeFilter used directly
  const fileTypeFilter = usePsdStore((s) => s.fileTypeFilter);
  // setPsdOnlyはfileTypeFilterドロップダウンに統合済み
  // singleFolderDrop は現在未使用（将来フォルダ表示フィルタで使用予定）
  const { loadFolder } = usePsdLoader();

  const guidePromptRef = useRef<HTMLDivElement>(null);

  const { checkAllFiles, isChecking } = useSpecChecker();
  const { isPhotoshopInstalled, isConverting } = usePhotoshopConverter();
  const { isProcessing, prepareFiles } = usePreparePsd();
  const { openFileInPhotoshop } = useOpenInPhotoshop();
  const { revealFiles } = useOpenFolder();
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

  const contentLocked = usePsdStore((s) => s.contentLocked);
  const refreshCounter = usePsdStore((s) => s.refreshCounter);

  // Load explorer on folder change, or when refresh is triggered
  useEffect(() => {
    if (currentFolderPath) {
      loadExplorerContents(currentFolderPath);
    } else {
      setFolderContents(null);
    }
  }, [currentFolderPath, loadExplorerContents, refreshCounter]);

  const setCurrentFolderPath = usePsdStore((state) => state.setCurrentFolderPath);

  // Enter subfolder (single click)
  const handleEnterFolder = useCallback(async (folderName: string) => {
    if (!currentFolderPath) return;
    if (usePsdStore.getState().contentLocked) return; // ロック中はスキップ
    const newPath = `${currentFolderPath}\\${folderName}`;
    setCurrentFolderPath(newPath);
    usePsdStore.getState().setSingleFolderDrop(null);
    await loadExplorerContents(newPath);
    try { await loadFolder(newPath); } catch { /* ignore */ }
  }, [currentFolderPath, loadFolder, loadExplorerContents, setCurrentFolderPath]);

  // Open file — text files open in-app, others with default app
  const handleOpenFile = useCallback(async (fileName: string) => {
    if (!currentFolderPath) return;
    const fullPath = `${currentFolderPath}\\${fileName}`;
    const ext = fileName.substring(fileName.lastIndexOf(".")).toLowerCase();
    // Text files: load content and show in preview
    if (ext === ".txt") {
      try {
        const content = await invoke<string>("read_text_file", { filePath: fullPath });
        setSelectedTextFile({ name: fileName, path: fullPath, content });
      } catch { /* ignore */ }
      return;
    }
    // JSON files: load into viewer store (作品情報 or 校正JSON)
    if (ext === ".json") {
      try {
        const content = await invoke<string>("read_text_file", { filePath: fullPath });
        const data = JSON.parse(content);
        const vs = useUnifiedViewerStore.getState();
        // 校正JSONかプリセットJSONかを自動判定
        if (data.checks || (Array.isArray(data) && data[0]?.category)) {
          // 校正JSON
          const allItems: any[] = [];
          const parse = (src: any, kind: string) => {
            const arr = Array.isArray(src) ? src : Array.isArray(src?.items) ? src.items : null;
            if (!arr) return;
            for (const item of arr) allItems.push({ picked: false, category: item.category || "", page: item.page || "", excerpt: item.excerpt || "", content: item.content || item.text || "", checkKind: item.checkKind || kind });
          };
          if (data.checks) { parse(data.checks.simple, "correctness"); parse(data.checks.variation, "proposal"); }
          else if (Array.isArray(data)) { parse(data, "correctness"); }
          vs.setCheckData({ title: data.work || "", fileName, filePath: fullPath, allItems, correctnessItems: allItems.filter((i) => i.checkKind === "correctness"), proposalItems: allItems.filter((i) => i.checkKind === "proposal") });
        } else {
          // 作品情報JSON（フォントプリセット）
          const presets: any[] = [];
          const presetsObj = data?.presetData?.presets ?? data?.presets ?? data?.presetSets ?? data;
          if (typeof presetsObj === "object" && presetsObj !== null) {
            if (Array.isArray(presetsObj)) {
              for (const p of presetsObj) if (p?.font || p?.postScriptName) presets.push({ font: p.font || p.postScriptName, name: p.name || p.displayName || p.font || "", subName: p.subName || p.category || "" });
            } else {
              for (const [, arr] of Object.entries(presetsObj)) { if (!Array.isArray(arr)) continue; for (const p of arr as any[]) if (p?.font || p?.postScriptName) presets.push({ font: p.font || p.postScriptName, name: p.name || p.displayName || "", subName: p.subName || "" }); }
            }
          }
          if (presets.length > 0) { vs.setFontPresets(presets); vs.setPresetJsonPath(fullPath); }
        }
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
    const dir = sortAsc ? 1 : -1;
    switch (sortKey) {
      case "name":
        return sortAsc ? sorted : sorted.reverse();
      case "modified":
        return sorted.sort((a, b) => dir * ((a.modifiedTime || 0) - (b.modifiedTime || 0)));
      case "type": {
        const getExt = (f: typeof files[0]) => f.fileName.substring(f.fileName.lastIndexOf(".")).toLowerCase();
        return sorted.sort((a, b) => dir * getExt(a).localeCompare(getExt(b)));
      }
      default:
        return sorted;
    }
  }, [files, sortKey, sortAsc]);

  // ファイルフィルタ適用
  const filteredFiles = useMemo(() => {
    if (fileTypeFilter === "all") return sortedFiles;
    return sortedFiles.filter((f) => {
      const ext = f.fileName.substring(f.fileName.lastIndexOf(".")).toLowerCase();
      switch (fileTypeFilter) {
        case "psd": return ext === ".psd" || ext === ".psb";
        case "pdf": return ext === ".pdf";
        case "image": return [".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".gif", ".eps"].includes(ext);
        case "text": return ext === ".txt" || ext === ".json";
        default: return true;
      }
    });
  }, [sortedFiles, fileTypeFilter]);

  // Ctrl+Z: ファイル操作Undo
  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "z" && !e.shiftKey) {
        // テキスト入力中はスキップ
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        const op = usePsdStore.getState().popFileOpsUndo();
        if (!op) return;
        e.preventDefault();
        try {
          if (op.type === "delete" || op.type === "cut") {
            await invoke("restore_from_backup", { backupPath: op.backupPath, originalPath: op.originalPath });
          } else if (op.type === "duplicate") {
            await invoke("delete_file", { filePath: op.originalPath });
          } else if (op.type === "rename") {
            // リネームを逆順で元に戻す（一括で1操作）
            const reverseEntries = op.entries.map((e) => ({
              sourcePath: e.newPath,
              newName: e.oldPath.substring(e.oldPath.lastIndexOf("\\") + 1),
            }));
            await invoke("batch_rename_files", { entries: reverseEntries, outputDirectory: null, mode: "overwrite" });
          }
          const folder = usePsdStore.getState().currentFolderPath;
          if (folder) await loadFolder(folder);
          usePsdStore.getState().triggerRefresh();
        } catch { /* ignore */ }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [loadFolder]);

  // Expanded preview: focus overlay for keyboard, navigate with arrow keys / Esc
  useEffect(() => {
    if (expandedFile) {
      if (expandedOverlayRef.current) expandedOverlayRef.current.focus();
      // 右プレビューも連動
      usePsdStore.getState().selectFile(expandedFile.id);
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
                {/* フォルダ階層ツリー */}
                <FolderBreadcrumbTree currentPath={currentFolderPath || desktopPath} onNavigate={(path) => {
                  if (usePsdStore.getState().contentLocked) return;
                  usePsdStore.getState().setCurrentFolderPath(path);
                  loadFolder(path).catch(() => {});
                }} />

                {/* ファイル名ヘッダー（ダブルクリックでリネーム） */}
                <div className="px-3 py-2 border-b border-border flex items-center gap-2 flex-shrink-0">
                  <span
                    className="text-xs font-medium text-text-primary truncate flex-1 cursor-text hover:bg-bg-tertiary/50 rounded px-1 -mx-1 transition-colors"
                    title="ダブルクリックでリネーム"
                    onDoubleClick={async () => {
                      if (!activeFile.filePath) return;
                      const newName = await showPromptDialog("新しいファイル名", activeFile.fileName);
                      if (!newName || newName === activeFile.fileName) return;
                      const dir = activeFile.filePath.substring(0, activeFile.filePath.lastIndexOf("\\"));
                      try {
                        await invoke("invalidate_file_cache", { filePath: activeFile.filePath }).catch(() => {});
                        await invoke("clear_psd_cache").catch(() => {});
                        await invoke("batch_rename_files", {
                          entries: [{ sourcePath: activeFile.filePath, newName: newName }],
                          outputDirectory: null,
                          mode: "overwrite",
                        });
                        usePsdStore.getState().pushFileOpsUndo({
                          type: "rename",
                          entries: [{ oldPath: activeFile.filePath, newPath: `${dir}\\${newName}` }],
                        });
                      } catch { /* ignore */ }
                      const folder = usePsdStore.getState().currentFolderPath;
                      if (folder) await loadFolder(folder);
                      usePsdStore.getState().triggerRefresh();
                    }}
                  >
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
                          invoke("open_folder_in_explorer", { folderPath: currentFolderPath || activeFile.filePath.substring(0, activeFile.filePath.lastIndexOf("\\")) }).catch(() => {});
                        }
                      }}
                      title="フォルダを開く (F)"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
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
                  <CollapsibleSidebarSection title="原稿仕様" icon={<svg className="w-3.5 h-3.5 text-accent-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>}>
                    <GuideSectionPanel file={activeFile} />
                    <div className="border-t border-border/20 mt-2 pt-2" />
                    <MetadataPanel file={activeFile} />
                  </CollapsibleSidebarSection>
                  <CollapsibleSidebarSection title="レイヤー" defaultOpen={false} icon={<svg className="w-3.5 h-3.5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>}>
                    <LayerSectionPanel file={activeFile} />
                  </CollapsibleSidebarSection>
                </div>
              </>
            ) : (
              <div className="flex-1 overflow-auto">
                {/* フォルダ階層ツリー（ファイル未選択時） */}
                <FolderBreadcrumbTree currentPath={currentFolderPath || desktopPath} onNavigate={(path) => {
                  if (usePsdStore.getState().contentLocked) return;
                  usePsdStore.getState().setCurrentFolderPath(path);
                  loadFolder(path).catch(() => {});
                }} />
              </div>
            )}
          </div>
        )}

        {/* ═══ CENTER COLUMN ═══ */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">

          {/* Bar 1: View controls */}
          <div className="flex-shrink-0 px-2 py-1 bg-bg-secondary border-b border-border/40 flex items-center gap-2">
            <div className="flex bg-bg-elevated rounded-md p-0.5 border border-white/5 flex-shrink-0">
            </div>
            <div className="flex-1" />
            {/* ドットメニューはGlobalAddressBarに移動済み */}
          </div>

          {/* Bar 2: Spec selection + Size dropdown */}
          <div className="flex-shrink-0 px-2 py-1 bg-bg-tertiary/30 border-b border-border/30 flex items-center gap-2">
            <button
              onClick={() => usePsdStore.getState().setContentLocked(!contentLocked)}
              className={`w-5 h-5 flex items-center justify-center rounded transition-colors flex-shrink-0 ${
                contentLocked ? "text-warning bg-warning/10" : "text-text-muted hover:text-text-primary hover:bg-bg-tertiary"
              }`}
              title={contentLocked ? "ロック中（クリックで解除）" : "コンテンツロック"}
            >
              <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                {contentLocked ? (
                  <><rect x="3.5" y="7" width="9" height="7" rx="1" /><path d="M5.5 7V5a2.5 2.5 0 015 0v2" /></>
                ) : (
                  <><rect x="3.5" y="7" width="9" height="7" rx="1" /><path d="M5.5 7V5a2.5 2.5 0 015 0" /></>
                )}
              </svg>
            </button>
            <span className="text-[10px] text-text-muted flex-shrink-0">仕様:</span>
            {specifications.length > 0 && (
              <button
                className={`px-3 py-0.5 text-[10px] font-medium rounded transition-all ${
                  activeSpecId
                    ? "text-white bg-gradient-to-r from-accent to-accent-secondary shadow-sm"
                    : "text-text-secondary bg-bg-tertiary hover:text-text-primary border border-border/50"
                }`}
                onClick={() => {
                  if (!activeSpecId) {
                    // 未選択 → 最初の仕様を選択
                    selectSpecAndCheck(specifications[0].id);
                  } else {
                    // 次の仕様に切り替え（ループ）
                    const currentIdx = specifications.findIndex((s) => s.id === activeSpecId);
                    const nextIdx = (currentIdx + 1) % specifications.length;
                    selectSpecAndCheck(specifications[nextIdx].id);
                  }
                }}
              >
                {activeSpecId
                  ? specifications.find((s) => s.id === activeSpecId)?.name || "—"
                  : "クリックで選択"}
              </button>
            )}
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
            {/* Sort: key dropdown + asc/desc button */}
            <select
              className="bg-bg-tertiary border border-border/50 rounded text-[10px] py-0.5 px-1.5 text-text-primary outline-none flex-shrink-0"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as typeof sortKey)}
            >
              <option value="name">名前</option>
              <option value="modified">更新日</option>
              <option value="type">種類</option>
            </select>
            <button
              onClick={() => setSortAsc(!sortAsc)}
              className="w-6 h-6 flex items-center justify-center text-text-muted hover:text-text-primary rounded hover:bg-bg-tertiary flex-shrink-0"
              title={sortAsc ? "昇順 → 降順" : "降順 → 昇順"}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                {sortAsc ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                )}
              </svg>
            </button>
            <select
              className="bg-bg-tertiary border border-border/50 rounded text-[10px] py-0.5 px-1 text-text-primary outline-none flex-shrink-0"
              value={fileTypeFilter}
              onChange={(e) => usePsdStore.getState().setFileTypeFilter(e.target.value as any)}
            >
              <option value="all">全て</option>
              <option value="psd">PSD</option>
              <option value="pdf">PDF</option>
              <option value="image">画像</option>
              <option value="text">テキスト</option>
            </select>
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
          <div
            className="flex-1 overflow-hidden relative"
            data-preview-grid
            tabIndex={0}
            onKeyDown={(e) => {
              const list = filteredFiles;
              if (list.length === 0) return;
              const currentIdx = list.findIndex((f) => f.id === usePsdStore.getState().activeFileId);
              if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                e.preventDefault();
                let nextIdx: number;
                if (e.key === "ArrowRight") nextIdx = currentIdx < list.length - 1 ? currentIdx + 1 : 0;
                else nextIdx = currentIdx > 0 ? currentIdx - 1 : list.length - 1;
                usePsdStore.getState().selectFile(list[nextIdx].id);
              } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                e.preventDefault();
                let cols = 1;
                if (viewMode === "thumbnails") {
                  // .grid クラスを持つ要素のgridTemplateColumnsから列数を取得
                  const gridEl = (e.currentTarget as HTMLElement).querySelector(".grid");
                  if (gridEl) {
                    const computed = window.getComputedStyle(gridEl).gridTemplateColumns;
                    if (computed && computed !== "none") {
                      cols = computed.split(/\s+/).filter(Boolean).length;
                    }
                  }
                }
                const step = e.key === "ArrowDown" ? cols : -cols;
                const nextIdx = Math.max(0, Math.min(list.length - 1, currentIdx + step));
                if (nextIdx !== currentIdx) usePsdStore.getState().selectFile(list[nextIdx].id);
              }
            }}
            onClick={() => { if (selectedNonPsdItem) setSelectedNonPsdItem(null); }}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY });
            }}
          >
          {/* D&D overlay */}
          {isDragOver && (
            <div className="absolute inset-0 z-50 bg-black/60 flex flex-col items-center justify-center pointer-events-none">
              <div className="w-20 h-20 rounded-3xl bg-white/10 flex items-center justify-center mb-4">
                <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
              </div>
              <p className="text-white text-lg font-display font-bold">ドラッグして読み込み</p>
              <p className="text-white/60 text-sm mt-1">ファイルまたはフォルダをドロップ</p>
            </div>
          )}
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
                  {folderContents.folders.map((folder) => {
                    const isFolderSelected = selectedNonPsdItem === `folder:${folder}`;
                    return (
                    <div
                      key={`d-${folder}`}
                      className={`flex items-center gap-1.5 rounded-lg cursor-pointer transition-colors ${
                        hasFiles ? "px-2.5 py-1.5 text-xs" : "px-3 py-2 text-sm"
                      } ${isFolderSelected ? "bg-sky-100 ring-1 ring-sky-400/50" : "bg-bg-tertiary/50 hover:bg-bg-tertiary"}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedNonPsdItem(`folder:${folder}`);
                        setSelectedTextFile(null);
                        usePsdStore.getState().clearSelection();
                      }}
                      onDoubleClick={() => handleEnterFolder(folder)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setSelectedNonPsdItem(`folder:${folder}`);
                        setSelectedTextFile(null);
                        usePsdStore.getState().clearSelection();
                        setContextMenu({ x: e.clientX, y: e.clientY });
                      }}
                    >
                      <svg className={`text-warning/70 flex-shrink-0 ${hasFiles ? "w-3.5 h-3.5" : "w-5 h-5"}`} viewBox="0 0 24 24" fill="currentColor">
                        <path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z" />
                      </svg>
                      <span className="text-text-primary truncate">{folder}</span>
                    </div>
                    );
                  })}
                </div>
              )}
              {/* Non-PSD files (txt, json, etc.) — 全て or テキストフィルタ時に表示 */}
              {folderContents && (fileTypeFilter === "all" || fileTypeFilter === "text") && (() => {
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
                    const isSelected = selectedNonPsdItem === `file:${file}`;
                    return (
                      <div
                        key={`f-${file}`}
                        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg cursor-pointer transition-colors text-sm ${
                          isSelected ? "bg-sky-100 ring-1 ring-sky-400/50" : "bg-bg-tertiary/30 hover:bg-bg-tertiary"
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedNonPsdItem(`file:${file}`);
                          usePsdStore.getState().clearSelection();
                          handleOpenFile(file);
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          if (!selectedTextFile || selectedTextFile.name !== file) handleOpenFile(file);
                          setSelectedNonPsdItem(`file:${file}`);
                          usePsdStore.getState().clearSelection();
                          setContextMenu({ x: e.clientX, y: e.clientY });
                        }}
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
                  fileFilter={fileTypeFilter !== "all" ? ((name: string) => {
                    const ext = name.substring(name.lastIndexOf(".")).toLowerCase();
                    switch (fileTypeFilter) {
                      case "psd": return ext === ".psd" || ext === ".psb";
                      case "pdf": return ext === ".pdf";
                      case "image": return [".jpg",".jpeg",".png",".tif",".tiff",".bmp",".gif",".eps"].includes(ext);
                      case "text": return ext === ".txt" || ext === ".json";
                      default: return true;
                    }
                  }) : undefined}
                  fileSorter={(arr) => {
                    const sorted = [...arr];
                    const dir = sortAsc ? 1 : -1;
                    switch (sortKey) {
                      case "name": return sortAsc ? sorted : sorted.reverse();
                      case "modified": return sorted.sort((a: any, b: any) => dir * ((a.modifiedTime || 0) - (b.modifiedTime || 0)));
                      case "type": return sorted.sort((a: any, b: any) => {
                        const ea = a.fileName.substring(a.fileName.lastIndexOf(".")).toLowerCase();
                        const eb = b.fileName.substring(b.fileName.lastIndexOf(".")).toLowerCase();
                        return dir * ea.localeCompare(eb);
                      });
                      default: return sorted;
                    }
                  }}
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
                files={filteredFiles}
                selectedFileIds={selectedFileIds}
                checkResults={checkResults}
                outlierFileIds={outlierFileIds}
                hasTomboMix={hasTomboMix}
                folders={folderContents?.folders || []}
                allFiles={fileTypeFilter !== "all" ? [] : (folderContents?.allFiles || [])}
                onEnterFolder={handleEnterFolder}
                onSelectFile={(id) => { usePsdStore.getState().selectFile(id); setSelectedTextFile(null); setSelectedNonPsdItem(null); }}
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
          <div className="w-[320px] flex-shrink-0 border-l border-border flex flex-col overflow-hidden bg-bg-secondary relative">
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
            {/* Preview image */}
            {previewFile ? (
              <div className="flex-1 min-h-0 cursor-pointer overflow-hidden" onDoubleClick={() => setExpandedFile(previewFile)} title="ダブルクリックで拡大">
                <FilePreviewImage file={previewFile} />
              </div>
            ) : previewText ? (
              <div className="flex-1 min-h-0 overflow-auto p-3 bg-white">
                <pre className="text-xs font-mono text-black whitespace-pre-wrap leading-relaxed">
                  {previewText.content}
                </pre>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center bg-[#1a1a1e] text-text-muted/30 text-xs">
                ファイルを選択
              </div>
            )}
            {/* File Properties Panel — プレビュータブ時のみ */}
            {previewFile && (
              <FilePropertiesPanel file={previewFile} checkResult={checkResults.get(previewFile.id)} />
            )}
            {/* Text file info — プレビュータブ時のみ */}
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
            {/* === 作成モード — アクション統合時に非表示 === */}
            {/* JSON登録（SpecScanJsonDialog）— 右パネル内表示 */}
            {showScanJsonInPanel && (
              <div className="absolute inset-0 z-40 bg-white flex flex-col overflow-hidden">
                <SpecScanJsonDialog onClose={() => setShowScanJsonInPanel(false)} inline />
              </div>
            )}
            {/* テキスト抽出 — 右パネル内表示 */}
            {showTextExtractInPanel && (
              <div className="absolute inset-0 z-40 bg-white flex flex-col overflow-hidden">
                <div className="flex-shrink-0 flex items-center justify-between px-3 py-2 border-b border-border/50 bg-bg-tertiary">
                  <span className="text-xs font-bold text-text-primary">テキスト抽出</span>
                  <button
                    onClick={() => { setShowTextExtractInPanel(false); textExtract.setResult(null); }}
                    className="w-5 h-5 flex items-center justify-center rounded hover:bg-bg-primary text-text-muted hover:text-text-primary transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="flex-1 overflow-auto p-3 space-y-3">
                  {/* 対象ファイル数 */}
                  <div className="text-xs text-text-secondary">
                    対象PSDファイル: <span className="font-bold text-accent-secondary">{textExtract.psdFiles.length}</span> 件
                  </div>

                  {textExtract.psdFiles.length === 0 ? (
                    <div className="text-xs text-text-muted py-4 text-center">テキストレイヤーを含むPSDファイルがありません</div>
                  ) : (
                    <>
                      {/* レイヤー順序 */}
                      <div className="space-y-1">
                        <label className="text-[10px] text-text-muted font-medium">レイヤー順序</label>
                        <div className="flex rounded-lg border border-border overflow-hidden">
                          <button
                            className={`flex-1 px-2 py-1.5 text-[10px] font-medium transition-colors ${
                              textExtract.sortMode === "bottomToTop"
                                ? "bg-accent/10 text-accent border-r border-border"
                                : "text-text-secondary hover:bg-bg-tertiary border-r border-border"
                            }`}
                            onClick={() => textExtract.setSortMode("bottomToTop")}
                          >
                            下→上
                          </button>
                          <button
                            className={`flex-1 px-2 py-1.5 text-[10px] font-medium transition-colors ${
                              textExtract.sortMode === "topToBottom"
                                ? "bg-accent/10 text-accent"
                                : "text-text-secondary hover:bg-bg-tertiary"
                            }`}
                            onClick={() => textExtract.setSortMode("topToBottom")}
                          >
                            上→下
                          </button>
                        </div>
                      </div>

                      {/* 非表示レイヤー */}
                      <label className="flex items-center gap-2 cursor-pointer">
                        <div
                          role="checkbox"
                          aria-checked={textExtract.includeHidden}
                          tabIndex={0}
                          className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center transition-colors ${
                            textExtract.includeHidden ? "bg-accent border-accent" : "border-border hover:border-accent/50"
                          }`}
                          onClick={() => textExtract.setIncludeHidden(!textExtract.includeHidden)}
                          onKeyDown={(e) => {
                            if (e.key === " " || e.key === "Enter") textExtract.setIncludeHidden(!textExtract.includeHidden);
                          }}
                        >
                          {textExtract.includeHidden && (
                            <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                        <span className="text-[10px] text-text-secondary">非表示レイヤーも含める</span>
                      </label>

                      {/* 実行ボタン */}
                      <button
                        className="w-full px-3 py-2 text-xs font-bold rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors active:scale-[0.97] disabled:opacity-50"
                        onClick={textExtract.handleExtract}
                        disabled={textExtract.isExtracting}
                      >
                        {textExtract.isExtracting ? (
                          <span className="flex items-center justify-center gap-2">
                            <div className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                            抽出中...
                          </span>
                        ) : (
                          "抽出を実行"
                        )}
                      </button>

                      {/* 結果 */}
                      {textExtract.result && (
                        <div
                          className={`px-3 py-2 rounded-lg border text-[10px] ${
                            textExtract.result.success
                              ? "bg-success/10 border-success/30 text-success"
                              : "bg-error/10 border-error/30 text-error"
                          }`}
                        >
                          {textExtract.result.message}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
            {/* === 作成モード — アクション統合時に非表示 === */}
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
      {/* Right-click context menu */}
      {contextMenu && (
        <FileContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          files={(() => {
            const sel = files.filter((f) => selectedFileIds.includes(f.id));
            if (sel.length > 0) return sel;
            if (activeFile) return [activeFile];
            return [];
          })()}
          allFiles={files}
          onClose={() => setContextMenu(null)}
          onLaunchTachimi={handleLaunchTachimi}
          previewText={previewLocked ? lockedTextFile : selectedTextFile}
          selectedNonPsdItem={selectedNonPsdItem}
          currentFolderPath={currentFolderPath}
        />
      )}
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

// ═══ File Properties Panel (ファイルプロパティ) ═══════

function FilePropertiesPanel({ file, checkResult }: { file: PsdFile; checkResult?: SpecCheckResult }) {
  const [open, setOpen] = useState(true);
  const m = file.metadata;

  const formatDate = (ts?: number) => {
    if (!ts) return "—";
    const d = new Date(ts * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}, ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const docType = (() => {
    const ext = file.fileName.substring(file.fileName.lastIndexOf(".")).toLowerCase();
    if (ext === ".psd") return "Photoshop document";
    if (ext === ".psb") return "Photoshop large document";
    if (ext === ".pdf") return "PDF document";
    if (ext === ".jpg" || ext === ".jpeg") return "JPEG image";
    if (ext === ".png") return "PNG image";
    if (ext === ".tif" || ext === ".tiff") return "TIFF image";
    if (ext === ".bmp") return "BMP image";
    if (ext === ".gif") return "GIF image";
    if (ext === ".eps") return "EPS file";
    return ext.substring(1).toUpperCase() + " file";
  })();

  // Compute cm dimensions from pixels + dpi
  const cmW = m && m.dpi > 0 ? ((m.width / m.dpi) * 2.54).toFixed(1) : null;
  const cmH = m && m.dpi > 0 ? ((m.height / m.dpi) * 2.54).toFixed(1) : null;

  const colorModeJa: Record<string, string> = {
    RGB: "RGB カラー",
    CMYK: "CMYK カラー",
    Grayscale: "白黒",
    Bitmap: "ビットマップ",
    Lab: "Lab カラー",
    Indexed: "インデックスカラー",
    Multichannel: "マルチチャンネル",
    Duotone: "ダブルトーン",
  };

  const ps = m ? detectPaperSize(m.width, m.height, m.dpi) : null;

  const Row = ({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) => (
    <div className="flex items-start gap-2 py-[2px]">
      <span className="text-text-muted w-[90px] flex-shrink-0 text-right">{label}</span>
      <span className={`text-text-primary flex-1 ${className || ""}`}>{value}</span>
    </div>
  );

  return (
    <div className="flex-shrink-0 border-t border-border/30 text-[10px] select-text">
      {/* Header - collapsible */}
      <button
        className="w-full flex items-center gap-1 px-2 py-1.5 text-[10px] font-bold text-text-secondary hover:bg-bg-tertiary/50 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <svg
          className={`w-3 h-3 text-text-muted transition-transform ${open ? "rotate-90" : ""}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        ファイルプロパティ
      </button>

      {open && (
        <div className="px-2 pb-2 space-y-[1px]">
          <Row label="ファイル名" value={file.fileName} className="font-medium break-all" />
          <Row label="ドキュメントの種類" value={docType} />
          <Row label="ファイルの修正日" value={formatDate(file.modifiedTime)} className="font-mono" />
          <Row label="ファイルサイズ" value={formatSize(file.fileSize)} className="font-mono" />

          {m && (
            <>
              <div className="border-t border-border/20 my-1" />
              <Row label="寸法" value={`${m.width} x ${m.height}`} className="font-mono" />
              {cmW && cmH && (
                <Row label="寸法 (cm)" value={`${cmW} cm x ${cmH} cm${ps ? `  (${ps})` : ""}`} className="font-mono" />
              )}
              <Row label="解像度" value={`${m.dpi} ppi`} className="font-mono" />
              <Row label="ビット数" value={String(m.bitsPerChannel)} className="font-mono" />
              <Row label="カラーモード" value={colorModeJa[m.colorMode] || m.colorMode} />
              {m.hasAlphaChannels && (
                <Row
                  label="αチャンネル"
                  value={
                    <span className={m.hasOnlyTransparency ? "text-warning" : "text-error font-medium"}>
                      {m.alphaChannelCount}ch {m.alphaChannelNames.length > 0 && `(${m.alphaChannelNames.join(", ")})`}
                    </span>
                  }
                />
              )}
              {m.hasGuides && (
                <Row label="ガイド" value={<span className="text-guide-v">{m.guides.length}本</span>} />
              )}
              {m.hasTombo && (
                <Row label="トンボ" value={<span className="text-manga-peach">あり</span>} />
              )}
              <Row label="レイヤー数" value={String(m.layerCount)} className="font-mono" />
            </>
          )}

          {/* Check result */}
          {checkResult && (
            <>
              <div className="border-t border-border/20 my-1" />
              <Row
                label="チェック結果"
                value={
                  <span className={checkResult.passed ? "text-success font-bold" : "text-error font-bold"}>
                    {checkResult.passed ? "OK" : "NG"}
                  </span>
                }
              />
              {!checkResult.passed && checkResult.results.filter((r) => !r.passed).map((r, i) => (
                <Row
                  key={i}
                  label=""
                  value={
                    <span className="text-error text-[9px]">
                      {r.rule.message || r.rule.type}: {String(r.actualValue)} → {String(r.rule.value)}
                    </span>
                  }
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ═══ PSD File List View (リスト表示) ═════════════════

function PsdFileListView({
  files,
  selectedFileIds,
  checkResults,
  outlierFileIds,
  hasTomboMix,
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
  outlierFileIds: Set<string>;
  hasTomboMix: boolean;
  folders: string[];
  allFiles?: string[];
  onEnterFolder: (name: string) => void;
  onSelectFile: (id: string, multi?: boolean) => void;
  onOpenFile: (path: string) => void;
  onOpenExternalFile?: (name: string) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const activeId = selectedFileIds[selectedFileIds.length - 1];
  useEffect(() => {
    if (!activeId || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-file-id="${activeId}"]`);
    if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeId]);

  return (
    <div ref={listRef} className="h-full overflow-auto select-none">
      {/* Folders */}
      {folders.length > 0 && (
        <div className="border-b border-border/30">
          {folders.map((folder) => (
            <div
              key={`d-${folder}`}
              className="flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer hover:bg-bg-tertiary transition-colors"
              onDoubleClick={() => onEnterFolder(folder)}
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
      {/* PSD file list — 列順: 結果, ファイル名, 拡張子, カラー, サイズ, DPI, Bit, テキスト, ガイド */}
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 bg-bg-secondary z-10">
          <tr className="text-text-muted border-b border-border">
            <th className="text-center px-1.5 py-1.5 font-medium w-8"></th>
            <th className="text-left px-2 py-1.5 font-medium">ファイル名</th>
            <th className="text-center px-1 py-1.5 font-medium w-10">種類</th>
            <th className="text-center px-2 py-1.5 font-medium w-12">カラー</th>
            <th className="text-right px-2 py-1.5 font-medium w-20">サイズ</th>
            <th className="text-right px-2 py-1.5 font-medium w-10">DPI</th>
            <th className="text-center px-1 py-1.5 font-medium w-8">Bit</th>
            <th className="text-center px-1 py-1.5 font-medium w-10">テキスト</th>
            <th className="text-center px-1 py-1.5 font-medium w-10">ガイド</th>
          </tr>
        </thead>
        <tbody>
          {files.map((file) => {
            const result = checkResults.get(file.id);
            const isActive = selectedFileIds.includes(file.id);
            const hasNG = result && !result.passed;
            const isCaution = !hasNG && (outlierFileIds.has(file.id) || (hasTomboMix && file.metadata && !file.metadata.hasTombo));
            // テキストレイヤーの有無
            let hasText = false;
            if (file.metadata?.layerTree) {
              const walk = (nodes: any[]): boolean => {
                for (const n of nodes) {
                  if (n.type === "text" && n.visible && n.textInfo?.text?.trim()) return true;
                  if (n.children && walk(n.children)) return true;
                }
                return false;
              };
              hasText = walk(file.metadata.layerTree);
            }
            const ext = file.fileName.substring(file.fileName.lastIndexOf(".")).toLowerCase();
            const isPsd = ext === ".psd" || ext === ".psb";
            const isPdf = ext === ".pdf";
            // カラーモード日本語表記
            const colorJa: Record<string, string> = { RGB: "RGB", CMYK: "CMYK", Grayscale: "白黒", Bitmap: "BMP", Lab: "Lab", Indexed: "Idx", Multichannel: "MCh", Duotone: "Duo" };
            return (
              <tr
                key={file.id}
                data-file-id={file.id}
                className={`cursor-pointer transition-colors ${
                  hasNG ? "bg-error/20" : isCaution ? "bg-yellow-100" : isActive ? "bg-sky-100" : "hover:bg-bg-tertiary/60"
                }`}
                onClick={(e) => {
                  if (e.shiftKey) { usePsdStore.getState().selectRange(file.id); }
                  else { onSelectFile(file.id, e.ctrlKey || e.metaKey); }
                }}
                onDoubleClick={() => onOpenFile(file.filePath)}
              >
                {/* 結果 */}
                <td className="text-center px-1.5 py-1.5">
                  {result ? (
                    result.passed ? (
                      <span className="text-success font-bold text-[10px]">OK</span>
                    ) : (
                      <span className="text-error font-bold text-[10px]">NG</span>
                    )
                  ) : (
                    <span className="text-text-muted/30">—</span>
                  )}
                </td>
                {/* ファイル名（拡張子非表示） */}
                <td className="px-2 py-1.5 text-text-primary font-medium">
                  <div className="truncate max-w-[200px]">{file.fileName.replace(/\.[^.]+$/, "")}</div>
                </td>
                {/* 拡張子アイコン */}
                <td className="text-center px-1 py-1.5">
                  <span className={`text-[8px] font-bold px-1 py-0.5 rounded ${
                    isPsd ? "bg-accent-secondary/15 text-accent-secondary" : isPdf ? "bg-error/15 text-error" : "bg-text-muted/10 text-text-muted"
                  }`}>
                    {isPsd ? "PSD" : ext.substring(1).toUpperCase()}
                  </span>
                </td>
                {/* カラー */}
                <td className="text-center px-2 py-1.5 text-text-muted text-[10px]">
                  {file.metadata ? (colorJa[file.metadata.colorMode] || file.metadata.colorMode) : "—"}
                </td>
                {/* サイズ */}
                <td className="text-right px-2 py-1.5 text-text-muted tabular-nums whitespace-nowrap">
                  {file.metadata ? `${file.metadata.width}×${file.metadata.height}` : "—"}
                </td>
                {/* DPI */}
                <td className="text-right px-2 py-1.5 text-text-muted tabular-nums">
                  {file.metadata?.dpi || "—"}
                </td>
                {/* Bit */}
                <td className="text-center px-1 py-1.5 text-text-muted">
                  {file.metadata?.bitsPerChannel || "—"}
                </td>
                {/* テキスト */}
                <td className="text-center px-1 py-1.5">
                  {hasText ? (
                    <span className="text-accent-tertiary text-[9px]">あり</span>
                  ) : (
                    <span className="text-text-muted/30 text-[9px]">なし</span>
                  )}
                </td>
                {/* ガイド */}
                <td className="text-center px-1 py-1.5">
                  {file.metadata?.hasGuides ? (
                    <span className="text-guide-v text-[9px]">あり</span>
                  ) : (
                    <span className="text-text-muted/30 text-[9px]">なし</span>
                  )}
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
                  onClick={() => onOpenExternalFile?.(file)}
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

/** 左サイドバー折りたたみセクション */
function CollapsibleSidebarSection({ title, icon, children, defaultOpen = true }: { title: string; icon?: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-1.5 px-3 py-2 text-[10px] text-text-muted hover:text-text-primary">
        {icon}
        <span className="text-xs font-medium flex-1">{title}</span>
        <svg className={`w-3 h-3 transition-transform flex-shrink-0 ${open ? "rotate-90" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

/** ファイル階層ツリー（折りたたみ可能、サブフォルダ表示） */
function FolderBreadcrumbTree({ currentPath, onNavigate }: { currentPath: string; onNavigate: (path: string) => void }) {
  const [open, setOpen] = useState(true);
  const [subFolders, setSubFolders] = useState<string[]>([]);
  const rawParts = currentPath.replace(/\//g, "\\").split("\\").filter(Boolean);
  // ドライブレター修正: "C" → "C:"
  const parts = rawParts.map((p, i) => i === 0 && /^[A-Za-z]$/.test(p) ? p + ":" : p);

  // 現在フォルダのサブフォルダを取得
  useEffect(() => {
    if (!currentPath) { setSubFolders([]); return; }
    invoke<string[]>("list_subfolders", { folderPath: currentPath })
      .then((folders) => setSubFolders(folders.sort()))
      .catch(() => setSubFolders([]));
  }, [currentPath]);

  return (
    <div className="border-t border-border/40">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-1.5 px-4 py-2 text-[10px] text-text-muted hover:text-text-primary"
      >
        <span className="flex-1 text-left">フォルダ階層</span>
        <svg className={`w-3 h-3 transition-transform flex-shrink-0 ${open ? "rotate-90" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
      {open && (
        <div className="px-4 pb-3">
          {/* 親階層 */}
          {parts.map((part, i) => {
            const fullPath = parts.slice(0, i + 1).join("\\");
            const isLast = i === parts.length - 1;
            return (
              <div key={i} style={{ paddingLeft: `${i * 12}px` }}>
                <button
                  onClick={() => !isLast && onNavigate(fullPath)}
                  className={`flex items-center gap-1 text-[10px] py-0.5 rounded transition-colors ${
                    isLast ? "text-accent font-medium cursor-default" : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary cursor-pointer"
                  }`}
                >
                  <svg className="w-3 h-3 text-warning/70 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z" />
                  </svg>
                  {part}
                </button>
              </div>
            );
          })}
          {/* サブフォルダ */}
          {subFolders.map((sub) => {
            const subName = sub.split("\\").pop() || sub;
            return (
            <div key={sub} style={{ paddingLeft: `${parts.length * 12}px` }}>
              <button
                onClick={() => onNavigate(sub)}
                className="flex items-center gap-1 text-[10px] py-0.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-tertiary cursor-pointer transition-colors"
              >
                <svg className="w-3 h-3 text-warning/40 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z" />
                </svg>
                {subName}
              </button>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
