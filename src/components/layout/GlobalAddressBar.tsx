import { useState, useEffect, useCallback } from "react";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { usePsdStore } from "../../store/psdStore";
import { usePsdLoader } from "../../hooks/usePsdLoader";

export function GlobalAddressBar() {
  const currentFolderPath = usePsdStore((s) => s.currentFolderPath);
  const [addressInput, setAddressInput] = useState(currentFolderPath || "");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const { loadFolder } = usePsdLoader();

  useEffect(() => {
    if (currentFolderPath) setAddressInput(currentFolderPath);
  }, [currentFolderPath]);

  const navigateTo = useCallback(async (path: string, addToHistory = true) => {
    const trimmed = path.trim().replace(/\/+$|\\+$/g, "");
    if (!trimmed) return;
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
      <input
        type="text"
        className="flex-1 min-w-0 text-[11px] px-2 py-1 bg-bg-primary border border-border/50 rounded text-text-primary outline-none focus:border-accent/50 font-mono"
        value={addressInput}
        onChange={(e) => setAddressInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") navigateTo(addressInput); }}
        placeholder="パスを入力..."
      />
      <button onClick={handleBrowseFolder} className="w-6 h-6 flex items-center justify-center text-text-muted hover:text-text-primary rounded hover:bg-bg-tertiary" title="フォルダを参照">
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
      </button>
    </div>
  );
}
