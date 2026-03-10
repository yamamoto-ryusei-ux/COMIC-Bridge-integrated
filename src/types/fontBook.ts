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

/** フォント帳の保存ディレクトリパスを算出 */
export function getFontBookDir(
  textLogFolderPath: string,
  label: string,
  title: string
): string {
  const safeLabel = label.replace(/[\\/:*?"<>|]/g, "_");
  const safeTitle = title.replace(/[\\/:*?"<>|]/g, "_");
  return `${textLogFolderPath}/${safeLabel}/${safeTitle}_fontbook`.replace(
    /\\/g,
    "/"
  );
}
