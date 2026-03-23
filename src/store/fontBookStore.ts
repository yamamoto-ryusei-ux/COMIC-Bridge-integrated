import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { FontBookEntry, FontBookData } from "../types/fontBook";
import { getFontBookDir } from "../types/fontBook";

interface FontBookState {
  entries: FontBookEntry[];
  fontBookDir: string | null;
  isLoaded: boolean;

  // キャプチャモード
  isCapturing: boolean;
  setCapturing: (v: boolean) => void;

  // データ操作
  loadFontBook: (textLogFolderPath: string, label: string, title: string) => Promise<void>;
  addEntry: (entry: FontBookEntry, imageData: Uint8Array) => Promise<void>;
  removeEntry: (id: string) => Promise<void>;
  updateEntry: (id: string, partial: Partial<Pick<FontBookEntry, "note">>) => Promise<void>;
  reorderEntries: (orderedIds: string[]) => Promise<void>;
  reset: () => void;
}

export const useFontBookStore = create<FontBookState>((set, get) => ({
  entries: [],
  fontBookDir: null,
  isLoaded: false,
  isCapturing: false,

  setCapturing: (isCapturing) => set({ isCapturing }),

  loadFontBook: async (textLogFolderPath, label, title) => {
    const dir = getFontBookDir(textLogFolderPath, label, title);
    // 同じ作品が既にロード済みならスキップ（メモリ上のentriesを維持）
    const { fontBookDir, isLoaded } = get();
    if (fontBookDir === dir && isLoaded) return;

    const jsonPath = `${dir}/fontbook.json`;
    set({ fontBookDir: dir, entries: [], isLoaded: false });
    try {
      const content = await invoke<string>("read_text_file", { filePath: jsonPath });
      const data: FontBookData = JSON.parse(content);
      set({ entries: data.entries || [], isLoaded: true });
    } catch {
      // fontbook.json doesn't exist yet - that's fine
      set({ entries: [], isLoaded: true });
    }
  },

  addEntry: async (entry, imageData) => {
    const { fontBookDir, entries } = get();
    if (!fontBookDir) return;

    // 画像を保存（Rustコマンド経由で親ディレクトリも自動作成）
    const imagePath = `${fontBookDir}/${entry.id}.jpg`;
    await invoke("write_binary_file", { filePath: imagePath, data: Array.from(imageData) });

    // エントリを追加してJSON保存
    const newEntries = [...entries, entry];
    set({ entries: newEntries });
    await persistJson(fontBookDir, newEntries);
  },

  removeEntry: async (id) => {
    const { fontBookDir, entries } = get();
    if (!fontBookDir) return;

    const newEntries = entries.filter((e) => e.id !== id);
    set({ entries: newEntries });
    await persistJson(fontBookDir, newEntries);

    // 画像ファイルも削除を試みる
    try {
      await invoke("delete_file", { filePath: `${fontBookDir}/${id}.jpg` });
    } catch {
      /* ignore */
    }
  },

  updateEntry: async (id, partial) => {
    const { fontBookDir, entries } = get();
    if (!fontBookDir) return;
    const newEntries = entries.map((e) => (e.id === id ? { ...e, ...partial } : e));
    set({ entries: newEntries });
    await persistJson(fontBookDir, newEntries);
  },

  reorderEntries: async (orderedIds) => {
    const { fontBookDir, entries } = get();
    if (!fontBookDir) return;
    const entryMap = new Map(entries.map((e) => [e.id, e]));
    const reordered: FontBookEntry[] = [];
    for (const id of orderedIds) {
      const e = entryMap.get(id);
      if (e) reordered.push(e);
    }
    // 含まれなかったエントリは末尾に追加
    for (const e of entries) {
      if (!orderedIds.includes(e.id)) reordered.push(e);
    }
    set({ entries: reordered });
    await persistJson(fontBookDir, reordered);
  },

  reset: () => set({ entries: [], fontBookDir: null, isLoaded: false, isCapturing: false }),
}));

async function persistJson(dir: string, entries: FontBookEntry[]) {
  const data: FontBookData = {
    entries,
    updatedAt: new Date().toISOString(),
  };
  await invoke("write_text_file", {
    filePath: `${dir}/fontbook.json`,
    content: JSON.stringify(data, null, 2),
  });
}
