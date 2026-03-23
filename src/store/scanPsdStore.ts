import { create } from "zustand";
import type {
  ScanPsdMode,
  ScanPsdTab,
  ScanData,
  ScanWorkInfo,
  ScanSizeStats,
  FontPreset,
  RubyEntry,
  SelectionRange,
  PresetJsonData,
} from "../types/scanPsd";
import { DEFAULT_WORK_INFO, normalizeRubyEntries } from "../types/scanPsd";

// --- デフォルトパス ---
const DEFAULT_JSON_FOLDER_PATH =
  "G:/共有ドライブ/CLLENN/編集部フォルダ/編集企画部/編集企画_C班(AT業務推進)/DTP制作部/JSONフォルダ";
const DEFAULT_SAVE_DATA_BASE_PATH =
  "G:/共有ドライブ/CLLENN/編集部フォルダ/編集企画部/編集企画_C班(AT業務推進)/DTP制作部/作品情報";
const DEFAULT_TEXT_LOG_FOLDER_PATH =
  "G:/共有ドライブ/CLLENN/編集部フォルダ/編集企画部/写植・校正用テキストログ/テキスト抽出";

function loadPath(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function savePath(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export interface ScanPsdState {
  // モード・ナビ
  mode: ScanPsdMode | null;
  activeTab: ScanPsdTab;

  // スキャン設定
  folders: { path: string; name: string; volume: number }[];

  // スキャン結果
  scanData: ScanData | null;

  // プリセット（ユーザー編集可能）
  presetSets: Record<string, FontPreset[]>;
  currentSetName: string;

  // 作品情報（ユーザー編集可能）
  workInfo: ScanWorkInfo;

  // ガイド状態
  selectedGuideIndex: number | null;
  excludedGuideIndices: Set<number>;

  // ルビリスト
  rubyList: RubyEntry[];
  rubySortMode: "order" | "ruby" | "parent" | "volumePage";

  // TIPPY範囲選択
  selectionRanges: SelectionRange[];
  lastUsedLabel: string | null;

  // 共有ドライブパス
  jsonFolderPath: string;
  saveDataBasePath: string;
  textLogFolderPath: string;

  // 現在のファイル参照
  currentJsonFilePath: string | null;
  currentScandataFilePath: string | null;

  // 仮保存ファイル（タイトル/レーベル未入力時）
  tempJsonFilePath: string | null;
  tempScandataFilePath: string | null;
  pendingTitleLabel: boolean;

  // 処理状態
  phase: "idle" | "scanning" | "saving" | "exporting";
  progress: { current: number; total: number; message: string };

  // Actions - モード・ナビ
  setMode: (mode: ScanPsdMode | null) => void;
  setActiveTab: (tab: ScanPsdTab) => void;

  // Actions - フォルダ
  addFolder: (path: string, name: string, volume: number) => void;
  removeFolder: (index: number) => void;
  updateFolderVolume: (index: number, volume: number) => void;
  clearFolders: () => void;

  // Actions - スキャン結果
  setScanData: (data: ScanData | null) => void;

  // Actions - 作品情報
  setWorkInfo: (partial: Partial<ScanWorkInfo>) => void;

  // Actions - プリセット
  setPresetSets: (sets: Record<string, FontPreset[]>) => void;
  setCurrentSetName: (name: string) => void;
  addPresetSet: (name: string) => void;
  removePresetSet: (name: string) => void;
  renamePresetSet: (oldName: string, newName: string) => void;
  addFontToPreset: (setName: string, entry: FontPreset) => void;
  removeFontFromPreset: (setName: string, index: number) => void;
  updateFontInPreset: (setName: string, index: number, partial: Partial<FontPreset>) => void;

  // Actions - ガイド
  setSelectedGuideIndex: (index: number | null) => void;
  toggleExcludedGuide: (index: number) => void;
  setExcludedGuideIndices: (indices: Set<number>) => void;

  // Actions - ルビ
  setRubyList: (list: RubyEntry[]) => void;
  addRuby: (entry: RubyEntry) => void;
  removeRuby: (id: string) => void;
  updateRuby: (id: string, partial: Partial<RubyEntry>) => void;
  setRubySortMode: (mode: "order" | "ruby" | "parent" | "volumePage") => void;

  // Actions - TIPPY範囲選択
  setSelectionRanges: (ranges: SelectionRange[]) => void;
  setLastUsedLabel: (label: string | null) => void;

  // Actions - サイズ統計編集
  updateSizeStats: (partial: Partial<ScanSizeStats>) => void;

  // Actions - パス
  setJsonFolderPath: (path: string) => void;
  setSaveDataBasePath: (path: string) => void;
  setTextLogFolderPath: (path: string) => void;

  // Actions - ファイル参照
  setCurrentJsonFilePath: (path: string | null) => void;
  setCurrentScandataFilePath: (path: string | null) => void;
  setTempJsonFilePath: (path: string | null) => void;
  setTempScandataFilePath: (path: string | null) => void;
  setPendingTitleLabel: (pending: boolean) => void;

  // Actions - 処理状態
  setPhase: (phase: "idle" | "scanning" | "saving" | "exporting") => void;
  setProgress: (current: number, total: number, message: string) => void;

  // Actions - データロード
  loadFromPresetJson: (data: PresetJsonData) => void;
  loadFromScandata: (data: ScanData) => void;

  // Actions - リセット
  reset: () => void;
}

export const useScanPsdStore = create<ScanPsdState>((set) => ({
  // 初期値
  mode: null,
  activeTab: 0,
  folders: [],
  scanData: null,
  presetSets: { デフォルト: [] },
  currentSetName: "デフォルト",
  workInfo: { ...DEFAULT_WORK_INFO },
  selectedGuideIndex: null,
  excludedGuideIndices: new Set(),
  rubyList: [],
  rubySortMode: "volumePage",
  selectionRanges: [],
  lastUsedLabel: null,
  jsonFolderPath: loadPath("scanPsd_jsonFolderPath", DEFAULT_JSON_FOLDER_PATH),
  saveDataBasePath: loadPath("scanPsd_saveDataBasePath", DEFAULT_SAVE_DATA_BASE_PATH),
  textLogFolderPath: loadPath("scanPsd_textLogFolderPath", DEFAULT_TEXT_LOG_FOLDER_PATH),
  currentJsonFilePath: null,
  currentScandataFilePath: null,
  tempJsonFilePath: null,
  tempScandataFilePath: null,
  pendingTitleLabel: false,
  phase: "idle",
  progress: { current: 0, total: 0, message: "" },

  // モード・ナビ
  setMode: (mode) => set({ mode }),
  setActiveTab: (activeTab) => set({ activeTab }),

  // フォルダ
  addFolder: (path, name, volume) =>
    set((s) => ({ folders: [...s.folders, { path, name, volume }] })),
  removeFolder: (index) => set((s) => ({ folders: s.folders.filter((_, i) => i !== index) })),
  updateFolderVolume: (index, volume) =>
    set((s) => ({
      folders: s.folders.map((f, i) => (i === index ? { ...f, volume } : f)),
    })),
  clearFolders: () => set({ folders: [] }),

  // スキャン結果
  setScanData: (scanData) => set({ scanData }),

  // 作品情報
  setWorkInfo: (partial) => set((s) => ({ workInfo: { ...s.workInfo, ...partial } })),

  // プリセット
  setPresetSets: (presetSets) => set({ presetSets }),
  setCurrentSetName: (currentSetName) => set({ currentSetName }),
  addPresetSet: (name) => set((s) => ({ presetSets: { ...s.presetSets, [name]: [] } })),
  removePresetSet: (name) =>
    set((s) => {
      const next = { ...s.presetSets };
      delete next[name];
      const names = Object.keys(next);
      return {
        presetSets: next,
        currentSetName: names.length > 0 ? names[0] : "デフォルト",
      };
    }),
  renamePresetSet: (oldName, newName) =>
    set((s) => {
      const next = { ...s.presetSets };
      next[newName] = next[oldName] || [];
      delete next[oldName];
      return {
        presetSets: next,
        currentSetName: s.currentSetName === oldName ? newName : s.currentSetName,
      };
    }),
  addFontToPreset: (setName, entry) =>
    set((s) => ({
      presetSets: {
        ...s.presetSets,
        [setName]: [...(s.presetSets[setName] || []), entry],
      },
    })),
  removeFontFromPreset: (setName, index) =>
    set((s) => ({
      presetSets: {
        ...s.presetSets,
        [setName]: (s.presetSets[setName] || []).filter((_, i) => i !== index),
      },
    })),
  updateFontInPreset: (setName, index, partial) =>
    set((s) => ({
      presetSets: {
        ...s.presetSets,
        [setName]: (s.presetSets[setName] || []).map((f, i) =>
          i === index ? { ...f, ...partial } : f,
        ),
      },
    })),

  // ガイド
  setSelectedGuideIndex: (selectedGuideIndex) => set({ selectedGuideIndex }),
  toggleExcludedGuide: (index) =>
    set((s) => {
      const next = new Set(s.excludedGuideIndices);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return { excludedGuideIndices: next };
    }),
  setExcludedGuideIndices: (indices) => set({ excludedGuideIndices: indices }),

  // ルビ
  setRubyList: (rubyList) => set({ rubyList }),
  addRuby: (entry) => set((s) => ({ rubyList: [...s.rubyList, entry] })),
  removeRuby: (id) => set((s) => ({ rubyList: s.rubyList.filter((r) => r.id !== id) })),
  updateRuby: (id, partial) =>
    set((s) => ({
      rubyList: s.rubyList.map((r) => (r.id === id ? { ...r, ...partial } : r)),
    })),
  setRubySortMode: (rubySortMode) => set({ rubySortMode }),

  // TIPPY範囲選択
  setSelectionRanges: (selectionRanges) => set({ selectionRanges }),
  setLastUsedLabel: (lastUsedLabel) => set({ lastUsedLabel }),

  // サイズ統計編集
  updateSizeStats: (partial) =>
    set((s) => {
      if (!s.scanData) return {};
      const newStats = { ...s.scanData.sizeStats, ...partial };
      return { scanData: { ...s.scanData, sizeStats: newStats } };
    }),

  // パス
  setJsonFolderPath: (path) => {
    savePath("scanPsd_jsonFolderPath", path);
    set({ jsonFolderPath: path });
  },
  setSaveDataBasePath: (path) => {
    savePath("scanPsd_saveDataBasePath", path);
    set({ saveDataBasePath: path });
  },
  setTextLogFolderPath: (path) => {
    savePath("scanPsd_textLogFolderPath", path);
    set({ textLogFolderPath: path });
  },

  // ファイル参照
  setCurrentJsonFilePath: (currentJsonFilePath) => set({ currentJsonFilePath }),
  setCurrentScandataFilePath: (currentScandataFilePath) => set({ currentScandataFilePath }),
  setTempJsonFilePath: (tempJsonFilePath) => set({ tempJsonFilePath }),
  setTempScandataFilePath: (tempScandataFilePath) => set({ tempScandataFilePath }),
  setPendingTitleLabel: (pendingTitleLabel) => set({ pendingTitleLabel }),

  // 処理状態
  setPhase: (phase) => set({ phase }),
  setProgress: (current, total, message) => set({ progress: { current, total, message } }),

  // データロード
  loadFromPresetJson: (data) =>
    set((s) => {
      const pd = data.presetData || {};
      // je-nsonman互換: parent/ruby → parentText/rubyText, volume文字列→数値
      const rawRuby = pd.rubyList as unknown[] | undefined;
      const normalizedRuby =
        rawRuby && rawRuby.length > 0 ? normalizeRubyEntries(rawRuby) : undefined;
      return {
        workInfo: pd.workInfo ? { ...DEFAULT_WORK_INFO, ...pd.workInfo } : s.workInfo,
        presetSets: pd.presets && Object.keys(pd.presets).length > 0 ? pd.presets : s.presetSets,
        selectedGuideIndex: pd.selectedGuideSetIndex ?? s.selectedGuideIndex,
        excludedGuideIndices: pd.excludedGuideIndices
          ? new Set(pd.excludedGuideIndices)
          : s.excludedGuideIndices,
        rubyList: normalizedRuby ?? s.rubyList,
        selectionRanges: pd.selectionRanges ?? s.selectionRanges,
      };
    }),

  loadFromScandata: (data) =>
    set((s) => {
      const ext = data as unknown as {
        presets?: Record<string, FontPreset[]>;
        selectedGuideSetIndex?: number;
        excludedGuideIndices?: number[];
      };
      // je-nsonman互換: parent/ruby → parentText/rubyText, volume文字列→数値
      const rawRuby = data.editedRubyList as unknown[] | undefined;
      const normalizedRuby =
        rawRuby && rawRuby.length > 0 ? normalizeRubyEntries(rawRuby) : undefined;
      return {
        scanData: data,
        workInfo: data.workInfo ? { ...DEFAULT_WORK_INFO, ...data.workInfo } : s.workInfo,
        presetSets: ext.presets && Object.keys(ext.presets).length > 0 ? ext.presets : s.presetSets,
        rubyList: normalizedRuby ?? s.rubyList,
        selectedGuideIndex: ext.selectedGuideSetIndex ?? s.selectedGuideIndex,
        excludedGuideIndices: ext.excludedGuideIndices
          ? new Set(ext.excludedGuideIndices)
          : s.excludedGuideIndices,
      };
    }),

  // リセット
  reset: () =>
    set({
      mode: null,
      activeTab: 0,
      folders: [],
      scanData: null,
      presetSets: { デフォルト: [] },
      currentSetName: "デフォルト",
      workInfo: { ...DEFAULT_WORK_INFO },
      selectedGuideIndex: null,
      excludedGuideIndices: new Set(),
      rubyList: [],
      rubySortMode: "volumePage",
      selectionRanges: [],
      lastUsedLabel: null,
      currentJsonFilePath: null,
      currentScandataFilePath: null,
      tempJsonFilePath: null,
      tempScandataFilePath: null,
      pendingTitleLabel: false,
      phase: "idle",
      progress: { current: 0, total: 0, message: "" },
    }),
}));
