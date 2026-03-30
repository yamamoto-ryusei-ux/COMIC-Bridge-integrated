/**
 * ピクセル寸法 + DPI から用紙サイズ相当を判定
 * 許容誤差: ±3% (トンボ・裁ち落とし込みに対応)
 */
export function detectPaperSize(w: number, h: number, dpi: number): string | null {
  const [short, long] = w < h ? [w, h] : [h, w];
  const mmToInch = 25.4;

  // 用紙定義 (mm): [短辺, 長辺, 名前]
  const papers: [number, number, string][] = [
    [257, 364, "B4"],
    [182, 257, "B5"],
    [210, 297, "A4"],
    [148, 210, "A5"],
    [220, 310, "B4同人誌"],
    [188, 263, "B5同人誌"],
    // 仕上がり＋塗り足し (3mm四方)
    [263, 370, "B4+塗り足し"],
    [188, 263, "B5+塗り足し"],
    [216, 303, "A4+塗り足し"],
    [154, 216, "A5+塗り足し"],
  ];

  const tolerance = 0.03;
  for (const [sMm, lMm, name] of papers) {
    const sPx = (sMm / mmToInch) * dpi;
    const lPx = (lMm / mmToInch) * dpi;
    if (
      Math.abs(short - sPx) / sPx <= tolerance &&
      Math.abs(long - lPx) / lPx <= tolerance
    ) {
      return name;
    }
  }
  return null;
}
