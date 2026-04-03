import { useState, useCallback } from "react";
import { usePsdStore } from "../store/psdStore";
import { useUnifiedViewerStore } from "../store/unifiedViewerStore";
import { invoke } from "@tauri-apps/api/core";
import { desktopDir } from "@tauri-apps/api/path";
import { readFile } from "@tauri-apps/plugin-fs";
import type { LayerNode, PsdFile } from "../types";

/**
 * テキスト抽出ロジックを共有するフック
 */
export function useTextExtract() {
  const files = usePsdStore((s) => s.files);
  const [isExtracting, setIsExtracting] = useState(false);
  const [sortMode, setSortMode] = useState<"bottomToTop" | "topToBottom">("bottomToTop");
  const [includeHidden, setIncludeHidden] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
    filePath?: string;
  } | null>(null);

  const psdFiles = files.filter((f) => f.metadata?.layerTree?.length);

  const handleExtract = useCallback(async () => {
    if (psdFiles.length === 0) return;
    setIsExtracting(true);
    setResult(null);

    try {
      const output = generateText(psdFiles, sortMode, includeHidden);

      const firstPath = psdFiles[0].filePath.replace(/\//g, "\\");
      const parts = firstPath.split("\\");
      const folderName = parts[parts.length - 2] || "extracted";

      const desktop = await desktopDir();
      const outputDir = `${desktop}\\Script_Output\\テキスト抽出`;

      await invoke("list_folder_contents", { folderPath: outputDir }).catch(async () => {
        const scriptOutput = `${desktop}\\Script_Output`;
        await invoke("write_text_file", {
          filePath: `${scriptOutput}\\.keep`,
          content: "",
        }).catch(() => {});
        await invoke("write_text_file", {
          filePath: `${outputDir}\\.keep`,
          content: "",
        }).catch(() => {});
      });

      const baseName = `${folderName}`;
      let fileName = `${baseName}.txt`;
      const exists = await invoke<boolean>("path_exists", { path: `${outputDir}\\${fileName}` });
      if (exists) {
        const now = new Date();
        const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
        fileName = `${baseName}_${ts}.txt`;
      }

      const filePath = `${outputDir}\\${fileName}`;
      await invoke("write_text_file", { filePath, content: output });

      setResult({
        success: true,
        message: `${fileName} に保存しました`,
        filePath,
      });

      // 統合ビューアーに自動読み込み
      try {
        const bytes = await readFile(filePath);
        const textContent = new TextDecoder("utf-8").decode(bytes);
        const viewerStore = useUnifiedViewerStore.getState();
        viewerStore.setTextContent(textContent);
        viewerStore.setTextFilePath(filePath);
      } catch { /* ignore */ }

      // 出力フォルダを開く
      await invoke("open_folder_in_explorer", { folderPath: outputDir }).catch(() => {});
    } catch (err) {
      setResult({
        success: false,
        message: `エラー: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setIsExtracting(false);
    }
  }, [psdFiles, sortMode, includeHidden]);

  return {
    psdFiles,
    isExtracting,
    sortMode,
    setSortMode,
    includeHidden,
    setIncludeHidden,
    result,
    setResult,
    handleExtract,
  };
}

// ===== ヘルパー関数 =====

/**
 * テキストレイヤーを再帰的に収集する
 */
function collectTextLayers(
  layers: LayerNode[],
  includeHidden: boolean,
): { text: string; name: string; visible: boolean }[] {
  const result: { text: string; name: string; visible: boolean }[] = [];

  for (const layer of layers) {
    if (layer.type === "text" && layer.textInfo?.text) {
      const content = layer.textInfo.text.trim();
      if (content.length > 0) {
        if (includeHidden || layer.visible) {
          if (!/^.+（.+）$/.test(layer.name)) {
            result.push({
              text: content,
              name: layer.name,
              visible: layer.visible,
            });
          }
        }
      }
    }

    if (layer.children?.length) {
      result.push(...collectTextLayers(layer.children, includeHidden));
    }
  }

  return result;
}

/**
 * COMIC-POT互換フォーマットでテキストを生成
 */
function generateText(
  files: PsdFile[],
  sortMode: "bottomToTop" | "topToBottom",
  includeHidden: boolean,
): string {
  const lines: string[] = [];

  lines.push(`[COMIC-POT:${sortMode}]`);
  lines.push("[01巻]");

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const pageNum = i + 1;
    lines.push(`<<${pageNum}Page>>`);

    if (!file.metadata?.layerTree) {
      lines.push("");
      continue;
    }

    let textLayers = collectTextLayers(file.metadata.layerTree, includeHidden);
    if (sortMode === "bottomToTop") {
      textLayers.reverse();
    }

    if (textLayers.length === 0) {
      lines.push("");
      continue;
    }

    for (const entry of textLayers) {
      lines.push(entry.text);
      lines.push("");
    }
  }

  return lines.join("\n");
}
