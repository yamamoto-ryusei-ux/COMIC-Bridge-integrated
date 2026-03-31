import { create } from "zustand";
import type { PsdFile, ViewMode, ThumbnailSize } from "../types";

interface PsdStore {
  // File state
  files: PsdFile[];
  loadingStatus: "idle" | "loading" | "error";
  currentFolderPath: string | null;
  droppedFolderPaths: string[]; // D&Dでドロップされたフォルダパス（サブフォルダ再スキャン用）
  singleFolderDrop: string | null; // 単品フォルダD&D時のフォルダ名（そのフォルダのみ表示用）
  errorMessage: string | null;

  // Selection
  selectedFileIds: string[];
  activeFileId: string | null;

  // UI state
  viewMode: ViewMode;
  thumbnailSize: ThumbnailSize;
  specViewMode: "thumbnails" | "list" | "layers" | "layerCheck";
  psdOnlyFilter: boolean;
  pdfDisplayMode: "page" | "file"; // page=ページごと展開, file=ファイル単位

  // Actions
  setFiles: (files: PsdFile[]) => void;
  addFiles: (files: PsdFile[]) => void;
  updateFile: (id: string, updates: Partial<PsdFile>) => void;
  batchUpdateFiles: (updates: Map<string, Partial<PsdFile>>) => void;
  removeFile: (id: string) => void;
  replaceFile: (id: string, newFiles: PsdFile[]) => void;
  clearFiles: () => void;

  setLoadingStatus: (status: "idle" | "loading" | "error") => void;
  setCurrentFolderPath: (path: string | null) => void;
  setDroppedFolderPaths: (paths: string[]) => void;
  setSingleFolderDrop: (name: string | null) => void;
  setErrorMessage: (message: string | null) => void;

  // Selection actions
  selectFile: (id: string, multi?: boolean) => void;
  selectRange: (toId: string) => void;
  selectAll: () => void;
  clearSelection: () => void;
  setActiveFile: (id: string | null) => void;

  // UI actions
  setViewMode: (mode: ViewMode) => void;
  setThumbnailSize: (size: ThumbnailSize) => void;
  setSpecViewMode: (mode: "thumbnails" | "list" | "layers" | "layerCheck") => void;
  setPsdOnlyFilter: (v: boolean) => void;
  setPdfDisplayMode: (mode: "page" | "file") => void;

  // Helpers
  getSelectedFiles: () => PsdFile[];
  getActiveFile: () => PsdFile | null;
}

export const usePsdStore = create<PsdStore>((set, get) => ({
  // Initial state
  files: [],
  loadingStatus: "idle",
  currentFolderPath: null,
  droppedFolderPaths: [],
  singleFolderDrop: null,
  errorMessage: null,
  selectedFileIds: [],
  activeFileId: null,
  viewMode: "grid",
  thumbnailSize: "medium",
  specViewMode: "thumbnails",
  psdOnlyFilter: false,
  pdfDisplayMode: "page",

  // File actions
  setFiles: (files) => set({ files, selectedFileIds: [], activeFileId: null }),
  addFiles: (newFiles) =>
    set((state) => ({
      files: [...state.files, ...newFiles],
    })),
  updateFile: (id, updates) =>
    set((state) => ({
      files: state.files.map((f) => (f.id === id ? { ...f, ...updates } : f)),
    })),
  batchUpdateFiles: (updates) =>
    set((state) => ({
      files: state.files.map((f) => {
        const u = updates.get(f.id);
        return u ? { ...f, ...u } : f;
      }),
    })),
  removeFile: (id) =>
    set((state) => ({
      files: state.files.filter((f) => f.id !== id),
      selectedFileIds: state.selectedFileIds.filter((sid) => sid !== id),
      activeFileId: state.activeFileId === id ? null : state.activeFileId,
    })),
  replaceFile: (id, newFiles) =>
    set((state) => ({
      files: state.files.flatMap((f) => (f.id === id ? newFiles : [f])),
    })),
  clearFiles: () =>
    set({
      files: [],
      selectedFileIds: [],
      activeFileId: null,
      currentFolderPath: null,
      droppedFolderPaths: [],
      singleFolderDrop: null,
    }),

  setLoadingStatus: (loadingStatus) => set({ loadingStatus }),
  setCurrentFolderPath: (currentFolderPath) => set({ currentFolderPath }),
  setDroppedFolderPaths: (droppedFolderPaths) => set({ droppedFolderPaths }),
  setSingleFolderDrop: (singleFolderDrop) => set({ singleFolderDrop }),
  setErrorMessage: (errorMessage) => set({ errorMessage }),

  // Selection actions
  selectFile: (id, multi = false) =>
    set((state) => {
      if (multi) {
        const isSelected = state.selectedFileIds.includes(id);
        return {
          selectedFileIds: isSelected
            ? state.selectedFileIds.filter((sid) => sid !== id)
            : [...state.selectedFileIds, id],
          activeFileId: id,
        };
      }
      return {
        selectedFileIds: [id],
        activeFileId: id,
      };
    }),

  selectRange: (toId) =>
    set((state) => {
      if (!state.activeFileId) {
        return { selectedFileIds: [toId], activeFileId: toId };
      }

      const fromIndex = state.files.findIndex((f) => f.id === state.activeFileId);
      const toIndex = state.files.findIndex((f) => f.id === toId);

      if (fromIndex === -1 || toIndex === -1) return state;

      const start = Math.min(fromIndex, toIndex);
      const end = Math.max(fromIndex, toIndex);
      const rangeIds = state.files.slice(start, end + 1).map((f) => f.id);

      return {
        selectedFileIds: [...new Set([...state.selectedFileIds, ...rangeIds])],
      };
    }),

  selectAll: () =>
    set((state) => ({
      selectedFileIds: state.files.map((f) => f.id),
    })),

  clearSelection: () => set({ selectedFileIds: [], activeFileId: null }),

  setActiveFile: (activeFileId) => set({ activeFileId }),

  // UI actions
  setViewMode: (viewMode) => set({ viewMode }),
  setThumbnailSize: (thumbnailSize) => set({ thumbnailSize }),
  setSpecViewMode: (specViewMode) => set({ specViewMode }),
  setPsdOnlyFilter: (psdOnlyFilter) => set({ psdOnlyFilter }),
  setPdfDisplayMode: (pdfDisplayMode) => set({ pdfDisplayMode }),

  // Helpers
  getSelectedFiles: () => {
    const state = get();
    return state.files.filter((f) => state.selectedFileIds.includes(f.id));
  },
  getActiveFile: () => {
    const state = get();
    return state.files.find((f) => f.id === state.activeFileId) || null;
  },
}));
