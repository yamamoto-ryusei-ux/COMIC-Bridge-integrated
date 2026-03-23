import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { LayerNode, LayerBounds, TextInfo, PsdFile } from "../types";

// フォント種類ごとの色パレット（視認性重視）
export const FONT_COLORS = [
  "#f06292", // pink
  "#64b5f6", // blue
  "#81c784", // green
  "#ffb74d", // orange
  "#ba68c8", // purple
  "#4dd0e1", // cyan
  "#e57373", // red
  "#aed581", // light green
  "#ffd54f", // yellow
  "#7986cb", // indigo
];

// 未インストールフォントの色
export const MISSING_FONT_COLOR = "#ef4444";

/** Rust側 FontResolveInfo に対応 */
export interface FontResolveInfo {
  display_name: string;
  style_name: string;
}

export interface TextLayerEntry {
  layerName: string;
  textInfo: TextInfo | undefined;
  visible: boolean;
  parentPath: string;
  bounds?: LayerBounds;
}

export interface FontHelpers {
  getFontLabel: (ps: string) => string;
  getFontColor: (ps: string) => string;
  getFontFamily: (ps: string) => string | undefined;
  isMissing: (ps: string) => boolean;
  allFontNames: string[];
}

/** テキストレイヤーを再帰的に収集（Photoshop表示順、親グループ非表示なら除外） */
export function collectTextLayers(
  layers: LayerNode[],
  parentPath = "",
  parentVisible = true,
): TextLayerEntry[] {
  const entries: TextLayerEntry[] = [];
  // ag-psd: bottom-to-top → reverse for Photoshop display order
  const reversed = [...layers].reverse();
  for (const layer of reversed) {
    const path = parentPath ? `${parentPath} / ${layer.name}` : "";
    const effectiveVisible = parentVisible && layer.visible;
    if (layer.type === "text" && effectiveVisible) {
      entries.push({
        layerName: layer.name,
        textInfo: layer.textInfo,
        visible: layer.visible,
        parentPath: path,
        bounds: layer.bounds,
      });
    }
    if (layer.children) {
      entries.push(...collectTextLayers(layer.children, path || layer.name, effectiveVisible));
    }
  }
  return entries;
}

/** 全ファイルのフォント情報を解決するフック */
export function useFontResolver(files: PsdFile[]) {
  // フォント解決結果（PostScript名 → 表示名・スタイル名）
  const [fontResolveMap, setFontResolveMap] = useState<Record<string, FontResolveInfo>>({});
  const [fontNamesResolved, setFontNamesResolved] = useState(false);

  // 全ファイルのフォント集計
  const allFonts = useMemo(() => {
    const fontMap = new Map<string, number>(); // font name → file count
    for (const file of files) {
      if (!file.metadata?.layerTree) continue;
      const textLayers = collectTextLayers(file.metadata.layerTree);
      const fileFonts = new Set<string>();
      for (const entry of textLayers) {
        if (!entry.textInfo) continue;
        for (const font of entry.textInfo.fonts) {
          fileFonts.add(font);
        }
      }
      for (const font of fileFonts) {
        fontMap.set(font, (fontMap.get(font) || 0) + 1);
      }
    }
    return [...fontMap.entries()].sort((a, b) => b[1] - a[1]);
  }, [files]);

  // テキストレイヤーの総数
  const totalTextLayers = useMemo(() => {
    let count = 0;
    for (const file of files) {
      if (!file.metadata?.layerTree) continue;
      count += collectTextLayers(file.metadata.layerTree).length;
    }
    return count;
  }, [files]);

  // PostScript名のリスト
  const postScriptNames = useMemo(() => allFonts.map(([font]) => font), [allFonts]);

  // システムフォントから表示名・スタイル名を解決
  useEffect(() => {
    if (postScriptNames.length === 0) {
      setFontNamesResolved(false);
      return;
    }
    setFontNamesResolved(false);
    invoke<Record<string, FontResolveInfo>>("resolve_font_names", {
      postscriptNames: postScriptNames,
    })
      .then((result) => {
        setFontResolveMap(result);
        setFontNamesResolved(true);
      })
      .catch(console.error);
  }, [postScriptNames]);

  // フォント → 色マッピング（安定した色割当）
  const fontColorMap = useMemo(() => {
    const map = new Map<string, string>();
    allFonts.forEach(([font], i) => {
      map.set(font, FONT_COLORS[i % FONT_COLORS.length]);
    });
    return map;
  }, [allFonts]);

  // 未インストールフォント一覧
  const missingFonts = useMemo(() => {
    if (!fontNamesResolved) return new Set<string>();
    return new Set(postScriptNames.filter((ps) => !(ps in fontResolveMap)));
  }, [postScriptNames, fontResolveMap, fontNamesResolved]);

  // ヘルパー関数をまとめる
  const fontInfo: FontHelpers = useMemo(
    () => ({
      getFontLabel: (ps: string) => {
        const info = fontResolveMap[ps];
        if (!info) return ps;
        return `${info.display_name} ${info.style_name}`;
      },
      getFontColor: (ps: string) =>
        missingFonts.has(ps) ? MISSING_FONT_COLOR : fontColorMap.get(ps) || FONT_COLORS[0],
      getFontFamily: (ps: string) => {
        const info = fontResolveMap[ps];
        return info ? info.display_name : undefined;
      },
      isMissing: (ps: string) => fontNamesResolved && missingFonts.has(ps),
      allFontNames: postScriptNames,
    }),
    [fontResolveMap, fontColorMap, missingFonts, fontNamesResolved, postScriptNames],
  );

  // フォント解決を再実行（インストール後に呼ぶ）
  const refreshFonts = useCallback(() => {
    if (postScriptNames.length === 0) return;
    setFontNamesResolved(false);
    invoke<Record<string, FontResolveInfo>>("resolve_font_names", {
      postscriptNames: postScriptNames,
    })
      .then((result) => {
        setFontResolveMap(result);
        setFontNamesResolved(true);
      })
      .catch(console.error);
  }, [postScriptNames]);

  return {
    fontInfo,
    allFonts,
    totalTextLayers,
    missingFonts,
    fontNamesResolved,
    refreshFonts,
  };
}
