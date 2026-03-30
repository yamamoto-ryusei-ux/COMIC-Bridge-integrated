/**
 * 統合ビューアー — 3カラムレイアウト
 * Left: ファイルリスト / レイヤー構造 / 写植仕様
 * Center: 画像ビューアー (PSD/Image/PDF)
 * Right: テキスト編集 / 校正JSON
 */
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
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
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open as dialogOpen, save as dialogSave } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import {
  useUnifiedViewerStore,
  type ViewerFile,
  type TextPage,
  type TextBlock,
  type FontPresetEntry,
} from "../../store/unifiedViewerStore";
import type { LayerNode } from "../../types";
import {
  type ProofreadingCheckItem,
  CATEGORY_COLORS,
  getCategoryColorIndex,
} from "../../types/typesettingCheck";
import { detectPaperSize } from "../../lib/paperSize";
import { JsonFileBrowser } from "../scanPsd/JsonFileBrowser";
import { useScanPsdStore } from "../../store/scanPsdStore";
import { usePsdStore } from "../../store/psdStore";
import {
  collectTextLayers,
  FONT_COLORS,
  MISSING_FONT_COLOR,
  type FontResolveInfo,
} from "../../hooks/useFontResolver";
import { normalizeTextForComparison } from "../../kenban-utils/textExtract";

// ─── Constants ──────────────────────────────────────────
const ZOOM_STEPS = [0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0];
const MAX_SIZE = 2000;
const CHECK_JSON_BASE_PATH = "G:/共有ドライブ/CLLENN/編集部フォルダ/編集企画部/写植・校正用テキストログ";
const CHECK_DATA_SUBFOLDER = "校正チェックデータ";
const IMAGE_EXTS = new Set([
  ".psd",".psb",".jpg",".jpeg",".png",".tif",".tiff",".bmp",".gif",".pdf",".eps",
]);

// ─── COMIC-POT Parser ───────────────────────────────────
function parseComicPotText(content: string): { header: string[]; pages: TextPage[] } {
  const lines = content.split(/\r?\n/);
  const header: string[] = [];
  const pages: TextPage[] = [];
  let currentPage: TextPage | null = null;
  const pageRegex = /^<<(\d+)Page>>$/;
  let blockLines: string[] = [];
  let blockIndex = 0;
  const flushBlock = () => {
    if (blockLines.length > 0 && currentPage) {
      currentPage.blocks.push({
        id: `p${currentPage.pageNumber}-b${blockIndex}`,
        originalIndex: blockIndex,
        lines: [...blockLines],
      });
      blockIndex++;
      blockLines = [];
    }
  };
  for (const line of lines) {
    const match = line.match(pageRegex);
    if (match) {
      flushBlock();
      blockIndex = 0;
      blockLines = [];
      currentPage = { pageNumber: parseInt(match[1], 10), blocks: [] };
      pages.push(currentPage);
    } else if (currentPage) {
      if (line.trim() === "") flushBlock();
      else blockLines.push(line);
    } else {
      header.push(line);
    }
  }
  flushBlock();
  return { header, pages };
}

function serializeText(
  header: string[],
  pages: TextPage[],
  fontPresets: FontPresetEntry[],
): string {
  const lines: string[] = [];
  for (const h of header) lines.push(h);
  for (const page of pages) {
    lines.push(`<<${page.pageNumber}Page>>`);
    for (const block of page.blocks) {
      if (block.assignedFont) {
        const fp = fontPresets.find((f) => f.font === block.assignedFont);
        const sanitize = (s: string) => s.replace(/[()（）[\]]/g, "");
        const nameInfo = fp
          ? `(${sanitize(fp.name)}${fp.subName ? `(${sanitize(fp.subName)})` : ""})`
          : "";
        lines.push(`[font:${block.assignedFont}${nameInfo}]`);
      }
      for (const l of block.lines) lines.push(l);
      lines.push("");
    }
  }
  return lines.join("\r\n");
}

// ─── Helpers ────────────────────────────────────────────
function isImageFile(name: string): boolean {
  const ext = name.substring(name.lastIndexOf(".")).toLowerCase();
  return IMAGE_EXTS.has(ext);
}
function isPsdFile(name: string): boolean {
  const ext = name.substring(name.lastIndexOf(".")).toLowerCase();
  return ext === ".psd" || ext === ".psb";
}

// ─── Cache ──────────────────────────────────────────────
interface CacheEntry { url: string; w: number; h: number }

// ═════════════════════════════════════════════════════════
// Main Component
// ═════════════════════════════════════════════════════════
export function UnifiedViewer() {
  const store = useUnifiedViewerStore();

  // Sync with psdStore: auto-load PSD files from main store if viewer has no files
  const psdFiles = usePsdStore((s) => s.files);
  useEffect(() => {
    if (store.files.length === 0 && psdFiles.length > 0) {
      const viewerFiles: ViewerFile[] = psdFiles.map((f) => ({
        name: f.fileName,
        path: f.filePath,
        sourceType: /\.(psd|psb)$/i.test(f.fileName) ? "psd" as const : f.filePath.toLowerCase().endsWith(".pdf") ? "pdf" as const : "image" as const,
        metadata: f.metadata || undefined,
      }));
      store.setFiles(viewerFiles);
    }
  }, [psdFiles.length]);

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

  // Text diff (テキスト照合)
  const [textDiffResults, setTextDiffResults] = useState<{ psdText: string; loadedText: string; hasDiff: boolean } | null>(null);

  // Panel resize
  const [leftWidth, setLeftWidth] = useState(240);
  const [rightWidth, setRightWidth] = useState(420);
  const [resizingSide, setResizingSide] = useState<"left" | "right" | null>(null);

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
      if (i < 0 || i >= files.length) return;
      setLoading(true);
      const f = files[i];
      const cached = cache.current.get(f.path);
      if (cached) {
        setImgUrl(cached.url);
        setDims({ w: cached.w, h: cached.h });
        setLoading(false);
        return;
      }
      try {
        let e: CacheEntry | null = null;
        if (f.isPdf && f.pdfPath && f.pdfPage) {
          e = await renderPdfPage(f.pdfPath, f.pdfPage);
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
          cache.current.set(f.path, e);
          setImgUrl(e.url);
          setDims({ w: e.w, h: e.h });
        }
      } catch {
        /* ignore */
      }
      setLoading(false);
    },
    [files, renderPdfPage],
  );

  // Prefetch ±2
  useEffect(() => {
    if (idx < 0 || files.length === 0) return;
    for (const off of [1, -1, 2, -2]) {
      const ni = idx + off;
      if (ni < 0 || ni >= files.length || cache.current.has(files[ni].path)) continue;
      const f = files[ni];
      if (f.isPdf && f.pdfPath && f.pdfPage)
        renderPdfPage(f.pdfPath, f.pdfPage).then((e) => e && cache.current.set(f.path, e));
      else
        invoke<any>("get_high_res_preview", { filePath: f.path, maxSize: MAX_SIZE })
          .then((r: any) => {
            if (r.file_path)
              cache.current.set(f.path, {
                url: convertFileSrc(r.file_path),
                w: r.original_width || 0,
                h: r.original_height || 0,
              });
          })
          .catch(() => {});
    }
  }, [idx, files, renderPdfPage]);

  useEffect(() => {
    if (idx >= 0 && files.length > 0) loadImage(idx);
  }, [idx, loadImage, files.length]);

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

  // ═══ File open ═══
  const openFolder = useCallback(async () => {
    const folderPath = await dialogOpen({ directory: true, multiple: false });
    if (!folderPath) return;
    try {
      const fileList = await invoke<string[]>("list_folder_files", {
        folderPath,
        recursive: false,
      });
      const raw: ViewerFile[] = fileList
        .filter((p) => isImageFile(p.substring(p.lastIndexOf("\\") + 1)))
        .map((p) => ({
          name: p.substring(p.lastIndexOf("\\") + 1),
          path: p,
          sourceType: isPsdFile(p) ? "psd" as const : p.toLowerCase().endsWith(".pdf") ? "pdf" as const : "image" as const,
        }));
      const expanded = await expandPdf(raw);
      store.setFiles(expanded);
      cache.current.clear();
      setZoom(0);
      store.setLeftTab("files");
    } catch { /* ignore */ }
  }, [expandPdf]);

  const openTextFile = useCallback(async () => {
    const path = await dialogOpen({
      filters: [{ name: "テキスト", extensions: ["txt"] }],
      multiple: false,
    });
    if (!path) return;
    try {
      const bytes = await readFile(path as string);
      const content = new TextDecoder("utf-8").decode(bytes);
      store.setTextContent(content);
      store.setTextFilePath(path as string);
      const { header, pages } = parseComicPotText(content);
      store.setTextHeader(header);
      store.setTextPages(pages);
      store.setIsDirty(false);
      parseChunks(content);
      store.setRightTab("text");
    } catch { /* ignore */ }
  }, []);

  // JSON file selection via JsonFileBrowser
  const handleJsonFileSelect = useCallback(async (filePath: string) => {
    try {
      const content = await invoke<string>("read_text_file", { filePath });
      const data = JSON.parse(content);

      if (jsonBrowserMode === "check") {
        // Proofreading JSON
        const allItems: ProofreadingCheckItem[] = [];
        const parse = (src: any, fallbackKind: "correctness" | "proposal") => {
          // src can be: array directly, or { items: [...] }
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
          parse(data.checks.simple, "correctness");
          parse(data.checks.variation, "proposal");
        } else if (Array.isArray(data)) {
          parse(data, "correctness");
        }
        const correctnessItems = allItems.filter((i) => i.checkKind === "correctness");
        const proposalItems = allItems.filter((i) => i.checkKind === "proposal");
        store.setCheckData({
          title: data.work || "",
          fileName: filePath.substring(filePath.lastIndexOf("\\") + 1),
          filePath,
          allItems,
          correctnessItems,
          proposalItems,
        });
        store.setRightTab("proofread");
        store.setCheckTabMode(correctnessItems.length > 0 ? "correctness" : "proposal");
      } else {
        // Preset JSON — extract font presets
        // フォールバック: data.presetData.presets → data.presets → data.presetSets → data 自体
        const presets: FontPresetEntry[] = [];
        const presetsObj = data?.presetData?.presets ?? data?.presets ?? data?.presetSets ?? data;
        if (typeof presetsObj === "object" && presetsObj !== null) {
          if (Array.isArray(presetsObj)) {
            // 配列形式: [{font, name, subName}, ...]
            for (const p of presetsObj)
              if (p?.font || p?.postScriptName)
                presets.push({
                  font: p.font || p.postScriptName,
                  name: p.name || p.displayName || p.font || "",
                  subName: p.subName || p.category || "",
                });
          } else {
            // オブジェクト形式: { "セット名": [{font, name, subName}, ...], ... }
            for (const [, arr] of Object.entries(presetsObj)) {
              if (!Array.isArray(arr)) continue;
              for (const p of arr as any[])
                if (p?.font || p?.postScriptName)
                  presets.push({
                    font: p.font || p.postScriptName,
                    name: p.name || p.displayName || "",
                    subName: p.subName || "",
                  });
            }
          }
        }
        if (presets.length > 0) {
          store.setFontPresets(presets);
          store.setPresetJsonPath(filePath);
        }
      }
    } catch { /* ignore */ }
    setJsonBrowserMode(null);
  }, [jsonBrowserMode]);

  const handleSave = useCallback(async () => {
    if (!store.textFilePath || !store.textContent) return;
    try {
      await invoke("write_text_file", { filePath: store.textFilePath, content: store.textContent });
      store.setIsDirty(false);
    } catch { /* ignore */ }
  }, [store.textFilePath, store.textContent]);

  const handleSaveAs = useCallback(async () => {
    const path = await dialogSave({
      filters: [{ name: "テキスト", extensions: ["txt"] }],
    });
    if (!path) return;
    const content = serializeText(store.textHeader, store.textPages, store.fontPresets);
    try {
      await invoke("write_text_file", { filePath: path, content });
      store.setTextFilePath(path);
      store.setTextContent(content);
      store.setIsDirty(false);
    } catch { /* ignore */ }
  }, [store.textHeader, store.textPages, store.fontPresets]);

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

  // ═══ Zoom / Nav ═══
  const goPrev = useCallback(() => {
    if (idx > 0) store.setCurrentFileIndex(idx - 1);
  }, [idx]);
  const goNext = useCallback(() => {
    if (idx < files.length - 1) store.setCurrentFileIndex(idx + 1);
  }, [idx, files.length]);
  const zoomIn = useCallback(() => setZoom((z) => Math.min(z + 1, ZOOM_STEPS.length)), []);
  const zoomOut = useCallback(() => setZoom((z) => Math.max(z - 1, 0)), []);
  const zoomFit = useCallback(() => setZoom(0), []);
  const zoomLabel = zoom === 0 ? "Fit" : `${Math.round(ZOOM_STEPS[zoom - 1] * 100)}%`;

  const imgStyle: React.CSSProperties =
    zoom === 0
      ? { maxWidth: "100%", maxHeight: "100%", objectFit: "contain" as const }
      : {
          width: imgRef.current
            ? `${imgRef.current.naturalWidth * ZOOM_STEPS[zoom - 1]}px`
            : "auto",
        };

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
      if (resizingSide === "left") setLeftWidth(Math.max(180, Math.min(500, e.clientX)));
      else {
        const r = window.innerWidth - e.clientX;
        setRightWidth(Math.max(280, Math.min(700, r)));
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

  // Text diff: PSD text vs loaded COMIC-POT text
  useEffect(() => {
    if (textLayers.length === 0 || store.textContent.length === 0) {
      setTextDiffResults(null);
      return;
    }
    // Extract PSD text (from current file's text layers)
    const psdText = textLayers
      .filter((tl) => tl.textInfo?.text)
      .map((tl) => tl.textInfo!.text.trim())
      .filter(Boolean)
      .join("\n\n");
    // Extract current page text from COMIC-POT
    const pageNum = idx + 1;
    const page = store.textPages.find((p) => p.pageNumber === pageNum);
    const loadedText = page
      ? page.blocks.map((b) => b.lines.join("\n")).join("\n\n")
      : "";
    if (!psdText || !loadedText) { setTextDiffResults(null); return; }
    // 比較は正規化テキストで行うが、表示は元テキストを使う（文字化け防止）
    const normPsd = normalizeTextForComparison(psdText);
    const normLoaded = normalizeTextForComparison(loadedText);
    setTextDiffResults({
      psdText: psdText.trim(),
      loadedText: loadedText.trim(),
      hasDiff: normPsd !== normLoaded,
    });
  }, [textLayers, store.textContent, store.textPages, idx]);
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
  // RENDER
  // ═══════════════════════════════════════════════════════
  return (
    <div
      ref={containerRef}
      className="flex flex-col h-full w-full bg-bg-primary"
      style={{ userSelect: resizingSide ? "none" : undefined }}
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

      {/* ─── Main 3-column area ─── */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* ═══ LEFT SIDEBAR ═══ */}
        <div className="flex flex-col overflow-hidden bg-bg-secondary border-r border-border" style={{ width: leftWidth }}>
          {/* Left tabs */}
          <div className="flex-shrink-0 h-7 bg-bg-tertiary/50 border-b border-border/50 flex items-center px-1 gap-0.5 text-[11px]">
            <PanelTabBtn active={store.leftTab === "files"} onClick={() => store.setLeftTab("files")}>
              ファイル
            </PanelTabBtn>
            <PanelTabBtn active={store.leftTab === "layers"} onClick={() => store.setLeftTab("layers")}>
              レイヤー
            </PanelTabBtn>
            <PanelTabBtn active={store.leftTab === "spec"} onClick={() => store.setLeftTab("spec")}>
              写植仕様
            </PanelTabBtn>
          </div>

          {/* Left content */}
          <div className="flex-1 overflow-auto">
            {store.leftTab === "files" ? (
              /* File list */
              <div className="select-none">
                {files.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 text-text-muted p-6 text-center">
                    <svg className="w-10 h-10 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <p className="text-[11px]">D&D or フォルダを開く</p>
                    <button onClick={openFolder} className="px-3 py-1.5 text-[11px] font-medium text-white bg-gradient-to-r from-accent to-accent-secondary rounded-lg">
                      フォルダを開く
                    </button>
                  </div>
                ) : (
                  files.map((f, i) => (
                    <div
                      key={`${f.path}-${i}`}
                      className={`px-2 py-1 text-[11px] cursor-pointer truncate transition-colors ${
                        i === idx ? "bg-accent/15 text-accent font-medium" : "text-text-secondary hover:bg-bg-tertiary"
                      }`}
                      onClick={() => store.setCurrentFileIndex(i)}
                      title={f.name}
                    >
                      <span className="mr-1 opacity-40">{i + 1}.</span>
                      {f.isPdf && <span className="text-error/60 mr-0.5">PDF</span>}
                      {f.sourceType === "psd" && <span className="text-accent-secondary/60 mr-0.5">PSD</span>}
                      {f.name}
                    </div>
                  ))
                )}
              </div>
            ) : store.leftTab === "layers" ? (
              /* Layer tree */
              <div className="p-2">
                {layerTree.length === 0 ? (
                  <p className="text-[11px] text-text-muted text-center py-4">
                    {cur ? (isPsdFile(cur.name) ? "レイヤー読み込み中..." : "PSDファイルではありません") : "ファイルを選択してください"}
                  </p>
                ) : (
                  <LayerTreeView nodes={layerTree} />
                )}
              </div>
            ) : (
              /* Spec info (写植仕様) — DTPビューアー風 */
              <div className="select-none">
                {/* Font summary */}
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
                {/* Text layers list */}
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
                {/* Font presets */}
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
                {/* Text diff indicator */}
                {textDiffResults && (
                  <div className={`px-2 py-1.5 border-t border-border/30 ${textDiffResults.hasDiff ? "bg-warning/10" : "bg-success/10"}`}>
                    <div className={`text-[10px] font-medium ${textDiffResults.hasDiff ? "text-warning" : "text-success"}`}>
                      テキスト照合: {textDiffResults.hasDiff ? "差異あり" : "一致"}
                    </div>
                  </div>
                )}
              </div>
            )}
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
                <img ref={imgRef} src={imgUrl} alt={cur?.name || ""} style={imgStyle} draggable={false} className="block" />
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
          {/* Right tabs */}
          <div className="flex-shrink-0 h-7 bg-bg-tertiary/50 border-b border-border/50 flex items-center px-1 gap-1 text-[11px]">
            <PanelTabBtn active={store.rightTab === "text"} onClick={() => store.setRightTab("text")}>
              テキスト
            </PanelTabBtn>
            <PanelTabBtn
              active={store.rightTab === "proofread"}
              onClick={() => store.setRightTab("proofread")}
              badge={checkData?.allItems.length || undefined}
            >
              校正JSON
            </PanelTabBtn>
            <PanelTabBtn
              active={store.rightTab === "diff"}
              onClick={() => store.setRightTab("diff")}
              badge={textDiffResults?.hasDiff ? 1 : undefined}
            >
              テキスト照合
            </PanelTabBtn>
            <div className="flex-1" />
            {store.rightTab === "text" && (
              <div className="flex bg-bg-tertiary rounded overflow-hidden">
                <button
                  onClick={() => store.setEditMode("select")}
                  className={`px-2 py-0.5 transition-colors ${
                    store.editMode === "select" ? "bg-accent text-white" : "text-text-secondary hover:text-text-primary"
                  }`}
                >
                  選択
                </button>
                <button
                  onClick={() => store.setEditMode("edit")}
                  className={`px-2 py-0.5 transition-colors ${
                    store.editMode === "edit" ? "bg-accent text-white" : "text-text-secondary hover:text-text-primary"
                  }`}
                >
                  編集
                </button>
              </div>
            )}
            {store.rightTab === "proofread" && (
              <div className="flex gap-0.5">
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
            )}
            {store.isDirty && <span className="text-warning text-[10px]">未保存</span>}
          </div>

          {/* Font preset pills (写植確認風) */}
          {store.rightTab === "text" && store.fontPresets.length > 0 && store.editMode === "select" && (
            <div className="flex-shrink-0 px-2 py-1 border-b border-border/30 flex flex-wrap gap-1 bg-bg-tertiary/30">
              {store.fontPresets.map((fp, i) => (
                <button
                  key={i}
                  className="text-[10px] px-1.5 py-0.5 rounded-full text-white transition-opacity hover:opacity-80"
                  style={{ backgroundColor: getFontColor(fp.font) }}
                  onClick={() => {
                    const sel = store.selectedBlockIds;
                    if (sel.size > 0) {
                      store.assignFontToBlocks([...sel], fp.font);
                      store.setSelectedBlockIds(new Set());
                    }
                  }}
                  title={`${getFontLabel(fp.font)}${fp.subName ? ` (${fp.subName})` : ""}\nクリック: 選択中ブロックに割当`}
                >
                  {fp.name || getFontLabel(fp.font)}{fp.subName ? <span className="opacity-70 ml-0.5">({fp.subName})</span> : null}
                </button>
              ))}
              {store.selectedBlockIds.size > 0 && (
                <button
                  className="text-[10px] px-1.5 py-0.5 rounded-full bg-bg-tertiary text-text-muted hover:text-error"
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
                  ✕ 解除
                </button>
              )}
            </div>
          )}

          {/* Right content */}
          <div className="flex-1 overflow-auto">
            {store.rightTab === "diff" ? (
              /* テキスト照合パネル */
              <div className="p-3 space-y-3">
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
                    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${
                      textDiffResults.hasDiff ? "bg-warning/10 ring-1 ring-warning/30" : "bg-success/10 ring-1 ring-success/30"
                    }`}>
                      <span className={`text-sm font-medium ${textDiffResults.hasDiff ? "text-warning" : "text-success"}`}>
                        {textDiffResults.hasDiff ? "差異あり" : "一致"}
                      </span>
                      <span className="text-[10px] text-text-muted">
                        p.{idx + 1} — PSD: {textLayers.length}テキストレイヤー
                      </span>
                    </div>
                    <div>
                      <div className="text-[10px] font-medium text-text-muted mb-1">PSDテキスト</div>
                      <div className="text-xs font-mono bg-bg-tertiary rounded p-2 whitespace-pre-wrap text-text-primary max-h-[200px] overflow-auto">
                        {textDiffResults.psdText || <span className="text-text-muted/40">(テキストなし)</span>}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-medium text-text-muted mb-1">読み込みテキスト</div>
                      <div className="text-xs font-mono bg-bg-tertiary rounded p-2 whitespace-pre-wrap text-text-primary max-h-[200px] overflow-auto">
                        {textDiffResults.loadedText || <span className="text-text-muted/40">(テキストなし)</span>}
                      </div>
                    </div>
                    {textDiffResults.hasDiff && (
                      <div>
                        <div className="text-[10px] font-medium text-warning mb-1">差異箇所</div>
                        <TextDiffView psdText={textDiffResults.psdText} loadedText={textDiffResults.loadedText} />
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : store.rightTab === "text" ? (
              /* Text editor — 写植確認風 */
              store.textContent.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-text-muted p-4 text-center">
                  <p className="text-xs">テキストファイルを開く or .txt をD&amp;D</p>
                  <button onClick={openTextFile} className="px-3 py-1.5 text-[11px] font-medium text-white bg-gradient-to-r from-accent to-accent-secondary rounded-lg">
                    テキストを開く
                  </button>
                </div>
              ) : store.editMode === "edit" ? (
                <textarea
                  ref={textareaRef}
                  className="w-full h-full p-3 text-sm font-mono bg-white text-black resize-none outline-none border-none"
                  value={store.textContent}
                  onChange={(e) => {
                    store.setTextContent(e.target.value);
                    parseChunks(e.target.value);
                    store.setIsDirty(true);
                  }}
                  spellCheck={false}
                />
              ) : (
                /* 選択モード: ページ区切り + ブロック選択 + フォント指定バッジ */
                <div className="p-2">
                  {store.textPages.length > 0 ? (
                    store.textPages.map((page) => {
                      const isActivePage = page.pageNumber === idx + 1;
                      const hasReorder = page.blocks.some((b, i) => b.originalIndex !== i);
                      return (
                        <div key={page.pageNumber} className="mb-2">
                          {/* Page header */}
                          <div
                            className={`flex items-center gap-2 text-[10px] font-mono border-t border-border/40 pt-1 mt-1 mb-1 cursor-pointer ${
                              isActivePage ? "text-accent font-medium" : "text-text-muted/60"
                            }`}
                            onClick={() => {
                              if (pageSync) store.setCurrentFileIndex(Math.min(page.pageNumber - 1, files.length - 1));
                            }}
                          >
                            <span>&lt;&lt;{page.pageNumber}Page&gt;&gt;</span>
                            {isActivePage && <span className="text-accent text-[9px]">●</span>}
                            {hasReorder && <span className="text-warning text-[9px]">順序変更</span>}
                          </div>
                          {/* Blocks with D&D reorder */}
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
                                        for (let i = from; i <= to; i++) sel.add(ids[i]);
                                      } else {
                                        sel.add(block.id);
                                      }
                                    } else {
                                      sel.clear();
                                      sel.add(block.id);
                                    }
                                    store.setSelectedBlockIds(sel);
                                    if (pageSync) store.setCurrentFileIndex(Math.min(page.pageNumber - 1, files.length - 1));
                                  }}
                                />
                              ))}
                            </SortableContext>
                          </DndContext>
                        </div>
                      );
                    })
                  ) : (
                    /* Fallback: chunks mode (when no COMIC-POT pages parsed) */
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
                            if (pageSync && c.page > 0) store.setCurrentFileIndex(Math.min(c.page - 1, files.length - 1));
                          }}
                        >
                          {c.text.trim() || <span className="text-text-muted/40 italic">（空）</span>}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )
            ) : (
              /* Proofreading panel */
              filteredCheckItems.length === 0 ? (
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
                            if (!isNaN(pn) && pn > 0) store.setCurrentFileIndex(Math.min(pn - 1, files.length - 1));
                          }
                        }}
                      >
                        <div className="flex items-center gap-2 mb-0.5">
                          <span
                            className="px-1.5 py-0.5 rounded text-[10px] font-medium text-white"
                            style={{ backgroundColor: color }}
                          >
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
              )
            )}
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
    </div>
  );
}

// ═══ Sub-components ════════════════════════════════════

/**
 * 校正JSON専用ブラウザ
 * basePath → レーベル一覧 → タイトル一覧 → 「校正チェックデータ」自動選択 → JSONファイル一覧
 */
export function CheckJsonBrowser({ onSelect, onCancel }: { onSelect: (path: string) => void; onCancel: () => void }) {
  const [step, setStep] = useState<"label" | "title" | "files">("label");
  const [labels, setLabels] = useState<string[]>([]);
  const [titles, setTitles] = useState<string[]>([]);
  const [jsonFiles, setJsonFiles] = useState<string[]>([]);
  const [selectedLabel, setSelectedLabel] = useState("");
  const [selectedTitle, setSelectedTitle] = useState("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [, setCurrentPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1: Load labels
  useEffect(() => {
    setLoading(true);
    invoke<{ folders: string[]; json_files: string[] }>("list_folder_contents", { folderPath: CHECK_JSON_BASE_PATH })
      .then((r) => { setLabels(r.folders.sort()); setLoading(false); })
      .catch(() => { setError(`パスにアクセスできません: ${CHECK_JSON_BASE_PATH}`); setLoading(false); });
  }, []);

  // Step 2: Load titles when label selected
  const selectLabel = useCallback(async (label: string) => {
    setSelectedLabel(label);
    setLoading(true);
    try {
      const path = `${CHECK_JSON_BASE_PATH}/${label}`;
      const r = await invoke<{ folders: string[]; json_files: string[] }>("list_folder_contents", { folderPath: path });
      setTitles(r.folders.sort());
      setStep("title");
    } catch { setError("フォルダ読み込みエラー"); }
    setLoading(false);
  }, []);

  // Step 3: Select title → auto-navigate to 校正チェックデータ → load JSON files
  const selectTitle = useCallback(async (title: string) => {
    setSelectedTitle(title);
    setLoading(true);
    const basePath = `${CHECK_JSON_BASE_PATH}/${selectedLabel}/${title}`;
    try {
      // 「校正チェックデータ」フォルダを自動選択
      const checkPath = `${basePath}/${CHECK_DATA_SUBFOLDER}`;
      let targetPath = basePath;
      try {
        const checkContents = await invoke<{ folders: string[]; json_files: string[] }>("list_folder_contents", { folderPath: checkPath });
        if (checkContents.json_files.length > 0 || checkContents.folders.length > 0) {
          targetPath = checkPath;
        }
      } catch {
        // 「校正チェックデータ」がなければ直下を表示
      }
      const r = await invoke<{ folders: string[]; json_files: string[] }>("list_folder_contents", { folderPath: targetPath });
      // サブフォルダも含めてJSONファイルを収集
      let allJsons = r.json_files.map((f) => `${targetPath}/${f}`);
      for (const sub of r.folders) {
        try {
          const subR = await invoke<{ folders: string[]; json_files: string[] }>("list_folder_contents", { folderPath: `${targetPath}/${sub}` });
          allJsons.push(...subR.json_files.map((f) => `${targetPath}/${sub}/${f}`));
        } catch { /* skip */ }
      }
      setJsonFiles(allJsons);
      setCurrentPath(targetPath);
      setStep("files");
    } catch { setError("フォルダ読み込みエラー"); }
    setLoading(false);
  }, [selectedLabel]);

  const goBack = () => {
    if (step === "files") { setStep("title"); setJsonFiles([]); setSelectedFile(null); }
    else if (step === "title") { setStep("label"); setTitles([]); }
  };

  if (error) return (
    <div className="p-4 text-center">
      <p className="text-xs text-error mb-2">{error}</p>
      <button onClick={onCancel} className="text-xs text-text-muted hover:text-text-primary">閉じる</button>
    </div>
  );

  if (loading) return (
    <div className="p-4 flex items-center justify-center gap-2 text-text-muted text-xs">
      <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
      読み込み中...
    </div>
  );

  return (
    <div className="flex flex-col">
      {/* Breadcrumb */}
      <div className="px-3 py-1.5 bg-bg-tertiary/30 border-b border-border/30 flex items-center gap-1 text-[11px] text-text-muted">
        {step !== "label" && (
          <button onClick={goBack} className="hover:text-text-primary mr-1">◀</button>
        )}
        <span className="opacity-60">校正テキストログ</span>
        {selectedLabel && <><span className="opacity-40">/</span><span>{selectedLabel}</span></>}
        {selectedTitle && <><span className="opacity-40">/</span><span>{selectedTitle}</span></>}
      </div>

      {/* Content */}
      <div className="max-h-[50vh] overflow-auto">
        {step === "label" && (
          labels.length === 0 ? (
            <p className="p-4 text-xs text-text-muted text-center">レーベルフォルダがありません</p>
          ) : (
            labels.map((label) => (
              <div
                key={label}
                className="px-3 py-2 text-xs cursor-pointer hover:bg-bg-tertiary transition-colors flex items-center gap-2"
                onClick={() => selectLabel(label)}
              >
                <span className="text-accent-secondary">📁</span>
                <span className="text-text-primary">{label}</span>
              </div>
            ))
          )
        )}

        {step === "title" && (
          titles.length === 0 ? (
            <p className="p-4 text-xs text-text-muted text-center">タイトルフォルダがありません</p>
          ) : (
            titles.map((title) => (
              <div
                key={title}
                className="px-3 py-2 text-xs cursor-pointer hover:bg-bg-tertiary transition-colors flex items-center gap-2"
                onClick={() => selectTitle(title)}
              >
                <span className="text-accent-secondary">📁</span>
                <span className="text-text-primary">{title}</span>
              </div>
            ))
          )
        )}

        {step === "files" && (
          jsonFiles.length === 0 ? (
            <p className="p-4 text-xs text-text-muted text-center">JSONファイルがありません</p>
          ) : (
            jsonFiles.map((fp) => {
              const name = fp.substring(fp.lastIndexOf("/") + 1);
              const isSelected = selectedFile === fp;
              return (
                <div
                  key={fp}
                  className={`px-3 py-2 text-xs cursor-pointer transition-colors flex items-center gap-2 ${
                    isSelected ? "bg-accent/10 text-accent" : "hover:bg-bg-tertiary text-text-secondary"
                  }`}
                  onClick={() => setSelectedFile(fp)}
                  onDoubleClick={() => onSelect(fp)}
                >
                  <span className="opacity-60">📄</span>
                  <span>{name}</span>
                </div>
              );
            })
          )
        )}
      </div>

      {/* Actions */}
      {step === "files" && (
        <div className="px-3 py-2 border-t border-border/30 flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1 text-xs text-text-muted hover:text-text-primary">キャンセル</button>
          <button
            onClick={() => selectedFile && onSelect(selectedFile)}
            disabled={!selectedFile}
            className="px-3 py-1 text-xs font-medium text-white bg-gradient-to-r from-accent to-accent-secondary rounded disabled:opacity-30"
          >
            選択
          </button>
        </div>
      )}
    </div>
  );
}

function ToolBtn({ children, onClick, disabled, title }: {
  children: React.ReactNode; onClick: () => void; disabled?: boolean; title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="px-2 py-1 text-text-secondary hover:text-text-primary hover:bg-bg-tertiary rounded transition-colors disabled:opacity-30 disabled:pointer-events-none"
    >
      {children}
    </button>
  );
}

function PanelTabBtn({ children, active, onClick, badge }: {
  children: React.ReactNode; active: boolean; onClick: () => void; badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 rounded transition-colors ${
        active ? "bg-accent/15 text-accent font-medium" : "text-text-muted hover:text-text-secondary hover:bg-bg-tertiary/60"
      }`}
    >
      {children}
      {badge !== undefined && badge > 0 && (
        <span className="ml-1 px-1 py-px rounded-full bg-accent/20 text-accent text-[9px] tabular-nums">{badge}</span>
      )}
    </button>
  );
}

// Simple layer tree display
function LayerTreeView({ nodes, depth = 0 }: { nodes: LayerNode[]; depth?: number }) {
  return (
    <>
      {nodes.map((node) => (
        <div key={node.id}>
          <div
            className={`flex items-center gap-1 py-0.5 text-[11px] ${
              !node.visible ? "opacity-40" : ""
            }`}
            style={{ paddingLeft: depth * 12 + 4 }}
          >
            <span className={`w-3 text-center text-[9px] ${
              node.type === "group" ? "text-accent-secondary" :
              node.type === "text" ? "text-accent" :
              "text-text-muted"
            }`}>
              {node.type === "group" ? "G" : node.type === "text" ? "T" : node.type === "adjustment" ? "A" : "L"}
            </span>
            <span className="truncate text-text-secondary">{node.name}</span>
          </div>
          {node.children && <LayerTreeView nodes={node.children} depth={depth + 1} />}
        </div>
      ))}
    </>
  );
}

/** D&D対応のテキストブロック */
function SortableBlockItem({
  block,
  blockIdx,
  isSelected,
  fontColor,
  fontLabel,
  onClick,
}: {
  block: TextBlock;
  blockIdx: number;
  isSelected: boolean;
  fontColor?: string;
  fontLabel?: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    borderLeft: fontColor ? `3px solid ${fontColor}` : undefined,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-start gap-1 px-1 py-1.5 rounded text-sm font-mono whitespace-pre-wrap cursor-pointer transition-colors mb-0.5 ${
        isSelected ? "bg-accent/8 ring-1 ring-accent/30" : "hover:bg-bg-tertiary/60"
      }`}
      onClick={onClick}
    >
      {/* Drag handle */}
      <div
        className="flex-shrink-0 mt-0.5 cursor-grab active:cursor-grabbing text-text-muted/30 hover:text-text-muted/60"
        {...attributes}
        {...listeners}
      >
        <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
          <circle cx="3" cy="2" r="1.2" /><circle cx="7" cy="2" r="1.2" />
          <circle cx="3" cy="7" r="1.2" /><circle cx="7" cy="7" r="1.2" />
          <circle cx="3" cy="12" r="1.2" /><circle cx="7" cy="12" r="1.2" />
        </svg>
      </div>
      {/* Content */}
      <div className="flex-1 min-w-0">
        {block.assignedFont && fontLabel && (
          <div className="text-[9px] mb-0.5 flex items-center gap-1">
            <span className="px-1 py-px rounded text-white" style={{ backgroundColor: fontColor }}>
              {fontLabel}
            </span>
          </div>
        )}
        <div className="text-black">
          {block.lines.join("\n") || <span className="text-text-muted/40 italic">（空）</span>}
        </div>
        {block.originalIndex !== blockIdx && (
          <div className="text-[9px] text-warning mt-0.5">
            {block.originalIndex + 1}→{blockIdx + 1}
          </div>
        )}
      </div>
    </div>
  );
}

/** テキスト差分表示 — 行ごとに比較してハイライト */
function TextDiffView({ psdText, loadedText }: { psdText: string; loadedText: string }) {
  const psdLines = psdText.split("\n");
  const loadedLines = loadedText.split("\n");
  const maxLen = Math.max(psdLines.length, loadedLines.length);
  const rows: { psd: string; loaded: string; match: boolean }[] = [];
  for (let i = 0; i < maxLen; i++) {
    const p = (psdLines[i] || "").trim();
    const l = (loadedLines[i] || "").trim();
    rows.push({ psd: p, loaded: l, match: p === l });
  }
  return (
    <div className="text-[11px] font-mono border border-border/30 rounded overflow-hidden">
      <div className="grid grid-cols-2 gap-0 bg-bg-tertiary/50 text-[9px] text-text-muted border-b border-border/30">
        <div className="px-2 py-0.5">PSD</div>
        <div className="px-2 py-0.5 border-l border-border/30">テキスト</div>
      </div>
      {rows.map((r, i) => (
        <div
          key={i}
          className={`grid grid-cols-2 gap-0 ${
            r.match ? "" : "bg-warning/5"
          }`}
        >
          <div className={`px-2 py-0.5 whitespace-pre-wrap break-all ${
            !r.match && r.psd ? "text-error bg-error/5" : "text-text-secondary"
          }`}>
            {r.psd || <span className="opacity-30">—</span>}
          </div>
          <div className={`px-2 py-0.5 whitespace-pre-wrap break-all border-l border-border/30 ${
            !r.match && r.loaded ? "text-success bg-success/5" : "text-text-secondary"
          }`}>
            {r.loaded || <span className="opacity-30">—</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
