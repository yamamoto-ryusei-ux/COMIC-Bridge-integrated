import { useCallback } from "react";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { readPsd, writePsd, type Layer } from "ag-psd";
import { usePsdStore } from "../store/psdStore";
import { useSpecStore, type ConversionSettings, type ConversionResult } from "../store/specStore";

// Rust command types
interface ResampleOptions {
  target_dpi: number;
  source_dpi?: number | null;
  filter?: string;
}

interface ProcessResult {
  success: boolean;
  file_path: string;
  changes: string[];
  error?: string;
}

export function useSpecConverter() {
  const files = usePsdStore((state) => state.files);
  const selectedFileIds = usePsdStore((state) => state.selectedFileIds);
  const updateFile = usePsdStore((state) => state.updateFile);

  const conversionSettings = useSpecStore((state) => state.conversionSettings);
  const checkResults = useSpecStore((state) => state.checkResults);
  const setIsConverting = useSpecStore((state) => state.setIsConverting);
  const addConversionResult = useSpecStore((state) => state.addConversionResult);
  const clearConversionResults = useSpecStore((state) => state.clearConversionResults);

  // 非表示レイヤーを削除
  const removeHiddenLayers = (layers: Layer[]): Layer[] => {
    return layers
      .filter((layer) => !layer.hidden)
      .map((layer) => {
        if (layer.children && layer.children.length > 0) {
          return {
            ...layer,
            children: removeHiddenLayers(layer.children),
          };
        }
        return layer;
      });
  };

  // Rustバックエンドで画像リサンプリング
  const resampleWithRust = useCallback(
    async (
      filePath: string,
      targetDpi: number,
      sourceDpi?: number,
    ): Promise<{ success: boolean; changes: string[]; outputPath?: string; error?: string }> => {
      try {
        const result = await invoke<ProcessResult>("resample_image", {
          filePath,
          outputPath: null, // 上書き保存
          options: {
            target_dpi: targetDpi,
            source_dpi: sourceDpi ?? null,
            filter: "lanczos",
          } as ResampleOptions,
        });

        return {
          success: result.success,
          changes: result.changes,
          outputPath: result.file_path,
          error: result.error ?? undefined,
        };
      } catch (error) {
        return {
          success: false,
          changes: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    [],
  );

  // Rustバックエンドでカラーモード変換
  const convertColorModeWithRust = useCallback(
    async (
      filePath: string,
      targetMode: string,
    ): Promise<{ success: boolean; changes: string[]; outputPath?: string; error?: string }> => {
      try {
        const result = await invoke<ProcessResult>("convert_color_mode", {
          filePath,
          outputPath: null,
          targetMode,
        });

        return {
          success: result.success,
          changes: result.changes,
          outputPath: result.file_path,
          error: result.error ?? undefined,
        };
      } catch (error) {
        return {
          success: false,
          changes: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    [],
  );

  // PSDを変換（ag-psd + Rust）
  const convertPsd = useCallback(
    async (
      filePath: string,
      settings: ConversionSettings,
    ): Promise<{ success: boolean; changes: string[]; error?: string }> => {
      const changes: string[] = [];
      let currentFilePath = filePath;

      try {
        // DPI変換はag-psdでメタデータのみ変更（ピクセルリサンプリングなし）
        // 注: 実際のピクセル数は変わらず、DPIメタデータのみ変更される

        // Rust処理でPNGに変換されたかチェック（PNGの場合はag-psd処理をスキップ）
        const isPsdFile = (path: string) => {
          const ext = path.toLowerCase();
          return ext.endsWith(".psd") || ext.endsWith(".psb");
        };

        // ag-psdでの処理（カラーモード、DPI、ビット深度、非表示レイヤー削除）- PSDファイルの場合のみ
        if (!isPsdFile(currentFilePath)) {
          // Rust処理でPNG等に変換された場合はここで終了
          if (changes.length === 0) {
            return { success: true, changes: ["変更なし"] };
          }
          return { success: true, changes };
        }

        const data = await readFile(currentFilePath);
        const buffer = data.buffer;
        const psd = readPsd(new Uint8Array(buffer), {
          skipCompositeImageData: false,
          skipLayerImageData: false,
          skipThumbnail: true,
        });

        let modified = false;

        // カラーモード変更（メタデータのみ）
        if (settings.targetColorMode !== null) {
          const targetModeNum = settings.targetColorMode === "RGB" ? 3 : 1;
          if (psd.colorMode !== targetModeNum) {
            const modeMap: Record<number, string> = {
              0: "Bitmap",
              1: "Grayscale",
              2: "Indexed",
              3: "RGB",
              4: "CMYK",
              7: "Multichannel",
              8: "Duotone",
              9: "Lab",
            };
            const oldModeName = modeMap[psd.colorMode ?? 3] || String(psd.colorMode);
            psd.colorMode = targetModeNum;
            changes.push(`カラーモード: ${oldModeName} → ${settings.targetColorMode}`);
            modified = true;
          }
        }

        // DPI変更（メタデータのみ - ピクセル数は変わらない）
        if (settings.targetDpi !== null) {
          const currentDpi = psd.imageResources?.resolutionInfo?.horizontalResolution ?? 72;
          if (Math.round(currentDpi) !== settings.targetDpi) {
            // imageResourcesがなければ作成
            if (!psd.imageResources) {
              psd.imageResources = {};
            }
            psd.imageResources.resolutionInfo = {
              horizontalResolution: settings.targetDpi,
              horizontalResolutionUnit: "PPI",
              widthUnit: "Inches",
              verticalResolution: settings.targetDpi,
              verticalResolutionUnit: "PPI",
              heightUnit: "Inches",
            };
            changes.push(
              `解像度: ${Math.round(currentDpi)}dpi → ${settings.targetDpi}dpi (メタデータのみ)`,
            );
            modified = true;
          }
        }

        // ビット深度の変換
        if (settings.targetBitDepth !== null && psd.bitsPerChannel !== settings.targetBitDepth) {
          const oldBits = psd.bitsPerChannel;
          psd.bitsPerChannel = settings.targetBitDepth;
          changes.push(`ビット深度: ${oldBits}bit → ${settings.targetBitDepth}bit`);
          modified = true;
        }

        // 非表示レイヤーを削除
        if (settings.removeHiddenLayers && psd.children) {
          const originalCount = countLayers(psd.children);
          psd.children = removeHiddenLayers(psd.children);
          const newCount = countLayers(psd.children);
          const removedCount = originalCount - newCount;
          if (removedCount > 0) {
            changes.push(`非表示レイヤー: ${removedCount}個削除`);
            modified = true;
          }
        }

        if (modified) {
          // 保存
          const outputBuffer = writePsd(psd);
          await writeFile(currentFilePath, new Uint8Array(outputBuffer));
        }

        if (changes.length === 0) {
          return { success: true, changes: ["変更なし"] };
        }

        return { success: true, changes };
      } catch (error) {
        return {
          success: false,
          changes,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
    [removeHiddenLayers, resampleWithRust, convertColorModeWithRust],
  );

  // レイヤー数をカウント
  const countLayers = (layers: Layer[]): number => {
    return layers.reduce((count, layer) => {
      let total = 1;
      if (layer.children) {
        total += countLayers(layer.children);
      }
      return count + total;
    }, 0);
  };

  // NGファイルを一括変換
  const convertFailedFiles = useCallback(async () => {
    // NGのファイルを取得
    const targetFiles = files.filter((file) => {
      const result = checkResults.get(file.id);
      return result && !result.passed;
    });

    if (targetFiles.length === 0) return;

    setIsConverting(true);
    clearConversionResults();

    for (const file of targetFiles) {
      const result = await convertPsd(file.filePath, conversionSettings);

      const conversionResult: ConversionResult = {
        fileId: file.id,
        fileName: file.fileName,
        success: result.success,
        changes: result.changes,
        error: result.error,
      };

      addConversionResult(conversionResult);

      // メタデータを更新（再読み込みが必要な場合がある）
      if (result.success && result.changes.length > 0 && !result.changes.includes("変更なし")) {
        // メタデータを更新
        if (file.metadata) {
          const updates: Record<string, unknown> = {};

          if (conversionSettings.targetBitDepth !== null) {
            updates.bitsPerChannel = conversionSettings.targetBitDepth;
          }
          if (conversionSettings.targetColorMode !== null) {
            updates.colorMode = conversionSettings.targetColorMode;
          }

          updateFile(file.id, {
            metadata: {
              ...file.metadata,
              ...updates,
            },
          });
        }
      }
    }

    setIsConverting(false);
  }, [
    files,
    checkResults,
    conversionSettings,
    convertPsd,
    setIsConverting,
    clearConversionResults,
    addConversionResult,
    updateFile,
  ]);

  // 選択ファイルを変換
  const convertSelectedFiles = useCallback(async () => {
    const targetFiles =
      selectedFileIds.length > 0 ? files.filter((f) => selectedFileIds.includes(f.id)) : files;

    if (targetFiles.length === 0) return;

    setIsConverting(true);
    clearConversionResults();

    for (const file of targetFiles) {
      const result = await convertPsd(file.filePath, conversionSettings);

      const conversionResult: ConversionResult = {
        fileId: file.id,
        fileName: file.fileName,
        success: result.success,
        changes: result.changes,
        error: result.error,
      };

      addConversionResult(conversionResult);

      // メタデータを更新
      if (result.success && result.changes.length > 0 && !result.changes.includes("変更なし")) {
        if (file.metadata) {
          const updates: Record<string, unknown> = {};

          if (conversionSettings.targetBitDepth !== null) {
            updates.bitsPerChannel = conversionSettings.targetBitDepth;
          }
          if (conversionSettings.targetColorMode !== null) {
            updates.colorMode = conversionSettings.targetColorMode;
          }

          updateFile(file.id, {
            metadata: {
              ...file.metadata,
              ...updates,
            },
          });
        }
      }
    }

    setIsConverting(false);
  }, [
    files,
    selectedFileIds,
    conversionSettings,
    convertPsd,
    setIsConverting,
    clearConversionResults,
    addConversionResult,
    updateFile,
  ]);

  return {
    convertFailedFiles,
    convertSelectedFiles,
  };
}
