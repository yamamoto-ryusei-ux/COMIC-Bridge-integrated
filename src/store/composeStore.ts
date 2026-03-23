import { create } from "zustand";
import type {
  PairingMode,
  SubfolderMode,
  ProcessingPhase,
  PairingSettings,
  GeneralSettings,
  SubfolderSettings,
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

export interface OrganizePreSettings {
  enabled: boolean;
  targetName: string;
  includeSpecial: boolean;
}

interface ComposeState {
  folders: FolderSelection;
  composeSettings: ComposeSettings;
  organizePre: OrganizePreSettings;
  pairingSettings: PairingSettings;
  generalSettings: GeneralSettings;
  subfolderSettings: SubfolderSettings;

  isModalOpen: boolean;
  pairingJobs: PairingJob[];
  detectedLinkChar: string | null;
  scannedFileGroups: ScannedFileGroup[];
  pairingDialogMode: PairingDialogMode;
  excludedPairIndices: Set<number>;
  manualPairs: FilePair[];
  phase: ProcessingPhase;
  progress: number;
  totalPairs: number;
  currentPair: string | null;
  results: ReplaceResult[];

  // Actions - フォルダ
  setSourceFolder: (path: string | null, files?: string[] | null) => void;
  setTargetFolder: (path: string | null, files?: string[] | null) => void;

  // Actions - 前処理（フォルダ格納）
  setOrganizePre: (settings: Partial<OrganizePreSettings>) => void;

  // Actions - 合成設定
  setComposeSettings: (settings: Partial<ComposeSettings>) => void;
  setComposeElementSource: (elementId: string, source: ComposeSource) => void;
  addComposeElement: (element: ComposeElement) => void;
  removeComposeElement: (elementId: string) => void;
  updateComposeElement: (elementId: string, updates: Partial<ComposeElement>) => void;
  setComposeRestSource: (source: ComposeRestSource) => void;

  // Actions - ペアリング設定
  setPairingMode: (mode: PairingMode) => void;
  setLinkCharacter: (char: string) => void;
  setGeneralSettings: (settings: Partial<GeneralSettings>) => void;
  setSubfolderMode: (mode: SubfolderMode) => void;

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

  // Actions - 手動マッチ
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

const defaultComposeSettings: ComposeSettings = {
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
};

export const useComposeStore = create<ComposeState>((set) => ({
  folders: { sourceFolder: null, targetFolder: null, sourceFiles: null, targetFiles: null },
  composeSettings: defaultComposeSettings,
  organizePre: { enabled: false, targetName: "#原稿#", includeSpecial: false },
  pairingSettings: { mode: "fileOrder", linkCharacter: "" },
  generalSettings: {
    skipResize: false,
    roundFontSize: true,
    saveFileName: "target",
    outputFolderName: "",
  },
  subfolderSettings: { mode: "none" },

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

  // 前処理（フォルダ格納）
  setOrganizePre: (newSettings) =>
    set((state) => ({ organizePre: { ...state.organizePre, ...newSettings } })),

  // 合成設定
  setComposeSettings: (newSettings) =>
    set((state) => ({ composeSettings: { ...state.composeSettings, ...newSettings } })),
  setComposeElementSource: (elementId, source) =>
    set((state) => {
      let newElements = state.composeSettings.elements.map((el) =>
        el.id === elementId ? { ...el, source } : el,
      );
      // 背景 と #原稿# は排他（片方をA/Bにすると、もう片方は除外）
      if (source !== "exclude") {
        if (elementId === "background") {
          newElements = newElements.map((el) =>
            el.id === "manuscript" ? { ...el, source: "exclude" as ComposeSource } : el,
          );
        } else if (elementId === "manuscript") {
          newElements = newElements.map((el) =>
            el.id === "background" ? { ...el, source: "exclude" as ComposeSource } : el,
          );
        }
      }
      return {
        composeSettings: { ...state.composeSettings, elements: newElements },
      };
    }),
  addComposeElement: (element) =>
    set((state) => ({
      composeSettings: {
        ...state.composeSettings,
        elements: [...state.composeSettings.elements, element],
      },
    })),
  removeComposeElement: (elementId) =>
    set((state) => ({
      composeSettings: {
        ...state.composeSettings,
        elements: state.composeSettings.elements.filter((el) => el.id !== elementId),
      },
    })),
  updateComposeElement: (elementId, updates) =>
    set((state) => ({
      composeSettings: {
        ...state.composeSettings,
        elements: state.composeSettings.elements.map((el) =>
          el.id === elementId ? { ...el, ...updates } : el,
        ),
      },
    })),
  setComposeRestSource: (source) =>
    set((state) => ({
      composeSettings: { ...state.composeSettings, restSource: source },
    })),

  // ペアリング設定
  setPairingMode: (mode) =>
    set((state) => ({ pairingSettings: { ...state.pairingSettings, mode } })),
  setLinkCharacter: (char) =>
    set((state) => ({ pairingSettings: { ...state.pairingSettings, linkCharacter: char } })),
  setGeneralSettings: (newSettings) =>
    set((state) => ({ generalSettings: { ...state.generalSettings, ...newSettings } })),
  setSubfolderMode: (mode) => set({ subfolderSettings: { mode } }),

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
      let editedPair: FilePair | undefined;
      for (const job of newJobs) {
        editedPair = job.pairs.find((p) => p.pairIndex === pairIndex);
        if (editedPair) break;
      }
      if (!editedPair) return {};
      const oldFile = side === "source" ? editedPair.sourceFile : editedPair.targetFile;
      const oldName = side === "source" ? editedPair.sourceName : editedPair.targetName;
      if (oldFile === newFile) return {};
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
      const newJobs = state.pairingJobs.map((job) => ({ ...job, pairs: [...job.pairs] }));
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
      let targetJobIdx = 0;
      for (let i = 0; i < state.scannedFileGroups.length; i++) {
        const g = state.scannedFileGroups[i];
        if (g.sourceFiles.includes(sourceFile) || g.targetFiles.includes(targetFile)) {
          targetJobIdx = i;
          break;
        }
      }
      if (newJobs[targetJobIdx]) newJobs[targetJobIdx].pairs.push(newPair);
      else if (newJobs.length > 0) newJobs[0].pairs.push(newPair);
      return { pairingJobs: newJobs };
    }),
  removeAutoPair: (pairIndex) =>
    set((state) => {
      const newJobs = state.pairingJobs.map((job) => ({
        ...job,
        pairs: job.pairs.filter((p) => p.pairIndex !== pairIndex),
      }));
      const next = new Set(state.excludedPairIndices);
      next.delete(pairIndex);
      return { pairingJobs: newJobs, excludedPairIndices: next };
    }),

  // 手動マッチ
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
    set((state) => ({ manualPairs: state.manualPairs.filter((p) => p.pairIndex !== pairIndex) })),

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
