import { useRef, useState, useEffect, useCallback } from "react";
import { useGuideStore } from "../../store/guideStore";
import { CanvasRuler, RULER_SIZE } from "./CanvasRuler";

interface GuideCanvasProps {
  imageUrl?: string;
  imageSize: { width: number; height: number };
  isLoading?: boolean;
}

/** ガイドのヒットエリア半径 (片側px) */
const GUIDE_HIT_HALF = 5;

/**
 * Guide editing canvas with Photoshop-style rulers.
 * Supports drag-to-create guides, zoom, and pan.
 */
export function GuideCanvas({ imageUrl, imageSize, isLoading }: GuideCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [dragDirection, setDragDirection] = useState<"horizontal" | "vertical" | null>(null);
  const [previewPosition, setPreviewPosition] = useState<number | null>(null);

  // Pan state
  const [isPanning, setIsPanning] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0, scrollX: 0, scrollY: 0 });

  // Guide drag state
  const [draggingGuideIndex, setDraggingGuideIndex] = useState<number | null>(null);
  const justClickedGuideRef = useRef(false);

  const guides = useGuideStore((state) => state.guides);
  const addGuide = useGuideStore((state) => state.addGuide);
  const updateGuide = useGuideStore((state) => state.updateGuide);
  const moveGuide = useGuideStore((state) => state.moveGuide);
  const pushHistory = useGuideStore((state) => state.pushHistory);
  const selectedGuideIndex = useGuideStore((state) => state.selectedGuideIndex);
  const setSelectedGuideIndex = useGuideStore((state) => state.setSelectedGuideIndex);
  const removeGuide = useGuideStore((state) => state.removeGuide);
  const undo = useGuideStore((state) => state.undo);
  const redo = useGuideStore((state) => state.redo);

  // Calculate preview area dimensions (excluding rulers)
  const previewAreaWidth = Math.max(0, containerSize.width - RULER_SIZE);
  const previewAreaHeight = Math.max(0, containerSize.height - RULER_SIZE);

  // Calculate scale to fit image in preview area
  const baseScale = Math.min(
    previewAreaWidth / imageSize.width,
    previewAreaHeight / imageSize.height,
    1,
  );
  const scale = baseScale * zoom;

  const scaledWidth = imageSize.width * scale;
  const scaledHeight = imageSize.height * scale;

  // Calculate offset to center the image in the preview area
  const offsetX = Math.max(0, (previewAreaWidth - scaledWidth) / 2);
  const offsetY = Math.max(0, (previewAreaHeight - scaledHeight) / 2);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Convert screen position (relative to preview container) to image position
  const screenToImage = useCallback(
    (screenX: number, screenY: number) => {
      return {
        x: Math.round((screenX - offsetX) / scale),
        y: Math.round((screenY - offsetY) / scale),
      };
    },
    [offsetX, offsetY, scale],
  );

  // Ruler drag start (creates new guide)
  const handleRulerDragStart = (direction: "horizontal" | "vertical", e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    setDragDirection(direction);
  };

  // Guide mousedown → select + start drag
  const handleGuideMouseDown = useCallback(
    (index: number, e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      justClickedGuideRef.current = true;
      setSelectedGuideIndex(index);
      pushHistory(); // 移動前の状態を保存
      setDraggingGuideIndex(index);
    },
    [setSelectedGuideIndex, pushHistory],
  );

  // Mouse move during drag
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      // Handle panning
      if (isPanning && previewContainerRef.current) {
        const dx = e.clientX - panStart.x;
        const dy = e.clientY - panStart.y;
        previewContainerRef.current.scrollLeft = panStart.scrollX - dx;
        previewContainerRef.current.scrollTop = panStart.scrollY - dy;
        return;
      }

      // Handle guide dragging (move existing guide)
      if (draggingGuideIndex !== null && previewContainerRef.current) {
        const guide = guides[draggingGuideIndex];
        if (!guide) return;

        const rect = previewContainerRef.current.getBoundingClientRect();
        const scrollLeft = previewContainerRef.current.scrollLeft;
        const scrollTop = previewContainerRef.current.scrollTop;
        const pos = screenToImage(
          e.clientX - rect.left + scrollLeft,
          e.clientY - rect.top + scrollTop,
        );

        const position = guide.direction === "horizontal" ? pos.y : pos.x;
        const max = guide.direction === "horizontal" ? imageSize.height : imageSize.width;
        const clamped = Math.max(0, Math.min(max, position));
        moveGuide(draggingGuideIndex, { ...guide, position: clamped });
        return;
      }

      // Handle ruler drag (creating new guide)
      if (!isDragging || !dragDirection || !previewContainerRef.current) return;

      const rect = previewContainerRef.current.getBoundingClientRect();
      const scrollLeft = previewContainerRef.current.scrollLeft;
      const scrollTop = previewContainerRef.current.scrollTop;

      const pos = screenToImage(
        e.clientX - rect.left + scrollLeft,
        e.clientY - rect.top + scrollTop,
      );

      const position = dragDirection === "horizontal" ? pos.y : pos.x;
      const max = dragDirection === "horizontal" ? imageSize.height : imageSize.width;

      if (position >= 0 && position <= max) {
        setPreviewPosition(position);
      }
    },
    [
      isDragging,
      isPanning,
      dragDirection,
      draggingGuideIndex,
      guides,
      screenToImage,
      imageSize,
      panStart,
      moveGuide,
    ],
  );

  // Mouse up - add guide / end guide drag / end pan
  const handleMouseUp = useCallback(() => {
    // End guide drag
    if (draggingGuideIndex !== null) {
      setDraggingGuideIndex(null);
      return;
    }

    if (isPanning) {
      setIsPanning(false);
      return;
    }

    // End ruler drag → add new guide and auto-select
    if (isDragging && dragDirection && previewPosition !== null) {
      const newIndex = guides.length;
      addGuide({
        direction: dragDirection,
        position: previewPosition,
      });
      setSelectedGuideIndex(newIndex);
    }
    setIsDragging(false);
    setDragDirection(null);
    setPreviewPosition(null);
  }, [
    isDragging,
    isPanning,
    dragDirection,
    previewPosition,
    addGuide,
    guides.length,
    draggingGuideIndex,
    setSelectedGuideIndex,
  ]);

  // Keyboard events
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Delete selected guide (Backspace only)
      if (e.key === "Backspace" && selectedGuideIndex !== null) {
        removeGuide(selectedGuideIndex);
      }

      // Arrow keys: move selected guide (1px, Shift: 10px)
      if (selectedGuideIndex !== null && !e.ctrlKey) {
        const guide = useGuideStore.getState().guides[selectedGuideIndex];
        if (guide) {
          const step = e.shiftKey ? 10 : 1;
          let delta = 0;

          if (guide.direction === "horizontal") {
            if (e.key === "ArrowUp") delta = -step;
            if (e.key === "ArrowDown") delta = step;
          } else {
            if (e.key === "ArrowLeft") delta = -step;
            if (e.key === "ArrowRight") delta = step;
          }

          if (delta !== 0) {
            e.preventDefault();
            const max = guide.direction === "horizontal" ? imageSize.height : imageSize.width;
            const newPos = Math.max(0, Math.min(max, guide.position + delta));
            updateGuide(selectedGuideIndex, { ...guide, position: newPos });
          }
        }
      }

      // Space for panning
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

      // Ctrl + 0: Reset zoom (fit)
      if (e.ctrlKey && e.key === "0") {
        e.preventDefault();
        setZoom(1);
      }

      // Ctrl + Z: Undo / Ctrl + Shift + Z or Ctrl + Y: Redo
      if (e.ctrlKey && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      if (e.ctrlKey && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        redo();
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
  }, [selectedGuideIndex, removeGuide, updateGuide, isSpacePressed, undo, redo, imageSize]);

  // Zoom controls (Ctrl + wheel)
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom((z) => Math.max(0.25, Math.min(4, z * delta)));
    }
  };

  // Pan start (Space + click)
  const handlePanStart = (e: React.MouseEvent) => {
    if (isSpacePressed && zoom > 1 && previewContainerRef.current) {
      setIsPanning(true);
      setPanStart({
        x: e.clientX,
        y: e.clientY,
        scrollX: previewContainerRef.current.scrollLeft,
        scrollY: previewContainerRef.current.scrollTop,
      });
      e.preventDefault();
    }
  };

  // Deselect guide when clicking on empty area (not after guide click)
  const handleCanvasClick = () => {
    if (justClickedGuideRef.current) {
      justClickedGuideRef.current = false;
      return;
    }
    if (selectedGuideIndex !== null) {
      setSelectedGuideIndex(null);
    }
  };

  // Determine if scrollbars should be shown
  const showScrollbars = zoom > 1;

  // Guide overflow to extend beyond image to fill ruler area
  const guideOverflowX = showScrollbars ? 0 : offsetX;
  const guideOverflowY = showScrollbars ? 0 : offsetY;

  // Cursor for preview container
  const previewCursor =
    isSpacePressed && zoom > 1
      ? isPanning
        ? "grabbing"
        : "grab"
      : draggingGuideIndex !== null
        ? guides[draggingGuideIndex]?.direction === "horizontal"
          ? "ns-resize"
          : "ew-resize"
        : "default";

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-bg-tertiary rounded-lg overflow-hidden select-none"
      onWheel={handleWheel}
    >
      {/* Grid Layout: Ruler corner + Rulers + Preview */}
      <div
        className="absolute inset-0 grid"
        style={{
          gridTemplateColumns: `${RULER_SIZE}px 1fr`,
          gridTemplateRows: `${RULER_SIZE}px 1fr`,
        }}
      >
        {/* Ruler Corner */}
        <div className="bg-bg-tertiary border-r border-b border-[#e0dcd8]" />

        {/* Horizontal Ruler (creates vertical guides) */}
        <div className="overflow-hidden">
          <CanvasRuler
            direction="horizontal"
            length={previewAreaWidth}
            imageSize={imageSize}
            scaledImageSize={scaledWidth}
            offset={offsetX}
            zoom={zoom}
            onDragStart={handleRulerDragStart}
          />
        </div>

        {/* Vertical Ruler (creates horizontal guides) */}
        <div className="overflow-hidden">
          <CanvasRuler
            direction="vertical"
            length={previewAreaHeight}
            imageSize={imageSize}
            scaledImageSize={scaledHeight}
            offset={offsetY}
            zoom={zoom}
            onDragStart={handleRulerDragStart}
          />
        </div>

        {/* Preview Container */}
        <div
          ref={previewContainerRef}
          className="relative bg-bg-elevated"
          style={{
            overflow: showScrollbars ? "auto" : "hidden",
            cursor: previewCursor,
          }}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onMouseDown={handlePanStart}
          onClick={handleCanvasClick}
        >
          {/* Zoom Wrapper */}
          <div
            className="relative"
            style={{
              width: showScrollbars ? scaledWidth : "100%",
              height: showScrollbars ? scaledHeight : "100%",
              minWidth: "100%",
              minHeight: "100%",
              display: "flex",
              alignItems: showScrollbars ? "flex-start" : "center",
              justifyContent: showScrollbars ? "flex-start" : "center",
            }}
          >
            {/* Image Container */}
            <div
              className="relative"
              style={{
                width: scaledWidth,
                height: scaledHeight,
              }}
            >
              {/* Image */}
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt="Preview"
                  className="w-full h-full object-fill pointer-events-none"
                  draggable={false}
                />
              ) : isLoading ? (
                <div className="w-full h-full bg-bg-elevated flex items-center justify-center">
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm text-text-muted">読み込み中...</span>
                  </div>
                </div>
              ) : (
                <div className="w-full h-full bg-bg-elevated flex items-center justify-center text-text-muted">
                  プレビューなし
                </div>
              )}

              {/* Guide Lines (with wider hit areas) */}
              {guides.map((guide, index) => {
                const isSelected = selectedGuideIndex === index;
                const isBeingDragged = draggingGuideIndex === index;
                const screenPos = guide.position * scale;

                return guide.direction === "horizontal" ? (
                  // --- Horizontal guide ---
                  <div
                    key={index}
                    className={`absolute ${isSelected ? "z-20" : "z-10"}`}
                    style={{
                      top: screenPos - GUIDE_HIT_HALF,
                      left: -guideOverflowX,
                      right: -guideOverflowX,
                      height: GUIDE_HIT_HALF * 2 + 1,
                      cursor: isBeingDragged ? "grabbing" : "ns-resize",
                    }}
                    onMouseDown={(e) => handleGuideMouseDown(index, e)}
                  >
                    {/* Visual line (常に1px — 選択時は色とグローで区別) */}
                    <div
                      className="absolute left-0 right-0 pointer-events-none"
                      style={{
                        top: GUIDE_HIT_HALF,
                        height: 1,
                        background: isSelected
                          ? "linear-gradient(90deg, #ffb142, #ff5a8a, #ffb142)"
                          : "linear-gradient(90deg, #ffb14299, #ff5a8a99, #ffb14299)",
                        boxShadow: isSelected
                          ? "0 0 6px rgba(255, 177, 66, 0.8)"
                          : "0 0 3px rgba(255, 177, 66, 0.3)",
                      }}
                    />
                    {/* Selection indicator */}
                    {isSelected && (
                      <div
                        className="absolute pointer-events-none"
                        style={{
                          left: -4,
                          top: GUIDE_HIT_HALF - 5,
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          background: "linear-gradient(135deg, #ffb142, #ff5a8a)",
                          boxShadow: "0 0 4px rgba(255, 177, 66, 0.8)",
                        }}
                      />
                    )}
                  </div>
                ) : (
                  // --- Vertical guide ---
                  <div
                    key={index}
                    className={`absolute ${isSelected ? "z-20" : "z-10"}`}
                    style={{
                      left: screenPos - GUIDE_HIT_HALF,
                      top: -guideOverflowY,
                      bottom: -guideOverflowY,
                      width: GUIDE_HIT_HALF * 2 + 1,
                      cursor: isBeingDragged ? "grabbing" : "ew-resize",
                    }}
                    onMouseDown={(e) => handleGuideMouseDown(index, e)}
                  >
                    {/* Visual line (常に1px) */}
                    <div
                      className="absolute top-0 bottom-0 pointer-events-none"
                      style={{
                        left: GUIDE_HIT_HALF,
                        width: 1,
                        background: isSelected
                          ? "linear-gradient(180deg, #ffb142, #ff5a8a, #ffb142)"
                          : "linear-gradient(180deg, #ffb14299, #ff5a8a99, #ffb14299)",
                        boxShadow: isSelected
                          ? "0 0 6px rgba(255, 177, 66, 0.8)"
                          : "0 0 3px rgba(255, 177, 66, 0.3)",
                      }}
                    />
                    {/* Selection indicator */}
                    {isSelected && (
                      <div
                        className="absolute pointer-events-none"
                        style={{
                          left: GUIDE_HIT_HALF - 5,
                          top: "50%",
                          marginTop: -5,
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          background: "linear-gradient(135deg, #ffb142, #ff5a8a)",
                          boxShadow: "0 0 4px rgba(255, 177, 66, 0.8)",
                        }}
                      />
                    )}
                  </div>
                );
              })}

              {/* Preview Guide (while dragging from ruler) */}
              {isDragging &&
                previewPosition !== null &&
                (dragDirection === "horizontal" ? (
                  <div
                    className="absolute pointer-events-none z-30"
                    style={{
                      top: previewPosition * scale,
                      left: -guideOverflowX,
                      right: -guideOverflowX,
                      height: 2,
                      background: "linear-gradient(90deg, #ffb142, #ff5a8a, #ffb142)",
                      opacity: 0.8,
                      boxShadow: "0 0 8px rgba(255, 177, 66, 0.6)",
                    }}
                  />
                ) : (
                  <div
                    className="absolute pointer-events-none z-30"
                    style={{
                      left: previewPosition * scale,
                      top: -guideOverflowY,
                      bottom: -guideOverflowY,
                      width: 2,
                      background: "linear-gradient(180deg, #ffb142, #ff5a8a, #ffb142)",
                      opacity: 0.8,
                      boxShadow: "0 0 8px rgba(255, 177, 66, 0.6)",
                    }}
                  />
                ))}
            </div>
          </div>
        </div>
      </div>

      {/* Zoom indicator */}
      <div className="absolute bottom-2 right-2 z-40 bg-bg-secondary/90 px-3 py-1.5 rounded-md text-xs text-text-muted backdrop-blur-sm border border-text-muted/10">
        {Math.round(zoom * 100)}%
      </div>

      {/* Instructions */}
      <div className="absolute bottom-2 left-2 z-40 bg-bg-secondary/90 px-3 py-1.5 rounded-md text-xs text-text-muted backdrop-blur-sm border border-text-muted/10">
        定規ドラッグ: 作成 | ガイドドラッグ: 移動 | 矢印キー: 微調整(+Shift 10px) | BackSpace: 削除
      </div>
    </div>
  );
}
