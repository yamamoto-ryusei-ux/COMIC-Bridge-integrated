// === フォント帳 型定義 ===

export interface FontBookEntry {
  id: string;
  fontPostScript: string;
  fontDisplayName: string;
  subName: string;
  sourceFile: string;
  capturedAt: string;
  note?: string;
}

export interface FontBookData {
  entries: FontBookEntry[];
  updatedAt: string;
}

/** フォント帳の保存ディレクトリパスを算出
 * textLogFolderPath（.../写植・校正用テキストログ/テキスト抽出）の親（.../写植・校正用テキストログ）を
 * ベースにして {label}/{title}/フォント帳/ に格納する
 */
export function getFontBookDir(textLogFolderPath: string, label: string, title: string): string {
  // textLogFolderPathの末尾セグメント（テキスト抽出）を除去して親を取得
  const normalized = textLogFolderPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const parentPath = normalized.substring(0, normalized.lastIndexOf("/"));
  const safeLabel = label.replace(/[\\/:*?"<>|]/g, "_");
  const safeTitle = title.replace(/[\\/:*?"<>|]/g, "_");
  return `${parentPath}/${safeLabel}/${safeTitle}/フォント帳`;
}
