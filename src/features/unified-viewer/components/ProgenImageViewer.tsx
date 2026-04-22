/**
 * ProGen Image Viewer — COMIC-POT style full layout
 * Top: Toolbar (open, save, copy, JSON, 校正, check tabs)
 * Left: Image viewer / 校正結果パネル (tabs: ビューアー / 正誤 / 提案)
 * Right: Text editor (textarea + select mode, page sync)
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";

// ─── Types ───
interface ImageFile {
  name: string;
  path: string;
  size?: number;
  isPdf?: boolean;
  pdfPage?: number;
  pdfPath?: string;
}
interface CacheEntry {
  url: string;
  w: number;
  h: number;
}
interface CheckItem {
  category: string;
  page: string;
  excerpt: string;
  content: string;
  kind: "correctness" | "proposal";
}

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0];
const MAX_SIZE = 2000;

type LeftPanelTab = "viewer" | "simple" | "variation";

export function ProgenImageViewer() {
  // --- Viewer state ---
  const [files, setFiles] = useState<ImageFile[]>([]);
  const [idx, setIdx] = useState(-1);
  const [zoom, setZoom] = useState(0);
  const [loading, setLoading] = useState(false);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // --- Text editor state ---
  const [text, setText] = useState("");
  const [textFilePath, setTextFilePath] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<"edit" | "select">("select");
  const [pageSync, setPageSync] = useState(false);
  const [chunks, setChunks] = useState<{ text: string; page: number }[]>([]);
  const [selectedChunk, setSelectedChunk] = useState(-1);
  const [isDirty, setIsDirty] = useState(false);

  // --- Left panel state ---
  const [leftTab, setLeftTab] = useState<LeftPanelTab>("viewer");
  const [checkItems, setCheckItems] = useState<CheckItem[]>([]);
  const [checkFilterCategory, setCheckFilterCategory] = useState<string>("all");

  // --- Panel state ---
  const [panelWidth, setPanelWidth] = useState(50);
  const [isResizing, setIsResizing] = useState(false);

  // --- Refs ---
  const cache = useRef(new Map<string, CacheEntry>());
  const canvasRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragStart = useRef({ x: 0, y: 0, sx: 0, sy: 0 });
  const pdfjsRef = useRef<any>(null);
  const pdfDocCache = useRef(new Map<string, any>());
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ═══ PDF.js ═══
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
    async (raw: ImageFile[]): Promise<ImageFile[]> => {
      const out: ImageFile[] = [];
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
      setIdx(i);
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
          const r = await invoke<any>("progen_load_image_preview", {
            filePath: f.path,
            maxSize: MAX_SIZE,
          });
          if (r.success && r.filePath)
            e = {
              url: convertFileSrc(r.filePath),
              w: r.originalWidth || 0,
              h: r.originalHeight || 0,
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
      if (ni < 0 || ni >= files.length) continue;
      const f = files[ni];
      if (cache.current.has(f.path)) continue;
      if (f.isPdf && f.pdfPath && f.pdfPage)
        renderPdfPage(f.pdfPath, f.pdfPage).then((e) => e && cache.current.set(f.path, e));
      else
        invoke<any>("progen_load_image_preview", { filePath: f.path, maxSize: MAX_SIZE })
          .then((r: any) => {
            if (r.success && r.filePath)
              cache.current.set(f.path, {
                url: convertFileSrc(r.filePath),
                w: r.originalWidth || 0,
                h: r.originalHeight || 0,
              });
          })
          .catch(() => {});
    }
  }, [idx, files, renderPdfPage]);

  useEffect(() => {
    if (idx >= 0 && files.length > 0) loadImage(idx);
  }, [idx, loadImage, files.length]);

  // Page sync
  useEffect(() => {
    if (!pageSync || idx < 0) return;
    syncToPage(idx + 1);
  }, [idx, pageSync]);

  // ═══ File open / save ═══
  const openFolder = useCallback(async () => {
    try {
      const r = await invoke<any>("progen_show_open_image_folder_dialog");
      if (!r.success || !r.folderPath) return;
      const lr = await invoke<any>("progen_list_image_files", { dirPath: r.folderPath });
      if (!lr.success || !lr.files) return;
      const raw: ImageFile[] = lr.files.map((f: any) => ({
        name: f.name,
        path: f.path,
        size: f.size,
      }));
      const expanded = await expandPdf(raw);
      setFiles(expanded);
      setIdx(0);
      setZoom(0);
      cache.current.clear();
      setLeftTab("viewer");
    } catch {
      /* ignore */
    }
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
      setText(content);
      parseChunks(content);
      setTextFilePath(path as string);
      setIsDirty(false);
    } catch {
      /* ignore */
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (!textFilePath || !text) return;
    try {
      await invoke("progen_write_text_file", { filePath: textFilePath, content: text });
      setIsDirty(false);
    } catch {
      /* ignore */
    }
  }, [textFilePath, text]);

  const handleSaveAs = useCallback(async () => {
    try {
      const r = await invoke<any>("progen_show_save_text_dialog", { defaultName: null });
      if (!r) return;
      await invoke("progen_write_text_file", { filePath: r, content: text });
      setTextFilePath(r);
      setIsDirty(false);
    } catch {
      /* ignore */
    }
  }, [text]);

  const handleCopy = useCallback(() => {
    if (text) navigator.clipboard.writeText(text);
  }, [text]);

  // ═══ JSON (校正チェック) loading ═══
  const openCheckJson = useCallback(async () => {
    try {
      const r = await invoke<any>("progen_open_and_read_json_dialog");
      if (!r || !r.content) return;
      const data = JSON.parse(r.content);
      const items: CheckItem[] = [];
      const parseChecks = (arr: any[], kind: "correctness" | "proposal") => {
        if (!Array.isArray(arr)) return;
        for (const item of arr) {
          items.push({
            category: item.category || "",
            page: item.page || "",
            excerpt: item.excerpt || "",
            content: item.content || item.text || "",
            kind,
          });
        }
      };
      if (data.checks) {
        parseChecks(data.checks.simple, "correctness");
        parseChecks(data.checks.variation, "proposal");
      } else if (Array.isArray(data)) {
        parseChecks(data, "correctness");
      }
      setCheckItems(items);
      setLeftTab(items.some((i) => i.kind === "correctness") ? "simple" : "variation");
    } catch {
      /* ignore */
    }
  }, []);

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
          const txtPaths = paths.filter((pp) => pp.toLowerCase().endsWith(".txt"));
          if (txtPaths.length > 0) {
            try {
              const bytes = await readFile(txtPaths[0]);
              const content = new TextDecoder("utf-8").decode(bytes);
              setText(content);
              parseChunks(content);
              setTextFilePath(txtPaths[0]);
              setIsDirty(false);
            } catch {
              /* ignore */
            }
          }
          const jsonPaths = paths.filter((pp) => pp.toLowerCase().endsWith(".json"));
          if (jsonPaths.length > 0) {
            try {
              const bytes = await readFile(jsonPaths[0]);
              const content = new TextDecoder("utf-8").decode(bytes);
              const data = JSON.parse(content);
              const items: CheckItem[] = [];
              const parse = (arr: any[], kind: "correctness" | "proposal") => {
                if (!Array.isArray(arr)) return;
                for (const item of arr) {
                  items.push({
                    category: item.category || "",
                    page: item.page || "",
                    excerpt: item.excerpt || "",
                    content: item.content || item.text || "",
                    kind,
                  });
                }
              };
              if (data.checks) {
                parse(data.checks.simple, "correctness");
                parse(data.checks.variation, "proposal");
              }
              if (items.length > 0) {
                setCheckItems(items);
                setLeftTab("simple");
              }
            } catch {
              /* ignore */
            }
          }
          const imgPaths = paths.filter(
            (pp) => !pp.toLowerCase().endsWith(".txt") && !pp.toLowerCase().endsWith(".json"),
          );
          if (imgPaths.length > 0) {
            try {
              const r = await invoke<any>("progen_list_image_files_from_paths", {
                paths: imgPaths,
              });
              if (r.success && r.files) {
                const raw: ImageFile[] = r.files.map((f: any) => ({
                  name: f.name,
                  path: f.path,
                  size: f.size,
                }));
                const expanded = await expandPdf(raw);
                setFiles(expanded);
                setIdx(0);
                setZoom(0);
                cache.current.clear();
                setLeftTab("viewer");
              }
            } catch {
              /* ignore */
            }
          }
        }
      });
    };
    setup();
    return () => {
      unlisten?.();
    };
  }, [expandPdf]);

  // ═══ Text chunks ═══
  const parseChunks = useCallback((content: string) => {
    const lines = content.split("\n");
    const result: { text: string; page: number }[] = [];
    let page = 0;
    let buf: string[] = [];
    const pageRe = /<<(\d+)Page>>/;
    const sepRe = /^-{10,}$/;
    for (const line of lines) {
      const pm = line.match(pageRe);
      if (pm) {
        if (buf.length > 0) result.push({ text: buf.join("\n"), page });
        page = parseInt(pm[1], 10);
        buf = [];
        continue;
      }
      if (sepRe.test(line.trim())) {
        if (buf.length > 0) result.push({ text: buf.join("\n"), page });
        page++;
        buf = [];
        continue;
      }
      buf.push(line);
    }
    if (buf.length > 0) result.push({ text: buf.join("\n"), page });
    setChunks(result);
  }, []);

  const syncToPage = useCallback(
    (pageNum: number) => {
      if (editMode === "edit") {
        const ta = textareaRef.current;
        if (!ta) return;
        const lines = ta.value.split("\n");
        let pg = 0;
        let charPos = 0;
        const pageRe = /<<(\d+)Page>>/;
        for (let i = 0; i < lines.length; i++) {
          const m = lines[i].match(pageRe);
          if (m) pg = parseInt(m[1], 10);
          else if (/^-{10,}$/.test(lines[i].trim())) pg++;
          if (pg >= pageNum) {
            ta.focus();
            ta.setSelectionRange(charPos, charPos);
            ta.scrollTop = (charPos / ta.value.length) * ta.scrollHeight;
            return;
          }
          charPos += lines[i].length + 1;
        }
      } else {
        const ci = chunks.findIndex((c) => c.page >= pageNum);
        if (ci >= 0) setSelectedChunk(ci);
      }
    },
    [editMode, chunks],
  );

  // ═══ Zoom / nav ═══
  const goPrev = useCallback(() => idx > 0 && setIdx((i) => i - 1), [idx]);
  const goNext = useCallback(
    () => idx < files.length - 1 && setIdx((i) => i + 1),
    [idx, files.length],
  );
  const zoomIn = useCallback(() => setZoom((z) => Math.min(z + 1, ZOOM_STEPS.length)), []);
  const zoomOut = useCallback(() => setZoom((z) => Math.max(z - 1, 0)), []);
  const zoomFit = useCallback(() => setZoom(0), []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "=" || e.key === "+") {
          e.preventDefault();
          zoomIn();
        } else if (e.key === "-") {
          e.preventDefault();
          zoomOut();
        } else if (e.key === "0") {
          e.preventDefault();
          zoomFit();
        } else if (e.key === "s") {
          e.preventDefault();
          handleSave();
        }
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        goNext();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [goPrev, goNext, zoomIn, zoomOut, zoomFit, handleSave]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const h = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.deltaY < 0 ? zoomIn() : zoomOut();
      } else if (zoom === 0 && leftTab === "viewer") {
        e.preventDefault();
        e.deltaY > 0 ? goNext() : goPrev();
      }
    };
    el.addEventListener("wheel", h, { passive: false });
    return () => el.removeEventListener("wheel", h);
  }, [zoom, leftTab, goPrev, goNext, zoomIn, zoomOut]);

  // Drag-to-pan
  const onMouseDown = useCallback(
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
    return () => {
      window.removeEventListener("mousemove", mv);
      window.removeEventListener("mouseup", up);
    };
  }, [dragging]);

  // Resize handle
  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);
  useEffect(() => {
    if (!isResizing) return;
    const mv = (e: MouseEvent) => {
      const pct = (e.clientX / window.innerWidth) * 100;
      setPanelWidth(Math.max(20, Math.min(70, pct)));
    };
    const up = () => setIsResizing(false);
    window.addEventListener("mousemove", mv);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", mv);
      window.removeEventListener("mouseup", up);
    };
  }, [isResizing]);

  // ═══ Render helpers ═══
  const cur = files[idx] || null;
  const zoomLabel = zoom === 0 ? "Fit" : `${Math.round(ZOOM_STEPS[zoom - 1] * 100)}%`;
  const imgStyle: React.CSSProperties =
    zoom === 0
      ? { maxWidth: "100%", maxHeight: "100%", objectFit: "contain" as const }
      : {
          width: imgRef.current
            ? `${imgRef.current.naturalWidth * ZOOM_STEPS[zoom - 1]}px`
            : "auto",
        };

  const simpleItems = checkItems.filter((i) => i.kind === "correctness");
  const variationItems = checkItems.filter((i) => i.kind === "proposal");
  const activeCheckItems = leftTab === "simple" ? simpleItems : variationItems;
  const categories = [...new Set(activeCheckItems.map((i) => i.category))].sort();
  const filteredCheckItems =
    checkFilterCategory === "all"
      ? activeCheckItems
      : activeCheckItems.filter((i) => i.category === checkFilterCategory);

  // ═══ RENDER ═══
  return (
    <div
      className="flex flex-col h-full w-full bg-bg-primary"
      style={{ userSelect: isResizing ? "none" : undefined }}
    >
      {/* ─── Top toolbar ─── */}
      <div className="flex-shrink-0 h-9 bg-bg-secondary border-b border-border flex items-center px-2 gap-1 text-xs">
        {/* File ops */}
        <ToolBtn onClick={openFolder} title="画像フォルダを開く">
          フォルダ
        </ToolBtn>
        <ToolBtn onClick={openTextFile} title="テキストファイルを開く">
          開く
        </ToolBtn>
        <ToolBtn
          onClick={handleSave}
          disabled={!isDirty || !textFilePath}
          title="上書き保存 (Ctrl+S)"
        >
          保存
        </ToolBtn>
        <ToolBtn onClick={handleSaveAs} disabled={!text} title="名前を付けて保存">
          別名保存
        </ToolBtn>
        <ToolBtn onClick={handleCopy} disabled={!text} title="テキストをコピー">
          コピー
        </ToolBtn>

        <div className="w-px h-4 bg-border mx-0.5" />

        {/* JSON / check */}
        <ToolBtn onClick={openCheckJson} title="校正チェックJSONを読み込む">
          JSON読込
        </ToolBtn>

        <div className="w-px h-4 bg-border mx-0.5" />

        {/* Page sync */}
        <button
          onClick={() => setPageSync((v) => !v)}
          className={`px-2 py-1 rounded transition-colors ${
            pageSync
              ? "text-accent bg-accent/10 font-semibold"
              : "text-text-muted hover:text-text-primary hover:bg-bg-tertiary"
          }`}
          title={pageSync ? "ページ連動 ON" : "ページ連動 OFF"}
        >
          連動{pageSync ? " ON" : ""}
        </button>

        <div className="flex-1" />

        {/* File info */}
        {cur && (
          <span className="text-text-muted truncate max-w-[200px]" title={cur.name}>
            {cur.name}
          </span>
        )}
        {dims.w > 0 && (
          <span className="text-text-muted/50 ml-1">
            {dims.w}x{dims.h}
          </span>
        )}
      </div>

      {/* ─── Main area ─── */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* ── Left panel ── */}
        <div className="flex flex-col overflow-hidden" style={{ width: `${panelWidth}%` }}>
          {/* Left panel tabs: ビューアー / 正誤チェック / 提案チェック */}
          <div className="flex-shrink-0 h-7 bg-bg-tertiary/50 border-b border-border/50 flex items-center px-1 gap-0.5 text-[11px]">
            <PanelTabBtn active={leftTab === "viewer"} onClick={() => setLeftTab("viewer")}>
              ビューアー
            </PanelTabBtn>
            <PanelTabBtn
              active={leftTab === "simple"}
              onClick={() => setLeftTab("simple")}
              badge={simpleItems.length || undefined}
            >
              正誤チェック
            </PanelTabBtn>
            <PanelTabBtn
              active={leftTab === "variation"}
              onClick={() => setLeftTab("variation")}
              badge={variationItems.length || undefined}
            >
              提案チェック
            </PanelTabBtn>

            {/* Viewer nav controls (only when viewer tab) */}
            {leftTab === "viewer" && (
              <>
                <div className="w-px h-3 bg-border mx-1" />
                <button
                  onClick={goPrev}
                  disabled={idx <= 0}
                  className="px-0.5 text-text-secondary hover:text-text-primary disabled:opacity-30"
                >
                  ◀
                </button>
                <span className="text-text-muted tabular-nums min-w-[40px] text-center">
                  {files.length > 0 ? `${idx + 1}/${files.length}` : "—"}
                </span>
                <button
                  onClick={goNext}
                  disabled={idx >= files.length - 1}
                  className="px-0.5 text-text-secondary hover:text-text-primary disabled:opacity-30"
                >
                  ▶
                </button>
                <div className="w-px h-3 bg-border mx-0.5" />
                <button
                  onClick={zoomOut}
                  disabled={zoom <= 0}
                  className="px-0.5 text-text-secondary disabled:opacity-30"
                >
                  −
                </button>
                <button
                  onClick={zoomFit}
                  className="px-1 text-text-muted hover:text-text-primary hover:bg-bg-tertiary rounded tabular-nums"
                >
                  {zoomLabel}
                </button>
                <button
                  onClick={zoomIn}
                  disabled={zoom >= ZOOM_STEPS.length}
                  className="px-0.5 text-text-secondary disabled:opacity-30"
                >
                  +
                </button>
              </>
            )}

            {/* Category filter (check tabs) */}
            {(leftTab === "simple" || leftTab === "variation") && categories.length > 0 && (
              <>
                <div className="flex-1" />
                <select
                  className="text-[10px] bg-bg-tertiary border border-border/50 rounded px-1 py-0.5 text-text-secondary outline-none"
                  value={checkFilterCategory}
                  onChange={(e) => setCheckFilterCategory(e.target.value)}
                >
                  <option value="all">全カテゴリ</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>

          {/* Left panel content */}
          {leftTab === "viewer" ? (
            <div
              ref={canvasRef}
              className={`flex-1 overflow-auto flex items-center justify-center bg-neutral-100 ${
                zoom > 0 ? (dragging ? "cursor-grabbing" : "cursor-grab") : ""
              } ${dragOver ? "ring-2 ring-inset ring-accent/50 bg-accent/5" : ""}`}
              onMouseDown={onMouseDown}
              style={{ userSelect: "none" }}
            >
              {files.length === 0 ? (
                <div className="flex flex-col items-center gap-3 text-text-muted p-8 text-center">
                  <svg
                    className="w-12 h-12 opacity-20"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                  <p className="text-xs">画像フォルダを開く or D&amp;D</p>
                  <button
                    onClick={openFolder}
                    className="mt-1 px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-accent to-accent-secondary rounded-lg shadow-sm"
                  >
                    フォルダを開く
                  </button>
                </div>
              ) : loading && !imgUrl ? (
                <div className="flex flex-col items-center gap-2 text-text-muted">
                  <svg
                    className="w-5 h-5 animate-spin"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </div>
              ) : imgUrl ? (
                <img
                  ref={imgRef}
                  src={imgUrl}
                  alt={cur?.name || ""}
                  style={imgStyle}
                  draggable={false}
                />
              ) : null}
            </div>
          ) : (
            /* Check results panel */
            <div className="flex-1 overflow-auto bg-bg-primary">
              {filteredCheckItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-text-muted p-4 text-center">
                  <p className="text-xs">
                    {checkItems.length === 0
                      ? "校正チェックJSONを読み込んでください"
                      : "該当する項目がありません"}
                  </p>
                  {checkItems.length === 0 && (
                    <button
                      onClick={openCheckJson}
                      className="mt-1 px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-accent to-accent-secondary rounded-lg shadow-sm"
                    >
                      JSON読込
                    </button>
                  )}
                </div>
              ) : (
                <div className="divide-y divide-border/30">
                  {filteredCheckItems.map((item, i) => (
                    <div
                      key={i}
                      className="px-3 py-2 hover:bg-bg-tertiary/40 transition-colors text-xs"
                    >
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="px-1.5 py-0.5 rounded bg-accent/10 text-accent text-[10px] font-medium">
                          {item.category || "—"}
                        </span>
                        {item.page && (
                          <span className="text-text-muted/60 text-[10px]">p.{item.page}</span>
                        )}
                      </div>
                      {item.excerpt && (
                        <div className="text-text-secondary mt-0.5 font-mono">{item.excerpt}</div>
                      )}
                      {item.content && <div className="text-text-muted mt-0.5">{item.content}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Resize handle ── */}
        <div
          className={`w-1.5 flex-shrink-0 bg-border/30 hover:bg-accent/30 transition-colors cursor-col-resize active:bg-accent/50 ${
            isResizing ? "bg-accent/50" : ""
          }`}
          onMouseDown={onResizeStart}
        />

        {/* ── Right: Text panel ── */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <div className="flex-shrink-0 h-7 bg-bg-tertiary/50 border-b border-border/50 flex items-center px-2 gap-1 text-[11px]">
            <div className="flex bg-bg-tertiary rounded overflow-hidden">
              <button
                onClick={() => setEditMode("select")}
                className={`px-2 py-0.5 transition-colors ${
                  editMode === "select"
                    ? "bg-accent text-white"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                選択
              </button>
              <button
                onClick={() => setEditMode("edit")}
                className={`px-2 py-0.5 transition-colors ${
                  editMode === "edit"
                    ? "bg-accent text-white"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                編集
              </button>
            </div>
            <div className="flex-1" />
            {isDirty && <span className="text-warning text-[10px]">未保存</span>}
          </div>

          <div className="flex-1 overflow-auto">
            {text.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-text-muted p-4 text-center">
                <p className="text-xs">テキストファイルを開く or .txt をD&amp;D</p>
              </div>
            ) : editMode === "edit" ? (
              <textarea
                ref={textareaRef}
                className="w-full h-full p-3 text-sm font-mono bg-white text-black resize-none outline-none border-none"
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  parseChunks(e.target.value);
                  setIsDirty(true);
                }}
                spellCheck={false}
              />
            ) : (
              <div className="p-2 space-y-0.5">
                {chunks.map((c, ci) => (
                  <div key={ci}>
                    {(ci === 0 || chunks[ci - 1]?.page !== c.page) && c.page > 0 && (
                      <div className="text-[10px] text-text-muted/60 font-mono border-t border-border/40 pt-1 mt-1 mb-0.5">
                        &lt;&lt;{c.page}Page&gt;&gt;
                      </div>
                    )}
                    <div
                      className={`px-2 py-1.5 rounded text-sm font-mono whitespace-pre-wrap cursor-pointer transition-colors text-black ${
                        selectedChunk === ci
                          ? "bg-accent/10 ring-1 ring-accent/30"
                          : "hover:bg-bg-tertiary/60"
                      }`}
                      onClick={() => {
                        setSelectedChunk(ci);
                        if (pageSync && c.page > 0) {
                          setIdx(Math.min(c.page - 1, files.length - 1));
                        }
                      }}
                    >
                      {c.text.trim() || <span className="text-text-muted/40 italic">（空）</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── Status bar ─── */}
      <div className="flex-shrink-0 h-5 bg-bg-secondary border-t border-border flex items-center px-3 text-[10px] text-text-muted/60 gap-3">
        <span>{files.length} ファイル</span>
        {text.length > 0 && <span>{chunks.length} ブロック</span>}
        {checkItems.length > 0 && (
          <span>
            校正: {simpleItems.length}正誤 / {variationItems.length}提案
          </span>
        )}
        {pageSync && <span className="text-accent">ページ連動</span>}
      </div>
    </div>
  );
}

// ─── Sub-components ───
function ToolBtn({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
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

function PanelTabBtn({
  children,
  active,
  onClick,
  badge,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 rounded transition-colors relative ${
        active
          ? "bg-accent/15 text-accent font-medium"
          : "text-text-muted hover:text-text-secondary hover:bg-bg-tertiary/60"
      }`}
    >
      {children}
      {badge !== undefined && badge > 0 && (
        <span className="ml-1 px-1 py-px rounded-full bg-accent/20 text-accent text-[9px] tabular-nums">
          {badge}
        </span>
      )}
    </button>
  );
}
