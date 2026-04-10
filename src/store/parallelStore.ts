/**
 * 並列ビューアー専用ストア（KENBANから移植、Tailwind/Zustandネイティブ版）
 *
 * 元: src/components/kenban/KenbanParallelViewer.tsx (1,318行)
 * - 左右2パネル独立ファイル管理
 * - 同期/非同期スクロールモード
 * - PDF見開き分割対応
 */
import { create } from "zustand";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";

// ═══ 型定義 ═══

export interface ParallelFileEntry {
  name: string;
  filePath: string;
  isPdf: boolean;
  pdfPage?: number;       // 1-indexed (PDF時のみ)
  totalPdfPages?: number; // PDFの全ページ数
  spreadSide?: "left" | "right" | null;
}

export type SyncMode = boolean;
export type ActivePanel = "A" | "B";

interface PanelState {
  files: ParallelFileEntry[];
  folder: string | null;
  index: number;
  imageUrl: string | null;
  zoom: number;
  panX: number;
  panY: number;
}

interface ParallelStore {
  // ── パネル状態 ──
  A: PanelState;
  B: PanelState;

  // ── 共通 ──
  syncMode: SyncMode;
  activePanel: ActivePanel;

  // ═══ Actions ═══
  setFolder: (side: "A" | "B", path: string | null) => void;
  setFiles: (side: "A" | "B", files: ParallelFileEntry[]) => void;
  loadFolderSide: (side: "A" | "B", path: string) => Promise<void>;
  setIndex: (side: "A" | "B", index: number) => void;
  syncedSetIndex: (delta: number) => void;
  loadCurrentImage: (side: "A" | "B") => Promise<void>;

  setZoom: (side: "A" | "B", zoom: number) => void;
  zoomIn: (side: "A" | "B") => void;
  zoomOut: (side: "A" | "B") => void;
  resetZoom: (side: "A" | "B") => void;
  setPan: (side: "A" | "B", x: number, y: number) => void;

  setSyncMode: (mode: SyncMode) => void;
  setActivePanel: (panel: ActivePanel) => void;

  /** PDFを見開き分割（各ページを個別エントリに展開） */
  expandPdfPages: (side: "A" | "B", filePath: string) => Promise<void>;

  reset: () => void;
}

// ═══ ヘルパー ═══

const SUPPORTED_EXTS = ["pdf", "psd", "psb", "tif", "tiff", "jpg", "jpeg", "png", "bmp"];

function getExt(path: string): string {
  return path.substring(path.lastIndexOf(".") + 1).toLowerCase();
}

function getFileName(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

function naturalSort(a: string, b: string): number {
  return a.localeCompare(b, "ja", { numeric: true, sensitivity: "base" });
}

const initialPanel: PanelState = {
  files: [],
  folder: null,
  index: 0,
  imageUrl: null,
  zoom: 1,
  panX: 0,
  panY: 0,
};

// ═══ ストア ═══

export const useParallelStore = create<ParallelStore>((set, get) => ({
  A: { ...initialPanel },
  B: { ...initialPanel },
  syncMode: true,
  activePanel: "A",

  setFolder: (side, path) => set((s) => ({ [side]: { ...s[side], folder: path } } as any)),
  setFiles: (side, files) => set((s) => ({ [side]: { ...s[side], files, index: 0 } } as any)),

  loadFolderSide: async (side, path) => {
    const ext = getExt(path);
    const isFile = ext.length > 0 && SUPPORTED_EXTS.includes(ext);

    if (isFile) {
      // 単一ファイル
      if (ext === "pdf") {
        // PDF: ページ情報取得 → 1ファイル（後でexpandPdfPagesで展開）
        try {
          const pageCount = await invoke<number>("kenban_get_pdf_page_count", { path });
          const entry: ParallelFileEntry = {
            name: getFileName(path),
            filePath: path,
            isPdf: true,
            pdfPage: 1,
            totalPdfPages: pageCount,
          };
          set((s) => ({ [side]: { ...s[side], folder: path, files: [entry], index: 0 } } as any));
        } catch (e) {
          console.error("PDF page count error:", e);
        }
      } else {
        const entry: ParallelFileEntry = { name: getFileName(path), filePath: path, isPdf: false };
        set((s) => ({ [side]: { ...s[side], folder: path, files: [entry], index: 0 } } as any));
      }
    } else {
      // フォルダ
      try {
        const filePaths = await invoke<string[]>("kenban_list_files_in_folder", {
          path,
          extensions: SUPPORTED_EXTS,
        });
        const files: ParallelFileEntry[] = filePaths
          .map((p) => ({
            name: getFileName(p),
            filePath: p,
            isPdf: getExt(p) === "pdf",
          }))
          .sort((a, b) => naturalSort(a.name, b.name));
        set((s) => ({ [side]: { ...s[side], folder: path, files, index: 0 } } as any));
      } catch (e) {
        console.error("loadFolderSide error:", e);
      }
    }
    // 初期画像読み込み
    await get().loadCurrentImage(side);
  },

  setIndex: (side, index) => {
    set((s) => ({ [side]: { ...s[side], index, imageUrl: null } } as any));
    get().loadCurrentImage(side);
  },

  syncedSetIndex: (delta) => {
    const { syncMode, activePanel, A, B } = get();
    if (syncMode) {
      const maxA = A.files.length;
      const maxB = B.files.length;
      const newIdxA = Math.max(0, Math.min(maxA - 1, A.index + delta));
      const newIdxB = Math.max(0, Math.min(maxB - 1, B.index + delta));
      set({
        A: { ...A, index: newIdxA, imageUrl: null },
        B: { ...B, index: newIdxB, imageUrl: null },
      });
      get().loadCurrentImage("A");
      get().loadCurrentImage("B");
    } else {
      get().setIndex(activePanel, get()[activePanel].index + delta);
    }
  },

  loadCurrentImage: async (side) => {
    const panel = get()[side];
    const file = panel.files[panel.index];
    if (!file) return;

    try {
      if (file.isPdf) {
        // PDF: Rustでレンダリング → { src, width, height } を返却
        const result = await invoke<{ src: string; width: number; height: number }>(
          "kenban_render_pdf_page",
          {
            path: file.filePath,
            page: file.pdfPage || 1,
            dpi: 150,
            splitSide: file.spreadSide || null,
          },
        );
        set((s) => ({ [side]: { ...s[side], imageUrl: convertFileSrc(result.src) } } as any));
      } else if (getExt(file.filePath) === "psd" || getExt(file.filePath) === "psb") {
        // PSD: kenban_parse_psd → { file_url, width, height } を返却
        const result = await invoke<{ file_url: string; width: number; height: number }>(
          "kenban_parse_psd",
          { path: file.filePath },
        );
        set((s) => ({ [side]: { ...s[side], imageUrl: convertFileSrc(result.file_url) } } as any));
      } else {
        // 通常画像: convertFileSrcで直接表示
        set((s) => ({ [side]: { ...s[side], imageUrl: convertFileSrc(file.filePath) } } as any));
      }
    } catch (e) {
      console.error(`loadCurrentImage error (${side}):`, e);
    }
  },

  setZoom: (side, zoom) => set((s) => ({ [side]: { ...s[side], zoom: Math.max(0.1, Math.min(10, zoom)) } } as any)),
  zoomIn: (side) => set((s) => ({ [side]: { ...s[side], zoom: Math.min(10, s[side].zoom * 1.2) } } as any)),
  zoomOut: (side) => set((s) => ({ [side]: { ...s[side], zoom: Math.max(0.1, s[side].zoom / 1.2) } } as any)),
  resetZoom: (side) => set((s) => ({ [side]: { ...s[side], zoom: 1, panX: 0, panY: 0 } } as any)),
  setPan: (side, x, y) => set((s) => ({ [side]: { ...s[side], panX: x, panY: y } } as any)),

  setSyncMode: (mode) => set({ syncMode: mode }),
  setActivePanel: (panel) => set({ activePanel: panel }),

  expandPdfPages: async (side, filePath) => {
    try {
      const pageCount = await invoke<number>("kenban_get_pdf_page_count", { path: filePath });
      const entries: ParallelFileEntry[] = [];
      const baseName = getFileName(filePath);
      for (let p = 1; p <= pageCount; p++) {
        entries.push({
          name: `${baseName} - p${p}`,
          filePath,
          isPdf: true,
          pdfPage: p,
          totalPdfPages: pageCount,
        });
      }
      set((s) => ({ [side]: { ...s[side], files: entries, index: 0 } } as any));
      await get().loadCurrentImage(side);
    } catch (e) {
      console.error("expandPdfPages error:", e);
    }
  },

  reset: () => set({
    A: { ...initialPanel },
    B: { ...initialPanel },
    syncMode: true,
    activePanel: "A",
  }),
}));
