// === サブモード ===
export type RenameSubMode = "layer" | "file";

// === 処理フェーズ ===
export type RenamePhase = "idle" | "processing" | "complete" | "error";

// === マッチモード ===
export type MatchMode = "exact" | "partial" | "regex";

// ==============================
// モードA: レイヤーリネーム
// ==============================

export interface RenameRule {
  id: string;
  target: "layer" | "group";
  oldName: string;
  newName: string;
  matchMode: MatchMode;
}

export interface BottomLayerSettings {
  enabled: boolean;
  newName: string;
}

export interface LayerFileOutputSettings {
  enabled: boolean;
  baseName: string;
  startNumber: number;
  padding: number;
  separator: string;
}

export interface LayerRenameSettings {
  bottomLayer: BottomLayerSettings;
  rules: RenameRule[];
  fileOutput: LayerFileOutputSettings;
  outputDirectory: string | null;
}

// ==============================
// モードB: ファイルリネーム
// ==============================

export type FileRenameMode = "sequential" | "replace" | "prefix";
export type FileOutputMode = "copy" | "overwrite";

export interface FileRenameEntry {
  id: string;
  filePath: string;
  fileName: string;
  folderPath: string;
  folderName: string;
  selected: boolean;
  /** 個別編集で上書きされた名前（null=自動計算） */
  customName: string | null;
}

export interface SequentialSettings {
  baseName: string;
  startNumber: number;
  padding: number;
  separator: string;
}

export interface ReplaceStringSettings {
  searchText: string;
  replaceText: string;
  matchMode: MatchMode;
}

export interface PrefixSuffixSettings {
  prefix: string;
  suffix: string;
}

export interface FileRenameSettings {
  mode: FileRenameMode;
  sequential: SequentialSettings;
  replaceString: ReplaceStringSettings;
  prefixSuffix: PrefixSuffixSettings;
  outputMode: FileOutputMode;
  outputDirectory: string | null;
}

// ==============================
// 共通: 結果
// ==============================

export interface RenameResult {
  fileName: string;
  newFileName?: string;
  success: boolean;
  outputFile: string;
  changes: string[];
  error?: string;
}

// プレビュー用
export interface LayerRenamePreview {
  path: string; // e.g. "GroupA > LayerX"
  type: "layer" | "group";
  oldName: string;
  newName: string;
}

export interface FileRenamePreview {
  id: string;
  originalName: string;
  newName: string;
  folderName: string;
}
