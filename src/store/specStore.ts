import { create } from "zustand";
import type { Specification, SpecCheckResult } from "../types";

// Default specifications based on user requirements
const DEFAULT_SPECIFICATIONS: Specification[] = [
  {
    id: "mono-spec",
    name: "モノクロ原稿",
    enabled: true,
    rules: [
      {
        type: "colorMode",
        operator: "equals",
        value: "Grayscale",
        message: "カラーモードがグレースケールではありません",
      },
      {
        type: "dpi",
        operator: "equals",
        value: 600,
        message: "解像度が600dpiではありません",
      },
      {
        type: "bitsPerChannel",
        operator: "equals",
        value: 8,
        message: "ビット深度が8bitではありません",
      },
      {
        type: "hasAlphaChannels",
        operator: "equals",
        value: false,
        message: "不要なαチャンネルがあります",
      },
    ],
  },
  {
    id: "color-spec",
    name: "カラー原稿",
    enabled: true,
    rules: [
      {
        type: "colorMode",
        operator: "equals",
        value: "RGB",
        message: "カラーモードがRGBではありません",
      },
      {
        type: "dpi",
        operator: "equals",
        value: 350,
        message: "解像度が350dpiではありません",
      },
      {
        type: "bitsPerChannel",
        operator: "equals",
        value: 8,
        message: "ビット深度が8bitではありません",
      },
      {
        type: "hasAlphaChannels",
        operator: "equals",
        value: false,
        message: "不要なαチャンネルがあります",
      },
    ],
  },
];

// 変換設定
export interface ConversionSettings {
  targetColorMode: "RGB" | "Grayscale" | null;
  targetDpi: number | null;
  targetBitDepth: 8 | 16 | null;
  removeHiddenLayers: boolean;
}

// 変換結果
export interface ConversionResult {
  fileId: string;
  fileName: string;
  success: boolean;
  changes: string[];
  error?: string;
}

interface SpecStore {
  specifications: Specification[];
  checkResults: Map<string, SpecCheckResult>;
  activeSpecId: string | null;

  // 自動チェック関連
  autoCheckEnabled: boolean;
  lastSelectedSpecId: string | null;
  showSpecSelectionModal: boolean;
  pendingFilesCount: number; // モーダル表示時の読み込み待ちファイル数

  // 変換関連
  conversionSettings: ConversionSettings;
  isConverting: boolean;
  conversionResults: ConversionResult[];

  // Actions
  setSpecifications: (specs: Specification[]) => void;
  addSpecification: (spec: Specification) => void;
  updateSpecification: (id: string, updates: Partial<Specification>) => void;
  removeSpecification: (id: string) => void;
  toggleSpecification: (id: string) => void;
  setActiveSpec: (id: string | null) => void;

  // 自動チェック関連
  setAutoCheckEnabled: (enabled: boolean) => void;
  setLastSelectedSpecId: (specId: string | null) => void;
  openSpecSelectionModal: (pendingFilesCount: number) => void;
  closeSpecSelectionModal: () => void;
  selectSpecAndCheck: (specId: string) => void;

  // Check results
  setCheckResult: (fileId: string, result: SpecCheckResult) => void;
  clearCheckResults: () => void;
  getCheckResult: (fileId: string) => SpecCheckResult | undefined;

  // 変換関連
  setConversionSettings: (settings: Partial<ConversionSettings>) => void;
  setIsConverting: (converting: boolean) => void;
  addConversionResult: (result: ConversionResult) => void;
  clearConversionResults: () => void;
}

const DEFAULT_CONVERSION_SETTINGS: ConversionSettings = {
  targetColorMode: null,
  targetDpi: null,
  targetBitDepth: null,
  removeHiddenLayers: false,
};

// localStorage から前回選択を復元
const getStoredLastSpecId = (): string | null => {
  if (typeof window !== "undefined") {
    return localStorage.getItem("lastSelectedSpecId");
  }
  return null;
};

const getStoredAutoCheckEnabled = (): boolean => {
  if (typeof window !== "undefined") {
    return localStorage.getItem("autoCheckEnabled") === "true";
  }
  return false;
};

export const useSpecStore = create<SpecStore>((set, get) => ({
  specifications: DEFAULT_SPECIFICATIONS,
  checkResults: new Map(),
  activeSpecId: null,

  // 自動チェック関連
  autoCheckEnabled: getStoredAutoCheckEnabled(),
  lastSelectedSpecId: getStoredLastSpecId(),
  showSpecSelectionModal: false,
  pendingFilesCount: 0,

  conversionSettings: DEFAULT_CONVERSION_SETTINGS,
  isConverting: false,
  conversionResults: [],

  setSpecifications: (specifications) => set({ specifications }),

  addSpecification: (spec) =>
    set((state) => ({
      specifications: [...state.specifications, spec],
    })),

  updateSpecification: (id, updates) =>
    set((state) => ({
      specifications: state.specifications.map((s) => (s.id === id ? { ...s, ...updates } : s)),
    })),

  removeSpecification: (id) =>
    set((state) => ({
      specifications: state.specifications.filter((s) => s.id !== id),
      activeSpecId: state.activeSpecId === id ? null : state.activeSpecId,
    })),

  toggleSpecification: (id) =>
    set((state) => ({
      specifications: state.specifications.map((s) =>
        s.id === id ? { ...s, enabled: !s.enabled } : s,
      ),
    })),

  setActiveSpec: (activeSpecId) => set({ activeSpecId }),

  // 自動チェック関連
  setAutoCheckEnabled: (enabled) => {
    if (typeof window !== "undefined") {
      localStorage.setItem("autoCheckEnabled", String(enabled));
    }
    set({ autoCheckEnabled: enabled });
  },

  setLastSelectedSpecId: (specId) => {
    if (typeof window !== "undefined") {
      if (specId) {
        localStorage.setItem("lastSelectedSpecId", specId);
      } else {
        localStorage.removeItem("lastSelectedSpecId");
      }
    }
    set({ lastSelectedSpecId: specId });
  },

  openSpecSelectionModal: (pendingFilesCount) =>
    set({ showSpecSelectionModal: true, pendingFilesCount }),

  closeSpecSelectionModal: () => set({ showSpecSelectionModal: false, pendingFilesCount: 0 }),

  selectSpecAndCheck: (specId) => {
    const { specifications, setLastSelectedSpecId } = get();
    // 選択した仕様のみを有効化、他は無効化
    const updatedSpecs = specifications.map((s) => ({
      ...s,
      enabled: s.id === specId,
    }));
    setLastSelectedSpecId(specId);
    set({
      specifications: updatedSpecs,
      activeSpecId: specId,
      showSpecSelectionModal: false,
      pendingFilesCount: 0,
    });
  },

  setCheckResult: (fileId, result) =>
    set((state) => {
      const newResults = new Map(state.checkResults);
      newResults.set(fileId, result);
      return { checkResults: newResults };
    }),

  clearCheckResults: () => set({ checkResults: new Map() }),

  getCheckResult: (fileId) => get().checkResults.get(fileId),

  // 変換関連
  setConversionSettings: (settings) =>
    set((state) => ({
      conversionSettings: { ...state.conversionSettings, ...settings },
    })),

  setIsConverting: (isConverting) => set({ isConverting }),

  addConversionResult: (result) =>
    set((state) => ({
      conversionResults: [...state.conversionResults, result],
    })),

  clearConversionResults: () => set({ conversionResults: [] }),
}));
