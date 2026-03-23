import { create } from "zustand";

export type SplitMode = "even" | "uneven" | "none";
export type OutputFormat = "psd" | "jpg";
export type PageNumbering = "rl" | "sequential";

export interface SelectionBounds {
  left: number; // 選択範囲の左端 (画像px)
  right: number; // 選択範囲の右端 (画像px)
}

export interface SplitSettings {
  mode: SplitMode;
  outputFormat: OutputFormat;
  jpgQuality: number;
  selectionBounds: SelectionBounds | null;
  pageNumbering: PageNumbering;
  firstPageBlank: boolean;
  lastPageBlank: boolean;
  customBaseName: string;
  deleteHiddenLayers: boolean;
  deleteOffCanvasText: boolean;
  outputDirectory: string | null;
}

export interface SplitResult {
  fileName: string;
  success: boolean;
  outputFiles: string[];
  error?: string;
}

interface SplitState {
  settings: SplitSettings;
  isProcessing: boolean;
  progress: number;
  totalFiles: number;
  currentFile: string | null;
  results: SplitResult[];
  lastOutputDir: string | null;
  processingDurationMs: number | null;
  showResultDialog: boolean;

  // Selection history (undo/redo)
  selectionHistory: (SelectionBounds | null)[];
  selectionFuture: (SelectionBounds | null)[];

  // Actions
  setSettings: (settings: Partial<SplitSettings>) => void;
  setIsProcessing: (value: boolean) => void;
  setProgress: (current: number, total: number) => void;
  setCurrentFile: (fileName: string | null) => void;
  addResult: (result: SplitResult) => void;
  clearResults: () => void;
  setLastOutputDir: (dir: string | null) => void;
  setProcessingDuration: (ms: number | null) => void;
  setShowResultDialog: (show: boolean) => void;
  reset: () => void;

  // Selection history actions
  pushSelectionHistory: () => void;
  undoSelection: () => void;
  redoSelection: () => void;

  // Direct setters (for real-time drag — no history push)
  startDragSelection: () => void;
  setSelectionBoundsDirect: (bounds: SelectionBounds | null) => void;
}

const defaultSettings: SplitSettings = {
  mode: "even",
  outputFormat: "psd",
  jpgQuality: 95,
  selectionBounds: null,
  pageNumbering: "sequential",
  firstPageBlank: false,
  lastPageBlank: false,
  customBaseName: "",
  deleteHiddenLayers: true,
  deleteOffCanvasText: true,
  outputDirectory: null,
};

export const useSplitStore = create<SplitState>((set) => ({
  settings: defaultSettings,
  isProcessing: false,
  progress: 0,
  totalFiles: 0,
  currentFile: null,
  results: [],
  lastOutputDir: null,
  processingDurationMs: null,
  showResultDialog: false,
  selectionHistory: [],
  selectionFuture: [],

  setSettings: (newSettings) =>
    set((state) => {
      // selectionBoundsが変更される場合、履歴に保存
      if ("selectionBounds" in newSettings) {
        const history = [...state.selectionHistory.slice(-19), state.settings.selectionBounds];
        return {
          settings: { ...state.settings, ...newSettings },
          selectionHistory: history,
          selectionFuture: [],
        };
      }
      return { settings: { ...state.settings, ...newSettings } };
    }),

  setIsProcessing: (value) => set({ isProcessing: value }),

  setProgress: (current, total) => set({ progress: current, totalFiles: total }),

  setCurrentFile: (fileName) => set({ currentFile: fileName }),

  addResult: (result) =>
    set((state) => ({
      results: [...state.results, result],
    })),

  clearResults: () => set({ results: [] }),

  setLastOutputDir: (dir) => set({ lastOutputDir: dir }),

  setProcessingDuration: (ms) => set({ processingDurationMs: ms }),

  setShowResultDialog: (show) => set({ showResultDialog: show }),

  reset: () =>
    set({
      isProcessing: false,
      progress: 0,
      totalFiles: 0,
      currentFile: null,
      results: [],
    }),

  pushSelectionHistory: () =>
    set((state) => ({
      selectionHistory: [...state.selectionHistory.slice(-19), state.settings.selectionBounds],
    })),

  undoSelection: () =>
    set((state) => {
      if (state.selectionHistory.length === 0) return state;
      const previous = state.selectionHistory[state.selectionHistory.length - 1];
      return {
        settings: { ...state.settings, selectionBounds: previous },
        selectionHistory: state.selectionHistory.slice(0, -1),
        selectionFuture: [state.settings.selectionBounds, ...state.selectionFuture],
      };
    }),

  redoSelection: () =>
    set((state) => {
      if (state.selectionFuture.length === 0) return state;
      const next = state.selectionFuture[0];
      return {
        settings: { ...state.settings, selectionBounds: next },
        selectionHistory: [...state.selectionHistory, state.settings.selectionBounds],
        selectionFuture: state.selectionFuture.slice(1),
      };
    }),

  startDragSelection: () =>
    set((state) => ({
      selectionHistory: [...state.selectionHistory.slice(-19), state.settings.selectionBounds],
      selectionFuture: [],
    })),

  setSelectionBoundsDirect: (bounds) =>
    set((state) => ({
      settings: { ...state.settings, selectionBounds: bounds },
    })),
}));

/** 元スクリプト(bunkatsu_ver1.13.jsx)準拠のマージン計算 */
export function computeMargins(bounds: SelectionBounds, docWidth: number) {
  const halfWidth = Math.floor(docWidth / 2);
  const outerMargin = bounds.left;
  const innerMargin = halfWidth - bounds.right;
  const marginToAdd = Math.max(0, outerMargin - innerMargin);
  const finalWidth = halfWidth + marginToAdd;
  const overlapPx = Math.max(0, bounds.right - halfWidth);
  const overlapPercent = halfWidth > 0 ? (overlapPx / halfWidth) * 100 : 0;
  return {
    outerMargin,
    innerMargin,
    marginToAdd,
    finalWidth,
    overlapPercent,
    hasOverlap: overlapPercent > 0,
    hasExcessiveOverlap: overlapPercent > 5,
  };
}
