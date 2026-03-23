import { create } from "zustand";
import type {
  TiffSettings,
  TiffFileOverride,
  TiffCropPreset,
  TiffCropBounds,
  TiffCropGuide,
  TiffCropStep,
  TiffCropMethod,
  TiffResult,
  TiffPhase,
  PageRangeRule,
  PartialBlurEntry,
} from "../types/tiff";
import { DEFAULT_TIFF_SETTINGS as defaults } from "../types/tiff";

// localStorage キー
const LS_KEY_PRESETS = "tiff_cropPresets";
const LS_KEY_SETTINGS = "tiff_lastSettings";
function loadCropPresetsFromStorage(): TiffCropPreset[] {
  try {
    const raw = localStorage.getItem(LS_KEY_PRESETS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCropPresetsToStorage(presets: TiffCropPreset[]) {
  try {
    localStorage.setItem(LS_KEY_PRESETS, JSON.stringify(presets));
  } catch {
    /* ignore */
  }
}

function loadSettingsFromStorage(): Partial<TiffSettings> {
  try {
    const raw = localStorage.getItem(LS_KEY_SETTINGS);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveSettingsToStorage(settings: TiffSettings) {
  try {
    // クロップ範囲はファイル依存なので永続化しない
    const toSave = { ...settings, crop: { ...settings.crop, bounds: null } };
    localStorage.setItem(LS_KEY_SETTINGS, JSON.stringify(toSave));
  } catch {
    /* ignore */
  }
}

/** JSON自動登録の結果 */
export interface AutoScanJsonResult {
  success: boolean;
  filePath?: string;
  scandataPath?: string;
  error?: string;
  fontCount?: number;
  guideSetCount?: number;
  textLogSaved?: boolean;
}

interface TiffState {
  // --- 設定 ---
  settings: TiffSettings;
  fileOverrides: Map<string, TiffFileOverride>; // fileId → override
  cropPresets: TiffCropPreset[];
  resizeLocked: boolean; // リサイズフィールドのロック状態

  // --- JSON自動登録 ---
  autoScanEnabled: boolean;
  autoScanVolume: number;
  autoScanJsonResult: AutoScanJsonResult | null;
  cropSourceJsonPath: string | null; // クロップ範囲をどのJSONから読み込んだか
  registerSelectionRange: boolean; // 選択範囲をJSONに登録するか

  // --- 処理状態 ---
  phase: TiffPhase;
  isProcessing: boolean;
  progress: number;
  totalFiles: number;
  currentFile: string | null;
  results: TiffResult[];
  lastOutputDir: string | null;
  lastJpgOutputDir: string | null;
  processingDurationMs: number | null;
  showResultDialog: boolean;

  // --- 基準ファイル ---
  referenceFileIndex: number; // ファイルリスト内のインデックス（1-based）
  referenceImageSize: { width: number; height: number } | null; // 基準画像の実サイズ

  // --- クロップエディタ拡張 ---
  cropGuides: TiffCropGuide[];
  selectedCropGuideIndex: number | null;
  cropStep: TiffCropStep;
  cropMethod: TiffCropMethod;
  cropHistory: (TiffCropBounds | null)[];
  cropFuture: (TiffCropBounds | null)[];
  // --- アクション: 設定 ---
  setSettings: (partial: Partial<TiffSettings>) => void;
  resetSettings: () => void;

  // --- アクション: ページ範囲ルール ---
  addPageRangeRule: () => void;
  updatePageRangeRule: (id: string, partial: Partial<PageRangeRule>) => void;
  removePageRangeRule: (id: string) => void;

  // --- アクション: 部分ぼかし ---
  setPartialBlurEntries: (entries: PartialBlurEntry[]) => void;

  // --- アクション: クロップ範囲 ---
  setCropBounds: (bounds: TiffCropBounds | null) => void;

  // --- アクション: ファイル別上書き ---
  setFileOverride: (fileId: string, override: Partial<TiffFileOverride>) => void;
  removeFileOverride: (fileId: string) => void;
  toggleFileSkip: (fileId: string) => void;
  clearAllOverrides: () => void;

  // --- アクション: クロッププリセット ---
  addCropPreset: (preset: TiffCropPreset) => void;
  removeCropPreset: (label: string) => void;
  loadCropPreset: (preset: TiffCropPreset) => void;

  // --- アクション: クロップガイド ---
  addCropGuide: (guide: TiffCropGuide) => void;
  updateCropGuide: (index: number, guide: TiffCropGuide) => void;
  removeCropGuide: (index: number) => void;
  clearCropGuides: () => void;
  setSelectedCropGuideIndex: (index: number | null) => void;
  applyCropGuidesToBounds: () => void;

  // --- アクション: クロップエディタ状態 ---
  setCropStep: (step: TiffCropStep) => void;
  setCropMethod: (method: TiffCropMethod) => void;
  pushCropHistory: () => void;
  undoCropBounds: () => void;
  redoCropBounds: () => void;
  resetCropEditor: () => void;

  // --- アクション: 処理 ---
  setPhase: (phase: TiffPhase) => void;
  setIsProcessing: (value: boolean) => void;
  setProgress: (current: number, total: number) => void;
  setCurrentFile: (fileName: string | null) => void;
  addResult: (result: TiffResult) => void;
  clearResults: () => void;
  setLastOutputDir: (dir: string | null) => void;
  setLastJpgOutputDir: (dir: string | null) => void;
  setProcessingDuration: (ms: number | null) => void;
  setShowResultDialog: (show: boolean) => void;
  setReferenceFileIndex: (index: number) => void;
  setReferenceImageSize: (size: { width: number; height: number } | null) => void;

  // --- アクション: JSON自動登録 ---
  setAutoScanEnabled: (enabled: boolean) => void;
  setAutoScanVolume: (volume: number) => void;
  setAutoScanJsonResult: (result: AutoScanJsonResult | null) => void;
  setCropSourceJsonPath: (path: string | null) => void;
  cropSourceDocumentSize: { width: number; height: number } | null;
  setCropSourceDocumentSize: (size: { width: number; height: number } | null) => void;
  setRegisterSelectionRange: (enabled: boolean) => void;
  setResizeLocked: (locked: boolean) => void;

  // --- アクション: ファイル別クロップ編集モード ---
  perFileEditTarget: string | null; // 個別クロップ編集中のfileId
  setPerFileEditTarget: (fileId: string | null) => void;

  reset: () => void;
  resetAfterConvert: () => void;
}

// 直近の設定を復元してデフォルトとマージ
const savedSettings = loadSettingsFromStorage();
const initialSettings: TiffSettings = { ...defaults, ...savedSettings };

export const useTiffStore = create<TiffState>((set) => ({
  settings: initialSettings,
  fileOverrides: new Map(),
  cropPresets: loadCropPresetsFromStorage(),

  resizeLocked: true,

  autoScanEnabled: false,
  autoScanVolume: 1,
  autoScanJsonResult: null,
  cropSourceJsonPath: null,
  cropSourceDocumentSize: null,
  registerSelectionRange: false,
  perFileEditTarget: null,

  phase: "idle",
  isProcessing: false,
  progress: 0,
  totalFiles: 0,
  currentFile: null,
  results: [],
  lastOutputDir: null,
  lastJpgOutputDir: null,
  processingDurationMs: null,
  showResultDialog: false,
  referenceFileIndex: 1,
  referenceImageSize: null,

  cropGuides: [],
  selectedCropGuideIndex: null,
  cropStep: "select",
  cropMethod: "drag",
  cropHistory: [],
  cropFuture: [],
  // --- 設定 ---
  setSettings: (partial) =>
    set((state) => {
      const newSettings = { ...state.settings, ...partial };
      saveSettingsToStorage(newSettings);
      return { settings: newSettings };
    }),

  resetSettings: () =>
    set(() => {
      saveSettingsToStorage(defaults);
      return { settings: { ...defaults } };
    }),

  // --- ページ範囲ルール ---
  addPageRangeRule: () =>
    set((state) => {
      if (state.settings.pageRangeRules.length >= 3) return state;
      const newRule: PageRangeRule = {
        id: crypto.randomUUID(),
        fromPage: 1,
        toPage: 1,
        colorMode: "color",
        applyBlur: false,
      };
      const newSettings = {
        ...state.settings,
        pageRangeRules: [...state.settings.pageRangeRules, newRule],
      };
      saveSettingsToStorage(newSettings);
      return { settings: newSettings };
    }),

  updatePageRangeRule: (id, partial) =>
    set((state) => {
      const newRules = state.settings.pageRangeRules.map((r) =>
        r.id === id ? { ...r, ...partial } : r,
      );
      const newSettings = { ...state.settings, pageRangeRules: newRules };
      saveSettingsToStorage(newSettings);
      return { settings: newSettings };
    }),

  removePageRangeRule: (id) =>
    set((state) => {
      const newRules = state.settings.pageRangeRules.filter((r) => r.id !== id);
      const newSettings = { ...state.settings, pageRangeRules: newRules };
      saveSettingsToStorage(newSettings);
      return { settings: newSettings };
    }),

  // --- 部分ぼかし ---
  setPartialBlurEntries: (entries) =>
    set((state) => {
      const newSettings = { ...state.settings, partialBlurEntries: entries };
      saveSettingsToStorage(newSettings);
      return { settings: newSettings };
    }),

  // --- クロップ範囲 ---
  setCropBounds: (bounds) =>
    set((state) => {
      const newSettings = {
        ...state.settings,
        crop: { ...state.settings.crop, bounds },
      };
      saveSettingsToStorage(newSettings);
      return { settings: newSettings };
    }),

  // --- ファイル別上書き ---
  setFileOverride: (fileId, partial) =>
    set((state) => {
      const newMap = new Map(state.fileOverrides);
      const existing = newMap.get(fileId) || { fileId, skip: false };
      const merged = { ...existing, ...partial };
      // undefinedのキーは削除してオーバーライドを解除できるようにする
      (Object.keys(merged) as (keyof typeof merged)[]).forEach((k) => {
        if (merged[k] === undefined) delete merged[k];
      });
      newMap.set(fileId, merged);
      return { fileOverrides: newMap };
    }),

  removeFileOverride: (fileId) =>
    set((state) => {
      const newMap = new Map(state.fileOverrides);
      newMap.delete(fileId);
      return { fileOverrides: newMap };
    }),

  toggleFileSkip: (fileId) =>
    set((state) => {
      const newMap = new Map(state.fileOverrides);
      const existing = newMap.get(fileId) || { fileId, skip: false };
      newMap.set(fileId, { ...existing, skip: !existing.skip });
      return { fileOverrides: newMap };
    }),

  clearAllOverrides: () => set({ fileOverrides: new Map() }),

  // --- クロッププリセット ---
  addCropPreset: (preset) =>
    set((state) => {
      const newPresets = [...state.cropPresets, preset];
      saveCropPresetsToStorage(newPresets);
      return { cropPresets: newPresets };
    }),

  removeCropPreset: (label) =>
    set((state) => {
      const newPresets = state.cropPresets.filter((p) => p.label !== label);
      saveCropPresetsToStorage(newPresets);
      return { cropPresets: newPresets };
    }),

  loadCropPreset: (preset) =>
    set((state) => {
      // boundsが全て0の場合はクロップ範囲を設定しない（JSONパス選択のみ）
      const hasValidBounds =
        preset.bounds &&
        (preset.bounds.left !== 0 ||
          preset.bounds.top !== 0 ||
          preset.bounds.right !== 0 ||
          preset.bounds.bottom !== 0);

      // blurRadius反映（参考スクリプト互換: JSON内のblurRadiusをぼかし設定に復元）
      const blurUpdate =
        preset.blurRadius !== undefined
          ? {
              blur: {
                enabled: preset.blurRadius > 0,
                radius: preset.blurRadius > 0 ? preset.blurRadius : state.settings.blur.radius,
              },
            }
          : {};

      const newSettings = {
        ...state.settings,
        ...blurUpdate,
        crop: {
          ...state.settings.crop,
          ...(hasValidBounds ? { bounds: preset.bounds, enabled: true } : {}),
        },
      };
      saveSettingsToStorage(newSettings);
      // JSONのdocumentSizeを保存（キャンバスサイズ比較用）
      const docSize =
        preset.documentSize && preset.documentSize.width > 0 ? preset.documentSize : null;
      return { settings: newSettings, cropSourceDocumentSize: docSize };
    }),

  // --- クロップガイド ---
  addCropGuide: (guide) => set((state) => ({ cropGuides: [...state.cropGuides, guide] })),

  updateCropGuide: (index, guide) =>
    set((state) => {
      const newGuides = [...state.cropGuides];
      newGuides[index] = guide;
      return { cropGuides: newGuides };
    }),

  removeCropGuide: (index) =>
    set((state) => {
      const newGuides = state.cropGuides.filter((_, i) => i !== index);
      const newSelected =
        state.selectedCropGuideIndex === index
          ? null
          : state.selectedCropGuideIndex !== null && state.selectedCropGuideIndex > index
            ? state.selectedCropGuideIndex - 1
            : state.selectedCropGuideIndex;
      return { cropGuides: newGuides, selectedCropGuideIndex: newSelected };
    }),

  clearCropGuides: () => set({ cropGuides: [], selectedCropGuideIndex: null }),

  setSelectedCropGuideIndex: (index) => set({ selectedCropGuideIndex: index }),

  applyCropGuidesToBounds: () =>
    set((state) => {
      const hGuides = state.cropGuides
        .filter((g) => g.direction === "horizontal")
        .map((g) => g.position)
        .sort((a, b) => a - b);
      const vGuides = state.cropGuides
        .filter((g) => g.direction === "vertical")
        .map((g) => g.position)
        .sort((a, b) => a - b);

      if (hGuides.length < 2 || vGuides.length < 2) return state;

      const bounds: TiffCropBounds = {
        left: Math.round(vGuides[0]),
        top: Math.round(hGuides[0]),
        right: Math.round(vGuides[vGuides.length - 1]),
        bottom: Math.round(hGuides[hGuides.length - 1]),
      };

      // Push current bounds to history before applying
      const history = [...state.cropHistory, state.settings.crop.bounds].slice(-20);

      const newSettings = {
        ...state.settings,
        crop: { ...state.settings.crop, bounds, enabled: true },
      };
      saveSettingsToStorage(newSettings);
      return {
        settings: newSettings,
        cropStep: "confirm" as TiffCropStep,
        cropHistory: history,
        cropFuture: [],
      };
    }),

  // --- クロップエディタ状態 ---
  setCropStep: (step) => set({ cropStep: step }),
  setCropMethod: (method) => set({ cropMethod: method }),

  pushCropHistory: () =>
    set((state) => ({
      cropHistory: [...state.cropHistory, state.settings.crop.bounds].slice(-20),
      cropFuture: [],
    })),

  undoCropBounds: () =>
    set((state) => {
      if (state.cropHistory.length === 0) return state;
      const history = [...state.cropHistory];
      const bounds = history.pop()!;
      const newSettings = {
        ...state.settings,
        crop: { ...state.settings.crop, bounds },
      };
      saveSettingsToStorage(newSettings);
      return {
        settings: newSettings,
        cropHistory: history,
        cropFuture: [...state.cropFuture, state.settings.crop.bounds],
      };
    }),

  redoCropBounds: () =>
    set((state) => {
      if (state.cropFuture.length === 0) return state;
      const future = [...state.cropFuture];
      const bounds = future.pop()!;
      const newSettings = {
        ...state.settings,
        crop: { ...state.settings.crop, bounds },
      };
      saveSettingsToStorage(newSettings);
      return {
        settings: newSettings,
        cropHistory: [...state.cropHistory, state.settings.crop.bounds],
        cropFuture: future,
      };
    }),

  resetCropEditor: () =>
    set({
      cropGuides: [],
      selectedCropGuideIndex: null,
      cropStep: "select",
      cropMethod: "drag",
      cropHistory: [],
      cropFuture: [],
    }),

  // --- 処理 ---
  setPhase: (phase) => set({ phase }),
  setIsProcessing: (value) => set({ isProcessing: value }),
  setProgress: (current, total) => set({ progress: current, totalFiles: total }),
  setCurrentFile: (fileName) => set({ currentFile: fileName }),

  addResult: (result) => set((state) => ({ results: [...state.results, result] })),

  clearResults: () => set({ results: [] }),
  setLastOutputDir: (dir) => set({ lastOutputDir: dir }),
  setLastJpgOutputDir: (dir) => set({ lastJpgOutputDir: dir }),
  setProcessingDuration: (ms) => set({ processingDurationMs: ms }),
  setShowResultDialog: (show) => set({ showResultDialog: show }),
  setReferenceFileIndex: (index) => set({ referenceFileIndex: index }),
  setReferenceImageSize: (size) => set({ referenceImageSize: size }),

  // --- JSON自動登録 ---
  setAutoScanEnabled: (enabled) => set({ autoScanEnabled: enabled }),
  setAutoScanVolume: (volume) => set({ autoScanVolume: volume }),
  setAutoScanJsonResult: (result) => set({ autoScanJsonResult: result }),
  setCropSourceJsonPath: (path) => set({ cropSourceJsonPath: path }),
  setCropSourceDocumentSize: (size) => set({ cropSourceDocumentSize: size }),
  setRegisterSelectionRange: (enabled) => set({ registerSelectionRange: enabled }),
  setResizeLocked: (locked) => set({ resizeLocked: locked }),
  setPerFileEditTarget: (fileId) => set({ perFileEditTarget: fileId }),

  reset: () =>
    set({
      isProcessing: false,
      progress: 0,
      totalFiles: 0,
      currentFile: null,
      results: [],
    }),

  resetAfterConvert: () =>
    set(() => {
      saveSettingsToStorage(defaults);
      return {
        settings: { ...defaults },
        fileOverrides: new Map(),
        cropSourceJsonPath: null,
        cropSourceDocumentSize: null,
        results: [],
        cropGuides: [],
        selectedCropGuideIndex: null,
        cropHistory: [],
        cropFuture: [],
        autoScanJsonResult: null,
        progress: 0,
        totalFiles: 0,
        currentFile: null,
        referenceFileIndex: 1,
        referenceImageSize: null,
        cropStep: "select",
        cropMethod: "drag",
      };
    }),
}));
