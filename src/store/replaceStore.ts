import { create } from "zustand";
import type {
  ReplaceMode,
  TextSubMode,
  SwitchSubMode,
  PairingMode,
  SubfolderMode,
  ProcessingPhase,
  ReplaceSettings,
  FolderSelection,
  PairingJob,
  ReplaceResult,
  PairingDialogMode,
  ScannedFileGroup,
  FilePair,
  ComposeSource,
  ComposeRestSource,
  ComposeElement,
  ComposeSettings,
} from "../types/replace";

export interface BatchFolder {
  name: string;
  path: string;
}

interface ReplaceState {
  // フォルダ選択
  folders: FolderSelection;

  // バッチモード用サブフォルダ
  batchFolders: BatchFolder[];

  // 設定
  settings: ReplaceSettings;

  // モーダル状態
  isModalOpen: boolean;

  // ペアリング結果
  pairingJobs: PairingJob[];
  detectedLinkChar: string | null;

  // 手動マッチ/ダイアログ拡張
  scannedFileGroups: ScannedFileGroup[];
  pairingDialogMode: PairingDialogMode;
  excludedPairIndices: Set<number>;
  manualPairs: FilePair[];

  // 処理状態
  phase: ProcessingPhase;
  progress: number;
  totalPairs: number;
  currentPair: string | null;
  results: ReplaceResult[];

  // Actions - フォルダ
  setSourceFolder: (path: string | null, files?: string[] | null) => void;
  setTargetFolder: (path: string | null, files?: string[] | null) => void;
  setBatchFolders: (folders: BatchFolder[]) => void;
  addBatchFolder: (folder: BatchFolder) => void;
  removeBatchFolder: (path: string) => void;
  setNamedBatchFolder: (name: string, path: string) => void;
  clearBatchFolders: () => void;

  // Actions - 設定
  setMode: (mode: ReplaceMode) => void;
  setTextSubMode: (subMode: TextSubMode) => void;
  setTextGroupName: (name: string) => void;
  setTextPartialMatch: (value: boolean) => void;
  setImageSettings: (settings: Partial<ReplaceSettings["imageSettings"]>) => void;
  setSwitchSettings: (settings: Partial<ReplaceSettings["switchSettings"]>) => void;
  setSwitchSubMode: (subMode: SwitchSubMode) => void;
  setPairingMode: (mode: PairingMode) => void;
  setLinkCharacter: (char: string) => void;
  setGeneralSettings: (settings: Partial<ReplaceSettings["generalSettings"]>) => void;
  setSubfolderMode: (mode: SubfolderMode) => void;

  // Actions - 合成設定
  setComposeSettings: (settings: Partial<ComposeSettings>) => void;
  setComposeElementSource: (elementId: string, source: ComposeSource) => void;
  addComposeElement: (element: ComposeElement) => void;
  removeComposeElement: (elementId: string) => void;
  updateComposeElement: (elementId: string, updates: Partial<ComposeElement>) => void;
  setComposeRestSource: (source: ComposeRestSource) => void;

  // Actions - モーダル
  openModal: () => void;
  closeModal: () => void;

  // Actions - ペアリング
  setPairingJobs: (jobs: PairingJob[]) => void;
  setDetectedLinkChar: (char: string | null) => void;
  updatePairFile: (
    pairIndex: number,
    side: "source" | "target",
    newFile: string,
    newName: string,
  ) => void;
  addAutoPair: (sourceFile: string, targetFile: string) => void;
  removeAutoPair: (pairIndex: number) => void;

  // Actions - 手動マッチ/ダイアログ拡張
  setScannedFileGroups: (groups: ScannedFileGroup[]) => void;
  setPairingDialogMode: (mode: PairingDialogMode) => void;
  toggleExcludedPair: (index: number) => void;
  setManualPairs: (pairs: FilePair[]) => void;
  addManualPair: (pair: FilePair) => void;
  removeManualPair: (pairIndex: number) => void;

  // Actions - 処理
  setPhase: (phase: ProcessingPhase) => void;
  setProgress: (current: number, total: number) => void;
  setCurrentPair: (name: string | null) => void;
  addResult: (result: ReplaceResult) => void;
  clearResults: () => void;
  reset: () => void;
}

const defaultSettings: ReplaceSettings = {
  mode: "text",
  textSettings: {
    subMode: "textLayers",
    groupName: "text",
    partialMatch: false,
  },
  imageSettings: {
    replaceBackground: false,
    replaceSpecialLayer: false,
    specialLayerName: "白消し",
    specialLayerPartialMatch: true,
    replaceNamedGroup: false,
    namedGroupName: "棒消し",
    namedGroupPartialMatch: true,
    placeFromBottom: true,
  },
  switchSettings: {
    subMode: "whiteToBar",
    whiteLayerName: "白消し",
    whitePartialMatch: true,
    barGroupName: "棒消し",
    barPartialMatch: true,
    placeFromBottom: true,
  },
  pairingSettings: {
    mode: "fileOrder",
    linkCharacter: "",
  },
  generalSettings: {
    skipResize: false,
    roundFontSize: false,
    saveFileName: "target",
    outputFolderName: "",
  },
  subfolderSettings: {
    mode: "none",
  },
  composeSettings: {
    elements: [
      { id: "textFolders", type: "textFolders", label: "テキストフォルダ", source: "A" },
      { id: "background", type: "background", label: "背景", source: "B" },
      {
        id: "manuscript",
        type: "namedGroup",
        label: "#背景#",
        source: "exclude",
        customName: "#背景#",
        partialMatch: false,
      },
      {
        id: "specialLayer",
        type: "specialLayer",
        label: "白消し",
        source: "exclude",
        customName: "白消し",
        partialMatch: true,
      },
      {
        id: "namedGroup",
        type: "namedGroup",
        label: "棒消し",
        source: "exclude",
        customName: "棒消し",
        partialMatch: true,
      },
    ],
    restSource: "B",
    skipResize: false,
    roundFontSize: false,
  },
};

export const useReplaceStore = create<ReplaceState>((set) => ({
  folders: { sourceFolder: null, targetFolder: null, sourceFiles: null, targetFiles: null },
  batchFolders: [],
  settings: defaultSettings,
  isModalOpen: false,
  pairingJobs: [],
  detectedLinkChar: null,
  scannedFileGroups: [],
  pairingDialogMode: "auto",
  excludedPairIndices: new Set(),
  manualPairs: [],
  phase: "idle",
  progress: 0,
  totalPairs: 0,
  currentPair: null,
  results: [],

  // フォルダ
  setSourceFolder: (path, files) =>
    set((state) => ({
      folders: { ...state.folders, sourceFolder: path, sourceFiles: files ?? null },
    })),
  setTargetFolder: (path, files) =>
    set((state) => ({
      folders: { ...state.folders, targetFolder: path, targetFiles: files ?? null },
    })),
  setBatchFolders: (folders) => set({ batchFolders: folders }),
  addBatchFolder: (folder) =>
    set((state) => {
      // 同じパスの重複を防ぐ
      if (state.batchFolders.some((f) => f.path === folder.path)) return state;
      return { batchFolders: [...state.batchFolders, folder] };
    }),
  removeBatchFolder: (path) =>
    set((state) => ({
      batchFolders: state.batchFolders.filter((f) => f.path !== path),
    })),
  setNamedBatchFolder: (name, path) =>
    set((state) => {
      const filtered = state.batchFolders.filter((f) => f.name !== name);
      return { batchFolders: [...filtered, { name, path }] };
    }),
  clearBatchFolders: () => set({ batchFolders: [] }),

  // モード
  setMode: (mode) =>
    set((state) => ({
      settings: { ...state.settings, mode },
    })),

  // テキスト設定
  setTextSubMode: (subMode) =>
    set((state) => ({
      settings: {
        ...state.settings,
        textSettings: { ...state.settings.textSettings, subMode },
      },
    })),
  setTextGroupName: (name) =>
    set((state) => ({
      settings: {
        ...state.settings,
        textSettings: { ...state.settings.textSettings, groupName: name },
      },
    })),
  setTextPartialMatch: (value) =>
    set((state) => ({
      settings: {
        ...state.settings,
        textSettings: { ...state.settings.textSettings, partialMatch: value },
      },
    })),

  // 画像設定
  setImageSettings: (newSettings) =>
    set((state) => ({
      settings: {
        ...state.settings,
        imageSettings: { ...state.settings.imageSettings, ...newSettings },
      },
    })),

  // スイッチ設定
  setSwitchSettings: (newSettings) =>
    set((state) => ({
      settings: {
        ...state.settings,
        switchSettings: { ...state.settings.switchSettings, ...newSettings },
      },
    })),
  setSwitchSubMode: (subMode) =>
    set((state) => ({
      settings: {
        ...state.settings,
        switchSettings: { ...state.settings.switchSettings, subMode },
      },
    })),

  // ペアリング設定
  setPairingMode: (mode) =>
    set((state) => ({
      settings: {
        ...state.settings,
        pairingSettings: { ...state.settings.pairingSettings, mode },
      },
    })),
  setLinkCharacter: (char) =>
    set((state) => ({
      settings: {
        ...state.settings,
        pairingSettings: {
          ...state.settings.pairingSettings,
          linkCharacter: char,
        },
      },
    })),

  // 全般設定
  setGeneralSettings: (newSettings) =>
    set((state) => ({
      settings: {
        ...state.settings,
        generalSettings: { ...state.settings.generalSettings, ...newSettings },
      },
    })),

  // サブフォルダ設定
  setSubfolderMode: (mode) =>
    set((state) => ({
      settings: {
        ...state.settings,
        subfolderSettings: { mode },
      },
    })),

  // 合成設定
  setComposeSettings: (newSettings) =>
    set((state) => ({
      settings: {
        ...state.settings,
        composeSettings: { ...state.settings.composeSettings, ...newSettings },
      },
    })),
  setComposeElementSource: (elementId, source) =>
    set((state) => ({
      settings: {
        ...state.settings,
        composeSettings: {
          ...state.settings.composeSettings,
          elements: state.settings.composeSettings.elements.map((el) =>
            el.id === elementId ? { ...el, source } : el,
          ),
        },
      },
    })),
  addComposeElement: (element) =>
    set((state) => ({
      settings: {
        ...state.settings,
        composeSettings: {
          ...state.settings.composeSettings,
          elements: [...state.settings.composeSettings.elements, element],
        },
      },
    })),
  removeComposeElement: (elementId) =>
    set((state) => ({
      settings: {
        ...state.settings,
        composeSettings: {
          ...state.settings.composeSettings,
          elements: state.settings.composeSettings.elements.filter((el) => el.id !== elementId),
        },
      },
    })),
  updateComposeElement: (elementId, updates) =>
    set((state) => ({
      settings: {
        ...state.settings,
        composeSettings: {
          ...state.settings.composeSettings,
          elements: state.settings.composeSettings.elements.map((el) =>
            el.id === elementId ? { ...el, ...updates } : el,
          ),
        },
      },
    })),
  setComposeRestSource: (source) =>
    set((state) => ({
      settings: {
        ...state.settings,
        composeSettings: {
          ...state.settings.composeSettings,
          restSource: source,
        },
      },
    })),

  // モーダル
  openModal: () => set({ isModalOpen: true }),
  closeModal: () => set({ isModalOpen: false }),

  // ペアリング
  setPairingJobs: (jobs) => set({ pairingJobs: jobs }),
  setDetectedLinkChar: (char) => set({ detectedLinkChar: char }),
  updatePairFile: (pairIndex, side, newFile, newName) =>
    set((state) => {
      const newJobs = state.pairingJobs.map((job) => ({
        ...job,
        pairs: job.pairs.map((p) => ({ ...p })),
      }));

      // 編集対象のペアを検索
      let editedPair: FilePair | undefined;
      for (const job of newJobs) {
        editedPair = job.pairs.find((p) => p.pairIndex === pairIndex);
        if (editedPair) break;
      }
      if (!editedPair) return {};

      const oldFile = side === "source" ? editedPair.sourceFile : editedPair.targetFile;
      const oldName = side === "source" ? editedPair.sourceName : editedPair.targetName;
      if (oldFile === newFile) return {};

      // 新ファイルが別のペアで使われている場合はスワップ
      for (const job of newJobs) {
        for (const p of job.pairs) {
          if (p.pairIndex !== pairIndex) {
            const otherFile = side === "source" ? p.sourceFile : p.targetFile;
            if (otherFile === newFile) {
              if (side === "source") {
                p.sourceFile = oldFile;
                p.sourceName = oldName;
              } else {
                p.targetFile = oldFile;
                p.targetName = oldName;
              }
              break;
            }
          }
        }
      }

      // 編集対象を更新
      if (side === "source") {
        editedPair.sourceFile = newFile;
        editedPair.sourceName = newName;
      } else {
        editedPair.targetFile = newFile;
        editedPair.targetName = newName;
      }

      return { pairingJobs: newJobs };
    }),
  addAutoPair: (sourceFile, targetFile) =>
    set((state) => {
      const newJobs = state.pairingJobs.map((job) => ({
        ...job,
        pairs: [...job.pairs],
      }));

      const maxIndex = newJobs
        .flatMap((j) => j.pairs)
        .reduce((max, p) => Math.max(max, p.pairIndex), -1);

      const getName = (path: string) => path.split(/[\\/]/).pop() || "";

      const newPair: FilePair = {
        sourceFile,
        sourceName: getName(sourceFile),
        targetFile,
        targetName: getName(targetFile),
        pairIndex: maxIndex + 1,
      };

      // ファイルが属するグループに対応するジョブに追加
      let targetJobIdx = 0;
      for (let i = 0; i < state.scannedFileGroups.length; i++) {
        const g = state.scannedFileGroups[i];
        if (g.sourceFiles.includes(sourceFile) || g.targetFiles.includes(targetFile)) {
          targetJobIdx = i;
          break;
        }
      }

      if (newJobs[targetJobIdx]) {
        newJobs[targetJobIdx].pairs.push(newPair);
      } else if (newJobs.length > 0) {
        newJobs[0].pairs.push(newPair);
      }

      return { pairingJobs: newJobs };
    }),
  removeAutoPair: (pairIndex) =>
    set((state) => {
      const newJobs = state.pairingJobs.map((job) => ({
        ...job,
        pairs: job.pairs.filter((p) => p.pairIndex !== pairIndex),
      }));
      // excludedからも除去
      const next = new Set(state.excludedPairIndices);
      next.delete(pairIndex);
      return { pairingJobs: newJobs, excludedPairIndices: next };
    }),

  // 手動マッチ/ダイアログ拡張
  setScannedFileGroups: (groups) => set({ scannedFileGroups: groups }),
  setPairingDialogMode: (mode) => set({ pairingDialogMode: mode }),
  toggleExcludedPair: (index) =>
    set((state) => {
      const next = new Set(state.excludedPairIndices);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return { excludedPairIndices: next };
    }),
  setManualPairs: (pairs) => set({ manualPairs: pairs }),
  addManualPair: (pair) => set((state) => ({ manualPairs: [...state.manualPairs, pair] })),
  removeManualPair: (pairIndex) =>
    set((state) => ({
      manualPairs: state.manualPairs.filter((p) => p.pairIndex !== pairIndex),
    })),

  // 処理
  setPhase: (phase) => set({ phase }),
  setProgress: (current, total) => set({ progress: current, totalPairs: total }),
  setCurrentPair: (name) => set({ currentPair: name }),
  addResult: (result) => set((state) => ({ results: [...state.results, result] })),
  clearResults: () => set({ results: [] }),
  reset: () =>
    set({
      phase: "idle",
      progress: 0,
      totalPairs: 0,
      currentPair: null,
      results: [],
      pairingJobs: [],
      detectedLinkChar: null,
      scannedFileGroups: [],
      pairingDialogMode: "auto",
      excludedPairIndices: new Set(),
      manualPairs: [],
    }),
}));
