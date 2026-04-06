/**
 * 統合ビューアー — 3カラムレイアウト
 * Left: ファイルリスト / レイヤー構造 / 写植仕様
 * Center: 画像ビューアー (PSD/Image/PDF)
 * Right: テキスト編集 / 校正JSON
 */
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { FileContextMenu } from "../common/FileContextMenu";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { readFile } from "@tauri-apps/plugin-fs";
import {
  useUnifiedViewerStore,
  type ViewerFile,
  type FontPresetEntry,
} from "../../store/unifiedViewerStore";
import type { PanelTab } from "../../store/unifiedViewerStore";
import {
  type ProofreadingCheckItem,
  CATEGORY_COLORS,
  getCategoryColorIndex,
} from "../../types/typesettingCheck";
import { detectPaperSize } from "../../lib/paperSize";
import { JsonFileBrowser } from "../scanPsd/JsonFileBrowser";
import { useScanPsdStore } from "../../store/scanPsdStore";
import { usePsdStore } from "../../store/psdStore";
import { useViewStore } from "../../store/viewStore";
import {
  collectTextLayers,
  FONT_COLORS,
  MISSING_FONT_COLOR,
  type FontResolveInfo,
} from "../../hooks/useFontResolver";
import {
  normalizeTextForComparison,
  computeLineSetDiff,
  buildUnifiedDiff,
} from "../../kenban-utils/textExtract";
import type { UnifiedDiffEntry } from "../../kenban-utils/textExtract";

// ─── Separated modules ─────────────────────────────────
import {
  ALL_PANEL_TABS,
  ZOOM_STEPS,
  MAX_SIZE,
  parseComicPotText,
  isImageFile,
  isPsdFile,
  getTextPageNumbers,
  type CacheEntry,
} from "./utils";
import {
  ToolBtn,
  PanelTabBtn,
  LayerTreeView,
  SortableBlockItem,
  CheckJsonBrowser,
  UnifiedDiffDisplay,
} from "./UnifiedSubComponents";
import { useViewerFileOps } from "./useViewerFileOps";

// (utils, helpers, sub-components are imported from ./utils and ./UnifiedSubComponents)

// ═════════════════════════════════════════════════════════
// Main Component
// ═════════════════════════════════════════════════════════
export function UnifiedViewer() {
  const store = useUnifiedViewerStore();
  const [viewerContextMenu, setViewerContextMenu] = useState<{ x: number; y: number } | null>(null);

  // Sync with psdStore: メイン画面のPSDファイルを常にビューアーに反映
  const psdFiles = usePsdStore((s) => s.files);
  const activeView = useViewStore((s) => s.activeView);
  const psdFilesSig = useMemo(() => psdFiles.map((f) => f.filePath).join("|"), [psdFiles]);

  const doSync = useCallback(() => {
    const latest = usePsdStore.getState().files;
    if (latest.length === 0) return;
    const viewerFiles: ViewerFile[] = latest.map((f) => {
      const isPdf = f.sourceType === "pdf" || f.filePath.toLowerCase().endsWith(".pdf");
      return {
        name: f.fileName,
        path: f.filePath,
        sourceType: /\.(psd|psb)$/i.test(f.fileName) ? "psd" as const : isPdf ? "pdf" as const : "image" as const,
        metadata: f.metadata || undefined,
        // PDF情報をマッピング（pdfPageIndex: 0-indexed → pdfPage: 1-indexed）
        isPdf: isPdf && !!f.pdfSourcePath,
        pdfPath: f.pdfSourcePath,
        pdfPage: f.pdfPageIndex != null ? f.pdfPageIndex + 1 : undefined,
      };
    });
    store.setFiles(viewerFiles);
  }, []);

  // ファイル変更時に同期
  useEffect(() => { doSync(); }, [psdFilesSig]);
  // ビューアータブに切り替えた時に強制同期 + 画像再読み込み
  const loadImageRef = useRef<(i: number) => void>(() => {});
  useEffect(() => {
    if (activeView === "unifiedViewer") {
      doSync();
      cache.current.clear();
      // メイン画面のactiveFileIdに対応するインデックスに自動移動
      setTimeout(() => {
        const st = useUnifiedViewerStore.getState();
        const psd = usePsdStore.getState();
        if (st.files.length > 0) {
          let idx = st.currentFileIndex;
          if (psd.activeFileId) {
            const matchIdx = st.files.findIndex((f) => f.path === psd.files.find((p) => p.id === psd.activeFileId)?.filePath);
            if (matchIdx >= 0) idx = matchIdx;
          }
          st.setCurrentFileIndex(idx >= 0 ? idx : 0);
          loadImageRef.current(idx >= 0 ? idx : 0);
        }
      }, 100);
    }
  }, [activeView]);

  // D&D sensors
  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // --- Local viewer state ---
  const [zoom, setZoom] = useState(0);
  const [loading, setLoading] = useState(false);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [pageSync, setPageSync] = useState(true);

  // Text editor local
  const [selectedChunk, setSelectedChunk] = useState(-1);
  // テキスト編集: ローカルバッファ（確定まで反映しない）
  const [editBuffer, setEditBuffer] = useState<string | null>(null);
  const [editCursorPos, setEditCursorPos] = useState<number | null>(null);
  const [chunks, setChunks] = useState<{ text: string; page: number }[]>([]);

  // Check panel local
  const [checkFilterCategory, setCheckFilterCategory] = useState("all");

  // JSON browser
  const [jsonBrowserMode, setJsonBrowserMode] = useState<"preset" | "check" | null>(null);
  const jsonFolderPath = useScanPsdStore((s) => s.jsonFolderPath);

  // Font resolution (和名表示)
  const [fontResolveMap, setFontResolveMap] = useState<Record<string, FontResolveInfo>>({});
  const [fontResolved, setFontResolved] = useState(false);

  // Layer highlight (写植仕様タブ → 画像ハイライト)
  const [highlightBounds, setHighlightBounds] = useState<{ top: number; left: number; bottom: number; right: number } | null>(null);
  const [activeFontFilter, setActiveFontFilter] = useState<string | null>(null);

  // Text diff display mode: 一致ペアの表示 ("psd" = PSDレイヤーのみ, "text" = テキストのみ)
  const [diffMatchDisplay, setDiffMatchDisplay] = useState<"psd" | "text">("text");
  // 単ページ化モード
  const [spreadMode, setSpreadMode] = useState(false); // 見開き分割ON/OFF
  const [firstPageMode, setFirstPageMode] = useState<"single" | "spread" | "skip">("single");
  // 互換用: 既存コードが参照する diffSplitMode
  const diffSplitMode: "none" | "spread" | "spread-skip1" | "single1" = !spreadMode
    ? "none"
    : firstPageMode === "single" ? "single1"
    : firstPageMode === "skip" ? "spread-skip1"
    : "spread";

  // Text diff (テキスト照合)
  const [textDiffResults, setTextDiffResults] = useState<{
    psdText: string;
    loadedText: string;
    hasDiff: boolean;
    unifiedEntries: UnifiedDiffEntry[];
    /** PSD各レイヤーのテキスト（漫画読み順） */
    psdLayerTexts: { layerName: string; text: string; fonts: string[] }[];
    /** COMIC-POT各ブロックのテキスト */
    loadedBlocks: { text: string; assignedFont?: string }[];
    /** PSDレイヤー→テキストブロックの対応 (indexベース) */
    linkMap: Map<number, number>;
  } | null>(null);

  // Panel resize — default widths per tab
  const TAB_WIDTHS: Record<PanelTab, number> = {
    files: 200, layers: 260, spec: 280,
    text: 420, proofread: 380, diff: 400,
  };
  const [leftWidth, setLeftWidth] = useState(TAB_WIDTHS[store.leftTab]);
  const [rightWidth, setRightWidth] = useState(TAB_WIDTHS[store.rightTab]);
  const [resizingSide, setResizingSide] = useState<"left" | "right" | null>(null);
  const [leftManualResize, setLeftManualResize] = useState(false);
  const [rightManualResize, setRightManualResize] = useState(false);

  // Auto-resize on tab change (unless manually resized)
  useEffect(() => {
    if (!leftManualResize) setLeftWidth(TAB_WIDTHS[store.leftTab]);
  }, [store.leftTab]);
  useEffect(() => {
    if (!rightManualResize) setRightWidth(TAB_WIDTHS[store.rightTab]);
  }, [store.rightTab]);

  // Refs
  const cache = useRef(new Map<string, CacheEntry>());
  const canvasRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragStart = useRef({ x: 0, y: 0, sx: 0, sy: 0 });
  const pdfjsRef = useRef<any>(null);
  const pdfDocCache = useRef(new Map<string, any>());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { files, currentFileIndex: idx } = store;
  const cur = files[idx] || null;

  // ═══ PDF.js lazy load ═══
  const ensurePdfJs = useCallback(async () => {
    if (pdfjsRef.current) return pdfjsRef.current;
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).href;
    pdfjsRef.current = pdfjs;
    return pdfjs;
  }, []);

  const renderPdfPage = useCallback(
    async (pdfPath: string, pageNum: number): Promise<CacheEntry | null> => {
      try {
        const pdfjs = await ensurePdfJs();
        let doc = pdfDocCache.current.get(pdfPath);
        if (!doc) {
          doc = await pdfjs.getDocument(convertFileSrc(pdfPath)).promise;
          pdfDocCache.current.set(pdfPath, doc);
        }
        const page = await doc.getPage(pageNum);
        const vp = page.getViewport({ scale: 2.0 });
        const c = document.createElement("canvas");
        c.width = vp.width;
        c.height = vp.height;
        await page.render({ canvasContext: c.getContext("2d")!, viewport: vp }).promise;
        return { url: c.toDataURL("image/png"), w: vp.width, h: vp.height };
      } catch {
        return null;
      }
    },
    [ensurePdfJs],
  );

  const expandPdf = useCallback(
    async (raw: ViewerFile[]): Promise<ViewerFile[]> => {
      const out: ViewerFile[] = [];
      for (const f of raw) {
        if (f.name.toLowerCase().endsWith(".pdf")) {
          try {
            const pdfjs = await ensurePdfJs();
            const doc = await pdfjs.getDocument(convertFileSrc(f.path)).promise;
            pdfDocCache.current.set(f.path, doc);
            const n = doc.numPages;
            for (let i = 1; i <= n; i++)
              out.push({
                name: n > 1 ? `${f.name} (p.${i}/${n})` : f.name,
                path: `${f.path}#page=${i}`,
                sourceType: "pdf",
                isPdf: true,
                pdfPage: i,
                pdfPath: f.path,
              });
          } catch {
            out.push(f);
          }
        } else {
          out.push(f);
        }
      }
      return out;
    },
    [ensurePdfJs],
  );

  // ═══ Image loading ═══
  const loadImage = useCallback(
    async (i: number) => {
      // 常にstoreから最新のfilesを取得（クロージャの古い参照問題を回避）
      const latestFiles = useUnifiedViewerStore.getState().files;
      if (i < 0 || i >= latestFiles.length) return;
      setLoading(true);
      const f = latestFiles[i];
      // キャッシュキー: PDFはページ番号も含める
      const cacheKey = f.pdfPage ? `${f.path}#p${f.pdfPage}` : f.path;
      const cached = cache.current.get(cacheKey);
      if (cached) {
        setImgUrl(cached.url);
        setDims({ w: cached.w, h: cached.h });
        setLoading(false);
        return;
      }
      try {
        let e: CacheEntry | null = null;
        if (f.isPdf && f.pdfPath && f.pdfPage) {
          // ページ分割済みPDF
          e = await renderPdfPage(f.pdfPath, f.pdfPage);
        } else if (f.sourceType === "pdf" || f.path.toLowerCase().endsWith(".pdf")) {
          // ファイル単位PDF（ページ1を表示）
          const pdfPath = f.pdfPath || f.path;
          e = await renderPdfPage(pdfPath, f.pdfPage || 1);
        } else {
          // Use standard get_high_res_preview command
          const r = await invoke<any>("get_high_res_preview", {
            filePath: f.path,
            maxSize: MAX_SIZE,
          });
          if (r.file_path)
            e = {
              url: convertFileSrc(r.file_path),
              w: r.original_width || 0,
              h: r.original_height || 0,
            };
        }
        if (e) {
          cache.current.set(cacheKey, e);
          setImgUrl(e.url);
          setDims({ w: e.w, h: e.h });
        }
      } catch {
        /* ignore */
      }
      setLoading(false);
    },
    [renderPdfPage],
  );

  // Prefetch ±2
  useEffect(() => {
    if (idx < 0 || files.length === 0) return;
    for (const off of [1, -1, 2, -2]) {
      const ni = idx + off;
      if (ni < 0 || ni >= files.length) continue;
      const f = files[ni];
      const ck = f.pdfPage ? `${f.path}#p${f.pdfPage}` : f.path;
      if (cache.current.has(ck)) continue;
      if (f.isPdf && f.pdfPath && f.pdfPage)
        renderPdfPage(f.pdfPath, f.pdfPage).then((e) => e && cache.current.set(ck, e));
      else if (f.sourceType === "pdf" || f.path.toLowerCase().endsWith(".pdf"))
        renderPdfPage(f.pdfPath || f.path, f.pdfPage || 1).then((e) => e && cache.current.set(ck, e));
      else
        invoke<any>("get_high_res_preview", { filePath: f.path, maxSize: MAX_SIZE })
          .then((r: any) => {
            if (r.file_path)
              cache.current.set(ck, {
                url: convertFileSrc(r.file_path),
                w: r.original_width || 0,
                h: r.original_height || 0,
              });
          })
          .catch(() => {});
    }
  }, [idx, files, renderPdfPage]);

  // loadImageの最新参照を保持（setTimeout内から呼ぶため）
  useEffect(() => { loadImageRef.current = loadImage; }, [loadImage]);

  // ファイル変更時に画像を読み込み
  const filesSig = useMemo(() => files.map((f) => f.path).join("|"), [files]);
  useEffect(() => {
    if (idx >= 0 && files.length > 0) loadImage(idx);
  }, [idx, loadImage, filesSig]);

  // Load PSD metadata when file changes
  useEffect(() => {
    if (idx < 0 || !cur || cur.metadata) return;
    if (!isPsdFile(cur.name)) return;
    invoke<any[]>("parse_psd_metadata_batch", { filePaths: [cur.path] })
      .then((results) => {
        if (results[0]?.metadata) store.updateFileMetadata(idx, results[0].metadata);
      })
      .catch(() => {});
  }, [idx, cur]);

  // ═══ Block D&D reorder ═══
  const handleBlockReorder = useCallback(
    (pageNumber: number, event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const page = store.textPages.find((p) => p.pageNumber === pageNumber);
      if (!page) return;
      const oldIdx = page.blocks.findIndex((b) => b.id === active.id);
      const newIdx = page.blocks.findIndex((b) => b.id === over.id);
      if (oldIdx < 0 || newIdx < 0) return;
      const reordered = arrayMove(page.blocks, oldIdx, newIdx);
      const updated = store.textPages.map((p) =>
        p.pageNumber === pageNumber ? { ...p, blocks: reordered } : p,
      );
      store.setTextPages(updated);
      store.setIsDirty(true);
    },
    [store.textPages],
  );

  // 編集モード切替時にバッファを初期化
  useEffect(() => {
    if (store.editMode === "edit") {
      setEditBuffer(store.textContent);
      setEditCursorPos(null);
    } else {
      setEditBuffer(null);
    }
  }, [store.editMode]);

  // カーソル位置復元
  useEffect(() => {
    if (editCursorPos !== null && textareaRef.current) {
      textareaRef.current.selectionStart = editCursorPos;
      textareaRef.current.selectionEnd = editCursorPos;
    }
  }, [editBuffer, editCursorPos]);

  // ═══ Text chunks (for select mode) ═══
  const parseChunks = useCallback((content: string) => {
    const lines = content.split("\n");
    const result: { text: string; page: number }[] = [];
    let page = 0;
    let buf: string[] = [];
    const pageRe = /<<(\d+)Page>>/;
    for (const line of lines) {
      const pm = line.match(pageRe);
      if (pm) {
        if (buf.length) result.push({ text: buf.join("\n"), page });
        page = parseInt(pm[1], 10);
        buf = [];
        continue;
      }
      if (line.trim() === "" && buf.length) {
        result.push({ text: buf.join("\n"), page });
        buf = [];
        continue;
      }
      buf.push(line);
    }
    if (buf.length) result.push({ text: buf.join("\n"), page });
    setChunks(result);
  }, []);

  // ═══ File operations (extracted to useViewerFileOps) ═══
  const { openFolder, openTextFile, handleJsonFileSelect, handleSave, handleSaveAs } = useViewerFileOps({
    expandPdf,
    parseChunks,
    cache,
    setZoom,
    jsonBrowserMode,
    setJsonBrowserMode,
  });

  const syncToPage = useCallback(
    (pageNum: number) => {
      if (store.editMode === "edit") {
        const ta = textareaRef.current;
        if (!ta) return;
        const lines = ta.value.split("\n");
        let pg = 0;
        let charPos = 0;
        for (const line of lines) {
          const m = line.match(/<<(\d+)Page>>/);
          if (m) pg = parseInt(m[1], 10);
          if (pg >= pageNum) {
            ta.focus();
            ta.setSelectionRange(charPos, charPos);
            ta.scrollTop = (charPos / ta.value.length) * ta.scrollHeight;
            return;
          }
          charPos += line.length + 1;
        }
      } else {
        const ci = chunks.findIndex((c) => c.page >= pageNum);
        if (ci >= 0) setSelectedChunk(ci);
      }
    },
    [store.editMode, chunks],
  );

  // Page sync on image change
  useEffect(() => {
    if (!pageSync || idx < 0) return;
    syncToPage(idx + 1);
  }, [idx, pageSync, syncToPage]);

  // ═══ D&D ═══
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    const setup = async () => {
      const win = getCurrentWebviewWindow();
      unlisten = await win.onDragDropEvent(async (event) => {
        const p = event.payload;
        if (p.type === "enter" || p.type === "over") {
          setDragOver(true);
        } else if (p.type === "leave") {
          setDragOver(false);
        } else if (p.type === "drop") {
          setDragOver(false);
          const paths: string[] = (p as any).paths || [];
          if (!paths.length) return;
          // .txt → text
          const txtPaths = paths.filter((pp) => pp.toLowerCase().endsWith(".txt"));
          if (txtPaths.length > 0) {
            try {
              const bytes = await readFile(txtPaths[0]);
              const content = new TextDecoder("utf-8").decode(bytes);
              store.setTextContent(content);
              store.setTextFilePath(txtPaths[0]);
              const { header, pages } = parseComicPotText(content);
              store.setTextHeader(header);
              store.setTextPages(pages);
              store.setIsDirty(false);
              parseChunks(content);
              store.setRightTab("text");
            } catch { /* ignore */ }
          }
          // .json → check data
          const jsonPaths = paths.filter((pp) => pp.toLowerCase().endsWith(".json"));
          if (jsonPaths.length > 0) {
            try {
              const bytes = await readFile(jsonPaths[0]);
              const content = new TextDecoder("utf-8").decode(bytes);
              const data = JSON.parse(content);
              // Detect type: proofreading or preset
              if (data.checks || (Array.isArray(data) && data[0]?.category)) {
                // Proofreading JSON
                const allItems: ProofreadingCheckItem[] = [];
                const parseArr = (src: any, fallbackKind: "correctness" | "proposal") => {
                  const arr = Array.isArray(src) ? src : Array.isArray(src?.items) ? src.items : null;
                  if (!arr) return;
                  for (const item of arr)
                    allItems.push({
                      picked: false,
                      category: item.category || "",
                      page: item.page || "",
                      excerpt: item.excerpt || "",
                      content: item.content || item.text || "",
                      checkKind: item.checkKind || fallbackKind,
                    });
                };
                if (data.checks) {
                  parseArr(data.checks.simple, "correctness");
                  parseArr(data.checks.variation, "proposal");
                } else {
                  parseArr(data, "correctness");
                }
                store.setCheckData({
                  title: data.work || "",
                  fileName: jsonPaths[0].substring(jsonPaths[0].lastIndexOf("\\") + 1),
                  filePath: jsonPaths[0],
                  allItems,
                  correctnessItems: allItems.filter((i) => i.checkKind === "correctness"),
                  proposalItems: allItems.filter((i) => i.checkKind === "proposal"),
                });
                store.setRightTab("proofread");
              } else if (data.presetData?.presets || data.presetSets || data.presets) {
                // Preset JSON → load fonts
                const presets: FontPresetEntry[] = [];
                const pObj = data?.presetData?.presets ?? data?.presets ?? data?.presetSets ?? {};
                if (typeof pObj === "object" && pObj !== null) {
                  const entries = Array.isArray(pObj) ? [["", pObj]] : Object.entries(pObj);
                  for (const [, arr] of entries) {
                    if (!Array.isArray(arr)) continue;
                    for (const p of arr as any[])
                      if (p?.font) presets.push({ font: p.font, name: p.name || "", subName: p.subName || "" });
                  }
                }
                if (presets.length > 0) store.setFontPresets(presets);
              }
            } catch { /* ignore */ }
          }
          // Images / Folders → file list
          const otherPaths = paths.filter(
            (pp) =>
              !pp.toLowerCase().endsWith(".txt") &&
              !pp.toLowerCase().endsWith(".json"),
          );
          if (otherPaths.length > 0) {
            let allImagePaths: string[] = [];
            for (const pp of otherPaths) {
              // Check if it's a folder (no extension or try list_folder_files)
              const fileName = pp.substring(pp.lastIndexOf("\\") + 1);
              if (isImageFile(fileName)) {
                allImagePaths.push(pp);
              } else {
                // Treat as folder — list contents
                try {
                  const folderFiles = await invoke<string[]>("list_folder_files", {
                    folderPath: pp,
                    recursive: false,
                  });
                  allImagePaths.push(
                    ...folderFiles.filter((fp) =>
                      isImageFile(fp.substring(fp.lastIndexOf("\\") + 1)),
                    ),
                  );
                } catch {
                  // Not a folder or error — skip
                }
              }
            }
            if (allImagePaths.length > 0) {
              const raw: ViewerFile[] = allImagePaths.map((pp) => ({
                name: pp.substring(pp.lastIndexOf("\\") + 1),
                path: pp,
                sourceType: isPsdFile(pp) ? "psd" as const : pp.toLowerCase().endsWith(".pdf") ? "pdf" as const : "image" as const,
              }));
              const expanded = await expandPdf(raw);
              store.setFiles(expanded);
              cache.current.clear();
              setZoom(0);
              store.setLeftTab("files");
            }
          }
        }
      });
    };
    setup();
    return () => { unlisten?.(); };
  }, [expandPdf, parseChunks]);

  // ═══ Zoom ═══
  const zoomIn = useCallback(() => setZoom((z) => Math.min(z + 1, ZOOM_STEPS.length)), []);
  const zoomOut = useCallback(() => setZoom((z) => Math.max(z - 1, 0)), []);
  const zoomFit = useCallback(() => setZoom(0), []);
  const zoomLabel = zoom === 0 ? "Fit" : `${Math.round(ZOOM_STEPS[zoom - 1] * 100)}%`;

  // 単ページ化: 論理ページカウンター（全ファイル×前後をフラットに管理）
  const [splitReadOrder, setSplitReadOrder] = useState<"right-first" | "left-first">("left-first");
  const [logicalPage, setLogicalPage] = useState(0);

  // spreadMode変更時にリセット
  useEffect(() => { setLogicalPage(0); }, [spreadMode, firstPageMode]);

  // logicalPage → (fileIdx, side) の変換
  const resolveLogicalPage = useCallback((lp: number): { fileIdx: number; side: "full" | "right" | "left" } => {
    if (!spreadMode) return { fileIdx: lp, side: "full" };
    let remain = lp;
    for (let fi = 0; fi < files.length; fi++) {
      const isSingle = firstPageMode === "single" && fi === 0;
      const isSkip = firstPageMode === "skip" && fi === 0;
      if (isSingle) {
        if (remain === 0) return { fileIdx: fi, side: "full" };
        remain -= 1;
      } else if (isSkip) {
        // 左半分スキップ → 右半分のみ（readOrder=left-firstなら left=skip, right=表示）
        if (remain === 0) return { fileIdx: fi, side: splitReadOrder === "left-first" ? "right" : "left" };
        remain -= 1;
      } else {
        // 見開き: 2ページ
        if (remain === 0) return { fileIdx: fi, side: splitReadOrder === "left-first" ? "left" : "right" };
        if (remain === 1) return { fileIdx: fi, side: splitReadOrder === "left-first" ? "right" : "left" };
        remain -= 2;
      }
    }
    return { fileIdx: files.length - 1, side: "full" };
  }, [spreadMode, firstPageMode, files.length, splitReadOrder]);

  // 最大論理ページ数
  const maxLogicalPage = useMemo(() => {
    if (!spreadMode) return files.length;
    let count = 0;
    for (let fi = 0; fi < files.length; fi++) {
      const isSingle = firstPageMode === "single" && fi === 0;
      const isSkip = firstPageMode === "skip" && fi === 0;
      count += isSingle ? 1 : isSkip ? 1 : 2;
    }
    return count;
  }, [spreadMode, firstPageMode, files.length]);

  // 現在の表示状態
  const resolved = resolveLogicalPage(logicalPage);
  const splitViewSide = resolved.side;

  // idx同期 + 画像読み込み（logicalPageが変わったらfileIdxを更新し画像を読み込む）
  useEffect(() => {
    const targetIdx = resolved.fileIdx;
    if (targetIdx >= 0 && targetIdx < files.length) {
      if (targetIdx !== idx) {
        store.setCurrentFileIndex(targetIdx);
      }
      // loadImageRefで直接呼ぶ（useEffectチェーンを避ける）
      loadImageRef.current(targetIdx);
    }
  }, [logicalPage]);

  const imgStyle: React.CSSProperties =
    zoom === 0
      ? { maxWidth: "100%", maxHeight: "100%", objectFit: "contain" as const }
      : {
          width: imgRef.current
            ? `${imgRef.current.naturalWidth * ZOOM_STEPS[zoom - 1]}px`
            : "auto",
        };
  // 半分表示用: imgをラップするdivのスタイル (splitViewSide !== "full" 時のみ適用)
  const splitWrapStyle: React.CSSProperties | null = splitViewSide !== "full" ? {
    overflow: "hidden",
    width: "50%",
    maxHeight: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: splitViewSide === "right" ? "flex-start" : "flex-end",
  } : null;
  // 半分表示時のimg追加スタイル
  const splitImgExtra: React.CSSProperties | null = splitViewSide !== "full" ? {
    width: "200%",
    maxWidth: "none",
    maxHeight: "100%",
    objectFit: "contain" as const,
    marginLeft: splitViewSide === "left" ? "-100%" : undefined,
  } : null;

  // ═══ Nav ═══
  const goPrev = useCallback(() => {
    if (spreadMode) {
      if (logicalPage > 0) setLogicalPage(logicalPage - 1);
    } else {
      if (idx > 0) store.setCurrentFileIndex(idx - 1);
    }
  }, [spreadMode, logicalPage, idx]);

  const goNext = useCallback(() => {
    if (spreadMode) {
      if (logicalPage < maxLogicalPage - 1) setLogicalPage(logicalPage + 1);
    } else {
      if (idx < files.length - 1) store.setCurrentFileIndex(idx + 1);
    }
  }, [spreadMode, logicalPage, maxLogicalPage, idx, files.length]);

  /** テキストページ番号でナビゲート */
  const navigateToTextPage = useCallback((textPageNum: number) => {
    if (!spreadMode) {
      store.setCurrentFileIndex(Math.min(textPageNum - 1, files.length - 1));
      return;
    }
    // logicalPageを探す
    for (let lp = 0; lp < maxLogicalPage; lp++) {
      const r = resolveLogicalPage(lp);
      const pns = getTextPageNumbers(r.fileIdx, diffSplitMode);
      if (pns.length === 1 && pns[0] === textPageNum) { setLogicalPage(lp); return; }
      if (pns.length === 2) {
        if (r.side === "left" && pns[0] === textPageNum) { setLogicalPage(lp); return; }
        if (r.side === "right" && pns[1] === textPageNum) { setLogicalPage(lp); return; }
      }
    }
  }, [spreadMode, maxLogicalPage, resolveLogicalPage, diffSplitMode, files.length]);

  // Keyboard
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "=" || e.key === "+") { e.preventDefault(); zoomIn(); }
        else if (e.key === "-") { e.preventDefault(); zoomOut(); }
        else if (e.key === "0") { e.preventDefault(); zoomFit(); }
        else if (e.key === "s") { e.preventDefault(); handleSave(); }
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); goPrev(); }
      else if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); goNext(); }
      else if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        const f = useUnifiedViewerStore.getState().files[useUnifiedViewerStore.getState().currentFileIndex];
        if (f?.path) invoke("open_file_in_photoshop", { filePath: f.path }).catch(() => {});
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [goPrev, goNext, zoomIn, zoomOut, zoomFit, handleSave]);

  // Mouse wheel zoom / page
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const h = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); e.deltaY < 0 ? zoomIn() : zoomOut(); }
      else if (zoom === 0) { e.preventDefault(); e.deltaY > 0 ? goNext() : goPrev(); }
    };
    el.addEventListener("wheel", h, { passive: false });
    return () => el.removeEventListener("wheel", h);
  }, [zoom, goPrev, goNext, zoomIn, zoomOut]);

  // Drag-to-pan
  const onCanvasMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (zoom === 0) return;
      e.preventDefault();
      setDragging(true);
      const el = canvasRef.current!;
      dragStart.current = { x: e.clientX, y: e.clientY, sx: el.scrollLeft, sy: el.scrollTop };
    },
    [zoom],
  );
  useEffect(() => {
    if (!dragging) return;
    const mv = (e: MouseEvent) => {
      const el = canvasRef.current;
      if (!el) return;
      el.scrollLeft = dragStart.current.sx - (e.clientX - dragStart.current.x);
      el.scrollTop = dragStart.current.sy - (e.clientY - dragStart.current.y);
    };
    const up = () => setDragging(false);
    window.addEventListener("mousemove", mv);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up); };
  }, [dragging]);

  // Panel resize
  useEffect(() => {
    if (!resizingSide) return;
    const mv = (e: MouseEvent) => {
      if (resizingSide === "left") { setLeftWidth(Math.max(180, Math.min(500, e.clientX))); setLeftManualResize(true); }
      else {
        const r = window.innerWidth - e.clientX;
        setRightWidth(Math.max(280, Math.min(700, r)));
        setRightManualResize(true);
      }
    };
    const up = () => setResizingSide(null);
    window.addEventListener("mousemove", mv);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up); };
  }, [resizingSide]);

  // ═══ Derived data ═══
  const metadata = cur?.metadata || null;
  const layerTree = metadata?.layerTree || [];
  const textLayers = useMemo(() => collectTextLayers(layerTree), [layerTree]);

  // Collect all PostScript font names from current file's text layers
  const postScriptNames = useMemo(() => {
    const set = new Set<string>();
    for (const tl of textLayers) {
      if (tl.textInfo) for (const f of tl.textInfo.fonts) set.add(f);
    }
    return [...set];
  }, [textLayers]);

  // All fonts across ALL loaded files → Map<fontName, fileIndexes[]>
  const allFilesFontMap = useMemo(() => {
    const map = new Map<string, number[]>();
    files.forEach((f, fi) => {
      if (!f.metadata?.layerTree) return;
      const tls = collectTextLayers(f.metadata.layerTree);
      for (const tl of tls) {
        if (tl.textInfo) {
          for (const font of tl.textInfo.fonts) {
            const arr = map.get(font) || [];
            if (!arr.includes(fi)) arr.push(fi);
            map.set(font, arr);
          }
        }
      }
    });
    return map;
  }, [files]);

  // Track click index per font for cycling through pages
  const fontClickIdx = useRef(new Map<string, number>());

  // Per-file text diff status: Map<fileIndex, "match" | "diff" | "no-text">
  const fileDiffStatusMap = useMemo(() => {
    const map = new Map<number, "match" | "diff" | "no-text">();
    if (store.textContent.length === 0) return map;
    files.forEach((f, fi) => {
      if (!f.metadata?.layerTree) return;
      const tls = collectTextLayers(f.metadata.layerTree).filter((tl) => tl.textInfo?.text);
      if (tls.length === 0) return;
      const psdText = tls.map((tl) => tl.textInfo!.text.trim()).filter(Boolean).join("\n\n");
      const pageNums = getTextPageNumbers(fi, diffSplitMode);
      if (pageNums.length === 0) return; // 1P除外
      const parts: string[] = [];
      for (const pn of pageNums) {
        const page = store.textPages.find((p) => p.pageNumber === pn);
        if (page) parts.push(page.blocks.map((b) => b.lines.join("\n")).join("\n\n"));
      }
      if (parts.length === 0) { map.set(fi, "no-text"); return; }
      const loadedText = parts.join("\n\n");
      const normPsd = normalizeTextForComparison(psdText);
      const normLoaded = normalizeTextForComparison(loadedText);
      map.set(fi, normPsd === normLoaded ? "match" : "diff");
    });
    return map;
  }, [files, store.textContent, store.textPages, diffSplitMode]);

  // Font color map (stable color per font)
  const fontColorMap = useMemo(() => {
    const map = new Map<string, string>();
    postScriptNames.forEach((f, i) => map.set(f, FONT_COLORS[i % FONT_COLORS.length]));
    return map;
  }, [postScriptNames]);

  // Resolve PostScript names → Japanese display names
  useEffect(() => {
    if (postScriptNames.length === 0) { setFontResolved(false); return; }
    setFontResolved(false);
    invoke<Record<string, FontResolveInfo>>("resolve_font_names", { postscriptNames: postScriptNames })
      .then((r) => { setFontResolveMap(r); setFontResolved(true); })
      .catch(() => {});
  }, [postScriptNames]);

  // Helper: get font label (和名)
  const getFontLabel = useCallback((ps: string) => {
    const info = fontResolveMap[ps];
    return info ? `${info.display_name} ${info.style_name}`.trim() : ps;
  }, [fontResolveMap]);

  const getFontColor = useCallback((ps: string) => {
    if (fontResolved && !(ps in fontResolveMap)) return MISSING_FONT_COLOR;
    return fontColorMap.get(ps) || FONT_COLORS[0];
  }, [fontResolveMap, fontColorMap, fontResolved]);

  // Text diff: PSD text vs loaded COMIC-POT text (KENBAN版 LCS文字レベルdiff)
  useEffect(() => {
    if (textLayers.length === 0 || store.textContent.length === 0) {
      setTextDiffResults(null);
      return;
    }
    // Extract PSD text — 漫画読み順ソート（上→下、右→左）
    const canvasH = metadata?.height || 1;
    const rowThreshold = canvasH * 0.08;
    const sortedLayers = [...textLayers]
      .filter((tl) => tl.textInfo?.text)
      .sort((a, b) => {
        const ay = a.bounds?.top ?? 0;
        const by = b.bounds?.top ?? 0;
        const ax = a.bounds?.left ?? 0;
        const bx = b.bounds?.left ?? 0;
        const rowA = Math.floor(ay / rowThreshold);
        const rowB = Math.floor(by / rowThreshold);
        if (rowA !== rowB) return rowA - rowB; // 上→下
        return bx - ax; // 右→左
      });
    const psdText = sortedLayers
      .map((tl) => tl.textInfo!.text.trim())
      .filter(Boolean)
      .join("\n\n");
    // Extract current page text from COMIC-POT（単ページ化対応）
    const textPageNums = getTextPageNumbers(idx, diffSplitMode);
    const loadedParts: string[] = [];
    const loadedBlocksArr: { text: string; assignedFont?: string }[] = [];
    for (const pn of textPageNums) {
      const page = store.textPages.find((p) => p.pageNumber === pn);
      if (page) {
        loadedParts.push(page.blocks.map((b) => b.lines.join("\n")).join("\n\n"));
        loadedBlocksArr.push(...page.blocks.map((b) => ({ text: b.lines.join("\n"), assignedFont: b.assignedFont })));
      }
    }
    const loadedText = loadedParts.join("\n\n");
    if (!psdText || !loadedText) { setTextDiffResults(null); return; }

    // レイヤー情報を保存
    const psdLayerTexts = sortedLayers.map((tl) => ({
      layerName: tl.layerName,
      text: tl.textInfo!.text.trim(),
      fonts: tl.textInfo?.fonts || [],
    }));
    const loadedBlocks = loadedBlocksArr;

    // PSDレイヤー↔テキストブロックのリンクマッピング（正規化テキストで照合）
    const linkMap = new Map<number, number>();
    const usedBlocks = new Set<number>();
    // Pass 1: 完全一致
    for (let pi = 0; pi < psdLayerTexts.length; pi++) {
      const normP = normalizeTextForComparison(psdLayerTexts[pi].text);
      for (let bi = 0; bi < loadedBlocks.length; bi++) {
        if (usedBlocks.has(bi)) continue;
        const normB = normalizeTextForComparison(loadedBlocks[bi].text);
        if (normP === normB) {
          linkMap.set(pi, bi);
          usedBlocks.add(bi);
          break;
        }
      }
    }
    // Pass 2: 順番ベースの未マッチ割当
    let nextBlock = 0;
    for (let pi = 0; pi < psdLayerTexts.length; pi++) {
      if (linkMap.has(pi)) continue;
      while (nextBlock < loadedBlocks.length && usedBlocks.has(nextBlock)) nextBlock++;
      if (nextBlock < loadedBlocks.length) {
        linkMap.set(pi, nextBlock);
        usedBlocks.add(nextBlock);
        nextBlock++;
      }
    }

    // hasDiff: ペアごとの一致判定（全ペア一致なら一致）
    let hasDiff = false;
    for (let pi = 0; pi < psdLayerTexts.length; pi++) {
      const bi = linkMap.get(pi);
      if (bi === undefined) { hasDiff = true; break; }
      const normP = normalizeTextForComparison(psdLayerTexts[pi].text);
      const normB = normalizeTextForComparison(loadedBlocks[bi].text);
      if (normP !== normB) { hasDiff = true; break; }
    }
    // テキストにのみ存在するブロックがあれば差異
    if (!hasDiff) {
      for (let bi = 0; bi < loadedBlocks.length; bi++) {
        if (![...linkMap.values()].includes(bi)) { hasDiff = true; break; }
      }
    }
    // KENBAN版 LCS文字レベルdiff（差異時のみ計算）
    let unifiedEntries: UnifiedDiffEntry[] = [];
    if (hasDiff) {
      const { psd: psdParts, memo: memoParts } = computeLineSetDiff(psdText, loadedText);
      unifiedEntries = buildUnifiedDiff(psdParts, memoParts);
    }
    setTextDiffResults({
      psdText: psdText.trim(),
      loadedText: loadedText.trim(),
      hasDiff,
      unifiedEntries,
      psdLayerTexts,
      loadedBlocks,
      linkMap,
    });
  }, [textLayers, store.textContent, store.textPages, idx, metadata, diffSplitMode]);
  const checkData = store.checkData;
  const activeCheckItems = useMemo(() => {
    if (!checkData) return [];
    if (store.checkTabMode === "correctness") return checkData.correctnessItems;
    if (store.checkTabMode === "proposal") return checkData.proposalItems;
    return checkData.allItems;
  }, [checkData, store.checkTabMode]);
  const categories = useMemo(
    () => [...new Set(activeCheckItems.map((i) => i.category))].sort(),
    [activeCheckItems],
  );
  const filteredCheckItems = useMemo(
    () => checkFilterCategory === "all" ? activeCheckItems : activeCheckItems.filter((i) => i.category === checkFilterCategory),
    [activeCheckItems, checkFilterCategory],
  );

  // ═══════════════════════════════════════════════════════
  // Shared panel content renderer
  // ═══════════════════════════════════════════════════════
  const renderTabContent = useCallback((tab: PanelTab) => {
    switch (tab) {
      case "files":
        return (
          <div className="select-none">
            {files.length === 0 ? (
              <div className="flex flex-col items-center gap-3 text-text-muted p-6 text-center">
                <svg className="w-10 h-10 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <p className="text-[11px]">D&amp;D or フォルダを開く</p>
                <button onClick={openFolder} className="px-3 py-1.5 text-[11px] font-medium text-white bg-gradient-to-r from-accent to-accent-secondary rounded-lg">
                  フォルダを開く
                </button>
              </div>
            ) : (
              files.map((f, i) => {
                const diffStatus = fileDiffStatusMap.get(i);
                return (
                  <div
                    key={`${f.path}-${i}`}
                    className={`px-2 py-1 text-[11px] cursor-pointer truncate transition-colors flex items-center gap-1 ${
                      i === idx ? "bg-accent/15 text-accent font-medium" : "text-text-secondary hover:bg-bg-tertiary"
                    }`}
                    onClick={() => store.setCurrentFileIndex(i)}
                    title={f.name}
                  >
                    <span className="opacity-40 flex-shrink-0">{i + 1}.</span>
                    {f.isPdf && <span className="text-error/60 flex-shrink-0">PDF</span>}
                    {f.sourceType === "psd" && <span className="text-accent-secondary/60 flex-shrink-0">PSD</span>}
                    <span className="truncate">{f.name}</span>
                    {diffStatus === "match" && (
                      <span className="ml-auto flex-shrink-0 text-success" title="テキスト一致">✓</span>
                    )}
                    {diffStatus === "diff" && (
                      <span className="ml-auto flex-shrink-0 text-warning" title="テキスト差異あり">⚠</span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        );
      case "layers":
        return (
          <div className="p-2">
            {layerTree.length === 0 ? (
              <p className="text-[11px] text-text-muted text-center py-4">
                {cur ? (isPsdFile(cur.name) ? "レイヤー読み込み中..." : "PSDファイルではありません") : "ファイルを選択してください"}
              </p>
            ) : (
              <LayerTreeView nodes={layerTree} />
            )}
          </div>
        );
      case "spec":
        return (
          <div className="select-none">
            {postScriptNames.length > 0 && (
              <div className="px-2 py-1.5 border-b border-border/30">
                <div className="text-[10px] text-text-muted mb-1">使用フォント ({postScriptNames.length}種)</div>
                <div className="flex flex-wrap gap-1">
                  {postScriptNames.map((ps) => (
                    <button
                      key={ps}
                      className={`text-[10px] px-1.5 py-0.5 rounded-full text-white transition-opacity ${
                        activeFontFilter === ps ? "ring-1 ring-white/50" : activeFontFilter ? "opacity-30" : ""
                      }`}
                      style={{ backgroundColor: getFontColor(ps) }}
                      onClick={() => setActiveFontFilter(activeFontFilter === ps ? null : ps)}
                      title={getFontLabel(ps)}
                    >
                      {getFontLabel(ps).substring(0, 12)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {textLayers.length === 0 ? (
              <p className="text-[11px] text-text-muted text-center py-4">テキストレイヤーがありません</p>
            ) : (
              <div className="divide-y divide-border/20">
                {textLayers
                  .filter((tl) => !activeFontFilter || (tl.textInfo?.fonts || []).includes(activeFontFilter))
                  .map((tl, i) => {
                    const mainFont = tl.textInfo?.fonts[0];
                    const color = mainFont ? getFontColor(mainFont) : "#888";
                    const isHighlighted = highlightBounds && tl.bounds &&
                      tl.bounds.top === highlightBounds.top && tl.bounds.left === highlightBounds.left;
                    return (
                      <div
                        key={`${tl.layerName}-${i}`}
                        className={`px-2 py-1.5 cursor-pointer hover:bg-bg-tertiary/60 transition-colors ${
                          isHighlighted ? "bg-accent/10" : ""
                        }`}
                        onClick={() => {
                          setHighlightBounds(tl.bounds || null);
                          if (tl.textInfo?.fonts[0]) setActiveFontFilter(tl.textInfo.fonts[0]);
                        }}
                      >
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                          <span className="text-[11px] text-text-primary truncate font-medium">{tl.layerName}</span>
                        </div>
                        {tl.textInfo && (
                          <div className="ml-3.5 mt-0.5">
                            <div className="text-[10px] text-text-secondary truncate" style={{ color }}>
                              {tl.textInfo.fonts.map((f) => getFontLabel(f)).join(", ")}
                            </div>
                            {tl.textInfo.fontSizes.length > 0 && (
                              <span className="text-[10px] text-text-muted">{tl.textInfo.fontSizes.join("/")}pt</span>
                            )}
                            {tl.textInfo.text && (
                              <div className="text-[10px] text-text-muted/60 truncate mt-0.5">
                                {tl.textInfo.text.replace(/\n/g, " ").substring(0, 30)}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
            {store.fontPresets.length > 0 && (
              <div className="border-t border-border/30 px-2 py-1.5">
                <div className="text-[10px] text-text-muted mb-1">フォントプリセット ({store.fontPresets.length})</div>
                <div className="flex flex-wrap gap-1">
                  {store.fontPresets.map((fp, i) => (
                    <button
                      key={i}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-bg-tertiary text-text-secondary hover:bg-accent/10 hover:text-accent transition-colors truncate max-w-full"
                      onClick={() => {
                        const sel = store.selectedBlockIds;
                        if (sel.size > 0) store.assignFontToBlocks([...sel], fp.font);
                      }}
                      title={`${fp.font}\n${fp.name}${fp.subName ? ` (${fp.subName})` : ""}`}
                    >
                      {fp.name || fp.font}{fp.subName ? <span className="opacity-60 ml-0.5">({fp.subName})</span> : null}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {textDiffResults && (
              <div className={`px-2 py-1.5 border-t border-border/30 ${textDiffResults.hasDiff ? "bg-warning/10" : "bg-success/10"}`}>
                <div className={`text-[10px] font-medium ${textDiffResults.hasDiff ? "text-warning" : "text-success"}`}>
                  テキスト照合: {textDiffResults.hasDiff ? "差異あり" : "一致"}
                </div>
              </div>
            )}
          </div>
        );
      case "text":
        return (
          <div className="flex flex-col h-full">
            {/* Mode toggle */}
            <div className="flex-shrink-0 px-2 py-1 border-b border-border/30 flex items-center gap-1.5">
              <div className="flex bg-bg-tertiary rounded overflow-hidden text-[10px]">
                <button onClick={() => store.setEditMode("select")} className={`px-2 py-0.5 transition-colors ${store.editMode === "select" ? "bg-accent text-white" : "text-text-secondary hover:text-text-primary"}`}>選択</button>
                <button onClick={() => store.setEditMode("edit")} className={`px-2 py-0.5 transition-colors ${store.editMode === "edit" ? "bg-accent text-white" : "text-text-secondary hover:text-text-primary"}`}>編集</button>
              </div>
              {store.selectedBlockIds.size > 0 && (
                <>
                  <button
                    className="text-[10px] px-1.5 py-0.5 rounded bg-bg-tertiary text-text-muted hover:text-error flex-shrink-0"
                    onClick={() => {
                      const pages = store.textPages.map((p) => ({
                        ...p,
                        blocks: p.blocks.map((b) =>
                          store.selectedBlockIds.has(b.id) ? { ...b, assignedFont: undefined } : b,
                        ),
                      }));
                      store.setTextPages(pages);
                      store.setIsDirty(true);
                      store.setSelectedBlockIds(new Set());
                    }}
                  >
                    ✕解除
                  </button>
                  <span className="text-[10px] text-text-muted flex-shrink-0">{store.selectedBlockIds.size}選択中</span>
                </>
              )}
            </div>
            {/* フォント情報 — 全ファイル使用フォント + JSONプリセット(ドロップダウン) */}
            {(allFilesFontMap.size > 0 || store.fontPresets.length > 0) && (
              <div className="flex-shrink-0 px-2 py-1.5 border-b border-border/30 space-y-1.5">
                {/* 全ファイル使用フォント — クリックで対象ページ移動 */}
                {allFilesFontMap.size > 0 && (
                  <div>
                    <div className="text-[9px] text-text-muted/60 mb-0.5">使用フォント ({allFilesFontMap.size}種 / 全{files.length}ファイル)</div>
                    <div className="flex flex-wrap gap-1">
                      {[...allFilesFontMap.entries()].map(([ps, fileIdxs]) => {
                        const isActive = activeFontFilter === ps;
                        const isCurrent = fileIdxs.includes(idx);
                        return (
                          <button
                            key={ps}
                            className={`text-[10px] px-1.5 py-0.5 rounded-full text-white transition-all ${
                              isActive ? "ring-1 ring-white/60 scale-105" : activeFontFilter ? "opacity-30" : ""
                            } ${isCurrent ? "" : "opacity-70"}`}
                            style={{ backgroundColor: getFontColor(ps) }}
                            onClick={() => {
                              if (isActive) {
                                // Cycle through pages containing this font
                                const prev = fontClickIdx.current.get(ps) ?? -1;
                                const next = (prev + 1) % fileIdxs.length;
                                fontClickIdx.current.set(ps, next);
                                store.setCurrentFileIndex(fileIdxs[next]);
                              } else {
                                setActiveFontFilter(ps);
                                fontClickIdx.current.set(ps, fileIdxs.indexOf(idx) >= 0 ? fileIdxs.indexOf(idx) : 0);
                                if (!fileIdxs.includes(idx)) store.setCurrentFileIndex(fileIdxs[0]);
                              }
                            }}
                            onDoubleClick={() => setActiveFontFilter(null)}
                            title={`${getFontLabel(ps)}\n${fileIdxs.length}ファイルで使用 (p.${fileIdxs.map((i) => i + 1).join(",")})\nクリック: ページ移動 / ダブルクリック: フィルタ解除`}
                          >
                            {getFontLabel(ps)}
                            <span className="ml-0.5 opacity-60 text-[9px]">({fileIdxs.length})</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                {/* 作品情報JSONプリセット — ドロップダウン */}
                {store.fontPresets.length > 0 && store.editMode === "select" && (
                  <div>
                    <div className="text-[9px] text-text-muted/60 mb-0.5">プリセットフォント</div>
                    <select
                      className="w-full text-[10px] bg-bg-primary border border-border/40 rounded px-1.5 py-0.5 text-text-primary outline-none"
                      value=""
                      onChange={(e) => {
                        const font = e.target.value;
                        if (!font) return;
                        const sel = store.selectedBlockIds;
                        if (sel.size > 0) {
                          store.assignFontToBlocks([...sel], font);
                          store.setSelectedBlockIds(new Set());
                        }
                      }}
                    >
                      <option value="">フォント割当を選択 ({store.fontPresets.length})</option>
                      {store.fontPresets.map((fp, i) => (
                        <option key={i} value={fp.font}>
                          {fp.name || getFontLabel(fp.font)}{fp.subName ? ` (${fp.subName})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}
            {/* Text content */}
            <div className="flex-1 overflow-auto">
              {store.textContent.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-text-muted p-4 text-center">
                  <p className="text-xs">テキストファイルを開く or .txt をD&amp;D</p>
                  <button onClick={openTextFile} className="px-3 py-1.5 text-[11px] font-medium text-white bg-gradient-to-r from-accent to-accent-secondary rounded-lg">
                    テキストを開く
                  </button>
                </div>
              ) : store.editMode === "edit" ? (
                <div className="flex flex-col h-full">
                  <textarea
                    ref={textareaRef}
                    className="flex-1 w-full p-3 text-sm font-mono bg-white text-black resize-none outline-none border-none"
                    value={editBuffer ?? store.textContent}
                    onChange={(e) => {
                      const pos = e.target.selectionStart;
                      setEditBuffer(e.target.value);
                      setEditCursorPos(pos);
                    }}
                    spellCheck={false}
                  />
                  <div className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 border-t border-border/30 bg-bg-tertiary/30">
                    {editBuffer !== null && editBuffer !== store.textContent && (
                      <span className="text-[10px] text-warning">未確定の変更あり</span>
                    )}
                    <div className="flex-1" />
                    <button
                      onClick={() => {
                        setEditBuffer(store.textContent);
                        setEditCursorPos(null);
                      }}
                      className="px-3 py-1 text-[10px] text-text-muted hover:text-text-primary bg-bg-tertiary rounded transition-colors"
                    >
                      リセット
                    </button>
                    <button
                      onClick={() => {
                        if (editBuffer !== null) {
                          store.setTextContent(editBuffer);
                          parseChunks(editBuffer);
                          store.setIsDirty(true);
                          const { header, pages } = parseComicPotText(editBuffer);
                          store.setTextHeader(header);
                          store.setTextPages(pages);
                        }
                      }}
                      disabled={editBuffer === null || editBuffer === store.textContent}
                      className="px-3 py-1 text-[10px] font-medium text-white bg-accent rounded disabled:opacity-30 transition-colors"
                    >
                      確定
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-2">
                  {store.textPages.length > 0 ? (
                    store.textPages.map((page) => {
                      const isActivePage = page.pageNumber === idx + 1;
                      const hasReorder = page.blocks.some((b, i) => b.originalIndex !== i);
                      return (
                        <div key={page.pageNumber} className="mb-2">
                          <div
                            className={`flex items-center gap-2 text-[10px] font-mono border-t border-border/40 pt-1 mt-1 mb-1 cursor-pointer ${
                              isActivePage ? "text-accent font-medium" : "text-text-muted/60"
                            }`}
                            onClick={() => {
                              if (pageSync) navigateToTextPage(page.pageNumber);
                            }}
                          >
                            <span>&lt;&lt;{page.pageNumber}Page&gt;&gt;</span>
                            {isActivePage && <span className="text-accent text-[9px]">●</span>}
                            {hasReorder && <span className="text-warning text-[9px]">順序変更</span>}
                          </div>
                          <DndContext
                            sensors={dndSensors}
                            collisionDetection={closestCenter}
                            onDragEnd={(e) => handleBlockReorder(page.pageNumber, e)}
                          >
                            <SortableContext
                              items={page.blocks.map((b) => b.id)}
                              strategy={verticalListSortingStrategy}
                            >
                              {page.blocks.map((block, blockIdx) => (
                                <SortableBlockItem
                                  key={block.id}
                                  block={block}
                                  blockIdx={blockIdx}
                                  isSelected={store.selectedBlockIds.has(block.id)}
                                  fontColor={block.assignedFont ? getFontColor(block.assignedFont) : undefined}
                                  fontLabel={block.assignedFont ? getFontLabel(block.assignedFont) : undefined}
                                  onClick={(e) => {
                                    const sel = new Set(store.selectedBlockIds);
                                    if (e.ctrlKey || e.metaKey) {
                                      if (sel.has(block.id)) sel.delete(block.id);
                                      else sel.add(block.id);
                                    } else if (e.shiftKey && sel.size > 0) {
                                      const ids = page.blocks.map((b) => b.id);
                                      const lastIdx = ids.findIndex((id) => sel.has(id));
                                      const curIdx = ids.indexOf(block.id);
                                      if (lastIdx >= 0) {
                                        const [from, to] = lastIdx < curIdx ? [lastIdx, curIdx] : [curIdx, lastIdx];
                                        for (let k = from; k <= to; k++) sel.add(ids[k]);
                                      } else {
                                        sel.add(block.id);
                                      }
                                    } else {
                                      sel.clear();
                                      sel.add(block.id);
                                    }
                                    store.setSelectedBlockIds(sel);
                                    if (pageSync) navigateToTextPage(page.pageNumber);
                                  }}
                                />
                              ))}
                            </SortableContext>
                          </DndContext>
                        </div>
                      );
                    })
                  ) : (
                    chunks.map((c, ci) => (
                      <div key={ci}>
                        {(ci === 0 || chunks[ci - 1]?.page !== c.page) && c.page > 0 && (
                          <div className="text-[10px] text-text-muted/60 font-mono border-t border-border/40 pt-1 mt-1 mb-0.5">
                            &lt;&lt;{c.page}Page&gt;&gt;
                          </div>
                        )}
                        <div
                          className={`px-2 py-1.5 rounded text-sm font-mono whitespace-pre-wrap cursor-pointer transition-colors text-black ${
                            selectedChunk === ci ? "bg-accent/10 ring-1 ring-accent/30" : "hover:bg-bg-tertiary/60"
                          }`}
                          onClick={() => {
                            setSelectedChunk(ci);
                            if (pageSync && c.page > 0) navigateToTextPage(c.page);
                          }}
                        >
                          {c.text.trim() || <span className="text-text-muted/40 italic">（空）</span>}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        );
      case "diff":
        return (
          <div className="flex flex-col h-full">
            {!textDiffResults ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-text-muted p-4 text-center">
                <p className="text-xs">
                  {!cur
                    ? "ファイルを選択してください"
                    : textLayers.length === 0 && !cur.metadata
                      ? "メタデータを読み込み中..."
                      : textLayers.length === 0
                        ? "このファイルにはテキストレイヤーがありません"
                        : store.textContent.length === 0
                          ? "テキストファイルを読み込んでください"
                          : "照合データがありません"}
                </p>
              </div>
            ) : (
              <>
                {/* ステータスバー + 設定 */}
                <div className={`flex-shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-border/30 ${
                  textDiffResults.hasDiff ? "bg-warning/10" : "bg-success/10"
                }`}>
                  <span className={`text-[11px] font-medium ${textDiffResults.hasDiff ? "text-warning" : "text-success"}`}>
                    {textDiffResults.hasDiff ? "差異あり" : "一致"}
                  </span>
                  <span className="text-[10px] text-text-muted">
                    p.{idx + 1} — PSD: {textDiffResults.psdLayerTexts.length}レイヤー / テキスト: {textDiffResults.loadedBlocks.length}ブロック
                  </span>
                  <div className="flex-1" />
                  <span className="text-[9px] text-text-muted/50">一致:</span>
                  <div className="flex bg-bg-tertiary rounded overflow-hidden text-[9px]">
                    <button onClick={() => setDiffMatchDisplay("psd")} className={`px-1.5 py-0.5 transition-colors ${diffMatchDisplay === "psd" ? "bg-accent text-white" : "text-text-muted hover:text-text-primary"}`}>PSD</button>
                    <button onClick={() => setDiffMatchDisplay("text")} className={`px-1.5 py-0.5 transition-colors ${diffMatchDisplay === "text" ? "bg-accent text-white" : "text-text-muted hover:text-text-primary"}`}>テキスト</button>
                  </div>
                </div>
                {/* 単ページ化は中央ナビバーに統合済み */}

                {/* レイヤー↔テキスト対応リスト + 差分表示 */}
                <div className="flex-1 overflow-auto">
                  <div className="divide-y divide-border/20">
                    {textDiffResults.psdLayerTexts.map((layer, pi) => {
                      const bi = textDiffResults.linkMap.get(pi);
                      const block = bi !== undefined ? textDiffResults.loadedBlocks[bi] : null;
                      const normL = normalizeTextForComparison(layer.text);
                      const normB = block ? normalizeTextForComparison(block.text) : "";
                      const isMatch = block ? normL === normB : false;
                      const linkColor = FONT_COLORS[pi % FONT_COLORS.length];
                      return (
                        <div key={pi} className={`${isMatch ? "" : "bg-warning/5"}`}>
                          {/* ペアヘッダー — 差異時のみ表示 */}
                          {!isMatch && (
                            <div className="flex items-center gap-1.5 px-2 py-1 bg-bg-tertiary/30">
                              <span className="w-4 h-4 rounded-full text-[9px] text-white flex items-center justify-center font-bold flex-shrink-0" style={{ backgroundColor: linkColor }}>
                                {pi + 1}
                              </span>
                              <span className="text-[10px] text-text-primary font-medium truncate">{layer.layerName}</span>
                              <span className="text-[9px] text-text-muted/50">→</span>
                              {block ? (
                                <span className="text-[10px] text-text-muted">ブロック {bi! + 1}</span>
                              ) : (
                                <span className="text-[10px] text-error">対応なし</span>
                              )}
                              <div className="flex-1" />
                              <span className="text-[9px] text-warning font-medium">差異</span>
                            </div>
                          )}
                          {/* コンテンツ: 差異あり→2カラム、一致→1カラム（切替） */}
                          {isMatch ? (
                            <div className="px-2 py-1 text-[10px] font-mono whitespace-pre-wrap break-all text-text-secondary">
                              {diffMatchDisplay === "psd" ? layer.text : (block?.text ?? "")}
                            </div>
                          ) : (
                            <div className="grid grid-cols-2 gap-0">
                              <div className="px-2 py-1 text-[10px] font-mono whitespace-pre-wrap break-all text-text-secondary border-r border-border/20">
                                <div className="text-[9px] text-text-muted/40 mb-0.5">PSD</div>
                                {layer.text}
                              </div>
                              <div className="px-2 py-1 text-[10px] font-mono whitespace-pre-wrap break-all text-text-secondary">
                                <div className="text-[9px] text-text-muted/40 mb-0.5">テキスト</div>
                                {block ? block.text : <span className="text-text-muted/30 italic">—</span>}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {/* テキストにのみ存在するブロック（PSD対応なし） */}
                    {textDiffResults.loadedBlocks.map((block, bi) => {
                      const isLinked = [...textDiffResults.linkMap.values()].includes(bi);
                      if (isLinked) return null;
                      return (
                        <div key={`extra-${bi}`} className="bg-success/5">
                          <div className="flex items-center gap-1.5 px-2 py-1 bg-bg-tertiary/30">
                            <span className="w-4 h-4 rounded-full text-[9px] bg-success/60 text-white flex items-center justify-center font-bold flex-shrink-0">+</span>
                            <span className="text-[10px] text-success">テキストのみ — ブロック {bi + 1}</span>
                          </div>
                          <div className="px-2 py-1 text-[10px] font-mono whitespace-pre-wrap break-all text-success">
                            {block.text}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* 文字レベル差分詳細 */}
                  {textDiffResults.hasDiff && textDiffResults.unifiedEntries.length > 0 && (
                    <div className="p-3 border-t border-border/30">
                      <div className="text-[10px] font-medium text-warning mb-1.5">文字レベル差分</div>
                      <UnifiedDiffDisplay entries={textDiffResults.unifiedEntries} />
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        );
      case "proofread":
        return (
          <div className="flex flex-col h-full">
            {/* Check mode toggle inside content */}
            <div className="flex-shrink-0 px-2 py-1 border-b border-border/30 flex items-center gap-0.5 text-[10px]">
              {(["correctness", "proposal", "both"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => store.setCheckTabMode(m)}
                  className={`px-1.5 py-0.5 rounded transition-colors ${
                    store.checkTabMode === m ? "bg-accent/15 text-accent" : "text-text-muted hover:text-text-secondary"
                  }`}
                >
                  {m === "correctness" ? "正誤" : m === "proposal" ? "提案" : "全て"}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-auto">
              {filteredCheckItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-text-muted p-4 text-center">
                  <p className="text-xs">
                    {!checkData ? "校正チェックJSONを読み込んでください" : "該当する項目がありません"}
                  </p>
                  {!checkData && (
                    <button onClick={() => setJsonBrowserMode("check")} className="px-3 py-1.5 text-[11px] font-medium text-white bg-gradient-to-r from-accent to-accent-secondary rounded-lg">
                      JSON読込
                    </button>
                  )}
                </div>
              ) : (
                <div className="divide-y divide-border/30">
                  {(checkFilterCategory === "all" ? categories : [checkFilterCategory]).length > 1 && (
                    <div className="px-2 py-1 bg-bg-tertiary/30">
                      <select
                        className="text-[10px] bg-bg-tertiary border border-border/50 rounded px-1 py-0.5 text-text-secondary outline-none w-full"
                        value={checkFilterCategory}
                        onChange={(e) => setCheckFilterCategory(e.target.value)}
                      >
                        <option value="all">全カテゴリ ({activeCheckItems.length})</option>
                        {categories.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {filteredCheckItems.map((item, i) => {
                    const colorIdx = getCategoryColorIndex(item.category);
                    const color = colorIdx >= 0 ? CATEGORY_COLORS[colorIdx] : "#888";
                    return (
                      <div
                        key={i}
                        className="px-3 py-2 hover:bg-bg-tertiary/40 transition-colors text-xs cursor-pointer"
                        onClick={() => {
                          if (pageSync && item.page) {
                            const pn = parseInt(item.page, 10);
                            if (!isNaN(pn) && pn > 0) navigateToTextPage(pn);
                          }
                        }}
                      >
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium text-white" style={{ backgroundColor: color }}>
                            {item.category || "—"}
                          </span>
                          {item.page && <span className="text-text-muted/60 text-[10px]">p.{item.page}</span>}
                          <span className={`text-[10px] ${item.checkKind === "correctness" ? "text-error" : "text-accent-secondary"}`}>
                            {item.checkKind === "correctness" ? "正誤" : "提案"}
                          </span>
                        </div>
                        {item.excerpt && <div className="text-text-secondary mt-0.5 font-mono">{item.excerpt}</div>}
                        {item.content && <div className="text-text-muted mt-0.5">{item.content}</div>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      default:
        return null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, idx, cur, layerTree, textLayers, postScriptNames, allFilesFontMap, activeFontFilter, highlightBounds, store.fontPresets, store.textContent, store.editMode, store.textPages, store.selectedBlockIds, store.checkTabMode, textDiffResults, diffMatchDisplay, diffSplitMode, fileDiffStatusMap, editBuffer, checkData, filteredCheckItems, activeCheckItems, categories, checkFilterCategory, chunks, selectedChunk, pageSync, navigateToTextPage, fontResolveMap, fontResolved]);

  // ═══════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════
  return (
    <div
      ref={containerRef}
      className="flex flex-col h-full w-full bg-bg-primary"
      style={{ userSelect: resizingSide ? "none" : undefined }}
      onContextMenu={(e) => {
        e.preventDefault();
        setViewerContextMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {/* ─── Top toolbar ─── */}
      <div className="flex-shrink-0 h-7 bg-bg-secondary border-b border-border flex items-center px-2 gap-1 text-xs">
        <ToolBtn onClick={handleSave} disabled={!store.isDirty || !store.textFilePath} title="上書き保存">
          保存
        </ToolBtn>
        <ToolBtn onClick={handleSaveAs} disabled={!store.textContent} title="名前を付けて保存">
          別名保存
        </ToolBtn>
        <div className="w-px h-4 bg-border mx-0.5" />
        <button
          onClick={() => setPageSync((v) => !v)}
          className={`px-2 py-1 rounded transition-colors ${
            pageSync ? "text-accent bg-accent/10 font-semibold" : "text-text-muted hover:text-text-primary hover:bg-bg-tertiary"
          }`}
          title={pageSync ? "ページ連動 ON" : "ページ連動 OFF"}
        >
          連動{pageSync ? " ON" : ""}
        </button>
        <div className="flex-1" />
        {cur && <span className="text-text-muted truncate max-w-[200px]" title={cur.name}>{cur.name}</span>}
        {dims.w > 0 && <span className="text-text-muted/50 ml-1">{dims.w}×{dims.h}</span>}
      </div>

      {/* ─── Tab selector bar (outside resize area) ─── */}
      <div className="flex-shrink-0 h-7 bg-bg-tertiary/50 border-b border-border/50 flex items-center text-[10px]">
        {/* Left panel tabs */}
        <div className="flex items-center gap-0.5 px-1 border-r border-border/30">
          <span className="text-text-muted/40 text-[9px] mr-0.5">L</span>
          {ALL_PANEL_TABS.map((t) => (
            <PanelTabBtn key={t.id} active={store.leftTab === t.id} onClick={() => { store.setLeftTab(t.id); setLeftManualResize(false); }}>
              {t.label}
            </PanelTabBtn>
          ))}
        </div>
        <div className="flex-1" />
        {/* Right panel tabs */}
        <div className="flex items-center gap-0.5 px-1 border-l border-border/30">
          {ALL_PANEL_TABS.map((t) => (
            <PanelTabBtn
              key={t.id}
              active={store.rightTab === t.id}
              onClick={() => { store.setRightTab(t.id); setRightManualResize(false); }}
              badge={t.id === "proofread" ? (checkData?.allItems.length || undefined) : t.id === "diff" ? (textDiffResults?.hasDiff ? 1 : undefined) : undefined}
            >
              {t.label}
            </PanelTabBtn>
          ))}
          <span className="text-text-muted/40 text-[9px] ml-0.5">R</span>
          {store.isDirty && <span className="text-warning text-[10px] ml-1">未保存</span>}
        </div>
      </div>

      {/* ─── Main 3-column area ─── */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* ═══ LEFT SIDEBAR ═══ */}
        <div className="flex flex-col overflow-hidden bg-bg-secondary border-r border-border" style={{ width: leftWidth }}>
          {/* Left content — shared renderer */}
          <div className="flex-1 overflow-auto">
            {renderTabContent(store.leftTab)}
          </div>
        </div>

        {/* Left resize handle */}
        <div
          className={`w-1 flex-shrink-0 cursor-col-resize hover:bg-accent/30 transition-colors ${
            resizingSide === "left" ? "bg-accent/50" : "bg-transparent"
          }`}
          onMouseDown={(e) => { e.preventDefault(); setResizingSide("left"); }}
        />

        {/* ═══ CENTER: Image viewer ═══ */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Center nav bar */}
          <div className="flex-shrink-0 h-6 bg-bg-tertiary/30 border-b border-border/30 flex items-center px-2 gap-1 text-[11px]">
            <button onClick={goPrev} disabled={idx <= 0} className="px-1 text-text-secondary hover:text-text-primary disabled:opacity-30">◀</button>
            <span className="text-text-muted tabular-nums min-w-[40px] text-center">
              {files.length > 0 ? `${idx + 1}/${files.length}` : "—"}
            </span>
            <button onClick={goNext} disabled={idx >= files.length - 1} className="px-1 text-text-secondary hover:text-text-primary disabled:opacity-30">▶</button>
            <div className="w-px h-3 bg-border mx-1" />
            <button onClick={zoomOut} disabled={zoom <= 0} className="px-0.5 text-text-secondary disabled:opacity-30">−</button>
            <button onClick={zoomFit} className="px-1 text-text-muted hover:text-text-primary rounded tabular-nums">{zoomLabel}</button>
            <button onClick={zoomIn} disabled={zoom >= ZOOM_STEPS.length} className="px-0.5 text-text-secondary disabled:opacity-30">+</button>
            <div className="w-px h-3 bg-border mx-1" />
            {/* 単ページ化（見開き分割） */}
            <button
              onClick={() => setSpreadMode((v) => !v)}
              className={`text-[9px] px-1.5 py-0 rounded transition-colors ${spreadMode ? "bg-orange-600 text-white" : "bg-bg-tertiary text-text-muted hover:text-text-primary"}`}
              title="見開きPDFを単ページに分割"
            >
              単ページ化
            </button>
            {spreadMode && (
              <>
                <select
                  className="text-[9px] bg-bg-primary border border-border/40 rounded px-1 py-0 text-text-muted outline-none"
                  value={firstPageMode}
                  onChange={(e) => setFirstPageMode(e.target.value as typeof firstPageMode)}
                >
                  <option value="single">1P単独</option>
                  <option value="spread">1Pも見開き</option>
                  <option value="skip">1P除外</option>
                </select>
                <button
                  onClick={() => setSplitReadOrder((v) => v === "right-first" ? "left-first" : "right-first")}
                  className="text-[9px] px-1.5 py-0 rounded bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
                  title={`読み順: ${splitReadOrder === "right-first" ? "右→左（漫画）" : "左→右（通常）"}`}
                >
                  {splitReadOrder === "right-first" ? "右→左" : "左→右"}
                </button>
                <span className="text-[9px] text-accent/70 tabular-nums">
                  {logicalPage + 1}/{maxLogicalPage} ({splitViewSide === "full" ? "全体" : splitViewSide === "left" ? "左" : "右"})
                </span>
              </>
            )}
            <div className="flex-1" />
            {metadata && (
              <span className="text-text-muted/50">
                {metadata.dpi}dpi {metadata.colorMode}
                {(() => {
                  const ps = detectPaperSize(metadata.width, metadata.height, metadata.dpi);
                  return ps ? ` (${ps})` : "";
                })()}
              </span>
            )}
          </div>

          {/* Image area */}
          <div
            ref={canvasRef}
            className={`flex-1 overflow-auto flex items-center justify-center bg-[#1a1a1e] ${
              zoom > 0 ? (dragging ? "cursor-grabbing" : "cursor-grab") : ""
            } ${dragOver ? "ring-2 ring-inset ring-accent/50" : ""}`}
            onMouseDown={onCanvasMouseDown}
            style={{ userSelect: "none" }}
          >
            {files.length === 0 ? (
              <div className="flex flex-col items-center gap-3 text-text-muted p-8 text-center">
                <svg className="w-12 h-12 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <p className="text-xs">画像フォルダを開く or D&amp;D</p>
              </div>
            ) : loading && !imgUrl ? (
              <div className="text-text-muted">
                <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </div>
            ) : imgUrl ? (
              <div className="relative w-full h-full flex items-center justify-center">
                {splitWrapStyle ? (
                  <div style={splitWrapStyle}>
                    <img ref={imgRef} src={imgUrl} alt={cur?.name || ""} style={{ ...imgStyle, ...splitImgExtra }} draggable={false} className="block" />
                  </div>
                ) : (
                  <img ref={imgRef} src={imgUrl} alt={cur?.name || ""} style={imgStyle} draggable={false} className="block" />
                )}
                {/* Layer bounds highlight overlay */}
                {highlightBounds && dims.w > 0 && imgRef.current && (
                  <svg
                    className="absolute inset-0 pointer-events-none"
                    viewBox={`0 0 ${dims.w} ${dims.h}`}
                    style={{ width: "100%", height: "100%" }}
                    preserveAspectRatio="xMidYMid meet"
                  >
                    <rect
                      x={highlightBounds.left}
                      y={highlightBounds.top}
                      width={highlightBounds.right - highlightBounds.left}
                      height={highlightBounds.bottom - highlightBounds.top}
                      fill="rgba(255,90,138,0.15)"
                      stroke="#ff5a8a"
                      strokeWidth={Math.max(2, dims.w / 500)}
                      rx={2}
                    />
                  </svg>
                )}
              </div>
            ) : null}
          </div>
        </div>

        {/* Right resize handle */}
        <div
          className={`w-1 flex-shrink-0 cursor-col-resize hover:bg-accent/30 transition-colors ${
            resizingSide === "right" ? "bg-accent/50" : "bg-transparent"
          }`}
          onMouseDown={(e) => { e.preventDefault(); setResizingSide("right"); }}
        />

        {/* ═══ RIGHT PANEL ═══ */}
        <div className="flex flex-col overflow-hidden bg-bg-secondary border-l border-border" style={{ width: rightWidth }}>
          {/* Right content — shared renderer */}
          <div className="flex-1 overflow-auto">
            {renderTabContent(store.rightTab)}
          </div>
        </div>
      </div>

      {/* ─── Status bar ─── */}
      <div className="flex-shrink-0 h-5 bg-bg-secondary border-t border-border flex items-center px-3 text-[10px] text-text-muted/60 gap-3">
        <span>{files.length} ファイル</span>
        {store.textContent.length > 0 && <span>{chunks.length} ブロック</span>}
        {checkData && (
          <span>校正: {checkData.correctnessItems.length}正誤 / {checkData.proposalItems.length}提案</span>
        )}
        {store.fontPresets.length > 0 && <span>フォント: {store.fontPresets.length}件</span>}
        {pageSync && <span className="text-accent">ページ連動</span>}
      </div>

      {/* ─── JSON File Browser Modal ─── */}
      {jsonBrowserMode && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40" onMouseDown={(e) => { if (e.target === e.currentTarget) setJsonBrowserMode(null); }}>
          <div className="bg-bg-secondary rounded-xl shadow-2xl w-[500px] max-h-[70vh] flex flex-col overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2 border-b border-border">
              <h3 className="text-sm font-medium">
                {jsonBrowserMode === "preset" ? "作品情報JSON" : "校正データJSON"} を選択
              </h3>
              <button onClick={() => setJsonBrowserMode(null)} className="text-text-muted hover:text-text-primary">✕</button>
            </div>
            <div className="flex-1 overflow-auto">
              {jsonBrowserMode === "check" ? (
                <CheckJsonBrowser
                  onSelect={handleJsonFileSelect}
                  onCancel={() => setJsonBrowserMode(null)}
                />
              ) : jsonFolderPath ? (
                <JsonFileBrowser
                  basePath={jsonFolderPath}
                  onSelect={handleJsonFileSelect}
                  onCancel={() => setJsonBrowserMode(null)}
                  mode="open"
                />
              ) : (
                <div className="p-4 text-center text-text-muted text-xs">
                  <p>JSONフォルダパスが設定されていません</p>
                  <p className="mt-1 text-[10px]">スキャナータブでJSONフォルダを設定してください</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* 右クリックコンテキストメニュー */}
      {viewerContextMenu && (
        <FileContextMenu
          x={viewerContextMenu.x}
          y={viewerContextMenu.y}
          files={(() => {
            const psd = usePsdStore.getState();
            const currentFile = store.files[store.currentFileIndex];
            if (!currentFile) return [];
            const match = psd.files.find((f) => f.filePath === currentFile.path);
            return match ? [match] : [];
          })()}
          allFiles={usePsdStore.getState().files}
          onClose={() => setViewerContextMenu(null)}
          viewerMode
        />
      )}
    </div>
  );
}

// (CheckJsonBrowser is now in ./UnifiedSubComponents.tsx)
// Re-export for backward compatibility (TopNav imports it from here)
export { CheckJsonBrowser } from "./UnifiedSubComponents";

