/**
 * Shared layer tree operations for custom mode.
 * Used by both LayerPreviewPanel (preview) and useLayerControl (post-apply update).
 */
import type { LayerNode } from "../types";
import type { CustomVisibilityOp, CustomMoveOp } from "../store/layerStore";

/** Build a path key for matching (same format as annotation) */
export function buildPathKey(path: string[], index: number): string {
  return path.join("/") + ":" + index;
}

/** Deep clone a LayerNode tree */
export function cloneTree(layers: LayerNode[]): LayerNode[] {
  return layers.map((l) => ({
    ...l,
    children: l.children ? cloneTree(l.children) : undefined,
  }));
}

/** Build a pathKey → layer.id mapping (reversed order, matching annotation) */
export function buildPathIdMap(
  layers: LayerNode[],
  currentPath: string[] = [],
): Map<string, string> {
  const map = new Map<string, string>();
  const nameCounts = new Map<string, number>();
  const reversed = [...layers].reverse();
  for (const layer of reversed) {
    const count = nameCounts.get(layer.name) ?? 0;
    nameCounts.set(layer.name, count + 1);
    const layerPath = [...currentPath, layer.name];
    map.set(buildPathKey(layerPath, count), layer.id);
    if (layer.children) {
      for (const [k, v] of buildPathIdMap(layer.children, layerPath)) {
        map.set(k, v);
      }
    }
  }
  return map;
}

/** Build a layer.id → { path, index } mapping (for re-resolving paths after moves) */
export function buildIdToPathInfo(
  layers: LayerNode[],
  currentPath: string[] = [],
): Map<string, { path: string[]; index: number }> {
  const map = new Map<string, { path: string[]; index: number }>();
  const nameCounts = new Map<string, number>();
  const reversed = [...layers].reverse();
  for (const layer of reversed) {
    const count = nameCounts.get(layer.name) ?? 0;
    nameCounts.set(layer.name, count + 1);
    const layerPath = [...currentPath, layer.name];
    map.set(layer.id, { path: layerPath, index: count });
    if (layer.children) {
      for (const [k, v] of buildIdToPathInfo(layer.children, layerPath)) {
        map.set(k, v);
      }
    }
  }
  return map;
}

/** Remove a layer by ID from the tree */
export function removeLayerById(
  layers: LayerNode[],
  id: string,
): { layers: LayerNode[]; removed: LayerNode | null } {
  const idx = layers.findIndex((l) => l.id === id);
  if (idx >= 0) {
    return { layers: [...layers.slice(0, idx), ...layers.slice(idx + 1)], removed: layers[idx] };
  }
  let removed: LayerNode | null = null;
  const result: LayerNode[] = [];
  for (const l of layers) {
    if (removed) {
      result.push(l);
      continue;
    }
    if (l.children) {
      const child = removeLayerById(l.children, id);
      if (child.removed) {
        removed = child.removed;
        result.push({ ...l, children: child.layers });
      } else {
        result.push(l);
      }
    } else {
      result.push(l);
    }
  }
  return { layers: result, removed };
}

/** Insert a layer relative to a target (by ID).
 *  ag-psd order: [0]=bottom of PS stack, [N-1]=top. Annotation reverses for display.
 *  "before" in display (above) = after in ag-psd array.
 *  "after" in display (below) = before in ag-psd array.
 *  "inside" = append to children (= top of group in PS). */
export function insertLayerRelative(
  layers: LayerNode[],
  targetId: string,
  node: LayerNode,
  placement: "before" | "after" | "inside",
): { layers: LayerNode[]; inserted: boolean } {
  const idx = layers.findIndex((l) => l.id === targetId);
  if (idx >= 0) {
    if (placement === "inside") {
      const target = layers[idx];
      return {
        layers: [
          ...layers.slice(0, idx),
          { ...target, children: [...(target.children ?? []), node] },
          ...layers.slice(idx + 1),
        ],
        inserted: true,
      };
    }
    if (placement === "before") {
      return {
        layers: [...layers.slice(0, idx + 1), node, ...layers.slice(idx + 1)],
        inserted: true,
      };
    }
    return { layers: [...layers.slice(0, idx), node, ...layers.slice(idx)], inserted: true };
  }

  const result: LayerNode[] = [];
  let inserted = false;
  for (const l of layers) {
    if (inserted || !l.children) {
      result.push(l);
      continue;
    }
    const child = insertLayerRelative(l.children, targetId, node, placement);
    if (child.inserted) {
      result.push({ ...l, children: child.layers });
      inserted = true;
    } else {
      result.push(l);
    }
  }
  return { layers: result, inserted };
}

/** Apply move operations virtually to produce a modified tree.
 *  Returns the modified tree and the set of moved layer IDs. */
export function applyVirtualMoves(
  layers: LayerNode[],
  moveOps: CustomMoveOp[],
): { layers: LayerNode[]; movedIds: Set<string> } {
  if (moveOps.length === 0) return { layers, movedIds: new Set() };

  let current = cloneTree(layers);
  const movedIds = new Set<string>();

  for (const op of moveOps) {
    const pathIdMap = buildPathIdMap(current);
    const sourceId = pathIdMap.get(buildPathKey(op.sourcePath, op.sourceIndex));
    const targetId = pathIdMap.get(buildPathKey(op.targetPath, op.targetIndex));
    if (!sourceId || !targetId) continue;

    const { layers: afterRemove, removed } = removeLayerById(current, sourceId);
    if (!removed) continue;

    const { layers: afterInsert } = insertLayerRelative(
      afterRemove,
      targetId,
      removed,
      op.placement,
    );
    current = afterInsert;
    movedIds.add(sourceId);
  }

  return { layers: current, movedIds };
}

/** Apply visibility ops to a layer tree (reversed name counting to match annotation order) */
export function applyCustomVisibilityToTree(
  layers: LayerNode[],
  ops: CustomVisibilityOp[],
  currentPath: string[] = [],
): LayerNode[] {
  // Build name counts in reverse order to match annotation
  const reverseNameCounts = new Map<string, number>();
  for (let i = layers.length - 1; i >= 0; i--) {
    const count = reverseNameCounts.get(layers[i].name) ?? 0;
    reverseNameCounts.set(layers[i].name, count + 1);
  }

  // Now apply — track counts per name in reverse order
  const seen = new Map<string, number>();
  const countForLayer: number[] = new Array(layers.length);
  for (let i = layers.length - 1; i >= 0; i--) {
    const c = seen.get(layers[i].name) ?? 0;
    countForLayer[i] = c;
    seen.set(layers[i].name, c + 1);
  }

  return layers.map((layer, i) => {
    const layerPath = [...currentPath, layer.name];
    const pathKey = buildPathKey(layerPath, countForLayer[i]);

    const op = ops.find((o) => buildPathKey(o.path, o.index) === pathKey);

    let visible = op ? op.action === "show" : layer.visible;
    // ensureParentsVisible: if showing a child, parent must also be visible
    // (handled by Photoshop, but reflect locally for accurate tree)

    const updatedLayer: LayerNode = {
      ...layer,
      visible,
    };

    if (layer.children && layer.children.length > 0) {
      updatedLayer.children = applyCustomVisibilityToTree(layer.children, ops, layerPath);
    }

    return updatedLayer;
  });
}
