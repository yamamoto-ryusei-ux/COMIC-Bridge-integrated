/**
 * 差分ビューアー専用ストア（KENBANから移植、Tailwind/Zustandネイティブ版）
 *
 * 元: src/components/kenban/KenbanDiffViewer.tsx (1175行) + KenbanApp.tsx の差分関連state
 */
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";

// ═══ 型定義 ═══

export type CompareMode = "tiff-tiff" | "psd-psd" | "pdf-pdf" | "psd-tiff";
export type ViewMode = "A" | "B" | "diff";
export type PairingMode = "order" | "name";

export interface DiffFile {
  name: string;
  filePath: string;
  size?: number;
}

export interface DiffMarker {
  x: number;
  y: number;
  radius: number;
  count: number;
}

export interface CropBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface FilePair {
  index: number;
  fileA: DiffFile | null;
  fileB: DiffFile | null;
  status: "pending" | "loading" | "checking" | "rendering" | "done" | "error";
  srcA?: string;
  srcB?: string;
  processedA?: string;
  diffSrc?: string;
  hasDiff?: boolean;
  diffCount?: number;
  diffProbability?: number;
  markers?: DiffMarker[];
  imageWidth?: number;
  imageHeight?: number;
  error?: string;
}

interface DiffStore {
  // ── ファイル読み込み ──
  folderA: string | null;
  folderB: string | null;
  filesA: DiffFile[];
  filesB: DiffFile[];

  // ── ペアリング ──
  pairs: FilePair[];
  pairingMode: PairingMode;
  selectedIndex: number;

  // ── 比較モード ──
  compareMode: CompareMode;

  // ── 表示モード ──
  viewMode: ViewMode;

  // ── ズーム/パン ──
  zoom: number;
  panX: number;
  panY: number;
  isDragging: boolean;

  // ── PDF ──
  currentPage: number;
  totalPages: number;

  // ── オプション ──
  threshold: number;
  filterDiffOnly: boolean;
  showMarkers: boolean;
  cropBounds: CropBounds | null;

  // ── プレビューキャッシュ（filePath → URL）──
  previewMap: Record<string, string>;

  // ═══ Actions ═══
  setFolderA: (path: string | null) => void;
  setFolderB: (path: string | null) => void;
  setFilesA: (files: DiffFile[]) => void;
  setFilesB: (files: DiffFile[]) => void;
  loadFolderSide: (path: string, side: "A" | "B") => Promise<void>;

  setPairingMode: (mode: PairingMode) => void;
  setSelectedIndex: (index: number) => void;
  rebuildPairs: () => void;

  setCompareMode: (mode: CompareMode) => void;
  setViewMode: (mode: ViewMode) => void;

  setZoom: (zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  setPan: (x: number, y: number) => void;
  setIsDragging: (dragging: boolean) => void;

  setCurrentPage: (page: number) => void;
  setTotalPages: (total: number) => void;

  setThreshold: (threshold: number) => void;
  setFilterDiffOnly: (filter: boolean) => void;
  setShowMarkers: (show: boolean) => void;
  setCropBounds: (bounds: CropBounds | null) => void;

  /** ファイルのプレビューURLを取得してキャッシュ */
  loadPreviewForFile: (filePath: string) => Promise<void>;
  /** filesA / filesB から compareMode を自動判定して設定 */
  autoDetectCompareMode: () => void;
  /** 1ペアの差分計算を実行 */
  processPair: (index: number) => Promise<void>;
  /** 全ペアを順次処理 */
  processAllPairs: () => Promise<void>;
  /** 全クリア */
  reset: () => void;
}

// ═══ ヘルパー ═══

function getExt(path: string): string {
  return path.substring(path.lastIndexOf(".") + 1).toLowerCase();
}

function getFileName(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

function getBaseName(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

/** 自然順ソート */
function naturalSort(a: string, b: string): number {
  return a.localeCompare(b, "ja", { numeric: true, sensitivity: "base" });
}

/** ファイルのプレビューURLを取得（PSD/PDF/通常画像対応） */
export async function loadPreviewUrl(filePath: string, pdfPageOneIndexed: number = 1): Promise<string> {
  const ext = getExt(filePath);
  if (ext === "pdf") {
    // Rust側は0-indexed
    const result = await invoke<{ src: string; width: number; height: number }>(
      "kenban_render_pdf_page",
      { path: filePath, page: pdfPageOneIndexed - 1, dpi: 150, splitSide: null },
    );
    return convertFileSrc(result.src);
  } else if (ext === "psd" || ext === "psb") {
    const result = await invoke<{ file_url: string; width: number; height: number }>(
      "kenban_parse_psd",
      { path: filePath },
    );
    return convertFileSrc(result.file_url);
  } else {
    return convertFileSrc(filePath);
  }
}

/** A/Bの拡張子から compareMode を決定（PSD/TIFF の順序は問わない） */
export function computeCompareMode(
  extA: string,
  extB: string,
  psdExts: string[] = ["psd", "psb"],
  tiffExts: string[] = ["tif", "tiff", "jpg", "jpeg", "png", "bmp"],
): CompareMode | null {
  const aIsPsd = psdExts.includes(extA);
  const bIsPsd = psdExts.includes(extB);
  const aIsTiff = tiffExts.includes(extA);
  const bIsTiff = tiffExts.includes(extB);
  const aIsPdf = extA === "pdf";
  const bIsPdf = extB === "pdf";

  // 1. PDF が片方でもあれば pdf-pdf
  if (aIsPdf || bIsPdf) return "pdf-pdf";
  // 2. PSD と TIFF の混在 → psd-tiff（順序問わず）
  if ((aIsPsd && bIsTiff) || (aIsTiff && bIsPsd)) return "psd-tiff";
  // 3. 両方 PSD
  if (aIsPsd && bIsPsd) return "psd-psd";
  // 4. 両方 TIFF系
  if (aIsTiff && bIsTiff) return "tiff-tiff";
  // 5. 片方未設定 → 設定されている方で判定
  if (aIsPsd || bIsPsd) return "psd-psd";
  if (aIsTiff || bIsTiff) return "tiff-tiff";
  return null;
}

/** ペアの組み合わせがcompareModeと一致しているか判定（psd-tiff は双方向OK） */
export function isValidPairCombination(
  fileAPath: string | undefined | null,
  fileBPath: string | undefined | null,
  compareMode: CompareMode,
): { valid: boolean; reason?: string } {
  if (!fileAPath || !fileBPath) return { valid: true };
  const extA = getExt(fileAPath);
  const extB = getExt(fileBPath);

  const psdExts = ["psd", "psb"];
  const tiffExts = ["tif", "tiff", "jpg", "jpeg", "png", "bmp"];

  if (compareMode === "psd-tiff") {
    // 双方向OK: A=PSD&B=TIFF or A=TIFF&B=PSD
    const oneIsPsd = psdExts.includes(extA) || psdExts.includes(extB);
    const oneIsTiff = tiffExts.includes(extA) || tiffExts.includes(extB);
    if (oneIsPsd && oneIsTiff) return { valid: true };
    return { valid: false, reason: `PSD/TIFFの組み合わせが必要ですが A=${extA.toUpperCase()}, B=${extB.toUpperCase()} です` };
  }
  if (compareMode === "psd-psd") {
    if (!psdExts.includes(extA)) return { valid: false, reason: `A側はPSDが必要ですが ${extA.toUpperCase()} です` };
    if (!psdExts.includes(extB)) return { valid: false, reason: `B側はPSDが必要ですが ${extB.toUpperCase()} です` };
    return { valid: true };
  }
  if (compareMode === "pdf-pdf") {
    if (extA !== "pdf") return { valid: false, reason: `A側はPDFが必要ですが ${extA.toUpperCase()} です` };
    if (extB !== "pdf") return { valid: false, reason: `B側はPDFが必要ですが ${extB.toUpperCase()} です` };
    return { valid: true };
  }
  if (compareMode === "tiff-tiff") {
    if (!tiffExts.includes(extA)) return { valid: false, reason: `A側はTIFF/画像が必要ですが ${extA.toUpperCase()} です` };
    if (!tiffExts.includes(extB)) return { valid: false, reason: `B側はTIFF/画像が必要ですが ${extB.toUpperCase()} です` };
    return { valid: true };
  }
  return { valid: true };
}

/** ファイル拡張子からCompareModeを推定 */
export function detectCompareMode(extA: string, extB?: string): CompareMode {
  const psdExts = ["psd", "psb"];
  const tiffExts = ["tif", "tiff", "jpg", "jpeg", "png", "bmp"];
  if (extA === "pdf") return "pdf-pdf";
  if (psdExts.includes(extA)) {
    if (extB && tiffExts.includes(extB)) return "psd-tiff";
    return "psd-psd";
  }
  return "tiff-tiff";
}

// ═══ ストア ═══

export const useDiffStore = create<DiffStore>((set, get) => ({
  // ── 初期値 ──
  folderA: null,
  folderB: null,
  filesA: [],
  filesB: [],
  pairs: [],
  pairingMode: "order",
  selectedIndex: 0,
  compareMode: "tiff-tiff",
  viewMode: "A",
  zoom: 1,
  panX: 0,
  panY: 0,
  isDragging: false,
  currentPage: 1,
  totalPages: 1,
  threshold: 30,
  filterDiffOnly: false,
  showMarkers: true,
  cropBounds: null,
  previewMap: {},

  // ── Actions ──
  loadPreviewForFile: async (filePath) => {
    const cached = get().previewMap[filePath];
    if (cached) return;
    try {
      const url = await loadPreviewUrl(filePath);
      set((s) => ({ previewMap: { ...s.previewMap, [filePath]: url } }));
    } catch (e) {
      console.error(`loadPreviewForFile error (${filePath}):`, e);
    }
  },

  autoDetectCompareMode: () => {
    const { filesA, filesB } = get();
    const extA = filesA[0] ? getExt(filesA[0].filePath) : "";
    const extB = filesB[0] ? getExt(filesB[0].filePath) : "";

    const psdExts = ["psd", "psb"];
    const tiffExts = ["tif", "tiff", "jpg", "jpeg", "png", "bmp"];

    const mode = computeCompareMode(extA, extB, psdExts, tiffExts);
    if (mode && mode !== get().compareMode) {
      set({ compareMode: mode });
    }
  },

  setFolderA: (path) => set({ folderA: path }),
  setFolderB: (path) => set({ folderB: path }),
  setFilesA: (files) => { set({ filesA: files }); get().rebuildPairs(); },
  setFilesB: (files) => { set({ filesB: files }); get().rebuildPairs(); },

  /** フォルダ or ファイルパスからファイル一覧を読み込み */
  loadFolderSide: async (path, side) => {
    const ext = getExt(path);
    const isFile = ext.length > 0 && ["pdf", "psd", "psb", "tif", "tiff", "jpg", "jpeg", "png", "bmp"].includes(ext);

    let loadedFiles: DiffFile[] = [];
    if (isFile) {
      // 単一ファイル（compareModeは変更しない、タブ移動時に判定される）
      const file: DiffFile = { name: getFileName(path), filePath: path };
      loadedFiles = [file];
      if (side === "A") {
        set({ folderA: path, filesA: [file] });
      } else {
        set({ folderB: path, filesB: [file] });
      }
    } else {
      // フォルダ → 中のファイル一覧取得（全対応形式を読み込む。compareMode フィルタは不要）
      const ALL_EXTS = ["pdf", "psd", "psb", "tif", "tiff", "jpg", "jpeg", "png", "bmp"];
      try {
        const filePaths = await invoke<string[]>("kenban_list_files_in_folder", {
          path,
          extensions: ALL_EXTS,
        });
        loadedFiles = filePaths
          .map((p) => ({ name: getFileName(p), filePath: p }))
          .sort((a, b) => naturalSort(a.name, b.name));
        if (side === "A") {
          set({ folderA: path, filesA: loadedFiles });
        } else {
          set({ folderB: path, filesB: loadedFiles });
        }
      } catch (e) {
        console.error("loadFolderSide error:", e);
      }
    }
    // compareMode の自動判定はタブ移動時のみ（UnifiedViewerView 側で実行）
    get().rebuildPairs();

    // 各ファイルのプレビューを並行取得（バックグラウンド）
    for (const f of loadedFiles) {
      get().loadPreviewForFile(f.filePath);
    }
  },

  setPairingMode: (mode) => { set({ pairingMode: mode }); get().rebuildPairs(); },
  setSelectedIndex: (index) => set({ selectedIndex: index, currentPage: 1 }),

  rebuildPairs: () => {
    const { filesA, filesB, pairingMode } = get();
    const pairs: FilePair[] = [];

    if (pairingMode === "order") {
      const maxLen = Math.max(filesA.length, filesB.length);
      for (let i = 0; i < maxLen; i++) {
        pairs.push({
          index: i,
          fileA: filesA[i] || null,
          fileB: filesB[i] || null,
          status: "pending",
        });
      }
    } else {
      // name pairing: extension-stripped basename
      const mapA = new Map(filesA.map((f) => [getBaseName(f.name), f]));
      const mapB = new Map(filesB.map((f) => [getBaseName(f.name), f]));
      const allKeys = Array.from(new Set([...mapA.keys(), ...mapB.keys()])).sort(naturalSort);
      for (let i = 0; i < allKeys.length; i++) {
        const key = allKeys[i];
        pairs.push({
          index: i,
          fileA: mapA.get(key) || null,
          fileB: mapB.get(key) || null,
          status: "pending",
        });
      }
    }
    set({ pairs, selectedIndex: 0 });
  },

  setCompareMode: (mode) => set({ compareMode: mode }),
  setViewMode: (mode) => set({ viewMode: mode }),

  setZoom: (zoom) => set({ zoom: Math.max(0.1, Math.min(10, zoom)) }),
  zoomIn: () => set((s) => ({ zoom: Math.min(10, s.zoom * 1.2) })),
  zoomOut: () => set((s) => ({ zoom: Math.max(0.1, s.zoom / 1.2) })),
  resetZoom: () => set({ zoom: 1, panX: 0, panY: 0 }),
  setPan: (x, y) => set({ panX: x, panY: y }),
  setIsDragging: (dragging) => set({ isDragging: dragging }),

  setCurrentPage: (page) => set({ currentPage: page }),
  setTotalPages: (total) => set({ totalPages: total }),

  setThreshold: (threshold) => set({ threshold }),
  setFilterDiffOnly: (filter) => set({ filterDiffOnly: filter }),
  setShowMarkers: (show) => set({ showMarkers: show }),
  setCropBounds: (bounds) => set({ cropBounds: bounds }),

  processPair: async (index) => {
    const { pairs, compareMode, threshold, cropBounds } = get();
    const pair = pairs[index];
    if (!pair) return;

    // status: loading
    set((s) => {
      const next = [...s.pairs];
      next[index] = { ...next[index], status: "loading" };
      return { pairs: next };
    });

    // ── ステップ1: 必ずプレビューを取得（A・B どちらも対応）──
    let previewA: string | undefined;
    let previewB: string | undefined;
    try {
      if (pair.fileA) previewA = await loadPreviewUrl(pair.fileA.filePath);
    } catch (e) {
      console.error("Preview A error:", e);
    }
    try {
      if (pair.fileB) previewB = await loadPreviewUrl(pair.fileB.filePath);
    } catch (e) {
      console.error("Preview B error:", e);
    }

    // プレビューだけまずセット（差分計算前でも表示できるように）
    set((s) => {
      const next = [...s.pairs];
      next[index] = {
        ...next[index],
        status: "done",
        srcA: previewA,
        srcB: previewB,
      };
      return { pairs: next };
    });

    // ── ステップ2: 両方そろっていなければ終了 ──
    if (!pair.fileA || !pair.fileB) return;

    // ── ステップ2.5: 不適切な組み合わせは差分計算をスキップ ──
    const validity = isValidPairCombination(pair.fileA.filePath, pair.fileB.filePath, compareMode);
    if (!validity.valid) {
      set((s) => {
        const next = [...s.pairs];
        next[index] = { ...next[index], error: validity.reason };
        return { pairs: next };
      });
      return;
    }

    // ── ステップ3: PDF-PDF は差分計算スキップ（プレビューのみ）──
    if (compareMode === "pdf-pdf") return;

    // ── ステップ4: 差分計算を試行（失敗してもプレビューは残る）──
    try {
      if (compareMode === "psd-tiff") {
        if (!cropBounds) {
          set((s) => {
            const next = [...s.pairs];
            next[index] = { ...next[index], error: "クロップ範囲未設定" };
            return { pairs: next };
          });
          return;
        }
        // PSD/TIFFの順序を自動判定（双方向対応）
        const psdExts = ["psd", "psb"];
        const aIsPsd = psdExts.includes(getExt(pair.fileA.filePath));
        const psdPath = aIsPsd ? pair.fileA.filePath : pair.fileB.filePath;
        const tiffPath = aIsPsd ? pair.fileB.filePath : pair.fileA.filePath;
        const result = await invoke<any>("compute_diff_heatmap", {
          psdPath,
          tiffPath,
          cropBounds,
          threshold,
        });
        set((s) => {
          const next = [...s.pairs];
          next[index] = {
            ...next[index],
            status: "done",
            srcA: convertFileSrc(result.src_a),
            srcB: convertFileSrc(result.src_b),
            processedA: convertFileSrc(result.processed_a),
            diffSrc: convertFileSrc(result.diff_src),
            hasDiff: result.has_diff,
            diffProbability: result.diff_probability,
            markers: result.markers,
            imageWidth: result.image_width,
            imageHeight: result.image_height,
          };
          return { pairs: next };
        });
      } else {
        // simple diff (tiff-tiff, psd-psd, pdf-pdf)
        const result = await invoke<any>("compute_diff_simple", {
          pathA: pair.fileA.filePath,
          pathB: pair.fileB.filePath,
          threshold,
        });
        set((s) => {
          const next = [...s.pairs];
          next[index] = {
            ...next[index],
            status: "done",
            srcA: convertFileSrc(result.src_a),
            srcB: convertFileSrc(result.src_b),
            diffSrc: convertFileSrc(result.diff_src),
            hasDiff: result.has_diff,
            diffCount: result.diff_count,
            markers: result.markers,
            imageWidth: result.image_width,
            imageHeight: result.image_height,
          };
          return { pairs: next };
        });
      }
    } catch (e) {
      // 差分計算失敗 → プレビューは残したまま、エラー情報のみ追加
      console.error("Diff computation failed:", e);
      set((s) => {
        const next = [...s.pairs];
        next[index] = { ...next[index], error: String(e) };
        return { pairs: next };
      });
    }
  },

  processAllPairs: async () => {
    const { pairs } = get();
    for (let i = 0; i < pairs.length; i++) {
      const p = get().pairs[i];
      if (p.status === "done" || !p.fileA || !p.fileB) continue;
      await get().processPair(i);
    }
  },

  reset: () => set({
    folderA: null,
    folderB: null,
    filesA: [],
    filesB: [],
    pairs: [],
    selectedIndex: 0,
    viewMode: "A",
    zoom: 1,
    panX: 0,
    panY: 0,
    currentPage: 1,
    totalPages: 1,
    cropBounds: null,
    previewMap: {},
  }),
}));
