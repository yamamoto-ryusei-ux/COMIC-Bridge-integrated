/**
 * ProGen JSON読み書き＋校正データ保存ロジック
 * progen-json-browser.js / progen-data.js / progen-result-viewer.js のデータロジックを集約
 */
import { useCallback } from "react";
import { useProgenStore } from "./progenStore";
import {
  getJsonFolderPath,
  listDirectory,
  readJsonFile,
  writeJsonFile,
  getTxtFolderPath,
  listTxtDirectory,
  createTxtWorkFolder,
  saveCalibrationData,
} from "./useProgenTauri";

// ═══ 型定義 ═══

export interface FolderItem {
  name: string;
  path: string;
  isFolder: boolean;
}

export interface JsonFileCache {
  name: string;
  path: string;
  relativePath: string;
}

/** CSV解析結果1行 */
export interface VariationItem {
  category: string;
  page: string;
  volumeNum: number;
  pageNum: number;
  excerpt: string;
  content: string;
}

export interface SimpleItem {
  page: string;
  volumeNum: number;
  pageNum: number;
  category: string;
  excerpt: string;
  content: string;
}

/** カテゴリグループ（提案チェック） */
export interface VariationGroup {
  order: number;
  subGroups: Record<string, { label: string; items: VariationItem[] }>;
}

/** ピックアップ済みデータ */
export interface PickedItem {
  type: "variation" | "simple";
  category: string;
  page: string;
  excerpt: string;
  content: string;
  picked: boolean;
}

/** 校正データ保存パラメータ */
export interface CalibrationSaveParams {
  label: string;
  work: string;
  volume: number;
  checkType: string;
  items: PickedItem[];
}

// ═══ CSV解析ユーティリティ ═══

/** 引用符を考慮してCSV行をパース */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

/** ページテキストから巻数とページ番号を抽出 */
function extractVolumeAndPage(pageText: string): { volumeNum: number; pageNum: number } {
  let volumeNum = 0;
  let pageNum = 0;
  const volMatch = pageText.match(/(\d+)\s*巻/);
  if (volMatch) volumeNum = parseInt(volMatch[1], 10);
  const pageMatch = pageText.match(/(\d+)\s*[Ppページ]/);
  if (pageMatch) pageNum = parseInt(pageMatch[1], 10);
  if (pageNum === 0) {
    const numMatch = pageText.match(/(\d+)/);
    if (numMatch) pageNum = parseInt(numMatch[1], 10);
  }
  return { volumeNum, pageNum };
}

/** ページテキストを短縮形式に変換 */
export function formatPageShort(pageText: string): string {
  const { volumeNum, pageNum } = extractVolumeAndPage(pageText);
  if (volumeNum > 0 && pageNum > 0) return `${volumeNum}巻P${pageNum}`;
  if (pageNum > 0) return `P${pageNum}`;
  return pageText;
}

/** 巻→ページの優先順でソート比較 */
function compareByVolumeAndPage(a: { volumeNum: number; pageNum: number }, b: { volumeNum: number; pageNum: number }): number {
  if (a.volumeNum !== b.volumeNum) return a.volumeNum - b.volumeNum;
  return a.pageNum - b.pageNum;
}

/** 提案チェックCSVを解析 */
export function parseVariationCSV(text: string): VariationItem[] {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const items: VariationItem[] = [];
  for (const line of lines) {
    const cols = parseCSVLine(line);
    if (cols.length < 4) continue;
    const [category, page, excerpt, content] = cols;
    const { volumeNum, pageNum } = extractVolumeAndPage(page);
    items.push({ category, page, volumeNum, pageNum, excerpt, content });
  }
  items.sort(compareByVolumeAndPage);
  return items;
}

/** 正誤チェックCSVを解析 */
export function parseSimpleCSV(text: string): SimpleItem[] {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const items: SimpleItem[] = [];
  for (const line of lines) {
    const cols = parseCSVLine(line);
    if (cols.length < 4) continue;
    const [page, category, excerpt, content] = cols;
    const { volumeNum, pageNum } = extractVolumeAndPage(page);
    items.push({ page, volumeNum, pageNum, category, excerpt, content });
  }
  items.sort(compareByVolumeAndPage);
  return items;
}

/** 提案チェックデータをカテゴリでグループ化 */
export function groupVariationByCategory(items: VariationItem[]): Record<string, VariationGroup> {
  const grouped: Record<string, VariationGroup> = {};
  for (const item of items) {
    // サブラベル(①②…)を分離
    const subMatch = item.category.match(/^(.+?)\s*([①-⑳].*)?$/);
    const baseCategory = subMatch ? subMatch[1] : item.category;
    const subLabel = subMatch?.[2] || "①";

    if (!grouped[baseCategory]) {
      const orderMatch = baseCategory.match(/^(\d+)/);
      grouped[baseCategory] = {
        order: orderMatch ? parseInt(orderMatch[1], 10) : 999,
        subGroups: {},
      };
    }
    if (!grouped[baseCategory].subGroups[subLabel]) {
      grouped[baseCategory].subGroups[subLabel] = { label: subLabel, items: [] };
    }
    grouped[baseCategory].subGroups[subLabel].items.push(item);
  }
  return grouped;
}

/** 正誤チェックデータをカテゴリでグループ化 */
export function groupSimpleByCategory(items: SimpleItem[]): Record<string, SimpleItem[]> {
  const grouped: Record<string, SimpleItem[]> = {};
  for (const item of items) {
    if (!grouped[item.category]) grouped[item.category] = [];
    grouped[item.category].push(item);
  }
  return grouped;
}

// ═══ カラーマッピング ═══

const CATEGORY_COLORS = [
  "bg-blue-500/15 text-blue-400 border-blue-500/30",
  "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  "bg-orange-500/15 text-orange-400 border-orange-500/30",
  "bg-purple-500/15 text-purple-400 border-purple-500/30",
  "bg-teal-500/15 text-teal-400 border-teal-500/30",
  "bg-pink-500/15 text-pink-400 border-pink-500/30",
  "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
  "bg-red-500/15 text-red-400 border-red-500/30",
  "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  "bg-gray-500/15 text-gray-400 border-gray-500/30",
];

export function getCategoryColor(order: number): string {
  return CATEGORY_COLORS[order % CATEGORY_COLORS.length];
}

const SIMPLE_CATEGORY_COLOR_MAP: Record<string, string> = {
  "人名ルビ": "#3498db",
  "常用外漢字": "#e67e22",
  "ルール未反映": "#9b59b6",
  "誤字": "#e74c3c",
  "人物名誤記": "#1abc9c",
  "脱字": "#c0392b",
  "衍字": "#d35400",
  "助詞": "#2980b9",
  "熟字訓": "#8e44ad",
  "当て字": "#16a085",
};

export function getSimpleCategoryColor(category: string): string {
  return SIMPLE_CATEGORY_COLOR_MAP[category] || "#95a5a6";
}

// ═══ フック ═══

export function useProgenJson() {
  const store = useProgenStore();

  /** GドライブJSONフォルダのベースパスを取得 */
  const getBasePath = useCallback(async () => {
    return getJsonFolderPath();
  }, []);

  /** フォルダ内容を読み込み */
  const loadFolderContents = useCallback(async (dirPath: string): Promise<FolderItem[]> => {
    const result = await listDirectory(dirPath);
    const items: FolderItem[] = [];
    for (const folder of result.folders) {
      items.push({ name: folder.split(/[/\\]/).pop() || folder, path: folder, isFolder: true });
    }
    for (const file of result.json_files) {
      items.push({ name: file.split(/[/\\]/).pop() || file, path: file, isFolder: false });
    }
    return items;
  }, []);

  /** JSONファイルを読み込んでストアに適用 */
  const loadJsonFile = useCallback(async (filePath: string, _fileName?: string) => {
    const data = await readJsonFile(filePath);
    store.setCurrentLoadedJson(data);
    store.setCurrentJsonPath(filePath);

    // proofRules があれば適用
    if (data?.proofRules) {
      store.applyJsonRules(data);
      return { hasRules: true, labelName: data?.presetData?.workInfo?.label || "" };
    }
    // 旧形式: presetDataの中にproofRulesがある場合
    if (data?.presetData?.proofRules) {
      store.applyJsonRules(data.presetData);
      return { hasRules: true, labelName: data?.presetData?.workInfo?.label || "" };
    }
    // proofRules なし → レーベルからマスタールール読み込み
    const labelName = data?.presetData?.workInfo?.label || data?.workInfo?.label || "";
    if (labelName) {
      await store.loadMasterRule(labelName);
    }
    return { hasRules: false, labelName };
  }, [store]);

  /** 現在のルールをJSONファイルに上書き保存 */
  const saveRulesToJson = useCallback(async () => {
    const path = store.currentJsonPath;
    if (!path) return false;

    let json = store.currentLoadedJson || {};
    // proofRules更新
    json = {
      ...json,
      proofRules: {
        proof: store.currentProofRules,
        symbol: store.symbolRules,
        options: {
          ...store.options,
          numberRuleBase: store.numberRules.base,
          numberRulePersonCount: store.numberRules.personCount,
          numberRuleThingCount: store.numberRules.thingCount,
          numberRuleMonth: store.numberRules.month,
          numberSubRulesEnabled: store.numberRules.subRulesEnabled,
        },
      },
    };

    await writeJsonFile(path, json);
    store.setCurrentLoadedJson(json);
    return true;
  }, [store]);

  /** 新規作品JSONを作成 */
  const createNewWorkJson = useCallback(async (folderPath: string, title: string, label: string) => {
    const sanitized = title.replace(/[\\/:*?"<>|]/g, "_");
    const fullPath = folderPath.replace(/\\/g, "/") + "/" + sanitized + ".json";

    const newJson = {
      proofRules: {
        proof: store.currentProofRules,
        symbol: store.symbolRules,
        options: {
          ...store.options,
          numberRuleBase: store.numberRules.base,
          numberRulePersonCount: store.numberRules.personCount,
          numberRuleThingCount: store.numberRules.thingCount,
          numberRuleMonth: store.numberRules.month,
          numberSubRulesEnabled: store.numberRules.subRulesEnabled,
        },
      },
      presetData: {
        presets: {},
        fontSizeStats: {},
        guides: [],
        workInfo: { label, title },
      },
    };

    await writeJsonFile(fullPath, newJson);
    // TXTフォルダも作成
    try {
      await createTxtWorkFolder(label, sanitized);
    } catch { /* ignore */ }

    store.setCurrentJsonPath(fullPath);
    store.setCurrentLoadedJson(newJson);
    return fullPath;
  }, [store]);

  /** TXTフォルダのベースパスを取得 */
  const getTxtBasePath = useCallback(async () => {
    return getTxtFolderPath();
  }, []);

  /** TXTフォルダの内容を読み込み */
  const loadTxtFolderContents = useCallback(async (dirPath: string) => {
    return listTxtDirectory(dirPath);
  }, []);

  /** 校正データを保存 */
  const saveCalibration = useCallback(async (params: CalibrationSaveParams) => {
    return saveCalibrationData(params);
  }, []);

  return {
    getBasePath,
    loadFolderContents,
    loadJsonFile,
    saveRulesToJson,
    createNewWorkJson,
    getTxtBasePath,
    loadTxtFolderContents,
    saveCalibration,
  };
}
