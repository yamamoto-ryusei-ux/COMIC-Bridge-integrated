import { useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useScanPsdStore } from "../store/scanPsdStore";
import type {
  ScanData,
  ScanGuideSet,
  PresetJsonData,
  ScanWorkInfo,
  FontPreset,
  RubyEntry,
} from "../types/scanPsd";
import { normalizeRubyEntries, getAutoSubName } from "../types/scanPsd";

export type ScanResult =
  | { success: true; processedFiles: number; newFolders: string[]; rubyCount: number }
  | { success: false; error: string };

/**
 * タチキリガイドセットとして有効か判定（元スクリプト isValidTachikiriGuideSet 準拠）
 * - ドキュメント中心の上下左右にそれぞれ1本以上のガイドが必要
 * - 中心から±1pxの位置にあるガイドは除外
 */
function isValidTachikiriGuideSet(gs: ScanGuideSet): boolean {
  if (!gs.docWidth || !gs.docHeight) return true; // 後方互換性
  const centerX = gs.docWidth / 2;
  const centerY = gs.docHeight / 2;
  const tolerance = 1;

  let hasAbove = false,
    hasBelow = false;
  for (const h of gs.horizontal) {
    if (Math.abs(h - centerY) <= tolerance) continue;
    if (h < centerY) hasAbove = true;
    else hasBelow = true;
  }

  let hasLeft = false,
    hasRight = false;
  for (const v of gs.vertical) {
    if (Math.abs(v - centerX) <= tolerance) continue;
    if (v < centerX) hasLeft = true;
    else hasRight = true;
  }

  return hasAbove && hasBelow && hasLeft && hasRight;
}

/**
 * ガイドセットをソートし最適なものを自動選択（元スクリプト準拠）
 * 優先順位: 1) 有効なタチキリガイドが先  2) 使用回数が多い順
 * ソート後のインデックス0を自動選択
 */
function autoSelectGuideSet(guideSets: ScanGuideSet[]): number | null {
  if (guideSets.length === 0) return null;

  // インデックス付きでソート
  const indexed = guideSets.map((gs, i) => ({ gs, originalIndex: i }));
  indexed.sort((a, b) => {
    const aValid = isValidTachikiriGuideSet(a.gs) ? 1 : 0;
    const bValid = isValidTachikiriGuideSet(b.gs) ? 1 : 0;
    if (aValid !== bValid) return bValid - aValid;
    return b.gs.count - a.gs.count;
  });

  return indexed[0].originalIndex;
}

/**
 * 内部 sizeStats を je-nsonman 互換のエクスポート形式に変換
 * - mostFrequent: {size,count} → 数値 (size のみ)
 * - sizes: {size,count}[] → 数値配列 (昇順)
 * - top10Sizes: 上位10件を {size,count}[] で別途出力
 */
function convertSizeStatsForExport(
  sizeStats: ScanData["sizeStats"] | undefined,
): Record<string, unknown> | undefined {
  if (!sizeStats) return undefined;

  const excludeRange = sizeStats.excludeRange;
  const exMin = excludeRange?.min ?? 0;
  const exMax = excludeRange?.max ?? 0;

  // top10: count降順で上位10件（excludeRange内を除外、count>=2）
  const top10Sizes: { size: number; count: number }[] = [];
  const sorted = [...sizeStats.sizes].sort((a, b) => b.count - a.count);
  for (const entry of sorted) {
    if (top10Sizes.length >= 10) break;
    if (entry.count < 2) continue;
    if (exMin > 0 && exMax > 0 && entry.size >= exMin && entry.size <= exMax) continue;
    top10Sizes.push({ size: entry.size, count: entry.count });
  }

  // sizes: 全サイズを数値配列で昇順
  const sizes = sizeStats.sizes.map((s) => s.size).sort((a, b) => a - b);

  return {
    mostFrequent: sizeStats.mostFrequent?.size ?? null,
    sizes,
    top10Sizes,
    excludeRange: excludeRange ?? undefined,
  };
}

/**
 * 内部 strokeStats.sizes を je-nsonman 互換のエクスポート形式に変換
 * - count フィールドを除去、fontSizes のみ出力
 */
function convertStrokeSizesForExport(
  strokeSizes: ScanData["strokeStats"]["sizes"] | undefined,
): { size: number; fontSizes: number[] }[] | undefined {
  if (!strokeSizes || strokeSizes.length === 0) return undefined;
  return strokeSizes.map((s) => ({
    size: s.size,
    fontSizes: s.fontSizes,
  }));
}

/**
 * プリセットを je-nsonman 互換のエクスポート形式に変換
 * - subName が空なら省略
 * - description に「使用回数:」を含む場合は省略
 */
function convertPresetsForExport(
  presetSets: Record<string, FontPreset[]>,
): Record<string, { name: string; font: string; subName?: string; description?: string }[]> {
  const result: Record<
    string,
    { name: string; font: string; subName?: string; description?: string }[]
  > = {};
  for (const [setName, presets] of Object.entries(presetSets)) {
    result[setName] = presets.map((p) => {
      const entry: { name: string; font: string; subName?: string; description?: string } = {
        name: p.name,
        font: p.font,
      };
      if (p.subName) entry.subName = p.subName;
      if (p.description && !p.description.includes("使用回数:")) {
        entry.description = p.description;
      }
      return entry;
    });
  }
  return result;
}

/**
 * スキャン完了後に検出フォントを自動的にプリセットに追加（je-nsonman準拠）
 * scanData.fonts に含まれるが presetSets に未登録のフォントを自動追加する
 */
function autoRegisterDetectedFonts(scanData: ScanData): void {
  const store = useScanPsdStore.getState();
  const { presetSets, currentSetName } = store;

  if (!scanData.fonts || scanData.fonts.length === 0) return;

  // 全プリセットセットに登録済みのフォント（PostScript名）を収集
  const registeredFonts = new Set<string>();
  for (const list of Object.values(presetSets)) {
    for (const p of list) registeredFonts.add(p.font);
  }

  // 未登録フォントを抽出
  const unregistered = scanData.fonts.filter((f) => !registeredFonts.has(f.name));
  if (unregistered.length === 0) return;

  // 現在のセット（またはデフォルト）に追加
  const targetSet = currentSetName || "デフォルト";
  for (const f of unregistered) {
    store.addFontToPreset(targetSet, {
      name: f.displayName || f.name,
      subName: getAutoSubName(f.name),
      font: f.name,
      description: `使用回数: ${f.count}`,
    });
  }
}

/**
 * プリセットJSON保存の実処理（スタンドアロン関数）
 * startScan完了後の自動保存からも呼ばれる
 */
export async function performPresetJsonSave(): Promise<boolean> {
  const store = useScanPsdStore.getState();
  const { workInfo, jsonFolderPath } = store;

  const hasRequiredInfo = !!(workInfo.title && workInfo.label);
  let filePath: string;

  if (hasRequiredInfo) {
    const safeLabel = workInfo.label.replace(/[\\/:*?"<>|]/g, "_");
    const safeTitle = workInfo.title.replace(/[\\/:*?"<>|]/g, "_");
    filePath = `${jsonFolderPath}/${safeLabel}/${safeTitle}.json`.replace(/\\/g, "/");
  } else {
    filePath = `${jsonFolderPath}/_仮保存/temp.json`.replace(/\\/g, "/");
  }

  // 旧ファイルを削除（タイトル/レーベル変更でパスが変わった場合）
  const oldPath = store.currentJsonFilePath;
  if (oldPath && oldPath !== filePath) {
    try {
      await invoke("delete_file", { filePath: oldPath });
    } catch {
      /* ignore */
    }
  }
  const oldTempPath = store.tempJsonFilePath;
  if (oldTempPath && oldTempPath !== filePath) {
    try {
      await invoke("delete_file", { filePath: oldTempPath });
    } catch {
      /* ignore */
    }
  }

  // 既存ファイルを読み込んでマージ
  let existingData: PresetJsonData = { presetData: {} };
  try {
    const existing = await invoke<string>("read_text_file", { filePath });
    if (existing) {
      existingData = JSON.parse(existing);
    }
  } catch {
    /* new file */
  }

  const selectedGuide =
    store.selectedGuideIndex != null && store.scanData?.guideSets[store.selectedGuideIndex]
      ? store.scanData.guideSets[store.selectedGuideIndex]
      : undefined;

  const presetData = {
    ...existingData.presetData,
    workInfo: store.workInfo,
    presets: convertPresetsForExport(store.presetSets),
    fontSizeStats: convertSizeStatsForExport(store.scanData?.sizeStats),
    strokeSizes: convertStrokeSizesForExport(store.scanData?.strokeStats?.sizes),
    guides: selectedGuide
      ? { horizontal: selectedGuide.horizontal, vertical: selectedGuide.vertical }
      : existingData.presetData?.guides,
    guideSets: undefined,
    selectedGuideSetIndex: store.selectedGuideIndex ?? undefined,
    excludedGuideIndices: undefined,
    rubyList: undefined,
    selectionRanges: existingData.presetData?.selectionRanges,
    saveLocation: store.workInfo.label || undefined,
  };

  // presetData の fontSizeStats/strokeSizes はエクスポート形式（je-nsonman互換）のため
  // 内部型と異なる → Record<string, unknown> にキャスト
  const outputData = {
    ...existingData,
    presetData,
  };

  await invoke("write_text_file", {
    filePath,
    content: JSON.stringify(outputData, null, 2),
  });

  if (hasRequiredInfo) {
    store.setCurrentJsonFilePath(filePath);
    store.setTempJsonFilePath(null);
    store.setPendingTitleLabel(false);

    if (store.scanData) {
      try {
        await saveScandataLinked(store);
      } catch (e) {
        console.error("Linked scandata save failed:", e);
      }
    }
    const oldTempScandata = store.tempScandataFilePath;
    if (oldTempScandata) {
      try {
        await invoke("delete_file", { filePath: oldTempScandata });
      } catch {
        /* ignore */
      }
      store.setTempScandataFilePath(null);
    }
  } else {
    store.setTempJsonFilePath(filePath);
    store.setCurrentJsonFilePath(null);
    store.setPendingTitleLabel(true);

    if (store.scanData) {
      const tempScandataPath = `${store.saveDataBasePath}/_仮保存/temp_scandata.json`.replace(
        /\\/g,
        "/",
      );
      const scandataContent = {
        ...store.scanData,
        workInfo: store.workInfo,
        presets: store.presetSets,
        editedRubyList: undefined,
        selectedGuideSetIndex: store.selectedGuideIndex,
        excludedGuideIndices:
          store.excludedGuideIndices.size > 0 ? Array.from(store.excludedGuideIndices) : undefined,
      };
      const oldTempSd = store.tempScandataFilePath;
      if (oldTempSd && oldTempSd !== tempScandataPath) {
        try {
          await invoke("delete_file", { filePath: oldTempSd });
        } catch {
          /* ignore */
        }
      }
      await invoke("write_text_file", {
        filePath: tempScandataPath,
        content: JSON.stringify(scandataContent),
      });
      store.setTempScandataFilePath(tempScandataPath);
    }
  }

  return hasRequiredInfo;
}

/**
 * JSON保存に連動してscandataを自動保存する
 * パス: {saveDataBasePath}/{label}/{title}_scandata.json
 * 元スクリプトの saveScanDataWithInfo と同じパス規則
 */
async function saveScandataLinked(store: ReturnType<typeof useScanPsdStore.getState>) {
  const { workInfo, scanData, presetSets, saveDataBasePath } = store;
  if (!scanData || !workInfo.title || !workInfo.label) return;

  const safeLabel = workInfo.label.replace(/[\\/:*?"<>|]/g, "_");
  const safeTitle = workInfo.title.replace(/[\\/:*?"<>|]/g, "_");

  const labelFolderPath = `${saveDataBasePath}/${safeLabel}`.replace(/\\/g, "/");
  const fileName = `${safeTitle}_scandata.json`;
  const scandataPath = `${labelFolderPath}/${fileName}`;

  // 旧scandataを削除（タイトル/レーベル変更でパスが変わった場合）
  const oldPath = store.currentScandataFilePath;
  if (oldPath && oldPath !== scandataPath) {
    try {
      await invoke("delete_file", { filePath: oldPath });
    } catch {
      // 旧ファイル削除失敗は無視
    }
  }

  const data = {
    ...scanData,
    workInfo,
    presets: presetSets,
    editedRubyList: undefined,
    // ガイド選択・除外状態もscandataに保存
    selectedGuideSetIndex: store.selectedGuideIndex,
    excludedGuideIndices:
      store.excludedGuideIndices.size > 0 ? Array.from(store.excludedGuideIndices) : undefined,
    saveDataPath: scandataPath,
    label: workInfo.label,
    title: workInfo.title,
  };

  // write_text_file は親フォルダを自動作成する
  await invoke("write_text_file", {
    filePath: scandataPath,
    content: JSON.stringify(data),
  });

  store.setCurrentScandataFilePath(scandataPath);
}

/**
 * textLogByFolderのリンクグループからルビを抽出して store.rubyList に追加
 * （je-nsonman appendRubyFromNewFolders 準拠）
 * @param newFolderNames 新しくスキャンしたフォルダ名の配列
 */
function appendRubiesFromFolders(newFolderNames: string[]): void {
  const store = useScanPsdStore.getState();
  if (!store.scanData?.textLogByFolder || newFolderNames.length === 0) return;

  const { textLogByFolder, folderVolumeMapping } = store.scanData;
  const existingRubyList = store.rubyList;

  // 既存の最大orderを取得
  let maxOrder = 0;
  for (const r of existingRubyList) {
    if (r.order > maxOrder) maxOrder = r.order;
  }
  let orderCounter = maxOrder + 1;

  const newRubies: RubyEntry[] = [];

  for (const srcFolderName of newFolderNames) {
    const folderData = textLogByFolder[srcFolderName];
    if (!folderData) continue;

    const currentVolume = folderVolumeMapping?.[srcFolderName] ?? 1;

    const docNames = Object.keys(folderData).sort((a, b) => {
      const numA = parseInt(a.replace(/[^0-9]/g, ""), 10) || 0;
      const numB = parseInt(b.replace(/[^0-9]/g, ""), 10) || 0;
      return numA - numB;
    });

    let pageNum = 1;
    for (const docName of docNames) {
      const texts = folderData[docName];

      // リンクグループを収集
      const linkedGroups: Record<
        string,
        { content: string; fontSize: number; layerName: string }[]
      > = {};
      for (const t of texts) {
        if (t.isLinked && t.linkGroupId) {
          if (!linkedGroups[t.linkGroupId]) linkedGroups[t.linkGroupId] = [];
          linkedGroups[t.linkGroupId].push({
            content: t.content,
            fontSize: t.fontSize,
            layerName: t.layerName,
          });
        }
      }

      // 各リンクグループからルビを抽出
      for (const groupTexts of Object.values(linkedGroups)) {
        const sorted = [...groupTexts].sort((a, b) => b.fontSize - a.fontSize);
        if (sorted.length < 2) continue;

        const parentText = sorted[0].content;
        for (let t = 1; t < sorted.length; t++) {
          const trimmedRuby = sorted[t].content.replace(/[\s\u3000]/g, "");
          if (/^[・･゛]+$/.test(trimmedRuby)) continue;

          // 括弧形式かチェック（je-nsonman準拠）
          const bracketMatch = sorted[t].layerName.match(/^(.+?)[（(](.+?)[）)]$/);
          if (bracketMatch) {
            newRubies.push({
              id: `ruby_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              parentText: bracketMatch[2],
              rubyText: bracketMatch[1].replace(/[\s\u3000]/g, ""),
              volume: currentVolume,
              page: pageNum,
              order: orderCounter++,
            });
          } else {
            newRubies.push({
              id: `ruby_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              parentText,
              rubyText: trimmedRuby,
              volume: currentVolume,
              page: pageNum,
              order: orderCounter++,
            });
          }
        }
      }
      pageNum++;
    }
  }

  if (newRubies.length > 0) {
    store.setRubyList([...existingRubyList, ...newRubies]);
  }
}

/**
 * テキストログ出力の実処理（元スクリプト exportTextLog 準拠）
 * 保存先: {textLogFolderPath}/{label}/{title}/{XX巻}.txt + ルビ一覧.txt
 * startScan完了後の自動出力からも呼ばれる
 */
export async function performExportTextLog(): Promise<void> {
  const store = useScanPsdStore.getState();
  if (!store.scanData?.textLogByFolder) return;
  const { workInfo, scanData, rubyList, textLogFolderPath } = store;
  if (!workInfo.label || !workInfo.title) return;

  const safeLabel = workInfo.label.replace(/[\\/:*?"<>|]/g, "_");
  const safeTitle = workInfo.title.replace(/[\\/:*?"<>|]/g, "_");
  const titleFolderPath = `${textLogFolderPath}/${safeLabel}/${safeTitle}`.replace(/\\/g, "/");

  const folderVolumeMapping = scanData.folderVolumeMapping || {};
  const startVolume = scanData.startVolume || workInfo.volume || 1;

  // フォルダ名を収集して自然順ソート
  const folderNames = Object.keys(scanData.textLogByFolder).sort((a, b) =>
    a.localeCompare(b, "ja", { numeric: true }),
  );

  // リンクグループ収集用（ルビ一覧生成用）
  const linkedGroups: Record<
    string,
    {
      pageNum: number;
      volumeStr: string;
      texts: { content: string; fontSize: number; layerName: string }[];
    }
  > = {};

  // 各フォルダごとにテキストファイルを出力
  for (let folderIdx = 0; folderIdx < folderNames.length; folderIdx++) {
    const srcFolderName = folderNames[folderIdx];

    // 個別巻数マッピングがあればそれを使用、なければ連番
    const currentVolume =
      folderVolumeMapping[srcFolderName] !== undefined
        ? folderVolumeMapping[srcFolderName]
        : startVolume + folderIdx;
    const volumeStr = String(currentVolume).padStart(2, "0");

    const folderData = scanData.textLogByFolder[srcFolderName];

    // ドキュメント名（ページ番号）でソート
    const docNames = Object.keys(folderData).sort((a, b) => {
      const numA = parseInt(a.replace(/[^0-9]/g, ""), 10) || 0;
      const numB = parseInt(b.replace(/[^0-9]/g, ""), 10) || 0;
      return numA - numB;
    });
    if (docNames.length === 0) continue;

    // テキストログを生成
    let logContent = `[${volumeStr}巻]\n\n`;
    let pageNum = 1;

    for (const docName of docNames) {
      const texts = folderData[docName];
      logContent += `<<${pageNum}Page>>\n`;

      // Y座標順にソート
      const sorted = [...texts].sort((a, b) => a.yPos - b.yPos);
      for (const entry of sorted) {
        logContent += entry.content + "\n\n";

        // リンクされたテキストをグループごとに収集（ルビ一覧用）
        if (entry.isLinked && entry.linkGroupId) {
          if (!linkedGroups[entry.linkGroupId]) {
            linkedGroups[entry.linkGroupId] = {
              pageNum,
              volumeStr,
              texts: [],
            };
          }
          linkedGroups[entry.linkGroupId].texts.push({
            content: entry.content,
            fontSize: entry.fontSize,
            layerName: entry.layerName,
          });
        }
      }

      logContent += "\n";
      pageNum++;
    }

    // {XX巻}.txt として保存
    const filePath = `${titleFolderPath}/${volumeStr}巻.txt`;
    await invoke("write_text_file", { filePath, content: logContent });
  }

  // ルビ一覧を生成して保存
  let rubyContent = "";
  if (rubyList.length > 0) {
    // 編集済みルビリストがあればそれを使用
    const sorted = [...rubyList].sort((a, b) => {
      if (a.volume !== b.volume) return a.volume - b.volume;
      return a.page - b.page;
    });
    for (const r of sorted) {
      const volStr = String(r.volume).padStart(2, "0");
      const cleanRuby = r.rubyText.replace(/[\s\u3000]/g, "");
      rubyContent += `[${volStr}巻-${r.page}]${r.parentText}(${cleanRuby})\n\n`;
    }
  } else {
    // リンクグループから抽出（従来の処理）
    for (const [, group] of Object.entries(linkedGroups)) {
      const groupTexts = [...group.texts].sort((a, b) => b.fontSize - a.fontSize);
      if (groupTexts.length >= 2) {
        const parentText = groupTexts[0].content;
        for (let t = 1; t < groupTexts.length; t++) {
          const cleanRuby = groupTexts[t].content.replace(/[\s\u3000]/g, "");
          if (/^[・･゛]+$/.test(cleanRuby)) continue;
          rubyContent += `[${group.volumeStr}巻-${group.pageNum}]${parentText}(${cleanRuby})\n\n`;
        }
      }
    }
  }

  if (rubyContent) {
    const rubyPath = `${titleFolderPath}/ルビ一覧.txt`;
    await invoke("write_text_file", { filePath: rubyPath, content: rubyContent });
  }
}

/**
 * プリセットJSON読み込み（スタンドアロン版）
 * filePath のJSONを読み込み、scanPsdStoreに反映する
 * リンクscandataがあれば自動読み込みし、ガイド選択/除外/ルビも復元する
 */
export async function performLoadPresetJson(filePath: string): Promise<void> {
  const store = useScanPsdStore.getState();

  const content = await invoke<string>("read_text_file", { filePath });
  const data = JSON.parse(content) as PresetJsonData;
  store.loadFromPresetJson(data);
  store.setCurrentJsonFilePath(filePath);

  // リンクされたscandataを自動読み込み
  const pd = data.presetData;
  if (pd?.workInfo?.label && pd?.workInfo?.title) {
    const safeLabel = pd.workInfo.label.replace(/[\\/:*?"<>|]/g, "_");
    const safeTitle = pd.workInfo.title.replace(/[\\/:*?"<>|]/g, "_");
    const scandataPath =
      `${store.saveDataBasePath}/${safeLabel}/${safeTitle}_scandata.json`.replace(/\\/g, "/");
    try {
      const scandataContent = await invoke<string>("read_text_file", { filePath: scandataPath });
      const scandataData = JSON.parse(scandataContent) as ScanData;
      store.setScanData(scandataData);
      store.setCurrentScandataFilePath(scandataPath);
      const sd = scandataData as ScanData & {
        selectedGuideSetIndex?: number;
        excludedGuideIndices?: number[];
      };
      if (sd.selectedGuideSetIndex != null) {
        store.setSelectedGuideIndex(sd.selectedGuideSetIndex);
      }
      if (sd.excludedGuideIndices) {
        store.setExcludedGuideIndices(new Set(sd.excludedGuideIndices));
      }
      const rawRuby = scandataData.editedRubyList as unknown[] | undefined;
      if (rawRuby && rawRuby.length > 0) {
        store.setRubyList(normalizeRubyEntries(rawRuby));
      }
    } catch {
      // scandataが見つからない場合、JSON内のguideSetsから最小限のscanDataを構築
      if (pd.guideSets && pd.guideSets.length > 0) {
        const rawStats = pd.fontSizeStats as Record<string, unknown> | undefined;
        let sizeStats: ScanData["sizeStats"] = {
          mostFrequent: null,
          sizes: [],
          excludeRange: null,
          allSizes: {},
        };
        if (rawStats) {
          const mf = rawStats.mostFrequent;
          sizeStats.mostFrequent =
            typeof mf === "number"
              ? { size: mf, count: 0 }
              : ((mf as ScanData["sizeStats"]["mostFrequent"]) ?? null);
          const rawSizes = rawStats.sizes;
          if (Array.isArray(rawSizes)) {
            sizeStats.sizes = rawSizes.map((s: unknown) =>
              typeof s === "number"
                ? { size: s, count: 0 }
                : (s as { size: number; count: number }),
            );
          }
          const rawTop10 = rawStats.top10Sizes;
          if (Array.isArray(rawTop10) && sizeStats.sizes.every((s) => s.count === 0)) {
            const countMap = new Map<number, number>();
            for (const t of rawTop10 as { size: number; count: number }[]) {
              countMap.set(t.size, t.count);
            }
            sizeStats.sizes = sizeStats.sizes.map((s) => ({
              ...s,
              count: countMap.get(s.size) ?? 0,
            }));
            if (typeof mf === "number" && countMap.has(mf)) {
              sizeStats.mostFrequent = { size: mf, count: countMap.get(mf)! };
            }
          }
          sizeStats.excludeRange =
            (rawStats.excludeRange as ScanData["sizeStats"]["excludeRange"]) ?? null;
          sizeStats.allSizes = (rawStats.allSizes as Record<string, number>) ?? {};
        }
        const rawStrokes = pd.strokeSizes ?? [];
        const safeStrokes = rawStrokes.map((s) => ({
          ...s,
          count: s.count ?? 0,
        }));
        const fallbackScanData: ScanData = {
          fonts: [],
          sizeStats,
          allFontSizes: {},
          strokeStats: { sizes: safeStrokes },
          guideSets: pd.guideSets,
          textLayersByDoc: {},
          scannedFolders: {},
          processedFiles: 0,
          workInfo: pd.workInfo ?? store.workInfo,
          textLogByFolder: {},
        };
        store.setScanData(fallbackScanData);
      }
    }
  }
}

/**
 * 指定巻数のスキャンデータを削除（再スキャン可能にする）
 * - scannedFolders / textLogByFolder / folderVolumeMapping から該当フォルダを削除
 * - textLayersByDoc から該当フォルダのドキュメントを削除
 * - fonts / sizeStats / allFontSizes / guideSets / processedFiles を残データから再計算
 * - rubyList / editedRubyList から該当巻のエントリを削除
 */
function performRemoveVolumeData(volume: number): void {
  const store = useScanPsdStore.getState();
  if (!store.scanData) return;

  const scanData = { ...store.scanData };

  // folderVolumeMappingから該当巻のフォルダ名を特定
  const foldersToRemove: string[] = [];
  if (scanData.folderVolumeMapping) {
    for (const [folderName, vol] of Object.entries(scanData.folderVolumeMapping)) {
      if (vol === volume) foldersToRemove.push(folderName);
    }
  }

  // scannedFolders から削除しつつ、削除対象のファイル名を収集
  const docsToRemove = new Set<string>();
  if (scanData.scannedFolders) {
    const newScannedFolders = { ...scanData.scannedFolders };
    for (const fullPath of Object.keys(newScannedFolders)) {
      const pathName = fullPath.split(/[\\/]/).pop() || fullPath;
      if (foldersToRemove.includes(pathName)) {
        for (const fileName of newScannedFolders[fullPath].files) {
          docsToRemove.add(fileName);
        }
        delete newScannedFolders[fullPath];
      }
    }
    scanData.scannedFolders = newScannedFolders;
  }

  // 残存するファイル名を収集（他の巻にも同名ファイルがある場合の保護用）
  const remainingFiles = new Set<string>();
  for (const info of Object.values(scanData.scannedFolders || {})) {
    for (const fileName of info.files) {
      remainingFiles.add(fileName);
    }
  }

  // textLayersByDoc から削除対象ドキュメントを除去（残存巻に同名があれば保持）
  if (scanData.textLayersByDoc) {
    const newTextLayers = { ...scanData.textLayersByDoc };
    for (const docName of docsToRemove) {
      if (!remainingFiles.has(docName)) {
        delete newTextLayers[docName];
      }
    }
    scanData.textLayersByDoc = newTextLayers;
  }

  // textLogByFolder から削除
  if (scanData.textLogByFolder) {
    const newTextLog = { ...scanData.textLogByFolder };
    for (const folderName of foldersToRemove) {
      delete newTextLog[folderName];
    }
    scanData.textLogByFolder = newTextLog;
  }

  // folderVolumeMapping から削除
  if (scanData.folderVolumeMapping) {
    const newMapping = { ...scanData.folderVolumeMapping };
    for (const folderName of foldersToRemove) {
      delete newMapping[folderName];
    }
    scanData.folderVolumeMapping = newMapping;
  }

  // editedRubyList から削除
  if (scanData.editedRubyList) {
    scanData.editedRubyList = scanData.editedRubyList.filter((r) => r.volume !== volume);
  }

  // --- 集計データを残存データから再計算 ---

  // fonts + allFontSizes を再計算
  const fontMap = new Map<
    string,
    { displayName: string; count: number; sizeMap: Map<number, number> }
  >();
  const allFontSizes: Record<string, number> = {};
  for (const layers of Object.values(scanData.textLayersByDoc || {})) {
    for (const layer of layers) {
      const key = layer.fontName;
      if (!fontMap.has(key)) {
        fontMap.set(key, { displayName: layer.displayFontName, count: 0, sizeMap: new Map() });
      }
      const entry = fontMap.get(key)!;
      entry.count++;
      entry.sizeMap.set(layer.fontSize, (entry.sizeMap.get(layer.fontSize) || 0) + 1);
      const sizeKey = String(layer.fontSize);
      allFontSizes[sizeKey] = (allFontSizes[sizeKey] || 0) + 1;
    }
  }
  scanData.fonts = Array.from(fontMap.entries())
    .map(([name, data]) => ({
      name,
      displayName: data.displayName,
      count: data.count,
      sizes: Array.from(data.sizeMap.entries())
        .map(([size, count]) => ({ size, count }))
        .sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => b.count - a.count);
  scanData.allFontSizes = allFontSizes;

  // sizeStats を再計算
  const sizeCountMap = new Map<number, number>();
  for (const [sizeStr, count] of Object.entries(allFontSizes)) {
    sizeCountMap.set(parseFloat(sizeStr), count);
  }
  let mostFrequent: { size: number; count: number } | null = null;
  for (const [size, count] of sizeCountMap) {
    if (!mostFrequent || count > mostFrequent.count) {
      mostFrequent = { size, count };
    }
  }
  const prevExclude = scanData.sizeStats?.excludeRange;
  const prevBaseSize = scanData.sizeStats?.mostFrequent?.size;
  // 基本サイズが変わっていなければ既存のexcludeRangeを維持（ユーザー編集を尊重）
  let excludeRange: { min: number; max: number } | null = null;
  if (mostFrequent && prevBaseSize === mostFrequent.size && prevExclude) {
    excludeRange = prevExclude;
  } else if (mostFrequent) {
    const halfSize = mostFrequent.size / 2;
    excludeRange = { min: halfSize - 1, max: halfSize + 1 };
  }
  scanData.sizeStats = {
    mostFrequent,
    sizes: Array.from(sizeCountMap.entries())
      .map(([size, count]) => ({ size, count }))
      .sort((a, b) => b.count - a.count),
    excludeRange,
    allSizes: allFontSizes,
  };

  // guideSets のドキュメント参照を更新（残存ファイルのみ保持）
  if (scanData.guideSets) {
    scanData.guideSets = scanData.guideSets
      .map((gs) => {
        const filteredDocNames = gs.docNames.filter((d) => remainingFiles.has(d));
        return { ...gs, docNames: filteredDocNames, count: filteredDocNames.length };
      })
      .filter((gs) => gs.count > 0);
  }

  // processedFiles を更新
  scanData.processedFiles = Object.keys(scanData.textLayersByDoc || {}).length;

  // rubyList から削除
  const newRubyList = store.rubyList.filter((r) => r.volume !== volume);

  store.setScanData(scanData);
  store.setRubyList(newRubyList);
}

export function useScanPsdProcessor() {
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // --- スキャン実行 ---
  const startScan = useCallback(async (): Promise<ScanResult | undefined> => {
    const store = useScanPsdStore.getState();
    let scanResult: ScanResult | undefined;

    // フォルダが未設定の場合はダイアログで選択
    if (store.folders.length === 0) {
      const selected = await open({ directory: true, multiple: false });
      if (!selected || typeof selected !== "string") return;

      try {
        const result = await invoke<{ mode: string; folders: { path: string; name: string }[] }>(
          "detect_psd_folders",
          { folderPath: selected },
        );
        if (result.folders.length > 0) {
          for (let i = 0; i < result.folders.length; i++) {
            store.addFolder(result.folders[i].path, result.folders[i].name, i + 1);
          }
        } else {
          const name = selected.split(/[\\/]/).pop() || selected;
          store.addFolder(selected, name, 1);
        }
      } catch {
        const name = selected.split(/[\\/]/).pop() || selected;
        store.addFolder(selected, name, 1);
      }

      if (useScanPsdStore.getState().folders.length === 0) return;
    }

    // フォルダ追加後の最新stateを取得（stale reference回避）
    const freshState = useScanPsdStore.getState();
    // スキャン前のtextLogByFolderキーを記録（ルビ抽出で新規フォルダを特定するため）
    const oldTextLogKeys = new Set(Object.keys(freshState.scanData?.textLogByFolder || {}));
    freshState.setPhase("scanning");
    freshState.setProgress(0, 0, "Photoshopを起動中...");

    // je-nsonman準拠: textLayersByDocはJSXに渡さない
    // JSXはファイル単位のスキップ検出をせず、指定フォルダの全ファイルをスキャンする
    // textLayersByDocのマージはTS側で行う（JSXのJSON肥大化防止も兼ねる）
    const existingForJsx = freshState.scanData
      ? {
          ...freshState.scanData,
          textLayersByDoc: undefined, // JSXには渡さない
        }
      : null;

    const settingsJson = JSON.stringify({
      folders: freshState.folders.map((f) => ({
        path: f.path.replace(/\\/g, "/"),
        volume: f.volume,
      })),
      existingScanData: existingForJsx,
      outputPath: null, // Rust側でtemp_dirを使用
    });

    // Poll progress
    pollingRef.current = setInterval(async () => {
      try {
        const progressJson = await invoke<string | null>("poll_scan_psd_progress");
        if (progressJson) {
          const p = JSON.parse(progressJson);
          useScanPsdStore.getState().setProgress(p.current || 0, p.total || 0, p.message || "");
        }
      } catch {
        /* ignore polling errors */
      }
    }, 500);

    try {
      // スキャン前のworkInfoを保持（ユーザーが事前入力した情報を消さない）
      const preExistingWorkInfo = { ...freshState.workInfo };

      const resultJson = await invoke<string>("run_photoshop_scan_psd", {
        settingsJson,
      });
      const scanData = JSON.parse(resultJson) as ScanData;

      // ユーザーが事前入力したworkInfoをscanDataに反映（元スクリプト準拠）
      // スキャン結果のworkInfoは空のデフォルト値なので、ユーザー入力値で上書き
      const mergedWorkInfo: ScanWorkInfo = { ...preExistingWorkInfo };
      // スキャン結果側に値がある場合のみマージ（空文字でない場合）
      if (scanData.workInfo) {
        const scanWi = scanData.workInfo as unknown as Record<string, unknown>;
        const preWi = preExistingWorkInfo as unknown as Record<string, unknown>;
        const merged = mergedWorkInfo as unknown as Record<string, unknown>;
        for (const key of Object.keys(scanWi)) {
          // ユーザーが事前入力していない項目のみスキャン結果で埋める
          if (!preWi[key] && scanWi[key]) {
            merged[key] = scanWi[key];
          }
        }
      }
      scanData.workInfo = mergedWorkInfo;

      // folderVolumeMappingを既存データとマージ（追加スキャン時に前回分を失わない）
      if (freshState.scanData?.folderVolumeMapping) {
        scanData.folderVolumeMapping = {
          ...freshState.scanData.folderVolumeMapping,
          ...(scanData.folderVolumeMapping || {}),
        };
      }

      // textLayersByDocをTS側でマージ（je-nsonman準拠: JSXには渡さずTS側で管理）
      // 新スキャン結果で上書き、既存データは保持
      if (freshState.scanData?.textLayersByDoc) {
        scanData.textLayersByDoc = {
          ...freshState.scanData.textLayersByDoc,
          ...(scanData.textLayersByDoc || {}),
        };
      }

      // strokeStatsをマージ（JSX側ではマージされないため、TS側で行う）
      if (freshState.scanData?.strokeStats?.sizes?.length) {
        const oldSizes = freshState.scanData.strokeStats.sizes;
        const newSizes = scanData.strokeStats?.sizes || [];
        const mergedMap = new Map<
          number,
          { count: number; fontSizes: Set<number>; maxFontSize: number | null }
        >();
        for (const s of oldSizes) {
          mergedMap.set(s.size, {
            count: s.count,
            fontSizes: new Set(s.fontSizes),
            maxFontSize: s.maxFontSize,
          });
        }
        for (const s of newSizes) {
          const existing = mergedMap.get(s.size);
          if (existing) {
            existing.count += s.count;
            for (const fs of s.fontSizes) existing.fontSizes.add(fs);
            if (
              s.maxFontSize != null &&
              (existing.maxFontSize == null || s.maxFontSize > existing.maxFontSize)
            ) {
              existing.maxFontSize = s.maxFontSize;
            }
          } else {
            mergedMap.set(s.size, {
              count: s.count,
              fontSizes: new Set(s.fontSizes),
              maxFontSize: s.maxFontSize,
            });
          }
        }
        scanData.strokeStats = {
          sizes: [...mergedMap.entries()]
            .map(([size, data]) => ({
              size,
              count: data.count,
              fontSizes: [...data.fontSizes].sort((a, b) => b - a),
              maxFontSize: data.maxFontSize,
            }))
            .sort((a, b) => b.count - a.count),
        };
      }

      // allFontSizesをマージ（JSX側では新スキャン分のみのため）
      if (freshState.scanData?.allFontSizes) {
        const merged: Record<string, number> = { ...freshState.scanData.allFontSizes };
        for (const [size, count] of Object.entries(scanData.allFontSizes || {})) {
          merged[size] = (merged[size] || 0) + count;
        }
        scanData.allFontSizes = merged;
      }

      store.setScanData(scanData);
      store.setWorkInfo(mergedWorkInfo);

      if (scanData.editedRubyList) {
        // je-nsonman互換: parent/ruby → parentText/rubyText, volume文字列→数値
        store.setRubyList(normalizeRubyEntries(scanData.editedRubyList as unknown[]));
      }

      // 新しくスキャンしたフォルダからルビを抽出して追加（je-nsonman appendRubyFromNewFolders 準拠）
      // JSXの determineTargetFolders がサブフォルダに分解するため、
      // store.foldersの名前ではなく textLogByFolder のキー差分で新規フォルダを特定する
      const newTextLogKeys = Object.keys(scanData.textLogByFolder || {}).filter(
        (k) => !oldTextLogKeys.has(k),
      );
      appendRubiesFromFolders(newTextLogKeys);

      // ガイドセットの自動選択（元スクリプト準拠: 有効タチキリ優先 → 使用回数順）
      if (scanData.guideSets && scanData.guideSets.length > 0) {
        const bestIndex = autoSelectGuideSet(scanData.guideSets);
        if (bestIndex != null) {
          useScanPsdStore.getState().setSelectedGuideIndex(bestIndex);
        }
      }

      // 検出フォントを自動的にプリセットに追加（je-nsonman準拠）
      autoRegisterDetectedFonts(scanData);

      // スキャン完了後に自動保存
      try {
        await performPresetJsonSave();
      } catch (e) {
        console.error("Auto save after scan failed:", e);
      }

      // テキストログを自動出力（元スクリプト準拠: スキャン完了後に自動実行）
      const latestState = useScanPsdStore.getState();
      if (
        latestState.scanData?.textLogByFolder &&
        latestState.workInfo.label &&
        latestState.workInfo.title
      ) {
        try {
          await performExportTextLog();
        } catch (e) {
          console.error("Auto text log export failed:", e);
        }
      }

      // 完了サマリーを返す
      const finalState = useScanPsdStore.getState();
      scanResult = {
        success: true,
        processedFiles: scanData.processedFiles || 0,
        newFolders: newTextLogKeys,
        rubyCount: finalState.rubyList.length,
      };
    } catch (e) {
      console.error("Scan PSD failed:", e);
      scanResult = { success: false, error: String(e) };
    } finally {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      // スキャン完了後にフォルダリストをクリア（次回の追加スキャン時に重複しないように）
      useScanPsdStore.getState().clearFolders();
      useScanPsdStore.getState().setPhase("idle");
    }
    return scanResult;
  }, []);

  // --- プリセットJSON保存（パス自動計算 + 仮保存対応） ---
  const savePresetJson = useCallback(async (): Promise<boolean> => {
    useScanPsdStore.getState().setPhase("saving");
    try {
      return await performPresetJsonSave();
    } catch (e) {
      console.error("Save preset JSON failed:", e);
      throw e;
    } finally {
      useScanPsdStore.getState().setPhase("idle");
    }
  }, []);

  // --- プリセットJSON読み込み ---
  const loadPresetJson = useCallback(async (filePath: string) => {
    const store = useScanPsdStore.getState();

    try {
      const content = await invoke<string>("read_text_file", { filePath });
      const data = JSON.parse(content) as PresetJsonData;
      store.loadFromPresetJson(data);
      store.setCurrentJsonFilePath(filePath);

      // リンクされたscandataを自動読み込み（全ガイドセット等を復元するため）
      const pd = data.presetData;
      if (pd?.workInfo?.label && pd?.workInfo?.title) {
        const safeLabel = pd.workInfo.label.replace(/[\\/:*?"<>|]/g, "_");
        const safeTitle = pd.workInfo.title.replace(/[\\/:*?"<>|]/g, "_");
        const scandataPath =
          `${store.saveDataBasePath}/${safeLabel}/${safeTitle}_scandata.json`.replace(/\\/g, "/");
        try {
          const scandataContent = await invoke<string>("read_text_file", {
            filePath: scandataPath,
          });
          const scandataData = JSON.parse(scandataContent) as ScanData;
          store.setScanData(scandataData);
          store.setCurrentScandataFilePath(scandataPath);
          // scandataからガイド選択・除外状態を復元
          const sd = scandataData as ScanData & {
            selectedGuideSetIndex?: number;
            excludedGuideIndices?: number[];
          };
          if (sd.selectedGuideSetIndex != null) {
            store.setSelectedGuideIndex(sd.selectedGuideSetIndex);
          }
          if (sd.excludedGuideIndices) {
            store.setExcludedGuideIndices(new Set(sd.excludedGuideIndices));
          }
          // scandataからルビリストを復元（je-nsonman互換: parent/ruby → parentText/rubyText）
          const rawRuby = scandataData.editedRubyList as unknown[] | undefined;
          if (rawRuby && rawRuby.length > 0) {
            store.setRubyList(normalizeRubyEntries(rawRuby));
          }
        } catch {
          // scandataが見つからない場合、JSON内のguideSetsから最小限のscanDataを構築
          if (pd.guideSets && pd.guideSets.length > 0) {
            // 元スクリプトのfontSizeStatsはアプリと異なるフォーマットの可能性あり
            // mostFrequent: number (元) → {size,count}|null (アプリ)
            // sizes: number[] (元) → {size,count}[] (アプリ)
            // top10Sizes: {size,count}[] (元) → 存在しない (アプリ)
            const rawStats = pd.fontSizeStats as Record<string, unknown> | undefined;
            let sizeStats: ScanData["sizeStats"] = {
              mostFrequent: null,
              sizes: [],
              excludeRange: null,
              allSizes: {},
            };
            if (rawStats) {
              const mf = rawStats.mostFrequent;
              sizeStats.mostFrequent =
                typeof mf === "number"
                  ? { size: mf, count: 0 }
                  : ((mf as ScanData["sizeStats"]["mostFrequent"]) ?? null);
              const rawSizes = rawStats.sizes;
              if (Array.isArray(rawSizes)) {
                sizeStats.sizes = rawSizes.map((s: unknown) =>
                  typeof s === "number"
                    ? { size: s, count: 0 }
                    : (s as { size: number; count: number }),
                );
              }
              const rawTop10 = rawStats.top10Sizes;
              if (Array.isArray(rawTop10) && sizeStats.sizes.every((s) => s.count === 0)) {
                // top10Sizesからcount情報を補完
                const countMap = new Map<number, number>();
                for (const t of rawTop10 as { size: number; count: number }[]) {
                  countMap.set(t.size, t.count);
                }
                sizeStats.sizes = sizeStats.sizes.map((s) => ({
                  ...s,
                  count: countMap.get(s.size) ?? 0,
                }));
                if (typeof mf === "number" && countMap.has(mf)) {
                  sizeStats.mostFrequent = { size: mf, count: countMap.get(mf)! };
                }
              }
              sizeStats.excludeRange =
                (rawStats.excludeRange as ScanData["sizeStats"]["excludeRange"]) ?? null;
              sizeStats.allSizes = (rawStats.allSizes as Record<string, number>) ?? {};
            }

            // strokeSizesも元スクリプトではcountが無い場合がある
            const rawStrokes = pd.strokeSizes ?? [];
            const safeStrokes = rawStrokes.map((s) => ({
              ...s,
              count: s.count ?? 0,
            }));

            const fallbackScanData: ScanData = {
              fonts: [],
              sizeStats,
              allFontSizes: {},
              strokeStats: { sizes: safeStrokes },
              guideSets: pd.guideSets,
              textLayersByDoc: {},
              scannedFolders: {},
              processedFiles: 0,
              workInfo: pd.workInfo ?? store.workInfo,
              textLogByFolder: {},
            };
            store.setScanData(fallbackScanData);
          }
        }
      }
    } catch (e) {
      console.error("Load preset JSON failed:", e);
      throw e;
    }
  }, []);

  // --- scandata保存 ---
  const saveScandata = useCallback(async (filePath: string) => {
    const store = useScanPsdStore.getState();
    store.setPhase("saving");

    try {
      const data: ScanData & {
        presets?: Record<string, FontPreset[]>;
        editedRubyList?: RubyEntry[];
        editedWorkInfo?: ScanWorkInfo;
      } = {
        ...(store.scanData || ({} as ScanData)),
        workInfo: store.workInfo,
        presets: store.presetSets,
        editedRubyList: store.rubyList,
      };

      await invoke("write_text_file", {
        filePath,
        content: JSON.stringify(data, null, 2),
      });

      store.setCurrentScandataFilePath(filePath);
    } catch (e) {
      console.error("Save scandata failed:", e);
      throw e;
    } finally {
      useScanPsdStore.getState().setPhase("idle");
    }
  }, []);

  // --- scandata読み込み ---
  const loadScandata = useCallback(async (filePath: string) => {
    const store = useScanPsdStore.getState();

    try {
      const content = await invoke<string>("read_text_file", { filePath });
      const data = JSON.parse(content) as ScanData;
      store.loadFromScandata(data);
      store.setCurrentScandataFilePath(filePath);
    } catch (e) {
      console.error("Load scandata failed:", e);
      throw e;
    }
  }, []);

  // --- テキストログ出力（元スクリプト exportTextLog 準拠） ---
  const exportTextLog = useCallback(async () => {
    useScanPsdStore.getState().setPhase("exporting");
    try {
      await performExportTextLog();
    } catch (e) {
      console.error("Export text log failed:", e);
      throw e;
    } finally {
      useScanPsdStore.getState().setPhase("idle");
    }
  }, []);

  // --- ルビ一覧外部ファイル保存 ---
  const saveRubyList = useCallback(async () => {
    const store = useScanPsdStore.getState();
    if (store.rubyList.length === 0) return;

    const result = await save({
      defaultPath: `${store.workInfo.title || "作品"}_ルビ一覧.txt`,
      filters: [{ name: "テキストファイル", extensions: ["txt"] }],
    });
    if (!result) return;

    try {
      const lines: string[] = [];
      lines.push("親文字\tルビ\t巻\tページ\t順番");
      for (const r of store.rubyList) {
        lines.push(`${r.parentText}\t${r.rubyText}\t${r.volume}\t${r.page}\t${r.order}`);
      }

      await invoke("write_text_file", {
        filePath: result,
        content: lines.join("\n"),
      });
    } catch (e) {
      console.error("Save ruby list failed:", e);
      throw e;
    }
  }, []);

  // --- 指定巻数のスキャンデータ削除 ---
  const removeVolumeData = useCallback(async (volume: number) => {
    performRemoveVolumeData(volume);
    // 削除後に自動保存
    try {
      await performPresetJsonSave();
    } catch (e) {
      console.error("Auto save after volume removal failed:", e);
    }
  }, []);

  // --- scandataファイル選択（OSダイアログ：scandata用のみ残す） ---
  const selectScandataFile = useCallback(async (): Promise<string | null> => {
    const result = await open({
      directory: false,
      multiple: false,
      filters: [{ name: "JSON", extensions: ["json"] }],
      defaultPath: useScanPsdStore.getState().saveDataBasePath,
    });
    return result && typeof result === "string" ? result : null;
  }, []);

  return {
    startScan,
    savePresetJson,
    loadPresetJson,
    saveScandata,
    loadScandata,
    exportTextLog,
    saveRubyList,
    removeVolumeData,
    selectScandataFile,
  };
}
