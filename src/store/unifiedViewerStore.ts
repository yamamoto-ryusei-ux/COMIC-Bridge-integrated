/**
 * 統合ビューアー専用ストア
 * メインの psdStore とは独立したファイル管理を行う
 */
import { create } from "zustand";
import type { PsdMetadata } from "../types";
import type {
  ParsedProofreadingData,
  CheckTabMode,
} from "../types/typesettingCheck";

// ─── Types ──────────────────────────────────────────────

export interface ViewerFile {
  name: string;
  path: string;
  sourceType: "psd" | "image" | "pdf";
  /** PDFページ情報 */
  isPdf?: boolean;
  pdfPage?: number;
  pdfPath?: string;
  /** PSD/PSBの場合のみ: Rustパーサーから取得したメタデータ */
  metadata?: PsdMetadata;
}

export interface TextBlock {
  id: string;
  originalIndex: number;
  lines: string[];
  assignedFont?: string;
  isAdded?: boolean;
}

export interface TextPage {
  pageNumber: number;
  blocks: TextBlock[];
}

export interface FontPresetEntry {
  font: string; // PostScript name
  name: string; // Display name
  subName?: string; // Category
}

export type PanelTab = "files" | "layers" | "spec" | "text" | "proofread" | "diff";
export type LeftTab = PanelTab;
export type RightTab = PanelTab;

interface UnifiedViewerState {
  // ─ Files ─
  files: ViewerFile[];
  currentFileIndex: number;

  // ─ Left sidebar ─
  leftTab: LeftTab;

  // ─ Right panel ─
  rightTab: RightTab;

  // ─ Text editor (COMIC-POT) ─
  textContent: string;
  textFilePath: string | null;
  textHeader: string[];
  textPages: TextPage[];
  isDirty: boolean;
  editMode: "edit" | "select";
  selectedBlockIds: Set<string>;

  // ─ Font presets ─
  fontPresets: FontPresetEntry[];
  presetJsonPath: string | null;

  // ─ Proofreading (校正JSON) ─
  checkData: ParsedProofreadingData | null;
  checkTabMode: CheckTabMode;
  checkSearchQuery: string;

  // ─ Actions ─
  setFiles: (files: ViewerFile[]) => void;
  addFiles: (files: ViewerFile[]) => void;
  setCurrentFileIndex: (index: number) => void;
  setLeftTab: (tab: LeftTab) => void;
  setRightTab: (tab: RightTab) => void;

  // Text
  setTextContent: (content: string) => void;
  setTextFilePath: (path: string | null) => void;
  setTextHeader: (header: string[]) => void;
  setTextPages: (pages: TextPage[]) => void;
  setIsDirty: (dirty: boolean) => void;
  setEditMode: (mode: "edit" | "select") => void;
  setSelectedBlockIds: (ids: Set<string>) => void;
  assignFontToBlocks: (blockIds: string[], font: string) => void;

  // Font presets
  setFontPresets: (presets: FontPresetEntry[]) => void;
  setPresetJsonPath: (path: string | null) => void;

  // Proofreading
  setCheckData: (data: ParsedProofreadingData | null) => void;
  setCheckTabMode: (mode: CheckTabMode) => void;
  setCheckSearchQuery: (query: string) => void;

  // File metadata
  updateFileMetadata: (index: number, metadata: PsdMetadata) => void;
}

export const useUnifiedViewerStore = create<UnifiedViewerState>((set, get) => ({
  // Initial state
  files: [],
  currentFileIndex: -1,
  leftTab: "files",
  rightTab: "text",
  textContent: "",
  textFilePath: null,
  textHeader: [],
  textPages: [],
  isDirty: false,
  editMode: "select",
  selectedBlockIds: new Set(),
  fontPresets: [],
  presetJsonPath: null,
  checkData: null,
  checkTabMode: "both",
  checkSearchQuery: "",

  // Actions
  setFiles: (files) => set({ files, currentFileIndex: files.length > 0 ? 0 : -1 }),
  addFiles: (newFiles) => {
    const { files } = get();
    const combined = [...files, ...newFiles];
    set({ files: combined, currentFileIndex: files.length === 0 ? 0 : get().currentFileIndex });
  },
  setCurrentFileIndex: (index) => set({ currentFileIndex: index }),
  setLeftTab: (tab) => set({ leftTab: tab }),
  setRightTab: (tab) => set({ rightTab: tab }),

  setTextContent: (content) => set({ textContent: content }),
  setTextFilePath: (path) => set({ textFilePath: path }),
  setTextHeader: (header) => set({ textHeader: header }),
  setTextPages: (pages) => set({ textPages: pages }),
  setIsDirty: (dirty) => set({ isDirty: dirty }),
  setEditMode: (mode) => set({ editMode: mode }),
  setSelectedBlockIds: (ids) => set({ selectedBlockIds: ids }),

  assignFontToBlocks: (blockIds, font) => {
    const { textPages } = get();
    const updated = textPages.map((page) => ({
      ...page,
      blocks: page.blocks.map((block) =>
        blockIds.includes(block.id) ? { ...block, assignedFont: font } : block,
      ),
    }));
    set({ textPages: updated, isDirty: true });
  },

  setFontPresets: (presets) => set({ fontPresets: presets }),
  setPresetJsonPath: (path) => set({ presetJsonPath: path }),

  setCheckData: (data) => set({ checkData: data }),
  setCheckTabMode: (mode) => set({ checkTabMode: mode }),
  setCheckSearchQuery: (query) => set({ checkSearchQuery: query }),

  updateFileMetadata: (index, metadata) => {
    const { files } = get();
    if (index < 0 || index >= files.length) return;
    const updated = [...files];
    updated[index] = { ...updated[index], metadata };
    set({ files: updated });
  },
}));
