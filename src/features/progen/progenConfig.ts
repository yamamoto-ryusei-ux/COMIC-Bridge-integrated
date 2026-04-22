/**
 * ProGen 外部設定ローダー
 *
 * 共有ドライブ (G:\...\Pro-Gen\) からキャッシュされた config.json を読み込み、
 * プロンプト生成 (progenPrompts.ts) で使用するデータを提供する。
 *
 * 優先順位:
 *   1. ローカルキャッシュ (Rust `read_progen_cached_file`)
 *   2. 埋め込みフォールバック (このファイル内の DEFAULT_*)
 *
 * 読み込みは `initProgenConfig()` を起動時に1回呼ぶ（非同期、ブロックしない）。
 * それ以降は `getProgenConfig()` で同期的にアクセス可能。
 */
import { invoke } from "@tauri-apps/api/core";

// ═══ 型定義 ═══

export interface NgWordEntry {
  original: string;
  replacement: string;
}

export interface NumberSubRuleGroup {
  name: string;
  options: string[];
}

export interface NumberSubRules {
  personCount: NumberSubRuleGroup;
  thingCount: NumberSubRuleGroup;
  month: NumberSubRuleGroup;
}

export interface CategoryDef {
  name: string;
}

export interface ProgenConfigData {
  /** NGワードリスト（伏字） */
  ngWordList: NgWordEntry[];
  /** 数字ルールのサブオプション（人数/戸数/月） */
  numberSubRules: NumberSubRules;
  /** カテゴリ定義 */
  categories: Record<string, CategoryDef>;
}

// ═══ 埋め込みフォールバック（ビルド時点の既定値） ═══

const DEFAULT_NG_WORDS: NgWordEntry[] = [
  { original: "ヴァギナ", replacement: "ヴァ〇ナ" },
  { original: "クリトリス", replacement: "ク〇トリス" },
  { original: "クリ", replacement: "ク〇" },
  { original: "クンニ", replacement: "ク〇ニ" },
  { original: "ザーメン", replacement: "ザ〇メン" },
  { original: "スカトロ", replacement: "スカ〇ロ" },
  { original: "スペルマ", replacement: "スペ〇マ" },
  { original: "レイプ", replacement: "レ〇プ" },
  { original: "ファック", replacement: "ファ〇ク" },
  { original: "イラマチオ", replacement: "イラ〇チオ" },
  { original: "マラ", replacement: "マ〇" },
  { original: "カリ", replacement: "カ〇" },
  { original: "ペニス", replacement: "ペ〇ス" },
  { original: "ちんこ", replacement: "ち〇こ" },
  { original: "チンコ", replacement: "チ〇コ" },
  { original: "ちんぽ", replacement: "ち〇ぽ" },
  { original: "チンポ", replacement: "チ〇ポ" },
  { original: "ちんちん", replacement: "ち〇ちん" },
  { original: "チンチン", replacement: "チ〇チン" },
  { original: "ちん毛", replacement: "ち〇毛" },
  { original: "チン毛", replacement: "チ〇毛" },
  { original: "ヤリマン", replacement: "ヤリマ〇" },
  { original: "まんこ", replacement: "ま〇こ" },
  { original: "手マン", replacement: "手マ〇" },
  { original: "マン筋", replacement: "マ〇筋" },
  { original: "粗チン", replacement: "粗チ〇" },
];

const DEFAULT_NUMBER_SUB_RULES: NumberSubRules = {
  personCount: {
    name: "人数",
    options: [
      "ひとり、ふたり、３人",
      "ひとり、ふたり、三人",
      "一人、二人、３人",
      "一人、二人、三人",
      "1人、2人、3人",
    ],
  },
  thingCount: {
    name: "戸数",
    options: ["ひとつ、ふたつ、３つ", "ひとつ、ふたつ、三つ", "1つ、2つ、3つ", "一つ、二つ、三つ"],
  },
  month: {
    name: "月",
    options: [
      "1カ月、2カ月",
      "1か月、2か月",
      "1ヶ月、2ヶ月",
      "一か月、二か月",
      "一ヶ月、二ヶ月",
      "一カ月、二カ月",
    ],
  },
};

const DEFAULT_CATEGORIES: Record<string, CategoryDef> = {
  basic: { name: "基本的に表記変更されるもの" },
  recommended: { name: "表記が推奨されるもの" },
  auxiliary: { name: "補助動詞は基本ひらきます" },
  difficult: { name: "難読文字は基本ひらきます" },
  number: { name: "数字" },
  pronoun: { name: "人称" },
  character: { name: "人物名（ルビ用）" },
};

const DEFAULT_CONFIG: ProgenConfigData = {
  ngWordList: DEFAULT_NG_WORDS,
  numberSubRules: DEFAULT_NUMBER_SUB_RULES,
  categories: DEFAULT_CATEGORIES,
};

// ═══ ランタイム状態 ═══

let currentConfig: ProgenConfigData = DEFAULT_CONFIG;
let initialized = false;
let syncStatus: {
  source: "embedded" | "cache" | "remote-updated";
  remoteVersion?: string;
  localVersion?: string;
  error?: string;
  lastChecked?: number;
} = { source: "embedded" };

/** 現在適用中の config を返す（同期、起動直後は埋め込み既定値） */
export function getProgenConfig(): ProgenConfigData {
  return currentConfig;
}

/** 直近の同期状態を返す（UI表示用） */
export function getProgenSyncStatus() {
  return { ...syncStatus };
}

/** 初期化（アプリ起動時に1回呼ぶ）
 *  - Step1: キャッシュ読込（即時反映）
 *  - Step2: バックグラウンドでリモート同期 → 成功時は差し替え
 */
export async function initProgenConfig(): Promise<void> {
  if (initialized) return;
  initialized = true;

  // Step 1: 既存ローカルキャッシュを即座に読む
  try {
    const cached = await invoke<string | null>("read_progen_cached_file", {
      relativePath: "config.json",
    });
    if (cached) {
      const parsed = parseConfig(cached);
      if (parsed) {
        currentConfig = parsed;
        syncStatus = { ...syncStatus, source: "cache" };
      }
    }
  } catch (e) {
    console.warn("ProGen cache read failed:", e);
  }

  // Step 2: リモート同期（バックグラウンド、失敗しても本体継続）
  try {
    const result = await invoke<any>("fetch_progen_config");
    syncStatus = {
      source: result.success && result.updated_files > 0 ? "remote-updated" : syncStatus.source,
      remoteVersion: result.remote_version ?? undefined,
      localVersion: result.local_version ?? undefined,
      error: result.error ?? undefined,
      lastChecked: Date.now(),
    };
    if (result.success && result.updated_files > 0) {
      // キャッシュが更新されたので再読み込み
      const fresh = await invoke<string | null>("read_progen_cached_file", {
        relativePath: "config.json",
      });
      if (fresh) {
        const parsed = parseConfig(fresh);
        if (parsed) {
          currentConfig = parsed;
        }
      }
    }
  } catch (e) {
    syncStatus = {
      ...syncStatus,
      error: String(e),
      lastChecked: Date.now(),
    };
  }
}

/** 手動同期（UIボタン用） */
export async function refreshProgenConfig(): Promise<typeof syncStatus> {
  initialized = false;
  await initProgenConfig();
  return getProgenSyncStatus();
}

// ═══ 内部ヘルパー ═══

function parseConfig(text: string): ProgenConfigData | null {
  try {
    const obj = JSON.parse(text);
    // 各フィールドを検証し、欠けていれば埋め込み既定値で補完
    const ngWordList: NgWordEntry[] = Array.isArray(obj.ngWordList)
      ? obj.ngWordList
          .filter(
            (e: any) =>
              e && typeof e.original === "string" && typeof e.replacement === "string",
          )
          .map((e: any) => ({ original: e.original, replacement: e.replacement }))
      : DEFAULT_NG_WORDS;

    const numberSubRules: NumberSubRules =
      obj.numberSubRules &&
      obj.numberSubRules.personCount &&
      obj.numberSubRules.thingCount &&
      obj.numberSubRules.month
        ? obj.numberSubRules
        : DEFAULT_NUMBER_SUB_RULES;

    const categories: Record<string, CategoryDef> =
      obj.categories && typeof obj.categories === "object" ? obj.categories : DEFAULT_CATEGORIES;

    return { ngWordList, numberSubRules, categories };
  } catch (e) {
    console.error("ProGen config parse error:", e);
    return null;
  }
}
