import { create } from "zustand";

export type AppView =
  | "specCheck"
  | "layers"
  | "split"
  | "replace"
  | "compose"
  | "rename"
  | "tiff"
  | "scanPsd"
  | "typesetting"
  | "kenban"
  | "progen"
  | "unifiedViewer";

export type ProgenMode = "extraction" | "formatting" | "proofreading" | null;

interface ViewState {
  activeView: AppView;
  isDetailPanelOpen: boolean;
  progenMode: ProgenMode;
  isViewerFullscreen: boolean;
  /** 検版: 検Aフォルダパス */
  kenbanPathA: string | null;
  /** 検版: 検Bフォルダパス */
  kenbanPathB: string | null;
  /** 検版: 差分/分割切替 */
  kenbanViewMode: "diff" | "parallel";
  /** JSONブラウザモード（TopNavモーダル用） */
  jsonBrowserMode: "preset" | "check" | null;

  setActiveView: (view: AppView) => void;
  setDetailPanelOpen: (open: boolean) => void;
  toggleDetailPanel: () => void;
  setProgenMode: (mode: ProgenMode) => void;
  setViewerFullscreen: (fullscreen: boolean) => void;
  setKenbanPathA: (path: string | null) => void;
  setKenbanPathB: (path: string | null) => void;
  setKenbanViewMode: (mode: "diff" | "parallel") => void;
  setJsonBrowserMode: (mode: "preset" | "check" | null) => void;
}

export const useViewStore = create<ViewState>((set) => ({
  activeView: "specCheck",
  isDetailPanelOpen: false,
  progenMode: null,
  isViewerFullscreen: false,
  kenbanPathA: null,
  kenbanPathB: null,
  kenbanViewMode: "diff" as const,
  jsonBrowserMode: null,

  setActiveView: (activeView) => set({ activeView }),
  setDetailPanelOpen: (isDetailPanelOpen) => set({ isDetailPanelOpen }),
  toggleDetailPanel: () => set((state) => ({ isDetailPanelOpen: !state.isDetailPanelOpen })),
  setProgenMode: (progenMode) => set({ progenMode }),
  setViewerFullscreen: (isViewerFullscreen) => set({ isViewerFullscreen }),
  setKenbanPathA: (kenbanPathA) => set({ kenbanPathA }),
  setKenbanPathB: (kenbanPathB) => set({ kenbanPathB }),
  setKenbanViewMode: (kenbanViewMode) => set({ kenbanViewMode }),
  setJsonBrowserMode: (jsonBrowserMode) => set({ jsonBrowserMode }),
}));
