import type { LayerNode } from "../types";
import type { HideCondition } from "../store/layerStore";
import type { ReplaceSettings } from "../types/replace";

export const TEXT_FOLDER_PATTERNS = ["text", "写植", "セリフ", "テキスト", "セリフ層"];

export type MatchRisk = "safe" | "warning" | "none";

export interface LayerMatchStatus {
  matched: boolean;
  risk: MatchRisk;
}

export function isTextFolder(layer: LayerNode): boolean {
  return (
    layer.type === "group" &&
    TEXT_FOLDER_PATTERNS.some((p) => layer.name.toLowerCase() === p.toLowerCase())
  );
}

export function matchesCondition(
  layer: LayerNode,
  condition: HideCondition,
  parentIsTextFolder: boolean,
): boolean {
  switch (condition.type) {
    case "textLayers":
      return layer.type === "text";

    case "textFolder":
      if (layer.type === "group") {
        return TEXT_FOLDER_PATTERNS.some((p) => layer.name.toLowerCase() === p.toLowerCase());
      }
      return parentIsTextFolder;

    case "layerName":
    case "folderName":
    case "custom": {
      if (!condition.value) return false;
      const searchValue = condition.caseSensitive ? condition.value : condition.value.toLowerCase();
      const layerName = condition.caseSensitive ? layer.name : layer.name.toLowerCase();

      if (condition.partialMatch) {
        return layerName.includes(searchValue);
      }
      return layerName === searchValue;
    }

    default:
      return false;
  }
}

/**
 * レイヤーのマッチ状態とリスクを分類する。
 *
 * - safe: テキストレイヤー、テキストフォルダグループ等、型で明確に判別可能
 * - warning: テキストフォルダ内のラスタライズレイヤー → フキダシや描画の可能性
 * - none: どの条件にもマッチしない
 */
export function classifyLayerRisk(
  layer: LayerNode,
  conditions: HideCondition[],
  parentIsTextFolder: boolean,
): LayerMatchStatus {
  const matched = conditions.some((cond) => matchesCondition(layer, cond, parentIsTextFolder));

  if (!matched) {
    return { matched: false, risk: "none" };
  }

  // テキストレイヤーは明確に安全
  if (layer.type === "text") {
    return { matched: true, risk: "safe" };
  }

  // テキストフォルダグループ自体は安全
  if (layer.type === "group" && isTextFolder(layer)) {
    return { matched: true, risk: "safe" };
  }

  // テキストフォルダ内のラスタライズレイヤー → フキダシ・描画の可能性
  if (layer.type === "layer" && parentIsTextFolder) {
    return { matched: true, risk: "warning" };
  }

  // adjustment/smartObject/shape は型で判別可能
  return { matched: true, risk: "safe" };
}

// =============================================
// 差替え用マッチング
// =============================================

export type ReplaceTargetType = "textFolder" | "namedGroup" | "background" | "specialLayer";

export interface ReplaceMatchItem {
  layer: LayerNode;
  targetType: ReplaceTargetType;
  parentPath: string;
  childTextCount?: number;
}

function hasTextDescendant(layer: LayerNode): boolean {
  if (layer.type === "text") return true;
  if (layer.children) {
    return layer.children.some((c) => hasTextDescendant(c));
  }
  return false;
}

function countTextDescendants(layer: LayerNode): number {
  let count = 0;
  if (layer.children) {
    for (const c of layer.children) {
      if (c.type === "text") count++;
      count += countTextDescendants(c);
    }
  }
  return count;
}

function nameMatches(layerName: string, targetName: string, partial: boolean): boolean {
  const a = layerName.toLowerCase();
  const b = targetName.toLowerCase();
  return partial ? a.includes(b) : a === b;
}

export function findReplaceTargets(
  layers: LayerNode[],
  settings: ReplaceSettings,
): ReplaceMatchItem[] {
  const items: ReplaceMatchItem[] = [];
  const { mode, textSettings, imageSettings } = settings;

  function walk(nodes: LayerNode[], parentPath: string) {
    for (const layer of nodes) {
      const path = parentPath ? `${parentPath} / ${layer.name}` : layer.name;

      let matched = false;

      // Text mode: textLayers — テキストを含むグループ
      if (
        (mode === "text" || mode === "batch") &&
        textSettings.subMode === "textLayers" &&
        layer.type === "group" &&
        hasTextDescendant(layer)
      ) {
        items.push({
          layer,
          targetType: "textFolder",
          parentPath,
          childTextCount: countTextDescendants(layer),
        });
        matched = true;
      }

      // Text mode: namedGroup — 特定名グループ
      if (
        (mode === "text" || mode === "batch") &&
        textSettings.subMode === "namedGroup" &&
        layer.type === "group" &&
        textSettings.groupName &&
        nameMatches(layer.name, textSettings.groupName, textSettings.partialMatch)
      ) {
        items.push({
          layer,
          targetType: "namedGroup",
          parentPath,
        });
        matched = true;
      }

      // Image mode: specialLayer
      if (
        mode === "image" &&
        imageSettings.replaceSpecialLayer &&
        imageSettings.specialLayerName &&
        layer.type !== "group" &&
        nameMatches(
          layer.name,
          imageSettings.specialLayerName,
          imageSettings.specialLayerPartialMatch,
        )
      ) {
        items.push({
          layer,
          targetType: "specialLayer",
          parentPath,
        });
        matched = true;
      }

      // Image mode: namedGroup
      if (
        mode === "image" &&
        imageSettings.replaceNamedGroup &&
        imageSettings.namedGroupName &&
        layer.type === "group" &&
        nameMatches(layer.name, imageSettings.namedGroupName, imageSettings.namedGroupPartialMatch)
      ) {
        items.push({
          layer,
          targetType: "namedGroup",
          parentPath,
        });
        matched = true;
      }

      // Don't recurse into matched groups (they're already targets)
      if (!matched && layer.children) {
        walk(layer.children, path);
      }
    }
  }

  walk(layers, "");

  // Image mode: background — 最下層レイヤー
  if (mode === "image" && imageSettings.replaceBackground && layers.length > 0) {
    const bg = layers[0]; // ag-psd bottom-to-top → first = bottom
    items.push({
      layer: bg,
      targetType: "background",
      parentPath: "",
    });
  }

  return items;
}
