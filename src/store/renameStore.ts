import { create } from "zustand";
import type {
  RenameSubMode,
  RenamePhase,
  RenameRule,
  MatchMode,
  LayerRenameSettings,
  FileRenameSettings,
  FileRenameMode,
  FileOutputMode,
  FileRenameEntry,
  RenameResult,
} from "../types/rename";

interface RenameState {
  // サブモード
  subMode: RenameSubMode;

  // レイヤーリネーム設定
  layerSettings: LayerRenameSettings;

  // ファイルリネーム設定
  fileSettings: FileRenameSettings;

  // ファイルリネーム用エントリ（フォルダから読み込んだファイルリスト）
  fileEntries: FileRenameEntry[];

  // 処理状態
  phase: RenamePhase;
  progress: number;
  totalFiles: number;
  results: RenameResult[];
  showResultDialog: boolean;

  // === Actions: サブモード ===
  setSubMode: (mode: RenameSubMode) => void;

  // === Actions: レイヤーリネーム ===
  setBottomLayerEnabled: (enabled: boolean) => void;
  setBottomLayerName: (name: string) => void;
  addRule: (target: "layer" | "group") => void;
  updateRule: (id: string, updates: Partial<RenameRule>) => void;
  removeRule: (id: string) => void;
  setLayerFileOutputEnabled: (enabled: boolean) => void;
  setLayerFileOutputBaseName: (name: string) => void;
  setLayerFileOutputStartNumber: (n: number) => void;
  setLayerFileOutputPadding: (n: number) => void;
  setLayerFileOutputSeparator: (sep: string) => void;
  setLayerOutputDirectory: (dir: string | null) => void;

  // === Actions: ファイルリネーム ===
  setFileRenameMode: (mode: FileRenameMode) => void;
  setSequentialBaseName: (name: string) => void;
  setSequentialStartNumber: (n: number) => void;
  setSequentialPadding: (n: number) => void;
  setSequentialSeparator: (sep: string) => void;
  setReplaceSearchText: (text: string) => void;
  setReplaceReplaceText: (text: string) => void;
  setReplaceMatchMode: (mode: MatchMode) => void;
  setPrefix: (prefix: string) => void;
  setSuffix: (suffix: string) => void;
  setFileOutputMode: (mode: FileOutputMode) => void;
  setFileOutputDirectory: (dir: string | null) => void;

  // === Actions: ファイルエントリ ===
  setFileEntries: (entries: FileRenameEntry[]) => void;
  addFileEntries: (entries: FileRenameEntry[]) => void;
  removeFileEntry: (id: string) => void;
  removeFolder: (folderPath: string) => void;
  clearFileEntries: () => void;
  toggleEntrySelected: (id: string) => void;
  toggleAllSelected: (selected: boolean) => void;
  setEntryCustomName: (id: string, name: string | null) => void;
  reorderEntries: (fromIndex: number, toIndex: number) => void;
  reorderFolder: (fromFolderPath: string, toFolderPath: string) => void;

  // === Actions: 処理 ===
  setPhase: (phase: RenamePhase) => void;
  setProgress: (current: number, total: number) => void;
  addResult: (result: RenameResult) => void;
  clearResults: () => void;
  setShowResultDialog: (show: boolean) => void;
  reset: () => void;
}

const defaultLayerSettings: LayerRenameSettings = {
  bottomLayer: { enabled: false, newName: "" },
  rules: [],
  fileOutput: {
    enabled: false,
    baseName: "",
    startNumber: 1,
    padding: 3,
    separator: "_",
  },
  outputDirectory: null,
};

const defaultFileSettings: FileRenameSettings = {
  mode: "sequential",
  sequential: {
    baseName: "",
    startNumber: 3,
    padding: 4,
    separator: "",
  },
  replaceString: {
    searchText: "",
    replaceText: "",
    matchMode: "partial",
  },
  prefixSuffix: {
    prefix: "",
    suffix: "",
  },
  outputMode: "copy",
  outputDirectory: null,
};

/** 内部D&D（フォルダ並替え等）中にTauriネイティブdrop overlayを抑制するフラグ */
export const internalDragState = { active: false };

export const useRenameStore = create<RenameState>((set) => ({
  subMode: "file",
  layerSettings: defaultLayerSettings,
  fileSettings: defaultFileSettings,
  fileEntries: [],
  phase: "idle",
  progress: 0,
  totalFiles: 0,
  results: [],
  showResultDialog: false,

  // サブモード
  setSubMode: (subMode) => set({ subMode }),

  // レイヤーリネーム: 最下位レイヤー
  setBottomLayerEnabled: (enabled) =>
    set((s) => ({
      layerSettings: {
        ...s.layerSettings,
        bottomLayer: { ...s.layerSettings.bottomLayer, enabled },
      },
    })),
  setBottomLayerName: (newName) =>
    set((s) => ({
      layerSettings: {
        ...s.layerSettings,
        bottomLayer: { ...s.layerSettings.bottomLayer, newName },
      },
    })),

  // レイヤーリネーム: ルール
  addRule: (target) =>
    set((s) => ({
      layerSettings: {
        ...s.layerSettings,
        rules: [
          ...s.layerSettings.rules,
          {
            id: crypto.randomUUID(),
            target,
            oldName: "",
            newName: "",
            matchMode: "exact",
          },
        ],
      },
    })),
  updateRule: (id, updates) =>
    set((s) => ({
      layerSettings: {
        ...s.layerSettings,
        rules: s.layerSettings.rules.map((r) => (r.id === id ? { ...r, ...updates } : r)),
      },
    })),
  removeRule: (id) =>
    set((s) => ({
      layerSettings: {
        ...s.layerSettings,
        rules: s.layerSettings.rules.filter((r) => r.id !== id),
      },
    })),

  // レイヤーリネーム: ファイル出力
  setLayerFileOutputEnabled: (enabled) =>
    set((s) => ({
      layerSettings: {
        ...s.layerSettings,
        fileOutput: { ...s.layerSettings.fileOutput, enabled },
      },
    })),
  setLayerFileOutputBaseName: (baseName) =>
    set((s) => ({
      layerSettings: {
        ...s.layerSettings,
        fileOutput: { ...s.layerSettings.fileOutput, baseName },
      },
    })),
  setLayerFileOutputStartNumber: (startNumber) =>
    set((s) => ({
      layerSettings: {
        ...s.layerSettings,
        fileOutput: { ...s.layerSettings.fileOutput, startNumber },
      },
    })),
  setLayerFileOutputPadding: (padding) =>
    set((s) => ({
      layerSettings: {
        ...s.layerSettings,
        fileOutput: { ...s.layerSettings.fileOutput, padding },
      },
    })),
  setLayerFileOutputSeparator: (separator) =>
    set((s) => ({
      layerSettings: {
        ...s.layerSettings,
        fileOutput: { ...s.layerSettings.fileOutput, separator },
      },
    })),
  setLayerOutputDirectory: (outputDirectory) =>
    set((s) => ({
      layerSettings: { ...s.layerSettings, outputDirectory },
    })),

  // ファイルリネーム: モード
  setFileRenameMode: (mode) =>
    set((s) => ({
      fileSettings: { ...s.fileSettings, mode },
    })),

  // ファイルリネーム: 連番
  setSequentialBaseName: (baseName) =>
    set((s) => ({
      fileSettings: {
        ...s.fileSettings,
        sequential: { ...s.fileSettings.sequential, baseName },
      },
    })),
  setSequentialStartNumber: (startNumber) =>
    set((s) => ({
      fileSettings: {
        ...s.fileSettings,
        sequential: { ...s.fileSettings.sequential, startNumber },
      },
    })),
  setSequentialPadding: (padding) =>
    set((s) => ({
      fileSettings: {
        ...s.fileSettings,
        sequential: { ...s.fileSettings.sequential, padding },
      },
    })),
  setSequentialSeparator: (separator) =>
    set((s) => ({
      fileSettings: {
        ...s.fileSettings,
        sequential: { ...s.fileSettings.sequential, separator },
      },
    })),

  // ファイルリネーム: 文字列置換
  setReplaceSearchText: (searchText) =>
    set((s) => ({
      fileSettings: {
        ...s.fileSettings,
        replaceString: { ...s.fileSettings.replaceString, searchText },
      },
    })),
  setReplaceReplaceText: (replaceText) =>
    set((s) => ({
      fileSettings: {
        ...s.fileSettings,
        replaceString: { ...s.fileSettings.replaceString, replaceText },
      },
    })),
  setReplaceMatchMode: (matchMode) =>
    set((s) => ({
      fileSettings: {
        ...s.fileSettings,
        replaceString: { ...s.fileSettings.replaceString, matchMode },
      },
    })),

  // ファイルリネーム: プレフィックス/サフィックス
  setPrefix: (prefix) =>
    set((s) => ({
      fileSettings: {
        ...s.fileSettings,
        prefixSuffix: { ...s.fileSettings.prefixSuffix, prefix },
      },
    })),
  setSuffix: (suffix) =>
    set((s) => ({
      fileSettings: {
        ...s.fileSettings,
        prefixSuffix: { ...s.fileSettings.prefixSuffix, suffix },
      },
    })),

  // ファイルリネーム: 出力
  setFileOutputMode: (outputMode) =>
    set((s) => ({
      fileSettings: { ...s.fileSettings, outputMode },
    })),
  setFileOutputDirectory: (outputDirectory) =>
    set((s) => ({
      fileSettings: { ...s.fileSettings, outputDirectory },
    })),

  // ファイルエントリ
  setFileEntries: (fileEntries) => set({ fileEntries }),
  addFileEntries: (entries) =>
    set((s) => {
      // 重複パス除外
      const existingPaths = new Set(s.fileEntries.map((e) => e.filePath));
      const newEntries = entries.filter((e) => !existingPaths.has(e.filePath));
      return { fileEntries: [...s.fileEntries, ...newEntries] };
    }),
  removeFileEntry: (id) =>
    set((s) => ({
      fileEntries: s.fileEntries.filter((e) => e.id !== id),
    })),
  removeFolder: (folderPath) =>
    set((s) => ({
      fileEntries: s.fileEntries.filter((e) => e.folderPath !== folderPath),
    })),
  clearFileEntries: () => set({ fileEntries: [] }),
  toggleEntrySelected: (id) =>
    set((s) => ({
      fileEntries: s.fileEntries.map((e) => (e.id === id ? { ...e, selected: !e.selected } : e)),
    })),
  toggleAllSelected: (selected) =>
    set((s) => ({
      fileEntries: s.fileEntries.map((e) => ({ ...e, selected })),
    })),
  setEntryCustomName: (id, customName) =>
    set((s) => ({
      fileEntries: s.fileEntries.map((e) => (e.id === id ? { ...e, customName } : e)),
    })),
  reorderEntries: (fromIndex, toIndex) =>
    set((s) => {
      const entries = [...s.fileEntries];
      const [moved] = entries.splice(fromIndex, 1);
      entries.splice(toIndex, 0, moved);
      return { fileEntries: entries };
    }),
  reorderFolder: (fromFolderPath, toFolderPath) =>
    set((s) => {
      // フォルダ順に基づいてエントリを並び替え
      const folderOrder: string[] = [];
      const folderMap = new Map<string, typeof s.fileEntries>();
      for (const e of s.fileEntries) {
        if (!folderMap.has(e.folderPath)) {
          folderOrder.push(e.folderPath);
          folderMap.set(e.folderPath, []);
        }
        folderMap.get(e.folderPath)!.push(e);
      }
      const fromIdx = folderOrder.indexOf(fromFolderPath);
      const toIdx = folderOrder.indexOf(toFolderPath);
      if (fromIdx < 0 || toIdx < 0) return {};
      const [moved] = folderOrder.splice(fromIdx, 1);
      folderOrder.splice(toIdx, 0, moved);
      const reordered = folderOrder.flatMap((fp) => folderMap.get(fp) || []);
      return { fileEntries: reordered };
    }),

  // 処理
  setPhase: (phase) => set({ phase }),
  setProgress: (current, total) => set({ progress: current, totalFiles: total }),
  addResult: (result) => set((s) => ({ results: [...s.results, result] })),
  clearResults: () => set({ results: [] }),
  setShowResultDialog: (showResultDialog) => set({ showResultDialog }),
  reset: () =>
    set({
      phase: "idle",
      progress: 0,
      totalFiles: 0,
      results: [],
      showResultDialog: false,
    }),
}));
