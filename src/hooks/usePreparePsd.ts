import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePsdStore } from "../store/psdStore";
import { useSpecStore, type ConversionResult } from "../store/specStore";
import { useGuideStore } from "../store/guideStore";
import { useSpecChecker } from "./useSpecChecker";
import type { Guide, PsdMetadata } from "../types";

interface PhotoshopResult {
  filePath: string;
  success: boolean;
  changes: string[];
  error: string | null;
}

interface PrepareFileSettings {
  path: string;
  needs_dpi_change: boolean;
  needs_color_mode_change: boolean;
  needs_bit_depth_change: boolean;
  needs_alpha_removal: boolean;
  needs_guide_apply: boolean;
}

interface PrepareSettings {
  files: PrepareFileSettings[];
  options: {
    target_dpi: number | null;
    target_color_mode: string | null;
    target_bit_depth: number | null;
    remove_hidden_layers: boolean;
    remove_alpha_channels: boolean;
  };
  guides: { direction: string; position: number }[];
  outputPath: string;
}

export interface PrepareOptions {
  fixSpec: boolean;
  applyGuides: boolean;
  fileIds?: string[];
}

export interface PrepareTask {
  fileId: string;
  fileName: string;
  status: "processing" | "success" | "error";
  error?: string;
  changes?: string[];
}

export function usePreparePsd() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [tasks, setTasks] = useState<PrepareTask[]>([]);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  const files = usePsdStore((state) => state.files);
  const updateFile = usePsdStore((state) => state.updateFile);

  const checkResults = useSpecStore((state) => state.checkResults);
  const conversionSettings = useSpecStore((state) => state.conversionSettings);
  const specifications = useSpecStore((state) => state.specifications);
  const addConversionResult = useSpecStore((state) => state.addConversionResult);
  const clearConversionResults = useSpecStore((state) => state.clearConversionResults);
  const setStoreIsConverting = useSpecStore((state) => state.setIsConverting);

  const guides = useGuideStore((state) => state.guides);

  const { checkAllFiles } = useSpecChecker();

  const reset = useCallback(() => {
    setTasks([]);
    setProgress({ current: 0, total: 0 });
  }, []);

  const prepareFiles = useCallback(
    async ({ fixSpec, applyGuides, fileIds }: PrepareOptions) => {
      if (!fixSpec && !applyGuides) return;

      // Determine target files
      const targetFiles = files.filter((file) => {
        if (fileIds && !fileIds.includes(file.id)) return false;

        const needsSpec =
          fixSpec &&
          (() => {
            const result = checkResults.get(file.id);
            return result && !result.passed;
          })();

        const needsGuide = applyGuides && guides.length > 0;

        return needsSpec || needsGuide;
      });

      if (targetFiles.length === 0) {
        console.log("No files need processing");
        return;
      }

      setIsProcessing(true);
      setStoreIsConverting(true);
      clearConversionResults();

      // Initialize task tracking
      setTasks(
        targetFiles.map((f) => ({
          fileId: f.id,
          fileName: f.fileName,
          status: "processing" as const,
        })),
      );
      setProgress({ current: 0, total: targetFiles.length });

      try {
        // Check if we need both operations for any file → use unified command
        const anyNeedsBoth =
          fixSpec &&
          applyGuides &&
          targetFiles.some((file) => {
            const result = checkResults.get(file.id);
            const hasSpecIssue = result && !result.passed;
            return hasSpecIssue && guides.length > 0;
          });

        let results: PhotoshopResult[];

        if (anyNeedsBoth || (fixSpec && applyGuides)) {
          // Use unified prepare command (single PS open per file)
          results = await runUnifiedPrepare(targetFiles, fixSpec, applyGuides, guides);
        } else if (fixSpec) {
          // Spec-only: use existing conversion command
          results = await runSpecOnly(targetFiles);
        } else {
          // Guide-only: use existing guide apply command
          results = await runGuideOnly(targetFiles, guides);
        }

        // Process results
        const successfulFiles: { id: string; filePath: string }[] = [];

        for (const result of results) {
          const normalizedPath = result.filePath.replace(/\//g, "\\");
          const file = targetFiles.find(
            (f) => f.filePath === result.filePath || f.filePath === normalizedPath,
          );
          if (!file) continue;

          const conversionResult: ConversionResult = {
            fileId: file.id,
            fileName: file.fileName,
            success: result.success,
            changes: result.changes,
            error: result.error ?? undefined,
          };
          addConversionResult(conversionResult);

          // Update task tracking
          setTasks((prev) =>
            prev.map((t) =>
              t.fileId === file.id
                ? {
                    ...t,
                    status: result.success ? ("success" as const) : ("error" as const),
                    error: result.error ?? undefined,
                    changes: result.changes,
                  }
                : t,
            ),
          );
          setProgress((p) => ({ ...p, current: p.current + 1 }));

          if (
            result.success &&
            result.changes.length > 0 &&
            !result.changes.includes("No changes needed")
          ) {
            successfulFiles.push({ id: file.id, filePath: file.filePath });
          }
        }

        // Reload converted files from disk (Rust-native)
        if (successfulFiles.length > 0) {
          console.log(`Reloading ${successfulFiles.length} processed files...`);

          try {
            const parseResults = await invoke<
              {
                filePath: string;
                metadata: PsdMetadata | null;
                thumbnailData: string | null;
                fileSize: number;
                error: string | null;
              }[]
            >("parse_psd_metadata_batch", { filePaths: successfulFiles.map((f) => f.filePath) });

            for (const result of parseResults) {
              const file = successfulFiles.find((f) => f.filePath === result.filePath);
              if (!file || !result.metadata) continue;

              const thumbnailUrl = result.thumbnailData
                ? `data:image/jpeg;base64,${result.thumbnailData}`
                : undefined;
              updateFile(file.id, {
                metadata: result.metadata,
                thumbnailUrl,
                thumbnailStatus: "ready",
              });
            }
          } catch (reloadError) {
            console.error("Failed to reload processed files:", reloadError);
          }

          // Re-run spec check
          await new Promise((resolve) => setTimeout(resolve, 100));
          checkAllFiles(specifications);
        }
      } catch (error) {
        console.error("Prepare failed:", error);
        const errorMsg = error instanceof Error ? error.message : String(error);
        for (const file of targetFiles) {
          addConversionResult({
            fileId: file.id,
            fileName: file.fileName,
            success: false,
            changes: [],
            error: errorMsg,
          });
        }
        setTasks((prev) => prev.map((t) => ({ ...t, status: "error" as const, error: errorMsg })));
        setProgress((p) => ({ ...p, current: p.total }));
      } finally {
        setIsProcessing(false);
        setStoreIsConverting(false);
      }
    },
    [
      files,
      checkResults,
      conversionSettings,
      specifications,
      guides,
      clearConversionResults,
      addConversionResult,
      setStoreIsConverting,
      updateFile,
      checkAllFiles,
    ],
  );

  // Unified: spec fix + guide apply in one Photoshop pass
  const runUnifiedPrepare = async (
    targetFiles: typeof files,
    fixSpec: boolean,
    applyGuides: boolean,
    guideList: Guide[],
  ): Promise<PhotoshopResult[]> => {
    const fileSettings: PrepareFileSettings[] = targetFiles.map((file) => {
      const result = checkResults.get(file.id);
      const failedChecks = result?.results.filter((r) => !r.passed) ?? [];
      const needsGuide = applyGuides && guideList.length > 0;

      return {
        path: file.filePath,
        needs_dpi_change: fixSpec && failedChecks.some((r) => r.rule.type === "dpi"),
        needs_color_mode_change: fixSpec && failedChecks.some((r) => r.rule.type === "colorMode"),
        needs_bit_depth_change:
          fixSpec && failedChecks.some((r) => r.rule.type === "bitsPerChannel"),
        needs_alpha_removal:
          fixSpec && failedChecks.some((r) => r.rule.type === "hasAlphaChannels"),
        needs_guide_apply: !!needsGuide,
      };
    });

    const settings: PrepareSettings = {
      files: fileSettings,
      options: {
        target_dpi: conversionSettings.targetDpi,
        target_color_mode: conversionSettings.targetColorMode,
        target_bit_depth: conversionSettings.targetBitDepth,
        remove_hidden_layers: false,
        remove_alpha_channels: true,
      },
      guides: guideList.map((g) => ({
        direction: g.direction,
        position: g.position,
      })),
      outputPath: "",
    };

    return await invoke<PhotoshopResult[]>("run_photoshop_prepare", { settings });
  };

  // Spec-only: use existing conversion command
  const runSpecOnly = async (targetFiles: typeof files): Promise<PhotoshopResult[]> => {
    const ngFiles = targetFiles.filter((f) => {
      const r = checkResults.get(f.id);
      return r && !r.passed;
    });

    const fileSettings = ngFiles.map((file) => {
      const result = checkResults.get(file.id);
      const failedChecks = result?.results.filter((r) => !r.passed) ?? [];
      return {
        path: file.filePath,
        needs_dpi_change: failedChecks.some((r) => r.rule.type === "dpi"),
        needs_color_mode_change: failedChecks.some((r) => r.rule.type === "colorMode"),
        needs_bit_depth_change: failedChecks.some((r) => r.rule.type === "bitsPerChannel"),
        needs_alpha_removal: failedChecks.some((r) => r.rule.type === "hasAlphaChannels"),
      };
    });

    return await invoke<PhotoshopResult[]>("run_photoshop_conversion", {
      settings: {
        files: fileSettings,
        options: {
          target_dpi: conversionSettings.targetDpi,
          target_color_mode: conversionSettings.targetColorMode,
          target_bit_depth: conversionSettings.targetBitDepth,
          remove_hidden_layers: false,
          remove_alpha_channels: true,
        },
        outputPath: "",
      },
    });
  };

  // Guide-only: use existing guide apply command
  const runGuideOnly = async (
    targetFiles: typeof files,
    guideList: Guide[],
  ): Promise<PhotoshopResult[]> => {
    return await invoke<PhotoshopResult[]>("run_photoshop_guide_apply", {
      filePaths: targetFiles.map((f) => f.filePath),
      guides: guideList.map((g) => ({
        direction: g.direction,
        position: g.position,
      })),
    });
  };

  return {
    isProcessing,
    tasks,
    progress,
    prepareFiles,
    reset,
  };
}
