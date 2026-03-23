import { useState, useRef, useCallback, useEffect } from "react";
import type { FontPreset } from "../../types/scanPsd";
import { SUB_NAME_PALETTE } from "../../types/scanPsd";

interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CaptureOverlayProps {
  /** asset:// URL of the displayed image */
  imageUrl: string;
  /** PSD original dimensions */
  psdWidth: number;
  psdHeight: number;
  /** Ref to the container div that holds the image */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Available fonts from preset */
  fonts: FontPreset[];
  /** フィルタ中のフォント(PostScript名) — デフォルト選択に使用 */
  defaultFontPostScript?: string | null;
  /** Callback when capture is confirmed */
  onCapture: (region: CropRect, font: FontPreset) => void;
  /** Cancel capture mode */
  onCancel: () => void;
}

export function CaptureOverlay({
  psdWidth,
  psdHeight,
  containerRef,
  fonts,
  defaultFontPostScript,
  onCapture,
  onCancel,
}: CaptureOverlayProps) {
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragEnd, setDragEnd] = useState<{ x: number; y: number } | null>(null);
  const [cropRect, setCropRect] = useState<CropRect | null>(null);

  // フィルタ中のフォントがあればそれをデフォルト選択
  const defaultIdx = defaultFontPostScript
    ? Math.max(
        0,
        fonts.findIndex((f) => f.font === defaultFontPostScript),
      )
    : 0;
  const [selectedFontIdx, setSelectedFontIdx] = useState(defaultIdx);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Screen座標 → PSD座標変換
  const screenToPsd = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const container = containerRef.current;
      if (!container) return null;
      const img = container.querySelector("img");
      if (!img) return null;

      const imgRect = img.getBoundingClientRect();
      // object-fit: contain の実際の描画領域を算出
      const imgAspect = psdWidth / psdHeight;
      const containerAspect = imgRect.width / imgRect.height;

      let renderW: number, renderH: number, offsetX: number, offsetY: number;
      if (imgAspect > containerAspect) {
        renderW = imgRect.width;
        renderH = imgRect.width / imgAspect;
        offsetX = imgRect.left;
        offsetY = imgRect.top + (imgRect.height - renderH) / 2;
      } else {
        renderH = imgRect.height;
        renderW = imgRect.height * imgAspect;
        offsetX = imgRect.left + (imgRect.width - renderW) / 2;
        offsetY = imgRect.top;
      }

      const psdX = ((clientX - offsetX) / renderW) * psdWidth;
      const psdY = ((clientY - offsetY) / renderH) * psdHeight;

      return {
        x: Math.max(0, Math.min(psdWidth, psdX)),
        y: Math.max(0, Math.min(psdHeight, psdY)),
      };
    },
    [containerRef, psdWidth, psdHeight],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (cropRect) return; // Already have a selection
      e.preventDefault();
      e.stopPropagation();
      const pos = screenToPsd(e.clientX, e.clientY);
      if (pos) {
        setDragStart(pos);
        setDragEnd(pos);
      }
    },
    [screenToPsd, cropRect],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragStart || cropRect) return;
      e.preventDefault();
      const pos = screenToPsd(e.clientX, e.clientY);
      if (pos) setDragEnd(pos);
    },
    [dragStart, screenToPsd, cropRect],
  );

  const handleMouseUp = useCallback(() => {
    if (!dragStart || !dragEnd || cropRect) return;
    const x = Math.min(dragStart.x, dragEnd.x);
    const y = Math.min(dragStart.y, dragEnd.y);
    const width = Math.abs(dragEnd.x - dragStart.x);
    const height = Math.abs(dragEnd.y - dragStart.y);
    // 最小サイズチェック
    if (width > 20 && height > 20) {
      setCropRect({ x, y, width, height });
    } else {
      setDragStart(null);
      setDragEnd(null);
    }
  }, [dragStart, dragEnd, cropRect]);

  const handleConfirm = useCallback(() => {
    if (!cropRect || !fonts[selectedFontIdx]) return;
    onCapture(cropRect, fonts[selectedFontIdx]);
  }, [cropRect, fonts, selectedFontIdx, onCapture]);

  const handleReset = useCallback(() => {
    setCropRect(null);
    setDragStart(null);
    setDragEnd(null);
  }, []);

  // Escキーでキャンセル
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (cropRect) {
          handleReset();
        } else {
          onCancel();
        }
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [cropRect, handleReset, onCancel]);

  // ドラッグ中の矩形
  const selRect =
    dragStart && dragEnd
      ? {
          x: Math.min(dragStart.x, dragEnd.x),
          y: Math.min(dragStart.y, dragEnd.y),
          width: Math.abs(dragEnd.x - dragStart.x),
          height: Math.abs(dragEnd.y - dragStart.y),
        }
      : cropRect;

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 z-30"
      style={{ cursor: cropRect ? "default" : "crosshair" }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* SVG overlay with darkened mask + selection cutout */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        viewBox={`0 0 ${psdWidth} ${psdHeight}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <mask id="capture-mask">
            <rect x="0" y="0" width={psdWidth} height={psdHeight} fill="white" />
            {selRect && (
              <rect
                x={selRect.x}
                y={selRect.y}
                width={selRect.width}
                height={selRect.height}
                fill="black"
              />
            )}
          </mask>
        </defs>
        {/* Darkened area */}
        <rect
          x="0"
          y="0"
          width={psdWidth}
          height={psdHeight}
          fill="rgba(0,0,0,0.5)"
          mask="url(#capture-mask)"
        />
        {/* Selection border */}
        {selRect && (
          <rect
            x={selRect.x}
            y={selRect.y}
            width={selRect.width}
            height={selRect.height}
            fill="none"
            stroke="#60a5fa"
            strokeWidth={Math.max(3, psdWidth * 0.002)}
            strokeDasharray={cropRect ? "none" : `${psdWidth * 0.005} ${psdWidth * 0.003}`}
            rx={4}
          />
        )}
      </svg>

      {/* Header hint */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-xl bg-black/70 backdrop-blur-md text-white/90 text-xs font-medium pointer-events-none select-none">
        {cropRect ? "フォントを選択して保存" : "ドラッグで範囲を選択"}
      </div>

      {/* Cancel button */}
      <button
        className="absolute top-3 right-3 z-40 w-8 h-8 rounded-lg bg-black/50 hover:bg-black/70 flex items-center justify-center text-white/70 hover:text-white transition-all backdrop-blur-sm"
        onClick={(e) => {
          e.stopPropagation();
          onCancel();
        }}
        title="キャンセル (Esc)"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Font selection panel (appears after crop selection) */}
      {cropRect && fonts.length > 0 && (
        <div
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 bg-bg-secondary border border-border rounded-xl p-3 shadow-xl min-w-[280px]"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="space-y-2">
            <label className="text-[10px] text-text-muted block">紐づけるフォント</label>
            <select
              className="w-full text-xs px-2 py-1.5 rounded-lg border border-border bg-bg-primary text-text-primary outline-none focus:border-accent/50"
              value={selectedFontIdx}
              onChange={(e) => setSelectedFontIdx(Number(e.target.value))}
            >
              {fonts.map((f, i) => (
                <option key={i} value={i}>
                  {f.name}
                  {f.subName ? ` [${f.subName}]` : ""}
                </option>
              ))}
            </select>
            {fonts[selectedFontIdx]?.subName && (
              <div className="flex items-center gap-1">
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded"
                  style={{
                    color: SUB_NAME_PALETTE[fonts[selectedFontIdx].subName]?.color || "#888",
                    backgroundColor:
                      SUB_NAME_PALETTE[fonts[selectedFontIdx].subName]?.bg ||
                      "rgba(255,255,255,0.05)",
                  }}
                >
                  {fonts[selectedFontIdx].subName}
                </span>
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button
                className="flex-1 px-3 py-1.5 text-xs font-medium text-text-secondary bg-bg-tertiary rounded-lg hover:bg-bg-tertiary/80 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  handleReset();
                }}
              >
                やり直し
              </button>
              <button
                className="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-accent to-accent-secondary rounded-lg hover:-translate-y-0.5 transition-all shadow-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  handleConfirm();
                }}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
