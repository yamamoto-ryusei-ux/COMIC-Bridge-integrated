import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type {
  SymbolRule, ProofRule, ProofCategory, ProgenOptions, NumberRuleState,
  TxtFile, NonJoyoWord, ProgenScreen, ProofreadingMode, OutputSortMode,
} from "../types/progen";
import { DEFAULT_SYMBOL_RULES, DEFAULT_OPTIONS, DEFAULT_NUMBER_RULES } from "../types/progen";

interface ProgenStore {
  // ===== 画面ナビゲーション =====
  screen: ProgenScreen;

  // ===== ルール =====
  symbolRules: SymbolRule[];
  currentProofRules: ProofRule[];
  currentEditCategory: string;
  currentViewMode: "edit" | "preview";

  // ===== オプション =====
  options: ProgenOptions;
  numberRules: NumberRuleState;

  // ===== テキスト入力 =====
  manuscriptTxtFiles: TxtFile[];
  txtGuideDismissed: boolean;

  // ===== 校正ページ =====
  proofreadingFiles: TxtFile[];
  proofreadingContent: string;
  currentProofreadingMode: ProofreadingMode;
  proofreadingDetectedNonJoyoWords: NonJoyoWord[];
  proofreadingSelectedNonJoyoIndexes: number[];
  proofreadingReturnTo: string;

  // ===== ランディング =====
  landingProofreadingFiles: TxtFile[];
  landingProofreadingContent: string;

  // ===== JSON =====
  currentLoadedJson: any | null;
  currentJsonPath: string;

  // ===== 管理モード =====
  isAdminMode: boolean;

  // ===== 出力フォーマット =====
  outputFormatVolume: number;
  outputFormatStartPage: number;
  outputFormatSortMode: OutputSortMode;

  // ===== データ =====
  currentSimpleData: any[];
  currentVariationData: Record<string, any>;
  detectedNonJoyoWords: NonJoyoWord[];

  // ===== その他 =====
  pendingNewCreationMode: string | null;
  pendingWorkTitle: string;
  txtFolderBasePath: string;

  // ===== 結果保存ダイアログ =====
  /** "text" = テキスト保存（整形/抽出）, "json" = JSON保存（正誤/提案）, null = 非表示 */
  resultSaveMode: "text" | "json" | null;

  // ===== ツールメニュー経由のモード =====
  /** ツールメニューから抽出/整形/校正リンクでアクセスした場合のモード */
  toolMode: "extraction" | "formatting" | "proofreading" | null;

  // ===== Actions: 画面 =====
  setScreen: (screen: ProgenScreen) => void;

  // ===== Actions: ルール =====
  setSymbolRules: (rules: SymbolRule[]) => void;
  addSymbolRule: (rule: SymbolRule) => void;
  updateSymbolRule: (index: number, rule: Partial<SymbolRule>) => void;
  deleteSymbolRule: (index: number) => void;
  toggleSymbolRule: (index: number) => void;

  setProofRules: (rules: ProofRule[]) => void;
  addProofRule: (rule: ProofRule) => void;
  updateProofRule: (index: number, rule: Partial<ProofRule>) => void;
  deleteProofRule: (index: number) => void;
  toggleProofRule: (index: number) => void;

  setCurrentEditCategory: (cat: string) => void;

  // ===== Actions: オプション =====
  setOption: (key: keyof ProgenOptions, value: boolean) => void;
  setNumberRule: (key: keyof NumberRuleState, value: number | boolean) => void;

  // ===== Actions: テキスト =====
  setManuscriptTxtFiles: (files: TxtFile[]) => void;
  setProofreadingFiles: (files: TxtFile[]) => void;
  setProofreadingContent: (content: string) => void;
  setCurrentProofreadingMode: (mode: ProofreadingMode) => void;

  // ===== Actions: JSON =====
  setCurrentLoadedJson: (json: any) => void;
  setCurrentJsonPath: (path: string) => void;

  // ===== Actions: マスタールール読み込み =====
  loadMasterRule: (labelValue: string) => Promise<void>;

  // ===== Actions: JSONルール適用 =====
  applyJsonRules: (jsonData: any) => void;

  // ===== Actions: 結果保存 =====
  setResultSaveMode: (mode: "text" | "json" | null) => void;
  setToolMode: (mode: "extraction" | "formatting" | "proofreading" | null) => void;

  // ===== Actions: リセット =====
  reset: () => void;
}

export const useProgenStore = create<ProgenStore>((set, get) => ({
  // ===== 初期値 =====
  screen: "landing",

  symbolRules: [...DEFAULT_SYMBOL_RULES],
  currentProofRules: [],
  currentEditCategory: "symbol",
  currentViewMode: "edit",

  options: { ...DEFAULT_OPTIONS },
  numberRules: { ...DEFAULT_NUMBER_RULES },

  manuscriptTxtFiles: [],
  txtGuideDismissed: false,

  proofreadingFiles: [],
  proofreadingContent: "",
  currentProofreadingMode: "simple",
  proofreadingDetectedNonJoyoWords: [],
  proofreadingSelectedNonJoyoIndexes: [],
  proofreadingReturnTo: "landing",

  landingProofreadingFiles: [],
  landingProofreadingContent: "",

  currentLoadedJson: null,
  currentJsonPath: "",

  isAdminMode: false,

  outputFormatVolume: 1,
  outputFormatStartPage: 1,
  outputFormatSortMode: "bottomToTop",

  currentSimpleData: [],
  currentVariationData: {},
  detectedNonJoyoWords: [],

  pendingNewCreationMode: null,
  pendingWorkTitle: "",
  txtFolderBasePath: "",
  resultSaveMode: null,
  toolMode: null,

  // ===== Actions =====

  setScreen: (screen) => set({ screen }),

  // --- 記号ルール ---
  setSymbolRules: (rules) => set({ symbolRules: rules }),
  addSymbolRule: (rule) => set((s) => ({ symbolRules: [rule, ...s.symbolRules] })),
  updateSymbolRule: (index, updates) => set((s) => {
    const rules = [...s.symbolRules];
    rules[index] = { ...rules[index], ...updates };
    return { symbolRules: rules };
  }),
  deleteSymbolRule: (index) => set((s) => ({
    symbolRules: s.symbolRules.filter((_, i) => i !== index),
  })),
  toggleSymbolRule: (index) => set((s) => {
    const rules = [...s.symbolRules];
    rules[index] = { ...rules[index], active: !rules[index].active };
    return { symbolRules: rules };
  }),

  // --- 校正ルール ---
  setProofRules: (rules) => set({ currentProofRules: rules }),
  addProofRule: (rule) => set((s) => ({ currentProofRules: [...s.currentProofRules, rule] })),
  updateProofRule: (index, updates) => set((s) => {
    const rules = [...s.currentProofRules];
    rules[index] = { ...rules[index], ...updates };
    return { currentProofRules: rules };
  }),
  deleteProofRule: (index) => set((s) => ({
    currentProofRules: s.currentProofRules.filter((_, i) => i !== index),
  })),
  toggleProofRule: (index) => set((s) => {
    const rules = [...s.currentProofRules];
    rules[index] = { ...rules[index], active: !rules[index].active };
    return { currentProofRules: rules };
  }),

  setCurrentEditCategory: (cat) => set({ currentEditCategory: cat }),

  // --- オプション ---
  setOption: (key, value) => set((s) => ({ options: { ...s.options, [key]: value } })),
  setNumberRule: (key, value) => set((s) => ({ numberRules: { ...s.numberRules, [key]: value } })),

  // --- テキスト ---
  setManuscriptTxtFiles: (files) => set({ manuscriptTxtFiles: files }),
  setProofreadingFiles: (files) => set({ proofreadingFiles: files }),
  setProofreadingContent: (content) => set({ proofreadingContent: content }),
  setCurrentProofreadingMode: (mode) => set({ currentProofreadingMode: mode }),

  // --- JSON ---
  setCurrentLoadedJson: (json) => set({ currentLoadedJson: json }),
  setCurrentJsonPath: (path) => set({ currentJsonPath: path }),

  // --- マスタールール読み込み ---
  loadMasterRule: async (labelValue: string) => {
    try {
      const res = await invoke<any>("progen_read_master_rule", { labelValue });
      if (res?.success && res.data) {
        get().applyJsonRules(res.data);
      }
    } catch { /* ignore */ }
  },

  // --- JSONルール適用（progen-main.jsのapplyJsonRulesロジック移植） ---
  applyJsonRules: (jsonData: any) => {
    const proofRules = jsonData?.proofRules;
    if (!proofRules) return;

    // 校正ルール
    if (Array.isArray(proofRules.proof)) {
      const rules: ProofRule[] = proofRules.proof.map((r: any) => ({
        before: r.before || r.src || "",
        after: r.after || r.dst || "",
        note: r.note || "",
        active: r.active !== false,
        category: (r.category || "basic") as ProofCategory,
        mode: r.mode,
        addRuby: r.category === "character" ? (r.addRuby !== undefined ? r.addRuby : true) : r.addRuby,
        userAdded: r.userAdded,
      }));
      set({ currentProofRules: rules });
    }

    // 記号ルール
    if (Array.isArray(proofRules.symbol) && proofRules.symbol.length > 0) {
      set({ symbolRules: proofRules.symbol.map((r: any) => ({
        src: r.src || "", dst: r.dst || "", note: r.note || "", active: r.active !== false,
      })) });
    }

    // オプション
    if (proofRules.options) {
      const opts = proofRules.options;
      const newOptions: Partial<ProgenOptions> = {};
      if (opts.ngWordMasking !== undefined) newOptions.ngWordMasking = opts.ngWordMasking;
      if (opts.punctuationToSpace !== undefined) newOptions.punctuationToSpace = opts.punctuationToSpace;
      if (opts.difficultRuby !== undefined) newOptions.difficultRuby = opts.difficultRuby;
      if (opts.typoCheck !== undefined) newOptions.typoCheck = opts.typoCheck;
      if (opts.missingCharCheck !== undefined) newOptions.missingCharCheck = opts.missingCharCheck;
      if (opts.nameRubyCheck !== undefined) newOptions.nameRubyCheck = opts.nameRubyCheck;
      if (opts.nonJoyoCheck !== undefined) newOptions.nonJoyoCheck = opts.nonJoyoCheck;

      const newNumberRules: Partial<NumberRuleState> = {};
      if (opts.numberRuleBase !== undefined) newNumberRules.base = opts.numberRuleBase;
      if (opts.numberRulePersonCount !== undefined) newNumberRules.personCount = opts.numberRulePersonCount;
      if (opts.numberRuleThingCount !== undefined) newNumberRules.thingCount = opts.numberRuleThingCount;
      if (opts.numberRuleMonth !== undefined) newNumberRules.month = opts.numberRuleMonth;
      if (opts.numberSubRulesEnabled !== undefined) newNumberRules.subRulesEnabled = opts.numberSubRulesEnabled;

      set((s) => ({
        options: { ...s.options, ...newOptions },
        numberRules: { ...s.numberRules, ...newNumberRules },
      }));
    }
  },

  // --- 結果保存 ---
  setResultSaveMode: (mode) => set({ resultSaveMode: mode }),
  setToolMode: (mode) => set({ toolMode: mode }),

  // --- リセット ---
  reset: () => set({
    screen: "landing",
    symbolRules: [...DEFAULT_SYMBOL_RULES],
    currentProofRules: [],
    currentEditCategory: "symbol",
    currentViewMode: "edit",
    options: { ...DEFAULT_OPTIONS },
    numberRules: { ...DEFAULT_NUMBER_RULES },
    manuscriptTxtFiles: [],
    txtGuideDismissed: false,
    proofreadingFiles: [],
    proofreadingContent: "",
    currentProofreadingMode: "simple",
    proofreadingDetectedNonJoyoWords: [],
    proofreadingSelectedNonJoyoIndexes: [],
    proofreadingReturnTo: "landing",
    landingProofreadingFiles: [],
    landingProofreadingContent: "",
    currentLoadedJson: null,
    currentJsonPath: "",
    isAdminMode: false,
    outputFormatVolume: 1,
    outputFormatStartPage: 1,
    outputFormatSortMode: "bottomToTop",
    currentSimpleData: [],
    currentVariationData: {},
    detectedNonJoyoWords: [],
    pendingNewCreationMode: null,
    pendingWorkTitle: "",
  }),
}));
