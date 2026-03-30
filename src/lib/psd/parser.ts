import { readPsd, type Psd } from "ag-psd";
import type { PsdMetadata, Guide, LayerNode, ColorMode } from "../../types";

// Color mode mapping from ag-psd numeric values
const COLOR_MODE_MAP: Record<number, ColorMode> = {
  0: "Bitmap",
  1: "Grayscale",
  2: "Indexed",
  3: "RGB",
  4: "CMYK",
  7: "Multichannel",
  8: "Duotone",
  9: "Lab",
};

export function mapColorMode(mode: number): ColorMode {
  return COLOR_MODE_MAP[mode] || "RGB";
}

export interface ParseResult {
  metadata: PsdMetadata;
  thumbnailData?: string; // base64 data URL
  compositeData?: string; // base64 data URL
}

/**
 * 高速版: メタデータと埋め込みサムネイルのみ読み込み
 * 合成画像データはスキップするため高速
 */
export async function parsePsdBufferFast(buffer: ArrayBuffer): Promise<ParseResult> {
  const psd = readPsd(buffer, {
    skipCompositeImageData: true, // 合成画像をスキップ（高速化）
    skipLayerImageData: true,
    skipThumbnail: false, // 埋め込みサムネイルは読み込む
    useImageData: false,
  });

  const metadata = extractMetadata(psd);
  const thumbnailData = await extractEmbeddedThumbnail(psd);

  return {
    metadata,
    thumbnailData,
  };
}

/**
 * フル版: 合成画像も含めて読み込み（サムネイルがない場合のフォールバック用）
 */
export async function parsePsdBuffer(buffer: ArrayBuffer): Promise<ParseResult> {
  const psd = readPsd(buffer, {
    skipCompositeImageData: false,
    skipLayerImageData: true,
    skipThumbnail: false,
    useImageData: true,
  });

  const metadata = extractMetadata(psd);
  const thumbnailData = await generateThumbnail(psd);

  return {
    metadata,
    thumbnailData,
  };
}

/**
 * 埋め込みサムネイルのみ抽出（高速）
 */
async function extractEmbeddedThumbnail(psd: Psd): Promise<string | undefined> {
  try {
    const thumbResource = psd.imageResources?.thumbnail;
    if (thumbResource) {
      const thumbData = thumbResource as any;
      if (thumbData.canvas) {
        return thumbData.canvas.toDataURL("image/jpeg", 0.92);
      }
      if (thumbData.data && thumbData.data instanceof Uint8Array) {
        const blob = new Blob([thumbData.data], { type: "image/jpeg" });
        return await blobToDataUrl(blob);
      }
    }
  } catch (error) {
    console.error("Failed to extract thumbnail:", error);
  }
  return undefined;
}

export function extractMetadata(psd: Psd): PsdMetadata {
  const dpi = extractDpi(psd);
  const guides = extractGuides(psd);
  const layerTree = extractLayerTree(psd.children || [], "", dpi);
  const alphaChannelInfo = extractAlphaChannelInfo(psd);

  return {
    width: psd.width,
    height: psd.height,
    dpi,
    colorMode: mapColorMode(psd.colorMode || 3),
    bitsPerChannel: psd.bitsPerChannel || 8,
    hasGuides: guides.length > 0,
    guides,
    layerCount: countLayers(psd.children || []),
    layerTree,
    hasAlphaChannels: alphaChannelInfo.count > 0,
    alphaChannelCount: alphaChannelInfo.count,
    alphaChannelNames: alphaChannelInfo.names,
    hasOnlyTransparency: alphaChannelInfo.onlyTransparency,
    hasTombo: detectTombo(layerTree),
  };
}

/**
 * レイヤーツリーを再帰走査して「トンボ」を名前に含むレイヤー/グループを検出
 */
function detectTombo(layers: LayerNode[]): boolean {
  for (const node of layers) {
    if (node.name.includes("トンボ")) return true;
    if (node.children && detectTombo(node.children)) return true;
  }
  return false;
}

/**
 * αチャンネル情報を抽出
 *
 * PSD形式のチャンネル構造:
 * - 標準チャンネル数: RGB=3, CMYK=4, Grayscale=1, Bitmap=1, Lab=3, Duotone=1
 * - psd.channels: チャンネル総数（標準 + 透明部分 + ユーザーα）
 * - alphaChannelNames: 全αチャンネル名（透明部分 + ユーザーα）
 *
 * 「透明部分」(Transparency) はPhotoshopが自動管理するαチャンネルで
 * レイヤーの透明度情報を持つ。ユーザーが手動で追加したαチャンネルとは区別する。
 */
function extractAlphaChannelInfo(psd: Psd): {
  count: number;
  names: string[];
  onlyTransparency: boolean;
} {
  const alphaNames = psd.imageResources?.alphaChannelNames || [];

  // 標準チャンネル数をカラーモードから算出
  const standardChannels: Record<number, number> = {
    0: 1, // Bitmap
    1: 1, // Grayscale
    2: 1, // Indexed
    3: 3, // RGB
    4: 4, // CMYK
    7: 3, // Multichannel -> Lab相当
    8: 1, // Duotone
    9: 3, // Lab
  };
  const std = standardChannels[psd.colorMode || 3] ?? 3;
  const totalChannels = psd.channels ?? std;
  const extraChannels = totalChannels - std;

  // αチャンネル数: alphaChannelNamesの長さ or チャンネル差分のうち大きい方
  const alphaCount = Math.max(alphaNames.length, extraChannels);

  if (alphaCount <= 0) {
    return { count: 0, names: [], onlyTransparency: false };
  }

  // 名前リストを構築（alphaChannelNamesが不足していれば補完）
  const names: string[] = [];
  for (let i = 0; i < alphaCount; i++) {
    names.push(alphaNames[i] ?? `Alpha ${i + 1}`);
  }

  // 「透明部分」のみかどうか判定
  const transparencyPattern = /^(透明部分|Transparency)$/i;
  const onlyTransparency = names.every((n) => transparencyPattern.test(n.trim()));

  return { count: alphaCount, names, onlyTransparency };
}

function extractDpi(psd: Psd): number {
  // Try to get DPI from image resources
  const resolution = psd.imageResources?.resolutionInfo;
  if (resolution) {
    // resolution is in pixels per inch
    return Math.round(resolution.horizontalResolution || 72);
  }
  return 72; // Default DPI
}

export function extractGuides(psd: Psd): Guide[] {
  const guideInfo = psd.imageResources?.gridAndGuidesInformation;
  if (!guideInfo?.guides) return [];

  return guideInfo.guides.map((g) => ({
    direction: g.direction === "horizontal" ? "horizontal" : "vertical",
    position: Math.round(g.location),
  }));
}

function extractLayerTree(children: Psd["children"], parentPath = "", dpi = 72): LayerNode[] {
  if (!children) return [];

  return children.map((child, index) => {
    const path = parentPath ? `${parentPath}-${index}` : `${index}`;
    const childAny = child as any;
    const node: LayerNode = {
      id: `layer-${path}`,
      name: child.name || "Unnamed Layer",
      type: getLayerType(child),
      visible: !child.hidden,
      opacity: Math.round(((child.opacity || 255) / 255) * 100),
      blendMode: child.blendMode || "normal",
      hasMask: !!(childAny.mask || childAny.realMask),
      hasVectorMask: !!childAny.vectorMask,
      clipping: !!childAny.clipping,
      locked:
        childAny.transparencyProtected ||
        childAny.positionProtected ||
        childAny.compositeProtected ||
        undefined,
    };

    // レイヤーのバウンディングボックスを抽出（ag-psdはtop/left/right/bottomを直接持つ）
    if (
      child.top !== undefined &&
      child.left !== undefined &&
      child.bottom !== undefined &&
      child.right !== undefined
    ) {
      node.bounds = {
        top: child.top,
        left: child.left,
        bottom: child.bottom,
        right: child.right,
      };
    }

    // テキストレイヤーの場合: text.boundingBox + transform で実際の描画範囲を計算
    // boundingBox はテキスト原点からの相対座標(Points単位)、transform[4,5] が原点のピクセル座標
    // transform の scale(a,d) が 1:1 の場合、Points値をそのままピクセルオフセットとして加算できる
    if (child.text) {
      const textBB = child.text.boundingBox || child.text.bounds;
      const tf = child.text.transform; // [a, b, c, d, tx, ty]
      if (textBB && tf && tf.length >= 6) {
        const tx = tf[4];
        const ty = tf[5];
        node.bounds = {
          top: Math.round(ty + textBB.top.value),
          left: Math.round(tx + textBB.left.value),
          bottom: Math.round(ty + textBB.bottom.value),
          right: Math.round(tx + textBB.right.value),
        };
      }
    }

    // テキストレイヤーのフォント情報を抽出
    if (child.text) {
      const fonts = new Set<string>();
      const fontSizes = new Set<number>();

      // ag-psd の fontSize はドキュメント解像度に応じたピクセル相当値のため
      // 72 / DPI でタイポグラフィポイントに正規化する
      const ptScale = 72 / dpi;

      // デフォルトスタイル
      if (child.text.style?.font?.name) {
        fonts.add(child.text.style.font.name);
      }
      if (child.text.style?.fontSize) {
        fontSizes.add(parseFloat((child.text.style.fontSize * ptScale).toFixed(1)));
      }

      // styleRuns（テキスト内でフォントが混在する場合）
      if (child.text.styleRuns) {
        for (const run of child.text.styleRuns) {
          if (run.style?.font?.name) {
            fonts.add(run.style.font.name);
          }
          if (run.style?.fontSize) {
            fontSizes.add(parseFloat((run.style.fontSize * ptScale).toFixed(1)));
          }
        }
      }

      // アンチエイリアス（テキストデータ直下）
      const antiAlias = child.text.antiAlias as string | undefined;

      // トラッキング（カーニング）：0以外の値のみ収集
      const trackingValues = new Set<number>();
      if (child.text.style?.tracking && child.text.style.tracking !== 0) {
        trackingValues.add(child.text.style.tracking);
      }
      if (child.text.styleRuns) {
        for (const run of child.text.styleRuns) {
          if (run.style?.tracking && run.style.tracking !== 0) {
            trackingValues.add(run.style.tracking);
          }
        }
      }

      node.textInfo = {
        text: child.text.text || "",
        fonts: [...fonts],
        fontSizes: [...fontSizes].sort((a, b) => b - a),
        ...(antiAlias ? { antiAlias } : {}),
        ...(trackingValues.size > 0 ? { tracking: [...trackingValues] } : {}),
      };
    }

    if (child.children && child.children.length > 0) {
      node.children = extractLayerTree(child.children, path, dpi);
    }

    return node;
  });
}

function getLayerType(layer: any): LayerNode["type"] {
  if (layer.children && layer.children.length > 0) return "group";
  if (layer.text) return "text";
  if (layer.adjustment) return "adjustment";
  if (layer.placedLayer) return "smartObject";
  if (layer.vectorFill || layer.vectorStroke) return "shape";
  return "layer";
}

function countLayers(children: Psd["children"]): number {
  if (!children) return 0;

  let count = 0;
  for (const child of children) {
    count++;
    if (child.children) {
      count += countLayers(child.children);
    }
  }
  return count;
}

async function generateThumbnail(psd: Psd): Promise<string | undefined> {
  try {
    // Try to use the embedded thumbnail first
    const thumbResource = psd.imageResources?.thumbnail;
    if (thumbResource) {
      // Check if thumbnail has canvas or data
      const thumbData = thumbResource as any;
      if (thumbData.canvas) {
        return thumbData.canvas.toDataURL("image/jpeg", 0.92);
      }
      if (thumbData.data && thumbData.data instanceof Uint8Array) {
        const blob = new Blob([thumbData.data], { type: "image/jpeg" });
        return await blobToDataUrl(blob);
      }
    }

    // Fall back to composite image
    if (psd.imageData) {
      const canvas = document.createElement("canvas");
      canvas.width = psd.width;
      canvas.height = psd.height;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        // Create ImageData from PixelData
        const imageData = new ImageData(
          new Uint8ClampedArray(psd.imageData.data),
          psd.imageData.width,
          psd.imageData.height,
        );
        ctx.putImageData(imageData, 0, 0);

        // Scale down for thumbnail (high quality)
        const maxSize = 800;
        const scale = Math.min(maxSize / psd.width, maxSize / psd.height, 1);
        const thumbCanvas = document.createElement("canvas");
        thumbCanvas.width = Math.round(psd.width * scale);
        thumbCanvas.height = Math.round(psd.height * scale);
        const thumbCtx = thumbCanvas.getContext("2d");
        if (thumbCtx) {
          thumbCtx.imageSmoothingQuality = "high";
          thumbCtx.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
          return thumbCanvas.toDataURL("image/jpeg", 0.92);
        }
      }
    }
  } catch (error) {
    console.error("Failed to generate thumbnail:", error);
  }
  return undefined;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
