/** 校正チェック項目 (MojiQ JSON構造準拠) */
export interface ProofreadingCheckItem {
  picked: boolean;
  category: string;
  page: string;
  excerpt: string;
  content: string;
  checkKind: "correctness" | "proposal";
}

/** チェックグループ */
export interface ProofreadingCheckGroup {
  items: ProofreadingCheckItem[];
}

/** 校正チェックJSON のルート構造 */
export interface ProofreadingCheckData {
  work?: string;
  checks: {
    variation?: ProofreadingCheckGroup;
    simple?: ProofreadingCheckGroup;
  };
}

/** パース済み校正チェックデータ */
export interface ParsedProofreadingData {
  title: string;
  fileName: string;
  filePath: string;
  allItems: ProofreadingCheckItem[];
  correctnessItems: ProofreadingCheckItem[];
  proposalItems: ProofreadingCheckItem[];
}

/** チェックタブフィルタ */
export type CheckTabMode = "both" | "correctness" | "proposal";

/** カテゴリ色 (カテゴリ番号 1〜10 に対応) */
export const CATEGORY_COLORS = [
  "#3498db",
  "#27ae60",
  "#e67e22",
  "#9b59b6",
  "#1abc9c",
  "#e91e63",
  "#3f51b5",
  "#e74c3c",
  "#f1c40f",
  "#95a5a6",
] as const;

/** カテゴリ名から色インデックスを取得 */
export function getCategoryColorIndex(category: string): number {
  const match = category.match(/^(\d+)\./);
  if (!match) return -1;
  return (parseInt(match[1], 10) - 1) % CATEGORY_COLORS.length;
}
