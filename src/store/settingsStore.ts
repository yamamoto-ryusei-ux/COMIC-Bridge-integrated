import { create } from "zustand";

/** ナビバーに表示するボタンの定義 */
export interface NavButton {
  id: string;
  label: string;
}

/** 全てのナビ/ツール項目（ナビバーとツールメニュー両方で使用可能） */
export const ALL_NAV_BUTTONS: NavButton[] = [
  { id: "specCheck", label: "ホーム" },
  { id: "unifiedViewer", label: "ビューアー" },
  { id: "scanPsd", label: "スキャナー" },
  { id: "layers", label: "レイヤー構造" },
  { id: "layerControl", label: "レイヤー制御" },
  { id: "replace", label: "差替え" },
  { id: "compose", label: "合成" },
  { id: "tiff", label: "TIFF化" },
  { id: "split", label: "見開き分割" },
  { id: "recycle", label: "リサイくるん" },
  { id: "folderSetup", label: "フォルダセットアップ" },
  { id: "requestPrep", label: "依頼準備" },
];

export interface AppSettings {
  fontSize: "small" | "medium" | "large";
  accentColor: string;
  darkMode: boolean;
  defaultFolderPath: string;
  /** CBロゴ行に表示するボタンID */
  navBarButtons: string[];
  /** ツールメニューに表示するボタンID */
  toolMenuButtons: string[];

  setFontSize: (size: "small" | "medium" | "large") => void;
  setAccentColor: (color: string) => void;
  setDarkMode: (dark: boolean) => void;
  setDefaultFolderPath: (path: string) => void;
  setNavBarButtons: (buttons: string[]) => void;
  setToolMenuButtons: (buttons: string[]) => void;
}

const STORAGE_KEY = "comic_bridge_settings";

function loadSettings(): Partial<AppSettings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

function saveSettings(state: Partial<AppSettings>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      fontSize: state.fontSize,
      accentColor: state.accentColor,
      darkMode: state.darkMode,
      defaultFolderPath: state.defaultFolderPath,
      navBarButtons: state.navBarButtons,
      toolMenuButtons: state.toolMenuButtons,
    }));
  } catch { /* ignore */ }
}

const saved = loadSettings();

// Migration: 既存ユーザーの toolMenuButtons にレガシー項目（layerControl/recycle）を追加
function migrateToolMenu(existing: string[] | undefined): string[] {
  // 初期インストール: 全項目を含める
  if (!existing) return ["layerControl", "replace", "compose", "tiff", "split", "recycle", "folderSetup", "requestPrep"];

  let result = existing;
  // layerControl 追加（未登録の場合のみ）
  if (!result.includes("layerControl")) {
    result = ["layerControl", ...result];
  }
  // recycle 追加（未登録の場合のみ）
  if (!result.includes("recycle")) {
    // split の後ろに挿入。なければ末尾に追加
    const splitIdx = result.indexOf("split");
    if (splitIdx >= 0) {
      result = [...result.slice(0, splitIdx + 1), "recycle", ...result.slice(splitIdx + 1)];
    } else {
      result = [...result, "recycle"];
    }
  }
  return result;
}

export const useSettingsStore = create<AppSettings>((set, get) => ({
  fontSize: saved.fontSize || "medium",
  accentColor: saved.accentColor || "#7c5cff",
  darkMode: saved.darkMode ?? false,
  defaultFolderPath: saved.defaultFolderPath || "",
  navBarButtons: saved.navBarButtons || ["specCheck", "unifiedViewer", "scanPsd", "layers"],
  toolMenuButtons: migrateToolMenu(saved.toolMenuButtons),

  setFontSize: (fontSize) => { set({ fontSize }); saveSettings({ ...get(), fontSize }); },
  setAccentColor: (accentColor) => { set({ accentColor }); saveSettings({ ...get(), accentColor }); },
  setDarkMode: (darkMode) => { set({ darkMode }); saveSettings({ ...get(), darkMode }); },
  setDefaultFolderPath: (defaultFolderPath) => { set({ defaultFolderPath }); saveSettings({ ...get(), defaultFolderPath }); },
  setNavBarButtons: (navBarButtons) => { set({ navBarButtons }); saveSettings({ ...get(), navBarButtons }); },
  setToolMenuButtons: (toolMenuButtons) => { set({ toolMenuButtons }); saveSettings({ ...get(), toolMenuButtons }); },
}));
