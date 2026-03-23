import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { usePsdStore } from "../../store/psdStore";
import { useHighResPreview, prefetchPreview } from "../../hooks/useHighResPreview";
import { useOpenFolder } from "../../hooks/useOpenFolder";
import type { LayerNode, LayerBounds } from "../../types";

interface LayerSeparationPanelProps {
  onOpenInPhotoshop?: (filePath: string) => void;
}

// ── Helpers ──

/** Collect all descendant leaf layer IDs (non-group) recursively */
function collectAllLeafIds(node: LayerNode): string[] {
  if (node.children && node.children.length > 0) {
    return node.children.flatMap(collectAllLeafIds);
  }
  return [node.id];
}

/** Collect all layers (flat) with bounds from the tree */
function collectLayersWithBounds(
  nodes: LayerNode[],
): { id: string; name: string; bounds: LayerBounds }[] {
  const result: { id: string; name: string; bounds: LayerBounds }[] = [];
  for (const node of nodes) {
    if (node.bounds) {
      result.push({ id: node.id, name: node.name, bounds: node.bounds });
    }
    if (node.children) {
      result.push(...collectLayersWithBounds(node.children));
    }
  }
  return result;
}

export function LayerSeparationPanel({ onOpenInPhotoshop }: LayerSeparationPanelProps) {
  const files = usePsdStore((s) => s.files);
  const selectedFileIds = usePsdStore((s) => s.selectedFileIds);
  const { openFolderForFile } = useOpenFolder();

  // Viewer index
  const [viewerFileIndex, setViewerFileIndex] = useState(0);
  const viewerRef = useRef<HTMLDivElement>(null);

  // Layer selection for highlighting
  const [selectedLayerIds, setSelectedLayerIds] = useState<Set<string>>(new Set());
  const [showHighlights, setShowHighlights] = useState(true);

  // Fullscreen
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showEscHint, setShowEscHint] = useState(false);
  const [splashPhase, setSplashPhase] = useState<"hidden" | "in" | "hold" | "out">("hidden");
  const transitionLock = useRef(false);

  const toggleFullscreen = useCallback(
    async (force?: boolean) => {
      const next = force !== undefined ? force : !isFullscreen;
      if (next === isFullscreen || transitionLock.current) return;
      transitionLock.current = true;
      setSplashPhase("in");
      await new Promise((r) => setTimeout(r, 200));
      setSplashPhase("hold");
      try {
        await getCurrentWindow().setFullscreen(next);
      } catch {
        /* ignore */
      }
      setIsFullscreen(next);
      await new Promise((r) => setTimeout(r, 200));
      setSplashPhase("out");
      await new Promise((r) => setTimeout(r, 350));
      setSplashPhase("hidden");
      transitionLock.current = false;
      if (next) setShowEscHint(true);
    },
    [isFullscreen],
  );

  useEffect(() => {
    if (!showEscHint) return;
    const timer = setTimeout(() => setShowEscHint(false), 2500);
    return () => clearTimeout(timer);
  }, [showEscHint]);

  // Restore window on unmount
  useEffect(() => {
    return () => {
      if (isFullscreen) {
        getCurrentWindow()
          .setFullscreen(false)
          .catch(() => {});
      }
    };
  }, [isFullscreen]);

  const viewerFile = files[viewerFileIndex] ?? files[0] ?? null;

  // High-res preview
  const {
    imageUrl,
    isLoading,
    error: viewerError,
    reload: viewerReload,
  } = useHighResPreview(viewerFile?.filePath, {
    maxSize: 2000,
    enabled: !!viewerFile,
    pdfPageIndex: viewerFile?.pdfPageIndex,
    pdfSourcePath: viewerFile?.pdfSourcePath,
  });

  // Reset selection when file changes
  useEffect(() => {
    setSelectedLayerIds(new Set());
  }, [viewerFileIndex]);

  // Reset index when files change
  useEffect(() => {
    setViewerFileIndex(0);
  }, [files.length]);

  // Sync index when sidebar selection changes
  useEffect(() => {
    if (selectedFileIds.length === 0) return;
    const idx = files.findIndex((f) => f.id === selectedFileIds[0]);
    if (idx >= 0) setViewerFileIndex(idx);
  }, [selectedFileIds, files]);

  // Prefetch adjacent files
  useEffect(() => {
    if (files.length <= 1) return;
    for (let offset = 1; offset <= 3; offset++) {
      for (const idx of [viewerFileIndex - offset, viewerFileIndex + offset]) {
        if (idx < 0 || idx >= files.length) continue;
        const f = files[idx];
        if (!f?.filePath) continue;
        prefetchPreview(f.filePath, 2000, f.pdfPageIndex, f.pdfSourcePath);
      }
    }
  }, [viewerFileIndex, files]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Escape" && isFullscreen) {
        e.preventDefault();
        toggleFullscreen(false);
        return;
      }
      if (files.length <= 1) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        setViewerFileIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        setViewerFileIndex((i) => Math.min(files.length - 1, i + 1));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [files.length, isFullscreen, toggleFullscreen]);

  // Mouse wheel navigation
  useEffect(() => {
    const el = viewerRef.current;
    if (!el || files.length <= 1) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.deltaY > 0) {
        setViewerFileIndex((i) => Math.min(files.length - 1, i + 1));
      } else if (e.deltaY < 0) {
        setViewerFileIndex((i) => Math.max(0, i - 1));
      }
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [files.length, isFullscreen]);

  // P/F shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!viewerFile) return;
      if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (onOpenInPhotoshop) onOpenInPhotoshop(viewerFile.filePath);
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        e.stopImmediatePropagation();
        openFolderForFile(viewerFile.filePath);
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [viewerFile, onOpenInPhotoshop, openFolderForFile]);

  // Layers data
  const layerTree = viewerFile?.metadata?.layerTree ?? [];
  const psdWidth = viewerFile?.metadata?.width ?? 0;
  const psdHeight = viewerFile?.metadata?.height ?? 0;

  // Flat map for highlight rendering
  const allLayersWithBounds = useMemo(() => collectLayersWithBounds(layerTree), [layerTree]);

  const highlightLayers = useMemo(
    () => allLayersWithBounds.filter((l) => selectedLayerIds.has(l.id)),
    [allLayersWithBounds, selectedLayerIds],
  );

  // Toggle a layer (or group's children)
  const toggleLayer = useCallback((node: LayerNode) => {
    setSelectedLayerIds((prev) => {
      const next = new Set(prev);
      if (node.children && node.children.length > 0) {
        // Group: toggle all leaf descendants
        const leafIds = collectAllLeafIds(node);
        const allSelected = leafIds.every((id) => next.has(id));
        if (allSelected) {
          leafIds.forEach((id) => next.delete(id));
        } else {
          leafIds.forEach((id) => next.add(id));
        }
      } else {
        // Single layer
        if (next.has(node.id)) {
          next.delete(node.id);
        } else {
          next.add(node.id);
        }
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedLayerIds(new Set(allLayersWithBounds.map((l) => l.id)));
  }, [allLayersWithBounds]);

  const deselectAll = useCallback(() => {
    setSelectedLayerIds(new Set());
  }, []);

  if (files.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[11px] text-text-muted">
        ファイルを読み込んでください
      </div>
    );
  }

  const viewerContent = (
    <div
      className={`flex select-none ${isFullscreen ? "fixed inset-0 z-[9999] bg-[#0e0e10]" : "h-full"}`}
    >
      {/* Image Viewer with SVG overlay */}
      <div
        ref={viewerRef}
        className="flex-1 overflow-hidden relative flex items-center justify-center bg-[#1a1a1e]"
      >
        <div className="absolute inset-0 flex items-center justify-center p-2">
          <div className="relative inline-flex items-center justify-center max-w-full max-h-full">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={viewerFile?.fileName}
                className={`block max-w-full max-h-full object-contain select-none transition-opacity duration-150 ${isLoading ? "opacity-40" : "opacity-100"}`}
                style={{ maxHeight: "calc(100vh - 120px)" }}
                draggable={false}
              />
            ) : viewerFile?.thumbnailUrl ? (
              <img
                src={viewerFile.thumbnailUrl}
                alt={viewerFile.fileName}
                className="block max-w-full max-h-full object-contain select-none opacity-60"
                style={{ maxHeight: "calc(100vh - 120px)" }}
                draggable={false}
              />
            ) : null}

            {/* SVG highlight overlay — matches img size via absolute positioning */}
            {showHighlights && highlightLayers.length > 0 && psdWidth > 0 && (
              <svg
                className="absolute inset-0 w-full h-full pointer-events-none"
                viewBox={`0 0 ${psdWidth} ${psdHeight}`}
                preserveAspectRatio="xMidYMid meet"
              >
                {highlightLayers.map((layer) => (
                  <rect
                    key={layer.id}
                    x={layer.bounds.left}
                    y={layer.bounds.top}
                    width={layer.bounds.right - layer.bounds.left}
                    height={layer.bounds.bottom - layer.bounds.top}
                    fill="rgba(194, 90, 90, 0.15)"
                    stroke="rgba(194, 90, 90, 0.5)"
                    strokeWidth={Math.max(3, psdWidth * 0.002)}
                    rx={4}
                  />
                ))}
              </svg>
            )}
          </div>
        </div>

        {/* Loading spinner */}
        {isLoading && (
          <div className="absolute top-3 right-3 z-10">
            <div className="w-5 h-5 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
          </div>
        )}

        {/* Error state */}
        {viewerError && !imageUrl && (
          <div className="flex flex-col items-center gap-2 text-center px-6">
            <svg
              className="w-8 h-8 text-error/50"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
              />
            </svg>
            <p className="text-[11px] text-text-muted">プレビューの読み込みに失敗</p>
            <button
              onClick={viewerReload}
              className="text-[10px] text-accent hover:text-accent/80 transition-colors"
            >
              再試行
            </button>
          </div>
        )}

        {/* Fullscreen toggle */}
        <button
          onClick={() => toggleFullscreen()}
          className="absolute top-3 left-3 z-10 w-8 h-8 rounded-lg bg-black/50 hover:bg-black/70 flex items-center justify-center text-white/70 hover:text-white transition-all backdrop-blur-sm"
          title={isFullscreen ? "全画面を解除 (Esc)" : "全画面表示"}
        >
          {isFullscreen ? (
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4l4 4M4 4v3m0-3h3" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 4l-4 4M20 4v3m0-3h-3" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 20l4-4M4 20v-3m0 3h3" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 20l-4-4M20 20v-3m0 3h-3" />
            </svg>
          ) : (
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 3h6m0 0v6m0-6l-7 7" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 21H3m0 0v-6m0 6l7-7" />
            </svg>
          )}
        </button>

        {/* ESC hint */}
        {isFullscreen && showEscHint && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 px-4 py-2 rounded-xl bg-black/60 backdrop-blur-md text-white/90 text-xs font-medium animate-fade-hint pointer-events-none">
            Esc で全画面を解除
          </div>
        )}

        {/* Navigation arrows */}
        {files.length > 1 && (
          <>
            {viewerFileIndex > 0 && (
              <button
                onClick={() => setViewerFileIndex((i) => i - 1)}
                className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center text-white/70 hover:text-white transition-all backdrop-blur-sm"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            {viewerFileIndex < files.length - 1 && (
              <button
                onClick={() => setViewerFileIndex((i) => i + 1)}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center text-white/70 hover:text-white transition-all backdrop-blur-sm"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )}
          </>
        )}
      </div>

      {/* Sidebar */}
      <div className="w-[320px] flex-shrink-0 border-l border-border bg-bg-secondary flex flex-col">
        {/* File header */}
        <div className="px-3 py-2 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-display font-medium text-text-primary truncate flex-1">
              {viewerFile?.fileName}
            </span>
            {files.length > 1 && (
              <span className="text-[10px] text-text-muted flex-shrink-0">
                {viewerFileIndex + 1} / {files.length}
              </span>
            )}
            {viewerFile && (
              <button
                className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded transition-all text-text-muted hover:text-text-primary hover:bg-bg-tertiary active:scale-95"
                onClick={() => openFolderForFile(viewerFile.filePath)}
                title="フォルダを開く (F)"
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                  />
                </svg>
              </button>
            )}
            {onOpenInPhotoshop && viewerFile && (
              <button
                className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded transition-all text-[#31A8FF] hover:bg-[#31A8FF]/15 active:scale-95"
                onClick={() => onOpenInPhotoshop(viewerFile.filePath)}
                title="Photoshopで開く (P)"
              >
                <span className="text-sm font-bold leading-none">P</span>
              </button>
            )}
          </div>
          {viewerFile?.metadata && (
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] text-text-muted">
                {viewerFile.metadata.width} x {viewerFile.metadata.height}
              </span>
              <span className="text-[10px] text-text-muted">{viewerFile.metadata.dpi} dpi</span>
              <span className="text-[10px] text-text-muted">{viewerFile.metadata.colorMode}</span>
            </div>
          )}
        </div>

        {/* Toolbar: highlight toggle + select all/none */}
        <div className="px-3 py-1.5 border-b border-border flex-shrink-0 flex items-center gap-2">
          {/* Highlight toggle */}
          <button
            onClick={() => setShowHighlights(!showHighlights)}
            className="w-7 h-7 flex items-center justify-center rounded-md transition-all"
            style={{
              background: showHighlights ? "rgba(194,90,90,0.12)" : "transparent",
            }}
            title={showHighlights ? "ハイライト非表示" : "ハイライト表示"}
          >
            {showHighlights ? (
              <svg
                className="w-4 h-4"
                style={{ color: "rgb(248,113,113)" }}
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                <path
                  fillRule="evenodd"
                  d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z"
                  clipRule="evenodd"
                />
              </svg>
            ) : (
              <svg
                className="w-4 h-4"
                style={{ color: "rgb(115,115,130)" }}
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z"
                  clipRule="evenodd"
                />
                <path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z" />
              </svg>
            )}
          </button>

          <div className="flex-1" />

          {/* Selection count */}
          {selectedLayerIds.size > 0 && (
            <span className="text-[10px] text-text-muted">{selectedLayerIds.size} 選択中</span>
          )}

          {/* Select all / deselect all */}
          <button
            onClick={selectAll}
            className="px-2 py-1 text-[10px] rounded transition-all text-text-muted hover:text-text-secondary hover:bg-bg-tertiary"
            title="全選択"
          >
            全選択
          </button>
          <button
            onClick={deselectAll}
            className="px-2 py-1 text-[10px] rounded transition-all text-text-muted hover:text-text-secondary hover:bg-bg-tertiary"
            title="全解除"
          >
            全解除
          </button>
        </div>

        {/* Layer tree */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 p-2">
          {layerTree.length > 0 ? (
            <SelectableLayerTree
              layers={layerTree}
              selectedIds={selectedLayerIds}
              onToggle={toggleLayer}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-[10px] text-text-muted">
              レイヤー情報なし
            </div>
          )}
        </div>
      </div>

      {/* Fullscreen splash overlay */}
      {splashPhase !== "hidden" &&
        createPortal(
          <div
            className={`fixed inset-0 z-[99999] bg-[#0e0e10] transition-opacity ${
              splashPhase === "in"
                ? "opacity-0 animate-[fadeIn_200ms_forwards]"
                : splashPhase === "hold"
                  ? "opacity-100"
                  : "opacity-100 animate-[fadeOut_350ms_forwards]"
            }`}
            style={{ pointerEvents: "none" }}
          />,
          document.body,
        )}
    </div>
  );

  if (isFullscreen) {
    return createPortal(viewerContent, document.body);
  }

  return viewerContent;
}

// ── Selectable Layer Tree ──

interface SelectableLayerTreeProps {
  layers: LayerNode[];
  depth?: number;
  parentVisible?: boolean;
  selectedIds: Set<string>;
  onToggle: (node: LayerNode) => void;
}

function SelectableLayerTree({
  layers,
  depth = 0,
  parentVisible = true,
  selectedIds,
  onToggle,
}: SelectableLayerTreeProps) {
  const reversed = useMemo(() => [...layers].reverse(), [layers]);
  return (
    <div className="text-xs space-y-0.5">
      {reversed.map((layer) => (
        <SelectableLayerItem
          key={layer.id}
          layer={layer}
          depth={depth}
          parentVisible={parentVisible}
          selectedIds={selectedIds}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}

interface SelectableLayerItemProps {
  layer: LayerNode;
  depth: number;
  parentVisible: boolean;
  selectedIds: Set<string>;
  onToggle: (node: LayerNode) => void;
}

function SelectableLayerItem({
  layer,
  depth,
  parentVisible,
  selectedIds,
  onToggle,
}: SelectableLayerItemProps) {
  const [isExpanded, setIsExpanded] = useState(depth < 2);
  const hasChildren = layer.children && layer.children.length > 0;
  const effectiveVisible = layer.visible && parentVisible;

  // Check selection state
  const isSelected = selectedIds.has(layer.id);
  const isGroupPartiallySelected = useMemo(() => {
    if (!hasChildren) return false;
    const leafIds = collectAllLeafIds(layer);
    const selectedCount = leafIds.filter((id) => selectedIds.has(id)).length;
    return selectedCount > 0 && selectedCount < leafIds.length;
  }, [hasChildren, layer, selectedIds]);
  const isGroupFullySelected = useMemo(() => {
    if (!hasChildren) return false;
    const leafIds = collectAllLeafIds(layer);
    return leafIds.length > 0 && leafIds.every((id) => selectedIds.has(id));
  }, [hasChildren, layer, selectedIds]);

  const highlighted = isSelected || isGroupFullySelected;

  const getLayerIcon = () => {
    const iconClass = `w-3.5 h-3.5 ${effectiveVisible ? "" : "opacity-35"}`;
    switch (layer.type) {
      case "group":
        return (
          <svg
            className={`${iconClass} text-manga-lavender`}
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
          </svg>
        );
      case "text":
        return (
          <svg className={`${iconClass} text-[#f06292]`} viewBox="0 0 20 20" fill="currentColor">
            <path d="M5 4h10v2.5h-1.2V5.5H10.6V14h1.5v1.5h-4.2V14h1.5V5.5H6.2v1H5V4z" />
          </svg>
        );
      case "adjustment":
        return (
          <svg className={`${iconClass} text-accent-warm`} viewBox="0 0 20 20" fill="currentColor">
            <path d="M10 2a8 8 0 100 16 8 8 0 000-16zM4 10a6 6 0 0112 0H4z" />
          </svg>
        );
      case "smartObject":
        return (
          <svg
            className={`${iconClass} text-accent-tertiary`}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path d="M10 2L3 6v8l7 4 7-4V6l-7-4zm0 2.24L14.5 7 10 9.76 5.5 7 10 4.24z" />
          </svg>
        );
      case "shape":
        return (
          <svg className={`${iconClass} text-[#59a8f8]`} viewBox="0 0 20 20" fill="currentColor">
            <path d="M3 3h14v14H3V3zm2 2v10h10V5H5z" />
          </svg>
        );
      default:
        return (
          <svg className={`${iconClass} text-[#42a5f5]`} viewBox="0 0 20 20" fill="currentColor">
            <path d="M2 5a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V5zm2 0v6.586l3.293-3.293a1 1 0 011.414 0L13 12.586l1.293-1.293a1 1 0 011.414 0L16 11.586V5H4zm0 10v-1l3.293-3.293L12 15.414V15H4zm12 0v-1.586l-2-2-1.293 1.293L15.414 15H16zM13.5 8a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
          </svg>
        );
    }
  };

  return (
    <div>
      <div
        className={`
          flex items-center gap-1.5 py-1 px-1.5 rounded-lg transition-all duration-150
          cursor-pointer
          ${
            highlighted
              ? "bg-[rgba(194,90,90,0.15)] hover:bg-[rgba(194,90,90,0.25)]"
              : isGroupPartiallySelected
                ? "bg-[rgba(194,90,90,0.07)] hover:bg-[rgba(194,90,90,0.12)]"
                : "hover:bg-white/5"
          }
        `}
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
        onClick={() => onToggle(layer)}
      >
        {/* Expand/Collapse Button */}
        {hasChildren ? (
          <button
            className="w-4 h-4 flex items-center justify-center text-text-muted hover:text-accent transition-colors rounded"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
          >
            <svg
              className={`w-3 h-3 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        ) : (
          <div className="w-4" />
        )}

        {/* Visibility Indicator */}
        <div
          className={`w-4 h-4 flex items-center justify-center rounded transition-colors ${
            effectiveVisible ? "text-accent-tertiary" : "text-text-muted"
          }`}
        >
          {layer.visible ? (
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
              <path
                fillRule="evenodd"
                d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z"
                clipRule="evenodd"
              />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z"
                clipRule="evenodd"
              />
              <path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z" />
            </svg>
          )}
        </div>

        {/* Layer Type Icon */}
        <div className="flex-shrink-0">{getLayerIcon()}</div>

        {/* Layer Name */}
        <span
          className={`truncate flex-1 ${
            effectiveVisible ? "text-text-primary" : "text-text-muted/50"
          }`}
          title={layer.name}
        >
          {layer.name}
        </span>

        {/* Badges */}
        <div className={`flex items-center gap-1 ${effectiveVisible ? "" : "opacity-40"}`}>
          {layer.clipping && (
            <span className="text-[9px] px-1 py-0.5 rounded bg-accent/15 text-accent flex-shrink-0">
              clip
            </span>
          )}
          {layer.opacity < 100 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-text-muted ml-auto flex-shrink-0">
              {layer.opacity}%
            </span>
          )}
        </div>
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div className="relative">
          <div
            className="absolute left-0 top-0 bottom-2 w-px bg-white/10"
            style={{ marginLeft: `${depth * 14 + 12}px` }}
          />
          <SelectableLayerTree
            layers={layer.children!}
            depth={depth + 1}
            parentVisible={effectiveVisible}
            selectedIds={selectedIds}
            onToggle={onToggle}
          />
        </div>
      )}
    </div>
  );
}
