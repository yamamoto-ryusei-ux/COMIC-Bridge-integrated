// ============================================================
// TIFF化タブ 型定義
// TIPPY v2.92 全機能 + アプリ拡張（バッチキュー・クロップエディタ）
// ============================================================

// --- カラーモード ---

export type TiffColorMode = "mono" | "color" | "noChange" | "perPage";

/** 個別カラー設定ルール（最大3ルール） */
export interface PageRangeRule {
  id: string;
  fromPage: number;
  toPage: number;
  colorMode: "mono" | "color" | "noChange";
  applyBlur: boolean;
  blurRadius?: number; // 個別ぼかし半径（未指定時はグローバル設定を使用）
}

// --- ぼかし ---

export interface TiffBlurSettings {
  enabled: boolean;
  radius: number; // デフォルト 2.5px
}

/** ぼかし適用領域（多角形） */
export interface BlurRegion {
  id: string;
  points: Array<{ x: number; y: number }>; // ドキュメント座標のポリゴン頂点
  blurRadius: number;
}

/** 部分ぼかし（ページ別、最大5件） */
export interface PartialBlurEntry {
  pageNumber: number;
  blurRadius: number; // 選択範囲内のぼかし半径
  bounds?: TiffCropBounds; // レガシー: 矩形範囲（後方互換）
  regions?: BlurRegion[]; // 新: 複数ポリゴン領域（矩形・多角形対応）
}

// --- クロップ ---

export interface TiffCropBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** クロップエディタ用ガイドライン */
export interface TiffCropGuide {
  direction: "horizontal" | "vertical";
  position: number; // ドキュメント座標(px)
}

/** クロップエディタのステップ */
export type TiffCropStep = "select" | "confirm" | "apply";

/** クロップ操作方法 */
export type TiffCropMethod = "drag" | "guide";

/** クロップ範囲プリセット（Tachimi互換 JSON保存用） */
export interface TiffCropPreset {
  label: string; // "基本範囲_640x909"
  units: string; // always "px"
  bounds: TiffCropBounds;
  size: { width: number; height: number }; // right-left, bottom-top
  documentSize: { width: number; height: number }; // 基準画像サイズ
  savedAt: string; // ISO timestamp
  blurRadius?: number; // ガウスぼかし半径（px）。0=OFF
}

/** クロップ設定 */
export interface TiffCropSettings {
  enabled: boolean;
  bounds: TiffCropBounds | null;
  aspectRatio: { w: number; h: number }; // 640:909
}

// --- JSON Scandata（CLLENN互換） ---

export interface TiffScandataWorkInfo {
  genre: string;
  label: string;
  title: string;
}

export interface TiffScandataFile {
  presetData?: {
    workInfo?: TiffScandataWorkInfo;
    selectionRanges?: TiffCropPreset[];
    createdAt?: string; // ISO timestamp
    saveDataPath?: string; // Scandataファイルパス（連動保存用）
  };
  saveDataPath?: string; // トップレベルのsaveDataPath（互換）
}

/** ジャンル→レーベル階層（Tachimi LABELS_BY_GENRE 互換） */
export const GENRE_LABELS: Record<string, string[]> = {
  一般女性: ["Ropopo!", "コイパレ", "キスカラ", "カルコミ", "ウーコミ!", "シェノン"],
  TL: ["TLオトメチカ", "LOVE FLICK", "乙女チック", "ウーコミkiss!", "シェノン+", "@夜噺"],
  BL: ["NuPu", "spicomi", "MooiComics", "BLオトメチカ", "BOYS FAN"],
  一般男性: ["DEDEDE", "GG-COMICS", "コミックREBEL"],
  メンズ: ["カゲキヤコミック", "もえスタビースト", "@夜噺＋"],
  タテコミ: ["GIGATOON"],
};

/** JSON検索ベースパス（Tachimi互換） */
export const JSON_BASE_PATH =
  "G:/共有ドライブ/CLLENN/編集部フォルダ/編集企画部/編集企画_C班(AT業務推進)/DTP制作部/JSONフォルダ";

// --- リサイズ ---

export interface TiffResizeSettings {
  targetWidth: number; // デフォルト 1280
  targetHeight: number; // デフォルト 1818
}

// --- リネーム ---

export interface TiffRenameSettings {
  keepOriginalName: boolean; // リネームしない（元のファイル名を維持）
  extractPageNumber: boolean; // ファイル名からページ数を計算
  startNumber: number; // 開始ページ番号（デフォルト 3）
  padding: number; // ゼロ埋め桁数（デフォルト 4）
  flattenSubfolders: boolean; // サブフォルダ一括リネーム（フラット出力）
}

// --- 出力 ---

export interface TiffOutputSettings {
  outputDirectory: string | null; // null = Desktop/Script_Output
  proceedAsTiff: boolean; // true=TIFF出力, false=PSD出力
  outputJpg: boolean; // true=JPG出力（最高画質）
  saveIntermediatePsd: boolean; // 中間PSD保存
  mergeAfterColorConvert: boolean; // 画像レイヤーを統合する
}

// --- テキスト整理 ---

export interface TiffTextSettings {
  reorganize: boolean; // テキスト整理を行う
}

// --- ファイル別上書き（バッチキュー用） ---

export interface TiffFileOverride {
  fileId: string;
  skip: boolean; // タチキリスキップ
  colorMode?: TiffColorMode;
  blurEnabled?: boolean;
  blurRadius?: number;
  cropBounds?: TiffCropBounds | null; // null=クロップスキップ, undefined=グローバル設定を使用
  partialBlurEntries?: PartialBlurEntry[]; // ファイル別部分ぼかし設定
}

// --- 全設定 ---

export interface TiffSettings {
  colorMode: TiffColorMode;
  pageRangeRules: PageRangeRule[];
  defaultColorForPerPage: "mono" | "color" | "noChange";
  blur: TiffBlurSettings;
  partialBlurEntries: PartialBlurEntry[];
  crop: TiffCropSettings;
  resize: TiffResizeSettings;
  rename: TiffRenameSettings;
  output: TiffOutputSettings;
  text: TiffTextSettings;
  includeSubfolders: boolean;
  includeJpgPng: boolean;
  todayOnly: boolean;
  psbConvertToTiff: boolean;
}

export const DEFAULT_TIFF_SETTINGS: TiffSettings = {
  colorMode: "mono",
  pageRangeRules: [],
  defaultColorForPerPage: "mono",
  blur: { enabled: true, radius: 2.5 },
  partialBlurEntries: [],
  crop: {
    enabled: true,
    bounds: null,
    aspectRatio: { w: 640, h: 909 },
  },
  resize: { targetWidth: 1280, targetHeight: 1818 },
  rename: {
    keepOriginalName: false,
    extractPageNumber: false,
    startNumber: 3,
    padding: 4,
    flattenSubfolders: false,
  },
  output: {
    outputDirectory: null,
    proceedAsTiff: true,
    outputJpg: false,
    saveIntermediatePsd: false,
    mergeAfterColorConvert: false,
  },
  text: { reorganize: false },
  includeSubfolders: false,
  includeJpgPng: false,
  todayOnly: false,
  psbConvertToTiff: true,
};

// --- 処理結果 ---

export interface TiffResult {
  fileName: string;
  success: boolean;
  outputPath?: string;
  error?: string;
  colorMode?: string;
  finalWidth?: number;
  finalHeight?: number;
  dpi?: number;
}

// --- 処理フェーズ ---

export type TiffPhase = "idle" | "cropSelection" | "processing" | "done";

// --- キャンバスサイズ不一致 ---

export type CanvasMismatchAction = "reselect" | "manual" | "force" | "skip";
