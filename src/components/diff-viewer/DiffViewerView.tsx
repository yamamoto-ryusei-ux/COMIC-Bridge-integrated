/**
 * 差分ビューアー（KENBANから移植、Tailwind/Zustandネイティブ版）
 *
 * 元: src/components/kenban/KenbanDiffViewer.tsx (1,175行)
 * - 比較モード: tiff-tiff / psd-psd / pdf-pdf / psd-tiff
 * - 表示モード: A / B / 差分
 * - ズーム/パン、ペアリング、自動差分計算
 */
import { useEffect, useRef, useCallback, useMemo } from "react";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useDiffStore, isValidPairCombination, type CompareMode, type ViewMode, type FilePair } from "../../store/diffStore";
import { useViewStore } from "../../store/viewStore";

interface Props {
  externalPathA?: string | null;
  externalPathB?: string | null;
}

const COMPARE_MODE_LABELS: Record<CompareMode, string> = {
  "tiff-tiff": "TIFF / TIFF",
  "psd-psd": "PSD / PSD",
  "pdf-pdf": "PDF / PDF",
  "psd-tiff": "PSD / TIFF",
};

const VIEW_MODE_LABELS: Record<ViewMode, string> = {
  A: "原稿A",
  B: "原稿B",
  diff: "差分",
};

export function DiffViewerView({ externalPathA, externalPathB }: Props = {}) {
  const store = useDiffStore();
  const isFullscreen = useViewStore((s) => s.isViewerFullscreen);
  // Escape で全画面解除
  useEffect(() => {
    if (!isFullscreen) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") useViewStore.getState().setViewerFullscreen(false); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [isFullscreen]);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  // ── 外部パス同期 ──
  // フォルダパスはA/B片方だけでも常に登録（UI表示・共有維持）。
  // ファイル実読み込みは A/B 両方揃った時のみ実行。
  useEffect(() => {
    if (externalPathA !== undefined && externalPathA !== store.folderA) {
      store.setFolderA(externalPathA ?? null);
    }
    if (externalPathB !== undefined && externalPathB !== store.folderB) {
      store.setFolderB(externalPathB ?? null);
    }
    if (externalPathA && externalPathB) {
      if (externalPathA !== store.folderA || store.filesA.length === 0) {
        store.loadFolderSide(externalPathA, "A");
      }
      if (externalPathB !== store.folderB || store.filesB.length === 0) {
        store.loadFolderSide(externalPathB, "B");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalPathA, externalPathB]);

  // ── 現在のペア ──
  const currentPair: FilePair | undefined = store.pairs[store.selectedIndex];

  // ── ペアの組み合わせ妥当性 ──
  const pairValidity = useMemo(() => {
    if (!currentPair?.fileA || !currentPair?.fileB) return { valid: true };
    return isValidPairCombination(currentPair.fileA.filePath, currentPair.fileB.filePath, store.compareMode);
  }, [currentPair, store.compareMode]);

  // ── 表示画像URL（previewMapから直接取得、差分結果が優先）──
  const displayImageUrl = useMemo(() => {
    if (!currentPair) return null;
    // プレビュー（previewMapから常に取得可能）
    const previewA = currentPair.fileA ? store.previewMap[currentPair.fileA.filePath] : undefined;
    const previewB = currentPair.fileB ? store.previewMap[currentPair.fileB.filePath] : undefined;

    if (store.viewMode === "diff") {
      // 不適切な組み合わせの場合は A だけ表示
      if (!pairValidity.valid) {
        return currentPair.processedA || currentPair.srcA || previewA || null;
      }
      // 差分結果があれば優先、なければプレビューにフォールバック
      return currentPair.diffSrc || currentPair.processedA || currentPair.srcA || previewA || previewB || null;
    }
    if (store.viewMode === "A") {
      return currentPair.processedA || currentPair.srcA || previewA || null;
    }
    if (store.viewMode === "B") {
      // 不適切な組み合わせの場合は B を表示しない（エラー表示に切り替わる）
      if (!pairValidity.valid) return null;
      return currentPair.srcB || previewB || null;
    }
    return null;
  }, [currentPair, store.viewMode, store.previewMap, pairValidity]);

  // ── フィルタされたペア（差分のみ表示時）──
  const visiblePairs = useMemo(() => {
    if (!store.filterDiffOnly) return store.pairs;
    return store.pairs.filter((p) => p.hasDiff || p.status !== "done");
  }, [store.pairs, store.filterDiffOnly]);

  // ── ペア選択時に自動で差分計算 or プレビュー読み込み ──
  useEffect(() => {
    const pair = store.pairs[store.selectedIndex];
    // pending状態かつ片方でもファイルがあれば処理
    if (pair && pair.status === "pending" && (pair.fileA || pair.fileB)) {
      store.processPair(store.selectedIndex);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.selectedIndex, store.pairs]);

  // ── キーボードショートカット ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      // ←→: ペア切替
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        store.setSelectedIndex(Math.max(0, store.selectedIndex - 1));
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        store.setSelectedIndex(Math.min(store.pairs.length - 1, store.selectedIndex + 1));
      }
      // Space: 表示モード切替
      else if (e.key === " ") {
        e.preventDefault();
        const order: ViewMode[] = ["A", "B", "diff"];
        const idx = order.indexOf(store.viewMode);
        store.setViewMode(order[(idx + 1) % order.length]);
      }
      // Ctrl+0/+/-: ズーム
      else if (e.ctrlKey && e.key === "0") {
        e.preventDefault();
        store.resetZoom();
      } else if (e.ctrlKey && (e.key === "+" || e.key === "=")) {
        e.preventDefault();
        store.zoomIn();
      } else if (e.ctrlKey && e.key === "-") {
        e.preventDefault();
        store.zoomOut();
      }
      // P: 現在のペアのファイルをPhotoshopで開く
      else if ((e.key === "p" || e.key === "P") && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handleOpenInPhotoshop();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  // ── マウスドラッグでパン ──
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    dragStartRef.current = { x: e.clientX, y: e.clientY, panX: store.panX, panY: store.panY };
    store.setIsDragging(true);
  }, [store]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    store.setPan(dragStartRef.current.panX + dx, dragStartRef.current.panY + dy);
  }, [store]);

  const handleMouseUp = useCallback(() => {
    dragStartRef.current = null;
    store.setIsDragging(false);
  }, [store]);

  // ── ホイールズーム ──
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    if (e.deltaY < 0) store.zoomIn();
    else store.zoomOut();
  }, [store]);

  // ── フォルダ選択（TopNavのkenbanPathA/Bにも書き戻し）──
  // フォルダ/ファイル選択:
  //   viewStore 同期は常時、local store の folder も常に登録、
  //   実読み込みは A/B 両方揃った時のみ
  const handleSelectFolder = useCallback(async (side: "A" | "B") => {
    const path = await dialogOpen({ directory: true, multiple: false });
    if (path && typeof path === "string") {
      const vs = useViewStore.getState();
      if (side === "A") vs.setKenbanPathA(path);
      else vs.setKenbanPathB(path);
      // local store にも folder パスを即登録
      if (side === "A") store.setFolderA(path);
      else store.setFolderB(path);
      const nextA = side === "A" ? path : vs.kenbanPathA;
      const nextB = side === "B" ? path : vs.kenbanPathB;
      if (nextA && nextB) {
        if (nextA !== store.folderA || store.filesA.length === 0) await store.loadFolderSide(nextA, "A");
        if (nextB !== store.folderB || store.filesB.length === 0) await store.loadFolderSide(nextB, "B");
      }
    }
  }, [store]);

  const handleSelectFile = useCallback(async (side: "A" | "B") => {
    const exts = ["psd", "psb", "tif", "tiff", "jpg", "jpeg", "png", "bmp", "pdf"];
    const path = await dialogOpen({ multiple: false, filters: [{ name: "対応ファイル", extensions: exts }] });
    if (path && typeof path === "string") {
      const vs = useViewStore.getState();
      if (side === "A") vs.setKenbanPathA(path);
      else vs.setKenbanPathB(path);
      if (side === "A") store.setFolderA(path);
      else store.setFolderB(path);
      const nextA = side === "A" ? path : vs.kenbanPathA;
      const nextB = side === "B" ? path : vs.kenbanPathB;
      if (nextA && nextB) {
        if (nextA !== store.folderA || store.filesA.length === 0) await store.loadFolderSide(nextA, "A");
        if (nextB !== store.folderB || store.filesB.length === 0) await store.loadFolderSide(nextB, "B");
      }
    }
  }, [store]);

  // ── Photoshop / Explorer連携 ──
  const handleOpenInPhotoshop = useCallback(async () => {
    if (!currentPair) return;
    const file = store.viewMode === "B" ? currentPair.fileB : currentPair.fileA;
    if (!file) return;
    try {
      await invoke("kenban_open_file_in_photoshop", { path: file.filePath });
    } catch (e) {
      console.error("Photoshop open error:", e);
    }
  }, [currentPair, store.viewMode]);

  const handleOpenFolder = useCallback(async () => {
    const folder = store.viewMode === "B" ? store.folderB : store.folderA;
    if (!folder) return;
    try {
      await invoke("open_folder", { path: folder });
    } catch {
      try {
        await invoke("open_folder_in_explorer", { folderPath: folder });
      } catch (e) {
        console.error("Open folder error:", e);
      }
    }
  }, [store.folderA, store.folderB, store.viewMode]);

  return (
    <div className="flex h-full w-full overflow-hidden bg-bg-primary">
      {/* ════ サイドバー ════ */}
      {!isFullscreen && (
        <div className="w-[220px] flex-shrink-0 flex flex-col border-r border-border bg-bg-secondary">
          {/* 比較モード */}
          <div className="px-3 py-2 border-b border-border">
            <div className="text-[9px] text-text-muted mb-1">比較モード</div>
            <select
              value={store.compareMode}
              onChange={(e) => store.setCompareMode(e.target.value as CompareMode)}
              className="w-full px-2 py-1 text-[10px] bg-bg-tertiary border border-border/50 rounded text-text-primary focus:outline-none focus:border-accent/50"
            >
              {(Object.keys(COMPARE_MODE_LABELS) as CompareMode[]).map((m) => (
                <option key={m} value={m}>{COMPARE_MODE_LABELS[m]}</option>
              ))}
            </select>
          </div>

          {/* フォルダ選択 A/B */}
          <div className="px-3 py-2 border-b border-border space-y-2">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9px] text-blue-400 font-medium">A: 原稿</span>
                <div className="flex gap-1">
                  <button onClick={() => handleSelectFolder("A")} className="px-1.5 py-0.5 text-[8px] text-text-muted hover:text-text-primary bg-bg-tertiary rounded transition-colors">📁</button>
                  <button onClick={() => handleSelectFile("A")} className="px-1.5 py-0.5 text-[8px] text-text-muted hover:text-text-primary bg-bg-tertiary rounded transition-colors">📄</button>
                </div>
              </div>
              <div className="text-[9px] text-text-muted truncate" title={store.folderA || ""}>
                {store.folderA ? store.folderA.split(/[/\\]/).pop() : "未選択"}
              </div>
              <div className="text-[8px] text-text-muted/60">{store.filesA.length}件</div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9px] text-orange-400 font-medium">B: 原稿</span>
                <div className="flex gap-1">
                  <button onClick={() => handleSelectFolder("B")} className="px-1.5 py-0.5 text-[8px] text-text-muted hover:text-text-primary bg-bg-tertiary rounded transition-colors">📁</button>
                  <button onClick={() => handleSelectFile("B")} className="px-1.5 py-0.5 text-[8px] text-text-muted hover:text-text-primary bg-bg-tertiary rounded transition-colors">📄</button>
                </div>
              </div>
              <div className="text-[9px] text-text-muted truncate" title={store.folderB || ""}>
                {store.folderB ? store.folderB.split(/[/\\]/).pop() : "未選択"}
              </div>
              <div className="text-[8px] text-text-muted/60">{store.filesB.length}件</div>
            </div>
          </div>

          {/* ペアリングモード */}
          <div className="px-3 py-2 border-b border-border">
            <div className="text-[9px] text-text-muted mb-1">ペアリング</div>
            <div className="flex gap-1">
              <button
                onClick={() => store.setPairingMode("order")}
                className={`flex-1 px-2 py-1 text-[9px] rounded transition-colors ${store.pairingMode === "order" ? "bg-accent/15 text-accent" : "bg-bg-tertiary text-text-muted hover:text-text-primary"}`}
              >ファイル順</button>
              <button
                onClick={() => store.setPairingMode("name")}
                className={`flex-1 px-2 py-1 text-[9px] rounded transition-colors ${store.pairingMode === "name" ? "bg-accent/15 text-accent" : "bg-bg-tertiary text-text-muted hover:text-text-primary"}`}
              >名前順</button>
            </div>
          </div>

          {/* オプション */}
          <div className="px-3 py-2 border-b border-border space-y-1.5">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={store.filterDiffOnly} onChange={(e) => store.setFilterDiffOnly(e.target.checked)} className="w-3 h-3 accent-accent" />
              <span className="text-[9px] text-text-secondary">差分のみ表示</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={store.showMarkers} onChange={(e) => store.setShowMarkers(e.target.checked)} className="w-3 h-3 accent-accent" />
              <span className="text-[9px] text-text-secondary">マーカー表示</span>
            </label>
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-text-muted">しきい値</span>
                <span className="text-[9px] text-text-secondary">{store.threshold}</span>
              </div>
              <input type="range" min={0} max={100} value={store.threshold} onChange={(e) => store.setThreshold(parseInt(e.target.value))} className="w-full h-1 accent-accent" />
            </div>
          </div>

          {/* 全件処理 */}
          <div className="px-3 py-2 border-b border-border">
            <button
              onClick={() => store.processAllPairs()}
              disabled={store.pairs.length === 0}
              className="w-full px-2 py-1.5 text-[10px] font-medium text-white bg-accent rounded hover:bg-accent-secondary disabled:opacity-40 transition-colors"
            >
              全{visiblePairs.length}件を解析
            </button>
          </div>

          {/* ファイルリスト */}
          <div className="flex-1 overflow-auto">
            {visiblePairs.length === 0 ? (
              <div className="text-center py-8 text-[10px] text-text-muted">
                ファイルを選択してください
              </div>
            ) : (
              visiblePairs.map((pair) => {
                const realIdx = store.pairs.indexOf(pair);
                const isSelected = realIdx === store.selectedIndex;
                const validity = isValidPairCombination(pair.fileA?.filePath, pair.fileB?.filePath, store.compareMode);
                return (
                  <button
                    key={pair.index}
                    onClick={() => store.setSelectedIndex(realIdx)}
                    className={`w-full text-left px-3 py-1.5 text-[10px] border-b border-border/30 transition-colors ${isSelected ? "bg-accent/15 text-accent" : "text-text-secondary hover:bg-bg-tertiary"}`}
                  >
                    <div className="flex items-center gap-1">
                      {pair.status === "loading" && <span className="text-[8px] text-yellow-400">⌛</span>}
                      {!validity.valid && <span className="text-[8px] text-red-400" title={validity.reason}>⚠</span>}
                      {validity.valid && pair.status === "done" && pair.hasDiff && <span className="text-[8px] text-red-400">⚠</span>}
                      {validity.valid && pair.status === "done" && !pair.hasDiff && <span className="text-[8px] text-emerald-400">✓</span>}
                      {pair.status === "error" && <span className="text-[8px] text-red-400">✕</span>}
                      <span className="truncate flex-1">
                        {pair.fileA?.name || pair.fileB?.name || "(no file)"}
                      </span>
                    </div>
                    {pair.diffProbability !== undefined && (
                      <div className="text-[8px] text-text-muted ml-3">差分率: {pair.diffProbability.toFixed(1)}%</div>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ════ メインエリア ════ */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* ツールバー — 全画面時は非表示 */}
        {!isFullscreen && <div className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 border-b border-border bg-bg-secondary">
          {/* 表示モード切替 */}
          <div className="flex gap-0.5 bg-bg-tertiary rounded p-0.5">
            {(["A", "B", "diff"] as ViewMode[]).map((m) => (
              <button
                key={m}
                onClick={() => store.setViewMode(m)}
                className={`px-2 py-1 text-[10px] rounded transition-colors ${store.viewMode === m ? "bg-accent text-white" : "text-text-muted hover:text-text-primary"}`}
              >
                {VIEW_MODE_LABELS[m]}
              </button>
            ))}
          </div>

          <div className="w-px h-5 bg-border mx-1" />

          {/* ナビゲーション */}
          <button
            onClick={() => store.setSelectedIndex(Math.max(0, store.selectedIndex - 1))}
            disabled={store.selectedIndex === 0}
            className="px-2 py-1 text-[10px] text-text-secondary hover:text-text-primary disabled:opacity-30 transition-colors"
          >◀</button>
          <span className="text-[10px] text-text-secondary px-1">
            {store.pairs.length > 0 ? `${store.selectedIndex + 1} / ${store.pairs.length}` : "0 / 0"}
          </span>
          <button
            onClick={() => store.setSelectedIndex(Math.min(store.pairs.length - 1, store.selectedIndex + 1))}
            disabled={store.selectedIndex >= store.pairs.length - 1}
            className="px-2 py-1 text-[10px] text-text-secondary hover:text-text-primary disabled:opacity-30 transition-colors"
          >▶</button>

          <div className="w-px h-5 bg-border mx-1" />

          {/* ズーム */}
          <button onClick={() => store.zoomOut()} className="px-2 py-1 text-[10px] text-text-secondary hover:text-text-primary transition-colors">−</button>
          <span className="text-[10px] text-text-secondary px-1 min-w-[32px] text-center">{Math.round(store.zoom * 100)}%</span>
          <button onClick={() => store.zoomIn()} className="px-2 py-1 text-[10px] text-text-secondary hover:text-text-primary transition-colors">＋</button>
          <button onClick={() => store.resetZoom()} className="px-2 py-1 text-[9px] text-text-muted hover:text-text-primary transition-colors">リセット</button>

          <div className="flex-1" />

          {/* アクション */}
          <button onClick={handleOpenFolder} className="px-2 py-1 text-[10px] text-text-secondary hover:text-text-primary transition-colors">📁</button>
          <button onClick={handleOpenInPhotoshop} className="px-2 py-1 text-[10px] text-text-secondary hover:text-text-primary transition-colors" title="Photoshopで開く (P)">Ps</button>
          <button
            onClick={() => useViewStore.getState().setViewerFullscreen(!isFullscreen)}
            className="px-2 py-1 text-[10px] text-text-secondary hover:text-text-primary transition-colors"
          >{isFullscreen ? "縮小" : "全画面"}</button>
        </div>}

        {/* イメージビューアー */}
        <div
          ref={containerRef}
          className="flex-1 overflow-hidden relative bg-[#1a1a1e] select-none"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          style={{ cursor: store.isDragging ? "grabbing" : "grab" }}
        >
          {currentPair?.status === "loading" && !displayImageUrl && (
            <div className="absolute inset-0 flex items-center justify-center text-text-muted text-xs pointer-events-none">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                解析中...
              </div>
            </div>
          )}
          {!currentPair && (
            <div className="absolute inset-0 flex items-center justify-center text-text-muted text-xs">
              ファイルを選択してください
            </div>
          )}
          {/* 不適切な組み合わせ時のエラー表示（B側 or 差分） */}
          {currentPair && !pairValidity.valid && (store.viewMode === "B") && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-6 py-4 max-w-md text-center">
                <div className="text-red-400 text-sm font-medium mb-2">⚠ 不適切なファイル組み合わせ</div>
                <div className="text-red-300/80 text-[10px] mb-2">{pairValidity.reason || "差分計算ができません"}</div>
                <div className="text-text-muted text-[10px]">比較モード: <span className="text-text-secondary">{COMPARE_MODE_LABELS[store.compareMode]}</span></div>
                <div className="text-text-muted text-[9px] mt-1">A原稿側へ切り替えるか、比較モードを変更してください</div>
              </div>
            </div>
          )}
          {currentPair && !displayImageUrl && currentPair.status !== "loading" && pairValidity.valid && (
            <div className="absolute inset-0 flex items-center justify-center text-text-muted text-xs">
              プレビュー読み込み中...
            </div>
          )}
          {displayImageUrl && (
            <div
              className="absolute inset-0 flex items-center justify-center pointer-events-none"
              style={{
                transform: `translate(${store.panX}px, ${store.panY}px) scale(${store.zoom})`,
                transformOrigin: "center center",
                transition: store.isDragging ? "none" : "transform 0.1s ease-out",
              }}
            >
              <img
                src={displayImageUrl}
                alt={`${store.viewMode} view`}
                className="max-w-full max-h-full object-contain"
                draggable={false}
              />
              {/* マーカー表示 */}
              {store.showMarkers && currentPair?.markers && currentPair.markers.length > 0 && currentPair.imageWidth && currentPair.imageHeight && (
                <svg
                  className="absolute inset-0 pointer-events-none"
                  viewBox={`0 0 ${currentPair.imageWidth} ${currentPair.imageHeight}`}
                  preserveAspectRatio="xMidYMid meet"
                  style={{ width: "100%", height: "100%" }}
                >
                  {currentPair.markers.map((m, i) => (
                    <circle
                      key={i}
                      cx={m.x}
                      cy={m.y}
                      r={m.radius}
                      fill="none"
                      stroke="rgba(255,80,80,0.8)"
                      strokeWidth={Math.max(2, currentPair.imageWidth! * 0.002)}
                    />
                  ))}
                </svg>
              )}
            </div>
          )}
        </div>

        {/* ステータスバー — 全画面時は非表示 */}
        {!isFullscreen && <div className="flex-shrink-0 px-3 py-1 border-t border-border bg-bg-secondary text-[9px] text-text-muted flex items-center gap-3">
          {currentPair?.fileA && <span>A: {currentPair.fileA.name}</span>}
          {currentPair?.fileB && <span>B: {currentPair.fileB.name}</span>}
          {currentPair?.diffCount !== undefined && <span>差分ピクセル: {currentPair.diffCount.toLocaleString()}</span>}
          {currentPair?.diffProbability !== undefined && <span>差分率: {currentPair.diffProbability.toFixed(1)}%</span>}
          {!pairValidity.valid && <span className="text-red-400">⚠ {pairValidity.reason}</span>}
          <div className="flex-1" />
          <span>↑↓: ペア / Space: 表示切替 / Ctrl+/-: ズーム</span>
        </div>}
      </div>
    </div>
  );
}
