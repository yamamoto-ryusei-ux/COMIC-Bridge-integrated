// @ts-nocheck
import { useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useViewStore } from "../../store/viewStore";
import { usePsdStore } from "../../store/psdStore";
import { useSpecStore } from "../../store/specStore";
import { useAppUpdater } from "../../hooks/useAppUpdater";
import { useUnifiedViewerStore, type FontPresetEntry } from "../../store/unifiedViewerStore";
import { useScanPsdStore } from "../../store/scanPsdStore";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import type { ProofreadingCheckItem } from "../../types/typesettingCheck";
import { JsonFileBrowser } from "../scanPsd/JsonFileBrowser";
import { CheckJsonBrowser } from "../unified-viewer/UnifiedViewer";
import { WorkflowBar } from "./WorkflowBar";

// @ts-ignore: View tabs moved to SpecCheckView dot menu
const _unused = [
  {
    id: "specCheck",
    label: "完成原稿チェック",
    icon: (
      <svg
        className="w-4 h-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
  },
  {
    id: "layers",
    label: "レイヤー制御",
    icon: (
      <svg
        className="w-4 h-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
        />
      </svg>
    ),
  },
  {
    id: "typesetting",
    label: "写植関連",
    icon: (
      <svg
        className="w-4 h-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
        />
      </svg>
    ),
  },
  {
    id: "replace",
    label: "差替え",
    icon: (
      <svg
        className="w-4 h-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M8 7h12m0 0l-4-4m4 4l-4 4M16 17H4m0 0l4-4m-4 4l4 4"
        />
      </svg>
    ),
  },
  {
    id: "compose",
    label: "合成",
    icon: (
      <svg
        className="w-4 h-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zm-5 9l3 3m0 0l3-3m-3 3V10"
        />
      </svg>
    ),
  },
  {
    id: "tiff",
    label: "TIFF化",
    icon: (
      <svg
        className="w-4 h-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
        />
      </svg>
    ),
  },
  {
    id: "scanPsd",
    label: "スキャナー",
    icon: (
      <svg
        className="w-4 h-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
        />
      </svg>
    ),
  },
  {
    id: "split",
    label: "見開き分割",
    icon: (
      <svg
        className="w-4 h-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <circle cx="6" cy="6" r="3" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.12 8.12L12 12" />
        <circle cx="18" cy="6" r="3" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.88 8.12L12 12" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 12l-5 8M12 12l5 8" />
      </svg>
    ),
  },
  {
    id: "rename",
    label: "リネーム",
    icon: (
      <svg
        className="w-4 h-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
        />
      </svg>
    ),
  },
  {
    id: "kenban",
    label: "検版",
    icon: (
      <svg
        className="w-4 h-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
        />
      </svg>
    ),
  },
  {
    id: "progen",
    label: "ProGen",
    icon: (
      <svg
        className="w-4 h-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      </svg>
    ),
  },
  {
    id: "unifiedViewer",
    label: "ビューアー",
    icon: (
      <svg
        className="w-4 h-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
        />
      </svg>
    ),
  },
];

export function TopNav() {
  const setActiveView = useViewStore((s) => s.setActiveView);
  const files = usePsdStore((s) => s.files);
  const checkResults = useSpecStore((s) => s.checkResults);
  const updater = useAppUpdater();
  const viewerStore = useUnifiedViewerStore();
  const jsonFolderPath = useScanPsdStore((s) => s.jsonFolderPath);
  const jsonBrowserMode = useViewStore((s) => s.jsonBrowserMode);
  const setJsonBrowserMode = useViewStore((s) => s.setJsonBrowserMode);

  const passedCount = Array.from(checkResults.values()).filter((r) => r.passed).length;
  const failedCount = Array.from(checkResults.values()).filter((r) => !r.passed).length;

  // Open text file (with COMIC-POT parsing) — GlobalAddressBarに移動済み
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _handleOpenText = useCallback(async () => {
    const path = await dialogOpen({ filters: [{ name: "テキスト", extensions: ["txt"] }], multiple: false });
    if (!path) return;
    try {
      const bytes = await readFile(path as string);
      const content = new TextDecoder("utf-8").decode(bytes);
      viewerStore.setTextContent(content);
      viewerStore.setTextFilePath(path as string);
      viewerStore.setIsDirty(false);
      // Parse COMIC-POT format
      const lines = content.split(/\r?\n/);
      const header: string[] = [];
      const pages: { pageNumber: number; blocks: { id: string; originalIndex: number; lines: string[]; }[] }[] = [];
      let curPage: typeof pages[0] | null = null;
      let blockLines: string[] = [];
      let blockIdx = 0;
      const pageRe = /^<<(\d+)Page>>$/;
      const flush = () => {
        if (blockLines.length > 0 && curPage) {
          curPage.blocks.push({ id: `p${curPage.pageNumber}-b${blockIdx}`, originalIndex: blockIdx, lines: [...blockLines] });
          blockIdx++;
          blockLines = [];
        }
      };
      for (const line of lines) {
        const m = line.match(pageRe);
        if (m) { flush(); blockIdx = 0; blockLines = []; curPage = { pageNumber: parseInt(m[1], 10), blocks: [] }; pages.push(curPage); }
        else if (curPage) { if (line.trim() === "") flush(); else blockLines.push(line); }
        else header.push(line);
      }
      flush();
      viewerStore.setTextHeader(header);
      viewerStore.setTextPages(pages);
    } catch { /* ignore */ }
  }, []);

  // JSON file selection handler
  const handleJsonSelect = useCallback(async (filePath: string) => {
    try {
      const content = await invoke<string>("read_text_file", { filePath });
      const data = JSON.parse(content);
      if (jsonBrowserMode === "check") {
        const allItems: ProofreadingCheckItem[] = [];
        const parse = (src: any, fallbackKind: "correctness" | "proposal") => {
          const arr = Array.isArray(src) ? src : Array.isArray(src?.items) ? src.items : null;
          if (!arr) return;
          for (const item of arr)
            allItems.push({ picked: false, category: item.category || "", page: item.page || "", excerpt: item.excerpt || "", content: item.content || item.text || "", checkKind: item.checkKind || fallbackKind });
        };
        if (data.checks) { parse(data.checks.simple, "correctness"); parse(data.checks.variation, "proposal"); }
        else if (Array.isArray(data)) { parse(data, "correctness"); }
        viewerStore.setCheckData({
          title: data.work || "", fileName: filePath.substring(filePath.lastIndexOf("\\") + 1), filePath,
          allItems, correctnessItems: allItems.filter((i) => i.checkKind === "correctness"), proposalItems: allItems.filter((i) => i.checkKind === "proposal"),
        });
      } else {
        const presets: FontPresetEntry[] = [];
        const presetsObj = data?.presetData?.presets ?? data?.presets ?? data?.presetSets ?? data;
        if (typeof presetsObj === "object" && presetsObj !== null) {
          const entries = Array.isArray(presetsObj) ? [["", presetsObj]] : Object.entries(presetsObj);
          for (const [, arr] of entries) {
            if (!Array.isArray(arr)) continue;
            for (const p of arr as any[])
              if (p?.font || p?.postScriptName)
                presets.push({ font: p.font || p.postScriptName, name: p.name || p.displayName || "", subName: p.subName || "" });
          }
        }
        if (presets.length > 0) { viewerStore.setFontPresets(presets); viewerStore.setPresetJsonPath(filePath); }
      }
    } catch { /* ignore */ }
    setJsonBrowserMode(null);
  }, [jsonBrowserMode]);

  return (
    <nav
      className="h-14 flex-shrink-0 bg-bg-secondary border-b border-border flex items-center px-3 gap-2 relative z-20 shadow-soft"
      data-tauri-drag-region
    >
      {/* Logo */}
      <button
        className="flex items-center gap-2 mr-1 flex-shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
        onClick={() => {
          usePsdStore.getState().clearFiles();
          usePsdStore.getState().setCurrentFolderPath(null);
          usePsdStore.getState().setContentLocked(false);
          setActiveView("specCheck");
        }}
        title="リセット"
      >
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-accent to-accent-secondary flex items-center justify-center shadow-sm">
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
        </div>
      </button>

      <div className="w-px h-8 bg-border flex-shrink-0" />

      {/* Workflow */}
      <WorkflowBar />

      <div className="flex-1" />

      {/* ホーム + ビューアー + ツール（中央配置） */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          className="px-3 py-1 text-[11px] font-medium text-text-secondary hover:text-text-primary hover:bg-bg-tertiary rounded transition-colors"
          onClick={() => setActiveView("specCheck")}
          title="ホーム（リセットなし）"
        >
          ホーム
        </button>
        <button
          className="px-3 py-1 text-[11px] font-medium text-text-secondary hover:text-text-primary hover:bg-bg-tertiary rounded transition-colors"
          onClick={() => setActiveView("unifiedViewer")}
          title="ビューアー"
        >
          ビューアー
        </button>
        <TopNavToolMenu />
      </div>

      <div className="flex-1" />

      {/* Right: Status + ツールボタン */}
      {files.length > 0 && (
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-text-muted">{files.length} ファイル</span>
          {checkResults.size > 0 && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-bg-tertiary">
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-success" />
                <span className="text-xs font-medium text-success">{passedCount}</span>
              </div>
              <span className="w-px h-3 bg-border" />
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-error" />
                <span className="text-xs font-medium text-error">{failedCount}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Version + Update */}
      <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
        {updater.appVersion && (
          <span className="text-[10px] text-text-muted/60 font-mono">v{updater.appVersion}</span>
        )}
        {updater.phase === "available" ? (
          <button
            onClick={() => updater.downloadAndInstall()}
            className="relative flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-accent-tertiary bg-accent-tertiary/10 rounded-lg hover:bg-accent-tertiary/20 transition-colors"
          >
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-accent-tertiary animate-pulse" />
            v{updater.updateInfo?.version}
          </button>
        ) : updater.phase === "checking" ? (
          <svg
            className="w-3.5 h-3.5 text-text-muted animate-spin"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        ) : updater.phase === "up-to-date" ? (
          <span className="text-[10px] text-accent-tertiary">
            <svg
              className="w-3 h-3 inline"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={3}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </span>
        ) : null}
      </div>

      {/* Update Prompt Dialog (shown on startup when update available) */}
      {updater.showPrompt &&
        updater.updateInfo &&
        createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-bg-secondary border border-border rounded-2xl p-8 shadow-xl max-w-sm text-center space-y-4">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-accent to-accent-secondary flex items-center justify-center shadow-lg">
                <svg
                  className="w-7 h-7 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-bold text-text-primary">アップデートがあります</h3>
                <p className="text-xs text-text-muted mt-1">
                  v{updater.appVersion} →{" "}
                  <span className="text-accent-tertiary font-semibold">
                    v{updater.updateInfo.version}
                  </span>
                </p>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => updater.dismissPrompt()}
                  className="flex-1 px-4 py-2.5 text-xs font-medium text-text-secondary bg-bg-tertiary rounded-xl hover:bg-bg-tertiary/80 transition-colors"
                >
                  あとで
                </button>
                <button
                  onClick={() => {
                    updater.dismissPrompt();
                    updater.downloadAndInstall();
                  }}
                  className="flex-1 px-4 py-2.5 text-xs font-medium text-white bg-gradient-to-r from-accent to-accent-secondary rounded-xl hover:-translate-y-0.5 transition-all shadow-sm"
                >
                  アップデートする
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* Update Dialog (downloading / ready / error) */}
      {(updater.phase === "downloading" ||
        updater.phase === "ready" ||
        updater.phase === "error") &&
        createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-bg-secondary border border-border rounded-2xl p-8 shadow-xl max-w-sm text-center space-y-4">
              {updater.phase === "downloading" && (
                <>
                  <svg
                    className="w-12 h-12 mx-auto text-accent animate-spin"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                  <h3 className="text-base font-bold text-text-primary">アップデート中...</h3>
                  <p className="text-xs text-text-muted">
                    ダウンロードしています。しばらくお待ちください。
                  </p>
                </>
              )}
              {updater.phase === "ready" && (
                <>
                  <svg
                    className="w-12 h-12 mx-auto text-success"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <h3 className="text-base font-bold text-text-primary">インストール完了</h3>
                  <p className="text-xs text-text-muted">アプリを再起動します...</p>
                </>
              )}
              {updater.phase === "error" && (
                <>
                  <svg
                    className="w-12 h-12 mx-auto text-error"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                  <h3 className="text-base font-bold text-text-primary">アップデート失敗</h3>
                  <p className="text-xs text-text-muted">{updater.error}</p>
                  <button
                    onClick={updater.dismiss}
                    className="px-4 py-2 text-xs font-medium text-white bg-gradient-to-r from-accent to-accent-secondary rounded-xl hover:-translate-y-0.5 transition-all"
                  >
                    閉じる
                  </button>
                </>
              )}
            </div>
          </div>,
          document.body,
        )}
      {/* JSON File Browser Modal */}
      {jsonBrowserMode &&
        createPortal(
          <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/40" onMouseDown={(e) => { if (e.target === e.currentTarget) setJsonBrowserMode(null); }}>
            <div className="bg-bg-secondary rounded-xl shadow-2xl w-[500px] max-h-[70vh] flex flex-col overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-4 py-2 border-b border-border">
                <h3 className="text-sm font-medium">{jsonBrowserMode === "preset" ? "作品情報JSON" : "校正データJSON"} を選択</h3>
                <button onClick={() => setJsonBrowserMode(null)} className="text-text-muted hover:text-text-primary">✕</button>
              </div>
              <div className="flex-1 overflow-auto">
                {jsonBrowserMode === "preset" && jsonFolderPath ? (
                  <JsonFileBrowser basePath={jsonFolderPath} onSelect={handleJsonSelect} onCancel={() => setJsonBrowserMode(null)} mode="open" />
                ) : jsonBrowserMode === "check" ? (
                  <CheckJsonBrowser onSelect={handleJsonSelect} onCancel={() => setJsonBrowserMode(null)} />
                ) : (
                  <div className="p-4 text-center text-text-muted text-xs">JSONフォルダパスが設定されていません</div>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </nav>
  );
}

// ─── Data Load Button with Clear (×) ───
function DataLoadButton({ loaded, label, loadTitle, clearTitle, colorClass, borderClass, onLoad, onClear }: {
  loaded: boolean;
  label: string;
  loadTitle: string;
  clearTitle: string;
  colorClass: string;   // e.g. "text-accent-tertiary hover:bg-accent-tertiary/15"
  borderClass: string;  // e.g. "border-accent-tertiary/50"
  onLoad: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center gap-0">
      <button
        onClick={onLoad}
        className="px-2 py-0.5 text-[10px] text-text-secondary hover:text-text-primary hover:bg-bg-tertiary rounded-l transition-colors"
        title={loadTitle}
      >
        {label}
      </button>
      {loaded ? (
        <button
          onClick={onClear}
          className={`w-4 h-4 flex items-center justify-center rounded-r transition-colors ${colorClass}`}
          title={clearTitle}
        >
          <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      ) : (
        <span className={`w-2 h-2 rounded-full flex-shrink-0 mr-1 border ${borderClass}`} />
      )}
    </div>
  );
}

// ─── 差分/分割スイッチ + 検A / 検B ボタン ───

// 差分モードでの非対応組み合わせチェック
const DIFF_INCOMPATIBLE: Record<string, string[]> = {
  // A側の拡張子 → B側で非対応の拡張子
  pdf: ["psd"],
  psd: ["pdf"],
};

function getMainExt(path: string): string {
  const name = path.replace(/\\/g, "/").split("/").pop() || "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.substring(dot + 1).toLowerCase() : "";
}

function KenbanLoadButtons() {
  const kenbanPathA = useViewStore((s) => s.kenbanPathA);
  const kenbanPathB = useViewStore((s) => s.kenbanPathB);
  const kenbanViewMode = useViewStore((s) => s.kenbanViewMode);

  const handleLoad = async (side: "A" | "B") => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { invoke } = await import("@tauri-apps/api/core");
    const path = await open({ directory: true, multiple: false });
    if (!path) return;

    // 差分モードの場合: A側のファイル形式チェック→B側の互換性確認
    if (kenbanViewMode === "diff" && side === "B" && useViewStore.getState().kenbanPathA) {
      try {
        const allExts = ["psd", "tif", "tiff", "jpg", "jpeg", "png", "bmp", "pdf"];
        const pathA = useViewStore.getState().kenbanPathA!;
        const filesA = await invoke<string[]>("kenban_list_files_in_folder", { path: pathA, extensions: allExts });
        const filesB = await invoke<string[]>("kenban_list_files_in_folder", { path: path as string, extensions: allExts });
        if (filesA.length > 0 && filesB.length > 0) {
          const extA = getMainExt(filesA[0]);
          const extB = getMainExt(filesB[0]);
          const blocked = DIFF_INCOMPATIBLE[extA];
          if (blocked && blocked.includes(extB)) {
            alert(`差分モードでは ${extA.toUpperCase()} と ${extB.toUpperCase()} の組み合わせは非対応です。\n同じ形式のフォルダを選択するか、分割ビューアーを使用してください。`);
            return;
          }
        }
      } catch { /* ignore */ }
    }

    if (side === "A") {
      useViewStore.getState().setKenbanPathA(path as string);
    } else {
      useViewStore.getState().setKenbanPathB(path as string);
    }
    const vs = useViewStore.getState();
    if (vs.kenbanPathA && vs.kenbanPathB) {
      vs.setActiveView("unifiedViewer");
    }
  };

  const handleClear = (side: "A" | "B") => {
    if (side === "A") useViewStore.getState().setKenbanPathA(null);
    else useViewStore.getState().setKenbanPathB(null);
  };

  const toggleMode = () => {
    const next = kenbanViewMode === "diff" ? "parallel" : "diff";
    useViewStore.getState().setKenbanViewMode(next);
  };

  return (
    <>
      {/* 差分/分割スイッチ */}
      <button
        onClick={toggleMode}
        className={`px-1.5 py-0.5 text-[9px] font-bold rounded transition-colors ${
          kenbanViewMode === "diff"
            ? "bg-accent/15 text-accent"
            : "bg-accent-secondary/15 text-accent-secondary"
        }`}
        title={kenbanViewMode === "diff" ? "差分モード（クリックで分割に切替）" : "分割モード（クリックで差分に切替）"}
      >
        {kenbanViewMode === "diff" ? "差分" : "分割"}
      </button>
      <DataLoadButton
        loaded={!!kenbanPathA}
        label="検A"
        loadTitle="検版A（変更前）フォルダを選択"
        clearTitle="検Aをクリア"
        colorClass="text-blue-500 hover:bg-blue-500/15"
        borderClass="border-blue-500/50"
        onLoad={() => handleLoad("A")}
        onClear={() => handleClear("A")}
      />
      <DataLoadButton
        loaded={!!kenbanPathB}
        label="検B"
        loadTitle="検版B（変更後）フォルダを選択"
        clearTitle="検Bをクリア"
        colorClass="text-orange-500 hover:bg-orange-500/15"
        borderClass="border-orange-500/50"
        onLoad={() => handleLoad("B")}
        onClear={() => handleClear("B")}
      />
    </>
  );
}

// ─── ツールメニュー（ドットメニュー） ───
const TOOL_MENU_TABS: { id: any; label: string }[] = [
  { id: "layers", label: "レイヤー制御" },
  { id: "replace", label: "差替え" },
  { id: "compose", label: "合成" },
  { id: "tiff", label: "TIFF化" },
  { id: "scanPsd", label: "スキャナー" },
  { id: "split", label: "見開き分割" },
  { id: "rename", label: "リネーム" },
  { id: "unifiedViewer", label: "ビューアー" },
];

const TOOL_PROGEN_MODES = [
  { id: "extraction" as const, label: "抽出プロンプト" },
  { id: "formatting" as const, label: "整形プロンプト" },
  { id: "proofreading" as const, label: "校正プロンプト" },
];

function TopNavToolMenu() {
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const setActiveView = useViewStore((s) => s.setActiveView);
  const scanJsonPath = useScanPsdStore((s) => s.currentJsonFilePath);
  const viewerPresets = useUnifiedViewerStore((s) => s.fontPresets);
  const viewerPresetPath = useUnifiedViewerStore((s) => s.presetJsonPath);
  const hasWorkJson = !!(scanJsonPath || (viewerPresets.length > 0 && viewerPresetPath));

  useEffect(() => {
    if (!show) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setShow(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [show]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setShow(!show)}
        className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${show ? "text-accent bg-accent/10" : "text-text-muted hover:text-text-primary hover:bg-bg-tertiary"}`}
        title="ツール"
      >
        <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="3" cy="3" r="1.3" /><circle cx="8" cy="3" r="1.3" /><circle cx="13" cy="3" r="1.3" />
          <circle cx="3" cy="8" r="1.3" /><circle cx="8" cy="8" r="1.3" /><circle cx="13" cy="8" r="1.3" />
          <circle cx="3" cy="13" r="1.3" /><circle cx="8" cy="13" r="1.3" /><circle cx="13" cy="13" r="1.3" />
        </svg>
      </button>
      {show && (
        <div className="absolute left-0 top-full mt-1 z-50 bg-bg-secondary border border-border rounded-lg shadow-xl py-1 min-w-[140px]">
          {TOOL_MENU_TABS.map((tab) => (
            <button key={tab.id} className="w-full text-left px-3 py-1.5 text-[11px] text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors" onClick={() => { setActiveView(tab.id); setShow(false); }}>
              {tab.label}
            </button>
          ))}
          <div className="border-t border-border/40 my-1" />
          <div className="px-3 py-0.5 text-[9px] text-text-muted/50 font-medium">ProGen</div>
          {TOOL_PROGEN_MODES.map((mode) => (
            <button key={mode.id} className="w-full text-left px-3 py-1.5 text-[11px] text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors" onClick={() => { useViewStore.getState().setProgenMode(mode.id); setActiveView("progen"); setShow(false); }}>
              {mode.label}
              {!hasWorkJson && <span className="text-[9px] text-text-muted/50 ml-1">新規</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
