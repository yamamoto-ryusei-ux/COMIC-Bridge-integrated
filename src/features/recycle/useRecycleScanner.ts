import { invoke } from "@tauri-apps/api/core";
import { useRecycleStore } from "./recycleStore";
import type { RecycleScanFile, RecycleTextLayer } from "./recycleTypes";

interface RustLayerNode {
  id: string;
  name: string;
  type: string; // "text" | "group" | "layer" | etc.
  visible: boolean;
  textInfo?: {
    text: string;
    fonts: string[];
    fontSizes: number[];
    strokeSize?: number;
  };
  children?: RustLayerNode[];
  bounds?: { left: number; top: number; right: number; bottom: number };
}

interface RustPsdMetadata {
  width: number;
  height: number;
  layerTree: RustLayerNode[];
}

interface RustPsdParseResult {
  filePath: string;
  metadata: RustPsdMetadata | null;
  fileSize: number;
  error: string | null;
}

/** 再帰的に layerTree を走査してテキストレイヤーをフラット配列に */
function flattenTextLayers(nodes: RustLayerNode[]): RecycleTextLayer[] {
  const result: RecycleTextLayer[] = [];

  function walk(node: RustLayerNode) {
    if (node.type === "text" && node.textInfo) {
      result.push({
        layerId: parseInt(node.id) || 0,
        layerName: node.name,
        text: node.textInfo.text,
        fontPostScriptName: node.textInfo.fonts?.[0] || "",
        fontSize: node.textInfo.fontSizes?.[0] || 0,
        color: { r: 0, g: 0, b: 0 }, // FIXME(Phase 3): RGB抽出未実装
        hasStroke: !!node.textInfo.strokeSize,
        strokeSize: node.textInfo.strokeSize,
        visible: node.visible,
        boundingBox: node.bounds
          ? [node.bounds.left, node.bounds.top, node.bounds.right, node.bounds.bottom]
          : [0, 0, 0, 0],
      });
    }
    if (node.children) {
      for (const child of node.children) walk(child);
    }
  }

  for (const node of nodes) walk(node);
  return result;
}

/**
 * フォルダ内 PSD を ag-psd でスキャン。
 * Phase 3 で拡張する項目:
 *  - layerEffects.stroke の正確な抽出
 *  - color の RGB 取得
 *  - boundingBox の取得（現在は parser から取得可能なので渡せる）
 */
export function useRecycleScanner() {
  const setScanFiles = useRecycleStore((s) => s.setScanFiles);
  const setScanInProgress = useRecycleStore((s) => s.setScanInProgress);

  async function scanFolder(folderPath: string): Promise<RecycleScanFile[]> {
    setScanInProgress(true);
    try {
      // 再帰的にPSDファイルを列挙（extensions は配列で渡す！）
      const fileList = await invoke<string[]>("list_files_by_extension_recursive", {
        folderPath,
        extensions: ["psd", "psb"],
      });

      if (fileList.length === 0) {
        setScanFiles([]);
        return [];
      }

      // 各PSDのメタデータをバッチ取得
      const metadataResults = await invoke<RustPsdParseResult[]>(
        "parse_psd_metadata_batch",
        { filePaths: fileList },
      );

      const scanFiles: RecycleScanFile[] = metadataResults
        .filter((r) => r.metadata) // パース失敗したものは除外
        .map((r) => ({
          filePath: r.filePath,
          width: r.metadata!.width,
          height: r.metadata!.height,
          textLayers: flattenTextLayers(r.metadata!.layerTree),
        }));

      setScanFiles(scanFiles);
      return scanFiles;
    } finally {
      setScanInProgress(false);
    }
  }

  return { scanFolder };
}
