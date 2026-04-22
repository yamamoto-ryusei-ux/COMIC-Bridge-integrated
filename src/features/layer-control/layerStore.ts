import { create } from "zustand";

// 操作モード
export type LayerActionMode =
  | "hide"
  | "show"
  | "organize"
  | "layerMove"
  | "custom"
  | "lock"
  | "merge";

// カスタム操作の型
export interface CustomVisibilityOp {
  path: string[]; // ["GroupA", "SubGroup", "LayerName"]
  index: number; // 同名レイヤーの曖昧さ回避（同階層でのインデックス）
  action: "show" | "hide";
  layerId?: string; // レイヤーIDで追跡（移動後のパス再解決用）
}

export interface CustomMoveOp {
  sourcePath: string[];
  sourceIndex: number;
  targetPath: string[];
  targetIndex: number;
  placement: "before" | "after" | "inside";
}

// レイヤー非表示条件の型
export interface HideCondition {
  id: string;
  name: string;
  type: "textLayers" | "textFolder" | "layerName" | "folderName" | "custom";
  value?: string; // layerName, folderName, custom の場合の検索文字列
  partialMatch?: boolean; // 部分一致
  caseSensitive?: boolean; // 大文字小文字を区別
}

// プリセット条件
export const PRESET_CONDITIONS: HideCondition[] = [
  {
    id: "text-layers",
    name: "テキストレイヤー全て",
    type: "textLayers",
  },
  {
    id: "text-folder",
    name: "「Text」「写植」「セリフ」フォルダ",
    type: "textFolder",
  },
  {
    id: "kihonwaku",
    name: "「基本枠」レイヤー",
    type: "layerName",
    value: "基本枠",
    partialMatch: false,
  },
  {
    id: "shirokesu",
    name: "「白消し」レイヤー",
    type: "layerName",
    value: "白消し",
    partialMatch: true,
  },
];

// 処理結果（ファイルごと）
export interface LayerControlResult {
  fileName: string;
  success: boolean;
  changedCount: number;
  changes: string[]; // 個別マッチ詳細含む
  error?: string;
}

// 保存モード
export type LayerSaveMode = "overwrite" | "copyToFolder";

interface LayerVisibilityState {
  // ファイルごとの変更されたレイヤー可視性を追跡
  // Map<fileId, Map<layerPath, visible>>
  pendingChanges: Map<string, Map<string, boolean>>;

  // 操作モード（非表示/表示）
  actionMode: LayerActionMode;

  // 保存モード（上書き/別フォルダ）
  saveMode: LayerSaveMode;

  // 選択中の非表示条件
  selectedConditions: string[];

  // カスタム条件
  customConditions: HideCondition[];

  // フォルダ格納設定
  organizeTargetName: string;
  organizeIncludeSpecial: boolean;

  // レイヤー整理（条件ベース移動）設定
  layerMoveTargetName: string;
  layerMoveCreateIfMissing: boolean;
  layerMoveSearchScope: "all" | "group";
  layerMoveSearchGroupName: string;
  layerMoveCondTextLayer: boolean;
  layerMoveCondSubgroupTop: boolean;
  layerMoveCondSubgroupBottom: boolean;
  layerMoveCondNameEnabled: boolean;
  layerMoveCondName: string;
  layerMoveCondNamePartial: boolean;

  // 非表示テキストレイヤー削除オプション（hideモード専用）
  deleteHiddenText: boolean;

  // ロックモード設定
  lockBottomLayer: boolean;
  unlockAllLayers: boolean;

  // 統合モード設定
  mergeReorganizeText: boolean;
  mergeOutputFolderName: string;

  // カスタム操作（個別レイヤーの表示/非表示 + 移動）
  customVisibilityOps: Map<string, CustomVisibilityOp[]>; // fileId → ops
  customMoveOps: Map<string, CustomMoveOp[]>; // fileId → ops

  // 処理中フラグ
  isProcessing: boolean;

  // 処理結果
  lastResults: LayerControlResult[];
  lastActionMode: LayerActionMode | null;
  lastMergeOutputFolder: string | null;
  lastMergeSourceFolder: string | null;

  // アクション
  setLayerVisibility: (fileId: string, layerPath: string, visible: boolean) => void;
  clearPendingChanges: (fileId?: string) => void;
  setActionMode: (mode: LayerActionMode) => void;
  setSaveMode: (mode: LayerSaveMode) => void;
  toggleCondition: (conditionId: string) => void;
  addCustomCondition: (condition: Omit<HideCondition, "id">) => void;
  removeCustomCondition: (id: string) => void;
  setIsProcessing: (processing: boolean) => void;
  getSelectedConditions: () => HideCondition[];
  setLastResults: (
    results: LayerControlResult[],
    mode: LayerActionMode,
    mergeOutputFolder?: string,
    mergeSourceFolder?: string,
  ) => void;
  clearLastResults: () => void;
  setOrganizeTargetName: (name: string) => void;
  setOrganizeIncludeSpecial: (include: boolean) => void;
  setLayerMoveTargetName: (name: string) => void;
  setLayerMoveCreateIfMissing: (value: boolean) => void;
  setLayerMoveSearchScope: (scope: "all" | "group") => void;
  setLayerMoveSearchGroupName: (name: string) => void;
  setLayerMoveCondTextLayer: (value: boolean) => void;
  setLayerMoveCondSubgroupTop: (value: boolean) => void;
  setLayerMoveCondSubgroupBottom: (value: boolean) => void;
  setLayerMoveCondNameEnabled: (value: boolean) => void;
  setLayerMoveCondName: (name: string) => void;
  setLayerMoveCondNamePartial: (value: boolean) => void;
  setDeleteHiddenText: (value: boolean) => void;
  setLockBottomLayer: (value: boolean) => void;
  setUnlockAllLayers: (value: boolean) => void;
  setMergeReorganizeText: (value: boolean) => void;
  setMergeOutputFolderName: (name: string) => void;

  // カスタム操作アクション
  toggleCustomVisibility: (
    fileId: string,
    path: string[],
    index: number,
    currentVisible: boolean,
    layerId?: string,
  ) => void;
  addCustomMove: (fileId: string, op: CustomMoveOp) => void;
  removeCustomVisibilityOp: (fileId: string, path: string[], index: number) => void;
  removeCustomMoveOp: (fileId: string, opIndex: number) => void;
  clearCustomOps: (fileId?: string) => void;
  getCustomOpsSummary: () => { visibility: number; move: number };
  undoCustomOp: () => void;

  // Undo stack (internal)
  _customOpsHistory: Array<{
    vis: Map<string, CustomVisibilityOp[]>;
    move: Map<string, CustomMoveOp[]>;
  }>;
}

export const useLayerStore = create<LayerVisibilityState>((set, get) => ({
  pendingChanges: new Map(),
  actionMode: "hide",
  saveMode: "overwrite",
  selectedConditions: [],
  customConditions: [],
  organizeTargetName: "#原稿#",
  organizeIncludeSpecial: false,
  layerMoveTargetName: "",
  layerMoveCreateIfMissing: true,
  layerMoveSearchScope: "all",
  layerMoveSearchGroupName: "",
  layerMoveCondTextLayer: false,
  layerMoveCondSubgroupTop: false,
  layerMoveCondSubgroupBottom: false,
  layerMoveCondNameEnabled: false,
  layerMoveCondName: "",
  layerMoveCondNamePartial: false,
  deleteHiddenText: false,
  lockBottomLayer: true,
  unlockAllLayers: false,
  mergeReorganizeText: true,
  mergeOutputFolderName: "",
  customVisibilityOps: new Map(),
  customMoveOps: new Map(),
  _customOpsHistory: [],
  isProcessing: false,
  lastResults: [],
  lastActionMode: null,
  lastMergeOutputFolder: null,
  lastMergeSourceFolder: null,

  setLayerVisibility: (fileId, layerPath, visible) => {
    set((state) => {
      const newPendingChanges = new Map(state.pendingChanges);
      const fileChanges = newPendingChanges.get(fileId) || new Map();
      fileChanges.set(layerPath, visible);
      newPendingChanges.set(fileId, fileChanges);
      return { pendingChanges: newPendingChanges };
    });
  },

  clearPendingChanges: (fileId) => {
    set((state) => {
      if (fileId) {
        const newPendingChanges = new Map(state.pendingChanges);
        newPendingChanges.delete(fileId);
        return { pendingChanges: newPendingChanges };
      }
      return { pendingChanges: new Map() };
    });
  },

  setActionMode: (mode) => {
    set({ actionMode: mode });
  },

  setSaveMode: (mode) => {
    set({ saveMode: mode });
  },

  toggleCondition: (conditionId) => {
    set((state) => {
      const newSelected = state.selectedConditions.includes(conditionId)
        ? state.selectedConditions.filter((id) => id !== conditionId)
        : [...state.selectedConditions, conditionId];
      return { selectedConditions: newSelected };
    });
  },

  addCustomCondition: (condition) => {
    const id = `custom-${Date.now()}`;
    set((state) => ({
      customConditions: [...state.customConditions, { ...condition, id }],
    }));
  },

  removeCustomCondition: (id) => {
    set((state) => ({
      customConditions: state.customConditions.filter((c) => c.id !== id),
      selectedConditions: state.selectedConditions.filter((cid) => cid !== id),
    }));
  },

  setIsProcessing: (processing) => {
    set({ isProcessing: processing });
  },

  getSelectedConditions: () => {
    const state = get();
    const allConditions = [...PRESET_CONDITIONS, ...state.customConditions];
    return allConditions.filter((c) => state.selectedConditions.includes(c.id));
  },

  setLastResults: (results, mode, mergeOutputFolder, mergeSourceFolder) => {
    set({
      lastResults: results,
      lastActionMode: mode,
      lastMergeOutputFolder: mergeOutputFolder ?? null,
      lastMergeSourceFolder: mergeSourceFolder ?? null,
    });
  },
  clearLastResults: () => {
    set({
      lastResults: [],
      lastActionMode: null,
      lastMergeOutputFolder: null,
      lastMergeSourceFolder: null,
    });
  },
  setOrganizeTargetName: (name) => {
    set({ organizeTargetName: name });
  },
  setOrganizeIncludeSpecial: (include) => {
    set({ organizeIncludeSpecial: include });
  },
  setLayerMoveTargetName: (name) => {
    set({ layerMoveTargetName: name });
  },
  setLayerMoveCreateIfMissing: (value) => {
    set({ layerMoveCreateIfMissing: value });
  },
  setLayerMoveSearchScope: (scope) => {
    set({ layerMoveSearchScope: scope });
  },
  setLayerMoveSearchGroupName: (name) => {
    set({ layerMoveSearchGroupName: name });
  },
  setLayerMoveCondTextLayer: (value) => {
    set({ layerMoveCondTextLayer: value });
  },
  setLayerMoveCondSubgroupTop: (value) => {
    set({ layerMoveCondSubgroupTop: value });
  },
  setLayerMoveCondSubgroupBottom: (value) => {
    set({ layerMoveCondSubgroupBottom: value });
  },
  setLayerMoveCondNameEnabled: (value) => {
    set({ layerMoveCondNameEnabled: value });
  },
  setLayerMoveCondName: (name) => {
    set({ layerMoveCondName: name });
  },
  setLayerMoveCondNamePartial: (value) => {
    set({ layerMoveCondNamePartial: value });
  },
  setDeleteHiddenText: (value) => {
    set({ deleteHiddenText: value });
  },
  setLockBottomLayer: (value) => {
    set({ lockBottomLayer: value });
  },
  setUnlockAllLayers: (value) => {
    set({ unlockAllLayers: value });
  },
  setMergeReorganizeText: (value) => {
    set({ mergeReorganizeText: value });
  },
  setMergeOutputFolderName: (name) => {
    set({ mergeOutputFolderName: name });
  },

  toggleCustomVisibility: (fileId, path, index, currentVisible, layerId) => {
    set((state) => {
      // Push current state to undo history
      const history = [
        ...state._customOpsHistory,
        { vis: state.customVisibilityOps, move: state.customMoveOps },
      ].slice(-50);

      const newMap = new Map(state.customVisibilityOps);
      const ops = [...(newMap.get(fileId) ?? [])];
      const pathKey = path.join("/") + ":" + index;
      const existing = ops.findIndex((o) => o.path.join("/") + ":" + o.index === pathKey);
      if (existing >= 0) {
        // Already has an op — remove it (undo)
        ops.splice(existing, 1);
      } else {
        // Add new op: if currently visible → hide, if hidden → show
        ops.push({ path, index, action: currentVisible ? "hide" : "show", layerId });
      }
      if (ops.length === 0) {
        newMap.delete(fileId);
      } else {
        newMap.set(fileId, ops);
      }
      return { customVisibilityOps: newMap, _customOpsHistory: history };
    });
  },

  addCustomMove: (fileId, op) => {
    set((state) => {
      // Push current state to undo history
      const history = [
        ...state._customOpsHistory,
        { vis: state.customVisibilityOps, move: state.customMoveOps },
      ].slice(-50);

      const newMap = new Map(state.customMoveOps);
      const ops = [...(newMap.get(fileId) ?? []), op];
      newMap.set(fileId, ops);
      return { customMoveOps: newMap, _customOpsHistory: history };
    });
  },

  removeCustomVisibilityOp: (fileId, path, index) => {
    set((state) => {
      const newMap = new Map(state.customVisibilityOps);
      const ops = (newMap.get(fileId) ?? []).filter(
        (o) => !(o.path.join("/") === path.join("/") && o.index === index),
      );
      if (ops.length === 0) {
        newMap.delete(fileId);
      } else {
        newMap.set(fileId, ops);
      }
      return { customVisibilityOps: newMap };
    });
  },

  removeCustomMoveOp: (fileId, opIndex) => {
    set((state) => {
      const newMap = new Map(state.customMoveOps);
      const ops = [...(newMap.get(fileId) ?? [])];
      ops.splice(opIndex, 1);
      if (ops.length === 0) {
        newMap.delete(fileId);
      } else {
        newMap.set(fileId, ops);
      }
      return { customMoveOps: newMap };
    });
  },

  clearCustomOps: (fileId) => {
    set((state) => {
      if (fileId) {
        const newVis = new Map(state.customVisibilityOps);
        const newMove = new Map(state.customMoveOps);
        newVis.delete(fileId);
        newMove.delete(fileId);
        return { customVisibilityOps: newVis, customMoveOps: newMove, _customOpsHistory: [] };
      }
      return { customVisibilityOps: new Map(), customMoveOps: new Map(), _customOpsHistory: [] };
    });
  },

  undoCustomOp: () => {
    set((state) => {
      if (state._customOpsHistory.length === 0) return state;
      const history = [...state._customOpsHistory];
      const prev = history.pop()!;
      return {
        customVisibilityOps: prev.vis,
        customMoveOps: prev.move,
        _customOpsHistory: history,
      };
    });
  },

  getCustomOpsSummary: () => {
    const state = get();
    let visibility = 0;
    let move = 0;
    for (const ops of state.customVisibilityOps.values()) visibility += ops.length;
    for (const ops of state.customMoveOps.values()) move += ops.length;
    return { visibility, move };
  },
}));
