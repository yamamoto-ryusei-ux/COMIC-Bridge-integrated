/** 全角数字→半角数字 */
export function toHalfWidthNumbers(str: string): string {
  return str.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

/** 巻数入力を正規化（全角→半角、「巻」除去、数値化） */
export function normalizeVolumeInput(input: string): number | null {
  const s = toHalfWidthNumbers(input).replace(/巻/g, "").trim();
  const n = parseInt(s, 10);
  return isNaN(n) || n < 1 ? null : n;
}

/** ファイル名に使えない文字を_に置換 */
export function sanitizeFileName(str: string): string {
  return str.replace(/[\\/:*?"<>|]/g, "_");
}
