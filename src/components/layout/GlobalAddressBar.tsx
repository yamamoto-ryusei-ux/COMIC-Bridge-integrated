// @ts-nocheck
import { useState, useEffect, useCallback, useRef } from "react";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { usePsdStore } from "../../store/psdStore";
import { usePsdLoader } from "../../hooks/usePsdLoader";
import { useViewStore, type AppView } from "../../store/viewStore";
import { useScanPsdStore } from "../../store/scanPsdStore";
import { useUnifiedViewerStore } from "../../store/unifiedViewerStore";
import type { ProofreadingCheckItem } from "../../types/typesettingCheck";

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
      {/* データ読み込みボタン */}
      <DataLoadButtons />
    </div>
  );
}

// ─── データ読み込みボタン（アドレスバー内） ───
function DataLoadButtons() {
  const textLoaded = useUnifiedViewerStore((s) => s.textContent.length > 0);
  const presetsLoaded = useUnifiedViewerStore((s) => s.fontPresets.length > 0);
  const checkLoaded = useUnifiedViewerStore((s) => !!s.checkData);
  const kenbanPathA = useViewStore((s) => s.kenbanPathA);
  const kenbanPathB = useViewStore((s) => s.kenbanPathB);
  const kenbanViewMode = useViewStore((s) => s.kenbanViewMode);

  const handleOpenText = useCallback(async () => {
    const path = await dialogOpen({ filters: [{ name: "テキスト", extensions: ["txt"] }], multiple: false });
    if (!path) return;
    const bytes = await readFile(path as string);
    const content = new TextDecoder("utf-8").decode(bytes);
    const vs = useUnifiedViewerStore.getState();
    vs.setTextContent(content);
    vs.setTextFilePath(path as string);
    vs.setIsDirty(false);
  }, []);

  const handleLoadPreset = useCallback(async () => {
    const path = await dialogOpen({ filters: [{ name: "JSON", extensions: ["json"] }], multiple: false });
    if (!path) return;
    try {
      const content = await invoke<string>("read_text_file", { filePath: path as string });
      const data = JSON.parse(content);
      const presets: { font: string; name: string; subName: string }[] = [];
      const obj = data?.presetData?.presets ?? data?.presets ?? data?.presetSets ?? data;
      if (typeof obj === "object" && obj !== null) {
        const entries = Array.isArray(obj) ? [["", obj]] : Object.entries(obj);
        for (const [, arr] of entries) {
          if (!Array.isArray(arr)) continue;
          for (const p of arr as any[]) if (p?.font || p?.postScriptName)
            presets.push({ font: p.font || p.postScriptName, name: p.name || p.displayName || "", subName: p.subName || "" });
        }
      }
      if (presets.length > 0) { useUnifiedViewerStore.getState().setFontPresets(presets); useUnifiedViewerStore.getState().setPresetJsonPath(path as string); }
    } catch { /* ignore */ }
  }, []);

  const handleLoadCheck = useCallback(async () => {
    const path = await dialogOpen({ filters: [{ name: "JSON", extensions: ["json"] }], multiple: false });
    if (!path) return;
    try {
      const content = await invoke<string>("read_text_file", { filePath: path as string });
      const data = JSON.parse(content);
      const allItems: ProofreadingCheckItem[] = [];
      const parse = (src: any, fk: "correctness" | "proposal") => {
        const arr = Array.isArray(src) ? src : Array.isArray(src?.items) ? src.items : null;
        if (!arr) return;
        for (const item of arr) allItems.push({ picked: false, category: item.category || "", page: item.page || "", excerpt: item.excerpt || "", content: item.content || item.text || "", checkKind: item.checkKind || fk });
      };
      if (data.checks) { parse(data.checks.simple, "correctness"); parse(data.checks.variation, "proposal"); }
      else if (Array.isArray(data)) { parse(data, "correctness"); }
      useUnifiedViewerStore.getState().setCheckData({
        title: data.work || "", fileName: (path as string).substring((path as string).lastIndexOf("\\") + 1), filePath: path as string,
        allItems, correctnessItems: allItems.filter((i) => i.checkKind === "correctness"), proposalItems: allItems.filter((i) => i.checkKind === "proposal"),
      });
    } catch { /* ignore */ }
  }, []);

  const handleKenbanLoad = async (side: "A" | "B") => {
    const path = await dialogOpen({ directory: true, multiple: false });
    if (!path) return;
    if (kenbanViewMode === "diff" && side === "B" && useViewStore.getState().kenbanPathA) {
      try {
        const allExts = ["psd", "tif", "tiff", "jpg", "jpeg", "png", "bmp", "pdf"];
        const fA = await invoke<string[]>("kenban_list_files_in_folder", { path: useViewStore.getState().kenbanPathA, extensions: allExts });
        const fB = await invoke<string[]>("kenban_list_files_in_folder", { path: path as string, extensions: allExts });
        if (fA.length > 0 && fB.length > 0) {
          const eA = fA[0].substring(fA[0].lastIndexOf(".") + 1).toLowerCase();
          const eB = fB[0].substring(fB[0].lastIndexOf(".") + 1).toLowerCase();
          const bad: Record<string, string[]> = { pdf: ["psd"], psd: ["pdf"] };
          if (bad[eA]?.includes(eB)) { alert(`差分モードでは ${eA.toUpperCase()} と ${eB.toUpperCase()} の組み合わせは非対応です。`); return; }
        }
      } catch { /* ignore */ }
    }
    if (side === "A") useViewStore.getState().setKenbanPathA(path as string);
    else useViewStore.getState().setKenbanPathB(path as string);
    const vs = useViewStore.getState();
    if (vs.kenbanPathA && vs.kenbanPathB) vs.setActiveView("unifiedViewer");
  };

  const Btn = ({ loaded, label, title, clearTitle, cCls, bCls, onLoad, onClear }: any) => (
    <div className="flex items-center gap-0">
      <button onClick={onLoad} className="px-1.5 py-0.5 text-[9px] text-text-secondary hover:text-text-primary hover:bg-bg-tertiary rounded-l transition-colors" title={title}>{label}</button>
      {loaded ? (
        <button onClick={onClear} className={`w-3.5 h-3.5 flex items-center justify-center rounded-r transition-colors ${cCls}`} title={clearTitle}>
          <svg className="w-2 h-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      ) : <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mr-0.5 border ${bCls}`} />}
    </div>
  );

  return (
    <div className="flex items-center gap-0.5 flex-shrink-0">
      <Btn loaded={textLoaded} label="テキスト" title="テキスト読み込み" clearTitle="クリア" cCls="text-accent-tertiary hover:bg-accent-tertiary/15" bCls="border-accent-tertiary/50" onLoad={handleOpenText} onClear={() => { const v = useUnifiedViewerStore.getState(); v.setTextContent(""); v.setTextFilePath(null); v.setTextHeader([]); v.setTextPages([]); v.setIsDirty(false); }} />
      <Btn loaded={presetsLoaded} label="作品情報" title="作品情報JSON" clearTitle="クリア" cCls="text-accent-secondary hover:bg-accent-secondary/15" bCls="border-accent-secondary/50" onLoad={() => useViewStore.getState().setJsonBrowserMode("preset")} onClear={() => { useUnifiedViewerStore.getState().setFontPresets([]); useUnifiedViewerStore.getState().setPresetJsonPath(null); }} />
      <Btn loaded={checkLoaded} label="校正JSON" title="校正JSON" clearTitle="クリア" cCls="text-warning hover:bg-warning/15" bCls="border-warning/50" onLoad={() => useViewStore.getState().setJsonBrowserMode("check")} onClear={() => useUnifiedViewerStore.getState().setCheckData(null)} />
      <div className="w-px h-3 bg-border/30 mx-0.5" />
      <button onClick={() => useViewStore.getState().setKenbanViewMode(kenbanViewMode === "diff" ? "parallel" : "diff")} className={`px-1 py-0.5 text-[8px] font-bold rounded transition-colors ${kenbanViewMode === "diff" ? "bg-accent/15 text-accent" : "bg-accent-secondary/15 text-accent-secondary"}`} title="差分/分割切替">{kenbanViewMode === "diff" ? "差分" : "分割"}</button>
      <Btn loaded={!!kenbanPathA} label="検A" title="検A選択" clearTitle="クリア" cCls="text-blue-500 hover:bg-blue-500/15" bCls="border-blue-500/50" onLoad={() => handleKenbanLoad("A")} onClear={() => useViewStore.getState().setKenbanPathA(null)} />
      <Btn loaded={!!kenbanPathB} label="検B" title="検B選択" clearTitle="クリア" cCls="text-orange-500 hover:bg-orange-500/15" bCls="border-orange-500/50" onLoad={() => handleKenbanLoad("B")} onClear={() => useViewStore.getState().setKenbanPathB(null)} />
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
