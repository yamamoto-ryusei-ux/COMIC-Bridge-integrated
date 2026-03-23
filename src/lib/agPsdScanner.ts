/**
 * ag-psd ベースのスキャナー
 * psdStore に読み込み済みの PSD メタデータから ScanData を構築する
 * Photoshop 不要 — フロントエンドのメモリ上で完結
 */

import type { PsdFile, LayerNode, TextInfo } from "../types";
import type {
  ScanData,
  ScanFontEntry,
  ScanFontSizeEntry,
  ScanSizeStats,
  ScanStrokeEntry,
  ScanGuideSet,
  ScanTextLayer,
  ScanWorkInfo,
  TextLogEntry,
} from "../types/scanPsd";
import { DEFAULT_WORK_INFO } from "../types/scanPsd";
import type { FontResolveInfo } from "../hooks/useFontResolver";

// --- ヘルパー ---

/** テキストレイヤーを再帰的に収集（可視のみ） */
function collectVisibleTextLayers(
  layers: LayerNode[],
  parentVisible = true,
): { textInfo: TextInfo; layerName: string }[] {
  const result: { textInfo: TextInfo; layerName: string }[] = [];
  for (const layer of layers) {
    const effectiveVisible = parentVisible && layer.visible;
    if (layer.type === "text" && effectiveVisible && layer.textInfo) {
      result.push({ textInfo: layer.textInfo, layerName: layer.name });
    }
    if (layer.children) {
      result.push(...collectVisibleTextLayers(layer.children, effectiveVisible));
    }
  }
  return result;
}

/** ガイドセットのキー生成（同じガイド構成をグルーピングする） */
function guideSetKey(
  horizontal: number[],
  vertical: number[],
  width: number,
  height: number,
): string {
  const h = [...horizontal]
    .sort((a, b) => a - b)
    .map((v) => Math.round(v))
    .join(",");
  const v = [...vertical]
    .sort((a, b) => a - b)
    .map((v) => Math.round(v))
    .join(",");
  return `${width}x${height}|h:${h}|v:${v}`;
}

// --- メイン関数 ---

export interface AgPsdScanOptions {
  /** フォント解決マップ（PostScript名→表示名） */
  fontResolveMap: Record<string, FontResolveInfo>;
  /** 巻数 */
  volume: number;
  /** 既存のworkInfo（ScanPSDタブで設定済みの場合） */
  existingWorkInfo?: ScanWorkInfo;
}

/**
 * psdStore の files からスキャンデータを構築する
 */
export function buildScanDataFromFiles(files: PsdFile[], options: AgPsdScanOptions): ScanData {
  const { fontResolveMap, volume, existingWorkInfo } = options;

  // --- フォント集計 ---
  const fontMap = new Map<
    string,
    { displayName: string; count: number; sizeMap: Map<number, number> }
  >();
  // --- サイズ集計 ---
  const allSizeMap = new Map<number, number>();
  // --- ストローク集計 ---
  const strokeMap = new Map<
    number,
    { count: number; fontSizes: Set<number>; maxFontSize: number | null }
  >();
  // --- ガイドセット集計 ---
  const guideSetMap = new Map<
    string,
    {
      horizontal: number[];
      vertical: number[];
      count: number;
      docNames: string[];
      docWidth: number;
      docHeight: number;
    }
  >();
  // --- テキストレイヤー by doc ---
  const textLayersByDoc: Record<string, ScanTextLayer[]> = {};
  // --- テキストログ by folder ---
  const textLogByFolder: Record<string, Record<string, TextLogEntry[]>> = {};
  // --- スキャンフォルダ ---
  const scannedFolders: Record<string, { files: string[]; scanDate: string }> = {};
  const folderVolumeMapping: Record<string, number> = {};

  const psdFiles = files.filter((f) => f.metadata?.layerTree);
  const now = new Date().toISOString();

  // フォルダ名を導出
  const folderName =
    psdFiles.length > 0
      ? psdFiles[0].filePath.replace(/[\\/][^\\/]+$/, "").replace(/^.*[\\/]/, "")
      : "unknown";

  for (const file of psdFiles) {
    const meta = file.metadata!;
    const textLayers = collectVisibleTextLayers(meta.layerTree);
    const docName = file.fileName.replace(/\.[^.]+$/, "");

    // テキストレイヤー集計
    const docTextLayers: ScanTextLayer[] = [];

    for (const { textInfo, layerName } of textLayers) {
      // フォント集計
      for (let fi = 0; fi < textInfo.fonts.length; fi++) {
        const fontName = textInfo.fonts[fi];
        const fontSize = textInfo.fontSizes[fi] ?? textInfo.fontSizes[0];

        if (!fontMap.has(fontName)) {
          const resolved = fontResolveMap[fontName];
          fontMap.set(fontName, {
            displayName: resolved ? `${resolved.display_name} ${resolved.style_name}` : fontName,
            count: 0,
            sizeMap: new Map(),
          });
        }
        const entry = fontMap.get(fontName)!;
        entry.count++;
        if (fontSize != null) {
          const roundedSize = Math.round(fontSize * 10) / 10;
          entry.sizeMap.set(roundedSize, (entry.sizeMap.get(roundedSize) || 0) + 1);
        }
      }

      // サイズ集計
      for (const size of textInfo.fontSizes) {
        const rounded = Math.round(size * 10) / 10;
        allSizeMap.set(rounded, (allSizeMap.get(rounded) || 0) + 1);
      }

      // ストローク集計
      if (textInfo.strokeSize != null && textInfo.strokeSize > 0) {
        const sizeKey = textInfo.strokeSize;
        if (!strokeMap.has(sizeKey)) {
          strokeMap.set(sizeKey, { count: 0, fontSizes: new Set(), maxFontSize: null });
        }
        const se = strokeMap.get(sizeKey)!;
        se.count++;
        for (const fs of textInfo.fontSizes) {
          const rounded = Math.round(fs * 10) / 10;
          se.fontSizes.add(rounded);
          if (se.maxFontSize === null || rounded > se.maxFontSize) {
            se.maxFontSize = rounded;
          }
        }
      }

      // doc テキストレイヤー
      const primaryFont = textInfo.fonts[0] || "";
      const primarySize = textInfo.fontSizes[0] || 0;
      const resolvedFont = fontResolveMap[primaryFont];
      docTextLayers.push({
        layerName,
        content: textInfo.text,
        fontSize: Math.round(primarySize * 10) / 10,
        fontName: primaryFont,
        displayFontName: resolvedFont
          ? `${resolvedFont.display_name} ${resolvedFont.style_name}`
          : primaryFont,
      });
    }

    if (docTextLayers.length > 0) {
      textLayersByDoc[docName] = docTextLayers;

      // テキストログ用エントリ構築（レイヤー順序でyPos代替）
      if (!textLogByFolder[folderName]) {
        textLogByFolder[folderName] = {};
      }
      textLogByFolder[folderName][docName] = docTextLayers.map((tl, idx) => ({
        content: tl.content,
        yPos: idx, // ag-psdではY座標不明のためレイヤー順序で代替
        layerName: tl.layerName,
        fontSize: tl.fontSize,
        isLinked: false, // ag-psdではリンク情報不明
        linkGroupId: null,
      }));
    }

    // ガイドセット集計
    if (meta.guides.length > 0) {
      const horizontal = meta.guides
        .filter((g) => g.direction === "horizontal")
        .map((g) => g.position);
      const vertical = meta.guides.filter((g) => g.direction === "vertical").map((g) => g.position);

      if (horizontal.length > 0 || vertical.length > 0) {
        const key = guideSetKey(horizontal, vertical, meta.width, meta.height);
        if (!guideSetMap.has(key)) {
          guideSetMap.set(key, {
            horizontal: [...horizontal].sort((a, b) => a - b),
            vertical: [...vertical].sort((a, b) => a - b),
            count: 0,
            docNames: [],
            docWidth: meta.width,
            docHeight: meta.height,
          });
        }
        const gs = guideSetMap.get(key)!;
        gs.count++;
        gs.docNames.push(file.fileName);
      }
    }
  }

  // スキャンフォルダ
  scannedFolders[folderName] = {
    files: psdFiles.map((f) => f.fileName),
    scanDate: now,
  };
  folderVolumeMapping[folderName] = volume;

  // --- ScanData 構築 ---

  // fonts
  const fonts: ScanFontEntry[] = [...fontMap.entries()]
    .map(([name, data]) => ({
      name,
      displayName: data.displayName,
      count: data.count,
      sizes: [...data.sizeMap.entries()]
        .map(([size, count]) => ({ size, count }))
        .sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => b.count - a.count);

  // sizeStats
  const sizeEntries: ScanFontSizeEntry[] = [...allSizeMap.entries()]
    .map(([size, count]) => ({ size, count }))
    .sort((a, b) => b.count - a.count);

  const mostFrequent = sizeEntries.length > 0 ? sizeEntries[0] : null;

  const allSizes: Record<string, number> = {};
  for (const [size, count] of allSizeMap) {
    allSizes[String(size)] = count;
  }

  const sizeStats: ScanSizeStats = {
    mostFrequent,
    sizes: sizeEntries,
    excludeRange: null,
    allSizes,
  };

  // strokeStats
  const strokeSizes: ScanStrokeEntry[] = [...strokeMap.entries()]
    .map(([size, data]) => ({
      size,
      count: data.count,
      fontSizes: [...data.fontSizes].sort((a, b) => a - b),
      maxFontSize: data.maxFontSize,
    }))
    .sort((a, b) => b.count - a.count);

  // guideSets
  const guideSets: ScanGuideSet[] = [...guideSetMap.values()].sort((a, b) => b.count - a.count);

  // workInfo
  const workInfo: ScanWorkInfo = existingWorkInfo
    ? { ...existingWorkInfo, volume }
    : { ...DEFAULT_WORK_INFO, volume };

  return {
    fonts,
    sizeStats,
    allFontSizes: allSizes,
    strokeStats: { sizes: strokeSizes },
    guideSets,
    textLayersByDoc,
    scannedFolders,
    processedFiles: psdFiles.length,
    workInfo,
    textLogByFolder,
    folderVolumeMapping,
    startVolume: volume,
  };
}

/**
 * 既存の ScanData に新しい ScanData をマージ（蓄積）する
 * fonts, sizeStats, allFontSizes, strokeStats, textLayersByDoc, scannedFolders を累積マージ
 * guideSets は重複を除いてマージ
 */
export function mergeScanData(existing: ScanData, incoming: ScanData): ScanData {
  // --- fonts マージ（name で合算） ---
  const fontMap = new Map<string, ScanFontEntry>();
  for (const f of existing.fonts) {
    fontMap.set(f.name, { ...f, sizes: [...f.sizes] });
  }
  for (const f of incoming.fonts) {
    const ex = fontMap.get(f.name);
    if (ex) {
      ex.count += f.count;
      // sizes をマージ
      const sizeMap = new Map<number, number>();
      for (const s of ex.sizes) sizeMap.set(s.size, s.count);
      for (const s of f.sizes) sizeMap.set(s.size, (sizeMap.get(s.size) || 0) + s.count);
      ex.sizes = [...sizeMap.entries()]
        .map(([size, count]) => ({ size, count }))
        .sort((a, b) => b.count - a.count);
      // displayName は新しい方を優先（解決済みなら更新）
      if (f.displayName && f.displayName !== f.name) ex.displayName = f.displayName;
    } else {
      fontMap.set(f.name, { ...f, sizes: [...f.sizes] });
    }
  }
  const fonts = [...fontMap.values()].sort((a, b) => b.count - a.count);

  // --- allFontSizes マージ ---
  const allFontSizes: Record<string, number> = { ...existing.allFontSizes };
  for (const [size, count] of Object.entries(incoming.allFontSizes || {})) {
    allFontSizes[size] = (allFontSizes[size] || 0) + count;
  }

  // --- sizeStats 再構築 ---
  const sizeCountMap = new Map<number, number>();
  for (const s of existing.sizeStats.sizes) sizeCountMap.set(s.size, s.count);
  for (const s of incoming.sizeStats.sizes) {
    sizeCountMap.set(s.size, (sizeCountMap.get(s.size) || 0) + s.count);
  }
  const mergedSizes: ScanFontSizeEntry[] = [...sizeCountMap.entries()]
    .map(([size, count]) => ({ size, count }))
    .sort((a, b) => b.count - a.count);
  const mostFrequent = mergedSizes.length > 0 ? mergedSizes[0] : null;
  const sizeStats: ScanSizeStats = {
    mostFrequent,
    sizes: mergedSizes,
    excludeRange: incoming.sizeStats.excludeRange ?? existing.sizeStats.excludeRange,
    allSizes: allFontSizes,
  };

  // --- strokeStats マージ ---
  const strokeMap = new Map<
    number,
    { count: number; fontSizes: Set<number>; maxFontSize: number | null }
  >();
  for (const s of existing.strokeStats?.sizes || []) {
    strokeMap.set(s.size, {
      count: s.count,
      fontSizes: new Set(s.fontSizes),
      maxFontSize: s.maxFontSize,
    });
  }
  for (const s of incoming.strokeStats?.sizes || []) {
    const ex = strokeMap.get(s.size);
    if (ex) {
      ex.count += s.count;
      for (const fs of s.fontSizes) ex.fontSizes.add(fs);
      if (s.maxFontSize != null && (ex.maxFontSize == null || s.maxFontSize > ex.maxFontSize)) {
        ex.maxFontSize = s.maxFontSize;
      }
    } else {
      strokeMap.set(s.size, {
        count: s.count,
        fontSizes: new Set(s.fontSizes),
        maxFontSize: s.maxFontSize,
      });
    }
  }
  const strokeSizes: ScanStrokeEntry[] = [...strokeMap.entries()]
    .map(([size, data]) => ({
      size,
      count: data.count,
      fontSizes: [...data.fontSizes].sort((a, b) => b - a),
      maxFontSize: data.maxFontSize,
    }))
    .sort((a, b) => b.count - a.count);

  // --- textLayersByDoc マージ（新が優先、既存は保持） ---
  const textLayersByDoc = {
    ...existing.textLayersByDoc,
    ...incoming.textLayersByDoc,
  };

  // --- scannedFolders マージ ---
  const scannedFolders = {
    ...existing.scannedFolders,
    ...incoming.scannedFolders,
  };

  // --- textLogByFolder マージ ---
  const textLogByFolder = { ...existing.textLogByFolder };
  for (const [folder, docs] of Object.entries(incoming.textLogByFolder || {})) {
    textLogByFolder[folder] = { ...(textLogByFolder[folder] || {}), ...docs };
  }

  // --- guideSets マージ（キーで重複排除） ---
  const guideSetKeys = new Set<string>();
  const guideSets: ScanGuideSet[] = [];
  const addGuideSet = (gs: ScanGuideSet) => {
    const key = `${gs.horizontal.join(",")}_${gs.vertical.join(",")}_${gs.docWidth}x${gs.docHeight}`;
    if (!guideSetKeys.has(key)) {
      guideSetKeys.add(key);
      guideSets.push(gs);
    } else {
      // 同じガイドセットの count を加算
      const existing = guideSets.find(
        (g) =>
          `${g.horizontal.join(",")}_${g.vertical.join(",")}_${g.docWidth}x${g.docHeight}` === key,
      );
      if (existing) {
        existing.count += gs.count;
        for (const dn of gs.docNames) {
          if (!existing.docNames.includes(dn)) existing.docNames.push(dn);
        }
      }
    }
  };
  for (const gs of existing.guideSets) addGuideSet(gs);
  for (const gs of incoming.guideSets) addGuideSet(gs);
  guideSets.sort((a, b) => b.count - a.count);

  // --- folderVolumeMapping マージ ---
  const folderVolumeMapping = {
    ...(existing.folderVolumeMapping || {}),
    ...(incoming.folderVolumeMapping || {}),
  };

  return {
    fonts,
    sizeStats,
    allFontSizes,
    strokeStats: { sizes: strokeSizes },
    guideSets,
    textLayersByDoc,
    scannedFolders,
    processedFiles: existing.processedFiles + incoming.processedFiles,
    workInfo: incoming.workInfo,
    textLogByFolder,
    folderVolumeMapping,
    startVolume: incoming.startVolume,
    editedRubyList: existing.editedRubyList || incoming.editedRubyList,
  };
}
