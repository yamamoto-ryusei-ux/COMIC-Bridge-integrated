import { useState, useEffect, useCallback, useRef } from "react";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { usePsdStore } from "../../store/psdStore";
import { usePsdLoader } from "../../hooks/usePsdLoader";
import { useViewStore, type AppView } from "../../store/viewStore";
import { useScanPsdStore } from "../../store/scanPsdStore";
import { useUnifiedViewerStore } from "../../store/unifiedViewerStore";

const DOT_MENU_TABS: { id: AppView; label: string }[] = [
  { id: "layers", label: "レイヤー制御" },
  // { id: "typesetting", label: "写植関連" }, // 隔離中 — 削除予定
  { id: "replace", label: "差替え" },
  { id: "compose", label: "合成" },
  { id: "tiff", label: "TIFF化" },
  { id: "scanPsd", label: "スキャナー" },
  { id: "split", label: "見開き分割" },
  { id: "rename", label: "リネーム" },
  // ProGen はサブメニューとして別途レンダリング
  { id: "unifiedViewer", label: "ビューアー" },
];

const PROGEN_MODES = [
  { id: "extraction" as const, label: "抽出プロンプト" },
  { id: "formatting" as const, label: "整形プロンプト" },
  { id: "proofreading" as const, label: "校正プロンプト" },
];

export function GlobalAddressBar() {
  const currentFolderPath = usePsdStore((s) => s.currentFolderPath);
  const [addressInput, setAddressInput] = useState(currentFolderPath || "");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const { loadFolder } = usePsdLoader();
  const setActiveView = useViewStore((s) => s.setActiveView);

  // ドットメニュー
  const [showDotMenu, setShowDotMenu] = useState(false);
  const dotMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showDotMenu) return;
    const handler = (e: MouseEvent) => {
      if (dotMenuRef.current && !dotMenuRef.current.contains(e.target as Node)) setShowDotMenu(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showDotMenu]);

  useEffect(() => {
    setAddressInput(currentFolderPath || "");
  }, [currentFolderPath]);

  const navigateTo = useCallback(async (path: string, addToHistory = true) => {
    const trimmed = path.trim().replace(/\/+$|\\+$/g, "");
    if (!trimmed) return;
    if (usePsdStore.getState().contentLocked) {
      setAddressInput(trimmed);
      return;
    }
    usePsdStore.getState().setCurrentFolderPath(trimmed);
    setAddressInput(trimmed);
    try { await loadFolder(trimmed); } catch { /* ignore */ }
    if (addToHistory) {
      setHistory((prev) => {
        const newHist = [...prev.slice(0, historyIndex + 1), trimmed];
        setHistoryIndex(newHist.length - 1);
        return newHist;
      });
    }
  }, [loadFolder, historyIndex]);

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < history.length - 1;

  const handleGoBack = useCallback(() => {
    if (!canGoBack) return;
    const newIdx = historyIndex - 1;
    setHistoryIndex(newIdx);
    navigateTo(history[newIdx], false);
  }, [canGoBack, historyIndex, history, navigateTo]);

  const handleGoForward = useCallback(() => {
    if (!canGoForward) return;
    const newIdx = historyIndex + 1;
    setHistoryIndex(newIdx);
    navigateTo(history[newIdx], false);
  }, [canGoForward, historyIndex, history, navigateTo]);

  const handleGoUp = useCallback(() => {
    if (!currentFolderPath) return;
    const parts = currentFolderPath.replace(/\//g, "\\").split("\\");
    if (parts.length <= 1) return;
    parts.pop();
    navigateTo(parts.join("\\"));
  }, [currentFolderPath, navigateTo]);

  const handleBrowseFolder = useCallback(async () => {
    const path = await dialogOpen({ directory: true, multiple: false, defaultPath: currentFolderPath || undefined });
    if (path) navigateTo(path as string);
  }, [currentFolderPath, navigateTo]);

  return (
    <div className="flex-shrink-0 border-b border-border/50 bg-bg-secondary px-2 py-1 flex items-center gap-1 z-10">
      <button onClick={handleGoBack} disabled={!canGoBack} className="w-6 h-6 flex items-center justify-center text-text-muted hover:text-text-primary disabled:opacity-20 rounded hover:bg-bg-tertiary" title="戻る">
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
      </button>
      <button onClick={handleGoForward} disabled={!canGoForward} className="w-6 h-6 flex items-center justify-center text-text-muted hover:text-text-primary disabled:opacity-20 rounded hover:bg-bg-tertiary" title="進む">
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
      </button>
      <button onClick={handleGoUp} disabled={!currentFolderPath} className="w-6 h-6 flex items-center justify-center text-text-muted hover:text-text-primary disabled:opacity-20 rounded hover:bg-bg-tertiary" title="上の階層">
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" /></svg>
      </button>
      <div className="w-px h-4 bg-border/50 mx-0.5" />
      <div className="flex-1 min-w-0 flex items-center bg-bg-primary border border-border/50 rounded focus-within:border-accent/50">
        <input
          type="text"
          className="flex-1 min-w-0 text-[11px] px-2 py-1 bg-transparent text-text-primary outline-none font-mono"
          value={addressInput}
          onChange={(e) => setAddressInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") navigateTo(addressInput); }}
          placeholder="パスを入力..."
        />
        {currentFolderPath && (
          <button
            onClick={() => {
              usePsdStore.getState().clearFiles();
              usePsdStore.getState().setCurrentFolderPath(null);
              usePsdStore.getState().setContentLocked(false);
              setAddressInput("");
              setHistory([]);
              setHistoryIndex(-1);
            }}
            className="w-5 h-5 flex items-center justify-center text-text-muted/50 hover:text-error transition-colors flex-shrink-0 mr-0.5"
            title="読み込みをクリア"
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
      <button onClick={handleBrowseFolder} className="w-6 h-6 flex items-center justify-center text-text-muted hover:text-text-primary rounded hover:bg-bg-tertiary" title="フォルダを参照">
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
      </button>
      <button
        onClick={async () => {
          if (currentFolderPath) {
            usePsdStore.getState().setContentLocked(false);
            usePsdStore.getState().setCurrentFolderPath(currentFolderPath);
            try { await loadFolder(currentFolderPath); } catch { /* ignore */ }
          }
        }}
        disabled={!currentFolderPath}
        className="w-6 h-6 flex items-center justify-center text-text-muted hover:text-text-primary disabled:opacity-20 rounded hover:bg-bg-tertiary"
        title="再読み込み"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
      </button>
      <div className="w-px h-4 bg-border/50 mx-0.5" />
      {/* ドットメニュー（ツール） */}
      <div ref={dotMenuRef} className="relative flex-shrink-0">
        <button
          onClick={() => setShowDotMenu(!showDotMenu)}
          className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${
            showDotMenu ? "text-accent bg-accent/10" : "text-text-muted hover:text-text-primary hover:bg-bg-tertiary"
          }`}
          title="ツール"
        >
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="3" cy="3" r="1.3" /><circle cx="8" cy="3" r="1.3" /><circle cx="13" cy="3" r="1.3" />
            <circle cx="3" cy="8" r="1.3" /><circle cx="8" cy="8" r="1.3" /><circle cx="13" cy="8" r="1.3" />
            <circle cx="3" cy="13" r="1.3" /><circle cx="8" cy="13" r="1.3" /><circle cx="13" cy="13" r="1.3" />
          </svg>
        </button>
        {showDotMenu && (
          <div className="absolute right-0 top-full mt-1 z-50 bg-bg-secondary border border-border rounded-lg shadow-xl py-1 min-w-[140px]">
            {DOT_MENU_TABS.map((tab) => (
              <button
                key={tab.id}
                className="w-full text-left px-3 py-1.5 text-[11px] text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
                onClick={() => { setActiveView(tab.id); setShowDotMenu(false); }}
              >
                {tab.label}
              </button>
            ))}
            {/* ProGen */}
            <div className="border-t border-border/40 my-1" />
            <div className="px-3 py-0.5 text-[9px] text-text-muted/50 font-medium">ProGen</div>
            <ProgenMenuItems onDone={() => setShowDotMenu(false)} />
          </div>
        )}
      </div>
    </div>
  );
}

// ProGenメニュー項目（常に3モード表示）
function ProgenMenuItems({ onDone }: { onDone: () => void }) {
  const scanJsonPath = useScanPsdStore((s) => s.currentJsonFilePath);
  const viewerPresets = useUnifiedViewerStore((s) => s.fontPresets);
  const viewerPresetPath = useUnifiedViewerStore((s) => s.presetJsonPath);
  const setActiveView = useViewStore((s) => s.setActiveView);
  const hasWorkJson = !!(scanJsonPath || (viewerPresets.length > 0 && viewerPresetPath));

  return (
    <>
      {PROGEN_MODES.map((mode) => (
        <button
          key={mode.id}
          className="w-full text-left px-3 py-1.5 text-[11px] text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
          onClick={() => {
            useViewStore.getState().setProgenMode(mode.id);
            setActiveView("progen");
            onDone();
          }}
        >
          {mode.label}
          {!hasWorkJson && <span className="text-[9px] text-text-muted/50 ml-1">新規</span>}
        </button>
      ))}
    </>
  );
}
