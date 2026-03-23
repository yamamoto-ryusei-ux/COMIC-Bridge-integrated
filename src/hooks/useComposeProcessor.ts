import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useComposeStore } from "../store/composeStore";
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
      pairIndex: 0,
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

export function useComposeProcessor() {
  const folders = useComposeStore((s) => s.folders);
  const pairingSettings = useComposeStore((s) => s.pairingSettings);
  const subfolderSettings = useComposeStore((s) => s.subfolderSettings);
  const setPhase = useComposeStore((s) => s.setPhase);
  const setProgress = useComposeStore((s) => s.setProgress);
  const setCurrentPair = useComposeStore((s) => s.setCurrentPair);
  const addResult = useComposeStore((s) => s.addResult);
  const clearResults = useComposeStore((s) => s.clearResults);
  const setPairingJobs = useComposeStore((s) => s.setPairingJobs);
  const setDetectedLinkChar = useComposeStore((s) => s.setDetectedLinkChar);
  const setScannedFileGroups = useComposeStore((s) => s.setScannedFileGroups);
  const openModal = useComposeStore((s) => s.openModal);

  // --- ペアリングを計算 ---
  const computePairs = useCallback(
    (
      sourceFiles: string[],
      targetFiles: string[],
    ): { pairs: FilePair[]; detectedChar: string | null } => {
      const mode = pairingSettings.mode;
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
          pairs = pairByLinkCharacter(sourceFiles, targetFiles, pairingSettings.linkCharacter);
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
    [pairingSettings],
  );

  // --- タイムスタンプ生成 (YYYY-MM-DD_HH-mm) ---
  const makeTimestamp = () => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
  };

  // --- フォルダスキャン → ペアリング → モーダル起動 ---
  const scanAndPair = useCallback(async () => {
    if (!folders.sourceFolder || !folders.targetFolder) return;

    setPhase("scanning");
    setDetectedLinkChar(null);

    try {
      const jobs: PairingJob[] = [];
      const scannedGroups: ScannedFileGroup[] = [];
      let globalPairIndex = 0;
      let globalDetectedChar: string | null = null;
      const currentGeneralSettings = useComposeStore.getState().generalSettings;
      const folderName = currentGeneralSettings.outputFolderName.trim() || makeTimestamp();
      const outBase = `__desktop__/Script_Output/合成ファイル_出力/${folderName}`;

      if (subfolderSettings.mode === "advanced") {
        // --- サブフォルダ対応モード ---
        const targetSubs = await invoke<string[]>("list_subfolders", {
          folderPath: folders.targetFolder,
        });

        if (targetSubs.length === 0) {
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
          const sourceSubs = await invoke<string[]>("list_subfolders", {
            folderPath: folders.sourceFolder,
          });

          if (sourceSubs.length === targetSubs.length) {
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
      console.error("Compose Scan/Pair error:", err);
      setPhase("error");
    }
  }, [
    folders,
    subfolderSettings.mode,
    computePairs,
    setPhase,
    setDetectedLinkChar,
    setPairingJobs,
    setScannedFileGroups,
    openModal,
  ]);

  // --- Photoshop 実行 ---
  const executeReplacement = useCallback(async () => {
    const state = useComposeStore.getState();
    const {
      pairingJobs: jobs,
      pairingDialogMode,
      manualPairs,
      excludedPairIndices,
      scannedFileGroups,
    } = state;
    const currentGeneralSettings = state.generalSettings;
    const currentComposeSettings = state.composeSettings;

    const folderName = currentGeneralSettings.outputFolderName.trim() || makeTimestamp();
    const outBase = `__desktop__/Script_Output/合成ファイル_出力/${folderName}`;

    let pairEntries: { sourceFile: string; targetFile: string; outputDir: string }[];
    let allPairs: FilePair[];

    if (pairingDialogMode === "manual") {
      allPairs = manualPairs;
      pairEntries = manualPairs.map((p) => {
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

    const currentOrganizePre = state.organizePre;

    setPhase("processing");
    clearResults();
    setProgress(0, allPairs.length);

    try {
      // --- 前処理: フォルダ格納 ---
      if (currentOrganizePre.enabled && currentOrganizePre.targetName.trim()) {
        setCurrentPair("原稿Bをフォルダ格納中...");

        // 原稿B（target）ファイルの重複排除リスト
        const targetFiles = [...new Set(pairEntries.map((p) => p.targetFile))];

        await invoke("run_photoshop_layer_organize", {
          filePaths: targetFiles,
          targetGroupName: currentOrganizePre.targetName.trim(),
          includeSpecial: currentOrganizePre.includeSpecial,
          saveMode: "overwrite",
        });
      }

      setCurrentPair("Photoshopで合成処理中...");

      // compose以外のモード設定はダミー値（Rust構造体に必要）
      const defaultTextSettings = {
        subMode: "textLayers" as const,
        groupName: "",
        partialMatch: false,
      };
      const defaultImageSettings = {
        replaceBackground: false,
        replaceSpecialLayer: false,
        specialLayerName: "",
        specialLayerPartialMatch: false,
        replaceNamedGroup: false,
        namedGroupName: "",
        namedGroupPartialMatch: false,
        placeFromBottom: false,
      };
      const defaultSwitchSettings = {
        subMode: "whiteToBar" as const,
        whiteLayerName: "白消し",
        whitePartialMatch: true,
        barGroupName: "棒消し",
        barPartialMatch: true,
        placeFromBottom: true,
      };

      const psResults = await invoke<PhotoshopResult[]>("run_photoshop_replace", {
        jobs: {
          mode: "compose",
          pairs: pairEntries,
          textSettings: defaultTextSettings,
          imageSettings: defaultImageSettings,
          switchSettings: defaultSwitchSettings,
          generalSettings: currentGeneralSettings,
          composeSettings: currentComposeSettings,
          outputPath: "",
        },
      });

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
      console.error("Compose execution error:", err);

      const currentResults = useComposeStore.getState().results;
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
