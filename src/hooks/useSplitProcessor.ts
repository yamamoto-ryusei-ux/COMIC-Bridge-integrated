import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { join, desktopDir } from "@tauri-apps/api/path";
import { usePsdStore } from "../store/psdStore";
import { useSplitStore, type SplitResult } from "../store/splitStore";

interface PhotoshopResult {
  filePath: string;
  success: boolean;
  changes: string[];
  error: string | null;
}

interface SplitResponse {
  results: PhotoshopResult[];
  outputDir: string;
}

export function useSplitProcessor() {
  const files = usePsdStore((state) => state.files);
  const selectedFileIds = usePsdStore((state) => state.selectedFileIds);
  const settings = useSplitStore((state) => state.settings);
  const setIsProcessing = useSplitStore((state) => state.setIsProcessing);
  const setProgress = useSplitStore((state) => state.setProgress);
  const setCurrentFile = useSplitStore((state) => state.setCurrentFile);
  const addResult = useSplitStore((state) => state.addResult);
  const clearResults = useSplitStore((state) => state.clearResults);
  const setLastOutputDir = useSplitStore((state) => state.setLastOutputDir);
  const setProcessingDuration = useSplitStore((state) => state.setProcessingDuration);
  const setShowResultDialog = useSplitStore((state) => state.setShowResultDialog);

  // 出力ディレクトリを準備
  const getOutputDir = useCallback(async (): Promise<string> => {
    if (settings.outputDirectory) {
      return settings.outputDirectory;
    }
    const desktop = await desktopDir();
    return await join(desktop, "Script_Output", "分割ファイル_出力");
  }, [settings.outputDirectory]);

  // ファイルを一括処理（Photoshop JSX経由）
  const processFiles = useCallback(
    async (targetFiles: typeof files) => {
      if (targetFiles.length === 0) return;

      setIsProcessing(true);
      clearResults();
      setProgress(0, targetFiles.length);
      setProcessingDuration(null);
      const startTime = Date.now();

      try {
        const outputDir = await getOutputDir();
        const fileInfos = targetFiles.map((f) => ({
          path: f.filePath,
          pdfPageIndex: f.pdfPageIndex ?? -1,
        }));

        setCurrentFile("Photoshopで処理中...");

        // Tauriコマンドを実行（全ファイル一括）
        const response = await invoke<SplitResponse>("run_photoshop_split", {
          fileInfos,
          mode: settings.mode,
          outputFormat: settings.outputFormat,
          jpgQuality:
            settings.outputFormat === "jpg" ? Math.round((settings.jpgQuality / 100) * 12) : 12,
          selectionLeft: settings.selectionBounds?.left ?? 0,
          selectionRight: settings.selectionBounds?.right ?? 0,
          pageNumbering: settings.pageNumbering,
          firstPageBlank: settings.firstPageBlank,
          lastPageBlank: settings.lastPageBlank,
          customBaseName: settings.customBaseName || "",
          deleteHiddenLayers: settings.deleteHiddenLayers,
          deleteOffCanvasText: settings.deleteOffCanvasText,
          outputDir,
        });

        const psResults = response.results;
        setLastOutputDir(response.outputDir);

        // 結果を処理
        for (let i = 0; i < psResults.length; i++) {
          const psResult = psResults[i];
          const normalizedPath = psResult.filePath.replace(/\//g, "\\");
          const file = targetFiles.find(
            (f) => f.filePath === psResult.filePath || f.filePath === normalizedPath,
          );

          const result: SplitResult = {
            fileName: file?.fileName || psResult.filePath.split("/").pop() || "unknown",
            success: psResult.success,
            outputFiles: psResult.changes || [],
            error: psResult.error || undefined,
          };
          addResult(result);
          setProgress(i + 1, psResults.length);
        }
      } catch (error) {
        console.error("Split processing error:", error);
        addResult({
          fileName: "Error",
          success: false,
          outputFiles: [],
          error: error instanceof Error ? error.message : "Photoshopの実行に失敗しました",
        });
      } finally {
        setProcessingDuration(Date.now() - startTime);
        setIsProcessing(false);
        setCurrentFile(null);
        setShowResultDialog(true);
      }
    },
    [
      settings,
      setIsProcessing,
      clearResults,
      getOutputDir,
      setCurrentFile,
      setProgress,
      addResult,
      setLastOutputDir,
      setProcessingDuration,
      setShowResultDialog,
    ],
  );

  // 選択ファイルのみ処理
  const splitSelectedFiles = useCallback(async () => {
    const selected = files.filter((f) => selectedFileIds.includes(f.id));
    await processFiles(selected);
  }, [files, selectedFileIds, processFiles]);

  // 全ファイル処理
  const splitAllFiles = useCallback(async () => {
    await processFiles(files);
  }, [files, processFiles]);

  return {
    splitSelectedFiles,
    splitAllFiles,
  };
}
