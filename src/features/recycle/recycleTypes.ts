// リサイくるん連携用の型定義
// プラグイン側 JOB_SCHEMA.md と一対一対応

/** ジョブ JSON のルート型 */
export interface RecycleJob {
  jobId?: string; // 未指定時は Rust 側で生成
  schemaVersion: 1;
  createdAt: string;
  scanResult: RecycleScanResult;
  settings: RecycleSettings;
  perFileOverrides: RecyclePerFileOverride[];
  saveMode: "separate" | "overwrite";
  outputPath: string | null;
}

export interface RecycleScanResult {
  folderPath: string;
  files: RecycleScanFile[];
}

export interface RecycleScanFile {
  filePath: string;
  width: number;
  height: number;
  textLayers: RecycleTextLayer[];
}

export interface RecycleTextLayer {
  layerId: number;
  layerName: string;
  text: string;
  fontPostScriptName: string;
  fontSize: number;
  color: { r: number; g: number; b: number };
  hasStroke: boolean;
  strokeColor?: { r: number; g: number; b: number };
  strokeSize?: number;
  visible: boolean;
  boundingBox: [number, number, number, number]; // [left, top, right, bottom]
}

/** 設定全体（3タブ分） */
export interface RecycleSettings {
  optimize: RecycleOptimizeSettings;
  textFormat: RecycleTextFormatSettings;
  other: RecycleOtherSettings;
}

export interface RecycleOptimizeSettings {
  sharpAntiAlias: boolean;
  convertToPoint: boolean;
  blackColor: boolean;
  leading: { enabled: boolean; value: number }; // %
  tracking: { enabled: boolean; value: number }; // %
  kerning: boolean;
  tsume0: boolean;
  directTracking: { enabled: boolean; value: number };
  tateChuYoko: boolean;
  tateChuYokoNumbers: boolean;
  heartFont: boolean;
  fontSizeAdjust: boolean;
  changeFontSize: { enabled: boolean; value: number };
  missingFontReplace: boolean;
  groupTextLayers: boolean;
}

export interface RecycleTextFormatSettings {
  commaToSpace: boolean;
  periodToSpace: boolean;
  exclamQuestion: boolean;
  questionExclamSwap: boolean;
  punctuationConvert: boolean;
  fullwidthToHalf: boolean;
  trimStart: boolean;
  trimEnd: boolean;
}

export interface RecycleOtherSettings {
  stroke: {
    mode: "none" | "apply" | "unify" | "remove";
    size: number; // px
  };
  hide: {
    textLayers: boolean;
    textFolder: boolean;
    kihonwaku: boolean;
    shirokeshi: boolean;
    customLayers: string[];
    customGroups: string[];
  };
  show: {
    textLayers: boolean;
    textFolder: boolean;
    customLayers: string[];
    customGroups: string[];
  };
}

export interface RecyclePerFileOverride {
  filePath: string;
  layerId: number;
  fontPostScriptName?: string;
  fontSize?: number;
}

/** ステータスJSON（プラグイン → アプリ） */
export interface RecycleStatus {
  jobId: string;
  phase: "starting" | "processing" | "saving";
  currentIndex: number;
  totalFiles: number;
  currentFile?: string;
  progress: number; // 0..1
}

/** 結果JSON（プラグイン → アプリ） */
export interface RecycleResult {
  jobId: string;
  completedAt: string;
  status: "success" | "partial" | "error" | "cancelled";
  filesProcessed?: number;
  filesErrors?: number;
  filesSkipped?: number;
  skipLogPath?: string;
  saveDestPath?: string;
  elapsedMs?: number;
  error?: string;
}

/** デフォルト設定（リサイくるん旧版のチェック状態を再現） */
export function createDefaultSettings(): RecycleSettings {
  return {
    optimize: {
      sharpAntiAlias: false,
      convertToPoint: false,
      blackColor: false,
      leading: { enabled: false, value: 125 },
      tracking: { enabled: false, value: 0 },
      kerning: false,
      tsume0: false,
      directTracking: { enabled: false, value: 0 },
      tateChuYoko: false,
      tateChuYokoNumbers: false,
      heartFont: false,
      fontSizeAdjust: false,
      changeFontSize: { enabled: false, value: 12 },
      missingFontReplace: false,
      groupTextLayers: false,
    },
    textFormat: {
      commaToSpace: false,
      periodToSpace: false,
      exclamQuestion: false,
      questionExclamSwap: false,
      punctuationConvert: false,
      fullwidthToHalf: false,
      trimStart: false,
      trimEnd: false,
    },
    other: {
      stroke: { mode: "none", size: 20 },
      hide: {
        textLayers: false,
        textFolder: false,
        kihonwaku: false,
        shirokeshi: false,
        customLayers: [],
        customGroups: [],
      },
      show: {
        textLayers: false,
        textFolder: false,
        customLayers: [],
        customGroups: [],
      },
    },
  };
}
