// ═══ ProGen Types & Constants ═══

// --- 記号変換ルール ---
export interface SymbolRule {
  src: string;
  dst: string;
  note: string;
  active: boolean;
}

// --- 校正ルール ---
export type ProofCategory =
  | "basic" | "recommended" | "auxiliary"
  | "difficult" | "number" | "pronoun" | "character";

export interface ProofRule {
  before: string;
  after: string;
  note: string;
  active: boolean;
  category: ProofCategory;
  /** 難読文字のモード */
  mode?: "open" | "ruby" | "none";
  /** 人物名のルビ付与 */
  addRuby?: boolean;
  /** ユーザー追加ルール */
  userAdded?: boolean;
}

// --- オプションフラグ ---
export interface ProgenOptions {
  ngWordMasking: boolean;
  punctuationToSpace: boolean;
  difficultRuby: boolean;
  typoCheck: boolean;
  missingCharCheck: boolean;
  nameRubyCheck: boolean;
  nonJoyoCheck: boolean;
}

// --- 数字ルール ---
export interface NumberRuleState {
  base: number;            // 0=混在許容, 1=全て算用, 2=全て漢数字
  personCount: number;     // 人数表記ルール
  thingCount: number;      // 個数表記ルール
  month: number;           // 月表記ルール
  subRulesEnabled: boolean;
}

// --- テキストファイル ---
export interface TxtFile {
  name: string;
  content: string;
  size: number;
}

// --- 非常用漢字 ---
export interface NonJoyoWord {
  word: string;
  page: number;
  line: string;
}

// --- 画面 ---
export type ProgenScreen =
  | "landing" | "extraction" | "formatting" | "proofreading"
  | "admin" | "comicpot" | "jsonBrowser" | "resultViewer";

// --- 校正モード ---
export type ProofreadingMode = "simple" | "variation";

// --- 出力ソートモード ---
export type OutputSortMode = "bottomToTop" | "topToBottom";

// ═══ カテゴリ定義（ProGenサイドバー） ═══

export interface EditCategory {
  key: string;
  name: string;
  icon: string;
  isSymbol?: boolean;
  isNumber?: boolean;
  subCategories?: ProofCategory[];
}

export const EDIT_CATEGORIES: EditCategory[] = [
  { key: "symbol", name: "記号・句読点", icon: "⋮", isSymbol: true },
  { key: "notation", name: "表記変更", icon: "✏️", subCategories: ["basic", "recommended"] },
  { key: "difficult", name: "難読文字", icon: "字" },
  { key: "number", name: "数字", icon: "#", isNumber: true },
  { key: "pronoun", name: "人称", icon: "👤" },
  { key: "character", name: "人物名", icon: "🏷️" },
];

// ═══ デフォルト記号ルール ═══

export const DEFAULT_SYMBOL_RULES: SymbolRule[] = [
  { src: "･･･", dst: "…", note: "三点リーダ統一", active: true },
  { src: "・・", dst: "…", note: "中黒連続を三点リーダに", active: true },
  { src: "・", dst: " ", note: "中黒を半角スペースに", active: true },
  { src: "、", dst: " ", note: "読点を半角スペースに", active: true },
  { src: "~", dst: "～", note: "チルダを波ダッシュに", active: true },
  { src: "！！", dst: "!!", note: "連続は半角に", active: true },
  { src: "？？", dst: "??", note: "連続は半角に", active: true },
  { src: "！？", dst: "!?", note: "連続は半角に", active: true },
  { src: "？！", dst: "!?", note: "連続は半角に（!?に統一）", active: true },
  { src: "!", dst: "！", note: "単独は全角に", active: true },
  { src: "?", dst: "？", note: "単独は全角に", active: true },
];

// ═══ 数字サブルール定義 ═══

export const NUMBER_SUB_RULES = {
  personCount: {
    label: "人数",
    options: [
      "ひとり、ふたり、３人〜",
      "ひとり、ふたり、3人〜",
      "一人、二人、三人〜",
      "1人、2人、3人〜",
    ],
  },
  thingCount: {
    label: "個数",
    options: [
      "ひとつ、ふたつ、３つ〜",
      "ひとつ、ふたつ、3つ〜",
      "一つ、二つ、三つ〜",
      "1つ、2つ、3つ〜",
    ],
  },
  month: {
    label: "月",
    options: [
      "1カ月、2カ月〜",
      "１カ月、２カ月〜",
      "一カ月、二カ月〜",
      "一ヶ月、二ヶ月〜",
      "ひと月、ふた月〜",
      "1ヶ月、2ヶ月〜",
    ],
  },
} as const;

// ═══ デフォルトオプション ═══

export const DEFAULT_OPTIONS: ProgenOptions = {
  ngWordMasking: true,
  punctuationToSpace: true,
  difficultRuby: false,
  typoCheck: true,
  missingCharCheck: true,
  nameRubyCheck: true,
  nonJoyoCheck: true,
};

export const DEFAULT_NUMBER_RULES: NumberRuleState = {
  base: 0,
  personCount: 0,
  thingCount: 0,
  month: 0,
  subRulesEnabled: true,
};
