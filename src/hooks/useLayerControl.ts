import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { desktopDir } from "@tauri-apps/api/path";
import { usePsdStore } from "../store/psdStore";
import { useLayerStore, type HideCondition, type LayerControlResult } from "../store/layerStore";
import { matchesCondition, isTextFolder } from "../lib/layerMatcher";
import {
  applyVirtualMoves,
  applyCustomVisibilityToTree,
  buildIdToPathInfo,
} from "../lib/layerTreeOps";
import type { LayerNode } from "../types";

interface PhotoshopResult {
  filePath: string;
  success: boolean;
  changes: string[];
  error: string | null;
}

interface LayerCondition {
  type: string;
  value?: string;
  partialMatch?: boolean;
  caseSensitive?: boolean;
}

export function useLayerControl() {
  const files = usePsdStore((state) => state.files);
  const selectedFileIds = usePsdStore((state) => state.selectedFileIds);
  const updateFile = usePsdStore((state) => state.updateFile);
  const setIsProcessing = useLayerStore((state) => state.setIsProcessing);
  const getSelectedConditions = useLayerStore((state) => state.getSelectedConditions);
  const actionMode = useLayerStore((state) => state.actionMode);
  const saveMode = useLayerStore((state) => state.saveMode);
  const setLastResults = useLayerStore((state) => state.setLastResults);

  // HideCondition を JSX スクリプトが理解できる形式に変換
  const conditionsToLayerConditions = useCallback(
    (conditions: HideCondition[]): LayerCondition[] => {
      return conditions.map((c) => ({
        type: c.type,
        value: c.value,
        partialMatch: c.partialMatch ?? false,
        caseSensitive: c.caseSensitive ?? false,
      }));
    },
    [],
  );

  // Photoshop JSX スクリプト経由でレイヤー可視性を変更
  const applyLayerVisibility = useCallback(async () => {
    const conditions = getSelectedConditions();
    const { deleteHiddenText } = useLayerStore.getState();
    const isHideMode = actionMode === "hide";
    if (conditions.length === 0 && !(isHideMode && deleteHiddenText)) return;

    const targetFiles =
      selectedFileIds.length > 0 ? files.filter((f) => selectedFileIds.includes(f.id)) : files;

    if (targetFiles.length === 0) return;

    setIsProcessing(true);

    try {
      const filePaths = targetFiles.filter((f) => f.metadata?.layerTree).map((f) => f.filePath);

      if (filePaths.length === 0) {
        setIsProcessing(false);
        return;
      }

      const layerConditions = conditionsToLayerConditions(conditions);

      // Tauriコマンドを実行（Photoshop JSX経由）
      const psResults = await invoke<PhotoshopResult[]>("run_photoshop_layer_visibility", {
        filePaths,
        conditions: layerConditions,
        mode: actionMode,
        saveMode,
        deleteHiddenText: isHideMode && deleteHiddenText ? true : undefined,
      });
      const results: LayerControlResult[] = [];

      // 結果を処理してUIのレイヤーツリーを更新
      for (const psResult of psResults) {
        const normalizedPath = psResult.filePath.replace(/\//g, "\\");
        const file = targetFiles.find(
          (f) => f.filePath === psResult.filePath || f.filePath === normalizedPath,
        );

        if (!file) continue;

        // changesからサマリー行の変更数を抽出（詳細行は "  → " で始まる）
        const summaryLine = psResult.changes.find((c: string) => !c.startsWith("  "));
        const changedMatch = summaryLine ? summaryLine.match(/(\d+) layer/) : null;
        const changedCount = changedMatch ? parseInt(changedMatch[1], 10) : 0;

        results.push({
          fileName: file.fileName,
          success: psResult.success,
          changedCount,
          changes: psResult.changes,
          error: psResult.error || undefined,
        });

        // 成功した場合、メタデータのレイヤーツリーを更新（UI反映）
        if (psResult.success && file.metadata) {
          let updatedLayerTree = file.metadata.layerTree;

          if (changedCount > 0 && conditions.length > 0) {
            updatedLayerTree = updateLayerTreeByConditions(
              updatedLayerTree,
              conditions,
              !isHideMode, // showの場合はvisible=true
            );
          }

          // 削除オプション有効時: 非表示テキストレイヤーをツリーから除去
          if (isHideMode && deleteHiddenText) {
            updatedLayerTree = removeHiddenTextLayers(updatedLayerTree);
          }

          if (updatedLayerTree !== file.metadata.layerTree) {
            updateFile(file.id, {
              metadata: {
                ...file.metadata,
                layerTree: updatedLayerTree,
              },
            });
          }
        }
      }

      // Store results for result dialog
      setLastResults(results, actionMode);

      return results;
    } catch (error) {
      console.error("Layer visibility change failed:", error);
      throw error;
    } finally {
      setIsProcessing(false);
    }
  }, [
    files,
    selectedFileIds,
    actionMode,
    saveMode,
    getSelectedConditions,
    conditionsToLayerConditions,
    setIsProcessing,
    setLastResults,
    updateFile,
  ]);

  // レイヤーを指定フォルダに格納
  const organizeLayersIntoFolder = useCallback(async () => {
    const state = useLayerStore.getState();
    const { organizeTargetName, organizeIncludeSpecial } = state;

    if (!organizeTargetName.trim()) return;

    const targetFiles =
      selectedFileIds.length > 0 ? files.filter((f) => selectedFileIds.includes(f.id)) : files;

    if (targetFiles.length === 0) return;

    setIsProcessing(true);

    try {
      const filePaths = targetFiles.map((f) => f.filePath);

      const psResults = await invoke<PhotoshopResult[]>("run_photoshop_layer_organize", {
        filePaths,
        targetGroupName: organizeTargetName,
        includeSpecial: organizeIncludeSpecial,
        saveMode,
      });

      const results: LayerControlResult[] = [];

      for (const psResult of psResults) {
        const normalizedPath = psResult.filePath.replace(/\//g, "\\");
        const file = targetFiles.find(
          (f) => f.filePath === psResult.filePath || f.filePath === normalizedPath,
        );

        if (!file) continue;

        const summaryLine = psResult.changes.find((c: string) => !c.startsWith("  "));
        const changedMatch = summaryLine ? summaryLine.match(/(\d+)/) : null;
        const changedCount = changedMatch ? parseInt(changedMatch[1], 10) : 0;

        results.push({
          fileName: file.fileName,
          success: psResult.success,
          changedCount,
          changes: psResult.changes,
          error: psResult.error || undefined,
        });
      }

      setLastResults(results, "organize");

      return results;
    } catch (error) {
      console.error("Layer organize failed:", error);
      throw error;
    } finally {
      setIsProcessing(false);
    }
  }, [files, selectedFileIds, saveMode, setIsProcessing, setLastResults]);

  // 条件ベースでレイヤーをグループに移動
  const moveLayersByConditions = useCallback(async () => {
    const state = useLayerStore.getState();
    const {
      layerMoveTargetName,
      layerMoveCreateIfMissing,
      layerMoveSearchScope,
      layerMoveSearchGroupName,
      layerMoveCondTextLayer,
      layerMoveCondSubgroupTop,
      layerMoveCondSubgroupBottom,
      layerMoveCondNameEnabled,
      layerMoveCondName,
      layerMoveCondNamePartial,
    } = state;

    if (!layerMoveTargetName.trim()) return;

    const hasAnyCondition =
      layerMoveCondTextLayer ||
      layerMoveCondSubgroupTop ||
      layerMoveCondSubgroupBottom ||
      layerMoveCondNameEnabled;
    if (!hasAnyCondition) return;

    const targetFiles =
      selectedFileIds.length > 0 ? files.filter((f) => selectedFileIds.includes(f.id)) : files;

    if (targetFiles.length === 0) return;

    setIsProcessing(true);

    try {
      const filePaths = targetFiles.map((f) => f.filePath);

      const psResults = await invoke<PhotoshopResult[]>("run_photoshop_layer_move", {
        filePaths,
        targetGroupName: layerMoveTargetName,
        createIfMissing: layerMoveCreateIfMissing,
        searchScope: layerMoveSearchScope,
        searchGroupName: layerMoveSearchGroupName,
        conditions: {
          textLayer: layerMoveCondTextLayer,
          subgroupTop: layerMoveCondSubgroupTop,
          subgroupBottom: layerMoveCondSubgroupBottom,
          nameEnabled: layerMoveCondNameEnabled,
          namePattern: layerMoveCondName,
          namePartial: layerMoveCondNamePartial,
        },
        saveMode,
      });

      const results: LayerControlResult[] = [];

      for (const psResult of psResults) {
        const normalizedPath = psResult.filePath.replace(/\//g, "\\");
        const file = targetFiles.find(
          (f) => f.filePath === psResult.filePath || f.filePath === normalizedPath,
        );

        if (!file) continue;

        const summaryLine = psResult.changes.find((c: string) => !c.startsWith("  "));
        const changedMatch = summaryLine ? summaryLine.match(/(\d+)/) : null;
        const changedCount = changedMatch ? parseInt(changedMatch[1], 10) : 0;

        results.push({
          fileName: file.fileName,
          success: psResult.success,
          changedCount,
          changes: psResult.changes,
          error: psResult.error || undefined,
        });
      }

      setLastResults(results, "layerMove");

      return results;
    } catch (error) {
      console.error("Layer move by conditions failed:", error);
      throw error;
    } finally {
      setIsProcessing(false);
    }
  }, [files, selectedFileIds, saveMode, setIsProcessing, setLastResults]);

  // カスタムモード: 個別レイヤー操作を適用
  const applyCustomOperations = useCallback(async () => {
    const { customVisibilityOps, customMoveOps, clearCustomOps, deleteHiddenText } =
      useLayerStore.getState();

    const targetFiles =
      selectedFileIds.length > 0 ? files.filter((f) => selectedFileIds.includes(f.id)) : files;

    if (targetFiles.length === 0) return;

    // deleteHiddenText が有効な場合は全ファイル対象、それ以外は操作のあるファイルのみ
    const filesWithOps = deleteHiddenText
      ? targetFiles
      : targetFiles.filter((f) => {
          const visOps = customVisibilityOps.get(f.id);
          const moveOps = customMoveOps.get(f.id);
          return (visOps && visOps.length > 0) || (moveOps && moveOps.length > 0);
        });

    if (filesWithOps.length === 0) return;

    setIsProcessing(true);

    try {
      const filePaths = filesWithOps.map((f) => f.filePath);

      // Build fileOps array for each file
      // When both visibility and move ops exist, re-resolve visibility op paths
      // against the post-move tree using layerId tracking
      const fileOps = filesWithOps.map((f) => {
        const visOps = customVisibilityOps.get(f.id) ?? [];
        const moveOps = customMoveOps.get(f.id) ?? [];
        const layerTree = f.metadata?.layerTree ?? [];

        // If both vis and move ops exist, re-resolve vis paths for post-move tree
        let resolvedVisOps = visOps;
        if (moveOps.length > 0 && visOps.length > 0 && layerTree.length > 0) {
          const { layers: virtualTree } = applyVirtualMoves(layerTree, moveOps);
          const idToPath = buildIdToPathInfo(virtualTree);
          resolvedVisOps = visOps.map((op) => {
            if (op.layerId) {
              const info = idToPath.get(op.layerId);
              if (info) {
                return { ...op, path: info.path, index: info.index };
              }
            }
            return op;
          });
        }

        return {
          filePath: f.filePath.replace(/\\/g, "/"),
          visibilityOps: resolvedVisOps.map((op) => ({
            path: op.path,
            index: op.index,
            action: op.action,
          })),
          moveOps: moveOps.map((op) => ({
            sourcePath: op.sourcePath,
            sourceIndex: op.sourceIndex,
            targetPath: op.targetPath,
            targetIndex: op.targetIndex,
            placement: op.placement,
          })),
        };
      });

      const psResults = await invoke<PhotoshopResult[]>("run_photoshop_custom_operations", {
        filePaths,
        fileOps,
        saveMode,
        deleteHiddenText: deleteHiddenText ? true : undefined,
      });

      const results: LayerControlResult[] = [];

      for (const psResult of psResults) {
        const normalizedPath = psResult.filePath.replace(/\//g, "\\");
        const file = filesWithOps.find(
          (f) => f.filePath === psResult.filePath || f.filePath === normalizedPath,
        );

        if (!file) continue;

        const opsLine = psResult.changes.find((c: string) => c.includes("operation"));
        const opsMatch = opsLine ? opsLine.match(/(\d+)/) : null;
        const changedCount = opsMatch ? parseInt(opsMatch[1], 10) : 0;

        results.push({
          fileName: file.fileName,
          success: psResult.success,
          changedCount,
          changes: psResult.changes,
          error: psResult.error || undefined,
        });

        // Update local layer tree to reflect changes applied by Photoshop
        if (psResult.success && file.metadata) {
          const moveOps = customMoveOps.get(file.id) ?? [];

          let updatedTree = file.metadata.layerTree;

          // Apply moves first (same order as JSX script)
          if (moveOps.length > 0) {
            const { layers } = applyVirtualMoves(updatedTree, moveOps);
            updatedTree = layers;
          }

          // Then apply visibility changes (use resolved paths from fileOps)
          const matchingFileOps = fileOps.find(
            (fo) => fo.filePath === file.filePath.replace(/\\/g, "/"),
          );
          const resolvedVisForTree = matchingFileOps?.visibilityOps ?? [];
          if (resolvedVisForTree.length > 0) {
            updatedTree = applyCustomVisibilityToTree(updatedTree, resolvedVisForTree);
          }

          // 非表示テキストレイヤー削除
          if (deleteHiddenText) {
            updatedTree = removeHiddenTextLayers(updatedTree);
          }

          if (updatedTree !== file.metadata.layerTree) {
            updateFile(file.id, {
              metadata: {
                ...file.metadata,
                layerTree: updatedTree,
              },
            });
          }
        }
      }

      setLastResults(results, "custom");
      clearCustomOps();

      return results;
    } catch (error) {
      console.error("Custom operations failed:", error);
      throw error;
    } finally {
      setIsProcessing(false);
    }
  }, [files, selectedFileIds, saveMode, setIsProcessing, setLastResults, updateFile]);

  // レイヤーロック適用
  const applyLayerLock = useCallback(async () => {
    const { lockBottomLayer, unlockAllLayers } = useLayerStore.getState();

    if (!lockBottomLayer && !unlockAllLayers) return;

    const targetFiles =
      selectedFileIds.length > 0 ? files.filter((f) => selectedFileIds.includes(f.id)) : files;

    if (targetFiles.length === 0) return;

    setIsProcessing(true);

    try {
      const filePaths = targetFiles.map((f) => f.filePath);

      const psResults = await invoke<PhotoshopResult[]>("run_photoshop_layer_lock", {
        filePaths,
        lockBottom: lockBottomLayer,
        unlockAll: unlockAllLayers,
        saveMode,
      });

      const results: LayerControlResult[] = [];

      for (const psResult of psResults) {
        const normalizedPath = psResult.filePath.replace(/\//g, "\\");
        const file = targetFiles.find(
          (f) => f.filePath === psResult.filePath || f.filePath === normalizedPath,
        );

        if (!file) continue;

        const summaryLine = psResult.changes.find((c: string) => !c.startsWith("  "));
        const changedMatch = summaryLine ? summaryLine.match(/(\d+)/) : null;
        const changedCount = changedMatch ? parseInt(changedMatch[1], 10) : 0;

        results.push({
          fileName: file.fileName,
          success: psResult.success,
          changedCount,
          changes: psResult.changes,
          error: psResult.error || undefined,
        });

        // Update local layer tree to reflect lock/unlock changes
        if (psResult.success && file.metadata && changedCount > 0) {
          const layerTree = file.metadata.layerTree;
          if (layerTree.length > 0) {
            let updatedTree = [...layerTree];
            if (lockBottomLayer) {
              const bottomIdx = updatedTree.length - 1;
              updatedTree[bottomIdx] = { ...updatedTree[bottomIdx], locked: true };
            }
            if (unlockAllLayers) {
              updatedTree = clearAllLocks(updatedTree);
            }
            updateFile(file.id, {
              metadata: {
                ...file.metadata,
                layerTree: updatedTree,
              },
            });
          }
        }
      }

      setLastResults(results, "lock");

      return results;
    } catch (error) {
      console.error("Layer lock failed:", error);
      throw error;
    } finally {
      setIsProcessing(false);
    }
  }, [files, selectedFileIds, saveMode, setIsProcessing, setLastResults, updateFile]);

  // レイヤー統合（背景+テキスト）— 常に別フォルダに保存
  const applyMergeLayers = useCallback(async () => {
    const { mergeReorganizeText, mergeOutputFolderName } = useLayerStore.getState();

    const targetFiles =
      selectedFileIds.length > 0 ? files.filter((f) => selectedFileIds.includes(f.id)) : files;

    if (targetFiles.length === 0) return;

    setIsProcessing(true);

    try {
      const filePaths = targetFiles.map((f) => f.filePath);

      // 元フォルダパス（KENBAN diff用）
      const sourceFolder = filePaths[0]
        ? filePaths[0].replace(/\\/g, "/").split("/").slice(0, -1).join("/")
        : "";

      const psResults = await invoke<PhotoshopResult[]>("run_photoshop_merge_layers", {
        filePaths,
        reorganizeText: mergeReorganizeText,
        saveMode: "copyToFolder", // 常に別フォルダ保存
        outputFolderName: mergeOutputFolderName || null,
      });

      const results: LayerControlResult[] = [];

      for (const psResult of psResults) {
        const normalizedPath = psResult.filePath.replace(/\//g, "\\");
        const file = targetFiles.find(
          (f) => f.filePath === psResult.filePath || f.filePath === normalizedPath,
        );

        if (!file) continue;

        const summaryLine = psResult.changes.find((c: string) => !c.startsWith("  "));
        const changedMatch = summaryLine ? summaryLine.match(/(\d+)/) : null;
        const changedCount = changedMatch ? parseInt(changedMatch[1], 10) : 0;

        results.push({
          fileName: file.fileName,
          success: psResult.success,
          changedCount,
          changes: psResult.changes,
          error: psResult.error || undefined,
        });
      }

      // 出力フォルダパスを算出（Rust側と同じロジック）
      const folderName =
        mergeOutputFolderName?.trim() ||
        (filePaths[0]
          ? `${filePaths[0].replace(/\\/g, "/").split("/").slice(-2, -1)[0] || "output"}_統合`
          : "output");
      const desktop = await desktopDir().catch(() => "");
      const desktopNorm = desktop ? desktop.replace(/\\/g, "/").replace(/\/?$/, "/") : "";
      const outputFolder = desktopNorm
        ? `${desktopNorm}Script_Output/レイヤー統合/${folderName}`
        : "";

      setLastResults(results, "merge", outputFolder, sourceFolder);

      return results;
    } catch (error) {
      console.error("Merge layers failed:", error);
      throw error;
    } finally {
      setIsProcessing(false);
    }
  }, [files, selectedFileIds, setIsProcessing, setLastResults]);

  return {
    applyLayerVisibility,
    organizeLayersIntoFolder,
    moveLayersByConditions,
    applyCustomOperations,
    applyLayerLock,
    applyMergeLayers,
  };
}

// 非表示テキストレイヤーをツリーから除去するヘルパー
function removeHiddenTextLayers(layers: LayerNode[]): LayerNode[] {
  return layers
    .filter((layer) => !(layer.type === "text" && !layer.visible))
    .map((layer) => ({
      ...layer,
      children: layer.children ? removeHiddenTextLayers(layer.children) : undefined,
    }));
}

// 条件に基づいてレイヤーツリーの可視性を更新するヘルパー
function updateLayerTreeByConditions(
  layers: LayerNode[],
  conditions: HideCondition[],
  setVisible: boolean,
  parentIsTextFolder = false,
): LayerNode[] {
  return layers.map((layer) => {
    const textFolder = isTextFolder(layer);

    const matches = conditions.some((cond) => matchesCondition(layer, cond, parentIsTextFolder));

    const updatedLayer: LayerNode = {
      ...layer,
      visible: matches ? setVisible : layer.visible,
    };

    if (layer.children && layer.children.length > 0) {
      updatedLayer.children = updateLayerTreeByConditions(
        layer.children,
        conditions,
        setVisible,
        parentIsTextFolder || textFolder,
      );
    }

    return updatedLayer;
  });
}

// レイヤーツリーの全ロックを解除するヘルパー
function clearAllLocks(layers: LayerNode[]): LayerNode[] {
  return layers.map((layer) => ({
    ...layer,
    locked: false,
    children: layer.children ? clearAllLocks(layer.children) : undefined,
  }));
}

// applyCustomVisibilityToTree is imported from ../lib/layerTreeOps
