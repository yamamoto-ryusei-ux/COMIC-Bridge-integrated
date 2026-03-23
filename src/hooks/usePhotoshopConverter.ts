import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePsdStore } from "../store/psdStore";
import { useSpecStore, type ConversionResult } from "../store/specStore";
import { useSpecChecker } from "./useSpecChecker";
import type { PsdMetadata } from "../types";

// Rust command types
interface PhotoshopConversionOptions {
  target_dpi: number | null;
  target_color_mode: string | null;
  target_bit_depth: number | null;
  remove_hidden_layers: boolean;
  remove_alpha_channels: boolean;
}

interface PhotoshopFileSettings {
  path: string;
  needs_dpi_change: boolean;
  needs_color_mode_change: boolean;
  needs_bit_depth_change: boolean;
  needs_alpha_removal: boolean;
}

interface PhotoshopConversionSettings {
  files: PhotoshopFileSettings[];
  options: PhotoshopConversionOptions;
  outputPath: string;
}

interface PhotoshopResult {
  filePath: string;
  success: boolean;
  changes: string[];
  error: string | null;
}

interface PhotoshopStatus {
  installed: boolean;
  path: string | null;
}

export function usePhotoshopConverter() {
  const [isPhotoshopInstalled, setIsPhotoshopInstalled] = useState<boolean | null>(null);
  const [photoshopPath, setPhotoshopPath] = useState<string | null>(null);
  const [isConverting, setIsConverting] = useState(false);

  const files = usePsdStore((state) => state.files);
  const updateFile = usePsdStore((state) => state.updateFile);

  const checkResults = useSpecStore((state) => state.checkResults);
  const conversionSettings = useSpecStore((state) => state.conversionSettings);
  const specifications = useSpecStore((state) => state.specifications);
  const addConversionResult = useSpecStore((state) => state.addConversionResult);
  const clearConversionResults = useSpecStore((state) => state.clearConversionResults);
  const setStoreIsConverting = useSpecStore((state) => state.setIsConverting);

  const { checkAllFiles } = useSpecChecker();

  // Check if Photoshop is installed on mount
  useEffect(() => {
    const checkPhotoshop = async () => {
      try {
        const status = await invoke<PhotoshopStatus>("check_photoshop_installed");
        setIsPhotoshopInstalled(status.installed);
        setPhotoshopPath(status.path);
      } catch (error) {
        console.error("Failed to check Photoshop:", error);
        setIsPhotoshopInstalled(false);
      }
    };
    checkPhotoshop();
  }, []);

  // Convert NG files using Photoshop
  // If fileIds is provided, only convert those specific files (that are also NG)
  const convertWithPhotoshop = useCallback(
    async (fileIds?: string[]) => {
      if (!isPhotoshopInstalled) {
        console.error("Photoshop is not installed");
        return;
      }

      // Get NG files, optionally filtered by specific IDs
      const ngFiles = files.filter((file) => {
        if (fileIds && !fileIds.includes(file.id)) return false;
        const result = checkResults.get(file.id);
        return result && !result.passed;
      });

      if (ngFiles.length === 0) {
        console.log("No NG files to convert");
        return;
      }

      setIsConverting(true);
      setStoreIsConverting(true);
      clearConversionResults();

      try {
        // Build file settings based on what each file needs
        const fileSettings: PhotoshopFileSettings[] = ngFiles.map((file) => {
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

        // Build conversion options
        const options: PhotoshopConversionOptions = {
          target_dpi: conversionSettings.targetDpi,
          target_color_mode: conversionSettings.targetColorMode,
          target_bit_depth: conversionSettings.targetBitDepth,
          remove_hidden_layers: false, // 現在は使用しない
          remove_alpha_channels: true, // αチャンネル削除は常に有効
        };

        const settings: PhotoshopConversionSettings = {
          files: fileSettings,
          options,
          outputPath: "", // Will be set by Rust
        };

        // Call Rust to run Photoshop
        const results = await invoke<PhotoshopResult[]>("run_photoshop_conversion", {
          settings,
        });

        // Process results and collect successfully converted files
        const successfulFiles: { id: string; filePath: string }[] = [];

        for (const result of results) {
          // Find the file (normalize path separators - JSX returns forward slashes)
          const normalizedPath = result.filePath.replace(/\//g, "\\");
          const file = ngFiles.find(
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

          // Track successfully converted files for reload
          if (
            result.success &&
            result.changes.length > 0 &&
            !result.changes.includes("No changes needed")
          ) {
            successfulFiles.push({ id: file.id, filePath: file.filePath });
          }
        }

        // Reload converted files from disk to get actual metadata (Rust-native)
        if (successfulFiles.length > 0) {
          console.log(`Reloading ${successfulFiles.length} converted files...`);

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
            console.error("Failed to reload converted files:", reloadError);
          }

          // Re-run spec check with updated metadata
          await new Promise((resolve) => setTimeout(resolve, 100));
          checkAllFiles(specifications);
        }
      } catch (error) {
        console.error("Photoshop conversion failed:", error);
        // Add error result for all files
        for (const file of ngFiles) {
          addConversionResult({
            fileId: file.id,
            fileName: file.fileName,
            success: false,
            changes: [],
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        setIsConverting(false);
        setStoreIsConverting(false);
      }
    },
    [
      isPhotoshopInstalled,
      files,
      checkResults,
      conversionSettings,
      specifications,
      clearConversionResults,
      addConversionResult,
      setStoreIsConverting,
      updateFile,
      checkAllFiles,
    ],
  );

  return {
    isPhotoshopInstalled,
    photoshopPath,
    isConverting,
    convertWithPhotoshop,
  };
}
