import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { join, desktopDir } from "@tauri-apps/api/path";
import { usePsdStore } from "../store/psdStore";
import { useTiffStore } from "../store/tiffStore";
import { useScanPsdStore } from "../store/scanPsdStore";
import type { TiffResult, TiffFileOverride, TiffCropBounds } from "../types/tiff";
import type { PsdFile } from "../types";
import type { FontResolveInfo } from "./useFontResolver";
import { buildScanDataFromFiles } from "../lib/agPsdScanner";
import { performPresetJsonSave, performExportTextLog } from "./useScanPsdProcessor";
import { getAutoSubName } from "../types/scanPsd";

/** 選択範囲をプリセットJSONのselectionRangesに追記する */
async function appendSelectionRangeToJson(
  jsonPath: string,
  bounds: TiffCropBounds,
  docSize: { width: number; height: number } | null,
): Promise<void> {
  const content = await invoke<string>("read_text_file", { filePath: jsonPath });
  const data = JSON.parse(content);
  if (!data.presetData) data.presetData = {};
  const ranges = Array.isArray(data.presetData.selectionRanges)
    ? data.presetData.selectionRanges
    : [];

  // 同じboundsが既にあればスキップ
  const exists = ranges.some(
    (r: { bounds?: TiffCropBounds }) =>
      r.bounds &&
      r.bounds.left === bounds.left &&
      r.bounds.top === bounds.top &&
      r.bounds.right === bounds.right &&
      r.bounds.bottom === bounds.bottom,
  );
  if (!exists) {
    ranges.push({
      label: `${bounds.right - bounds.left}x${bounds.bottom - bounds.top}`,
      units: "px",
      bounds,
      size: { width: bounds.right - bounds.left, height: bounds.bottom - bounds.top },
      documentSize: docSize ?? { width: bounds.right, height: bounds.bottom },
      savedAt: new Date().toISOString(),
    });
    data.presetData.selectionRanges = ranges;
    await invoke("write_text_file", {
      filePath: jsonPath,
      content: JSON.stringify(data, null, 2),
    });
  }
}

interface TiffConvertResult {
  fileName: string;
  success: boolean;
  outputPath: string | null;
  error: string | null;
}

interface TiffConvertResponse {
  results: TiffConvertResult[];
  outputDir: string;
  jpgOutputDir: string | null;
}

export function useTiffProcessor() {

  // 出力ディレクトリを準備
  const getOutputDir = useCallback(async (): Promise<string> => {
    const settings = useTiffStore.getState().settings;
    if (settings.output.outputDirectory) {
      return settings.output.outputDirectory;
    }
    const desktop = await desktopDir();
    // JPGのみ（TIFF OFF）の場合は JPG_Output
    const folderName = !settings.output.proceedAsTiff && settings.output.outputJpg
      ? "JPG_Output" : "TIF_Output";
    return await join(desktop, "Script_Output", folderName);
  }, []);

  // ファイル毎の最終設定をマージして設定JSONを構築
  const buildSettingsJson = useCallback(async (targetFiles: PsdFile[]) => {
    const store = useTiffStore.getState();
    const settings = store.settings;
    const fileOverrides = store.fileOverrides;
    const outputDir = await getOutputDir();
    const flatten = settings.rename.flattenSubfolders;

    // サブフォルダ別インデックスを事前計算（flatten=false時に各サブフォルダで連番リセット）
    const subfolderIndices: number[] = [];
    if (!flatten) {
      const counters = new Map<string, number>();
      for (const file of targetFiles) {
        const key = file.subfolderName || "";
        const idx = counters.get(key) ?? 0;
        subfolderIndices.push(idx);
        counters.set(key, idx + 1);
      }
    }

    const files = targetFiles.map((file, index) => {
      const override: TiffFileOverride | undefined = fileOverrides.get(file.id);
      const skip = override?.skip ?? false;

      // flatten=false時はサブフォルダ内インデックス、flatten=true時はグローバルインデックス
      const fileIndex = flatten ? index : subfolderIndices[index];

      // カラーモード解決
      let colorMode: string = settings.colorMode;
      if (settings.colorMode === "perPage") {
        const pageNum = fileIndex + 1;
        const matched = settings.pageRangeRules.find(
          (r) => pageNum >= r.fromPage && pageNum <= r.toPage
        );
        colorMode = matched?.colorMode ?? settings.defaultColorForPerPage;
      }
      if (override?.colorMode && override.colorMode !== "perPage") {
        colorMode = override.colorMode;
      }

      // ぼかし解決
      const applyBlur = override?.blurEnabled ?? settings.blur.enabled;
      const blurRadius = override?.blurRadius ?? settings.blur.radius;

      // 部分ぼかし
      const pageNum = fileIndex + 1;
      const partialBlurEntry = settings.partialBlurEntries.find((e) => e.pageNumber === pageNum);

      // リネーム解決
      // 拡張子: TIFF ON → .tif、JPGのみ → .jpg、PSD → .psd
      const ext = settings.output.proceedAsTiff ? ".tif"
        : settings.output.outputJpg ? ".jpg" : ".psd";
      let outputName: string;
      if (settings.rename.keepOriginalName) {
        const baseName = file.fileName.replace(/\.[^.]+$/, "");
        outputName = baseName + ext;
      } else if (settings.rename.extractPageNumber) {
        const match = file.fileName.match(/(\d+)\s*\.[^.]+$/);
        const extractedNum = match ? parseInt(match[1]) : fileIndex + 1;
        const num = extractedNum + (settings.rename.startNumber - 1);
        outputName = String(num).padStart(settings.rename.padding, "0") + ext;
      } else {
        const num = fileIndex + settings.rename.startNumber;
        outputName = String(num).padStart(settings.rename.padding, "0") + ext;
      }

      // サブフォルダ出力パス解決
      // flatten=false && subfolderNameあり → outputDir/subfolderName/
      // flatten=true または subfolderNameなし → outputDir/
      let fileOutputDir = outputDir;
      if (!flatten && file.subfolderName) {
        fileOutputDir = outputDir + "/" + file.subfolderName;
      }

      // TIFF+JPG同時出力時: JPG出力先を計算（TIF_Outputの兄弟にJPG_Output）
      let jpgOutputPath: string | null = null;
      if (settings.output.proceedAsTiff && settings.output.outputJpg) {
        const jpgBaseDir = outputDir.replace(/TIF_Output/g, "JPG_Output");
        let jpgFileDir = jpgBaseDir;
        if (!flatten && file.subfolderName) {
          jpgFileDir = jpgBaseDir + "/" + file.subfolderName;
        }
        jpgOutputPath = jpgFileDir.replace(/\\/g, "/");
      }

      return {
        path: file.filePath.replace(/\\/g, "/"),
        outputPath: fileOutputDir.replace(/\\/g, "/"),
        outputName,
        colorMode,
        applyBlur: applyBlur && colorMode === "mono", // ぼかしはモノクロ時のみ
        blurRadius,
        partialBlur: partialBlurEntry
          ? {
              blurRadius: partialBlurEntry.blurRadius,
              bounds: settings.crop.bounds,
            }
          : null,
        skipCrop: skip || !settings.crop.enabled,
        cropBounds: settings.crop.bounds,
        psbConvert: settings.psbConvertToTiff,
        subfolderName: file.subfolderName || "",
        jpgOutputPath,
      };
    });

    // スキップされたファイルを除外
    const activeFiles = files.filter((_, i) => {
      const override = fileOverrides.get(targetFiles[i].id);
      return !(override?.skip);
    });

    const settingsJson = JSON.stringify({
      files: activeFiles,
      globalSettings: {
        targetWidth: settings.resize.targetWidth,
        targetHeight: settings.resize.targetHeight,
        aspectRatio: [settings.crop.aspectRatio.w, settings.crop.aspectRatio.h],
        reorganizeText: settings.text.reorganize,
        proceedAsTiff: settings.output.proceedAsTiff,
        outputJpg: settings.output.outputJpg,
        saveIntermediatePsd: settings.output.saveIntermediatePsd,
        mergeAfterColor: settings.output.mergeAfterColorConvert,
      },
    }, null, 2);

    // TIFF+JPG同時出力時のJPG出力先ベースディレクトリ
    const jpgOutputDir = settings.output.proceedAsTiff && settings.output.outputJpg
      ? outputDir.replace(/TIF_Output/g, "JPG_Output")
      : null;

    return { settingsJson, outputDir, jpgOutputDir, activeCount: activeFiles.length };
  }, [getOutputDir]);

  /**
   * ag-psd ベースの自動スキャン＆JSON保存
   * TIFF処理と並列実行される
   */
  const runAutoScan = useCallback(async (allFiles: PsdFile[]) => {
    const tiffState = useTiffStore.getState();
    if (!tiffState.autoScanEnabled) return;

    try {
      // 1. フォント名解決
      const postScriptNames = new Set<string>();
      for (const file of allFiles) {
        if (!file.metadata?.layerTree) continue;
        const collect = (layers: import("../types").LayerNode[]) => {
          for (const l of layers) {
            if (l.type === "text" && l.textInfo) {
              for (const f of l.textInfo.fonts) postScriptNames.add(f);
            }
            if (l.children) collect(l.children);
          }
        };
        collect(file.metadata.layerTree);
      }

      const fontResolveMap = postScriptNames.size > 0
        ? await invoke<Record<string, FontResolveInfo>>("resolve_font_names", {
            postscriptNames: [...postScriptNames],
          })
        : {};

      // 2. ScanData構築
      const scanPsdState = useScanPsdStore.getState();
      const scanData = buildScanDataFromFiles(allFiles, {
        fontResolveMap,
        volume: tiffState.autoScanVolume,
        existingWorkInfo: scanPsdState.workInfo.title ? scanPsdState.workInfo : undefined,
      });

      // 3. scanPsdStore にデータ反映
      scanPsdState.setScanData(scanData);
      if (!scanPsdState.workInfo.title) {
        // workInfoが未設定の場合はscanDataのworkInfoを使用
        scanPsdState.setWorkInfo(scanData.workInfo);
      } else {
        // 巻数だけ更新
        scanPsdState.setWorkInfo({ volume: tiffState.autoScanVolume });
      }

      // 4. フォント自動登録
      const { presetSets, currentSetName } = useScanPsdStore.getState();
      const registeredFonts = new Set<string>();
      for (const list of Object.values(presetSets)) {
        for (const p of list) registeredFonts.add(p.font);
      }
      const unregistered = scanData.fonts.filter((f) => !registeredFonts.has(f.name));
      if (unregistered.length > 0) {
        const targetSet = currentSetName || "デフォルト";
        for (const f of unregistered) {
          useScanPsdStore.getState().addFontToPreset(targetSet, {
            name: f.displayName || f.name,
            subName: getAutoSubName(f.name),
            font: f.name,
            description: `使用回数: ${f.count}`,
          });
        }
      }

      // 5. ガイド自動選択
      if (scanData.guideSets.length > 0 && scanPsdState.selectedGuideIndex == null) {
        // autoSelectGuideSet ロジック（isValidTachikiriGuideSet準拠）
        const indexed = scanData.guideSets.map((gs, i) => {
          const centerX = gs.docWidth / 2;
          const centerY = gs.docHeight / 2;
          let hasAbove = false, hasBelow = false, hasLeft = false, hasRight = false;
          for (const h of gs.horizontal) {
            if (Math.abs(h - centerY) <= 1) continue;
            if (h < centerY) hasAbove = true; else hasBelow = true;
          }
          for (const v of gs.vertical) {
            if (Math.abs(v - centerX) <= 1) continue;
            if (v < centerX) hasLeft = true; else hasRight = true;
          }
          const valid = hasAbove && hasBelow && hasLeft && hasRight;
          return { i, valid, count: gs.count };
        });
        indexed.sort((a, b) => {
          if (a.valid !== b.valid) return (b.valid ? 1 : 0) - (a.valid ? 1 : 0);
          return b.count - a.count;
        });
        scanPsdState.setSelectedGuideIndex(indexed[0].i);
      }

      // 6. プリセットJSON保存 + 選択範囲登録 + テキストログ出力
      const hasRequiredInfo = !!(useScanPsdStore.getState().workInfo.title && useScanPsdStore.getState().workInfo.label);
      if (hasRequiredInfo) {
        await performPresetJsonSave();

        // 選択範囲をJSONに登録（registerSelectionRangeフラグ時）
        const tiffState = useTiffStore.getState();
        if (tiffState.registerSelectionRange && tiffState.settings.crop.bounds) {
          try {
            const jsonPath = useScanPsdStore.getState().currentJsonFilePath;
            if (jsonPath) {
              await appendSelectionRangeToJson(jsonPath, tiffState.settings.crop.bounds, tiffState.referenceImageSize);
            }
          } catch {
            // 選択範囲登録失敗はJSON成功に影響させない
          }
        }

        // テキストログ出力（textLogFolderPathが設定済みの場合）
        const { textLogFolderPath } = useScanPsdStore.getState();
        let textLogSaved = false;
        if (textLogFolderPath) {
          try {
            await performExportTextLog();
            textLogSaved = true;
          } catch {
            // テキストログ失敗はJSON成功に影響させない
          }
        }

        const savedPath = useScanPsdStore.getState().currentJsonFilePath;
        const savedScandataPath = useScanPsdStore.getState().currentScandataFilePath;
        useTiffStore.getState().setAutoScanJsonResult({
          success: true,
          filePath: savedPath || undefined,
          scandataPath: savedScandataPath || undefined,
          fontCount: scanData.fonts.length,
          guideSetCount: scanData.guideSets.length,
          textLogSaved,
        });
      } else {
        useTiffStore.getState().setAutoScanJsonResult({
          success: false,
          error: "レーベル・タイトルが未設定です（Scan PSDタブで設定してください）",
          fontCount: scanData.fonts.length,
          guideSetCount: scanData.guideSets.length,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      useTiffStore.getState().setAutoScanJsonResult({
        success: false,
        error: `スキャンエラー: ${msg}`,
      });
    }
  }, []);

  // 共通処理実行
  const processFiles = useCallback(async (targetFiles: PsdFile[]) => {
    if (targetFiles.length === 0) return;

    const store = useTiffStore.getState();
    const { settings } = store;

    // クロップ有効だが範囲未設定の場合は実行を阻止
    if (settings.crop.enabled && !settings.crop.bounds) {
      alert("クロップ範囲が設定されていません。\nクロップエディタで範囲を設定してください。");
      return;
    }

    store.setIsProcessing(true);
    store.clearResults();
    store.setAutoScanJsonResult(null);
    store.setProgress(0, targetFiles.length);
    store.setProcessingDuration(null);
    const startTime = Date.now();

    // ag-psd スキャンを並列起動（TIFF処理と同時実行）
    const allFiles = usePsdStore.getState().files;
    const autoScanPromise = runAutoScan(allFiles);

    try {
      const { settingsJson, outputDir, jpgOutputDir, activeCount } = await buildSettingsJson(targetFiles);

      if (activeCount === 0) {
        store.setIsProcessing(false);
        await autoScanPromise;
        return;
      }

      store.setCurrentFile("Photoshopで処理中...");

      const response = await invoke<TiffConvertResponse>("run_photoshop_tiff_convert", {
        settingsJson,
        outputDir,
        jpgOutputDir: jpgOutputDir ?? "",
      });

      // 結果を処理
      for (const r of response.results) {
        const result: TiffResult = {
          fileName: r.fileName,
          success: r.success,
          outputPath: r.outputPath ?? undefined,
          error: r.error ?? undefined,
        };
        store.addResult(result);
      }

      store.setLastOutputDir(response.outputDir);
      store.setLastJpgOutputDir(response.jpgOutputDir ?? null);

      // autoScanの完了を待つ
      await autoScanPromise;

      store.setProcessingDuration(Date.now() - startTime);
      store.setProgress(response.results.length, response.results.length);
      store.setShowResultDialog(true);
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      store.addResult({
        fileName: "処理エラー",
        success: false,
        error: errorMsg,
      });
      await autoScanPromise;
      store.setProcessingDuration(Date.now() - startTime);
      store.setShowResultDialog(true);
    } finally {
      store.setIsProcessing(false);
      store.setCurrentFile(null);
    }
  }, [buildSettingsJson, runAutoScan]);

  const convertSelectedFiles = useCallback(async () => {
    const files = usePsdStore.getState().files;
    const selectedIds = usePsdStore.getState().selectedFileIds;
    const selected = files.filter((f) => selectedIds.includes(f.id));
    await processFiles(selected);
  }, [processFiles]);

  const convertAllFiles = useCallback(async () => {
    const files = usePsdStore.getState().files;
    await processFiles(files);
  }, [processFiles]);

  return { convertSelectedFiles, convertAllFiles };
}
