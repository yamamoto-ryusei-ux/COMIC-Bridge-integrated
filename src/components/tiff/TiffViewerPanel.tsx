/**
 * TiffViewerPanel — TIFF化タブ内の軽量ページ切替ビューワー
 * 矢印キー/ホイールでサクサクページ送り、クロップ範囲オーバーレイ表示
 */
import { useState, useEffect, useRef, useMemo } from "react";
import { usePsdStore } from "../../store/psdStore";
import { useTiffStore } from "../../store/tiffStore";
import { useHighResPreview } from "../../hooks/useHighResPreview";
import type { LayerNode } from "../../types";

export function TiffViewerPanel() {
  const files = usePsdStore((s) => s.files);
  const cropBounds = useTiffStore((s) => s.settings.crop.bounds);
  const cropEnabled = useTiffStore((s) => s.settings.crop.enabled);
  const fileOverrides = useTiffStore((s) => s.fileOverrides);

  const [fileIndex, setFileIndex] = useState(0);
  const [reverseHorizontal, setReverseHorizontal] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const reverseHorizontalRef = useRef(false);

  // reverseHorizontal をキーボードハンドラ内で参照するためにrefに同期
  useEffect(() => {
    reverseHorizontalRef.current = reverseHorizontal;
  }, [reverseHorizontal]);

  const currentFile = files[fileIndex] ?? null;

  // 個別クロップ優先: override.cropBoundsがundefinedでなければ個別設定を使用
  const override = currentFile ? fileOverrides.get(currentFile.id) : undefined;
  const effectiveCropBounds = override?.cropBounds !== undefined ? override.cropBounds : cropBounds;
  const effectiveCropEnabled =
    override?.cropBounds !== undefined ? override.cropBounds !== null : cropEnabled;
  const hasIndividualCrop = override?.cropBounds !== undefined;

  const { imageUrl, originalSize, isLoading } = useHighResPreview(currentFile?.filePath ?? null, {
    maxSize: 2000,
    enabled: !!currentFile,
    pdfPageIndex: currentFile?.pdfPageIndex,
    pdfSourcePath: currentFile?.pdfSourcePath,
  });

  // マウント時にフォーカスしてキーボード操作を即時有効化
  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  // テキストはみ出し検知
  const textOverflowLayers = useMemo(() => {
    if (!currentFile?.metadata?.layerTree || !effectiveCropBounds || !effectiveCropEnabled)
      return [];
    const overflows: {
      name: string;
      bounds: { left: number; top: number; right: number; bottom: number };
    }[] = [];

    const walk = (nodes: LayerNode[]) => {
      for (const node of nodes) {
        if (node.type === "text" && node.visible && node.bounds) {
          const b = node.bounds;
          if (
            b.left < effectiveCropBounds.left ||
            b.top < effectiveCropBounds.top ||
            b.right > effectiveCropBounds.right ||
            b.bottom > effectiveCropBounds.bottom
          ) {
            overflows.push({ name: node.name, bounds: b });
          }
        }
        if (node.children) walk(node.children);
      }
    };
    walk(currentFile.metadata.layerTree);
    return overflows;
  }, [currentFile, effectiveCropBounds, effectiveCropEnabled]);

  // キーボード操作
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      let goNext: boolean | null = null;
      if (e.key === "ArrowUp") goNext = false;
      else if (e.key === "ArrowDown") goNext = true;
      else if (e.key === "ArrowLeft") goNext = reverseHorizontalRef.current ? true : false;
      else if (e.key === "ArrowRight") goNext = reverseHorizontalRef.current ? false : true;

      if (goNext === null) return;
      e.preventDefault();
      if (goNext) {
        setFileIndex((i) => Math.min(files.length - 1, i + 1));
      } else {
        setFileIndex((i) => Math.max(0, i - 1));
      }
    };

    el.addEventListener("keydown", handleKeyDown);
    return () => el.removeEventListener("keydown", handleKeyDown);
  }, [files.length]);

  // ホイール操作
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.deltaY > 0) {
        setFileIndex((i) => Math.min(files.length - 1, i + 1));
      } else if (e.deltaY < 0) {
        setFileIndex((i) => Math.max(0, i - 1));
      }
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [files.length]);

  // ファイル数変化でインデックスクランプ
  useEffect(() => {
    if (fileIndex >= files.length && files.length > 0) {
      setFileIndex(files.length - 1);
    }
  }, [files.length, fileIndex]);

  if (!currentFile) {
    return (
      <div className="h-full flex items-center justify-center text-text-muted text-xs">
        ファイルがありません
      </div>
    );
  }

  const showCropOverlay = effectiveCropEnabled && effectiveCropBounds && originalSize;

  return (
    <div
      ref={containerRef}
      className="h-full flex flex-col bg-bg-primary outline-none"
      tabIndex={0}
    >
      {/* ヘッダー: ページナビ */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50 flex-shrink-0">
        <button
          onClick={() => setFileIndex((i) => Math.max(0, i - 1))}
          disabled={fileIndex === 0}
          className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <span className="text-[11px] font-mono text-text-secondary">
          <span className="text-text-primary font-semibold">{fileIndex + 1}</span>
          <span className="mx-0.5">/</span>
          <span>{files.length}</span>
        </span>

        <button
          onClick={() => setFileIndex((i) => Math.min(files.length - 1, i + 1))}
          disabled={fileIndex === files.length - 1}
          className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>

        <div className="flex-1 min-w-0">
          <span className="text-[10px] text-text-muted truncate block">{currentFile.fileName}</span>
        </div>

        {/* 個別クロップ使用中バッジ */}
        {hasIndividualCrop && (
          <span className="px-1.5 py-0.5 text-[10px] rounded font-medium bg-accent-warm/15 text-accent-warm flex-shrink-0">
            個別範囲
          </span>
        )}

        {/* テキストはみ出し警告 */}
        {textOverflowLayers.length > 0 && (
          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-warning/10 text-warning text-[10px] font-medium flex-shrink-0">
            <svg
              className="w-3 h-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
            テキストはみ出し {textOverflowLayers.length}件
          </div>
        )}

        {/* 左右反転チェックボックス */}
        <label className="flex items-center gap-1 cursor-pointer flex-shrink-0 select-none">
          <input
            type="checkbox"
            checked={reverseHorizontal}
            onChange={(e) => setReverseHorizontal(e.target.checked)}
            className="rounded accent-accent-warm"
          />
          <span className="text-[10px] text-text-muted">左右反転</span>
        </label>
      </div>

      {/* 画像エリア */}
      <div className="flex-1 relative overflow-hidden flex items-center justify-center bg-[#1a1a1e]">
        {isLoading && (
          <div className="absolute top-3 right-3 z-10">
            <div className="w-5 h-5 border-2 border-accent-warm/30 border-t-accent-warm rounded-full animate-spin" />
          </div>
        )}

        {imageUrl && (
          <div className="relative max-w-full max-h-full">
            <img
              src={imageUrl}
              alt={currentFile.fileName}
              className="max-w-full max-h-[calc(100vh-120px)] object-contain"
              draggable={false}
            />

            {/* クロップ範囲オーバーレイ */}
            {showCropOverlay && (
              <CropOverlay
                cropBounds={effectiveCropBounds}
                imageWidth={originalSize.width}
                imageHeight={originalSize.height}
                textOverflowLayers={textOverflowLayers}
              />
            )}
          </div>
        )}

        {!imageUrl && !isLoading && (
          <div className="text-text-muted text-xs">プレビューを読み込めません</div>
        )}
      </div>
    </div>
  );
}

// クロップ範囲オーバーレイ（暗転マスク + テキストはみ出しハイライト）
function CropOverlay({
  cropBounds,
  imageWidth,
  imageHeight,
  textOverflowLayers,
}: {
  cropBounds: { left: number; top: number; right: number; bottom: number };
  imageWidth: number;
  imageHeight: number;
  textOverflowLayers: {
    name: string;
    bounds: { left: number; top: number; right: number; bottom: number };
  }[];
}) {
  const { left, top, right, bottom } = cropBounds;

  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox={`0 0 ${imageWidth} ${imageHeight}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <mask id="cropMask">
          <rect x="0" y="0" width={imageWidth} height={imageHeight} fill="white" />
          <rect x={left} y={top} width={right - left} height={bottom - top} fill="black" />
        </mask>
      </defs>
      <rect
        x="0"
        y="0"
        width={imageWidth}
        height={imageHeight}
        fill="rgba(0,0,0,0.5)"
        mask="url(#cropMask)"
      />
      <rect
        x={left}
        y={top}
        width={right - left}
        height={bottom - top}
        fill="none"
        stroke="rgba(255,90,138,0.6)"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
      {textOverflowLayers.map((layer, i) => (
        <rect
          key={i}
          x={layer.bounds.left}
          y={layer.bounds.top}
          width={layer.bounds.right - layer.bounds.left}
          height={layer.bounds.bottom - layer.bounds.top}
          fill="rgba(245,158,11,0.2)"
          stroke="rgba(245,158,11,0.8)"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
