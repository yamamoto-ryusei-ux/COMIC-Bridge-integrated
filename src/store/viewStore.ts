import { create } from "zustand";

export type AppView =
  | "specCheck"
  | "layers"
  | "split"
  | "replace"
  | "compose"
  | "rename"
  | "tiff"
  | "scanPsd"
  | "typesetting"
  | "progen"
  | "unifiedViewer"
  | "folderSetup"
  | "requestPrep"
  | "recycle";

export type ProgenMode = "extraction" | "formatting" | "proofreading" | null;

interface ViewState {
  activeView: AppView;
  isDetailPanelOpen: boolean;
  progenMode: ProgenMode;
  isViewerFullscreen: boolean;
  /** 検版: 検Aフォルダパス */
  kenbanPathA: string | null;
  /** 検版: 検Bフォルダパス */
  kenbanPathB: string | null;
  /** 検版: 差分/分割切替 */
  kenbanViewMode: "diff" | "parallel";
  /** JSONブラウザモード（TopNavモーダル用） */
  jsonBrowserMode: "preset" | "check" | null;
  /** グローバルpromptダイアログ */
  promptDialog: { message: string; defaultValue: string; resolve: (value: string | null) => void } | null;

  setActiveView: (view: AppView) => void;
  setDetailPanelOpen: (open: boolean) => void;
  toggleDetailPanel: () => void;
  setProgenMode: (mode: ProgenMode) => void;
  setViewerFullscreen: (fullscreen: boolean) => void;
  setKenbanPathA: (path: string | null) => void;
  setKenbanPathB: (path: string | null) => void;
  setKenbanViewMode: (mode: "diff" | "parallel") => void;
  setJsonBrowserMode: (mode: "preset" | "check" | null) => void;
}

export const useViewStore = create<ViewState>((set) => ({
  activeView: "specCheck",
  isDetailPanelOpen: false,
  progenMode: null,
  isViewerFullscreen: false,
  kenbanPathA: null,
  kenbanPathB: null,
  kenbanViewMode: "diff" as const,
  jsonBrowserMode: null,

  setActiveView: (activeView) => set({ activeView }),
  setDetailPanelOpen: (isDetailPanelOpen) => set({ isDetailPanelOpen }),
  toggleDetailPanel: () => set((state) => ({ isDetailPanelOpen: !state.isDetailPanelOpen })),
  setProgenMode: (progenMode) => set({ progenMode }),
  setViewerFullscreen: (isViewerFullscreen) => {
    set({ isViewerFullscreen });
    // OSレベルのフルスクリーン切替（タイトルバーも非表示にする）
    import("@tauri-apps/api/webviewWindow").then(({ getCurrentWebviewWindow }) => {
      getCurrentWebviewWindow().setFullscreen(isViewerFullscreen).catch(() => {});
    });
  },
  setKenbanPathA: (kenbanPathA) => set({ kenbanPathA }),
  setKenbanPathB: (kenbanPathB) => set({ kenbanPathB }),
  setKenbanViewMode: (kenbanViewMode) => set({ kenbanViewMode }),
  setJsonBrowserMode: (jsonBrowserMode) => set({ jsonBrowserMode }),
  promptDialog: null,
}));

/** Tauri互換のpromptダイアログ（window.promptの代替） */
export function showPromptDialog(message: string, defaultValue = ""): Promise<string | null> {
  return new Promise((resolve) => {
    useViewStore.setState({
      promptDialog: { message, defaultValue, resolve },
    });
  });
}

/**
 * A/Bパスセット時のフォルダ検証。
 * PSDがあればPSD優先で通す。問題があればアラートを出してfalseを返す。
 */
export async function validateAndSetABPath(
  side: "A" | "B",
  folderPath: string,
): Promise<boolean> {
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    const files = await invoke<string[]>("list_folder_files", { folderPath, recursive: false });
    if (files.length === 0) {
      return false;
    }
    const getExt = (f: string) => { const d = f.lastIndexOf("."); return d > 0 ? f.substring(d).toLowerCase() : ""; };
    const psdExts = new Set([".psd", ".psb"]);
    const imageExts = new Set([".psd", ".psb", ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".gif", ".pdf", ".eps"]);

    const psds = files.filter((f) => psdExts.has(getExt(f)));
    const images = files.filter((f) => imageExts.has(getExt(f)));

    // テキストのみ or 画像なし → セットしない（アラートなし）
    if (images.length === 0) {
      return false;
    }
    // PSDがある場合はPSD優先（混在OK）
    if (psds.length > 0) {
      // PSD以外の画像が混在 → 情報表示（ブロックしない）
      const nonPsd = images.filter((f) => !psdExts.has(getExt(f)));
      if (nonPsd.length > 0) {
        // PSD優先なので通す
      }
    } else {
      // PSDなし: 複数拡張子の混在チェック
      const extSet = new Set(images.map((f) => getExt(f)));
      if (extSet.size > 1) {
        const extList = [...extSet].join(", ");
        if (!confirm(`${side}側: 複数の拡張子が混在しています（${extList}）。\nこのまま続行しますか？`)) {
          return false;
        }
      }
    }
  } catch {
    // フォルダ読み取り失敗（ファイル指定の場合など）→ そのまま通す
  }
  // セット
  const vs = useViewStore.getState();
  if (side === "A") vs.setKenbanPathA(folderPath);
  else vs.setKenbanPathB(folderPath);
  return true;
}
