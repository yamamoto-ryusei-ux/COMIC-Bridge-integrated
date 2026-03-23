import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useRenameStore } from "../store/renameStore";
import { usePsdStore } from "../store/psdStore";
import type { RenameResult, FileRenamePreview } from "../types/rename";
import type { PsdFile } from "../types/index";

interface PhotoshopResult {
  filePath: string;
  success: boolean;
  changes: string[];
  error: string | null;
}

interface BatchRenameResult {
  originalPath: string;
  originalName: string;
  newName: string;
  outputPath: string;
  success: boolean;
  error: string | null;
}

// --- ヘルパー: ファイル名部分を取得 ---
function getFileName(fullPath: string): string {
  return fullPath.split(/[\\/]/).pop() || "";
}

// --- ヘルパー: 拡張子を取得 ---
function getExtension(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  return idx >= 0 ? fileName.substring(idx) : "";
}

// --- ヘルパー: 拡張子を除いた名前を取得 ---
function getNameWithoutExt(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  return idx >= 0 ? fileName.substring(0, idx) : fileName;
}

// --- ヘルパー: ゼロ埋め ---
function zfill(num: number, len: number): string {
  return String(num).padStart(len, "0");
}

export function useRenameProcessor() {
  const setPhase = useRenameStore((s) => s.setPhase);
  const setProgress = useRenameStore((s) => s.setProgress);
  const addResult = useRenameStore((s) => s.addResult);
  const clearResults = useRenameStore((s) => s.clearResults);
  const setShowResultDialog = useRenameStore((s) => s.setShowResultDialog);

  // === プレビュー計算: ファイルリネーム ===
  const computeFilePreview = useCallback((): FileRenamePreview[] => {
    const state = useRenameStore.getState();
    const { fileEntries, fileSettings } = state;
    const selected = fileEntries.filter((e) => e.selected);
    const previews: FileRenamePreview[] = [];

    let seqNum = fileSettings.sequential.startNumber;

    for (const entry of selected) {
      const ext = getExtension(entry.fileName);
      const nameNoExt = getNameWithoutExt(entry.fileName);
      let newName: string;

      if (entry.customName !== null) {
        // 個別編集名が指定されている場合
        newName = entry.customName;
      } else {
        switch (fileSettings.mode) {
          case "sequential": {
            const num = zfill(seqNum, fileSettings.sequential.padding);
            const sep = fileSettings.sequential.separator;
            const base = fileSettings.sequential.baseName;
            newName = base + sep + num + ext;
            seqNum++;
            break;
          }
          case "replace": {
            const { searchText, replaceText, matchMode } = fileSettings.replaceString;
            if (!searchText) {
              newName = entry.fileName;
            } else if (matchMode === "regex") {
              try {
                const regex = new RegExp(searchText, "g");
                newName = nameNoExt.replace(regex, replaceText) + ext;
              } catch {
                newName = entry.fileName;
              }
            } else {
              // partial (部分一致)
              newName = nameNoExt.split(searchText).join(replaceText) + ext;
            }
            break;
          }
          case "prefix": {
            const { prefix, suffix } = fileSettings.prefixSuffix;
            newName = prefix + nameNoExt + suffix + ext;
            break;
          }
          default:
            newName = entry.fileName;
        }
      }

      previews.push({
        id: entry.id,
        originalName: entry.fileName,
        newName,
        folderName: entry.folderName,
      });
    }

    return previews;
  }, []);

  // === レイヤーリネーム実行 ===
  const executeLayerRename = useCallback(async () => {
    const state = useRenameStore.getState();
    const psdState = usePsdStore.getState();
    const { layerSettings } = state;

    // PSDファイルのみ対象
    const psdFiles: PsdFile[] = psdState.files.filter(
      (f) => f.filePath.toLowerCase().endsWith(".psd") || f.filePath.toLowerCase().endsWith(".psb"),
    );

    if (psdFiles.length === 0) return;

    setPhase("processing");
    clearResults();
    setProgress(0, psdFiles.length);

    try {
      const filePaths = psdFiles.map((f) => f.filePath);

      // ルールをフィルタ（空のルールは除外）
      const activeRules = layerSettings.rules.filter((r) => r.oldName.trim() !== "");

      const psResults = await invoke<PhotoshopResult[]>("run_photoshop_rename", {
        settings: {
          files: filePaths,
          bottomLayer: layerSettings.bottomLayer,
          rules: activeRules.map((r) => ({
            target: r.target,
            oldName: r.oldName,
            newName: r.newName,
            matchMode: r.matchMode,
          })),
          fileOutput: layerSettings.fileOutput,
          outputDirectory: layerSettings.outputDirectory,
        },
      });

      for (let i = 0; i < psResults.length; i++) {
        const psResult = psResults[i];
        const psdFile = psdFiles[i];

        const result: RenameResult = {
          fileName: psdFile ? psdFile.fileName : getFileName(psResult.filePath),
          success: psResult.success,
          outputFile: psResult.filePath,
          changes: psResult.changes || [],
          error: psResult.error || undefined,
        };

        addResult(result);
        setProgress(i + 1, psdFiles.length);
      }

      setPhase("complete");
      setShowResultDialog(true);
    } catch (err) {
      console.error("Layer rename error:", err);
      setPhase("error");
    }
  }, [setPhase, clearResults, setProgress, addResult, setShowResultDialog]);

  // === ファイルリネーム実行 ===
  const executeFileRename = useCallback(async () => {
    const state = useRenameStore.getState();
    const { fileSettings } = state;

    // プレビューから新ファイル名を取得
    const previews = computeFilePreview();
    if (previews.length === 0) return;

    // 対象エントリを取得
    const selected = state.fileEntries.filter((e) => e.selected);
    const entryMap = new Map(selected.map((e) => [e.id, e]));

    setPhase("processing");
    clearResults();
    setProgress(0, previews.length);

    try {
      const entries = previews.map((p) => {
        const entry = entryMap.get(p.id)!;
        return {
          sourcePath: entry.filePath,
          newName: p.newName,
        };
      });

      const batchResults = await invoke<BatchRenameResult[]>("batch_rename_files", {
        entries,
        mode: fileSettings.outputMode,
        outputDirectory: fileSettings.outputDirectory,
      });

      for (let i = 0; i < batchResults.length; i++) {
        const br = batchResults[i];

        const result: RenameResult = {
          fileName: br.originalName,
          newFileName: br.newName,
          success: br.success,
          outputFile: br.outputPath,
          changes: br.success ? [`${br.originalName} → ${br.newName}`] : [],
          error: br.error || undefined,
        };

        addResult(result);
        setProgress(i + 1, previews.length);
      }

      setPhase("complete");
      setShowResultDialog(true);
    } catch (err) {
      console.error("File rename error:", err);
      setPhase("error");
    }
  }, [computeFilePreview, setPhase, clearResults, setProgress, addResult, setShowResultDialog]);

  return {
    computeFilePreview,
    executeLayerRename,
    executeFileRename,
  };
}
