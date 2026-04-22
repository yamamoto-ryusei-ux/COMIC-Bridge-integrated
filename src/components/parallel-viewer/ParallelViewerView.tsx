/**
 * 並列ビューアー（KENBANから移植、Tailwind/Zustandネイティブ版）
 *
 * 元: src/components/kenban/KenbanParallelViewer.tsx (1,318行)
 * - 左右2パネル独立ファイル管理
 * - 同期/非同期スクロールモード（同期時: 両パネル同時 / 非同期時: アクティブパネルのみ）
 * - PDF見開き分割対応
 */
import { useEffect, useCallback, useRef } from "react";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useParallelStore } from "../../store/parallelStore";
import { useViewStore } from "../../store/viewStore";

interface Props {
  externalPathA?: string | null;
  externalPathB?: string | null;
}

export function ParallelViewerView({ externalPathA, externalPathB }: Props = {}) {
  const store = useParallelStore();
  const isFullscreen = useViewStore((s) => s.isViewerFullscreen);
  // Escape で全画面解除
  useEffect(() => {
    if (!isFullscreen) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") useViewStore.getState().setViewerFullscreen(false); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [isFullscreen]);

  // ── 外部パス同期 ──
  // フォルダパスはA/B片方だけでも常に登録（UI表示・共有維持）。
  // ファイル実読み込みは A/B 両方が揃った時のみ実行（片方だけの場合は待機）。
  useEffect(() => {
    // パス登録のみ（ファイル読み込みなし）
    if (externalPathA !== undefined && externalPathA !== store.A.folder) {
      store.setFolder("A", externalPathA ?? null);
    }
    if (externalPathB !== undefined && externalPathB !== store.B.folder) {
      store.setFolder("B", externalPathB ?? null);
    }
    // 両方揃っていれば実読み込み
    if (externalPathA && externalPathB) {
      if (externalPathA !== store.A.folder || store.A.files.length === 0) {
        store.loadFolderSide("A", externalPathA);
      }
      if (externalPathB !== store.B.folder || store.B.files.length === 0) {
        store.loadFolderSide("B", externalPathB);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalPathA, externalPathB]);

  // ── キーボードショートカット ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      if (e.key === "ArrowLeft") {
        if (!store.syncMode) {
          e.preventDefault();
          store.setActivePanel("A");
        }
      } else if (e.key === "ArrowRight") {
        if (!store.syncMode) {
          e.preventDefault();
          store.setActivePanel("B");
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        store.syncedSetIndex(-1);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        store.syncedSetIndex(1);
      } else if (e.key === "s" || e.key === "S") {
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          store.setSyncMode(!store.syncMode);
        }
      } else if (e.key === "p" || e.key === "P") {
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          const active = store.activePanel;
          const panel = store[active];
          const file = panel.files[panel.index];
          if (file?.filePath) {
            invoke("kenban_open_file_in_photoshop", { path: file.filePath }).catch(console.error);
          }
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [store]);

  // ── フォルダ/ファイル選択（TopNavのkenbanPathA/Bにも書き戻し）──
  // - viewStore へは常に同期（他ビューとの共有を維持）
  // - local store の folder パスも常に登録（片方だけでも選択事実を保持）
  // - 実ファイル読み込みは A/B 両方揃ったときのみ実行
  const handleSelectFolder = useCallback(async (side: "A" | "B") => {
    const path = await dialogOpen({ directory: true, multiple: false });
    if (path && typeof path === "string") {
      const vs = useViewStore.getState();
      if (side === "A") vs.setKenbanPathA(path);
      else vs.setKenbanPathB(path);
      // local store にも folder パスを即登録（UIで待機状態が見える）
      store.setFolder(side, path);
      // 両方揃ったら実読み込み
      const nextA = side === "A" ? path : vs.kenbanPathA;
      const nextB = side === "B" ? path : vs.kenbanPathB;
      if (nextA && nextB) {
        if (nextA !== store.A.folder || store.A.files.length === 0) await store.loadFolderSide("A", nextA);
        if (nextB !== store.B.folder || store.B.files.length === 0) await store.loadFolderSide("B", nextB);
      }
    }
  }, [store]);

  const handleSelectFile = useCallback(async (side: "A" | "B") => {
    const path = await dialogOpen({
      multiple: false,
      filters: [{ name: "対応ファイル", extensions: ["pdf", "psd", "psb", "tif", "tiff", "jpg", "jpeg", "png", "bmp"] }],
    });
    if (path && typeof path === "string") {
      const vs = useViewStore.getState();
      if (side === "A") vs.setKenbanPathA(path);
      else vs.setKenbanPathB(path);
      store.setFolder(side, path);
      const nextA = side === "A" ? path : vs.kenbanPathA;
      const nextB = side === "B" ? path : vs.kenbanPathB;
      if (nextA && nextB) {
        if (nextA !== store.A.folder || store.A.files.length === 0) await store.loadFolderSide("A", nextA);
        if (nextB !== store.B.folder || store.B.files.length === 0) await store.loadFolderSide("B", nextB);
      }
    }
  }, [store]);

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-bg-primary">
      {/* ════ ヘッダー ════ */}
      {!isFullscreen && (
        <div className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-border bg-bg-secondary">
          <span className="text-[10px] text-text-secondary font-medium">並列ビュー</span>
          <div className="w-px h-5 bg-border mx-1" />
          <div className="flex items-center gap-1">
            <button
              onClick={() => store.setSyncMode(!store.syncMode)}
              className={`px-2 py-1 text-[9px] rounded transition-colors ${store.syncMode ? "bg-accent/15 text-accent" : "bg-bg-tertiary text-text-muted hover:text-text-primary"}`}
              title="S: 同期モード切替"
            >
              {store.syncMode ? "同期" : "独立"}
            </button>
            {!store.syncMode && (
              <span className="text-[9px] text-text-muted">アクティブ: {store.activePanel}</span>
            )}
          </div>
          <div className="flex-1" />
          <button
            onClick={() => useViewStore.getState().setViewerFullscreen(!isFullscreen)}
            className="px-2 py-1 text-[10px] text-text-secondary hover:text-text-primary transition-colors"
          >全画面</button>
        </div>
      )}

      {/* ════ 2パネル並列 ════ */}
      <div className="flex-1 flex overflow-hidden">
        <PanelView side="A" onSelectFolder={() => handleSelectFolder("A")} onSelectFile={() => handleSelectFile("A")} />
        <div className="w-px bg-border flex-shrink-0" />
        <PanelView side="B" onSelectFolder={() => handleSelectFolder("B")} onSelectFile={() => handleSelectFile("B")} />
      </div>

      {/* ════ ステータスバー ════ */}
      <div className="flex-shrink-0 px-3 py-1 border-t border-border bg-bg-secondary text-[9px] text-text-muted flex items-center gap-3">
        <span>A: {store.A.files.length > 0 ? `${store.A.index + 1}/${store.A.files.length}` : "-"}</span>
        <span>B: {store.B.files.length > 0 ? `${store.B.index + 1}/${store.B.files.length}` : "-"}</span>
        <div className="flex-1" />
        <span>↑↓: ページ / S: 同期切替 {!store.syncMode ? "/ ←→: パネル切替" : ""}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// PanelView (single side)
// ─────────────────────────────────────────────────────

interface PanelProps {
  side: "A" | "B";
  onSelectFolder: () => void;
  onSelectFile: () => void;
}

function PanelView({ side, onSelectFolder, onSelectFile }: PanelProps) {
  const store = useParallelStore();
  const panel = store[side];
  const file = panel.files[panel.index];
  const dragStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const isActive = store.activePanel === side;
  const dimWhenInactive = !store.syncMode && !isActive;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (!store.syncMode) store.setActivePanel(side);
    dragStartRef.current = { x: e.clientX, y: e.clientY, panX: panel.panX, panY: panel.panY };
  }, [store, side, panel.panX, panel.panY]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    store.setPan(side, dragStartRef.current.panX + dx, dragStartRef.current.panY + dy);
  }, [store, side]);

  const handleMouseUp = useCallback(() => {
    dragStartRef.current = null;
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey) {
      e.preventDefault();
      if (e.deltaY < 0) store.zoomIn(side);
      else store.zoomOut(side);
    }
  }, [store, side]);

  const handleExpandPdf = useCallback(async () => {
    if (!file?.filePath) return;
    await store.expandPdfPages(side, file.filePath);
  }, [store, side, file]);

  const handleOpenInPhotoshop = useCallback(async () => {
    if (!file?.filePath) return;
    try {
      await invoke("kenban_open_file_in_photoshop", { path: file.filePath });
    } catch (e) {
      console.error("Photoshop open error:", e);
    }
  }, [file]);

  const sideColor = side === "A" ? "text-blue-400" : "text-orange-400";

  return (
    <div className={`flex-1 flex flex-col overflow-hidden ${dimWhenInactive ? "opacity-50" : ""} ${isActive && !store.syncMode ? "ring-1 ring-accent/40" : ""}`}>
      {/* パネルツールバー */}
      <div className="flex-shrink-0 flex items-center gap-1 px-2 py-1 border-b border-border/50 bg-bg-secondary/50">
        <span className={`text-[10px] font-medium ${sideColor}`}>{side}</span>

        <button onClick={onSelectFolder} className="px-1.5 py-0.5 text-[9px] text-text-muted hover:text-text-primary bg-bg-tertiary rounded transition-colors" title="フォルダ選択">📁</button>
        <button onClick={onSelectFile} className="px-1.5 py-0.5 text-[9px] text-text-muted hover:text-text-primary bg-bg-tertiary rounded transition-colors" title="ファイル選択">📄</button>

        <div className="w-px h-4 bg-border mx-0.5" />

        {file && (
          <span className="text-[9px] text-text-muted truncate flex-1" title={file.name}>
            {file.name}
          </span>
        )}

        {!file && panel.folder && (
          <span
            className="text-[9px] text-text-muted/80 truncate flex-1"
            title={`${panel.folder}（もう片方のフォルダ登録待ち — 両方揃うと読み込み開始）`}
          >
            📂 {(panel.folder.replace(/\\/g, "/").split("/").pop() || panel.folder)}
            <span className="ml-1 text-[8px] text-warning">待機中</span>
          </span>
        )}

        {!file && !panel.folder && (
          <span className="text-[9px] text-text-muted/60 flex-1">未選択</span>
        )}

        {file?.isPdf && (
          <button
            onClick={handleExpandPdf}
            className="px-1.5 py-0.5 text-[9px] text-text-muted hover:text-text-primary bg-bg-tertiary rounded transition-colors"
            title="PDFを単ページ化"
          >
            単ページ化
          </button>
        )}

        {file && (
          <button
            onClick={handleOpenInPhotoshop}
            className="px-1.5 py-0.5 text-[9px] text-text-muted hover:text-text-primary bg-bg-tertiary rounded transition-colors"
            title="Photoshopで開く (P)"
          >
            Ps
          </button>
        )}

        <button
          onClick={() => store.setIndex(side, Math.max(0, panel.index - 1))}
          disabled={panel.index === 0}
          className="px-1.5 py-0.5 text-[9px] text-text-muted hover:text-text-primary disabled:opacity-30 transition-colors"
        >▲</button>
        <button
          onClick={() => store.setIndex(side, Math.min(panel.files.length - 1, panel.index + 1))}
          disabled={panel.index >= panel.files.length - 1}
          className="px-1.5 py-0.5 text-[9px] text-text-muted hover:text-text-primary disabled:opacity-30 transition-colors"
        >▼</button>

        <div className="w-px h-4 bg-border mx-0.5" />

        <button onClick={() => store.zoomOut(side)} className="px-1 text-[10px] text-text-muted hover:text-text-primary transition-colors">−</button>
        <span className="text-[9px] text-text-muted px-0.5 min-w-[28px] text-center">{Math.round(panel.zoom * 100)}%</span>
        <button onClick={() => store.zoomIn(side)} className="px-1 text-[10px] text-text-muted hover:text-text-primary transition-colors">＋</button>
        <button onClick={() => store.resetZoom(side)} className="px-1.5 text-[8px] text-text-muted hover:text-text-primary transition-colors">⟲</button>
      </div>

      {/* 画像エリア */}
      <div
        className="flex-1 overflow-hidden relative bg-[#1a1a1e] select-none"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        style={{ cursor: dragStartRef.current ? "grabbing" : "grab" }}
      >
        {!file ? (
          <div className="absolute inset-0 flex items-center justify-center text-text-muted text-xs">
            ファイルを選択してください
          </div>
        ) : !panel.imageUrl ? (
          <div className="absolute inset-0 flex items-center justify-center text-text-muted text-xs">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              読み込み中...
            </div>
          </div>
        ) : (
          <div
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
            style={{
              transform: `translate(${panel.panX}px, ${panel.panY}px) scale(${panel.zoom})`,
              transformOrigin: "center center",
              transition: dragStartRef.current ? "none" : "transform 0.1s ease-out",
            }}
          >
            <img
              src={panel.imageUrl}
              alt={`Panel ${side}`}
              className="max-w-full max-h-full object-contain"
              draggable={false}
            />
          </div>
        )}
      </div>
    </div>
  );
}
