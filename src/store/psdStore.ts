import { create } from "zustand";
import type { PsdFile, ViewMode, ThumbnailSize } from "../types";

export type FileOpsUndoEntry =
  | { type: "delete" | "duplicate" | "cut"; backupPath: string; originalPath: string }
  | { type: "rename"; entries: { oldPath: string; newPath: string }[] };

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
  psdOnlyFilter: boolean; // 互換用（fileTypeFilterで管理）
  fileTypeFilter: "all" | "psd" | "pdf" | "image" | "text";
  pdfDisplayMode: "page" | "file"; // page=ページごと展開, file=ファイル単位
  contentLocked: boolean; // 中央画面ロック（アドレス変更時にファイルリストを保持）
  refreshCounter: number; // folderContents再取得用トリガー
  /** ファイル操作Undoスタック */
  fileOpsUndoStack: FileOpsUndoEntry[];

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
  setFileTypeFilter: (v: "all" | "psd" | "pdf" | "image" | "text") => void;
  setPdfDisplayMode: (mode: "page" | "file") => void;
  setContentLocked: (locked: boolean) => void;
  triggerRefresh: () => void;
  pushFileOpsUndo: (op: FileOpsUndoEntry) => void;
  popFileOpsUndo: () => FileOpsUndoEntry | undefined;

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
  fileTypeFilter: "all" as const,
  pdfDisplayMode: "file",
  contentLocked: false,
  refreshCounter: 0,
  fileOpsUndoStack: [],

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
  setPsdOnlyFilter: (psdOnlyFilter) => set({ psdOnlyFilter, fileTypeFilter: psdOnlyFilter ? "psd" : "all" }),
  setFileTypeFilter: (fileTypeFilter) => set({ fileTypeFilter, psdOnlyFilter: fileTypeFilter === "psd" }),
  setPdfDisplayMode: (pdfDisplayMode) => set({ pdfDisplayMode }),
  setContentLocked: (contentLocked) => set({ contentLocked }),
  triggerRefresh: () => set((s) => ({ refreshCounter: s.refreshCounter + 1 })),
  pushFileOpsUndo: (op) => set((s) => ({ fileOpsUndoStack: [...s.fileOpsUndoStack.slice(-9), op] })),
  popFileOpsUndo: () => {
    const stack = get().fileOpsUndoStack;
    if (stack.length === 0) return undefined;
    const op = stack[stack.length - 1];
    set({ fileOpsUndoStack: stack.slice(0, -1) });
    return op;
  },

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
