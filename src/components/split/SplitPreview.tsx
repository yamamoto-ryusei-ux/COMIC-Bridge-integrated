import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { usePsdStore } from "../../store/psdStore";
import { useSplitStore, computeMargins } from "../../store/splitStore";
import { useHighResPreview } from "../../hooks/useHighResPreview";
import { CanvasRuler, RULER_SIZE } from "../guide-editor/CanvasRuler";

interface PreviewGuide {
  position: number; // image px (vertical only)
}

type Interaction =
  | { type: "ruler-drag" }
  | { type: "guide-move"; index: number }
  | { type: "rect-select"; startX: number; startY: number };

export function SplitPreview() {
  const files = usePsdStore((s) => s.files);
  const activeFileId = usePsdStore((s) => s.activeFileId);
  const mode = useSplitStore((s) => s.settings.mode);
  const selectionBounds = useSplitStore((s) => s.settings.selectionBounds);
  const setSettings = useSplitStore((s) => s.setSettings);
  const undoSelection = useSplitStore((s) => s.undoSelection);
  const redoSelection = useSplitStore((s) => s.redoSelection);
  const selectionHistory = useSplitStore((s) => s.selectionHistory);
  const selectionFuture = useSplitStore((s) => s.selectionFuture);
  const startDragSelection = useSplitStore((s) => s.startDragSelection);
  const setSelectionBoundsDirect = useSplitStore((s) => s.setSelectionBoundsDirect);

  const referenceFile = useMemo(() => {
    if (activeFileId) return files.find((f) => f.id === activeFileId);
    return files.length > 1 ? files[1] : files[0];
  }, [files, activeFileId]);

  const { imageUrl, originalSize, isLoading } = useHighResPreview(referenceFile?.filePath, {
    maxSize: 1200,
    pdfPageIndex: referenceFile?.pdfPageIndex,
    pdfSourcePath: referenceFile?.pdfSourcePath,
  });

  // --- Sizing ---
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setContainerSize({ width, height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const imageSize =
    originalSize || referenceFile?.metadata
      ? {
          width: originalSize?.width ?? referenceFile!.metadata!.width,
          height: originalSize?.height ?? referenceFile!.metadata!.height,
        }
      : null;

  // --- Zoom ---
  const [zoom, setZoom] = useState(1);
  const showScrollbars = zoom > 1;

  const padding = 16;
  const availW = Math.max(1, containerSize.width - padding * 2);
  const availH = Math.max(1, containerSize.height - padding * 2);

  const baseScale = imageSize
    ? Math.min(availW / imageSize.width, availH / imageSize.height, 1)
    : 1;
  const scale = baseScale * zoom;
  const scaledW = imageSize ? imageSize.width * scale : 0;
  const scaledH = imageSize ? imageSize.height * scale : 0;
  const offsetX = Math.max(0, (containerSize.width - scaledW) / 2);
  const offsetY = Math.max(0, (containerSize.height - scaledH) / 2);

  const halfWidth = imageSize ? Math.floor(imageSize.width / 2) : 0;

  // --- Pan state ---
  const [isPanning, setIsPanning] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0, scrollX: 0, scrollY: 0 });

  // --- Coordinate transform (accounts for scroll position) ---
  const getImageCoords = useCallback(
    (clientX: number, clientY: number) => {
      const el = scrollRef.current;
      if (!el) return { x: 0, y: 0 };
      const rect = el.getBoundingClientRect();
      const localX = clientX - rect.left + el.scrollLeft;
      const localY = clientY - rect.top + el.scrollTop;
      return {
        x: Math.round((localX - offsetX) / scale),
        y: Math.round((localY - offsetY) / scale),
      };
    },
    [offsetX, offsetY, scale],
  );

  // --- Local guide state (uneven mode only) ---
  const [previewGuides, setPreviewGuides] = useState<PreviewGuide[]>([]);
  const [selectedGuideIndex, setSelectedGuideIndex] = useState<number | null>(null);
  const [interaction, setInteraction] = useState<Interaction | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const historyPushedRef = useRef(false);

  useEffect(() => {
    if (mode !== "uneven") {
      setPreviewGuides([]);
      setSelectedGuideIndex(null);
      setInteraction(null);
      setDragPos(null);
    }
  }, [mode]);

  const canApplyGuides = previewGuides.length >= 2;

  const handleApplyGuides = useCallback(() => {
    if (!canApplyGuides) return;
    const positions = previewGuides.map((g) => g.position).sort((a, b) => a - b);
    const left = positions[0];
    const right = positions[positions.length - 1];
    if (right > left) {
      setSettings({ selectionBounds: { left, right } });
    }
    setPreviewGuides([]);
    setSelectedGuideIndex(null);
  }, [canApplyGuides, previewGuides, setSettings]);

  // --- Ruler drag start (vertical guides only) ---
  const handleRulerDragStart = useCallback(
    (_direction: "horizontal" | "vertical", _e: React.MouseEvent) => {
      if (mode !== "uneven" || !imageSize) return;
      setInteraction({ type: "ruler-drag" });
    },
    [mode, imageSize],
  );

  // --- Guide move start ---
  const handleGuideMoveStart = useCallback(
    (index: number, e: React.MouseEvent) => {
      if (isSpacePressed && zoom > 1) return;
      e.stopPropagation();
      e.preventDefault();
      setInteraction({ type: "guide-move", index });
    },
    [isSpacePressed, zoom],
  );

  // --- Preview mousedown: pan or rect-select ---
  const handlePreviewMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Pan takes priority when space is held
      if (isSpacePressed && zoom > 1 && scrollRef.current) {
        setIsPanning(true);
        setPanStart({
          x: e.clientX,
          y: e.clientY,
          scrollX: scrollRef.current.scrollLeft,
          scrollY: scrollRef.current.scrollTop,
        });
        e.preventDefault();
        return;
      }

      if (interaction) {
        setInteraction(null);
        setDragPos(null);
        return;
      }
      if (mode !== "uneven" || !imageSize) return;

      const { x: ix, y: iy } = getImageCoords(e.clientX, e.clientY);
      if (ix >= 0 && ix <= imageSize.width && iy >= 0 && iy <= imageSize.height) {
        historyPushedRef.current = false;
        setInteraction({ type: "rect-select", startX: ix, startY: iy });
        setDragPos({ x: ix, y: iy });
      }
    },
    [isSpacePressed, zoom, interaction, mode, imageSize, getImageCoords],
  );

  // --- Wheel zoom ---
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom((z) => Math.max(0.25, Math.min(4, z * delta)));
    }
  }, []);

  // --- Global mouse tracking (interaction + pan) ---
  useEffect(() => {
    if (!interaction && !isPanning) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (isPanning && scrollRef.current) {
        const dx = e.clientX - panStart.x;
        const dy = e.clientY - panStart.y;
        scrollRef.current.scrollLeft = panStart.scrollX - dx;
        scrollRef.current.scrollTop = panStart.scrollY - dy;
        return;
      }

      if (!interaction || !imageSize) return;
      const { x: ix, y: iy } = getImageCoords(e.clientX, e.clientY);
      const cx = Math.max(0, Math.min(ix, imageSize.width));
      const cy = Math.max(0, Math.min(iy, imageSize.height));
      setDragPos({ x: cx, y: cy });

      if (interaction.type === "rect-select") {
        const left = Math.min(interaction.startX, cx);
        const right = Math.max(interaction.startX, cx);
        if (right - left > 5) {
          if (!historyPushedRef.current) {
            startDragSelection();
            historyPushedRef.current = true;
          }
          setSelectionBoundsDirect({ left, right });
        }
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (isPanning) {
        setIsPanning(false);
        return;
      }

      if (!interaction || !imageSize) {
        setInteraction(null);
        setDragPos(null);
        return;
      }

      const { x: ix } = getImageCoords(e.clientX, e.clientY);
      const cx = Math.max(0, Math.min(ix, imageSize.width));

      if (interaction.type === "ruler-drag") {
        if (cx > 0 && cx < imageSize.width) {
          setPreviewGuides((prev) => {
            setSelectedGuideIndex(prev.length);
            return [...prev, { position: cx }];
          });
        }
      } else if (interaction.type === "guide-move") {
        const guide = previewGuides[interaction.index];
        if (guide) {
          if (cx <= 0 || cx >= imageSize.width) {
            setPreviewGuides((prev) => prev.filter((_, i) => i !== interaction.index));
            setSelectedGuideIndex(null);
          } else {
            setPreviewGuides((prev) =>
              prev.map((g, i) => (i === interaction.index ? { ...g, position: cx } : g)),
            );
            setSelectedGuideIndex(interaction.index);
          }
        }
      }

      setInteraction(null);
      setDragPos(null);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [
    interaction,
    isPanning,
    panStart,
    imageSize,
    getImageCoords,
    previewGuides,
    setSelectionBoundsDirect,
    startDragSelection,
  ]);

  // --- Keyboard shortcuts ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Space: pan mode
      if (e.key === " " && !isSpacePressed) {
        e.preventDefault();
        setIsSpacePressed(true);
      }

      // Ctrl + (+/=): Zoom in
      if (e.ctrlKey && (e.key === "+" || e.key === "=" || e.key === ";")) {
        e.preventDefault();
        setZoom((z) => Math.min(4, z * 1.25));
      }

      // Ctrl + (-): Zoom out
      if (e.ctrlKey && e.key === "-") {
        e.preventDefault();
        setZoom((z) => Math.max(0.25, z * 0.8));
      }

      // Ctrl + 0: Reset zoom
      if (e.ctrlKey && e.key === "0") {
        e.preventDefault();
        setZoom(1);
      }

      // Ctrl + Z: Undo
      if (e.ctrlKey && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        if (previewGuides.length > 0) {
          setPreviewGuides((prev) => prev.slice(0, -1));
        } else {
          undoSelection();
        }
      }

      // Ctrl + Y / Ctrl + Shift + Z: Redo
      if (e.ctrlKey && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        redoSelection();
      }

      // Arrow keys: move selected guide
      if (
        (e.key === "ArrowLeft" || e.key === "ArrowRight") &&
        mode === "uneven" &&
        selectedGuideIndex !== null &&
        selectedGuideIndex < previewGuides.length &&
        imageSize
      ) {
        e.preventDefault();
        const delta = (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 10 : 1);
        setPreviewGuides((prev) =>
          prev.map((g, i) =>
            i === selectedGuideIndex
              ? { ...g, position: Math.max(1, Math.min(imageSize.width - 1, g.position + delta)) }
              : g,
          ),
        );
      }

      // Tab: cycle selected guide
      if (e.key === "Tab" && mode === "uneven" && previewGuides.length > 0) {
        e.preventDefault();
        setSelectedGuideIndex((prev) => (prev === null ? 0 : (prev + 1) % previewGuides.length));
      }

      // Delete / Backspace
      if ((e.key === "Delete" || e.key === "Backspace") && mode === "uneven") {
        e.preventDefault();
        if (selectedGuideIndex !== null && selectedGuideIndex < previewGuides.length) {
          setPreviewGuides((prev) => prev.filter((_, i) => i !== selectedGuideIndex));
          setSelectedGuideIndex(null);
        } else if (previewGuides.length > 0) {
          setPreviewGuides((prev) => prev.slice(0, -1));
        } else if (selectionBounds) {
          setSettings({ selectionBounds: null });
        }
      }

      // Escape: deselect guide
      if (e.key === "Escape" && selectedGuideIndex !== null) {
        e.preventDefault();
        setSelectedGuideIndex(null);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") {
        setIsSpacePressed(false);
        setIsPanning(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [
    isSpacePressed,
    undoSelection,
    redoSelection,
    selectionBounds,
    setSettings,
    mode,
    previewGuides.length,
    selectedGuideIndex,
    imageSize,
  ]);

  // Margin computation
  const margins = useMemo(() => {
    if (!selectionBounds || !imageSize) return null;
    return computeMargins(selectionBounds, imageSize.width);
  }, [selectionBounds, imageSize]);

  // Cursor
  const getCursor = (): string => {
    if (isSpacePressed && zoom > 1) return isPanning ? "grabbing" : "grab";
    if (!interaction) return mode === "uneven" ? "crosshair" : "default";
    if (interaction.type === "ruler-drag") return "col-resize";
    if (interaction.type === "guide-move") return "col-resize";
    return "crosshair";
  };

  const showRulers = mode === "uneven" && !!imageSize;

  // --- Empty state ---
  if (!referenceFile) {
    return (
      <div className="flex items-center justify-center h-full bg-bg-primary">
        <div className="text-center px-6">
          <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-bg-tertiary flex items-center justify-center">
            <svg
              className="w-7 h-7 text-text-muted"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
              />
            </svg>
          </div>
          <p className="text-xs text-text-muted">ファイルを選択してプレビュー</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-bg-primary">
      {/* Header */}
      <div className="px-3 py-1.5 border-b border-border flex items-center gap-2 flex-shrink-0">
        <span className="text-[10px] text-text-muted">基準:</span>
        <span className="text-xs font-medium text-text-primary truncate">
          {referenceFile.fileName}
        </span>
        {imageSize && (
          <span className="text-[10px] text-text-muted ml-auto flex-shrink-0">
            {imageSize.width} x {imageSize.height}
          </span>
        )}
        {mode === "uneven" && (
          <div className="flex items-center gap-0.5 ml-2 flex-shrink-0">
            <button
              className="p-1 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors disabled:opacity-30 disabled:cursor-default"
              disabled={selectionHistory.length === 0 && previewGuides.length === 0}
              onClick={() => {
                if (previewGuides.length > 0) {
                  setPreviewGuides((prev) => prev.slice(0, -1));
                } else {
                  undoSelection();
                }
              }}
              title="元に戻す (Ctrl+Z)"
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
                  d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"
                />
              </svg>
            </button>
            <button
              className="p-1 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors disabled:opacity-30 disabled:cursor-default"
              disabled={selectionFuture.length === 0}
              onClick={redoSelection}
              title="やり直す (Ctrl+Y)"
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
                  d="M15 15l6-6m0 0l-6-6m6 6H9a6 6 0 000 12h3"
                />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Step guide (uneven mode) */}
      {mode === "uneven" &&
        imageSize &&
        (() => {
          const step = selectionBounds ? 3 : canApplyGuides ? 2 : 1;
          return (
            <div className="px-4 py-2.5 border-b border-border/50 bg-gradient-to-r from-bg-secondary to-bg-secondary/80 flex-shrink-0">
              <div className="flex items-center gap-1">
                {/* Step 1 */}
                <StepChip n={1} current={step} label="左ページにガイドを2本引く" />
                <StepConnector done={step > 1} />
                {/* Step 2 - clickable button when active */}
                {step === 2 ? (
                  <button
                    onClick={handleApplyGuides}
                    className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-gradient-to-r from-[#00bcd4] to-[#00e5ff] hover:from-[#00acc1] hover:to-[#00d4f5] text-white text-sm font-medium shadow-[0_2px_8px_rgba(0,229,255,0.3)] hover:shadow-[0_4px_12px_rgba(0,229,255,0.4)] transition-all hover:-translate-y-px"
                  >
                    <span className="w-5 h-5 rounded-full bg-white/25 text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                      2
                    </span>
                    ガイドを適用
                  </button>
                ) : (
                  <StepChip n={2} current={step} label="ガイドを適用" />
                )}
                <StepConnector done={step > 2} />
                {/* Step 3 */}
                <StepChip n={3} current={step} label="サイドバーから実行" />
              </div>
            </div>
          );
        })()}

      {/* Grid: vertical ruler (uneven only, for vertical guides) + preview */}
      <div
        className="flex-1 overflow-hidden"
        style={{
          display: "grid",
          gridTemplateColumns: showRulers ? `${RULER_SIZE}px 1fr` : "1fr",
          gridTemplateRows: "1fr",
        }}
      >
        {showRulers && (
          <div className="overflow-hidden" style={{ borderRight: "1px solid #ddd8d3" }}>
            <CanvasRuler
              direction="vertical"
              length={containerSize.height}
              imageSize={imageSize}
              scaledImageSize={scaledH}
              offset={offsetY}
              zoom={zoom}
              onDragStart={handleRulerDragStart}
            />
          </div>
        )}

        {/* Preview area (non-scrolling wrapper for fixed overlays) */}
        <div ref={containerRef} className="relative overflow-hidden">
          {/* Scrollable content */}
          <div
            ref={scrollRef}
            className="absolute inset-0"
            style={{
              overflow: showScrollbars ? "auto" : "hidden",
              cursor: getCursor(),
            }}
            onMouseDown={handlePreviewMouseDown}
            onWheel={handleWheel}
          >
            {/* Zoom wrapper */}
            <div
              style={{
                width: showScrollbars ? scaledW : "100%",
                height: showScrollbars ? scaledH : "100%",
                minWidth: "100%",
                minHeight: "100%",
                display: "flex",
                alignItems: showScrollbars ? "flex-start" : "center",
                justifyContent: showScrollbars ? "flex-start" : "center",
              }}
            >
              {imageUrl && imageSize && (
                <div className="relative" style={{ width: scaledW, height: scaledH }}>
                  <img
                    src={imageUrl}
                    alt="Preview"
                    className="w-full h-full object-fill pointer-events-none select-none"
                    draggable={false}
                  />

                  {/* Page zone tinting */}
                  {mode !== "none" && (
                    <>
                      <div
                        className="absolute top-0 bottom-0 left-0 pointer-events-none"
                        style={{
                          width: halfWidth * scale,
                          background: "rgba(0, 229, 255, 0.03)",
                        }}
                      />
                      <div
                        className="absolute top-0 bottom-0 pointer-events-none"
                        style={{
                          left: halfWidth * scale,
                          width: (imageSize.width - halfWidth) * scale,
                          background: "rgba(0, 188, 212, 0.03)",
                        }}
                      />
                    </>
                  )}

                  {/* Right page lockout overlay (uneven mode, before guide apply) */}
                  {mode === "uneven" && !selectionBounds && (
                    <div
                      className="absolute top-0 bottom-0 pointer-events-none z-[5]"
                      style={{
                        left: halfWidth * scale,
                        width: (imageSize.width - halfWidth) * scale,
                        background: "rgba(0, 0, 0, 0.35)",
                      }}
                    >
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="flex flex-col items-center gap-1 opacity-60">
                          <svg
                            className="w-5 h-5 text-white/50"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={1.5}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
                            />
                          </svg>
                          <span className="text-[9px] text-white/40 whitespace-nowrap">
                            右ページ
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Center line */}
                  {mode !== "none" && (
                    <div
                      className="absolute top-0 bottom-0 pointer-events-none z-10"
                      style={{
                        left: halfWidth * scale - 1,
                        width: 2,
                        background:
                          "repeating-linear-gradient(180deg, #00e5ff 0, #00e5ff 6px, transparent 6px, transparent 12px)",
                        opacity: 0.7,
                      }}
                    />
                  )}

                  {/* Selection bounds (confirmed) */}
                  {selectionBounds && mode === "uneven" && (
                    <>
                      <div
                        className="absolute top-0 bottom-0 pointer-events-none z-10"
                        style={{
                          left: selectionBounds.left * scale,
                          width: (selectionBounds.right - selectionBounds.left) * scale,
                          background: "rgba(0, 229, 255, 0.06)",
                        }}
                      />
                      <div
                        className="absolute top-0 bottom-0 z-20 pointer-events-none"
                        style={{
                          left: selectionBounds.left * scale,
                          width: 1,
                          background: "#00e5ff",
                          boxShadow: "0 0 3px rgba(0, 229, 255, 0.3)",
                        }}
                      />
                      <div
                        className="absolute top-0 bottom-0 z-20 pointer-events-none"
                        style={{
                          left: selectionBounds.right * scale,
                          width: 1,
                          background: "#00e5ff",
                          boxShadow: "0 0 3px rgba(0, 229, 255, 0.3)",
                        }}
                      />
                    </>
                  )}

                  {/* Overlap warning zone */}
                  {selectionBounds && mode === "uneven" && selectionBounds.right > halfWidth && (
                    <div
                      className="absolute pointer-events-none"
                      style={{
                        left: halfWidth * scale,
                        top: 0,
                        width: (selectionBounds.right - halfWidth) * scale,
                        height: scaledH,
                        background: "rgba(239, 68, 68, 0.15)",
                        zIndex: 15,
                      }}
                    />
                  )}

                  {/* Preview guides (vertical, draggable) */}
                  {previewGuides.map((guide, idx) => {
                    const isMoving =
                      interaction?.type === "guide-move" && interaction.index === idx;
                    const isSelected = selectedGuideIndex === idx;
                    const pos = isMoving ? (dragPos?.x ?? guide.position) : guide.position;
                    const screenPos = pos * scale;

                    return (
                      <div key={`g-${idx}`}>
                        <div
                          className="absolute top-0 bottom-0 pointer-events-none z-20"
                          style={{
                            left: screenPos,
                            width: 1,
                            background: isSelected ? "#ffeb3b" : "#00e5ff",
                            boxShadow: isSelected
                              ? "0 0 4px rgba(255, 235, 59, 0.5)"
                              : "0 0 3px rgba(0, 229, 255, 0.4)",
                            opacity: isMoving ? 0.6 : 1,
                          }}
                        />
                        <div
                          className="absolute top-0 bottom-0 z-30"
                          style={{
                            left: screenPos - 7,
                            width: 14,
                            cursor: "col-resize",
                          }}
                          onMouseDown={(e) => {
                            setSelectedGuideIndex(idx);
                            handleGuideMoveStart(idx, e);
                          }}
                        />
                        <div
                          className="absolute z-30 pointer-events-none"
                          style={{ left: screenPos + 4, top: 4 }}
                        >
                          <span
                            className="px-1 py-0.5 text-[8px] rounded"
                            style={{
                              background: isSelected ? "rgba(255,235,59,0.85)" : "rgba(0,0,0,0.7)",
                              color: isSelected ? "#000" : "#00e5ff",
                            }}
                          >
                            {Math.round(pos)}px
                          </span>
                        </div>
                      </div>
                    );
                  })}

                  {/* Drag preview line (ruler drag → vertical) */}
                  {interaction?.type === "ruler-drag" && dragPos && (
                    <div
                      className="absolute top-0 bottom-0 pointer-events-none z-30"
                      style={{
                        left: dragPos.x * scale,
                        width: 1,
                        background: "#00e5ff",
                        boxShadow: "0 0 4px rgba(0, 229, 255, 0.5)",
                        opacity: 0.6,
                      }}
                    />
                  )}

                  {/* Rect-select rectangle overlay */}
                  {interaction?.type === "rect-select" && dragPos && (
                    <div
                      className="absolute pointer-events-none"
                      style={{
                        left: Math.min(interaction.startX, dragPos.x) * scale,
                        top: Math.min(interaction.startY, dragPos.y) * scale,
                        width: Math.abs(dragPos.x - interaction.startX) * scale,
                        height: Math.abs(dragPos.y - interaction.startY) * scale,
                        border: "1px dashed #00e5ff",
                        background: "rgba(0, 229, 255, 0.06)",
                        zIndex: 15,
                      }}
                    />
                  )}

                  {/* Margin dimension labels */}
                  {selectionBounds && margins && mode === "uneven" && !interaction && (
                    <>
                      {margins.outerMargin > 0 && (
                        <div
                          className="absolute pointer-events-none z-30 flex items-center"
                          style={{
                            left: 0,
                            top: scaledH / 2 - 16,
                            width: selectionBounds.left * scale,
                            height: 32,
                          }}
                        >
                          <div className="w-full flex flex-col items-center gap-0">
                            <span className="text-[7px] text-white/60 leading-none">外側余白</span>
                            <div className="w-full flex items-center gap-px">
                              <div className="flex-1 h-px bg-[#00e5ff]/40" />
                              <span className="px-1.5 py-0.5 text-[9px] bg-black/70 text-[#00e5ff] rounded whitespace-nowrap font-medium">
                                {margins.outerMargin}px
                              </span>
                              <div className="flex-1 h-px bg-[#00e5ff]/40" />
                            </div>
                          </div>
                        </div>
                      )}
                      {margins.innerMargin > 0 && (
                        <div
                          className="absolute pointer-events-none z-30 flex items-center"
                          style={{
                            left: selectionBounds.right * scale,
                            top: scaledH / 2 - 16,
                            width: Math.max(0, halfWidth - selectionBounds.right) * scale,
                            height: 32,
                          }}
                        >
                          <div className="w-full flex flex-col items-center gap-0">
                            <span className="text-[7px] text-white/60 leading-none">ノド</span>
                            <div className="w-full flex items-center gap-px">
                              <div className="flex-1 h-px bg-[#00e5ff]/40" />
                              <span className="px-1.5 py-0.5 text-[9px] bg-black/70 text-[#00e5ff] rounded whitespace-nowrap font-medium">
                                {margins.innerMargin}px
                              </span>
                              <div className="flex-1 h-px bg-[#00e5ff]/40" />
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Loading indicator (fixed in viewport) */}
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center z-50 pointer-events-none">
              <div className="w-8 h-8 rounded-full border-3 border-[#00e5ff]/30 border-t-[#00e5ff] animate-spin" />
            </div>
          )}

          {/* Bottom bar (fixed in viewport) */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-bg-secondary/90 backdrop-blur-sm px-3 py-1.5 rounded-lg border border-border/50 pointer-events-none">
            {mode === "uneven" && selectionBounds && margins && imageSize && (
              <MiniOutputPreview margins={margins} imageHeight={imageSize.height} />
            )}

            <span className="text-[10px] text-text-muted">
              {mode === "uneven"
                ? selectionBounds
                  ? `出力: ${margins?.finalWidth ?? "?"} x ${imageSize?.height ?? "?"}px`
                  : previewGuides.length > 0
                    ? `ガイド: ${previewGuides.length}/2`
                    : "左の定規からドラッグでガイド / ドラッグで範囲選択"
                : mode === "even"
                  ? "中央ラインで均等分割"
                  : "分割なし（フォーマット変換のみ）"}
            </span>
          </div>

          {/* Zoom indicator (fixed in viewport) */}
          {zoom !== 1 && (
            <div className="absolute bottom-2 right-2 z-40 bg-bg-secondary/90 px-2.5 py-1 rounded-md text-[10px] text-text-muted backdrop-blur-sm border border-border/50 pointer-events-none">
              {Math.round(zoom * 100)}%
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Mini output preview ---
function MiniOutputPreview({
  margins,
  imageHeight,
}: {
  margins: ReturnType<typeof computeMargins>;
  imageHeight: number;
}) {
  const miniScale = 40 / margins.finalWidth;
  const miniH = Math.round(imageHeight * miniScale);
  const miniW = Math.round(margins.finalWidth * miniScale);
  const marginW = Math.max(1, Math.round(margins.marginToAdd * miniScale));
  const contentW = miniW - marginW;

  return (
    <div className="flex items-center gap-1">
      <div className="flex flex-col items-center">
        <div className="flex" style={{ height: Math.min(miniH, 36) }}>
          {marginW > 0 && (
            <div
              className="border-y border-l border-[#00e5ff]/40"
              style={{
                width: marginW,
                background:
                  "repeating-linear-gradient(45deg, rgba(0,229,255,0.12) 0, rgba(0,229,255,0.12) 2px, transparent 2px, transparent 4px)",
              }}
            />
          )}
          <div
            className="border border-[#00e5ff]/40"
            style={{ width: contentW, background: "rgba(0,229,255,0.05)" }}
          />
        </div>
        <span className="text-[7px] text-[#00e5ff]/70 mt-0.5">R</span>
      </div>
      <div className="flex flex-col items-center">
        <div className="flex" style={{ height: Math.min(miniH, 36) }}>
          <div
            className="border border-[#00bcd4]/40"
            style={{ width: contentW, background: "rgba(0,188,212,0.05)" }}
          />
          {marginW > 0 && (
            <div
              className="border-y border-r border-[#00bcd4]/40"
              style={{
                width: marginW,
                background:
                  "repeating-linear-gradient(45deg, rgba(0,188,212,0.12) 0, rgba(0,188,212,0.12) 2px, transparent 2px, transparent 4px)",
              }}
            />
          )}
        </div>
        <span className="text-[7px] text-[#00bcd4]/70 mt-0.5">L</span>
      </div>
      {margins.marginToAdd > 0 && (
        <span className="text-[8px] text-[#00e5ff]/60 ml-0.5">+{margins.marginToAdd}px</span>
      )}
    </div>
  );
}

// --- Step indicator chip ---
function StepChip({ n, current, label }: { n: number; current: number; label: string }) {
  const done = current > n;
  const active = current === n;
  return (
    <div className="flex items-center gap-2">
      <span
        className="w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center flex-shrink-0"
        style={{
          background: active ? "#00e5ff" : done ? "rgba(0,229,255,0.3)" : "rgba(255,255,255,0.08)",
          color: active ? "#000" : done ? "#00e5ff" : "rgba(255,255,255,0.3)",
        }}
      >
        {done ? "\u2713" : n}
      </span>
      <span
        className={`text-xs ${active ? "text-text-primary font-medium" : "text-text-muted/50"}`}
      >
        {label}
      </span>
    </div>
  );
}

// --- Step connector arrow ---
function StepConnector({ done }: { done: boolean }) {
  return (
    <div className="flex items-center px-1.5">
      <div
        className="w-6 h-px"
        style={{ background: done ? "rgba(0,229,255,0.4)" : "rgba(255,255,255,0.1)" }}
      />
      <div
        className="w-0 h-0 border-t-[3px] border-t-transparent border-b-[3px] border-b-transparent border-l-[5px]"
        style={{ borderLeftColor: done ? "rgba(0,229,255,0.4)" : "rgba(255,255,255,0.1)" }}
      />
    </div>
  );
}
