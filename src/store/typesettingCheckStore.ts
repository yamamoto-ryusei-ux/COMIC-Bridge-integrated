import { create } from "zustand";
import type { ParsedProofreadingData, CheckTabMode } from "../types/typesettingCheck";
import { usePsdStore } from "./psdStore";

// --- デフォルトパス ---
const DEFAULT_JSON_BASE_PATH =
  "G:/共有ドライブ/CLLENN/編集部フォルダ/編集企画部/写植・校正用テキストログ";

function loadPath(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function savePath(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export interface TypesettingCheckState {
  // 校正チェックデータ
  checkData: ParsedProofreadingData | null;
  checkTabMode: CheckTabMode;

  // JSONファイルブラウザ
  jsonBasePath: string;
  showJsonBrowser: boolean;

  // PSDビューワー
  viewerFileIndex: number;

  // 検索
  searchQuery: string;

  // チェック済み項目
  checkedItems: Set<string>;

  // Actions
  setCheckData: (data: ParsedProofreadingData | null) => void;
  setCheckTabMode: (mode: CheckTabMode) => void;
  setJsonBasePath: (path: string) => void;
  setShowJsonBrowser: (show: boolean) => void;
  setViewerFileIndex: (index: number) => void;
  setSearchQuery: (query: string) => void;
  navigateToPage: (pageStr: string) => void;
  toggleChecked: (key: string) => void;
  reset: () => void;
}

export const useTypesettingCheckStore = create<TypesettingCheckState>((set) => ({
  checkData: null,
  checkTabMode: "both",
  jsonBasePath: loadPath("typesetting-json-base-path", DEFAULT_JSON_BASE_PATH),
  showJsonBrowser: false,
  viewerFileIndex: 0,
  searchQuery: "",
  checkedItems: new Set<string>(),

  setCheckData: (checkData) => set({ checkData, checkedItems: new Set<string>() }),
  setCheckTabMode: (checkTabMode) => set({ checkTabMode }),
  setJsonBasePath: (path) => {
    savePath("typesetting-json-base-path", path);
    set({ jsonBasePath: path });
  },
  setShowJsonBrowser: (showJsonBrowser) => set({ showJsonBrowser }),
  setViewerFileIndex: (viewerFileIndex) => set({ viewerFileIndex }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),

  navigateToPage: (pageStr) => {
    // "3巻 6ページ" → 6, "3巻1P" → 1 のように最後の数字を取得
    const pageMatch = pageStr.match(/(\d+)\s*(?:ページ|ぺーじ|P|p)\s*$/i);
    const lastNum = pageMatch ? pageMatch[1] : pageStr.match(/(\d+)(?=[^\d]*$)/)?.[1];
    if (!lastNum) return;
    const pageNum = parseInt(lastNum, 10);

    const files = usePsdStore.getState().files;
    // ファイル名の最後の連続数字とページ番号を照合（usePageNumberCheck と同じロジック）
    const idx = files.findIndex((f) => {
      const nameWithoutExt = f.fileName.replace(/\.[^.]+$/, "");
      const nameMatch = nameWithoutExt.match(/(\d+)(?=[^\d]*$)/);
      return nameMatch && parseInt(nameMatch[1], 10) === pageNum;
    });
    if (idx >= 0) {
      set({ viewerFileIndex: idx });
    }
  },

  toggleChecked: (key) =>
    set((state) => {
      const next = new Set(state.checkedItems);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return { checkedItems: next };
    }),

  reset: () =>
    set({
      checkData: null,
      checkTabMode: "both",
      showJsonBrowser: false,
      viewerFileIndex: 0,
      searchQuery: "",
      checkedItems: new Set<string>(),
    }),
}));
