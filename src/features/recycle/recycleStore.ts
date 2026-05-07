import { create } from "zustand";
import {
  type RecycleScanFile,
  type RecycleSettings,
  type RecyclePerFileOverride,
  type RecycleStatus,
  type RecycleResult,
  createDefaultSettings,
} from "./recycleTypes";

export type RecyclePhase =
  | "idle"
  | "scanning"
  | "ready"
  | "submitting"
  | "running"
  | "completed"
  | "error";

interface RecycleState {
  // ファイル選択・スキャン
  folderPath: string | null;
  scanFiles: RecycleScanFile[];
  scanInProgress: boolean;

  // 設定
  settings: RecycleSettings;

  // 個別変更予約
  perFileOverrides: RecyclePerFileOverride[];

  // 保存方法
  saveMode: "separate" | "overwrite";

  // 実行状態
  phase: RecyclePhase;
  currentJobId: string | null;
  status: RecycleStatus | null;
  result: RecycleResult | null;
  errorMessage: string | null;

  // フィルタ（リスト表示用）
  filterFont: string;
  filterSize: "" | "small" | "medium" | "large" | "xlarge";
  filterStroke: "" | "yes" | "no";

  // 選択中のレイヤー（個別変更予約UIで参照）
  selectedLayerKey: string | null; // "filePath|layerId" 形式

  // Actions
  setFolderPath: (path: string | null) => void;
  setScanFiles: (files: RecycleScanFile[]) => void;
  setScanInProgress: (inProgress: boolean) => void;
  updateSettings: (updater: (s: RecycleSettings) => RecycleSettings) => void;
  resetSettings: () => void;
  addPerFileOverride: (override: RecyclePerFileOverride) => void;
  removePerFileOverride: (filePath: string, layerId: number) => void;
  clearPerFileOverrides: () => void;
  setSaveMode: (mode: "separate" | "overwrite") => void;
  setPhase: (phase: RecyclePhase) => void;
  setCurrentJobId: (id: string | null) => void;
  setStatus: (status: RecycleStatus | null) => void;
  setResult: (result: RecycleResult | null) => void;
  setErrorMessage: (msg: string | null) => void;
  setFilterFont: (font: string) => void;
  setFilterSize: (size: RecycleState["filterSize"]) => void;
  setFilterStroke: (stroke: RecycleState["filterStroke"]) => void;
  setSelectedLayerKey: (key: string | null) => void;
  resetExecutionState: () => void;
}

export const useRecycleStore = create<RecycleState>((set) => ({
  folderPath: null,
  scanFiles: [],
  scanInProgress: false,
  settings: createDefaultSettings(),
  perFileOverrides: [],
  saveMode: "separate",
  phase: "idle",
  currentJobId: null,
  status: null,
  result: null,
  errorMessage: null,
  filterFont: "",
  filterSize: "",
  filterStroke: "",
  selectedLayerKey: null,

  setFolderPath: (folderPath) => set({ folderPath }),
  setScanFiles: (scanFiles) => set({ scanFiles }),
  setScanInProgress: (scanInProgress) => set({ scanInProgress }),

  updateSettings: (updater) => set((state) => ({ settings: updater(state.settings) })),
  resetSettings: () => set({ settings: createDefaultSettings() }),

  addPerFileOverride: (override) =>
    set((state) => {
      const filtered = state.perFileOverrides.filter(
        (o) => !(o.filePath === override.filePath && o.layerId === override.layerId),
      );
      return { perFileOverrides: [...filtered, override] };
    }),
  removePerFileOverride: (filePath, layerId) =>
    set((state) => ({
      perFileOverrides: state.perFileOverrides.filter(
        (o) => !(o.filePath === filePath && o.layerId === layerId),
      ),
    })),
  clearPerFileOverrides: () => set({ perFileOverrides: [] }),

  setSaveMode: (saveMode) => set({ saveMode }),
  setPhase: (phase) => set({ phase }),
  setCurrentJobId: (currentJobId) => set({ currentJobId }),
  setStatus: (status) => set({ status }),
  setResult: (result) => set({ result }),
  setErrorMessage: (errorMessage) => set({ errorMessage }),

  setFilterFont: (filterFont) => set({ filterFont }),
  setFilterSize: (filterSize) => set({ filterSize }),
  setFilterStroke: (filterStroke) => set({ filterStroke }),
  setSelectedLayerKey: (selectedLayerKey) => set({ selectedLayerKey }),

  resetExecutionState: () =>
    set({
      phase: "idle",
      currentJobId: null,
      status: null,
      result: null,
      errorMessage: null,
    }),
}));
