import { useCallback, useEffect } from "react";
import { TopNav } from "./TopNav";
import { ViewRouter } from "./ViewRouter";
import { GuideEditorModal } from "../guide-editor/GuideEditorModal";
import { ErrorBoundary } from "../ErrorBoundary";

import { ConversionToast } from "../spec-checker/ConversionToast";
import { usePsdStore } from "../../store/psdStore";
import { useGuideStore } from "../../store/guideStore";
import { useGlobalDragDrop } from "../../hooks/useGlobalDragDrop";
import { useOpenFolderShortcut } from "../../hooks/useOpenFolder";
import { useFileWatcher } from "../../hooks/useFileWatcher";
import { useHandoff } from "../../hooks/useHandoff";

export function AppLayout() {
  const isEditorOpen = useGuideStore((state) => state.isEditorOpen);
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

      {/* Top Navigation */}
      <TopNav />

      {/* View Content */}
      <ErrorBoundary>
        <ViewRouter />
      </ErrorBoundary>

      {/* Guide Editor Modal */}
      {isEditorOpen && <GuideEditorModal />}

      {/* Photoshop変換完了トースト */}
      <ConversionToast />
    </div>
  );
}
