// === Scan PSD 型定義 ===

// --- 作品情報 ---
export interface ScanWorkInfo {
  genre: string;
  label: string;
  authorType: "single" | "dual" | "none";
  author: string;
  artist: string;
  original: string;
  title: string;
  subtitle: string;
  editor: string;
  volume: number;
  storagePath: string;
  notes: string;
}

// --- フォント ---
export interface ScanFontSizeEntry {
  size: number;
  count: number;
}

export interface ScanFontEntry {
  name: string; // PostScript名
  displayName: string; // 表示名
  count: number;
  sizes: ScanFontSizeEntry[];
}

// --- プリセット ---
export interface FontPreset {
  name: string; // プリセット名（表示名）
  subName: string; // 役割（セリフ、モノローグ等）
  font: string; // PostScript名
  fontSize?: string;
  description?: string;
}

// --- サイズ統計 ---
export interface ScanSizeStats {
  mostFrequent: { size: number; count: number } | null;
  sizes: ScanFontSizeEntry[];
  excludeRange: { min: number; max: number } | null;
  allSizes: Record<string, number>;
}

// --- ストローク ---
export interface ScanStrokeEntry {
  size: number;
  count: number;
  fontSizes: number[];
  maxFontSize: number | null;
}

// --- ガイドセット ---
export interface ScanGuideSet {
  horizontal: number[];
  vertical: number[];
  count: number;
  docNames: string[];
  docWidth: number;
  docHeight: number;
}

// --- テキストレイヤー ---
export interface ScanTextLayer {
  layerName: string;
  content: string;
  fontSize: number;
  fontName: string;
  displayFontName: string;
}

// --- テキストログエントリ ---
export interface TextLogEntry {
  content: string;
  yPos: number;
  layerName: string;
  fontSize: number;
  isLinked: boolean;
  linkGroupId: string | null;
}

// --- TIPPY範囲選択 ---
export interface SelectionRange {
  label: string;
  bounds: { left: number; top: number; right: number; bottom: number };
}

// --- ルビ ---
export interface RubyEntry {
  id: string;
  parentText: string;
  rubyText: string;
  volume: number;
  page: number;
  order: number;
}

// --- スキャン結果全体 ---
export interface ScanData {
  fonts: ScanFontEntry[];
  sizeStats: ScanSizeStats;
  allFontSizes: Record<string, number>;
  strokeStats: { sizes: ScanStrokeEntry[] };
  guideSets: ScanGuideSet[];
  textLayersByDoc: Record<string, ScanTextLayer[]>;
  scannedFolders: Record<string, { files: string[]; scanDate: string }>;
  processedFiles: number;
  workInfo: ScanWorkInfo;
  textLogByFolder: Record<string, Record<string, TextLogEntry[]>>;
  folderVolumeMapping?: Record<string, number>;
  startVolume?: number;
  editedRubyList?: RubyEntry[];
}

// --- JSON出力形式（プリセットJSON）---
export interface PresetJsonData {
  presetData: {
    workInfo?: ScanWorkInfo;
    presets?: Record<string, FontPreset[]>;
    fontSizeStats?: ScanSizeStats;
    strokeSizes?: ScanStrokeEntry[];
    guides?: { horizontal: number[]; vertical: number[] };
    guideSets?: ScanGuideSet[];
    selectedGuideSetIndex?: number;
    excludedGuideIndices?: number[];
    rubyList?: RubyEntry[];
    selectionRanges?: SelectionRange[];
    createdAt?: string;
  };
}

// --- モード・タブ ---
export type ScanPsdMode = "new" | "edit" | "scandata";
export type ScanPsdTab = 0 | 1 | 2 | 3 | 4;

// --- 定数 ---
export const GENRE_LABELS: Record<string, string[]> = {
  一般女性: ["Ropopo!", "コイパレ", "キスカラ", "カルコミ", "ウーコミ!", "シェノン"],
  TL: ["TLオトメチカ", "LOVE FLICK", "乙女チック", "ウーコミkiss!", "シェノン+", "@夜噺"],
  BL: ["NuPu", "spicomi", "MooiComics", "BLオトメチカ", "BOYS FAN"],
  一般男性: ["DEDEDE", "GG-COMICS", "コミックREBEL"],
  メンズ: ["カゲキヤコミック", "もえスタビースト", "@夜噺＋"],
  タテコミ: ["GIGATOON"],
};

export const FONT_SUB_NAME_MAP: { keywords: string[]; subName: string }[] = [
  { keywords: ["f910", "コミックw4", "comicw4"], subName: "セリフ" },
  { keywords: ["中丸ゴシック", "nakamarugo", "nakamaru"], subName: "モノローグ" },
  { keywords: ["平成明朝体w7", "heiseimin"], subName: "回想内ネーム" },
  {
    keywords: [
      "ＤＦ平成ゴシック体 W9",
      "ＤＦ平成ゴシック体 w9",
      "平成ゴシック体w9",
      "平成ゴシック体 w9",
      "heiseigow9",
    ],
    subName: "怒鳴り（シリアス）",
  },
  {
    keywords: [
      "ＤＦ平成ゴシック体 W7",
      "ＤＦ平成ゴシック体 w7",
      "平成ゴシック体w7",
      "平成ゴシック体 w7",
      "heiseigow7",
    ],
    subName: "語気強く（通常）",
  },
  {
    keywords: [
      "ＤＦ平成ゴシック体 W5",
      "ＤＦ平成ゴシック体 w5",
      "平成ゴシック体w5",
      "平成ゴシック体 w5",
      "heiseigow5",
    ],
    subName: "ナレーション",
  },
  { keywords: ["コミックフォント太", "comicfont太"], subName: "語気強く（通常）" },
  {
    keywords: ["新ゴ pr5 db", "a-otf 新ゴ pr5 db", "shingo-db", "shingopr5-db"],
    subName: "語気強く（通常）",
  },
  { keywords: ["リュウミンu", "ryuminu"], subName: "悲鳴" },
  { keywords: ["ヒラギノ丸ゴ", "hiragino maru", "hiraginomarugopro"], subName: "SNSなど" },
  { keywords: ["源暎ラテゴ", "geneilatego", "geneila"], subName: "電話・テレビ" },
  { keywords: ["康印体", "kouin"], subName: "おどろ" },
  { keywords: ["綜藝", "sougei", "sougeimoji"], subName: "ギャグテイスト" },
];

/** カテゴリ名の一意リスト（FONT_SUB_NAME_MAP の定義順） */
export const ALL_SUB_NAMES: string[] = [];
const _subNameSeen = new Set<string>();
for (const entry of FONT_SUB_NAME_MAP) {
  if (!_subNameSeen.has(entry.subName)) {
    _subNameSeen.add(entry.subName);
    ALL_SUB_NAMES.push(entry.subName);
  }
}

/** カテゴリ表示色パレット */
export const SUB_NAME_PALETTE: Record<string, { color: string; bg: string; border: string }> = {
  セリフ: { color: "#3b7dd8", bg: "#eaf2fc", border: "#c4daF2" },
  モノローグ: { color: "#8b5cf6", bg: "#f0ebff", border: "#d4c4f8" },
  回想内ネーム: { color: "#10a37f", bg: "#e6f8f3", border: "#b4e8d8" },
  "怒鳴り（シリアス）": { color: "#e04060", bg: "#fdedf0", border: "#f4c0cc" },
  "語気強く（通常）": { color: "#e08830", bg: "#fef4e8", border: "#f4d8b0" },
  ナレーション: { color: "#0ea5a5", bg: "#e6f7f7", border: "#b0e4e4" },
  悲鳴: { color: "#d946a8", bg: "#fdeef8", border: "#f0c0e0" },
  SNSなど: { color: "#2d8cc9", bg: "#e8f3fb", border: "#b8d8f0" },
  "電話・テレビ": { color: "#6366f1", bg: "#ededfe", border: "#c8c8f8" },
  おどろ: { color: "#c87030", bg: "#fdf0e4", border: "#f0d0a8" },
  ギャグテイスト: { color: "#59a829", bg: "#eef6e8", border: "#c4e4a8" },
};

export const DEFAULT_WORK_INFO: ScanWorkInfo = {
  genre: "",
  label: "",
  authorType: "single",
  author: "",
  artist: "",
  original: "",
  title: "",
  subtitle: "",
  editor: "",
  volume: 1,
  storagePath: "",
  notes: "",
};

export const TAB_LABELS = [
  "作品情報",
  "フォント種類",
  "フォントサイズ",
  "タチキリ枠",
  "テキスト",
] as const;

/**
 * je-nsonman形式のルビエントリをCOMIC-Bridge形式に正規化する。
 * je-nsonman: { parent, ruby, volume (string "01"), page, order }
 * COMIC-Bridge: { id, parentText, rubyText, volume (number), page, order }
 */
export function normalizeRubyEntries(raw: unknown[]): RubyEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => {
    const entry = r as Record<string, unknown>;
    // parentText / rubyText が無ければ parent / ruby からフォールバック
    const parentText = (entry.parentText as string) ?? (entry.parent as string) ?? "";
    const rubyText = (entry.rubyText as string) ?? (entry.ruby as string) ?? "";
    // volume: 文字列 "01" → 数値 1
    let volume: number;
    if (typeof entry.volume === "number") {
      volume = entry.volume;
    } else if (typeof entry.volume === "string") {
      volume = parseInt(entry.volume, 10) || 1;
    } else {
      volume = 1;
    }
    // id が無ければ生成
    const id =
      (entry.id as string) || `ruby_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    return {
      id,
      parentText,
      rubyText,
      volume,
      page: (entry.page as number) ?? 1,
      order: (entry.order as number) ?? 0,
    };
  });
}

export function getAutoSubName(fontName: string): string {
  if (!fontName) return "";
  const lower = fontName.toLowerCase();
  for (const entry of FONT_SUB_NAME_MAP) {
    for (const keyword of entry.keywords) {
      if (lower.includes(keyword.toLowerCase())) {
        return entry.subName;
      }
    }
  }
  return "";
}
