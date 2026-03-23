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
  | "typesetting";

interface ViewState {
  activeView: AppView;
  isDetailPanelOpen: boolean;

  setActiveView: (view: AppView) => void;
  setDetailPanelOpen: (open: boolean) => void;
  toggleDetailPanel: () => void;
}

export const useViewStore = create<ViewState>((set) => ({
  activeView: "specCheck",
  isDetailPanelOpen: false,

  setActiveView: (activeView) => set({ activeView }),
  setDetailPanelOpen: (isDetailPanelOpen) => set({ isDetailPanelOpen }),
  toggleDetailPanel: () => set((state) => ({ isDetailPanelOpen: !state.isDetailPanelOpen })),
}));
