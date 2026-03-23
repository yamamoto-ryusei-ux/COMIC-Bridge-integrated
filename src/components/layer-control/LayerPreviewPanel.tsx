import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { usePsdStore } from "../../store/psdStore";
import { useLayerStore, PRESET_CONDITIONS } from "../../store/layerStore";
import type { LayerActionMode, CustomVisibilityOp, CustomMoveOp } from "../../store/layerStore";
import { useOpenFolder } from "../../hooks/useOpenFolder";
import { invoke } from "@tauri-apps/api/core";
import {
  useHighResPreview,
  prefetchPreview,
  invalidateUrlCache,
} from "../../hooks/useHighResPreview";
import { classifyLayerRisk, isTextFolder, type MatchRisk } from "../../lib/layerMatcher";
import { buildPathKey, applyVirtualMoves } from "../../lib/layerTreeOps";
import type { LayerNode } from "../../types";
import type { PsdFile } from "../../types";
import type { HideCondition } from "../../store/layerStore";
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";

// --- Annotated tree types ---

interface AnnotatedLayer {
  node: LayerNode;
  matched: boolean;
  risk: MatchRisk;
  willChange: boolean;
  willDelete?: boolean;
  children: AnnotatedLayer[];
  // Custom mode fields
  customPath?: string[];
  customIndex?: number;
  customAction?: "show" | "hide" | "move";
  // Merge mode field
  mergeRole?: "text" | "background";
}

interface FileStats {
  matched: number;
  warnings: number;
  willChange: number;
  willDelete: number;
}

interface FileAnnotation {
  file: PsdFile;
  layerTree: LayerNode[];
  annotatedTree: AnnotatedLayer[];
  stats: FileStats;
}

function annotateTree(
  layers: LayerNode[],
  conditions: HideCondition[],
  isHideMode: boolean,
  parentIsTextFolder = false,
  parentVisible = true,
): AnnotatedLayer[] {
  const tree = annotateTreePass1(layers, conditions, isHideMode, parentIsTextFolder, parentVisible);
  // Show mode: propagate willChange upward to parent groups (mirrors ensureParentsVisible in JSX)
  if (!isHideMode) {
    propagateParentVisibility(tree);
  }
  return tree;
}

/** Pass 1: annotate matched layers and determine willChange based on effective visibility */
function annotateTreePass1(
  layers: LayerNode[],
  conditions: HideCondition[],
  isHideMode: boolean,
  parentIsTextFolder: boolean,
  parentVisible: boolean,
): AnnotatedLayer[] {
  return [...layers].reverse().map((layer) => {
    const textFolder = isTextFolder(layer);
    const { matched, risk } = classifyLayerRisk(layer, conditions, parentIsTextFolder);
    // Use effective visibility (considering parent group state) for willChange.
    // A text layer with visible=true inside a hidden group is effectively NOT visible.
    const effectivelyVisible = layer.visible && parentVisible;
    const willChange = matched && (isHideMode ? effectivelyVisible : !effectivelyVisible);
    return {
      node: layer,
      matched,
      risk,
      willChange,
      children: layer.children
        ? annotateTreePass1(
            layer.children,
            conditions,
            isHideMode,
            parentIsTextFolder || textFolder,
            effectivelyVisible,
          )
        : [],
    };
  });
}

/** Pass 2 (show mode only): if any descendant willChange, mark hidden parent groups as willChange too.
 *  This mirrors the JSX ensureParentsVisible() behavior. Returns true if any descendant has willChange. */
function propagateParentVisibility(tree: AnnotatedLayer[]): boolean {
  let anyChildWillChange = false;
  for (const item of tree) {
    const descendantWillChange = propagateParentVisibility(item.children);
    if (item.willChange || descendantWillChange) {
      // If this is a hidden group and a descendant will be shown, this group will also be shown
      if (
        item.node.type === "group" &&
        !item.node.visible &&
        !item.willChange &&
        descendantWillChange
      ) {
        item.willChange = true;
      }
      anyChildWillChange = true;
    }
  }
  return anyChildWillChange;
}

function countStats(tree: AnnotatedLayer[]): FileStats {
  let matched = 0;
  let warnings = 0;
  let willChange = 0;
  let willDelete = 0;
  for (const item of tree) {
    if (item.matched) matched++;
    if (item.risk === "warning" && item.willChange) warnings++;
    if (item.willChange) willChange++;
    if (item.willDelete) willDelete++;
    const child = countStats(item.children);
    matched += child.matched;
    warnings += child.warnings;
    willChange += child.willChange;
    willDelete += child.willDelete;
  }
  return { matched, warnings, willChange, willDelete };
}

// --- Organize mode annotation ---

/** Check if a group contains any visible text layer (recursive) */
function groupHasVisibleText(group: LayerNode): boolean {
  if (!group.children) return false;
  for (const child of group.children) {
    if (child.type === "text" && child.visible) return true;
    if (child.type === "group" && groupHasVisibleText(child)) return true;
  }
  return false;
}

/** Check if a root-level layer is a candidate for organize (will be moved into target folder) */
function isOrganizeCandidate(
  layer: LayerNode,
  targetName: string,
  includeSpecial: boolean,
): boolean {
  // Skip the target group itself
  if (layer.type === "group" && layer.name === targetName) return false;
  // Skip visible text layers (hidden text layers DO get moved)
  if (layer.type === "text" && layer.visible) return false;
  // Skip visible groups that contain visible text
  if (layer.type === "group" && layer.visible && groupHasVisibleText(layer)) return false;
  // Skip "白消し"/"棒消し" unless includeSpecial
  if (!includeSpecial) {
    if (layer.name.includes("白消し") || layer.name.includes("棒消し")) return false;
  }
  return true;
}

// --- Lock mode annotation ---

/** Annotate tree for lock mode: mark the bottom-most layer (last in original order, first after reverse) as willChange */
function annotateTreeLock(
  layers: LayerNode[],
  lockBottom: boolean,
  unlockAll: boolean,
): AnnotatedLayer[] {
  const reversed = [...layers].reverse();
  return reversed.map((layer, idx) => {
    const isBottomLayer = idx === reversed.length - 1; // last after reverse = bottom in original
    const matchedByLockBottom = lockBottom && isBottomLayer;
    const matchedByUnlock = unlockAll; // all layers are targets for unlock
    const matched = matchedByLockBottom || matchedByUnlock;
    // willChange: lock bottom if not already locked, or unlock if locked
    const willChangeLock = matchedByLockBottom && !layer.locked;
    const willChangeUnlock = matchedByUnlock && !!layer.locked;
    return {
      node: layer,
      matched,
      risk: "none" as MatchRisk,
      willChange: willChangeLock || willChangeUnlock,
      children: layer.children ? annotateChildrenLock(layer.children, unlockAll) : [],
    };
  });
}

function annotateChildrenLock(layers: LayerNode[], unlockAll: boolean): AnnotatedLayer[] {
  return [...layers].reverse().map((layer) => ({
    node: layer,
    matched: unlockAll,
    risk: "none" as MatchRisk,
    willChange: unlockAll && !!layer.locked,
    children: layer.children ? annotateChildrenLock(layer.children, unlockAll) : [],
  }));
}

// --- Merge mode annotation ---

/** Text group names matching merge_layers.jsx TEXT_GROUP_NAMES */
const MERGE_TEXT_GROUP_NAMES = ["#text#", "text", "写植", "セリフ", "テキスト", "台詞"];

function isMergeTextGroup(layer: LayerNode): boolean {
  return (
    layer.type === "group" &&
    MERGE_TEXT_GROUP_NAMES.some((p) => layer.name.toLowerCase() === p.toLowerCase())
  );
}

/** Annotate tree for merge mode: text groups → "text" role, everything else → "background" role */
function annotateTreeMerge(layers: LayerNode[]): AnnotatedLayer[] {
  return [...layers].reverse().map((layer) => {
    const isText = isMergeTextGroup(layer);
    return {
      node: layer,
      matched: true,
      risk: "safe" as MatchRisk,
      willChange: true,
      mergeRole: isText ? "text" : "background",
      children: layer.children ? annotateChildrenMerge(layer.children, isText) : [],
    };
  });
}

/** Children inside a text group inherit "text" role; others inherit "background" */
function annotateChildrenMerge(layers: LayerNode[], parentIsText: boolean): AnnotatedLayer[] {
  return [...layers].reverse().map((layer) => {
    const isText = isMergeTextGroup(layer);
    const role = parentIsText || isText ? "text" : "background";
    return {
      node: layer,
      matched: false,
      risk: "none" as MatchRisk,
      willChange: false,
      mergeRole: role,
      children: layer.children ? annotateChildrenMerge(layer.children, role === "text") : [],
    };
  });
}

/** Annotate children of organize mode as non-matched (just visual context) */
function annotateChildrenPlain(layers: LayerNode[]): AnnotatedLayer[] {
  return [...layers].reverse().map((layer) => ({
    node: layer,
    matched: false,
    risk: "none" as MatchRisk,
    willChange: false,
    children: layer.children ? annotateChildrenPlain(layer.children) : [],
  }));
}

/** Annotate tree for "organize" mode — only root layers are candidates */
function annotateTreeOrganize(
  layers: LayerNode[],
  targetName: string,
  includeSpecial: boolean,
): AnnotatedLayer[] {
  return [...layers].reverse().map((layer) => {
    const willMove = isOrganizeCandidate(layer, targetName, includeSpecial);
    return {
      node: layer,
      matched: willMove,
      risk: "safe" as MatchRisk,
      willChange: willMove,
      children: layer.children ? annotateChildrenPlain(layer.children) : [],
    };
  });
}

// --- LayerMove mode annotation ---

interface LayerMoveConditions {
  textLayer: boolean;
  subgroupTop: boolean;
  subgroupBottom: boolean;
  nameEnabled: boolean;
  namePattern: string;
  namePartial: boolean;
  searchScope: "all" | "group";
  searchGroupName: string;
  targetGroupName: string;
}

/** Check if a layer matches ALL enabled layerMove conditions */
function matchesLayerMoveConditions(
  layer: LayerNode,
  cond: LayerMoveConditions,
  parentNode: LayerNode | null,
  siblings: LayerNode[],
  originalIndex: number,
  isSearchRoot: boolean,
): boolean {
  // Text layer condition
  if (cond.textLayer && layer.type !== "text") return false;
  // Subgroup top: parent must be a group (not search root), layer must be last in ag-psd array (= top in PS)
  if (cond.subgroupTop) {
    if (!parentNode || parentNode.type !== "group" || isSearchRoot) return false;
    if (originalIndex !== siblings.length - 1) return false;
  }
  // Subgroup bottom: parent must be a group (not search root), layer must be first in ag-psd array (= bottom in PS)
  if (cond.subgroupBottom) {
    if (!parentNode || parentNode.type !== "group" || isSearchRoot) return false;
    if (originalIndex !== 0) return false;
  }
  // Name pattern match
  if (cond.nameEnabled) {
    if (!cond.namePattern) return false;
    if (cond.namePartial) {
      if (!layer.name.includes(cond.namePattern)) return false;
    } else {
      if (layer.name !== cond.namePattern) return false;
    }
  }
  return true;
}

/** Recursive annotation for layerMove mode */
function annotateLayerMoveRecursive(
  layers: LayerNode[],
  cond: LayerMoveConditions,
  parentNode: LayerNode | null,
  inSearchScope: boolean,
  isSearchRoot: boolean,
): AnnotatedLayer[] {
  return [...layers].reverse().map((layer, reversedIndex) => {
    const originalIndex = layers.length - 1 - reversedIndex;

    // Skip the target group and its contents
    if (layer.type === "group" && layer.name === cond.targetGroupName) {
      return {
        node: layer,
        matched: false,
        risk: "none" as MatchRisk,
        willChange: false,
        children: layer.children ? annotateChildrenPlain(layer.children) : [],
      };
    }

    // Determine if this group enters the search scope
    const isThisSearchGroup =
      cond.searchScope === "group" && layer.type === "group" && layer.name === cond.searchGroupName;

    // Can this layer be matched?
    const canMatch = inSearchScope;

    const matched =
      canMatch &&
      matchesLayerMoveConditions(layer, cond, parentNode, layers, originalIndex, isSearchRoot);

    // Children scope
    const childInScope = inSearchScope || isThisSearchGroup;

    return {
      node: layer,
      matched,
      risk: "safe" as MatchRisk,
      willChange: matched,
      children: layer.children
        ? annotateLayerMoveRecursive(
            layer.children,
            cond,
            layer,
            childInScope,
            isThisSearchGroup, // children of search group: this is their search root
          )
        : [],
    };
  });
}

/** Annotate tree for "layerMove" mode */
function annotateTreeLayerMove(layers: LayerNode[], cond: LayerMoveConditions): AnnotatedLayer[] {
  const inScope = cond.searchScope === "all";
  return annotateLayerMoveRecursive(layers, cond, null, inScope, false);
}

// --- Custom mode annotation ---

// buildPathKey and applyVirtualMoves imported from ../../lib/layerTreeOps

// Virtual move helpers (cloneTree, buildPathIdMap, removeLayerById, insertLayerRelative, applyVirtualMoves)
// are imported from ../../lib/layerTreeOps

/** Annotate tree for "custom" mode — marks layers that have pending custom ops */
function annotateTreeCustom(
  layers: LayerNode[],
  visOps: CustomVisibilityOp[],
  movedIds: Set<string> = new Set(),
  currentPath: string[] = [],
  parentVisible = true,
): AnnotatedLayer[] {
  const opMap = new Map<string, CustomVisibilityOp>();
  for (const op of visOps) {
    opMap.set(buildPathKey(op.path, op.index), op);
  }
  return annotateTreeCustomRecursive(layers, opMap, movedIds, currentPath, parentVisible);
}

function annotateTreeCustomRecursive(
  layers: LayerNode[],
  opMap: Map<string, CustomVisibilityOp>,
  movedIds: Set<string>,
  currentPath: string[],
  parentVisible: boolean,
): AnnotatedLayer[] {
  // Track same-name counts at this level for index disambiguation
  const nameCounts = new Map<string, number>();

  return [...layers].reverse().map((layer) => {
    const count = nameCounts.get(layer.name) ?? 0;
    nameCounts.set(layer.name, count + 1);
    const layerPath = [...currentPath, layer.name];
    const pathKey = buildPathKey(layerPath, count);
    const visOp = opMap.get(pathKey);
    const isMoved = movedIds.has(layer.id);

    const effectiveVisible = layer.visible && parentVisible;
    const willChange = !!visOp || isMoved;
    const matched = willChange;
    const customAction: "show" | "hide" | "move" | undefined =
      visOp?.action ?? (isMoved ? "move" : undefined);

    return {
      node: layer,
      matched,
      risk: "none" as MatchRisk,
      willChange,
      customPath: layerPath,
      customIndex: count,
      customAction,
      children: layer.children
        ? annotateTreeCustomRecursive(layer.children, opMap, movedIds, layerPath, effectiveVisible)
        : [],
    };
  });
}

// --- Delete hidden text annotation (post-processing) ---

/** Mark hidden text layers as willDelete in an already-annotated tree */
function markDeleteTargets(tree: AnnotatedLayer[], isHideMode: boolean): AnnotatedLayer[] {
  return tree.map((item) => {
    const isText = item.node.type === "text";
    const isOrWillBeHidden = !item.node.visible || (isHideMode && item.willChange);
    const willDelete = isText && isOrWillBeHidden;

    return {
      ...item,
      matched: item.matched || willDelete,
      willDelete,
      children: markDeleteTargets(item.children, isHideMode),
    };
  });
}

// --- Main component ---

interface LayerPreviewPanelProps {
  onOpenInPhotoshop?: (filePath: string) => void;
}

export function LayerPreviewPanel({ onOpenInPhotoshop }: LayerPreviewPanelProps) {
  const files = usePsdStore((s) => s.files);
  const selectedFileIds = usePsdStore((s) => s.selectedFileIds);
  const selectedConditions = useLayerStore((s) => s.selectedConditions);
  const customConditions = useLayerStore((s) => s.customConditions);
  const actionMode = useLayerStore((s) => s.actionMode);
  // Organize mode settings
  const organizeTargetName = useLayerStore((s) => s.organizeTargetName);
  const organizeIncludeSpecial = useLayerStore((s) => s.organizeIncludeSpecial);
  // LayerMove mode settings
  const layerMoveTargetName = useLayerStore((s) => s.layerMoveTargetName);
  const layerMoveSearchScope = useLayerStore((s) => s.layerMoveSearchScope);
  const layerMoveSearchGroupName = useLayerStore((s) => s.layerMoveSearchGroupName);
  const layerMoveCondTextLayer = useLayerStore((s) => s.layerMoveCondTextLayer);
  const layerMoveCondSubgroupTop = useLayerStore((s) => s.layerMoveCondSubgroupTop);
  const layerMoveCondSubgroupBottom = useLayerStore((s) => s.layerMoveCondSubgroupBottom);
  const layerMoveCondNameEnabled = useLayerStore((s) => s.layerMoveCondNameEnabled);
  const layerMoveCondName = useLayerStore((s) => s.layerMoveCondName);
  const layerMoveCondNamePartial = useLayerStore((s) => s.layerMoveCondNamePartial);
  const deleteHiddenText = useLayerStore((s) => s.deleteHiddenText);
  // Lock mode
  const lockBottomLayer = useLayerStore((s) => s.lockBottomLayer);
  const unlockAllLayers = useLayerStore((s) => s.unlockAllLayers);
  // Custom mode
  const customVisibilityOps = useLayerStore((s) => s.customVisibilityOps);
  const customMoveOps = useLayerStore((s) => s.customMoveOps);
  const toggleCustomVisibility = useLayerStore((s) => s.toggleCustomVisibility);
  const addCustomMove = useLayerStore((s) => s.addCustomMove);
  const undoCustomOp = useLayerStore((s) => s.undoCustomOp);
  const { openFolderForFile, revealFiles } = useOpenFolder();

  // Tab mode: layers or viewer
  const [viewMode, setViewMode] = useState<"layers" | "viewer">("layers");
  // Viewer: which file index to display
  const [viewerFileIndex, setViewerFileIndex] = useState(0);
  const viewerRef = useRef<HTMLDivElement>(null);

  // Local checked state for multi-select within the layer tree
  const [checkedFileIds, setCheckedFileIds] = useState<Set<string>>(new Set());

  const handleCheck = useCallback((fileId: string, shiftKey: boolean) => {
    setCheckedFileIds((prev) => {
      if (shiftKey) {
        // Shift+click: toggle in multi-select
        const next = new Set(prev);
        if (next.has(fileId)) {
          next.delete(fileId);
        } else {
          next.add(fileId);
        }
        return next;
      } else {
        // Normal click: single toggle (select only this, or deselect if already sole)
        if (prev.size === 1 && prev.has(fileId)) {
          return new Set<string>();
        }
        return new Set([fileId]);
      }
    });
  }, []);

  // Show selected files from sidebar, or all files if none selected
  const targetFiles = useMemo(() => {
    if (selectedFileIds.length > 0) {
      return files.filter((f) => selectedFileIds.includes(f.id));
    }
    return files;
  }, [files, selectedFileIds]);

  const conditions = useMemo(() => {
    const all = [...PRESET_CONDITIONS, ...customConditions];
    return all.filter((c) => selectedConditions.includes(c.id));
  }, [selectedConditions, customConditions]);

  const hasConditions = conditions.length > 0;
  const isHideMode = actionMode === "hide";
  const isOrganizeMode = actionMode === "organize";
  const isLayerMoveMode = actionMode === "layerMove";
  const isCustomMode = actionMode === "custom";
  const isLockMode = actionMode === "lock";
  const isMergeMode = actionMode === "merge";
  const hasAnyLayerMoveCondition =
    layerMoveCondTextLayer ||
    layerMoveCondSubgroupTop ||
    layerMoveCondSubgroupBottom ||
    layerMoveCondNameEnabled;

  // Whether any mode has enough settings to show annotated preview
  const hasAnnotations = useMemo(() => {
    if (isMergeMode) return true; // Always show merge preview
    if (isLockMode) return lockBottomLayer || unlockAllLayers;
    if (isCustomMode) return true; // Always show interactive tree in custom mode
    if (isOrganizeMode) return organizeTargetName.trim() !== "";
    if (isLayerMoveMode) return hasAnyLayerMoveCondition && layerMoveTargetName.trim() !== "";
    if (isHideMode && deleteHiddenText) return true;
    return hasConditions; // hide/show
  }, [
    isMergeMode,
    isLockMode,
    lockBottomLayer,
    unlockAllLayers,
    isCustomMode,
    isOrganizeMode,
    isLayerMoveMode,
    isHideMode,
    organizeTargetName,
    layerMoveTargetName,
    hasAnyLayerMoveCondition,
    hasConditions,
    deleteHiddenText,
  ]);

  const fileAnnotations = useMemo((): FileAnnotation[] => {
    return targetFiles.map((file) => {
      const layerTree = file.metadata?.layerTree ?? [];
      let annotatedTree: AnnotatedLayer[] = [];

      if (isMergeMode) {
        annotatedTree = annotateTreeMerge(layerTree);
      } else if (isLockMode && (lockBottomLayer || unlockAllLayers)) {
        annotatedTree = annotateTreeLock(layerTree, lockBottomLayer, unlockAllLayers);
      } else if (isCustomMode) {
        const ops = customVisibilityOps.get(file.id) ?? [];
        const moveOps = customMoveOps.get(file.id) ?? [];
        const { layers: virtualTree, movedIds } = applyVirtualMoves(layerTree, moveOps);
        annotatedTree = annotateTreeCustom(virtualTree, ops, movedIds);
      } else if (isOrganizeMode && organizeTargetName.trim()) {
        annotatedTree = annotateTreeOrganize(layerTree, organizeTargetName, organizeIncludeSpecial);
      } else if (isLayerMoveMode && hasAnyLayerMoveCondition && layerMoveTargetName.trim()) {
        annotatedTree = annotateTreeLayerMove(layerTree, {
          textLayer: layerMoveCondTextLayer,
          subgroupTop: layerMoveCondSubgroupTop,
          subgroupBottom: layerMoveCondSubgroupBottom,
          nameEnabled: layerMoveCondNameEnabled,
          namePattern: layerMoveCondName,
          namePartial: layerMoveCondNamePartial,
          searchScope: layerMoveSearchScope,
          searchGroupName: layerMoveSearchGroupName,
          targetGroupName: layerMoveTargetName,
        });
      } else if (hasConditions) {
        annotatedTree = annotateTree(layerTree, conditions, isHideMode);
      }

      // deleteHiddenText: mark hidden text layers for deletion
      if (isHideMode && deleteHiddenText) {
        if (annotatedTree.length === 0) {
          // No conditions selected — create plain annotation first
          annotatedTree = annotateChildrenPlain(layerTree);
        }
        annotatedTree = markDeleteTargets(annotatedTree, true);
      }

      const stats =
        annotatedTree.length > 0
          ? countStats(annotatedTree)
          : { matched: 0, warnings: 0, willChange: 0, willDelete: 0 };
      return { file, layerTree, annotatedTree, stats };
    });
  }, [
    targetFiles,
    conditions,
    hasConditions,
    isHideMode,
    isMergeMode,
    isLockMode,
    lockBottomLayer,
    unlockAllLayers,
    isCustomMode,
    customVisibilityOps,
    customMoveOps,
    isOrganizeMode,
    organizeTargetName,
    organizeIncludeSpecial,
    isLayerMoveMode,
    hasAnyLayerMoveCondition,
    layerMoveTargetName,
    layerMoveSearchScope,
    layerMoveSearchGroupName,
    layerMoveCondTextLayer,
    layerMoveCondSubgroupTop,
    layerMoveCondSubgroupBottom,
    layerMoveCondNameEnabled,
    layerMoveCondName,
    layerMoveCondNamePartial,
    deleteHiddenText,
  ]);

  const totalStats = useMemo(() => {
    return fileAnnotations.reduce(
      (acc, fa) => ({
        matched: acc.matched + fa.stats.matched,
        warnings: acc.warnings + fa.stats.warnings,
        willChange: acc.willChange + fa.stats.willChange,
        willDelete: acc.willDelete + fa.stats.willDelete,
      }),
      { matched: 0, warnings: 0, willChange: 0, willDelete: 0 },
    );
  }, [fileAnnotations]);

  // Viewer: use ALL files (not just selected)
  const viewerFiles = files;
  const viewerFile = viewerFiles[viewerFileIndex] ?? viewerFiles[0] ?? null;

  // High-res preview for viewer tab
  const {
    imageUrl: viewerImageUrl,
    isLoading: viewerIsLoading,
    error: viewerError,
    reload: viewerReload,
  } = useHighResPreview(viewerFile?.filePath, {
    maxSize: 2000,
    enabled: viewMode === "viewer" && !!viewerFile,
    pdfPageIndex: viewerFile?.pdfPageIndex,
    pdfSourcePath: viewerFile?.pdfSourcePath,
  });

  // 表示中ファイルが外部変更された場合、自動リロード
  useEffect(() => {
    if (!viewerFile?.fileChanged || !viewerFile.filePath) return;
    invalidateUrlCache(viewerFile.filePath);
    invoke("invalidate_file_cache", { filePath: viewerFile.filePath }).catch(() => {});
    viewerReload();
    invoke("parse_psd_metadata_batch", { filePaths: [viewerFile.filePath] })
      .then((results: unknown) => {
        const arr = results as { metadata?: unknown; thumbnailData?: string; fileSize?: number }[];
        if (arr?.[0]?.metadata) {
          const r = arr[0];
          const thumbnailUrl = r.thumbnailData
            ? `data:image/jpeg;base64,${r.thumbnailData}`
            : undefined;
          usePsdStore.getState().updateFile(viewerFile.id, {
            metadata: r.metadata as import("../../types").PsdMetadata,
            thumbnailUrl,
            thumbnailStatus: "ready",
            fileSize: r.fileSize,
            fileChanged: false,
          });
        }
      })
      .catch(() => {});
  }, [viewerFile?.fileChanged, viewerFile?.id]);

  // Reset viewer index when files change
  useEffect(() => {
    setViewerFileIndex(0);
  }, [files.length]);

  // Sync viewer index when sidebar selection changes
  useEffect(() => {
    if (viewMode !== "viewer" || selectedFileIds.length === 0) return;
    const idx = files.findIndex((f) => f.id === selectedFileIds[0]);
    if (idx >= 0) setViewerFileIndex(idx);
  }, [viewMode, selectedFileIds, files]);

  // Prefetch nearby files for instant navigation (±3)
  useEffect(() => {
    if (viewMode !== "viewer" || viewerFiles.length <= 1) return;
    for (let offset = 1; offset <= 3; offset++) {
      for (const idx of [viewerFileIndex - offset, viewerFileIndex + offset]) {
        if (idx < 0 || idx >= viewerFiles.length) continue;
        const f = viewerFiles[idx];
        if (!f?.filePath) continue;
        prefetchPreview(f.filePath, 2000, f.pdfPageIndex, f.pdfSourcePath);
      }
    }
  }, [viewMode, viewerFileIndex, viewerFiles]);

  // Viewer keyboard navigation
  useEffect(() => {
    if (viewMode !== "viewer" || viewerFiles.length <= 1) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        setViewerFileIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        setViewerFileIndex((i) => Math.min(viewerFiles.length - 1, i + 1));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [viewMode, viewerFiles.length]);

  // Viewer mouse wheel navigation
  useEffect(() => {
    const el = viewerRef.current;
    if (!el || viewMode !== "viewer" || viewerFiles.length <= 1) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.deltaY > 0) {
        setViewerFileIndex((i) => Math.min(viewerFiles.length - 1, i + 1));
      } else if (e.deltaY < 0) {
        setViewerFileIndex((i) => Math.max(0, i - 1));
      }
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [viewMode, viewerFiles.length]);

  // Viewer P/F shortcuts — operate on the currently displayed file
  useEffect(() => {
    if (viewMode !== "viewer") return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!viewerFile) return;

      if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (onOpenInPhotoshop) onOpenInPhotoshop(viewerFile.filePath);
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        e.stopImmediatePropagation();
        openFolderForFile(viewerFile.filePath);
      }
    };
    // Use capture phase to intercept before global handlers
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [viewMode, viewerFile, onOpenInPhotoshop, openFolderForFile]);

  // Clean up checked IDs when target files change
  useEffect(() => {
    const targetIds = new Set(targetFiles.map((f) => f.id));
    setCheckedFileIds((prev) => {
      const next = new Set<string>();
      for (const id of prev) {
        if (targetIds.has(id)) next.add(id);
      }
      return next.size !== prev.size ? next : prev;
    });
  }, [targetFiles]);

  // P key handler: open checked files (or single active file) in Photoshop
  useEffect(() => {
    if (!onOpenInPhotoshop) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        if (checkedFileIds.size > 0) {
          // Open all checked files
          for (const fa of fileAnnotations) {
            if (checkedFileIds.has(fa.file.id)) {
              onOpenInPhotoshop(fa.file.filePath);
            }
          }
        } else if (targetFiles.length === 1) {
          // Single file mode: open that file
          onOpenInPhotoshop(targetFiles[0].filePath);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onOpenInPhotoshop, checkedFileIds, fileAnnotations, targetFiles]);

  // Ctrl+Z undo for custom mode
  useEffect(() => {
    if (!isCustomMode) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        undoCustomOp();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isCustomMode, undoCustomOp]);

  // Empty
  if (targetFiles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-6">
        <div className="w-12 h-12 rounded-2xl bg-bg-tertiary flex items-center justify-center mb-3">
          <svg
            className="w-6 h-6 text-text-muted"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
            />
          </svg>
        </div>
        <p className="text-[11px] text-text-muted">ファイルを選択</p>
      </div>
    );
  }

  const isMulti = targetFiles.length > 1;
  const noChangeCount = totalStats.matched - totalStats.willChange;

  return (
    <div className="flex flex-col h-full bg-bg-primary select-none">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          {/* Tab Switcher */}
          <div className="flex bg-bg-elevated rounded-md p-0.5 border border-white/5 flex-shrink-0">
            <button
              onClick={() => setViewMode("layers")}
              className={`px-2 py-1 text-[10px] rounded transition-all ${
                viewMode === "layers"
                  ? "bg-bg-tertiary text-text-primary font-medium shadow-sm"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              <svg
                className="w-3 h-3 inline mr-0.5 -mt-px"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                />
              </svg>
              レイヤー構造
            </button>
            <button
              onClick={() => setViewMode("viewer")}
              className={`px-2 py-1 text-[10px] rounded transition-all ${
                viewMode === "viewer"
                  ? "bg-bg-tertiary text-text-primary font-medium shadow-sm"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              <svg
                className="w-3 h-3 inline mr-0.5 -mt-px"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                />
              </svg>
              ビューアー
            </button>
          </div>

          {/* File info */}
          {viewMode === "layers" && (
            <>
              {!isMulti && (
                <span className="text-xs font-display font-medium text-text-primary truncate">
                  {targetFiles[0].fileName}
                </span>
              )}
              <span className="text-[10px] text-text-muted ml-auto flex-shrink-0">
                {isMulti
                  ? `${targetFiles.length} ファイル`
                  : `${targetFiles[0].metadata?.layerCount ?? 0} レイヤー`}
              </span>
            </>
          )}

          {viewMode === "viewer" && viewerFile && (
            <>
              <span className="text-xs font-display font-medium text-text-primary truncate">
                {viewerFile.fileName}
              </span>
              {viewerFiles.length > 1 && (
                <span className="text-[10px] text-text-muted ml-auto flex-shrink-0">
                  {viewerFileIndex + 1} / {viewerFiles.length}
                </span>
              )}
            </>
          )}

          {/* Action buttons - layers mode */}
          {viewMode === "layers" && !isMulti && (
            <FolderButton onClick={() => openFolderForFile(targetFiles[0].filePath)} />
          )}
          {viewMode === "layers" && !isMulti && onOpenInPhotoshop && (
            <PsButton onClick={() => onOpenInPhotoshop(targetFiles[0].filePath)} />
          )}
          {viewMode === "layers" && isMulti && checkedFileIds.size > 0 && (
            <button
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-text-muted hover:text-text-primary bg-bg-tertiary/50 hover:bg-bg-tertiary transition-colors flex-shrink-0"
              onClick={() => {
                const paths = fileAnnotations
                  .filter((fa) => checkedFileIds.has(fa.file.id))
                  .map((fa) => fa.file.filePath);
                if (paths.length > 1) {
                  revealFiles(paths);
                } else if (paths.length === 1) {
                  openFolderForFile(paths[0]);
                }
              }}
              title={`${checkedFileIds.size}件をエクスプローラーで選択 (F)`}
            >
              <svg
                className="w-3 h-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                />
              </svg>
              {checkedFileIds.size}件
            </button>
          )}
          {viewMode === "layers" && isMulti && checkedFileIds.size > 0 && onOpenInPhotoshop && (
            <button
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-[#31A8FF] bg-[#31A8FF]/10 hover:bg-[#31A8FF]/20 transition-colors flex-shrink-0"
              onClick={() => {
                for (const fa of fileAnnotations) {
                  if (checkedFileIds.has(fa.file.id)) {
                    onOpenInPhotoshop(fa.file.filePath);
                  }
                }
              }}
              title={`${checkedFileIds.size}件をPhotoshopで開く (P)`}
            >
              <span className="text-[10px] font-bold leading-none">P</span>
              {checkedFileIds.size}件を開く
            </button>
          )}

          {/* Action buttons - viewer mode */}
          {viewMode === "viewer" && viewerFile && (
            <FolderButton onClick={() => openFolderForFile(viewerFile.filePath)} />
          )}
          {viewMode === "viewer" && viewerFile && onOpenInPhotoshop && (
            <PsButton onClick={() => onOpenInPhotoshop(viewerFile.filePath)} />
          )}
        </div>
        {viewMode === "layers" && hasAnnotations && (
          <div className="flex items-center gap-2.5 mt-0.5">
            {isMergeMode ? (
              (() => {
                const textCount = fileAnnotations.reduce(
                  (sum, fa) => sum + fa.annotatedTree.filter((i) => i.mergeRole === "text").length,
                  0,
                );
                const bgCount = fileAnnotations.reduce(
                  (sum, fa) =>
                    sum + fa.annotatedTree.filter((i) => i.mergeRole === "background").length,
                  0,
                );
                return (
                  <>
                    {textCount > 0 && (
                      <span className="text-[11px] font-medium text-emerald-500">
                        テキスト {textCount}
                      </span>
                    )}
                    {bgCount > 0 && (
                      <span className="text-[11px] font-medium text-blue-500">背景 {bgCount}</span>
                    )}
                  </>
                );
              })()
            ) : totalStats.willChange > 0 ? (
              <span
                className={`text-[11px] font-medium ${
                  isCustomMode
                    ? "text-sky-500"
                    : isOrganizeMode
                      ? "text-warning"
                      : isLayerMoveMode
                        ? "text-violet-500"
                        : isHideMode
                          ? "text-accent"
                          : "text-accent-tertiary"
                }`}
              >
                {totalStats.willChange} 件
                {isCustomMode
                  ? "操作登録中"
                  : isOrganizeMode
                    ? "格納予定"
                    : isLayerMoveMode
                      ? "移動予定"
                      : isHideMode
                        ? "非表示予定"
                        : "表示予定"}
              </span>
            ) : isOrganizeMode || isLayerMoveMode ? (
              <span className="text-[11px] text-text-muted">
                {isOrganizeMode ? "格納対象なし" : "移動対象なし"}
              </span>
            ) : totalStats.matched > 0 && totalStats.willDelete === 0 ? (
              <span className="text-[11px] text-text-muted">
                変更なし（{isHideMode ? "非表示" : "表示"}済）
              </span>
            ) : null}
            {totalStats.willDelete > 0 && (
              <span className="text-[11px] font-medium text-error">
                {totalStats.willDelete} 件削除予定
              </span>
            )}
            {!isOrganizeMode &&
              !isLayerMoveMode &&
              noChangeCount > 0 &&
              totalStats.willChange > 0 && (
                <span className="text-[11px] text-text-muted">{noChangeCount} 件済</span>
              )}
            {totalStats.warnings > 0 && (
              <span className="text-[11px] font-medium text-amber-500 flex items-center gap-0.5">
                <WarnIcon className="w-2.5 h-2.5" />
                {totalStats.warnings}
              </span>
            )}
          </div>
        )}
        {viewMode === "viewer" && viewerFile?.metadata && (
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-text-muted">
              {viewerFile.metadata.width} x {viewerFile.metadata.height}
            </span>
            <span className="text-[10px] text-text-muted">{viewerFile.metadata.dpi} dpi</span>
            <span className="text-[10px] text-text-muted">{viewerFile.metadata.colorMode}</span>
          </div>
        )}
      </div>

      {/* Content - Layers Mode */}
      {viewMode === "layers" && (
        <div className="flex-1 overflow-y-auto min-h-0">
          {!isMulti ? (
            <div className="p-1.5">
              <SingleFileTree
                annotation={fileAnnotations[0]}
                hasAnnotations={hasAnnotations}
                actionMode={actionMode}
                onToggleCustomVisibility={
                  isCustomMode
                    ? (path, index, vis, layerId) =>
                        toggleCustomVisibility(
                          fileAnnotations[0].file.id,
                          path,
                          index,
                          vis,
                          layerId,
                        )
                    : undefined
                }
                onAddCustomMove={
                  isCustomMode
                    ? (move) => addCustomMove(fileAnnotations[0].file.id, move)
                    : undefined
                }
              />
            </div>
          ) : (
            <div
              className="grid h-fit"
              style={{
                gridTemplateColumns: `repeat(${Math.min(fileAnnotations.length, 3)}, 1fr)`,
              }}
            >
              {fileAnnotations.map((fa) => (
                <FileColumn
                  key={fa.file.id}
                  annotation={fa}
                  hasAnnotations={hasAnnotations}
                  actionMode={actionMode}
                  isChecked={checkedFileIds.has(fa.file.id)}
                  onToggleCheck={(shiftKey) => handleCheck(fa.file.id, shiftKey)}
                  onOpenInPhotoshop={
                    onOpenInPhotoshop ? () => onOpenInPhotoshop(fa.file.filePath) : undefined
                  }
                  onOpenFolder={() => openFolderForFile(fa.file.filePath)}
                  onToggleCustomVisibility={
                    isCustomMode
                      ? (path, index, vis, layerId) =>
                          toggleCustomVisibility(fa.file.id, path, index, vis, layerId)
                      : undefined
                  }
                  onAddCustomMove={
                    isCustomMode ? (move) => addCustomMove(fa.file.id, move) : undefined
                  }
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Content - Viewer Mode */}
      {viewMode === "viewer" && (
        <div
          ref={viewerRef}
          className="flex-1 overflow-hidden min-h-0 relative flex items-center justify-center bg-[#1a1a1e]"
        >
          {/* メイン画像 — ロード中も前の画像を維持してちらつき防止 */}
          {viewerImageUrl ? (
            <img
              src={viewerImageUrl}
              alt={viewerFile?.fileName}
              className={`max-w-full max-h-full object-contain select-none transition-opacity duration-150 ${viewerIsLoading ? "opacity-40" : "opacity-100"}`}
              draggable={false}
            />
          ) : viewerFile?.thumbnailUrl ? (
            /* サムネイルフォールバック（高解像度ロード前に即座に表示） */
            <img
              src={viewerFile.thumbnailUrl}
              alt={viewerFile.fileName}
              className="max-w-full max-h-full object-contain select-none opacity-60"
              draggable={false}
            />
          ) : null}
          {/* ローディングインジケーター（画像の上にオーバーレイ） */}
          {viewerIsLoading && (
            <div className="absolute top-3 right-3 z-10">
              <div className="w-5 h-5 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
            </div>
          )}
          {viewerError && !viewerImageUrl && (
            <div className="flex flex-col items-center gap-2 text-center px-6">
              <svg
                className="w-8 h-8 text-error/50"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                />
              </svg>
              <p className="text-[11px] text-text-muted">プレビューの読み込みに失敗</p>
              <button
                onClick={viewerReload}
                className="text-[10px] text-accent hover:text-accent/80 transition-colors"
              >
                再試行
              </button>
            </div>
          )}
          {!viewerFile && <p className="text-[11px] text-text-muted">ファイルを選択</p>}

          {/* Navigation arrows for multi-file */}
          {viewerFiles.length > 1 && (
            <>
              {viewerFileIndex > 0 && (
                <button
                  onClick={() => setViewerFileIndex((i) => i - 1)}
                  className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center text-white/70 hover:text-white transition-all backdrop-blur-sm"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
              )}
              {viewerFileIndex < viewerFiles.length - 1 && (
                <button
                  onClick={() => setViewerFileIndex((i) => i + 1)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center text-white/70 hover:text-white transition-all backdrop-blur-sm"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Legend */}
      {viewMode === "layers" && hasAnnotations && (
        <div className="px-3 py-1.5 border-t border-border flex-shrink-0 flex items-center gap-3">
          {isMergeMode ? (
            <>
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm bg-emerald-500/30" />
                <span className="text-[9px] text-text-muted">テキスト</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm bg-blue-500/30" />
                <span className="text-[9px] text-text-muted">→背景に統合</span>
              </div>
            </>
          ) : isCustomMode ? (
            <>
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm bg-accent-tertiary/30" />
                <span className="text-[9px] text-text-muted">{`→表示`}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm bg-accent/30" />
                <span className="text-[9px] text-text-muted">{`→非表示`}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm bg-violet-500/30" />
                <span className="text-[9px] text-text-muted">移動</span>
              </div>
              <div className="flex items-center gap-1 ml-auto">
                <span className="text-[9px] text-text-muted/60">クリックで切替 / D&Dで移動</span>
              </div>
            </>
          ) : (
            <>
              {isLockMode && lockBottomLayer && (
                <div className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm bg-amber-500/30" />
                  <span className="text-[9px] text-text-muted">→ロック</span>
                </div>
              )}
              {isLockMode && unlockAllLayers && (
                <div className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm bg-sky-500/30" />
                  <span className="text-[9px] text-text-muted">→解除</span>
                </div>
              )}
              {(hasConditions || isOrganizeMode || isLayerMoveMode) && (
                <div className="flex items-center gap-1">
                  <span
                    className={`w-2 h-2 rounded-sm ${
                      isOrganizeMode
                        ? "bg-warning/30"
                        : isLayerMoveMode
                          ? "bg-violet-500/30"
                          : isHideMode
                            ? "bg-accent/30"
                            : "bg-accent-tertiary/30"
                    }`}
                  />
                  <span className="text-[9px] text-text-muted">
                    {isOrganizeMode
                      ? "→格納"
                      : isLayerMoveMode
                        ? "→移動"
                        : isHideMode
                          ? "→非表示"
                          : "→表示"}
                  </span>
                </div>
              )}
              {isHideMode && deleteHiddenText && (
                <div className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm bg-error/30" />
                  <span className="text-[9px] text-text-muted">{`→削除`}</span>
                </div>
              )}
              {(actionMode === "hide" || actionMode === "show") && (
                <div className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm bg-amber-500/30" />
                  <span className="text-[9px] text-text-muted">要確認</span>
                </div>
              )}
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm bg-text-muted/20" />
                <span className="text-[9px] text-text-muted">
                  {isOrganizeMode || isLayerMoveMode ? "対象外" : "済"}
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// --- Single file tree ---

function SingleFileTree({
  annotation,
  hasAnnotations,
  actionMode,
  onToggleCustomVisibility,
  onAddCustomMove,
}: {
  annotation: FileAnnotation;
  hasAnnotations: boolean;
  actionMode: LayerActionMode;
  onToggleCustomVisibility?: (
    path: string[],
    index: number,
    currentVisible: boolean,
    layerId?: string,
  ) => void;
  onAddCustomMove?: (move: CustomMoveOp) => void;
}) {
  if (annotation.layerTree.length === 0) {
    return (
      <div className="flex items-center justify-center py-6 text-[11px] text-text-muted">
        レイヤー情報なし
      </div>
    );
  }

  if (!hasAnnotations) {
    return <PlainTree layers={annotation.layerTree} depth={0} parentVisible />;
  }

  const tree = (
    <AnnotatedTree
      items={annotation.annotatedTree}
      depth={0}
      actionMode={actionMode}
      parentVisible
      onToggleCustomVisibility={onToggleCustomVisibility}
      isDndEnabled={!!onAddCustomMove}
    />
  );

  return onAddCustomMove ? (
    <DndTreeWrapper onAddCustomMove={onAddCustomMove}>{tree}</DndTreeWrapper>
  ) : (
    tree
  );
}

// --- D&D Context Wrapper ---

interface DragItemData {
  path: string[];
  index: number;
}

interface DropTargetData {
  targetPath: string[];
  targetIndex: number;
  placement: "before" | "after" | "inside";
}

function DndTreeWrapper({
  children,
  onAddCustomMove,
}: {
  children: React.ReactNode;
  onAddCustomMove: (move: CustomMoveOp) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeName, setActiveName] = useState<string>("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
    const data = event.active.data.current as DragItemData | undefined;
    setActiveName(data?.path[data.path.length - 1] ?? "");
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      setActiveName("");
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const source = active.data.current as DragItemData | undefined;
      const target = over.data.current as DropTargetData | undefined;
      if (!source || !target) return;

      // Prevent dropping on exact same layer (path + index must match)
      const sourcePathKey = source.path.join("/") + ":" + source.index;
      const targetPathKey = target.targetPath.join("/") + ":" + target.targetIndex;
      if (targetPathKey === sourcePathKey) return;

      // Prevent dropping into own subtree (child path starts with source path/)
      const sourcePath = source.path.join("/");
      if (target.targetPath.join("/").startsWith(sourcePath + "/")) return;

      onAddCustomMove({
        sourcePath: source.path,
        sourceIndex: source.index,
        targetPath: target.targetPath,
        targetIndex: target.targetIndex,
        placement: target.placement,
      });
    },
    [onAddCustomMove],
  );

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      {children}
      <DragOverlay dropAnimation={null}>
        {activeId ? (
          <div className="px-2 py-1 rounded bg-sky-500/20 border border-sky-500/40 text-[11px] text-sky-300 shadow-lg backdrop-blur-sm whitespace-nowrap">
            {activeName}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

// --- File column (multi-file) ---

function FileColumn({
  annotation,
  hasAnnotations,
  actionMode,
  isChecked,
  onToggleCheck,
  onOpenInPhotoshop,
  onOpenFolder,
  onToggleCustomVisibility,
  onAddCustomMove,
}: {
  annotation: FileAnnotation;
  hasAnnotations: boolean;
  actionMode: LayerActionMode;
  isChecked: boolean;
  onToggleCheck: (shiftKey: boolean) => void;
  onOpenInPhotoshop?: () => void;
  onOpenFolder?: () => void;
  onToggleCustomVisibility?: (
    path: string[],
    index: number,
    currentVisible: boolean,
    layerId?: string,
  ) => void;
  onAddCustomMove?: (move: CustomMoveOp) => void;
}) {
  const { file, layerTree, annotatedTree, stats } = annotation;
  const lockBottomLayer = useLayerStore((s) => s.lockBottomLayer);
  const unlockAllLayers = useLayerStore((s) => s.unlockAllLayers);

  return (
    <div
      className={`
        flex flex-col min-w-0 cursor-pointer border-r border-b border-border
        ${isChecked ? "bg-[#31A8FF]/[0.03]" : ""}
      `}
      onClick={(e) => onToggleCheck(e.shiftKey)}
    >
      {/* Column header */}
      <div
        className={`
          px-2 py-1.5 border-b flex-shrink-0 flex items-center gap-1.5 group
          transition-colors hover:bg-bg-tertiary/50
          ${isChecked ? "border-[#31A8FF]/30 bg-[#31A8FF]/8" : "border-border/60 bg-bg-secondary/30"}
        `}
      >
        {/* Checkbox */}
        <div
          className={`
          w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 transition-all
          ${
            isChecked
              ? "border-[#31A8FF] bg-[#31A8FF] text-white"
              : "border-border-strong/40 group-hover:border-text-muted"
          }
        `}
        >
          {isChecked && (
            <svg
              className="w-2.5 h-2.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={3}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
        <span
          className={`text-[11px] font-medium truncate flex-1 ${isChecked ? "text-[#31A8FF]" : "text-text-primary"}`}
        >
          {file.fileName.replace(/\.(psd|psb)$/i, "")}
        </span>
        {hasAnnotations && stats.willChange > 0 && (
          <span
            className={`text-[9px] px-1 py-px rounded flex-shrink-0 ${
              actionMode === "merge"
                ? "bg-emerald-500/10 text-emerald-500"
                : actionMode === "lock"
                  ? unlockAllLayers && !lockBottomLayer
                    ? "bg-sky-500/10 text-sky-500"
                    : "bg-amber-500/10 text-amber-500"
                  : actionMode === "custom"
                    ? "bg-sky-500/10 text-sky-500"
                    : actionMode === "organize"
                      ? "bg-warning/10 text-warning"
                      : actionMode === "layerMove"
                        ? "bg-violet-500/10 text-violet-500"
                        : actionMode === "hide"
                          ? "bg-accent/10 text-accent"
                          : "bg-accent-tertiary/10 text-accent-tertiary"
            }`}
          >
            {stats.willChange}
          </span>
        )}
        {hasAnnotations && stats.willDelete > 0 && (
          <span className="text-[9px] px-1 py-px rounded flex-shrink-0 bg-error/10 text-error">
            {stats.willDelete}削除
          </span>
        )}
        {stats.warnings > 0 && (
          <span className="text-[9px] px-1 py-px rounded bg-amber-500/10 text-amber-500 flex-shrink-0 flex items-center gap-px">
            <WarnIcon className="w-2 h-2" />
            {stats.warnings}
          </span>
        )}
        <span className="text-[9px] text-text-muted/60 flex-shrink-0">
          {file.metadata?.layerCount ?? 0}
        </span>
        {onOpenFolder && (
          <FolderButton
            onClick={(e) => {
              e.stopPropagation();
              onOpenFolder();
            }}
            compact
            className="opacity-0 group-hover:opacity-100"
          />
        )}
        {onOpenInPhotoshop && (
          <PsButton
            onClick={(e) => {
              e.stopPropagation();
              onOpenInPhotoshop();
            }}
            compact
            className="opacity-0 group-hover:opacity-100"
          />
        )}
      </div>

      {/* Tree body */}
      <div className="p-1">
        {layerTree.length === 0 ? (
          <div className="flex items-center justify-center py-4 text-[10px] text-text-muted">
            レイヤー情報なし
          </div>
        ) : hasAnnotations ? (
          (() => {
            const tree = (
              <AnnotatedTree
                items={annotatedTree}
                depth={0}
                actionMode={actionMode}
                parentVisible
                onToggleCustomVisibility={onToggleCustomVisibility}
                isDndEnabled={!!onAddCustomMove}
              />
            );
            return onAddCustomMove ? (
              <DndTreeWrapper onAddCustomMove={onAddCustomMove}>{tree}</DndTreeWrapper>
            ) : (
              tree
            );
          })()
        ) : (
          <PlainTree layers={layerTree} depth={0} parentVisible />
        )}
      </div>
    </div>
  );
}

// --- Plain tree ---

function PlainTree({
  layers,
  depth,
  parentVisible,
}: {
  layers: LayerNode[];
  depth: number;
  parentVisible: boolean;
}) {
  const reversed = useMemo(() => [...layers].reverse(), [layers]);
  return (
    <div className="text-[11px]">
      {reversed.map((layer) => (
        <PlainItem key={layer.id} layer={layer} depth={depth} parentVisible={parentVisible} />
      ))}
    </div>
  );
}

function PlainItem({
  layer,
  depth,
  parentVisible,
}: {
  layer: LayerNode;
  depth: number;
  parentVisible: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(depth < 2);
  const hasChildren = layer.children && layer.children.length > 0;
  const effectiveVisible = layer.visible && parentVisible;

  return (
    <div>
      <div
        className={`
          flex items-center gap-1 py-[3px] px-1 rounded transition-colors
          hover:bg-bg-tertiary/50 cursor-default
        `}
        style={{ paddingLeft: `${depth * 12 + 2}px` }}
      >
        <ExpandBtn
          has={!!hasChildren}
          open={isExpanded}
          toggle={() => setIsExpanded(!isExpanded)}
        />
        <VisIcon visible={layer.visible} effective={effectiveVisible} />
        <TypeIcon type={layer.type} visible={effectiveVisible} />
        <span
          className={`truncate flex-1 ${effectiveVisible ? "text-text-primary" : "text-text-muted/50"}`}
          title={layer.name}
        >
          {layer.name || <span className="italic text-text-muted/50">名称なし</span>}
        </span>
        <div className={effectiveVisible ? "" : "opacity-40"}>
          <Badges layer={layer} />
        </div>
      </div>
      {hasChildren && isExpanded && (
        <div className="relative">
          <div
            className="absolute left-0 top-0 bottom-1 w-px bg-border/40"
            style={{ marginLeft: `${depth * 12 + 9}px` }}
          />
          <PlainTree layers={layer.children!} depth={depth + 1} parentVisible={effectiveVisible} />
        </div>
      )}
    </div>
  );
}

// --- Drop gap (between items) ---

function DropGap({ id, data }: { id: string; data: DropTargetData }) {
  const { isOver, setNodeRef } = useDroppable({ id, data });
  return (
    <div ref={setNodeRef} className="h-[8px] -my-[3px] relative flex items-center">
      <div
        className={`h-[2px] mx-1 rounded-full w-full transition-colors ${isOver ? "bg-sky-500" : "bg-transparent"}`}
      />
    </div>
  );
}

// --- Annotated tree ---

function AnnotatedTree({
  items,
  depth,
  actionMode,
  parentVisible = true,
  onToggleCustomVisibility,
  isDndEnabled,
}: {
  items: AnnotatedLayer[];
  depth: number;
  actionMode: LayerActionMode;
  parentVisible?: boolean;
  onToggleCustomVisibility?: (
    path: string[],
    index: number,
    currentVisible: boolean,
    layerId?: string,
  ) => void;
  isDndEnabled?: boolean;
}) {
  return (
    <div className="text-[11px]">
      {items.map((item, idx) => (
        <div key={item.node.id}>
          {isDndEnabled && idx === 0 && item.customPath && (
            <DropGap
              id={`gap:before:${buildPathKey(item.customPath, item.customIndex ?? 0)}`}
              data={{
                targetPath: item.customPath,
                targetIndex: item.customIndex ?? 0,
                placement: "before",
              }}
            />
          )}
          <AnnotatedItem
            item={item}
            depth={depth}
            actionMode={actionMode}
            parentVisible={parentVisible}
            onToggleCustomVisibility={onToggleCustomVisibility}
            isDndEnabled={isDndEnabled}
          />
          {isDndEnabled && item.customPath && (
            <DropGap
              id={`gap:after:${buildPathKey(item.customPath, item.customIndex ?? 0)}`}
              data={{
                targetPath: item.customPath,
                targetIndex: item.customIndex ?? 0,
                placement: "after",
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function AnnotatedItem({
  item,
  depth,
  actionMode,
  parentVisible = true,
  onToggleCustomVisibility,
  isDndEnabled,
}: {
  item: AnnotatedLayer;
  depth: number;
  actionMode: LayerActionMode;
  parentVisible?: boolean;
  onToggleCustomVisibility?: (
    path: string[],
    index: number,
    currentVisible: boolean,
    layerId?: string,
  ) => void;
  isDndEnabled?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(depth < 2);
  const { node, matched, risk, willChange, children } = item;
  const hasChildren = children.length > 0;
  const isHideMode = actionMode === "hide";
  const isCustomMode = actionMode === "custom";
  const effectiveVisible = node.visible && parentVisible;

  // D&D: draggable
  const pathKey = item.customPath ? buildPathKey(item.customPath, item.customIndex ?? 0) : "";
  const {
    attributes: dragAttrs,
    listeners: dragListeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id: isDndEnabled ? `drag:${pathKey}` : "__disabled__",
    data: { path: item.customPath ?? [], index: item.customIndex ?? 0 } as DragItemData,
    disabled: !isDndEnabled,
  });

  // D&D: droppable (groups only — "inside" placement)
  const { isOver: isOverGroup, setNodeRef: setDropRef } = useDroppable({
    id: isDndEnabled && hasChildren ? `group:${pathKey}` : "__disabled_drop__",
    data: {
      targetPath: item.customPath ?? [],
      targetIndex: item.customIndex ?? 0,
      placement: "inside",
    } as DropTargetData,
    disabled: !isDndEnabled || !hasChildren,
  });

  // Post-action visibility
  const postActionVisible = isCustomMode
    ? item.customAction === "show"
      ? true
      : item.customAction === "hide"
        ? false
        : effectiveVisible
    : willChange
      ? !isHideMode // hide->false, show->true
      : effectiveVisible;

  const isDeleteTarget = !!item.willDelete;
  let rowBg = "";
  let borderLeft = "";
  let rowOpacity = "";

  if (isDeleteTarget) {
    rowBg = "bg-error/8";
    borderLeft = "border-l-[2px] border-error/50";
  } else if (willChange && risk === "warning") {
    rowBg = "bg-amber-500/8";
    borderLeft = "border-l-[2px] border-amber-500";
  } else if (willChange) {
    if (actionMode === "merge") {
      if (item.mergeRole === "text") {
        rowBg = "bg-emerald-500/8";
        borderLeft = "border-l-[2px] border-emerald-500/50";
      } else {
        rowBg = "bg-blue-500/8";
        borderLeft = "border-l-[2px] border-blue-500/50";
      }
    } else if (actionMode === "custom") {
      if (item.customAction === "move") {
        rowBg = "bg-violet-500/8";
        borderLeft = "border-l-[2px] border-violet-500/50";
      } else {
        rowBg = "bg-sky-500/8";
        borderLeft = "border-l-[2px] border-sky-500/50";
      }
    } else if (actionMode === "lock") {
      if (node.locked) {
        // Unlocking
        rowBg = "bg-sky-500/8";
        borderLeft = "border-l-[2px] border-sky-500/50";
      } else {
        // Locking
        rowBg = "bg-amber-500/8";
        borderLeft = "border-l-[2px] border-amber-500/50";
      }
    } else if (actionMode === "organize") {
      rowBg = "bg-warning/8";
      borderLeft = "border-l-[2px] border-warning/50";
    } else if (actionMode === "layerMove") {
      rowBg = "bg-violet-500/8";
      borderLeft = "border-l-[2px] border-violet-500/50";
    } else if (actionMode === "hide") {
      rowBg = "bg-accent/8";
      borderLeft = "border-l-[2px] border-accent/50";
    } else {
      rowBg = "bg-accent-tertiary/8";
      borderLeft = "border-l-[2px] border-accent-tertiary/50";
    }
  } else if (matched) {
    rowBg = "bg-bg-tertiary/30";
    borderLeft = "border-l-[2px] border-text-muted/15";
    rowOpacity = "opacity-55";
  } else if (item.mergeRole) {
    // Merge mode children: subtle role-based coloring
    if (item.mergeRole === "text") {
      borderLeft = "border-l-[2px] border-emerald-500/20";
    } else {
      borderLeft = "border-l-[2px] border-blue-500/20";
    }
  } else if (!postActionVisible) {
    rowOpacity = "opacity-35";
  }

  // Mode-specific badge styling
  const badgeClass = isDeleteTarget
    ? "bg-error/12 text-error font-medium"
    : willChange
      ? actionMode === "merge"
        ? item.mergeRole === "text"
          ? "bg-emerald-500/12 text-emerald-500 font-medium"
          : "bg-blue-500/12 text-blue-500 font-medium"
        : actionMode === "custom"
          ? item.customAction === "move"
            ? "bg-violet-500/12 text-violet-500 font-medium"
            : item.customAction === "hide"
              ? "bg-accent/12 text-accent font-medium"
              : "bg-accent-tertiary/12 text-accent-tertiary font-medium"
          : actionMode === "lock"
            ? node.locked
              ? "bg-sky-500/12 text-sky-500 font-medium"
              : "bg-amber-500/12 text-amber-500 font-medium"
            : actionMode === "organize"
              ? "bg-warning/12 text-warning font-medium"
              : actionMode === "layerMove"
                ? "bg-violet-500/12 text-violet-500 font-medium"
                : actionMode === "hide"
                  ? "bg-accent/12 text-accent font-medium"
                  : "bg-accent-tertiary/12 text-accent-tertiary font-medium"
      : "bg-text-muted/8 text-text-muted/70";

  const badgeText = isDeleteTarget
    ? "→削除"
    : willChange
      ? actionMode === "merge"
        ? item.mergeRole === "text"
          ? "テキスト"
          : "→背景"
        : actionMode === "custom"
          ? item.customAction === "move"
            ? "移動"
            : item.customAction === "hide"
              ? "→非表示"
              : "→表示"
          : actionMode === "lock"
            ? node.locked
              ? "→解除"
              : "→ロック"
            : actionMode === "organize"
              ? "→格納"
              : actionMode === "layerMove"
                ? "→移動"
                : actionMode === "hide"
                  ? "→非表示"
                  : "→表示"
      : actionMode === "merge"
        ? "" // children in merge mode don't need a badge
        : actionMode === "lock"
          ? matched
            ? node.locked
              ? "ロック済"
              : "解除済"
            : ""
          : actionMode === "organize" || actionMode === "layerMove"
            ? "対象外"
            : actionMode === "hide"
              ? "非表示済"
              : "表示済";

  // Custom mode: click handler for VisIcon
  // Use effectiveVisible (not node.visible) so that a layer hidden by parent group
  // correctly registers as "→表示" instead of misleading "→非表示"
  const handleVisClick =
    isCustomMode && onToggleCustomVisibility && item.customPath
      ? (e: React.MouseEvent) => {
          e.stopPropagation();
          onToggleCustomVisibility(
            item.customPath!,
            item.customIndex!,
            effectiveVisible,
            item.node.id,
          );
        }
      : undefined;

  // Merge refs for drag + drop on same element
  const mergedRef = useCallback(
    (el: HTMLElement | null) => {
      setDragRef(el);
      if (hasChildren) setDropRef(el);
    },
    [setDragRef, setDropRef, hasChildren],
  );

  return (
    <div style={isDragging ? { opacity: 0.4 } : undefined}>
      <div
        ref={isDndEnabled ? mergedRef : undefined}
        className={`
          flex items-center gap-1 py-[3px] px-1 rounded transition-colors
          ${isCustomMode ? "hover:bg-sky-500/5 cursor-pointer" : "hover:bg-bg-tertiary/50 cursor-default"}
          ${rowBg} ${borderLeft} ${rowOpacity}
          ${isOverGroup && isDndEnabled ? "ring-1 ring-sky-500/60 bg-sky-500/10" : ""}
        `}
        style={{ paddingLeft: `${depth * 12 + (isDndEnabled ? 0 : 2)}px` }}
        onClick={handleVisClick}
      >
        {/* Drag handle */}
        {isDndEnabled && (
          <button
            className="w-4 h-4 flex items-center justify-center text-text-muted/40 hover:text-sky-400 cursor-grab active:cursor-grabbing flex-shrink-0 touch-none"
            {...dragListeners}
            {...dragAttrs}
            onClick={(e) => e.stopPropagation()}
          >
            <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
              <circle cx="5" cy="3" r="1.2" />
              <circle cx="11" cy="3" r="1.2" />
              <circle cx="5" cy="8" r="1.2" />
              <circle cx="11" cy="8" r="1.2" />
              <circle cx="5" cy="13" r="1.2" />
              <circle cx="11" cy="13" r="1.2" />
            </svg>
          </button>
        )}
        <ExpandBtn has={hasChildren} open={isExpanded} toggle={() => setIsExpanded(!isExpanded)} />
        <VisIcon
          visible={node.visible}
          effective={postActionVisible}
          onClick={handleVisClick}
          customAction={willChange ? item.customAction : undefined}
        />
        <TypeIcon type={node.type} visible={postActionVisible} />
        <span
          className={`truncate flex-1 ${postActionVisible ? "text-text-primary" : "text-text-muted/50"}`}
          title={node.name}
        >
          {node.name || <span className="italic text-text-muted/50">名称なし</span>}
        </span>

        {/* Warning badge (hide/show only) */}
        {risk === "warning" && willChange && !isCustomMode && (
          <span
            className="flex items-center gap-px px-1 py-px rounded bg-amber-500/15 text-amber-600 text-[9px] font-medium flex-shrink-0"
            title="ラスターレイヤー: フキダシや描画の可能性"
          >
            <WarnIcon className="w-2 h-2" />
            確認
          </span>
        )}
        {risk === "warning" && !willChange && matched && !isCustomMode && (
          <span className="px-1 py-px rounded bg-text-muted/8 text-text-muted/70 text-[9px] flex-shrink-0">
            ラスタ
          </span>
        )}

        {/* Status badge */}
        {(matched || willChange) && (
          <span
            className={`text-[9px] px-1 py-px rounded flex-shrink-0 leading-none ${badgeClass}`}
          >
            {badgeText}
          </span>
        )}

        <Badges layer={node} />
      </div>
      {hasChildren && isExpanded && (
        <div className="relative">
          <div
            className="absolute left-0 top-0 bottom-1 w-px bg-border/40"
            style={{ marginLeft: `${depth * 12 + 9}px` }}
          />
          <AnnotatedTree
            items={children}
            depth={depth + 1}
            actionMode={actionMode}
            parentVisible={postActionVisible}
            onToggleCustomVisibility={onToggleCustomVisibility}
            isDndEnabled={isDndEnabled}
          />
        </div>
      )}
    </div>
  );
}

// --- Compact sub-components ---

function ExpandBtn({ has, open, toggle }: { has: boolean; open: boolean; toggle: () => void }) {
  if (!has) return <div className="w-3.5" />;
  return (
    <button
      className="w-3.5 h-3.5 flex items-center justify-center text-text-muted hover:text-accent transition-colors"
      onClick={(e) => {
        e.stopPropagation();
        toggle();
      }}
    >
      <svg
        className={`w-2.5 h-2.5 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
        fill="currentColor"
        viewBox="0 0 20 20"
      >
        <path
          fillRule="evenodd"
          d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
          clipRule="evenodd"
        />
      </svg>
    </button>
  );
}

function VisIcon({
  visible,
  effective = visible,
  onClick,
  customAction,
}: {
  visible: boolean;
  effective?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  customAction?: "show" | "hide" | "move";
}) {
  // visible = PS上のフラグ（アイコン形状）, effective = 実際に見えるか（色の濃さ）
  const color = customAction
    ? customAction === "show"
      ? "text-accent-tertiary"
      : customAction === "move"
        ? "text-violet-500"
        : "text-accent"
    : effective
      ? "text-accent-tertiary"
      : "text-text-muted/50";
  return (
    <div
      className={`w-3.5 h-3.5 flex items-center justify-center ${color} ${onClick ? "cursor-pointer hover:scale-125 transition-transform" : ""}`}
      onClick={onClick}
    >
      {visible ? (
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
          <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
          <path
            fillRule="evenodd"
            d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z"
            clipRule="evenodd"
          />
        </svg>
      ) : (
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z"
            clipRule="evenodd"
          />
          <path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z" />
        </svg>
      )}
    </div>
  );
}

function TypeIcon({ type, visible = true }: { type: LayerNode["type"]; visible?: boolean }) {
  const cls = `w-3 h-3 ${visible ? "" : "opacity-35"}`;
  switch (type) {
    case "group":
      return (
        <svg className={`${cls} text-manga-lavender`} fill="currentColor" viewBox="0 0 20 20">
          <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
        </svg>
      );
    case "text":
      return (
        <svg className={`${cls} text-[#f06292]`} viewBox="0 0 20 20" fill="currentColor">
          <path d="M5 4h10v2.5h-1.2V5.5H10.6V14h1.5v1.5h-4.2V14h1.5V5.5H6.2v1H5V4z" />
        </svg>
      );
    case "adjustment":
      return (
        <svg className={`${cls} text-accent-warm`} viewBox="0 0 20 20" fill="currentColor">
          <path d="M10 2a8 8 0 100 16 8 8 0 000-16zM4 10a6 6 0 0112 0H4z" />
        </svg>
      );
    case "smartObject":
      return (
        <svg className={`${cls} text-accent-tertiary`} viewBox="0 0 20 20" fill="currentColor">
          <path d="M10 2L3 6v8l7 4 7-4V6l-7-4zm0 2.24L14.5 7 10 9.76 5.5 7 10 4.24z" />
        </svg>
      );
    case "shape":
      return (
        <svg className={`${cls} text-[#59a8f8]`} viewBox="0 0 20 20" fill="currentColor">
          <path d="M3 3h14v14H3V3zm2 2v10h10V5H5z" />
        </svg>
      );
    default:
      return (
        <svg className={`${cls} text-[#42a5f5]`} viewBox="0 0 20 20" fill="currentColor">
          <path d="M2 5a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V5zm2 0v6.586l3.293-3.293a1 1 0 011.414 0L13 12.586l1.293-1.293a1 1 0 011.414 0L16 11.586V5H4zm0 10v-1l3.293-3.293L12 15.414V15H4zm12 0v-1.586l-2-2-1.293 1.293L15.414 15H16zM13.5 8a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
        </svg>
      );
  }
}

function WarnIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
      />
    </svg>
  );
}

function FolderButton({
  onClick,
  compact,
  className,
}: {
  onClick: (e: React.MouseEvent) => void;
  compact?: boolean;
  className?: string;
}) {
  return (
    <button
      className={`
        flex-shrink-0 flex items-center justify-center rounded transition-all
        text-text-muted hover:text-text-primary hover:bg-bg-tertiary active:scale-95
        ${compact ? "w-5 h-5" : "w-6 h-6"}
        ${className ?? ""}
      `}
      onClick={onClick}
      title="フォルダを開く (F)"
    >
      <svg
        className={compact ? "w-3 h-3" : "w-3.5 h-3.5"}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
        />
      </svg>
    </button>
  );
}

function PsButton({
  onClick,
  compact,
  className,
}: {
  onClick: (e: React.MouseEvent) => void;
  compact?: boolean;
  className?: string;
}) {
  return (
    <button
      className={`
        flex-shrink-0 flex items-center justify-center rounded transition-all
        text-[#31A8FF] hover:bg-[#31A8FF]/15 active:scale-95
        ${compact ? "w-5 h-5" : "w-6 h-6"}
        ${className ?? ""}
      `}
      onClick={onClick}
      title="Photoshopで開く (P)"
    >
      <span className={`font-bold leading-none ${compact ? "text-xs" : "text-sm"}`}>P</span>
    </button>
  );
}

function Badges({ layer }: { layer: LayerNode }) {
  return (
    <>
      {layer.clipping && (
        <span
          className="text-[8px] px-0.5 rounded bg-accent/12 text-accent flex-shrink-0"
          title="クリッピングマスク"
        >
          clip
        </span>
      )}
      {layer.hasMask && (
        <span className="flex-shrink-0" title="レイヤーマスク">
          <svg className="w-2.5 h-2.5 text-text-muted/60" viewBox="0 0 16 16" fill="currentColor">
            <rect
              x="1"
              y="1"
              width="14"
              height="14"
              rx="2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <circle cx="8" cy="8" r="4" />
          </svg>
        </span>
      )}
      {layer.hasVectorMask && (
        <span className="flex-shrink-0" title="ベクトルマスク">
          <svg className="w-2.5 h-2.5 text-[#59a8f8]/60" viewBox="0 0 16 16" fill="currentColor">
            <rect
              x="1"
              y="1"
              width="14"
              height="14"
              rx="2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path d="M4 12L8 4l4 8H4z" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </span>
      )}
      {layer.locked && (
        <span className="flex-shrink-0" title="ロック">
          <svg
            className="w-2.5 h-2.5 text-text-muted"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3.5" y="7" width="9" height="7" rx="1" />
            <path d="M5.5 7V5a2.5 2.5 0 015 0v2" />
          </svg>
        </span>
      )}
      {layer.opacity < 100 && (
        <span className="text-[9px] px-0.5 rounded bg-bg-tertiary text-text-muted/60 flex-shrink-0">
          {layer.opacity}%
        </span>
      )}
    </>
  );
}
