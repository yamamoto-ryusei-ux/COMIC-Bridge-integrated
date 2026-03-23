import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
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
import html2canvas from "html2canvas";
import { writeFile } from "@tauri-apps/plugin-fs";
import { usePsdStore } from "../../store/psdStore";
import { useScanPsdStore } from "../../store/scanPsdStore";
import {
  useHighResPreview,
  prefetchPreview,
  invalidateUrlCache,
} from "../../hooks/useHighResPreview";
import { useOpenFolder } from "../../hooks/useOpenFolder";
import { useOpenInPhotoshop } from "../../hooks/useOpenInPhotoshop";

// ─── Types ───────────────────────────────────────────────

interface TextBlock {
  id: string;
  originalIndex: number;
  lines: string[];
  assignedFont?: string;
  isAdded?: boolean;
}

interface TextPage {
  pageNumber: number;
  blocks: TextBlock[];
}

interface FontPresetEntry {
  name: string;
  subName: string;
  font: string;
}

// ─── PDF Split Mode ──────────────────────────────────────

type PdfSplitMode = "none" | "coverSpread" | "skipCover" | "allSpread";

interface ViewerPage {
  fileIndex: number;
  cropSide: "left" | "right" | null;
  displayLabel: string;
  textPageNumber: number | null;
}

function computeViewerPages(
  files: { fileName: string; sourceType?: string }[],
  splitMode: PdfSplitMode,
): ViewerPage[] {
  if (splitMode === "none" || files.length === 0) {
    return files.map((f, i) => ({
      fileIndex: i,
      cropSide: null,
      displayLabel: f.fileName,
      textPageNumber: extractPageNumber(f.fileName),
    }));
  }
  const pages: ViewerPage[] = [];
  let textPageNum = 1;
  for (let i = 0; i < files.length; i++) {
    if (splitMode === "coverSpread" && i === 0) {
      pages.push({
        fileIndex: i,
        cropSide: null,
        displayLabel: `表紙`,
        textPageNumber: textPageNum,
      });
      textPageNum++;
    } else if (splitMode === "skipCover" && i === 0) {
      continue;
    } else {
      // 右→左 (manga reading order: right half is earlier page)
      pages.push({
        fileIndex: i,
        cropSide: "right",
        displayLabel: `${textPageNum}P`,
        textPageNumber: textPageNum,
      });
      textPageNum++;
      pages.push({
        fileIndex: i,
        cropSide: "left",
        displayLabel: `${textPageNum}P`,
        textPageNumber: textPageNum,
      });
      textPageNum++;
    }
  }
  return pages;
}

// ─── Parsing ─────────────────────────────────────────────

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
      if (line.trim() === "") {
        flushBlock();
      } else {
        blockLines.push(line);
      }
    } else {
      header.push(line);
    }
  }
  flushBlock();

  return { header, pages };
}

/** フォント指定文字列の括弧バランスを検証し、不正なら補正 */
function validateFontTag(tag: string): string {
  let depth = 0;
  for (const ch of tag) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (depth < 0) break;
  }
  if (depth === 0) return tag;
  // 不正な場合: nameInfo部分を除去してPostScript名のみにする
  const match = tag.match(/^\[font:([^\](]+)/);
  return match ? `[font:${match[1]}]` : tag;
}

/** テキストデータを保存用文字列に変換 */
function serializeText(
  header: string[],
  pages: TextPage[],
  fontPresets: FontPresetEntry[],
): string {
  const lines: string[] = [];
  for (const h of header) lines.push(h);
  for (const page of pages) {
    lines.push(`<<${page.pageNumber}Page>>`);
    for (let i = 0; i < page.blocks.length; i++) {
      const block = page.blocks[i];
      if (block.assignedFont) {
        const fp = fontPresets.find((fp) => fp.font === block.assignedFont);
        const sanitize = (s: string) => s.replace(/[()（）[\]]/g, "");
        const nameInfo = fp
          ? `(${sanitize(fp.name)}${fp.subName ? `(${sanitize(fp.subName)})` : ""})`
          : "";
        const fontTag = `[font:${block.assignedFont}${nameInfo}]`;
        lines.push(validateFontTag(fontTag));
      }
      if (block.isAdded) {
        lines.push(`[added]`);
      }
      if (block.originalIndex >= 0 && block.originalIndex !== i) {
        lines.push(`[moved:${block.originalIndex + 1}→${i + 1}]`);
      }
      for (const line of block.lines) lines.push(line);
      lines.push("");
    }
  }
  return lines.join("\r\n");
}

function extractPageNumber(fileName: string): number | null {
  const nameWithoutExt = fileName.replace(/\.[^.]+$/, "");
  const match = nameWithoutExt.match(/(\d+)[^\d]*$/);
  return match ? parseInt(match[1], 10) : null;
}

// ─── Font colors ─────────────────────────────────────────

const FONT_COLORS = [
  "#3498db",
  "#27ae60",
  "#e67e22",
  "#9b59b6",
  "#1abc9c",
  "#e91e63",
  "#3f51b5",
  "#e74c3c",
  "#f1c40f",
  "#00bcd4",
];

function getFontColor(index: number): string {
  return FONT_COLORS[index % FONT_COLORS.length];
}

// ─── Main Component ──────────────────────────────────────

export function TypesettingConfirmPanel() {
  const files = usePsdStore((s) => s.files);
  const selectedFileIds = usePsdStore((s) => s.selectedFileIds);
  const { openFolderForFile } = useOpenFolder();
  const { openFileInPhotoshop } = useOpenInPhotoshop();
  const viewerRef = useRef<HTMLDivElement>(null);
  const textContainerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const lastSelectedBlockIdRef = useRef<string | null>(null);

  const [viewerPageIndex, setViewerPageIndex] = useState(0);
  const [pdfSplitMode, setPdfSplitMode] = useState<PdfSplitMode>("none");
  const [textFilePath, setTextFilePath] = useState<string | null>(null);
  const [textFileName, setTextFileName] = useState<string | null>(null);
  const [textHeader, setTextHeader] = useState<string[]>([]);
  const [textPages, setTextPages] = useState<TextPage[]>([]);
  const [activePageNumber, setActivePageNumber] = useState<number | null>(null);

  // Font presets
  const [fontPresets, setFontPresets] = useState<FontPresetEntry[]>([]);
  const [selectedBlockIds, setSelectedBlockIds] = useState<Set<string>>(new Set());
  const [activeFontFilter, setActiveFontFilter] = useState<string | null>(null);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);

  // Font JSON browser
  const [showFontBrowser, setShowFontBrowser] = useState(false);
  const [fontBrowserPath, setFontBrowserPath] = useState("");
  const [fontBrowserFolders, setFontBrowserFolders] = useState<string[]>([]);
  const [fontBrowserFiles, setFontBrowserFiles] = useState<string[]>([]);

  // PDF split: compute virtual viewer pages
  const hasPdf = files.some((f) => f.sourceType === "pdf");
  const viewerPages = computeViewerPages(files, hasPdf ? pdfSplitMode : "none");
  const currentPage = viewerPages[viewerPageIndex] ?? viewerPages[0] ?? null;
  const viewerFile = currentPage ? (files[currentPage.fileIndex] ?? null) : null;

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

  useEffect(() => {
    if (!viewerFile?.fileChanged || !viewerFile.filePath) return;
    invalidateUrlCache(viewerFile.filePath);
    invoke("invalidate_file_cache", { filePath: viewerFile.filePath }).catch(() => {});
    viewerReload();
  }, [viewerFile?.fileChanged, viewerFile?.filePath]);

  useEffect(() => {
    setViewerPageIndex(0);
  }, [files.length, pdfSplitMode]);

  useEffect(() => {
    if (selectedFileIds.length === 0) return;
    const targetFileIdx = files.findIndex((f) => f.id === selectedFileIds[0]);
    if (targetFileIdx >= 0) {
      const pageIdx = viewerPages.findIndex((p) => p.fileIndex === targetFileIdx);
      if (pageIdx >= 0) setViewerPageIndex(pageIdx);
    }
  }, [selectedFileIds, files, viewerPages]);

  useEffect(() => {
    if (viewerPages.length <= 1) return;
    for (let offset = 1; offset <= 3; offset++) {
      for (const idx of [viewerPageIndex - offset, viewerPageIndex + offset]) {
        if (idx < 0 || idx >= viewerPages.length) continue;
        const p = viewerPages[idx];
        const f = files[p.fileIndex];
        if (!f?.filePath) continue;
        prefetchPreview(f.filePath, 2000, f.pdfPageIndex, f.pdfSourcePath);
      }
    }
  }, [viewerPageIndex, viewerPages, files]);

  useEffect(() => {
    if (!currentPage || textPages.length === 0) return;
    const pageNum =
      pdfSplitMode !== "none"
        ? currentPage.textPageNumber
        : viewerFile
          ? extractPageNumber(viewerFile.fileName)
          : null;
    if (pageNum !== null) {
      setActivePageNumber(pageNum);
      const el = pageRefs.current.get(pageNum);
      if (el && textContainerRef.current) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  }, [viewerPageIndex, currentPage, viewerFile?.fileName, textPages.length, pdfSplitMode]);

  // 選択ブロックを削除（先頭行に//を付与）
  const handleDeleteBlocks = useCallback(() => {
    if (selectedBlockIds.size === 0) return;
    setTextPages((prev) =>
      prev.map((page) => ({
        ...page,
        blocks: page.blocks.map((b) => {
          if (!selectedBlockIds.has(b.id)) return b;
          // 既に//付きなら//を外す（トグル）
          const isDeleted = b.lines[0]?.startsWith("//");
          if (isDeleted) {
            return { ...b, lines: [b.lines[0].replace(/^\/\//, ""), ...b.lines.slice(1)] };
          }
          return { ...b, lines: ["//" + b.lines[0], ...b.lines.slice(1)] };
        }),
      })),
    );
    setSelectedBlockIds(new Set());
    setEditingBlockId(null);
  }, [selectedBlockIds]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedBlockIds.size > 0) {
        e.preventDefault();
        handleDeleteBlocks();
        return;
      }
      if (viewerPages.length <= 1) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        setViewerPageIndex(Math.max(0, viewerPageIndex - 1));
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        setViewerPageIndex(Math.min(viewerPages.length - 1, viewerPageIndex + 1));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [viewerPages.length, viewerPageIndex, selectedBlockIds, handleDeleteBlocks]);

  useEffect(() => {
    const el = viewerRef.current;
    if (!el || viewerPages.length <= 1) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const totalPages = viewerPages.length;
      if (e.deltaY > 0) setViewerPageIndex((p) => Math.min(totalPages - 1, p + 1));
      else if (e.deltaY < 0) setViewerPageIndex((p) => Math.max(0, p - 1));
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [viewerPages.length]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!viewerFile) return;
      if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        e.stopImmediatePropagation();
        openFileInPhotoshop(viewerFile.filePath);
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        e.stopImmediatePropagation();
        openFolderForFile(viewerFile.filePath);
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [viewerFile, openFileInPhotoshop, openFolderForFile]);

  // テキストファイル読み込み
  const loadTextFile = useCallback(async (filePath: string) => {
    try {
      const content = await invoke<string>("read_text_file", { filePath });
      const { header, pages } = parseComicPotText(content);
      setTextFilePath(filePath);
      const parts = filePath.replace(/\//g, "\\").split("\\");
      setTextFileName(parts[parts.length - 1]);
      setTextHeader(header);
      setTextPages(pages);
      setSelectedBlockIds(new Set());
    } catch (err) {
      console.error("Failed to load text file:", err);
    }
  }, []);

  const handleSelectTextFile = useCallback(async () => {
    const selected = await open({
      filters: [{ name: "テキストファイル", extensions: ["txt"] }],
      multiple: false,
    });
    if (selected && typeof selected === "string") loadTextFile(selected);
  }, [loadTextFile]);

  // 別名保存
  const handleSaveAs = useCallback(async () => {
    const defaultName = textFileName
      ? textFileName.replace(/\.txt$/i, "_edited.txt")
      : "edited.txt";
    const selected = await save({
      defaultPath: textFilePath ? textFilePath.replace(/[^/\\]+$/, defaultName) : defaultName,
      filters: [{ name: "テキストファイル", extensions: ["txt"] }],
    });
    if (!selected) return;
    try {
      const content = serializeText(textHeader, textPages, fontPresets);
      await invoke("write_text_file", { filePath: selected, content });
      setTextFilePath(selected);
      const parts = selected.replace(/\//g, "\\").split("\\");
      setTextFileName(parts[parts.length - 1]);
    } catch (err) {
      console.error("Failed to save text file:", err);
    }
  }, [textHeader, textPages, textFilePath, textFileName]);

  // 画像として保存（フォントフィルタ時）
  const handleSaveAsImage = useCallback(async () => {
    if (!textContainerRef.current) return;
    const filterFontName = activeFontFilter
      ? (fontPresets.find((fp) => fp.font === activeFontFilter)?.name ?? activeFontFilter)
      : "";
    const defaultName = textFileName
      ? textFileName.replace(/\.txt$/i, `_${filterFontName}.png`)
      : `font_filter_${filterFontName}.png`;
    const selected = await save({
      defaultPath: defaultName,
      filters: [{ name: "PNG画像", extensions: ["png"] }],
    });
    if (!selected) return;
    try {
      const canvas = await html2canvas(textContainerRef.current, {
        backgroundColor: "#ffffff",
        scale: 2,
        scrollY: -textContainerRef.current.scrollTop,
        height: textContainerRef.current.scrollHeight,
        windowHeight: textContainerRef.current.scrollHeight,
      });
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
      });
      const arrayBuffer = await blob.arrayBuffer();
      await writeFile(selected, new Uint8Array(arrayBuffer));
    } catch (err) {
      console.error("Failed to save image:", err);
    }
  }, [activeFontFilter, fontPresets, textFileName]);

  // フォントJSONブラウザ
  const loadFontBrowserFolder = useCallback(async (folderPath: string) => {
    try {
      const result = await invoke<{ folders: string[]; json_files: string[] }>(
        "list_folder_contents",
        { folderPath },
      );
      setFontBrowserPath(folderPath);
      setFontBrowserFolders(result.folders);
      setFontBrowserFiles(result.json_files);
    } catch (err) {
      console.error("Failed to list folder:", err);
      setFontBrowserFolders([]);
      setFontBrowserFiles([]);
    }
  }, []);

  const handleOpenFontBrowser = useCallback(() => {
    const basePath = useScanPsdStore.getState().jsonFolderPath;
    if (!basePath) {
      alert("スキャナーのJSON編集でJSONフォルダパスを設定してください。");
      return;
    }
    setShowFontBrowser(true);
    loadFontBrowserFolder(basePath);
  }, [loadFontBrowserFolder]);

  const handleSelectFontJson = useCallback(async (filePath: string) => {
    try {
      const content = await invoke<string>("read_text_file", { filePath });
      const data = JSON.parse(content);
      const presets: FontPresetEntry[] = [];
      const presetsObj = data?.presetData?.presets ?? data?.presets ?? data;
      if (typeof presetsObj === "object" && presetsObj !== null) {
        for (const [, arr] of Object.entries(presetsObj)) {
          if (Array.isArray(arr)) {
            for (const p of arr) {
              if (p && typeof p === "object" && typeof p.font === "string") {
                presets.push({
                  name: p.name ?? p.font,
                  subName: p.subName ?? "",
                  font: p.font,
                });
              }
            }
          }
        }
      }
      setFontPresets(presets);
      setShowFontBrowser(false);
    } catch (err) {
      console.error("Failed to load font JSON:", err);
    }
  }, []);

  // ブロック選択（複数対応: Ctrl=個別, Shift=範囲）
  const handleSelectBlock = useCallback(
    (blockId: string, ctrlKey: boolean, shiftKey: boolean) => {
      const allBlocks = textPages.flatMap((p) => p.blocks);

      if (shiftKey && lastSelectedBlockIdRef.current) {
        // Shift+click: 範囲選択
        const lastIdx = allBlocks.findIndex((b) => b.id === lastSelectedBlockIdRef.current);
        const curIdx = allBlocks.findIndex((b) => b.id === blockId);
        if (lastIdx >= 0 && curIdx >= 0) {
          const start = Math.min(lastIdx, curIdx);
          const end = Math.max(lastIdx, curIdx);
          setSelectedBlockIds((prev) => {
            const next = new Set(prev);
            for (let i = start; i <= end; i++) {
              next.add(allBlocks[i].id);
            }
            return next;
          });
          return;
        }
      }

      setSelectedBlockIds((prev) => {
        const next = new Set(prev);
        if (ctrlKey) {
          if (next.has(blockId)) next.delete(blockId);
          else next.add(blockId);
        } else {
          if (next.size === 1 && next.has(blockId)) {
            next.clear();
          } else {
            next.clear();
            next.add(blockId);
          }
        }
        return next;
      });
      lastSelectedBlockIdRef.current = blockId;
    },
    [textPages],
  );

  // ブロックにフォント指定（複数対応）
  const handleAssignFont = useCallback(
    (font: string) => {
      if (selectedBlockIds.size === 0) return;
      setTextPages((prev) =>
        prev.map((page) => ({
          ...page,
          blocks: page.blocks.map((block) =>
            selectedBlockIds.has(block.id) ? { ...block, assignedFont: font } : block,
          ),
        })),
      );
      // 最後の選択ブロックの次を自動選択
      const allBlocks = textPages.flatMap((p) => p.blocks);
      const lastSelectedIdx = Math.max(
        ...Array.from(selectedBlockIds).map((id) => allBlocks.findIndex((b) => b.id === id)),
      );
      setSelectedBlockIds(new Set());
      if (lastSelectedIdx >= 0 && lastSelectedIdx < allBlocks.length - 1) {
        setSelectedBlockIds(new Set([allBlocks[lastSelectedIdx + 1].id]));
      }
    },
    [selectedBlockIds, textPages],
  );

  // フォント指定解除（複数対応）
  const handleClearFont = useCallback(() => {
    if (selectedBlockIds.size === 0) return;
    setTextPages((prev) =>
      prev.map((page) => ({
        ...page,
        blocks: page.blocks.map((block) =>
          selectedBlockIds.has(block.id) ? { ...block, assignedFont: undefined } : block,
        ),
      })),
    );
  }, [selectedBlockIds]);

  // ページ内ブロック並べ替え
  const handleBlockReorder = useCallback((pageNumber: number, activeId: string, overId: string) => {
    setTextPages((prev) =>
      prev.map((page) => {
        if (page.pageNumber !== pageNumber) return page;
        const oldIdx = page.blocks.findIndex((b) => b.id === activeId);
        const newIdx = page.blocks.findIndex((b) => b.id === overId);
        if (oldIdx < 0 || newIdx < 0) return page;
        return { ...page, blocks: arrayMove(page.blocks, oldIdx, newIdx) };
      }),
    );
  }, []);

  // ブロック内容を編集
  const handleEditBlock = useCallback((blockId: string, newLines: string[]) => {
    setTextPages((prev) =>
      prev.map((page) => ({
        ...page,
        blocks: page.blocks.map((block) =>
          block.id === blockId ? { ...block, lines: newLines } : block,
        ),
      })),
    );
    setEditingBlockId(null);
  }, []);

  // ブロック追加（指定ページの末尾、またはafterIndex位置の後に挿入）
  const handleAddBlock = useCallback((pageNumber: number, afterIndex?: number) => {
    const newId = `p${pageNumber}-b${Date.now()}`;
    setTextPages((prev) =>
      prev.map((page) => {
        if (page.pageNumber !== pageNumber) return page;
        const newBlock: TextBlock = {
          id: newId,
          originalIndex: -1,
          lines: [""],
          isAdded: true,
        };
        const blocks = [...page.blocks];
        const insertAt = afterIndex !== undefined ? afterIndex + 1 : blocks.length;
        blocks.splice(insertAt, 0, newBlock);
        return { ...page, blocks };
      }),
    );
    setEditingBlockId(newId);
  }, []);

  const handlePageClick = useCallback(
    (pageNumber: number) => {
      setActivePageNumber(pageNumber);
      // Find matching viewer page
      const pageIdx = viewerPages.findIndex((p) => p.textPageNumber === pageNumber);
      if (pageIdx >= 0) {
        setViewerPageIndex(pageIdx);
      } else {
        // Fallback: search by file name
        const fileIdx = files.findIndex((f) => extractPageNumber(f.fileName) === pageNumber);
        const vpIdx = viewerPages.findIndex((p) => p.fileIndex === fileIdx);
        if (vpIdx >= 0) setViewerPageIndex(vpIdx);
      }
    },
    [files, viewerPages],
  );

  const fontColorMap = new Map<string, string>();
  fontPresets.forEach((fp, i) => {
    fontColorMap.set(fp.font, getFontColor(i));
  });

  if (files.length === 0) {
    return (
      <div className="flex h-full overflow-hidden">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-2">
            <svg
              className="w-12 h-12 mx-auto text-text-muted/30"
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
            <p className="text-xs text-text-muted">画像/PDFファイルをドロップしてください</p>
          </div>
        </div>
        <TextPanel
          textFileName={textFileName}
          textFilePath={textFilePath}
          textHeader={textHeader}
          textPages={textPages}
          activePageNumber={activePageNumber}
          textContainerRef={textContainerRef}
          pageRefs={pageRefs}
          onSelectTextFile={handleSelectTextFile}
          onPageClick={handlePageClick}
          onSaveAs={handleSaveAs}
          onSaveAsImage={handleSaveAsImage}
          fontPresets={fontPresets}
          fontColorMap={fontColorMap}
          selectedBlockIds={selectedBlockIds}
          onSelectBlock={handleSelectBlock}
          onAssignFont={handleAssignFont}
          onClearFont={handleClearFont}
          onOpenFontBrowser={handleOpenFontBrowser}
          onBlockReorder={handleBlockReorder}
          onEditBlock={handleEditBlock}
          onAddBlock={handleAddBlock}
          onDeleteBlocks={handleDeleteBlocks}
          editingBlockId={editingBlockId}
          onSetEditingBlockId={setEditingBlockId}
          activeFontFilter={activeFontFilter}
          onSetFontFilter={setActiveFontFilter}
          showFontBrowser={showFontBrowser}
          fontBrowserPath={fontBrowserPath}
          fontBrowserFolders={fontBrowserFolders}
          fontBrowserFiles={fontBrowserFiles}
          onCloseFontBrowser={() => setShowFontBrowser(false)}
          onNavigateFontBrowser={loadFontBrowserFolder}
          onSelectFontJson={handleSelectFontJson}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: Image Viewer */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-3 py-2 border-b border-border flex-shrink-0 bg-bg-secondary">
          <div className="flex items-center gap-2">
            <span className="text-xs font-display font-medium text-text-primary truncate flex-1">
              {currentPage?.cropSide ? currentPage.displayLabel : viewerFile?.fileName}
            </span>
            {viewerPages.length > 1 && (
              <span className="text-[10px] text-text-muted flex-shrink-0">
                {viewerPageIndex + 1} / {viewerPages.length}
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
            {viewerFile && (
              <button
                className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded transition-all text-[#31A8FF] hover:bg-[#31A8FF]/15 active:scale-95"
                onClick={() => openFileInPhotoshop(viewerFile.filePath)}
                title="Photoshopで開く (P)"
              >
                <span className="text-sm font-bold leading-none">Ps</span>
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {viewerFile?.metadata && (
              <>
                <span className="text-[10px] text-text-muted">
                  {viewerFile.metadata.width} x {viewerFile.metadata.height}
                </span>
                <span className="text-[10px] text-text-muted">{viewerFile.metadata.dpi} dpi</span>
                <span className="text-[10px] text-text-muted">{viewerFile.metadata.colorMode}</span>
              </>
            )}
            {hasPdf && (
              <select
                value={pdfSplitMode}
                onChange={(e) => setPdfSplitMode(e.target.value as PdfSplitMode)}
                className="ml-auto text-[9px] bg-bg-tertiary border border-border rounded px-1 py-0.5 text-text-secondary cursor-pointer"
              >
                <option value="none">そのまま</option>
                <option value="coverSpread">表紙+見開き</option>
                <option value="skipCover">表紙なし</option>
                <option value="allSpread">全見開き</option>
              </select>
            )}
          </div>
        </div>
        <div
          ref={viewerRef}
          className="flex-1 overflow-hidden relative flex items-center justify-center bg-[#1a1a1e]"
        >
          {imageUrl ? (
            currentPage?.cropSide ? (
              <div
                className="overflow-hidden flex items-center justify-center max-w-full max-h-full"
                style={{ width: "50%", height: "100%" }}
              >
                <img
                  key={`${imageUrl}-${currentPage.cropSide}`}
                  src={imageUrl}
                  alt={currentPage.displayLabel}
                  className={`h-full select-none transition-opacity duration-150 ${isLoading ? "opacity-40" : "opacity-100"}`}
                  style={{
                    objectFit: "cover",
                    objectPosition:
                      currentPage.cropSide === "right" ? "right center" : "left center",
                    width: "100%",
                  }}
                  draggable={false}
                />
              </div>
            ) : (
              <img
                key={imageUrl}
                src={imageUrl}
                alt={viewerFile?.fileName}
                className={`max-w-full max-h-full object-contain select-none transition-opacity duration-150 ${isLoading ? "opacity-40" : "opacity-100"}`}
                draggable={false}
              />
            )
          ) : viewerFile?.thumbnailUrl ? (
            <img
              src={viewerFile.thumbnailUrl}
              alt={viewerFile.fileName}
              className="max-w-full max-h-full object-contain select-none opacity-60"
              draggable={false}
            />
          ) : !isLoading && !viewerError ? (
            <div className="flex flex-col items-center gap-2">
              <div className="w-6 h-6 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
              <p className="text-[10px] text-text-muted">読み込み中...</p>
            </div>
          ) : null}
          {isLoading && (
            <div className="absolute top-3 right-3 z-10">
              <div className="w-5 h-5 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
            </div>
          )}
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
          {viewerPages.length > 1 && (
            <>
              {viewerPageIndex > 0 && (
                <button
                  onClick={() => setViewerPageIndex(viewerPageIndex - 1)}
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
              {viewerPageIndex < viewerPages.length - 1 && (
                <button
                  onClick={() => setViewerPageIndex(viewerPageIndex + 1)}
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
      </div>

      {/* Right: Text Panel */}
      <TextPanel
        textFileName={textFileName}
        textFilePath={textFilePath}
        textHeader={textHeader}
        textPages={textPages}
        activePageNumber={activePageNumber}
        textContainerRef={textContainerRef}
        pageRefs={pageRefs}
        onSelectTextFile={handleSelectTextFile}
        onPageClick={handlePageClick}
        onSaveAs={handleSaveAs}
        onSaveAsImage={handleSaveAsImage}
        fontPresets={fontPresets}
        fontColorMap={fontColorMap}
        selectedBlockIds={selectedBlockIds}
        onSelectBlock={handleSelectBlock}
        onAssignFont={handleAssignFont}
        onClearFont={handleClearFont}
        onOpenFontBrowser={handleOpenFontBrowser}
        onBlockReorder={handleBlockReorder}
        onEditBlock={handleEditBlock}
        onAddBlock={handleAddBlock}
        onDeleteBlocks={handleDeleteBlocks}
        editingBlockId={editingBlockId}
        onSetEditingBlockId={setEditingBlockId}
        activeFontFilter={activeFontFilter}
        onSetFontFilter={setActiveFontFilter}
        showFontBrowser={showFontBrowser}
        fontBrowserPath={fontBrowserPath}
        fontBrowserFolders={fontBrowserFolders}
        fontBrowserFiles={fontBrowserFiles}
        onCloseFontBrowser={() => setShowFontBrowser(false)}
        onNavigateFontBrowser={loadFontBrowserFolder}
        onSelectFontJson={handleSelectFontJson}
      />
    </div>
  );
}

// ─── Text Panel ──────────────────────────────────────────

interface TextPanelProps {
  textFileName: string | null;
  textFilePath: string | null;
  textHeader: string[];
  textPages: TextPage[];
  activePageNumber: number | null;
  textContainerRef: React.RefObject<HTMLDivElement>;
  pageRefs: React.MutableRefObject<Map<number, HTMLDivElement>>;
  onSelectTextFile: () => void;
  onPageClick: (pageNumber: number) => void;
  onSaveAs: () => void;
  onSaveAsImage: () => void;
  fontPresets: FontPresetEntry[];
  fontColorMap: Map<string, string>;
  selectedBlockIds: Set<string>;
  onSelectBlock: (id: string, ctrlKey: boolean, shiftKey: boolean) => void;
  onAssignFont: (font: string) => void;
  onClearFont: () => void;
  onOpenFontBrowser: () => void;
  onBlockReorder: (pageNumber: number, activeId: string, overId: string) => void;
  onEditBlock: (blockId: string, newLines: string[]) => void;
  onAddBlock: (pageNumber: number, afterIndex?: number) => void;
  onDeleteBlocks: () => void;
  editingBlockId: string | null;
  onSetEditingBlockId: (id: string | null) => void;
  activeFontFilter: string | null;
  onSetFontFilter: (font: string | null) => void;
  showFontBrowser: boolean;
  fontBrowserPath: string;
  fontBrowserFolders: string[];
  fontBrowserFiles: string[];
  onCloseFontBrowser: () => void;
  onNavigateFontBrowser: (path: string) => void;
  onSelectFontJson: (path: string) => void;
}

function TextPanel(props: TextPanelProps) {
  const {
    textFileName,
    textFilePath,
    textHeader,
    textPages,
    activePageNumber,
    textContainerRef,
    pageRefs,
    onSelectTextFile,
    onPageClick,
    onSaveAs,
    onSaveAsImage,
    fontPresets,
    fontColorMap,
    selectedBlockIds,
    onSelectBlock,
    onAssignFont,
    onClearFont,
    onOpenFontBrowser,
    onBlockReorder,
    onEditBlock,
    onAddBlock,
    onDeleteBlocks,
    editingBlockId,
    onSetEditingBlockId,
    activeFontFilter,
    onSetFontFilter,
    showFontBrowser,
    fontBrowserPath,
    fontBrowserFolders,
    fontBrowserFiles,
    onCloseFontBrowser,
    onNavigateFontBrowser,
    onSelectFontJson,
  } = props;

  const storeJsonPath = useScanPsdStore((s) => s.jsonFolderPath);
  const basePath = (storeJsonPath ?? "").replace(/\\/g, "/").replace(/\/$/, "");
  const normalizedCurrent = fontBrowserPath.replace(/\\/g, "/").replace(/\/$/, "");
  const isAtRoot = normalizedCurrent === basePath || !normalizedCurrent;
  const relativePath = normalizedCurrent.startsWith(basePath)
    ? normalizedCurrent.slice(basePath.length).replace(/^\//, "")
    : "";

  const hasSelection = selectedBlockIds.size > 0;

  return (
    <div className="w-[400px] flex-shrink-0 border-l border-border flex flex-col bg-bg-secondary overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border flex items-center gap-1.5 flex-shrink-0">
        <svg
          className="w-3.5 h-3.5 text-text-muted flex-shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
          />
        </svg>
        <span className="text-[10px] font-display font-medium text-text-primary truncate flex-1">
          {textFileName ?? "テキストメモ"}
        </span>
        {textPages.length > 0 && (
          <button
            onClick={onSaveAs}
            className="flex-shrink-0 px-1.5 py-0.5 text-[9px] rounded bg-accent/10 text-accent hover:bg-accent/20 transition-all font-medium border border-accent/30"
            title="別名で保存"
          >
            保存
          </button>
        )}
        <button
          onClick={onSelectTextFile}
          className="flex-shrink-0 px-1.5 py-0.5 text-[9px] rounded bg-bg-tertiary hover:bg-bg-elevated text-text-secondary hover:text-text-primary transition-all border border-border"
        >
          {textFilePath ? "変更" : "テキスト"}
        </button>
        <button
          onClick={onOpenFontBrowser}
          className="flex-shrink-0 px-1.5 py-0.5 text-[9px] rounded bg-bg-tertiary hover:bg-bg-elevated text-text-secondary hover:text-text-primary transition-all border border-border"
        >
          {fontPresets.length > 0 ? "フォント変更" : "フォント"}
        </button>
        {hasSelection && (
          <button
            onClick={onDeleteBlocks}
            className="flex-shrink-0 px-1.5 py-0.5 text-[9px] rounded bg-error/10 text-error hover:bg-error/20 transition-all border border-error/30"
            title="選択ブロックの削除/復元 (Delete)"
          >
            削除//
          </button>
        )}
      </div>

      {/* Font browser overlay */}
      {showFontBrowser && (
        <div className="border-b border-border bg-bg-primary flex flex-col max-h-[50%] overflow-hidden">
          <div className="px-3 py-1.5 flex items-center gap-2 border-b border-border bg-bg-tertiary/50 flex-shrink-0">
            <span className="text-[10px] font-medium text-text-primary flex-1 truncate">
              {relativePath || "JSONフォルダ"}
            </span>
            <button
              onClick={onCloseFontBrowser}
              className="text-[10px] text-text-muted hover:text-text-primary"
            >
              &times;
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {/* Up button */}
            {!isAtRoot && (
              <button
                onClick={() => {
                  const parts = normalizedCurrent.split("/");
                  parts.pop();
                  onNavigateFontBrowser(parts.join("/"));
                }}
                className="w-full px-3 py-1.5 text-left text-[10px] text-text-secondary hover:bg-bg-tertiary/50 flex items-center gap-1.5"
              >
                <svg
                  className="w-3 h-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
                ..
              </button>
            )}
            {/* Folders */}
            {fontBrowserFolders.map((folder) => (
              <button
                key={folder}
                onClick={() => onNavigateFontBrowser(`${normalizedCurrent}/${folder}`)}
                className="w-full px-3 py-1.5 text-left text-[10px] text-text-primary hover:bg-bg-tertiary/50 flex items-center gap-1.5"
              >
                <svg
                  className="w-3 h-3 text-accent-secondary flex-shrink-0"
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
                {folder}
              </button>
            ))}
            {/* JSON files */}
            {fontBrowserFiles.map((file) => (
              <button
                key={file}
                onClick={() => onSelectFontJson(`${normalizedCurrent}/${file}`)}
                className="w-full px-3 py-1.5 text-left text-[10px] text-text-primary hover:bg-accent/10 flex items-center gap-1.5"
              >
                <svg
                  className="w-3 h-3 text-accent flex-shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                  />
                </svg>
                {file.replace(/\.json$/i, "")}
              </button>
            ))}
            {fontBrowserFolders.length === 0 && fontBrowserFiles.length === 0 && (
              <p className="px-3 py-3 text-[10px] text-text-muted text-center">
                ファイルがありません
              </p>
            )}
          </div>
        </div>
      )}

      {/* Font preset bar */}
      {fontPresets.length > 0 && !showFontBrowser && (
        <div className="px-2 py-1.5 border-b border-border flex flex-wrap gap-1 flex-shrink-0 bg-bg-tertiary/30">
          {fontPresets.map((fp, i) => {
            const color = getFontColor(i);
            const isFilterActive = activeFontFilter === fp.font;
            return (
              <button
                key={`${fp.font}-${i}`}
                onClick={() => {
                  if (hasSelection) {
                    onAssignFont(fp.font);
                  } else {
                    onSetFontFilter(isFilterActive ? null : fp.font);
                  }
                }}
                className={`px-1.5 py-0.5 text-[9px] rounded transition-all border ${
                  isFilterActive
                    ? "outline outline-1 outline-offset-1"
                    : hasSelection
                      ? "hover:scale-105 cursor-pointer"
                      : "opacity-70 hover:opacity-100"
                }`}
                style={{
                  borderColor: color,
                  backgroundColor: isFilterActive ? color + "20" : "transparent",
                  color: color,
                  outlineColor: isFilterActive ? color : undefined,
                }}
                title={`${fp.name}${fp.subName ? ` (${fp.subName})` : ""}\n${fp.font}${hasSelection ? `\nクリックで${selectedBlockIds.size}件に指定` : "\nクリックでフィルタ"}`}
              >
                {fp.name}
              </button>
            );
          })}
          {hasSelection && (
            <>
              <button
                onClick={onClearFont}
                className="px-1.5 py-0.5 text-[9px] rounded border border-border text-text-muted hover:text-error hover:border-error transition-all"
                title="フォント指定を解除"
              >
                &times;
              </button>
              <span className="text-[8px] text-text-muted self-center ml-1">
                {selectedBlockIds.size}件選択中
              </span>
            </>
          )}
          {activeFontFilter && !hasSelection && (
            <button
              onClick={onSaveAsImage}
              className="ml-auto px-1.5 py-0.5 text-[9px] rounded border border-accent-secondary/40 text-accent-secondary hover:bg-accent-secondary/10 transition-all flex items-center gap-1"
              title="フィルタ結果を画像として保存"
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
                  d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
              画像保存
            </button>
          )}
        </div>
      )}

      {/* Content */}
      {textPages.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3 px-6">
            <svg
              className="w-10 h-10 mx-auto text-text-muted/20"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
              />
            </svg>
            <div className="space-y-1">
              <p className="text-xs text-text-muted">テキストファイルを読み込んでください</p>
              <p className="text-[10px] text-text-muted/60">COMIC-POT形式に対応</p>
            </div>
            <button
              onClick={onSelectTextFile}
              className="px-3 py-1.5 text-[11px] rounded-lg bg-accent/10 text-accent hover:bg-accent/20 transition-all font-medium"
            >
              テキストファイルを選択
            </button>
          </div>
        </div>
      ) : (
        <div ref={textContainerRef} className="flex-1 overflow-y-auto">
          {textHeader.filter((l) => l.trim()).length > 0 && (
            <div className="px-3 py-2 bg-bg-tertiary/50 border-b border-border">
              {textHeader
                .filter((l) => l.trim())
                .map((line, i) => (
                  <p key={i} className="text-[10px] text-text-muted">
                    {line}
                  </p>
                ))}
            </div>
          )}
          {textPages.map((page) => (
            <PageSection
              key={page.pageNumber}
              page={page}
              isActive={activePageNumber === page.pageNumber}
              pageRefs={pageRefs}
              onPageClick={onPageClick}
              fontColorMap={fontColorMap}
              fontPresets={fontPresets}
              selectedBlockIds={selectedBlockIds}
              onSelectBlock={onSelectBlock}
              onBlockReorder={onBlockReorder}
              onEditBlock={onEditBlock}
              onAddBlock={onAddBlock}
              editingBlockId={editingBlockId}
              onSetEditingBlockId={onSetEditingBlockId}
              activeFontFilter={activeFontFilter}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Page Section ────────────────────────────────────────

function PageSection({
  page,
  isActive,
  pageRefs,
  onPageClick,
  fontColorMap,
  fontPresets,
  selectedBlockIds,
  onSelectBlock,
  onBlockReorder,
  onEditBlock,
  onAddBlock,
  editingBlockId,
  onSetEditingBlockId,
  activeFontFilter,
}: {
  page: TextPage;
  isActive: boolean;
  pageRefs: React.MutableRefObject<Map<number, HTMLDivElement>>;
  onPageClick: (pageNumber: number) => void;
  fontColorMap: Map<string, string>;
  fontPresets: FontPresetEntry[];
  selectedBlockIds: Set<string>;
  onSelectBlock: (id: string, ctrlKey: boolean, shiftKey: boolean) => void;
  onBlockReorder: (pageNumber: number, activeId: string, overId: string) => void;
  onEditBlock: (blockId: string, newLines: string[]) => void;
  onAddBlock: (pageNumber: number, afterIndex?: number) => void;
  editingBlockId: string | null;
  onSetEditingBlockId: (id: string | null) => void;
  activeFontFilter: string | null;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      onBlockReorder(page.pageNumber, String(active.id), String(over.id));
    }
  };

  const hasBlocks = page.blocks.length > 0;
  const hasOrderChanges = page.blocks.some((b, i) => b.originalIndex !== i);

  return (
    <div
      ref={(el) => {
        if (el) pageRefs.current.set(page.pageNumber, el);
        else pageRefs.current.delete(page.pageNumber);
      }}
      className={`border-b border-border transition-colors ${isActive ? "bg-accent/5" : ""}`}
    >
      <div
        className={`w-full px-3 py-1.5 flex items-center gap-2 text-left transition-colors cursor-pointer ${
          isActive ? "bg-accent/10" : "hover:bg-bg-tertiary/50"
        }`}
        onClick={() => onPageClick(page.pageNumber)}
      >
        <span
          className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
            isActive ? "bg-accent text-white" : "bg-bg-elevated text-text-muted"
          }`}
        >
          {page.pageNumber}P
        </span>
        {hasOrderChanges && (
          <span className="text-[9px] px-1 py-0.5 rounded bg-warning/15 text-warning font-medium">
            順序変更
          </span>
        )}
        {!hasBlocks && (
          <span className="text-[10px] text-text-muted/40 italic">（テキストなし）</span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAddBlock(page.pageNumber);
          }}
          className="ml-auto flex-shrink-0 w-5 h-5 flex items-center justify-center rounded text-text-muted/50 hover:text-accent hover:bg-accent/10 transition-all"
          title="ブロック追加"
        >
          <svg
            className="w-3 h-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>
      {hasBlocks && (
        <div className="px-2 pb-2">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={page.blocks.map((b) => b.id)}
              strategy={verticalListSortingStrategy}
            >
              {page.blocks.map((block, currentIndex) => (
                <SortableBlock
                  key={block.id}
                  block={block}
                  currentIndex={currentIndex}
                  isSelected={selectedBlockIds.has(block.id)}
                  isEditing={editingBlockId === block.id}
                  onSelect={onSelectBlock}
                  onEditBlock={onEditBlock}
                  onSetEditingBlockId={onSetEditingBlockId}
                  fontColor={block.assignedFont ? fontColorMap.get(block.assignedFont) : undefined}
                  fontDisplayName={
                    block.assignedFont
                      ? fontPresets.find((fp) => fp.font === block.assignedFont)?.name
                      : undefined
                  }
                  isMoved={block.originalIndex !== currentIndex}
                  isFilteredOut={
                    activeFontFilter !== null && block.assignedFont !== activeFontFilter
                  }
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>
      )}
    </div>
  );
}

// ─── Sortable Block ──────────────────────────────────────

function SortableBlock({
  block,
  currentIndex,
  isSelected,
  isEditing,
  onSelect,
  onEditBlock,
  onSetEditingBlockId,
  fontColor,
  fontDisplayName,
  isMoved,
  isFilteredOut,
}: {
  block: TextBlock;
  currentIndex: number;
  isSelected: boolean;
  isEditing: boolean;
  onSelect: (id: string, ctrlKey: boolean, shiftKey: boolean) => void;
  onEditBlock: (blockId: string, newLines: string[]) => void;
  onSetEditingBlockId: (id: string | null) => void;
  fontColor?: string;
  fontDisplayName?: string;
  isMoved: boolean;
  isFilteredOut: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [editText, setEditText] = useState("");

  useEffect(() => {
    if (isEditing) {
      setEditText(block.lines.join("\n"));
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, [isEditing, block.lines]);

  const commitEdit = () => {
    const newLines = editText
      .split("\n")
      .filter((l) => l.trim() !== "" || editText.split("\n").length === 1);
    if (newLines.length === 0 || (newLines.length === 1 && newLines[0].trim() === "")) {
      onSetEditingBlockId(null);
      return;
    }
    onEditBlock(block.id, newLines);
  };

  const isDeleted = block.lines[0]?.startsWith("//") ?? false;
  const isAdded = !!block.isAdded;

  const borderClass = isSelected
    ? "border-accent bg-accent/8 shadow-sm"
    : isEditing
      ? "border-accent-secondary bg-accent-secondary/5 shadow-sm"
      : isDeleted
        ? "border-error/30 bg-error/5"
        : isAdded
          ? "border-success/30 bg-success/5"
          : "border-transparent hover:border-border";

  const textColorClass = isDeleted
    ? "text-error/60 line-through"
    : isAdded
      ? "text-success"
      : "text-text-primary";

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : isFilteredOut ? 0.3 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`mt-1 rounded border transition-all ${borderClass}`}
    >
      <div className="flex items-start gap-0">
        <div
          {...attributes}
          {...listeners}
          className="flex flex-col items-center pt-1 px-1 cursor-grab active:cursor-grabbing flex-shrink-0 select-none"
          title="ドラッグで並べ替え"
        >
          <svg className="w-3 h-3 text-text-muted/40" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="9" cy="5" r="1.5" />
            <circle cx="15" cy="5" r="1.5" />
            <circle cx="9" cy="12" r="1.5" />
            <circle cx="15" cy="12" r="1.5" />
            <circle cx="9" cy="19" r="1.5" />
            <circle cx="15" cy="19" r="1.5" />
          </svg>
          <span
            className={`text-[8px] mt-0.5 font-mono leading-none ${
              isMoved ? "text-warning font-bold" : "text-text-muted/50"
            }`}
          >
            {isMoved ? `${block.originalIndex + 1}→${currentIndex + 1}` : `${currentIndex + 1}`}
          </span>
        </div>
        {isEditing ? (
          <div className="flex-1 py-1 pr-2 min-w-0">
            {fontColor && (
              <span
                className="inline-block text-[8px] px-1 py-px rounded mb-0.5 font-medium"
                style={{ backgroundColor: fontColor + "20", color: fontColor }}
              >
                {fontDisplayName || block.assignedFont}
              </span>
            )}
            <textarea
              ref={textareaRef}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  onSetEditingBlockId(null);
                }
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  commitEdit();
                }
              }}
              className="w-full text-[11px] text-text-primary leading-relaxed font-ui bg-transparent border border-accent-secondary/30 rounded px-1 py-0.5 resize-y outline-none focus:border-accent-secondary"
              rows={Math.max(2, block.lines.length + 1)}
              style={
                fontColor ? { borderLeft: `2px solid ${fontColor}`, paddingLeft: "4px" } : undefined
              }
            />
            <div className="flex items-center gap-1 mt-0.5">
              <span className="text-[8px] text-text-muted">Ctrl+Enter: 確定 / Esc: キャンセル</span>
            </div>
          </div>
        ) : (
          <div
            className="flex-1 py-1 pr-2 cursor-pointer min-w-0"
            onClick={(e) => onSelect(block.id, e.ctrlKey || e.metaKey, e.shiftKey)}
            onDoubleClick={() => onSetEditingBlockId(block.id)}
          >
            {(fontColor || isAdded || isDeleted) && (
              <div className="flex items-center gap-1 mb-0.5">
                {fontColor && (
                  <span
                    className="inline-block text-[8px] px-1 py-px rounded font-medium"
                    style={{ backgroundColor: fontColor + "20", color: fontColor }}
                  >
                    {fontDisplayName || block.assignedFont}
                  </span>
                )}
                {isAdded && (
                  <span className="inline-block text-[8px] px-1 py-px rounded font-medium bg-success/15 text-success">
                    追加
                  </span>
                )}
                {isDeleted && (
                  <span className="inline-block text-[8px] px-1 py-px rounded font-medium bg-error/15 text-error">
                    削除
                  </span>
                )}
              </div>
            )}
            {block.lines.map((line, i) => (
              <p
                key={i}
                className={`text-[11px] leading-relaxed font-ui ${textColorClass}`}
                style={
                  fontColor
                    ? { borderLeft: `2px solid ${fontColor}`, paddingLeft: "4px" }
                    : undefined
                }
              >
                {line || "\u00A0"}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
