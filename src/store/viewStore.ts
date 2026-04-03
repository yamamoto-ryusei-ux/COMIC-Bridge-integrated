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

  setActiveView: (view: AppView) => void;
  setDetailPanelOpen: (open: boolean) => void;
  toggleDetailPanel: () => void;
  setProgenMode: (mode: ProgenMode) => void;
}

export const useViewStore = create<ViewState>((set) => ({
  activeView: "specCheck",
  isDetailPanelOpen: false,
  progenMode: null,

  setActiveView: (activeView) => set({ activeView }),
  setDetailPanelOpen: (isDetailPanelOpen) => set({ isDetailPanelOpen }),
  toggleDetailPanel: () => set((state) => ({ isDetailPanelOpen: !state.isDetailPanelOpen })),
  setProgenMode: (progenMode) => set({ progenMode }),
}));
