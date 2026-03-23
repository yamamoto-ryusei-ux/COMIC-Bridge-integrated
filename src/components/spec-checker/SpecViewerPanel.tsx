import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { usePsdStore } from "../../store/psdStore";
import { useScanPsdStore } from "../../store/scanPsdStore";
import {
  useHighResPreview,
  prefetchPreview,
  invalidateUrlCache,
} from "../../hooks/useHighResPreview";
import { useOpenFolder } from "../../hooks/useOpenFolder";
import { performPresetJsonSave } from "../../hooks/useScanPsdProcessor";
import { useFontResolver, collectTextLayers } from "../../hooks/useFontResolver";
import { SUB_NAME_PALETTE, ALL_SUB_NAMES } from "../../types/scanPsd";
import type { PresetJsonData } from "../../types/scanPsd";
import { TextLayerRow, type TextIssueFilter } from "./SpecTextGrid";
import { LayerTree } from "../metadata/LayerTree";
import { JsonFileBrowser } from "../scanPsd/JsonFileBrowser";
import { CaptureOverlay } from "./CaptureOverlay";
import { useFontBookStore } from "../../store/fontBookStore";
import type { FontBookEntry } from "../../types/fontBook";

const AA_SHARP_VALUES = new Set(["antiAliasSharp", "sharp", "Shrp"]);

function hasIssue(
  entry: { textInfo?: import("../../types").TextInfo },
  issue: TextIssueFilter,
): boolean {
  if (!entry.textInfo) return false;
  if (issue === "antiAlias") {
    const aa = entry.textInfo.antiAlias;
    return !!aa && !AA_SHARP_VALUES.has(aa);
  }
  if (issue === "tracking") {
    const t = entry.textInfo.tracking;
    return !!t && t.length > 0;
  }
  return false;
}

interface SpecViewerPanelProps {
  onOpenInPhotoshop?: (filePath: string) => void;
  initialFilterFont?: string | null;
  onFilterFontConsumed?: () => void;
  initialFilterIssue?: TextIssueFilter | null;
  onFilterIssueConsumed?: () => void;
  initialFilterStroke?: number | null;
  onFilterStrokeConsumed?: () => void;
}

export function SpecViewerPanel({
  onOpenInPhotoshop,
  initialFilterFont,
  onFilterFontConsumed,
  initialFilterIssue,
  onFilterIssueConsumed,
  initialFilterStroke,
  onFilterStrokeConsumed,
}: SpecViewerPanelProps) {
  const files = usePsdStore((s) => s.files);
  const selectedFileIds = usePsdStore((s) => s.selectedFileIds);
  const { openFolderForFile } = useOpenFolder();

  // Viewer index state
  const [viewerFileIndex, setViewerFileIndex] = useState(0);
  const viewerRef = useRef<HTMLDivElement>(null);

  // Sidebar tab
  const [sidebarTab, setSidebarTab] = useState<"text" | "layers">("text");
  // Text display options
  const [useActualFont, setUseActualFont] = useState(false);
  const [sortDesc, setSortDesc] = useState(false);
  // Font filter (3-state: null → filterOnly → filterAndHighlight)
  const [filterFont, setFilterFont] = useState<string | null>(null);
  const [filterHighlightAll, setFilterHighlightAll] = useState(false);
  // Issue filter (antiAlias / tracking)
  const [filterIssue, setFilterIssue] = useState<TextIssueFilter | null>(null);
  // Stroke filter (by stroke size in px)
  const [filterStroke, setFilterStroke] = useState<number | null>(null);
  // Text layer highlight (index in textLayers)
  const [highlightLayerIdx, setHighlightLayerIdx] = useState<number | null>(null);
  // Layer tree highlight (by layer id)
  const [highlightTreeLayerId, setHighlightTreeLayerId] = useState<string | null>(null);
  const [highlightTreeBounds, setHighlightTreeBounds] = useState<
    import("../../types").LayerBounds | null
  >(null);
  // Category dropdown state
  const [categoryDropdownFont, setCategoryDropdownFont] = useState<string | null>(null);
  // JSON file browser modal
  const [showJsonBrowser, setShowJsonBrowser] = useState(false);
  // Image save in progress
  const [isSavingImage, setIsSavingImage] = useState(false);
  // Font book capture mode
  const [isCapturing, setIsCapturing] = useState(false);
  const fontBookDir = useFontBookStore((s) => s.fontBookDir);

  // scanPsdStore — font category editing
  const currentJsonFilePath = useScanPsdStore((s) => s.currentJsonFilePath);
  const jsonFolderPath = useScanPsdStore((s) => s.jsonFolderPath);
  const presetSets = useScanPsdStore((s) => s.presetSets);
  const currentSetName = useScanPsdStore((s) => s.currentSetName);

  // Lookup: PostScript name → { index, subName } in current preset set
  const fontCategoryMap = useMemo(() => {
    const map = new Map<string, { index: number; subName: string }>();
    const presets = presetSets[currentSetName];
    if (!presets) return map;
    for (let i = 0; i < presets.length; i++) {
      const p = presets[i];
      if (p.font) map.set(p.font, { index: i, subName: p.subName || "" });
    }
    return map;
  }, [presetSets, currentSetName]);

  // JSON loading from viewer (via JsonFileBrowser)
  const handleJsonFileSelect = useCallback(async (filePath: string) => {
    setShowJsonBrowser(false);
    try {
      const content = await invoke<string>("read_text_file", { filePath });
      const data = JSON.parse(content) as PresetJsonData;
      const store = useScanPsdStore.getState();
      store.loadFromPresetJson(data);
      store.setCurrentJsonFilePath(filePath);
      // Try auto-linking scandata
      const pd = data.presetData;
      if (pd?.workInfo?.label && pd?.workInfo?.title) {
        const safeLabel = pd.workInfo.label.replace(/[\\/:*?"<>|]/g, "_");
        const safeTitle = pd.workInfo.title.replace(/[\\/:*?"<>|]/g, "_");
        const scandataPath =
          `${store.saveDataBasePath}/${safeLabel}/${safeTitle}_scandata.json`.replace(/\\/g, "/");
        try {
          const sc = await invoke<string>("read_text_file", { filePath: scandataPath });
          store.setScanData(JSON.parse(sc));
          store.setCurrentScandataFilePath(scandataPath);
        } catch {
          /* scandata not found, ok */
        }
        // フォント帳も読み込み
        useFontBookStore
          .getState()
          .loadFontBook(store.textLogFolderPath, pd.workInfo.label, pd.workInfo.title);
      }
    } catch (e) {
      console.error("Failed to load JSON:", e);
    }
  }, []);

  // Update font category
  const updateFontCategory = useCallback(
    async (font: string, subName: string) => {
      const entry = fontCategoryMap.get(font);
      if (!entry) return;
      useScanPsdStore.getState().updateFontInPreset(currentSetName, entry.index, { subName });
      setCategoryDropdownFont(null);
      // Auto-save JSON
      try {
        await performPresetJsonSave();
      } catch {
        /* ignore */
      }
    },
    [fontCategoryMap, currentSetName],
  );

  // Close category dropdown on outside click
  useEffect(() => {
    if (!categoryDropdownFont) return;
    const handleClick = () => setCategoryDropdownFont(null);
    window.addEventListener("mousedown", handleClick);
    return () => window.removeEventListener("mousedown", handleClick);
  }, [categoryDropdownFont]);

  // Apply initial filter from parent (e.g. clicking font badge in SpecTextGrid)
  useEffect(() => {
    if (initialFilterFont) {
      setFilterFont(initialFilterFont);
      setFilterHighlightAll(false);
      setFilterIssue(null);
      setFilterStroke(null);
      onFilterFontConsumed?.();
    }
  }, [initialFilterFont]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply initial issue filter from parent (e.g. clicking AA/tracking badge in SpecTextGrid)
  useEffect(() => {
    if (initialFilterIssue) {
      setFilterIssue(initialFilterIssue);
      setFilterFont(null);
      setFilterStroke(null);
      setFilterHighlightAll(true); // 問題レイヤーを全ハイライト
      onFilterIssueConsumed?.();
    }
  }, [initialFilterIssue]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply initial stroke filter from parent (e.g. clicking stroke badge in SpecTextGrid)
  useEffect(() => {
    if (initialFilterStroke != null) {
      setFilterStroke(initialFilterStroke);
      setFilterFont(null);
      setFilterIssue(null);
      setFilterHighlightAll(true);
      onFilterStrokeConsumed?.();
    }
  }, [initialFilterStroke]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fullscreen mode (true OS fullscreen via Tauri)
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showEscHint, setShowEscHint] = useState(false);
  // Splash phases: "hidden" → "in" (fade-in) → "hold" (covering) → "out" (fade-out) → "hidden"
  const [splashPhase, setSplashPhase] = useState<"hidden" | "in" | "hold" | "out">("hidden");
  const transitionLock = useRef(false);

  const toggleFullscreen = useCallback(
    async (force?: boolean) => {
      const next = force !== undefined ? force : !isFullscreen;
      if (next === isFullscreen || transitionLock.current) return;
      transitionLock.current = true;

      // 1) Show splash (fade in white cover)
      setSplashPhase("in");
      await new Promise((r) => setTimeout(r, 200));

      // 2) Splash now fully covers screen — toggle OS fullscreen behind it
      setSplashPhase("hold");
      try {
        await getCurrentWindow().setFullscreen(next);
      } catch {
        /* ignore */
      }
      setIsFullscreen(next);

      // 3) Let OS settle while splash still covers
      await new Promise((r) => setTimeout(r, 200));

      // 4) Fade splash out, revealing new layout
      setSplashPhase("out");
      await new Promise((r) => setTimeout(r, 350));

      setSplashPhase("hidden");
      transitionLock.current = false;

      if (next) {
        setShowEscHint(true);
      }
    },
    [isFullscreen],
  );

  // Auto-hide ESC hint after 2.5s
  useEffect(() => {
    if (!showEscHint) return;
    const timer = setTimeout(() => setShowEscHint(false), 2500);
    return () => clearTimeout(timer);
  }, [showEscHint]);

  // Restore window when component unmounts (e.g. tab switch)
  useEffect(() => {
    return () => {
      if (isFullscreen) {
        getCurrentWindow()
          .setFullscreen(false)
          .catch(() => {});
      }
    };
  }, [isFullscreen]);

  // Filtered file indices (when a font, issue, or stroke filter is active)
  const filteredIndices = useMemo(() => {
    if (!filterFont && !filterIssue && filterStroke == null) return null;
    return files
      .map((f, i) => ({ f, i }))
      .filter(({ f }) => {
        if (!f.metadata?.layerTree) return false;
        const layers = collectTextLayers(f.metadata.layerTree);
        if (filterFont) return layers.some((e) => e.textInfo?.fonts.includes(filterFont));
        if (filterIssue) return layers.some((e) => hasIssue(e, filterIssue));
        if (filterStroke != null)
          return layers.some((e) => e.textInfo?.strokeSize === filterStroke);
        return false;
      })
      .map(({ i }) => i);
  }, [files, filterFont, filterIssue, filterStroke]);

  // Position within filtered list
  const filteredPos = useMemo(() => {
    if (!filteredIndices) return -1;
    return filteredIndices.indexOf(viewerFileIndex);
  }, [filteredIndices, viewerFileIndex]);

  // Jump to first matching file when filter is activated
  useEffect(() => {
    if (!filteredIndices || filteredIndices.length === 0) return;
    if (!filteredIndices.includes(viewerFileIndex)) {
      setViewerFileIndex(filteredIndices[0]);
    }
  }, [filterFont, filterIssue, filterStroke]); // eslint-disable-line react-hooks/exhaustive-deps

  const viewerFile = files[viewerFileIndex] ?? files[0] ?? null;

  // Font resolver (for all files, consistent colors)
  const { fontInfo } = useFontResolver(files);

  // High-res preview
  const {
    imageUrl,
    isLoading,
    error: viewerError,
    reload: viewerReload,
  } = useHighResPreview(viewerFile?.filePath, {
    maxSize: 2000,
    enabled: !!viewerFile,
    pdfPageIndex: viewerFile?.pdfPageIndex,
    pdfSourcePath: viewerFile?.pdfSourcePath,
  });

  // Text layers for current file
  const textLayers = useMemo(() => {
    if (!viewerFile?.metadata?.layerTree) return [];
    return collectTextLayers(viewerFile.metadata.layerTree);
  }, [viewerFile]);

  // PSD dimensions for SVG overlay
  const psdWidth = viewerFile?.metadata?.width ?? 0;
  const psdHeight = viewerFile?.metadata?.height ?? 0;

  // Highlighted layer bounds (single selection from text tab or layer tree tab)
  const highlightBounds = useMemo(() => {
    if (highlightTreeBounds) return highlightTreeBounds;
    if (highlightLayerIdx == null) return null;
    return textLayers[highlightLayerIdx]?.bounds ?? null;
  }, [highlightLayerIdx, textLayers, highlightTreeBounds]);

  // All matching bounds when filterHighlightAll is active
  const filterHighlightBoundsList = useMemo(() => {
    if (!filterHighlightAll) return [];
    if (filterFont) {
      return textLayers
        .filter((e) => e.textInfo?.fonts.includes(filterFont))
        .map((e) => e.bounds)
        .filter((b): b is import("../../types").LayerBounds => !!b);
    }
    if (filterIssue) {
      return textLayers
        .filter((e) => hasIssue(e, filterIssue))
        .map((e) => e.bounds)
        .filter((b): b is import("../../types").LayerBounds => !!b);
    }
    if (filterStroke != null) {
      return textLayers
        .filter((e) => e.textInfo?.strokeSize === filterStroke)
        .map((e) => e.bounds)
        .filter((b): b is import("../../types").LayerBounds => !!b);
    }
    return [];
  }, [filterHighlightAll, filterFont, filterIssue, filterStroke, textLayers]);

  // Reset highlight when file changes
  useEffect(() => {
    setHighlightLayerIdx(null);
    setHighlightTreeLayerId(null);
    setHighlightTreeBounds(null);
  }, [viewerFileIndex]);

  // Detect which issues exist across all files
  const existingIssues = useMemo(() => {
    let hasAA = false;
    let hasTracking = false;
    for (const f of files) {
      if (!f.metadata?.layerTree) continue;
      const layers = collectTextLayers(f.metadata.layerTree);
      for (const e of layers) {
        if (!hasAA && hasIssue(e, "antiAlias")) hasAA = true;
        if (!hasTracking && hasIssue(e, "tracking")) hasTracking = true;
        if (hasAA && hasTracking) break;
      }
      if (hasAA && hasTracking) break;
    }
    return { hasAA, hasTracking };
  }, [files]);

  // Detect which stroke sizes exist across all files (sorted by frequency)
  const existingStrokes = useMemo(() => {
    const counts = new Map<number, number>();
    for (const f of files) {
      if (!f.metadata?.layerTree) continue;
      const layers = collectTextLayers(f.metadata.layerTree);
      for (const e of layers) {
        const s = e.textInfo?.strokeSize;
        if (s != null && s > 0) counts.set(s, (counts.get(s) || 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [files]);

  // Per-file font summary
  const fileFonts = useMemo(() => {
    const fontSet = new Set<string>();
    for (const entry of textLayers) {
      if (!entry.textInfo) continue;
      for (const font of entry.textInfo.fonts) {
        fontSet.add(font);
      }
    }
    return [...fontSet];
  }, [textLayers]);

  // 表示中ファイルが外部変更された場合、自動リロード
  useEffect(() => {
    if (!viewerFile?.fileChanged || !viewerFile.filePath) return;
    // キャッシュ無効化 → プレビューリロード → メタデータ再取得
    invalidateUrlCache(viewerFile.filePath);
    invoke("invalidate_file_cache", { filePath: viewerFile.filePath }).catch(() => {});
    viewerReload();
    // メタデータ再取得
    invoke("parse_psd_metadata_batch", { filePaths: [viewerFile.filePath] })
      .then((results: unknown) => {
        const arr = results as { metadata?: unknown; thumbnailData?: string; fileSize?: number }[];
        if (arr?.[0]?.metadata) {
          const r = arr[0];
          const thumbnailUrl = r.thumbnailData
            ? `data:image/jpeg;base64,${r.thumbnailData}`
            : undefined;
          usePsdStore.getState().updateFile(viewerFile.id, {
            metadata: r.metadata as import("../../types").PsdMetadata,
            thumbnailUrl,
            thumbnailStatus: "ready",
            fileSize: r.fileSize,
            fileChanged: false,
          });
        }
      })
      .catch(() => {});
  }, [viewerFile?.fileChanged, viewerFile?.id]);

  // Reset index when files change
  useEffect(() => {
    setViewerFileIndex(0);
  }, [files.length]);

  // Sync index when sidebar selection changes
  useEffect(() => {
    if (selectedFileIds.length === 0) return;
    const idx = files.findIndex((f) => f.id === selectedFileIds[0]);
    if (idx >= 0) setViewerFileIndex(idx);
  }, [selectedFileIds, files]);

  // Prefetch adjacent files (±3)
  useEffect(() => {
    if (files.length <= 1) return;
    for (let offset = 1; offset <= 3; offset++) {
      for (const idx of [viewerFileIndex - offset, viewerFileIndex + offset]) {
        if (idx < 0 || idx >= files.length) continue;
        const f = files[idx];
        if (!f?.filePath) continue;
        prefetchPreview(f.filePath, 2000, f.pdfPageIndex, f.pdfSourcePath);
      }
    }
  }, [viewerFileIndex, files]);

  // Navigate to next/prev, respecting font filter
  const navigatePrev = useCallback(() => {
    if (filteredIndices) {
      const pos = filteredIndices.indexOf(viewerFileIndex);
      if (pos > 0) setViewerFileIndex(filteredIndices[pos - 1]);
    } else {
      setViewerFileIndex((i) => Math.max(0, i - 1));
    }
  }, [filteredIndices, viewerFileIndex]);

  const navigateNext = useCallback(() => {
    if (filteredIndices) {
      const pos = filteredIndices.indexOf(viewerFileIndex);
      if (pos >= 0 && pos < filteredIndices.length - 1)
        setViewerFileIndex(filteredIndices[pos + 1]);
    } else {
      setViewerFileIndex((i) => Math.min(files.length - 1, i + 1));
    }
  }, [filteredIndices, viewerFileIndex, files.length]);

  const canGoPrev = filteredIndices
    ? filteredIndices.indexOf(viewerFileIndex) > 0
    : viewerFileIndex > 0;
  const canGoNext = filteredIndices
    ? (() => {
        const p = filteredIndices.indexOf(viewerFileIndex);
        return p >= 0 && p < filteredIndices.length - 1;
      })()
    : viewerFileIndex < files.length - 1;
  const navTotal = filteredIndices ? filteredIndices.length : files.length;
  const navPos = filteredIndices ? filteredPos + 1 : viewerFileIndex + 1;

  // Keyboard navigation + Escape for fullscreen
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Escape" && isFullscreen) {
        e.preventDefault();
        toggleFullscreen(false);
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        navigatePrev();
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        navigateNext();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFullscreen, toggleFullscreen, navigatePrev, navigateNext]);

  // Mouse wheel navigation
  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.deltaY > 0) navigateNext();
      else if (e.deltaY < 0) navigatePrev();
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [isFullscreen, navigateNext, navigatePrev]);

  // P/F shortcuts (capture phase)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!viewerFile) return;

      if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (onOpenInPhotoshop) onOpenInPhotoshop(viewerFile.filePath);
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        e.stopImmediatePropagation();
        openFolderForFile(viewerFile.filePath);
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [viewerFile, onOpenInPhotoshop, openFolderForFile]);

  // 画像保存（現在のページ + 全マーカー描画）
  const handleSaveAsImage = useCallback(async () => {
    if (!imageUrl) return;

    const filterLabel = filterFont
      ? fontInfo.getFontLabel(filterFont).replace(/\s+/g, "")
      : (filterIssue ?? (filterStroke != null ? `白フチ${filterStroke}px` : "filter"));

    const baseName = (viewerFile?.fileName ?? "page").replace(/\.[^.]+$/, "");
    const selected = await save({
      defaultPath: `${filterLabel}_${baseName}.png`,
      filters: [{ name: "PNG画像", extensions: ["png"] }],
    });
    if (!selected) return;
    const outputPath = selected.replace(/\\/g, "/");

    setIsSavingImage(true);

    try {
      // 画像をCanvasに直接描画（html2canvasはasset://プロトコルで失敗するため）
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Image load failed"));
        img.src = imageUrl;
      });

      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);

      // 全マーカーを描画
      const pw = viewerFile?.metadata?.width ?? 0;
      const ph = viewerFile?.metadata?.height ?? 0;
      if (pw > 0 && ph > 0) {
        const scaleX = canvas.width / pw;
        const scaleY = canvas.height / ph;

        // 該当フォント/フィルタの全バウンズを取得
        const currentLayers = viewerFile?.metadata?.layerTree
          ? collectTextLayers(viewerFile.metadata.layerTree)
          : [];
        let bounds: import("../../types").LayerBounds[] = [];
        if (filterFont) {
          bounds = currentLayers
            .filter((e) => e.textInfo?.fonts.includes(filterFont))
            .map((e) => e.bounds)
            .filter((b): b is import("../../types").LayerBounds => !!b);
        } else if (filterIssue) {
          bounds = currentLayers
            .filter((e) => hasIssue(e, filterIssue))
            .map((e) => e.bounds)
            .filter((b): b is import("../../types").LayerBounds => !!b);
        } else if (filterStroke != null) {
          bounds = currentLayers
            .filter((e) => e.textInfo?.strokeSize === filterStroke)
            .map((e) => e.bounds)
            .filter((b): b is import("../../types").LayerBounds => !!b);
        }

        const color = filterFont
          ? fontInfo.getFontColor(filterFont)
          : filterStroke != null
            ? "#00c9a7"
            : "#c25a5a";
        const lineWidth = Math.max(3, pw * 0.002) * scaleX;

        for (const b of bounds) {
          const x = b.left * scaleX;
          const y = b.top * scaleY;
          const w = (b.right - b.left) * scaleX;
          const h = (b.bottom - b.top) * scaleY;
          const r = 4 * Math.min(scaleX, scaleY);

          // 塗り（半透明）
          ctx.globalAlpha = 0.09;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.roundRect(x, y, w, h, r);
          ctx.fill();

          // 枠線
          ctx.globalAlpha = 0.44;
          ctx.strokeStyle = color;
          ctx.lineWidth = lineWidth;
          ctx.beginPath();
          ctx.roundRect(x, y, w, h, r);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
      });
      const arrayBuffer = await blob.arrayBuffer();
      await writeFile(outputPath, new Uint8Array(arrayBuffer));

      // 保存完了後にフォルダを開く
      try {
        const folderPath = outputPath.replace(/\/[^/]+$/, "").replace(/\//g, "\\");
        await invoke("open_folder_in_explorer", { folderPath });
      } catch {
        /* ignore */
      }
    } catch (err) {
      console.error("Failed to save image:", err);
    } finally {
      setIsSavingImage(false);
    }
  }, [filterFont, filterIssue, filterStroke, fontInfo, imageUrl, viewerFile, viewerFileIndex]);

  // フォント帳キャプチャ
  const handleFontBookCapture = useCallback(
    async (
      region: { x: number; y: number; width: number; height: number },
      font: import("../../types/scanPsd").FontPreset,
    ) => {
      if (!imageUrl) return;
      setIsCapturing(false);

      // ストアから最新のfontBookDirを取得（コールバック閉包の古い値を避ける）
      const store = useFontBookStore.getState();
      let dir = store.fontBookDir;

      // fontBookDirが未設定なら今のworkInfoから初期化を試みる
      if (!dir) {
        const scanStore = useScanPsdStore.getState();
        const { textLogFolderPath, workInfo } = scanStore;
        if (workInfo.label && workInfo.title) {
          await store.loadFontBook(textLogFolderPath, workInfo.label, workInfo.title);
          dir = useFontBookStore.getState().fontBookDir;
        }
      }
      if (!dir) {
        console.warn("Font book: fontBookDir is null, cannot save");
        return;
      }

      try {
        const img = new Image();
        img.crossOrigin = "anonymous";
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error("Image load failed"));
          img.src = imageUrl;
        });

        const pw = viewerFile?.metadata?.width ?? 0;
        const ph = viewerFile?.metadata?.height ?? 0;
        if (pw === 0 || ph === 0) return;

        const scaleX = img.naturalWidth / pw;
        const scaleY = img.naturalHeight / ph;

        const sx = region.x * scaleX;
        const sy = region.y * scaleY;
        const sw = region.width * scaleX;
        const sh = region.height * scaleY;

        const canvas = document.createElement("canvas");
        canvas.width = Math.round(sw);
        canvas.height = Math.round(sh);
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
            "image/jpeg",
            0.92,
          );
        });
        const arrayBuffer = await blob.arrayBuffer();

        const entry: FontBookEntry = {
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          fontPostScript: font.font,
          fontDisplayName: font.name,
          subName: font.subName || "",
          sourceFile: viewerFile?.fileName || "",
          capturedAt: new Date().toISOString(),
        };

        await useFontBookStore.getState().addEntry(entry, new Uint8Array(arrayBuffer));
      } catch (err) {
        console.error("Font book capture failed:", err);
      }
    },
    [imageUrl, viewerFile],
  );

  // キャプチャ用フォント一覧
  const capturefonts = useMemo(
    () => presetSets[currentSetName] || [],
    [presetSets, currentSetName],
  );

  if (files.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[11px] text-text-muted">
        ファイルを読み込んでください
      </div>
    );
  }

  const viewerContent = (
    <div
      className={`flex select-none ${isFullscreen ? "fixed inset-0 z-[9999] bg-[#0e0e10]" : "h-full"}`}
    >
      {/* Image Viewer */}
      <div
        ref={viewerRef}
        className="flex-1 overflow-hidden relative flex items-center justify-center bg-[#1a1a1e]"
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={viewerFile?.fileName}
            className={`max-w-full max-h-full object-contain select-none transition-opacity duration-150 ${isLoading ? "opacity-40" : "opacity-100"}`}
            draggable={false}
          />
        ) : viewerFile?.thumbnailUrl ? (
          <img
            src={viewerFile.thumbnailUrl}
            alt={viewerFile.fileName}
            className="max-w-full max-h-full object-contain select-none opacity-60"
            draggable={false}
          />
        ) : null}

        {/* SVG highlight overlay — single selection or filter-all highlights */}
        {psdWidth > 0 && (highlightBounds || filterHighlightBoundsList.length > 0) && (
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            viewBox={`0 0 ${psdWidth} ${psdHeight}`}
            preserveAspectRatio="xMidYMid meet"
          >
            {filterHighlightBoundsList.length > 0
              ? filterHighlightBoundsList.map((b, i) => (
                  <rect
                    key={i}
                    x={b.left}
                    y={b.top}
                    width={b.right - b.left}
                    height={b.bottom - b.top}
                    fill={`${filterFont ? fontInfo.getFontColor(filterFont) : filterStroke != null ? "#00c9a7" : "#c25a5a"}18`}
                    stroke={`${filterFont ? fontInfo.getFontColor(filterFont) : filterStroke != null ? "#00c9a7" : "#c25a5a"}70`}
                    strokeWidth={Math.max(3, psdWidth * 0.002)}
                    rx={4}
                  />
                ))
              : highlightBounds && (
                  <rect
                    x={highlightBounds.left}
                    y={highlightBounds.top}
                    width={highlightBounds.right - highlightBounds.left}
                    height={highlightBounds.bottom - highlightBounds.top}
                    fill="rgba(194, 90, 90, 0.12)"
                    stroke="rgba(194, 90, 90, 0.45)"
                    strokeWidth={Math.max(3, psdWidth * 0.002)}
                    rx={4}
                  />
                )}
          </svg>
        )}

        {/* Loading spinner */}
        {isLoading && (
          <div className="absolute top-3 right-3 z-10">
            <div className="w-5 h-5 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
          </div>
        )}

        {/* Error state */}
        {viewerError && !imageUrl && (
          <div className="flex flex-col items-center gap-2 text-center px-6">
            <svg
              className="w-8 h-8 text-error/50"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
              />
            </svg>
            <p className="text-[11px] text-text-muted">プレビューの読み込みに失敗</p>
            <button
              onClick={viewerReload}
              className="text-[10px] text-accent hover:text-accent/80 transition-colors"
            >
              再試行
            </button>
          </div>
        )}

        {/* Capture overlay */}
        {isCapturing && psdWidth > 0 && imageUrl && capturefonts.length > 0 && (
          <CaptureOverlay
            imageUrl={imageUrl}
            psdWidth={psdWidth}
            psdHeight={psdHeight}
            containerRef={viewerRef}
            fonts={capturefonts}
            defaultFontPostScript={filterFont}
            onCapture={handleFontBookCapture}
            onCancel={() => setIsCapturing(false)}
          />
        )}

        {/* Fullscreen toggle */}
        <button
          onClick={() => toggleFullscreen()}
          className="absolute top-3 left-3 z-10 w-8 h-8 rounded-lg bg-black/50 hover:bg-black/70 flex items-center justify-center text-white/70 hover:text-white transition-all backdrop-blur-sm"
          title={isFullscreen ? "全画面を解除 (Esc)" : "全画面表示"}
        >
          {isFullscreen ? (
            /* Minimize / exit fullscreen: inward arrows at corners */
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4l4 4M4 4v3m0-3h3" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 4l-4 4M20 4v3m0-3h-3" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 20l4-4M4 20v-3m0 3h3" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 20l-4-4M20 20v-3m0 3h-3" />
            </svg>
          ) : (
            /* Maximize / enter fullscreen: outward arrows at corners */
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 3h6m0 0v6m0-6l-7 7" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 21H3m0 0v-6m0 6l7-7" />
            </svg>
          )}
        </button>

        {/* Font book capture button — only when JSON is loaded */}
        {currentJsonFilePath && fontBookDir && !isCapturing && (
          <button
            onClick={() => setIsCapturing(true)}
            className="absolute top-3 left-12 z-10 w-8 h-8 rounded-lg bg-black/50 hover:bg-black/70 flex items-center justify-center text-white/70 hover:text-white transition-all backdrop-blur-sm"
            title="フォント帳にキャプチャ"
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
                d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </button>
        )}

        {/* ESC hint (auto-fade) */}
        {isFullscreen && showEscHint && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 px-4 py-2 rounded-xl bg-black/60 backdrop-blur-md text-white/90 text-xs font-medium animate-fade-hint pointer-events-none">
            Esc で全画面を解除
          </div>
        )}

        {/* Navigation arrows */}
        {navTotal > 1 && (
          <>
            {canGoPrev && (
              <button
                onClick={navigatePrev}
                className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center text-white/70 hover:text-white transition-all backdrop-blur-sm"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            {canGoNext && (
              <button
                onClick={navigateNext}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center text-white/70 hover:text-white transition-all backdrop-blur-sm"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )}
          </>
        )}
      </div>

      {/* Sidebar */}
      <div className="w-[320px] flex-shrink-0 border-l border-border bg-bg-secondary flex flex-col">
        {/* File header */}
        <div className="px-3 py-2 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-display font-medium text-text-primary truncate flex-1">
              {viewerFile?.fileName}
            </span>
            {files.length > 1 && (
              <span className="text-[10px] text-text-muted flex-shrink-0">
                {navPos} / {navTotal}
                {(filterFont || filterIssue || filterStroke != null) && (
                  <span className="text-accent">
                    {" "}
                    (絞込
                    {filterIssue === "antiAlias"
                      ? ": AA"
                      : filterIssue === "tracking"
                        ? ": カーニング"
                        : filterStroke != null
                          ? `: 白フチ${filterStroke}px`
                          : ""}
                    )
                  </span>
                )}
              </span>
            )}
            {viewerFile && (
              <button
                className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded transition-all text-text-muted hover:text-text-primary hover:bg-bg-tertiary active:scale-95"
                onClick={() => openFolderForFile(viewerFile.filePath)}
                title="フォルダを開く (F)"
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
            {onOpenInPhotoshop && viewerFile && (
              <button
                className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded transition-all text-[#31A8FF] hover:bg-[#31A8FF]/15 active:scale-95"
                onClick={() => onOpenInPhotoshop(viewerFile.filePath)}
                title="Photoshopで開く (P)"
              >
                <span className="text-sm font-bold leading-none">P</span>
              </button>
            )}
          </div>
          {/* Metadata badges */}
          {viewerFile?.metadata && (
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] text-text-muted">
                {viewerFile.metadata.width} x {viewerFile.metadata.height}
              </span>
              <span className="text-[10px] text-text-muted">{viewerFile.metadata.dpi} dpi</span>
              <span className="text-[10px] text-text-muted">{viewerFile.metadata.colorMode}</span>
            </div>
          )}
        </div>

        {/* Sidebar tab switcher */}
        <div className="px-3 py-1.5 border-b border-border flex-shrink-0">
          <div className="flex bg-bg-elevated rounded-md p-0.5 border border-white/5">
            <button
              onClick={() => setSidebarTab("text")}
              className={`flex-1 px-2 py-1 text-[10px] rounded transition-all ${
                sidebarTab === "text"
                  ? "bg-bg-tertiary text-text-primary font-medium shadow-sm"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              写植仕様
            </button>
            <button
              onClick={() => setSidebarTab("layers")}
              className={`flex-1 px-2 py-1 text-[10px] rounded transition-all ${
                sidebarTab === "layers"
                  ? "bg-bg-tertiary text-text-primary font-medium shadow-sm"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              レイヤー構造
            </button>
          </div>
        </div>

        {/* Sidebar content */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
          {sidebarTab === "text" ? (
            <div className="p-2 space-y-1.5">
              {/* Font filter bar — always shows all fonts */}
              {fontInfo.allFontNames.length > 0 && (
                <div className="px-1 pb-1.5 border-b border-border/30 mb-1.5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <svg
                      className="w-3 h-3 text-text-muted flex-shrink-0"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
                      />
                    </svg>
                    <span className="text-[9px] text-text-muted">フォント絞り込み</span>
                    {(existingIssues.hasAA || existingIssues.hasTracking) && (
                      <div className="flex items-center gap-1">
                        {existingIssues.hasAA && (
                          <button
                            className={`text-[9px] px-1.5 py-0.5 rounded font-medium transition-all ${
                              filterIssue === "antiAlias"
                                ? filterHighlightAll
                                  ? "bg-error/25 text-error ring-1 ring-error/50"
                                  : "bg-error/20 text-error ring-1 ring-error/30"
                                : "bg-error/10 text-error/60 hover:bg-error/15 hover:text-error"
                            }`}
                            title={
                              filterIssue === "antiAlias"
                                ? filterHighlightAll
                                  ? "ハイライト解除"
                                  : "該当レイヤーをすべてハイライト"
                                : "AA問題のあるページに絞り込み"
                            }
                            onClick={() => {
                              if (filterIssue === "antiAlias") {
                                setFilterHighlightAll(!filterHighlightAll);
                              } else {
                                setFilterIssue("antiAlias");
                                setFilterFont(null);
                                setFilterStroke(null);
                                setFilterHighlightAll(true);
                              }
                            }}
                          >
                            AA問題
                          </button>
                        )}
                        {existingIssues.hasTracking && (
                          <button
                            className={`text-[9px] px-1.5 py-0.5 rounded font-medium transition-all ${
                              filterIssue === "tracking"
                                ? filterHighlightAll
                                  ? "bg-error/25 text-error ring-1 ring-error/50"
                                  : "bg-error/20 text-error ring-1 ring-error/30"
                                : "bg-error/10 text-error/60 hover:bg-error/15 hover:text-error"
                            }`}
                            title={
                              filterIssue === "tracking"
                                ? filterHighlightAll
                                  ? "ハイライト解除"
                                  : "該当レイヤーをすべてハイライト"
                                : "カーニング問題のあるページに絞り込み"
                            }
                            onClick={() => {
                              if (filterIssue === "tracking") {
                                setFilterHighlightAll(!filterHighlightAll);
                              } else {
                                setFilterIssue("tracking");
                                setFilterFont(null);
                                setFilterStroke(null);
                                setFilterHighlightAll(true);
                              }
                            }}
                          >
                            カーニング問題
                          </button>
                        )}
                      </div>
                    )}
                    {existingStrokes.length > 0 && (
                      <div className="flex items-center gap-1">
                        {existingStrokes.map(([size]) => (
                          <button
                            key={size}
                            className={`text-[9px] px-1.5 py-0.5 rounded font-medium transition-all ${
                              filterStroke === size
                                ? filterHighlightAll
                                  ? "bg-accent-tertiary/25 text-accent-tertiary ring-1 ring-accent-tertiary/50"
                                  : "bg-accent-tertiary/20 text-accent-tertiary ring-1 ring-accent-tertiary/30"
                                : "bg-accent-tertiary/10 text-accent-tertiary/60 hover:bg-accent-tertiary/15 hover:text-accent-tertiary"
                            }`}
                            title={
                              filterStroke === size
                                ? filterHighlightAll
                                  ? "ハイライト解除"
                                  : "該当レイヤーをすべてハイライト"
                                : `白フチ${size}pxのページに絞り込み`
                            }
                            onClick={() => {
                              if (filterStroke === size) {
                                setFilterHighlightAll(!filterHighlightAll);
                              } else {
                                setFilterStroke(size);
                                setFilterFont(null);
                                setFilterIssue(null);
                                setFilterHighlightAll(true);
                              }
                            }}
                          >
                            白フチ{size}px
                          </button>
                        ))}
                      </div>
                    )}
                    {(filterFont || filterIssue || filterStroke != null) && (
                      <>
                        <button
                          className={`ml-auto text-[9px] px-1.5 py-0.5 rounded border border-accent-secondary/40 text-accent-secondary transition-all flex items-center gap-1 ${isSavingImage ? "opacity-50 cursor-not-allowed" : "hover:bg-accent-secondary/10"}`}
                          onClick={handleSaveAsImage}
                          disabled={isSavingImage}
                          title="現在のページを全マーカー付きで画像保存"
                        >
                          {isSavingImage ? (
                            <div className="w-3 h-3 rounded-full border-2 border-accent-secondary/30 border-t-accent-secondary animate-spin" />
                          ) : (
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
                                d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                              />
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                              />
                            </svg>
                          )}
                          画像保存
                        </button>
                        <button
                          className="text-[9px] px-1.5 py-0.5 rounded text-accent hover:bg-accent/10 transition-all"
                          onClick={() => {
                            setFilterFont(null);
                            setFilterIssue(null);
                            setFilterStroke(null);
                            setFilterHighlightAll(false);
                          }}
                        >
                          解除
                        </button>
                      </>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-2 gap-y-1">
                    {fontInfo.allFontNames.map((font) => {
                      const color = fontInfo.getFontColor(font);
                      const missing = fontInfo.isMissing(font);
                      const isFiltered = filterFont === font;
                      const isHighlightAll = isFiltered && filterHighlightAll;
                      const isOnCurrentPage = fileFonts.includes(font);
                      const catEntry = currentJsonFilePath ? fontCategoryMap.get(font) : undefined;
                      const catPalette = catEntry?.subName
                        ? SUB_NAME_PALETTE[catEntry.subName]
                        : undefined;
                      return (
                        <span
                          key={font}
                          className={`inline-flex items-center gap-0.5 ${!isOnCurrentPage && !isFiltered ? "opacity-40" : ""}`}
                        >
                          <button
                            className={`text-[9px] px-1.5 py-0.5 rounded-l font-medium transition-all ${
                              isFiltered
                                ? `ring-1 ring-offset-1 ring-offset-bg-secondary${isHighlightAll ? " ring-2" : ""}`
                                : "hover:brightness-125"
                            } ${!catEntry && !missing ? "rounded-r" : ""}`}
                            style={{
                              backgroundColor: isHighlightAll
                                ? `${color}45`
                                : isFiltered
                                  ? `${color}30`
                                  : `${color}15`,
                              color,
                              ...(isFiltered
                                ? ({ "--tw-ring-color": color } as React.CSSProperties)
                                : {}),
                              ...(missing ? { textDecoration: "line-through" } : {}),
                            }}
                            title={
                              isHighlightAll
                                ? "フィルター解除"
                                : isFiltered
                                  ? "全レイヤーをハイライト"
                                  : `${fontInfo.getFontLabel(font)} のページだけ表示`
                            }
                            onClick={() => {
                              if (isHighlightAll) {
                                // 3rd click: turn off highlight, keep filter
                                setFilterHighlightAll(false);
                              } else if (isFiltered) {
                                // 2nd click: highlight all
                                setFilterHighlightAll(true);
                              } else {
                                // 1st click: filter
                                setFilterFont(font);
                                setFilterIssue(null);
                                setFilterStroke(null);
                                setFilterHighlightAll(false);
                              }
                            }}
                          >
                            {fontInfo.getFontLabel(font)}
                            {missing && " !"}
                          </button>
                          {catEntry && (
                            <div className="relative">
                              <button
                                className="text-[8px] px-1 py-0.5 rounded-r transition-all hover:brightness-125"
                                style={{
                                  backgroundColor: catPalette
                                    ? `${catPalette.color}18`
                                    : "rgba(255,255,255,0.05)",
                                  color: catPalette?.color || "#888",
                                }}
                                title="カテゴリ変更"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setCategoryDropdownFont(
                                    categoryDropdownFont === font ? null : font,
                                  );
                                }}
                              >
                                {catEntry.subName || "—"}
                                <span className="ml-0.5 opacity-50">▾</span>
                              </button>
                              {categoryDropdownFont === font && (
                                <div
                                  className="absolute top-full right-0 mt-1 z-50 py-1 rounded-lg bg-bg-secondary border border-border shadow-xl min-w-[120px]"
                                  onMouseDown={(e) => e.stopPropagation()}
                                >
                                  {ALL_SUB_NAMES.map((name) => {
                                    const p = SUB_NAME_PALETTE[name];
                                    return (
                                      <button
                                        key={name}
                                        className={`block w-full text-left text-[9px] px-2.5 py-1 transition-colors ${
                                          catEntry.subName === name ? "font-bold" : ""
                                        }`}
                                        style={{ color: p?.color || "#888" }}
                                        onMouseEnter={(e) =>
                                          (e.currentTarget.style.backgroundColor =
                                            "rgba(255,255,255,0.05)")
                                        }
                                        onMouseLeave={(e) =>
                                          (e.currentTarget.style.backgroundColor = "transparent")
                                        }
                                        onClick={() => updateFontCategory(font, name)}
                                      >
                                        {name}
                                      </button>
                                    );
                                  })}
                                  <div className="border-t border-border/30 my-0.5" />
                                  <div className="px-2 py-1">
                                    <input
                                      className="w-full text-[9px] px-1.5 py-0.5 rounded border border-border/50 bg-bg-primary text-text-primary outline-none focus:border-accent/50 placeholder:text-text-muted/50"
                                      placeholder="カスタム入力..."
                                      defaultValue=""
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                          const val = e.currentTarget.value.trim();
                                          if (val) updateFontCategory(font, val);
                                        }
                                        e.stopPropagation();
                                      }}
                                      onMouseDown={(e) => e.stopPropagation()}
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                  </div>
                                  {catEntry.subName && (
                                    <button
                                      className="block w-full text-left text-[9px] px-2.5 py-1 text-text-muted hover:bg-white/5 transition-colors"
                                      onClick={() => updateFontCategory(font, "")}
                                    >
                                      カテゴリなし
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </span>
                      );
                    })}
                  </div>
                  {/* JSON load button when not loaded */}
                  {!currentJsonFilePath && (
                    <button
                      className="mt-1.5 flex items-center gap-1 text-[9px] text-text-muted hover:text-text-secondary transition-colors"
                      onClick={() => setShowJsonBrowser(true)}
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
                          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                        />
                      </svg>
                      JSON読込でカテゴリ編集
                    </button>
                  )}
                </div>
              )}
              {/* Toggle controls */}
              {textLayers.length > 0 && (
                <div className="flex items-center gap-2 px-1 pb-1">
                  <div className="flex rounded-md border border-border/40 overflow-hidden">
                    <button
                      onClick={() => setUseActualFont(false)}
                      className={`px-2 py-0.5 text-[9px] transition-all ${
                        !useActualFont
                          ? "bg-bg-tertiary text-text-primary font-medium"
                          : "bg-bg-elevated/50 text-text-muted hover:text-text-secondary"
                      }`}
                    >
                      デフォルト
                    </button>
                    <button
                      onClick={() => setUseActualFont(true)}
                      className={`px-2 py-0.5 text-[9px] border-l border-border/40 transition-all ${
                        useActualFont
                          ? "bg-bg-tertiary text-text-primary font-medium"
                          : "bg-bg-elevated/50 text-text-muted hover:text-text-secondary"
                      }`}
                    >
                      プレビュー
                    </button>
                  </div>
                  <div className="flex rounded-md border border-border/40 overflow-hidden">
                    <button
                      onClick={() => setSortDesc(false)}
                      className={`px-2 py-0.5 text-[9px] transition-all ${
                        !sortDesc
                          ? "bg-bg-tertiary text-text-primary font-medium"
                          : "bg-bg-elevated/50 text-text-muted hover:text-text-secondary"
                      }`}
                    >
                      昇順
                    </button>
                    <button
                      onClick={() => setSortDesc(true)}
                      className={`px-2 py-0.5 text-[9px] border-l border-border/40 transition-all ${
                        sortDesc
                          ? "bg-bg-tertiary text-text-primary font-medium"
                          : "bg-bg-elevated/50 text-text-muted hover:text-text-secondary"
                      }`}
                    >
                      降順
                    </button>
                  </div>
                </div>
              )}
              {textLayers.length === 0 ? (
                <div className="flex items-center justify-center py-8 text-[10px] text-text-muted">
                  テキストレイヤーなし
                </div>
              ) : (
                (sortDesc
                  ? textLayers.map((e, i) => ({ e, i })).reverse()
                  : textLayers.map((e, i) => ({ e, i }))
                ).map(({ e: entry, i: origIdx }) => (
                  <TextLayerRow
                    key={origIdx}
                    entry={entry}
                    fontInfo={fontInfo}
                    useActualFont={useActualFont}
                    highlightFont={filterFont}
                    isSelected={highlightLayerIdx === origIdx}
                    onSelect={() => {
                      setHighlightLayerIdx(highlightLayerIdx === origIdx ? null : origIdx);
                      setHighlightTreeLayerId(null);
                      setHighlightTreeBounds(null);
                    }}
                  />
                ))
              )}
            </div>
          ) : (
            <div className="p-1.5">
              {viewerFile?.metadata?.layerTree?.length ? (
                <LayerTree
                  layers={viewerFile.metadata.layerTree}
                  selectedLayerId={highlightTreeLayerId}
                  onSelectLayer={(id, bounds) => {
                    setHighlightTreeLayerId(id);
                    setHighlightTreeBounds(bounds);
                    setHighlightLayerIdx(null);
                  }}
                />
              ) : (
                <div className="flex items-center justify-center py-8 text-[10px] text-text-muted">
                  レイヤー情報なし
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* JSON file browser modal */}
      {showJsonBrowser && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowJsonBrowser(false);
          }}
        >
          <div className="w-[420px]" onMouseDown={(e) => e.stopPropagation()}>
            <JsonFileBrowser
              basePath={jsonFolderPath}
              onSelect={handleJsonFileSelect}
              onCancel={() => setShowJsonBrowser(false)}
              mode="open"
            />
          </div>
        </div>
      )}
    </div>
  );

  const splashOverlay =
    splashPhase !== "hidden" &&
    createPortal(
      <div
        className="fixed inset-0 z-[99999] flex items-center justify-center bg-white pointer-events-none transition-opacity ease-in-out"
        style={{
          opacity: splashPhase === "in" || splashPhase === "out" ? 0 : 1,
          transitionDuration:
            splashPhase === "in" ? "200ms" : splashPhase === "out" ? "350ms" : "0ms",
        }}
        ref={(el) => {
          // Force reflow so "in" transition actually animates from 0→1
          if (el && splashPhase === "in") {
            void el.offsetHeight;
            el.style.opacity = "1";
          }
        }}
      >
        <div className="flex flex-col items-center gap-3">
          <span
            className="font-display font-bold tracking-wide"
            style={{
              fontSize: "min(8vw, 8vh)",
              lineHeight: 1.3,
              background: "linear-gradient(135deg, #ff6b9d, #c084fc, #60a5fa, #34d399)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            COMIC-Bridge
          </span>
          <span
            className="font-medium tracking-[0.3em] uppercase text-black/20"
            style={{ fontSize: "min(1.5vw, 1.5vh)" }}
          >
            viewer
          </span>
        </div>
      </div>,
      document.body,
    );

  if (isFullscreen) {
    return (
      <>
        {createPortal(viewerContent, document.body)}
        {splashOverlay}
      </>
    );
  }

  return (
    <>
      {viewerContent}
      {splashOverlay}
    </>
  );
}
