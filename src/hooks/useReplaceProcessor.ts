import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useReplaceStore } from "../store/replaceStore";
import type { FilePair, PairingJob, ReplaceResult, ScannedFileGroup } from "../types/replace";

interface PhotoshopResult {
  filePath: string;
  success: boolean;
  changes: string[];
  error: string | null;
}

// --- ヘルパー: ファイル名からベースネーム（拡張子なし）を取得 ---
function getBaseName(fullPath: string): string {
  const name = fullPath.split(/[\\/]/).pop() || "";
  return name.replace(/\.(psd|psb|tif|tiff)$/i, "");
}

// --- ヘルパー: ファイル名から表示名を取得 ---
function getDisplayName(fullPath: string): string {
  return fullPath.split(/[\\/]/).pop() || "";
}

// --- ヘルパー: フォルダ名を取得 ---
function getFolderName(fullPath: string): string {
  return fullPath.split(/[\\/]/).pop() || "";
}

// --- ヘルパー: ファイル名から数字(ページ番号)を抽出 ---
function getPageNumber(fileName: string): number | null {
  const decoded = decodeURIComponent(fileName);
  const patterns = [
    /_p(\d+)/i,
    /page(?:[ _-])?(\d+)/i,
    /(?:^|[._-])(\d+)\.[a-z0-9]+$/i,
    /^(\d+)(?:[._-])/i,
    /(?:[._-])(\d+)(?=[._a-zA-Z-])/i,
    /(\d+)/,
  ];
  for (const pattern of patterns) {
    const match = decoded.match(pattern);
    if (match?.[1]) return parseInt(match[1], 10);
  }
  return null;
}

// --- ヘルパー: リンク文字自動検出 ---
function autoDetectLinkCharacter(sourceFiles: string[], targetFiles: string[]): string | null {
  const diffs: Record<string, number> = {};

  const sourceBaseNames = new Set(sourceFiles.map(getBaseName));
  const targetBaseNames = new Set(targetFiles.map(getBaseName));

  for (const sBase of sourceBaseNames) {
    for (const tBase of targetBaseNames) {
      let diff = "";
      if (sBase.length > tBase.length && sBase.includes(tBase)) {
        diff = sBase.replace(tBase, "");
      } else if (tBase.length > sBase.length && tBase.includes(sBase)) {
        diff = tBase.replace(sBase, "");
      }
      if (diff) {
        diffs[diff] = (diffs[diff] || 0) + 1;
      }
    }
  }

  let mostFrequent: string | null = null;
  let maxCount = 0;
  for (const [key, count] of Object.entries(diffs)) {
    if (count > maxCount) {
      maxCount = count;
      mostFrequent = key;
    }
  }
  return mostFrequent;
}

// --- ヘルパー: フォルダ名から数字を抽出 ---
function getNumberFromFolderName(folderPath: string): number | null {
  const name = getFolderName(folderPath);
  const match = name.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

// --- ペアリングアルゴリズム ---

function pairByFileOrder(sourceFiles: string[], targetFiles: string[]): FilePair[] {
  const pairs: FilePair[] = [];
  const len = Math.min(sourceFiles.length, targetFiles.length);
  for (let i = 0; i < len; i++) {
    pairs.push({
      sourceFile: sourceFiles[i],
      sourceName: getDisplayName(sourceFiles[i]),
      targetFile: targetFiles[i],
      targetName: getDisplayName(targetFiles[i]),
      pairIndex: 0, // assigned later
    });
  }
  return pairs;
}

function pairByNumericKey(sourceFiles: string[], targetFiles: string[]): FilePair[] {
  const sourceMap = new Map<number, string>();
  for (const f of sourceFiles) {
    const key = getPageNumber(getDisplayName(f));
    if (key !== null) sourceMap.set(key, f);
  }

  const pairs: FilePair[] = [];
  for (const f of targetFiles) {
    const key = getPageNumber(getDisplayName(f));
    if (key !== null && sourceMap.has(key)) {
      pairs.push({
        sourceFile: sourceMap.get(key)!,
        sourceName: getDisplayName(sourceMap.get(key)!),
        targetFile: f,
        targetName: getDisplayName(f),
        pairIndex: 0,
      });
    }
  }
  return pairs;
}

function pairByLinkCharacter(
  sourceFiles: string[],
  targetFiles: string[],
  linkChar: string,
): FilePair[] {
  const normalize = (name: string) => name.split(linkChar).join("");

  const sourceMap = new Map<string, { file: string; hasChar: boolean }>();
  for (const f of sourceFiles) {
    const name = getBaseName(f);
    const base = normalize(name);
    sourceMap.set(base, { file: f, hasChar: name.includes(linkChar) });
  }

  const targetMap = new Map<string, { file: string; hasChar: boolean }>();
  for (const f of targetFiles) {
    const name = getBaseName(f);
    const base = normalize(name);
    targetMap.set(base, { file: f, hasChar: name.includes(linkChar) });
  }

  const pairs: FilePair[] = [];
  for (const [base, sourceInfo] of sourceMap) {
    const targetInfo = targetMap.get(base);
    if (targetInfo && sourceInfo.hasChar !== targetInfo.hasChar) {
      pairs.push({
        sourceFile: sourceInfo.file,
        sourceName: getDisplayName(sourceInfo.file),
        targetFile: targetInfo.file,
        targetName: getDisplayName(targetInfo.file),
        pairIndex: 0,
      });
    }
  }
  return pairs;
}

export function useReplaceProcessor() {
  const folders = useReplaceStore((s) => s.folders);
  const settings = useReplaceStore((s) => s.settings);
  const setPhase = useReplaceStore((s) => s.setPhase);
  const setProgress = useReplaceStore((s) => s.setProgress);
  const setCurrentPair = useReplaceStore((s) => s.setCurrentPair);
  const addResult = useReplaceStore((s) => s.addResult);
  const clearResults = useReplaceStore((s) => s.clearResults);
  const setPairingJobs = useReplaceStore((s) => s.setPairingJobs);
  const setDetectedLinkChar = useReplaceStore((s) => s.setDetectedLinkChar);
  const setScannedFileGroups = useReplaceStore((s) => s.setScannedFileGroups);
  const openModal = useReplaceStore((s) => s.openModal);

  // --- ペアリングを計算 ---
  const computePairs = useCallback(
    (
      sourceFiles: string[],
      targetFiles: string[],
    ): { pairs: FilePair[]; detectedChar: string | null } => {
      const mode = settings.pairingSettings.mode;
      let detectedChar: string | null = null;
      let pairs: FilePair[];

      switch (mode) {
        case "fileOrder":
          pairs = pairByFileOrder(sourceFiles, targetFiles);
          break;
        case "numericKey":
          pairs = pairByNumericKey(sourceFiles, targetFiles);
          break;
        case "linkCharManual":
          pairs = pairByLinkCharacter(
            sourceFiles,
            targetFiles,
            settings.pairingSettings.linkCharacter,
          );
          break;
        case "linkCharAuto":
          detectedChar = autoDetectLinkCharacter(sourceFiles, targetFiles);
          if (detectedChar) {
            pairs = pairByLinkCharacter(sourceFiles, targetFiles, detectedChar);
          } else {
            pairs = [];
          }
          break;
        default:
          pairs = pairByFileOrder(sourceFiles, targetFiles);
      }

      return { pairs, detectedChar };
    },
    [settings.pairingSettings],
  );

  // --- タイムスタンプ生成 (YYYY-MM-DD_HH-mm) ---
  const makeTimestamp = () => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
  };

  // --- フォルダスキャン → ペアリング → モーダル起動 ---
  const scanAndPair = useCallback(async () => {
    const currentBatchFolders = useReplaceStore.getState().batchFolders;

    // バッチモード: sourceFolder + batchFolders が必要
    // 通常モード: sourceFolder + targetFolder が必要
    if (!folders.sourceFolder) return;
    if (settings.mode === "batch") {
      if (currentBatchFolders.length === 0 && !folders.targetFolder) return;
    } else {
      if (!folders.targetFolder) return;
    }

    setPhase("scanning");
    setDetectedLinkChar(null);

    try {
      const jobs: PairingJob[] = [];
      const scannedGroups: ScannedFileGroup[] = [];
      let globalPairIndex = 0;
      let globalDetectedChar: string | null = null;
      const currentGeneralSettings = useReplaceStore.getState().settings.generalSettings;
      const folderName = currentGeneralSettings.outputFolderName.trim() || makeTimestamp();
      const outBase = `__desktop__/Script_Output/差替えファイル_出力/${folderName}`;

      if (settings.mode === "batch") {
        // --- バッチモード ---
        let batchTargets: { name: string; path: string }[] = [];

        if (currentBatchFolders.length > 0) {
          // 個別指定モード: batchFolders をそのまま使用
          batchTargets = currentBatchFolders.map((f) => ({ name: f.name, path: f.path }));
        } else if (folders.targetFolder) {
          // 親フォルダモード: サブフォルダを自動検出
          const subfolders = await invoke<string[]>("list_subfolders", {
            folderPath: folders.targetFolder,
          });
          batchTargets = subfolders.map((sf) => ({
            name: getFolderName(sf),
            path: sf,
          }));
        }

        for (const target of batchTargets) {
          const subFiles = await invoke<string[]>("list_folder_files", {
            folderPath: target.path,
            recursive: false,
          });
          const plantFiles = folders.sourceFiles
            ? [...folders.sourceFiles].sort()
            : await invoke<string[]>("list_folder_files", {
                folderPath: folders.sourceFolder!,
                recursive: false,
              });

          const { pairs, detectedChar } = computePairs(subFiles, plantFiles);
          if (detectedChar) globalDetectedChar = detectedChar;

          const indexedPairs = pairs.map((p) => ({
            ...p,
            pairIndex: globalPairIndex++,
          }));

          jobs.push({
            description: `${target.name} → 植字データ`,
            pairs: indexedPairs,
            outputDir: `${outBase}/${target.name}_差替え後PSD`,
          });
          scannedGroups.push({
            groupKey: target.name,
            sourceFiles: plantFiles,
            targetFiles: subFiles,
            outputDirSuffix: `/${target.name}_差替え後PSD`,
          });
        }
      } else if (settings.subfolderSettings.mode === "advanced") {
        // --- サブフォルダ対応モード ---
        const targetSubs = await invoke<string[]>("list_subfolders", {
          folderPath: folders.targetFolder,
        });

        if (targetSubs.length === 0) {
          // ケースA: Targetにサブフォルダなし → Source全階層を再帰検索
          const sourceFiles = folders.sourceFiles
            ? [...folders.sourceFiles].sort()
            : await invoke<string[]>("list_folder_files", {
                folderPath: folders.sourceFolder,
                recursive: true,
              });
          const targetFiles = folders.targetFiles
            ? [...folders.targetFiles].sort()
            : await invoke<string[]>("list_folder_files", {
                folderPath: folders.targetFolder,
                recursive: false,
              });

          const { pairs, detectedChar } = computePairs(sourceFiles, targetFiles);
          if (detectedChar) globalDetectedChar = detectedChar;

          const indexedPairs = pairs.map((p) => ({
            ...p,
            pairIndex: globalPairIndex++,
          }));

          jobs.push({
            description: "Source全階層 → Targetルート",
            pairs: indexedPairs,
            outputDir: outBase,
          });
          scannedGroups.push({
            groupKey: "Source全階層 → Targetルート",
            sourceFiles,
            targetFiles,
            outputDirSuffix: "",
          });
        } else {
          // ケースB: Targetにサブフォルダあり
          const sourceSubs = await invoke<string[]>("list_subfolders", {
            folderPath: folders.sourceFolder,
          });

          if (sourceSubs.length === targetSubs.length) {
            // ケースB-1: フォルダ数一致 → 名前順ペアリング
            for (let i = 0; i < sourceSubs.length; i++) {
              const srcFiles = await invoke<string[]>("list_folder_files", {
                folderPath: sourceSubs[i],
                recursive: false,
              });
              const tgtFiles = await invoke<string[]>("list_folder_files", {
                folderPath: targetSubs[i],
                recursive: false,
              });

              const { pairs, detectedChar } = computePairs(srcFiles, tgtFiles);
              if (detectedChar) globalDetectedChar = detectedChar;

              const indexedPairs = pairs.map((p) => ({
                ...p,
                pairIndex: globalPairIndex++,
              }));

              const tgtName = getFolderName(targetSubs[i]);
              jobs.push({
                description: `${getFolderName(sourceSubs[i])} → ${tgtName}`,
                pairs: indexedPairs,
                outputDir: `${outBase}/${tgtName}`,
              });
              scannedGroups.push({
                groupKey: `${getFolderName(sourceSubs[i])} → ${tgtName}`,
                sourceFiles: srcFiles,
                targetFiles: tgtFiles,
                outputDirSuffix: `/${tgtName}`,
              });
            }
          } else {
            // ケースB-2: フォルダ数不一致 → 数字でペアリング
            const sourceMap = new Map<number, string>();
            for (const sf of sourceSubs) {
              const num = getNumberFromFolderName(sf);
              if (num !== null) sourceMap.set(num, sf);
            }

            for (const tf of targetSubs) {
              const tgtNum = getNumberFromFolderName(tf);
              if (tgtNum !== null && sourceMap.has(tgtNum)) {
                const srcFolder = sourceMap.get(tgtNum)!;
                const srcFiles = await invoke<string[]>("list_folder_files", {
                  folderPath: srcFolder,
                  recursive: false,
                });
                const tgtFiles = await invoke<string[]>("list_folder_files", {
                  folderPath: tf,
                  recursive: false,
                });

                const { pairs, detectedChar } = computePairs(srcFiles, tgtFiles);
                if (detectedChar) globalDetectedChar = detectedChar;

                const indexedPairs = pairs.map((p) => ({
                  ...p,
                  pairIndex: globalPairIndex++,
                }));

                const tgtName = getFolderName(tf);
                const srcFolderName = getFolderName(srcFolder);
                jobs.push({
                  description: `${srcFolderName} → ${tgtName} (No.${tgtNum})`,
                  pairs: indexedPairs,
                  outputDir: `${outBase}/${tgtName}`,
                });
                scannedGroups.push({
                  groupKey: `${srcFolderName} → ${tgtName} (No.${tgtNum})`,
                  sourceFiles: srcFiles,
                  targetFiles: tgtFiles,
                  outputDirSuffix: `/${tgtName}`,
                });
              }
            }
          }
        }
      } else {
        // --- 通常モード ---
        const sourceFiles = folders.sourceFiles
          ? [...folders.sourceFiles].sort()
          : await invoke<string[]>("list_folder_files", {
              folderPath: folders.sourceFolder,
              recursive: false,
            });
        const targetFiles = folders.targetFiles
          ? [...folders.targetFiles].sort()
          : await invoke<string[]>("list_folder_files", {
              folderPath: folders.targetFolder,
              recursive: false,
            });

        const { pairs, detectedChar } = computePairs(sourceFiles, targetFiles);
        if (detectedChar) globalDetectedChar = detectedChar;

        const indexedPairs = pairs.map((p) => ({
          ...p,
          pairIndex: globalPairIndex++,
        }));

        jobs.push({
          description: "通常処理",
          pairs: indexedPairs,
          outputDir: outBase,
        });
        scannedGroups.push({
          groupKey: "通常処理",
          sourceFiles,
          targetFiles,
          outputDirSuffix: "",
        });
      }

      setDetectedLinkChar(globalDetectedChar);
      setPairingJobs(jobs);
      setScannedFileGroups(scannedGroups);
      setPhase("idle");
      openModal();
    } catch (err) {
      console.error("Scan/Pair error:", err);
      setPhase("error");
    }
  }, [
    folders,
    settings.mode,
    settings.subfolderSettings.mode,
    computePairs,
    setPhase,
    setDetectedLinkChar,
    setPairingJobs,
    setScannedFileGroups,
    openModal,
  ]);

  // --- Photoshop 実行 ---
  const executeReplacement = useCallback(async () => {
    const state = useReplaceStore.getState();
    const {
      pairingJobs: jobs,
      pairingDialogMode,
      manualPairs,
      excludedPairIndices,
      scannedFileGroups,
    } = state;
    const currentSettings = state.settings;

    // 出力パス再計算（ダイアログで変更された可能性がある）
    const folderName = currentSettings.generalSettings.outputFolderName.trim() || makeTimestamp();
    const outBase = `__desktop__/Script_Output/差替えファイル_出力/${folderName}`;

    // 実行ペアを構築
    let pairEntries: { sourceFile: string; targetFile: string; outputDir: string }[];
    let allPairs: FilePair[];

    if (pairingDialogMode === "manual") {
      // 手動モード: manualPairsを使用
      allPairs = manualPairs;
      pairEntries = manualPairs.map((p) => {
        // ファイルが属するグループを見つけて出力パスを解決
        const group = scannedFileGroups.find(
          (g) => g.sourceFiles.includes(p.sourceFile) || g.targetFiles.includes(p.targetFile),
        );
        return {
          sourceFile: p.sourceFile,
          targetFile: p.targetFile,
          outputDir: outBase + (group?.outputDirSuffix ?? ""),
        };
      });
    } else {
      // 自動モード: excludedを除外
      allPairs = jobs.flatMap((job) =>
        job.pairs.filter((p) => !excludedPairIndices.has(p.pairIndex)),
      );
      pairEntries = jobs.flatMap((job, jobIdx) =>
        job.pairs
          .filter((p) => !excludedPairIndices.has(p.pairIndex))
          .map((pair) => ({
            sourceFile: pair.sourceFile,
            targetFile: pair.targetFile,
            outputDir: outBase + (scannedFileGroups[jobIdx]?.outputDirSuffix ?? ""),
          })),
      );
    }

    if (allPairs.length === 0) return;

    setPhase("processing");
    clearResults();
    setProgress(0, allPairs.length);

    try {
      setCurrentPair("Photoshopで処理中...");

      const psResults = await invoke<PhotoshopResult[]>("run_photoshop_replace", {
        jobs: {
          mode: currentSettings.mode,
          pairs: pairEntries,
          textSettings: currentSettings.textSettings,
          imageSettings: currentSettings.imageSettings,
          switchSettings: currentSettings.switchSettings,
          generalSettings: currentSettings.generalSettings,
          composeSettings:
            currentSettings.mode === "compose" ? currentSettings.composeSettings : null,
          outputPath: "", // Rust側で設定される
        },
      });

      // 結果をペアに紐付け
      for (let i = 0; i < psResults.length; i++) {
        const psResult = psResults[i];
        const pair = allPairs[i];

        const result: ReplaceResult = {
          pairIndex: pair ? pair.pairIndex : i,
          sourceName: pair ? pair.sourceName : getDisplayName(psResult.filePath),
          targetName: pair ? pair.targetName : "",
          success: psResult.success,
          outputFile: psResult.filePath,
          operations: psResult.changes || [],
          error: psResult.error || undefined,
        };

        addResult(result);
        setProgress(i + 1, allPairs.length);
        setCurrentPair(pair ? `${pair.sourceName} → ${pair.targetName}` : "");
      }

      setPhase("complete");
      setCurrentPair(null);
    } catch (err) {
      console.error("Replace execution error:", err);

      // エラー時は未処理ペアにエラー結果を追加
      const currentResults = useReplaceStore.getState().results;
      const processedIndices = new Set(currentResults.map((r) => r.pairIndex));

      for (const pair of allPairs) {
        if (!processedIndices.has(pair.pairIndex)) {
          addResult({
            pairIndex: pair.pairIndex,
            sourceName: pair.sourceName,
            targetName: pair.targetName,
            success: false,
            outputFile: "",
            operations: [],
            error: String(err),
          });
        }
      }

      setPhase("complete");
      setCurrentPair(null);
    }
  }, [setPhase, clearResults, setProgress, setCurrentPair, addResult]);

  return { scanAndPair, executeReplacement };
}
