import React, { useCallback, useEffect } from "react";
import { TopNav } from "./TopNav";
import { GlobalAddressBar } from "./GlobalAddressBar";
import { ViewRouter } from "./ViewRouter";
import { GuideEditorModal } from "../guide-editor/GuideEditorModal";
import { ErrorBoundary } from "../ErrorBoundary";

import { ConversionToast } from "../../features/spec-check/components/ConversionToast";
import { usePsdStore } from "../../store/psdStore";
import { useViewStore } from "../../store/viewStore";
import { useGuideStore } from "../../store/guideStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useGlobalDragDrop } from "../../hooks/useGlobalDragDrop";
import { useOpenFolderShortcut } from "../../hooks/useOpenFolder";
import { useFileWatcher } from "../../hooks/useFileWatcher";
import { useHandoff } from "../../hooks/useHandoff";
import { usePsdLoader } from "../../hooks/usePsdLoader";
import { registerPsdLoader } from "../../lib/psdLoaderRegistry";

export function AppLayout() {
  const isViewerFullscreen = useViewStore((s) => s.isViewerFullscreen);
  const isEditorOpen = useGuideStore((state) => state.isEditorOpen);
  const { fontSize, accentColor, darkMode } = useSettingsStore();

  // 設定をCSS変数/クラスに反映
  useEffect(() => {
    const root = document.documentElement;
    // フォントサイズ
    const scale = fontSize === "small" ? 0.9 : fontSize === "large" ? 1.15 : 1;
    root.style.fontSize = `${scale * 16}px`;
  }, [fontSize]);

  // ダークモード + アクセントカラー
  // ダークモードは HTML に dark-mode-invert クラスを付与し、CSS 側で
  //   html.dark-mode-invert                        { filter: invert(1) hue-rotate(180deg); }
  //   html.dark-mode-invert img, video, canvas, iframe,
  //   html.dark-mode-invert [data-no-invert]       { filter: invert(1) hue-rotate(180deg); }
  // と完全な数値一致（invert(1)×invert(1)=identity）で打ち消す。
  // JS querySelectorAll では「後から追加される画像」が打ち消されない問題があったため、CSS 全面化。
  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add("dark-mode-invert");
    } else {
      root.classList.remove("dark-mode-invert");
    }
    // アクセントカラー
    if (accentColor && accentColor !== "#ff5a8a") {
      root.style.setProperty("--settings-accent", accentColor);
    } else {
      root.style.removeProperty("--settings-accent");
    }
    // 旧方式で設定されていたインライン filter があれば除去（移行対応）
    root.style.removeProperty("filter");
  }, [darkMode, accentColor]);
  const clearSelection = usePsdStore((state) => state.clearSelection);
  const selectAll = usePsdStore((state) => state.selectAll);
  const files = usePsdStore((state) => state.files);

  // グローバルドラッグ＆ドロップ（常時有効）
  useGlobalDragDrop();

  // Fキーでフォルダを開く（全タブ共通）
  useOpenFolderShortcut();

  // ファイル変更検知（外部Photoshop保存を検知）
  useFileWatcher();

  // Photoshop UXPプラグインからのハンドオフ検出
  useHandoff();

  // PSDローダーをグローバルレジストリに登録（WorkflowBar等のReact外から呼ぶため）
  const { loadFolder: psdLoadFolder, loadFiles: psdLoadFiles } = usePsdLoader();
  useEffect(() => {
    registerPsdLoader(psdLoadFolder, psdLoadFiles);
  }, [psdLoadFolder, psdLoadFiles]);

  // Ctrl+A で全選択
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "a") {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        e.preventDefault();
        if (files.length > 0) selectAll();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [files.length, selectAll]);

  // サムネ領域外クリックで複数選択を解除
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest("[data-preview-grid]")) return;
      if ((e.target as HTMLElement).closest("[data-sidebar], [data-detail-panel]")) return;
      if ((e.target as HTMLElement).closest("[data-tool-panel]")) return;
      if ((e.target as HTMLElement).closest("button, a, input, select, textarea, label")) return;
      clearSelection();
    },
    [clearSelection],
  );

  return (
    <div
      className="flex flex-col h-screen bg-bg-primary overflow-hidden"
      onMouseDown={handleMouseDown}
    >
      {/* 背景のトーンパターン */}
      <div className="fixed inset-0 bg-tone pointer-events-none" />

      {/* Top Navigation — 全画面時は非表示 */}
      {!isViewerFullscreen && <TopNav />}

      {/* Global Address Bar — 全画面時は非表示 */}
      {!isViewerFullscreen && <GlobalAddressBar />}

      {/* View Content */}
      <ErrorBoundary>
        <ViewRouter />
      </ErrorBoundary>

      {/* Guide Editor Modal */}
      {isEditorOpen && <GuideEditorModal />}

      {/* Photoshop変換完了トースト */}
      <ConversionToast />

      {/* グローバルPromptダイアログ */}
      <GlobalPromptDialog />
    </div>
  );
}

function GlobalPromptDialog() {
  const promptDialog = useViewStore((s) => s.promptDialog);
  const [value, setValue] = React.useState("");

  React.useEffect(() => {
    if (promptDialog) setValue(promptDialog.defaultValue);
  }, [promptDialog]);

  if (!promptDialog) return null;

  const handleOk = () => {
    promptDialog.resolve(value);
    useViewStore.setState({ promptDialog: null });
  };
  const handleCancel = () => {
    promptDialog.resolve(null);
    useViewStore.setState({ promptDialog: null });
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50" onClick={handleCancel}>
      <div className="bg-bg-secondary border border-border rounded-2xl p-5 shadow-xl w-[340px] space-y-3" onClick={(e) => e.stopPropagation()}>
        <p className="text-xs text-text-primary font-medium">{promptDialog.message}</p>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleOk(); if (e.key === "Escape") handleCancel(); }}
          autoFocus
          className="w-full text-xs px-3 py-2 bg-bg-primary border border-border/50 rounded-lg text-text-primary outline-none focus:border-accent/50 font-mono"
        />
        <div className="flex gap-2">
          <button onClick={handleCancel} className="flex-1 px-3 py-2 text-xs font-medium text-text-secondary bg-bg-tertiary rounded-lg hover:bg-bg-elevated transition-colors">キャンセル</button>
          <button onClick={handleOk} className="flex-1 px-3 py-2 text-xs font-medium text-white bg-accent rounded-lg hover:bg-accent/90 transition-colors">OK</button>
        </div>
      </div>
    </div>
  );
}
