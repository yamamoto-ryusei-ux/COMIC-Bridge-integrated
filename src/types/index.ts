// Supported file extensions
export const PSD_EXTENSIONS = [".psd", ".psb"] as const;
export const IMAGE_EXTENSIONS = [
  ".psd",
  ".psb",
  ".jpg",
  ".jpeg",
  ".png",
  ".tif",
  ".tiff",
  ".bmp",
  ".pdf",
  ".gif",
  ".eps",
] as const;

export function isSupportedFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function isPsdFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return PSD_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function isPdfFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(".pdf");
}

// PSD File Types
export interface PsdFile {
  id: string;
  filePath: string;
  fileName: string;
  fileSize: number;
  modifiedTime: number;
  metadata?: PsdMetadata;
  thumbnailUrl?: string;
  thumbnailStatus: "pending" | "loading" | "ready" | "error";
  error?: string;
  // PDF support
  sourceType?: "psd" | "image" | "pdf";
  pdfSourcePath?: string;
  pdfPageIndex?: number;
  // Subfolder support (TIFF tab)
  subfolderName?: string; // サブフォルダ名（ルート直下は空文字/undefined）
  // File watcher
  fileChanged?: boolean; // 外部でファイルが変更された
}

export interface PsdMetadata {
  width: number;
  height: number;
  dpi: number;
  colorMode: ColorMode;
  bitsPerChannel: number;
  hasGuides: boolean;
  guides: Guide[];
  layerCount: number;
  layerTree: LayerNode[];
  hasAlphaChannels: boolean;
  alphaChannelCount: number;
  alphaChannelNames: string[];
  hasTombo: boolean;
}

export type ColorMode =
  | "RGB"
  | "CMYK"
  | "Grayscale"
  | "Bitmap"
  | "Lab"
  | "Indexed"
  | "Multichannel"
  | "Duotone";

export interface Guide {
  direction: "horizontal" | "vertical";
  position: number; // in pixels from top/left
}

export interface TextInfo {
  text: string;
  fonts: string[];
  fontSizes: number[];
  strokeSize?: number;
  antiAlias?: string; // "Shrp" | "Crsp" | "Strg" | "Smth" | "Anno"
  tracking?: number[]; // トラッキング値（0以外のみ）
}

export interface LayerBounds {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export interface LayerNode {
  id: string;
  name: string;
  type: "layer" | "group" | "text" | "adjustment" | "smartObject" | "shape";
  visible: boolean;
  opacity: number;
  blendMode: string;
  hasMask?: boolean;
  hasVectorMask?: boolean;
  clipping?: boolean;
  locked?: boolean;
  textInfo?: TextInfo;
  children?: LayerNode[];
  bounds?: LayerBounds;
}

// Specification Types
export interface Specification {
  id: string;
  name: string;
  enabled: boolean;
  rules: SpecRule[];
}

export interface SpecRule {
  type:
    | "colorMode"
    | "resolution"
    | "dimensions"
    | "dpi"
    | "hasGuides"
    | "bitsPerChannel"
    | "hasAlphaChannels";
  operator: "equals" | "greaterThan" | "lessThan" | "between" | "includes";
  value: string | number | boolean | number[];
  message: string;
}

export interface SpecCheckResult {
  fileId: string;
  passed: boolean;
  results: {
    rule: SpecRule;
    passed: boolean;
    actualValue: string | number | boolean;
  }[];
  matchedSpec?: string; // どの仕様にマッチしたか（または最も近い仕様）
}

// UI Types
export type ViewMode = "grid";
export type ThumbnailSize = "small" | "medium" | "large" | "xlarge";

export const THUMBNAIL_SIZES: Record<ThumbnailSize, { value: number; label: string }> = {
  small: { value: 100, label: "小" },
  medium: { value: 140, label: "中" },
  large: { value: 180, label: "大" },
  xlarge: { value: 240, label: "特大" },
};
