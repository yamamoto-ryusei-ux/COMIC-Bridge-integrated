/**
 * 統合ビューアー ユーティリティ関数・定数
 */
import type { PanelTab } from "../unifiedViewerStore";
import type { TextPage, FontPresetEntry } from "../unifiedViewerStore";

// ─── Panel tab definitions (共通タブ) ───────────────────
export const ALL_PANEL_TABS: { id: PanelTab; label: string }[] = [
  { id: "files", label: "ファイル" },
  { id: "layers", label: "レイヤー" },
  { id: "spec", label: "写植仕様" },
  { id: "text", label: "テキスト" },
  { id: "proofread", label: "校正JSON" },
  { id: "diff", label: "テキスト照合" },
];

// ─── Constants ──────────────────────────────────────────
export const ZOOM_STEPS = [0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0];
export const MAX_SIZE = 2000;
export const CHECK_JSON_BASE_PATH = "G:/共有ドライブ/CLLENN/編集部フォルダ/編集企画部/写植・校正用テキストログ";
export const CHECK_DATA_SUBFOLDER = "校正チェックデータ";
export const IMAGE_EXTS = new Set([
  ".psd",".psb",".jpg",".jpeg",".png",".tif",".tiff",".bmp",".gif",".pdf",".eps",
]);

export type SplitMode = "none" | "spread" | "spread-skip1" | "single1";
export type FirstPageMode = "single" | "spread" | "skip";
export type SplitReadOrder = "right-first" | "left-first";

export interface CacheEntry { url: string; w: number; h: number }

// ─── COMIC-POT Parser ───────────────────────────────────
export function parseComicPotText(content: string): { header: string[]; pages: TextPage[] } {
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

export function serializeText(
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

// ─── File Helpers ────────────────────────────────────────
export function isImageFile(name: string): boolean {
  const ext = name.substring(name.lastIndexOf(".")).toLowerCase();
  return IMAGE_EXTS.has(ext);
}

export function isPsdFile(name: string): boolean {
  const ext = name.substring(name.lastIndexOf(".")).toLowerCase();
  return ext === ".psd" || ext === ".psb";
}

// ─── Page Number Helpers ─────────────────────────────────
/**
 * ファイルインデックス → 対応するCOMIC-POTテキストページ番号を返す
 */
export function getTextPageNumbers(fileIdx: number, mode: SplitMode): number[] {
  if (mode === "none") return [fileIdx + 1];

  let tp = 1;
  for (let fi = 0; fi < fileIdx; fi++) {
    if (mode === "single1" && fi === 0) { tp += 1; continue; }
    if (mode === "spread-skip1" && fi === 0) { tp += 1; continue; }
    tp += 2;
  }

  if (mode === "single1" && fileIdx === 0) return [1];
  if (mode === "spread-skip1" && fileIdx === 0) return [1];
  return [tp, tp + 1];
}

/** テキストページ番号 → { fileIdx, side } の逆引き */
export function textPageToFileIndex(
  textPageNum: number,
  fileCount: number,
  mode: SplitMode,
): { fileIdx: number; side: "left" | "right" | "full" } | null {
  for (let fi = 0; fi < fileCount; fi++) {
    const pns = getTextPageNumbers(fi, mode);
    if (pns.length === 1 && pns[0] === textPageNum) {
      return { fileIdx: fi, side: "full" };
    }
    if (pns.length === 2) {
      if (pns[0] === textPageNum) return { fileIdx: fi, side: "left" };
      if (pns[1] === textPageNum) return { fileIdx: fi, side: "right" };
    }
  }
  return null;
}
