import { useState, useCallback } from "react";
import { usePsdStore } from "../store/psdStore";
import { useUnifiedViewerStore } from "../store/unifiedViewerStore";
import { invoke } from "@tauri-apps/api/core";
import { desktopDir } from "@tauri-apps/api/path";
// readFile removed — loadToViewer now parses inline
import type { LayerNode, PsdFile } from "../types";

/**
 * テキスト抽出ロジックを共有するフック
 */
export function useTextExtract(filesOverride?: PsdFile[]) {
  const storeFiles = usePsdStore((s) => s.files);
  const files = filesOverride ?? storeFiles;
  const [isExtracting, setIsExtracting] = useState(false);
  const [sortMode, setSortMode] = useState<"bottomToTop" | "topToBottom">("bottomToTop");
  const [includeHidden, setIncludeHidden] = useState(false);
  const [splitByFolder, setSplitByFolder] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
    filePath?: string;
  } | null>(null);

  const psdFiles = files.filter((f) => f.metadata?.layerTree?.length);

  // 複数フォルダが含まれるか判定
  const folderSet = new Set(psdFiles.map((f) => {
    const p = f.filePath.replace(/\//g, "\\");
    return p.substring(0, p.lastIndexOf("\\"));
  }));
  const hasMultipleFolders = folderSet.size > 1;

  const saveAndLoad = async (outputDir: string, baseName: string, content: string): Promise<string | null> => {
    let fileName = `${baseName}.txt`;
    const exists = await invoke<boolean>("path_exists", { path: `${outputDir}\\${fileName}` });
    if (exists) {
      const now = new Date();
      const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
      fileName = `${baseName}_${ts}.txt`;
    }
    const filePath = `${outputDir}\\${fileName}`;
    await invoke("write_text_file", { filePath, content });
    return filePath;
  };

  const loadToViewer = (filePath: string, textContent: string) => {
    const viewerStore = useUnifiedViewerStore.getState();
    viewerStore.setTextContent(textContent);
    viewerStore.setTextFilePath(filePath);
    viewerStore.setIsDirty(false);
    const lines = textContent.split(/\r?\n/);
    const header: string[] = [];
    const pages: { pageNumber: number; blocks: { id: string; originalIndex: number; lines: string[] }[] }[] = [];
    let curPage: typeof pages[0] | null = null;
    let blockLines: string[] = [];
    let blockIdx = 0;
    const flush = () => {
      if (blockLines.length > 0 && curPage) {
        curPage.blocks.push({ id: `p${curPage.pageNumber}-b${blockIdx}`, originalIndex: blockIdx, lines: [...blockLines] });
        blockIdx++;
        blockLines = [];
      }
    };
    for (const line of lines) {
      const m = line.match(/^<<(\d+)Page>>$/);
      if (m) { flush(); blockIdx = 0; blockLines = []; curPage = { pageNumber: parseInt(m[1], 10), blocks: [] }; pages.push(curPage); }
      else if (curPage) { if (line.trim() === "") flush(); else blockLines.push(line); }
      else header.push(line);
    }
    flush();
    viewerStore.setTextHeader(header);
    viewerStore.setTextPages(pages);
  };

  const handleExtract = useCallback(async () => {
    if (psdFiles.length === 0) return;
    setIsExtracting(true);
    setResult(null);

    try {
      const desktop = await desktopDir();
      const outputDir = `${desktop}\\Script_Output\\テキスト抽出`;
      await invoke("create_directory", { path: outputDir }).catch(() => {});

      if (splitByFolder && hasMultipleFolders) {
        // フォルダ別に分割して保存
        const grouped = new Map<string, PsdFile[]>();
        for (const f of psdFiles) {
          const p = f.filePath.replace(/\//g, "\\");
          const dir = p.substring(0, p.lastIndexOf("\\"));
          if (!grouped.has(dir)) grouped.set(dir, []);
          grouped.get(dir)!.push(f);
        }
        const savedFiles: string[] = [];
        let lastFilePath = "";
        let lastContent = "";
        for (const [dir, groupFiles] of grouped) {
          const folderName = dir.split("\\").pop() || "extracted";
          const output = generateText(groupFiles, sortMode, includeHidden);
          const fp = await saveAndLoad(outputDir, folderName, output);
          if (fp) { savedFiles.push(fp.split("\\").pop()!); lastFilePath = fp; lastContent = output; }
        }
        if (lastFilePath) loadToViewer(lastFilePath, lastContent);
        setResult({ success: true, message: `${savedFiles.length}ファイル保存: ${savedFiles.join(", ")}` });
      } else {
        // 1つのテキストにまとめて保存
        const output = generateText(psdFiles, sortMode, includeHidden);
        const firstPath = psdFiles[0].filePath.replace(/\//g, "\\");
        const folderName = firstPath.split("\\").slice(-2, -1)[0] || "extracted";
        const filePath = await saveAndLoad(outputDir, folderName, output);
        if (filePath) {
          loadToViewer(filePath, output);
          setResult({ success: true, message: `${filePath.split("\\").pop()} に保存しました`, filePath });
        }
      }
      await invoke("open_folder_in_explorer", { folderPath: outputDir }).catch(() => {});
    } catch (err) {
      setResult({ success: false, message: `エラー: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setIsExtracting(false);
    }
  }, [psdFiles, sortMode, includeHidden, splitByFolder, hasMultipleFolders]);

  return {
    psdFiles,
    isExtracting,
    sortMode,
    setSortMode,
    includeHidden,
    setIncludeHidden,
    splitByFolder,
    setSplitByFolder,
    hasMultipleFolders,
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
