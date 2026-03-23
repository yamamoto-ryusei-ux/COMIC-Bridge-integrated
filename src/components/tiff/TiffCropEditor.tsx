import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { usePsdStore } from "../../store/psdStore";
import { useTiffStore } from "../../store/tiffStore";
import { useHighResPreview } from "../../hooks/useHighResPreview";
import { useCropEditorKeyboard } from "../../hooks/useCropEditorKeyboard";
import { CanvasRuler, RULER_SIZE } from "../guide-editor/CanvasRuler";
import { CropJsonLoadDialog } from "./TiffCropSidePanel";
import type { TiffCropBounds } from "../../types/tiff";

const ASPECT_W = 640;
const ASPECT_H = 909;
const ASPECT_RATIO = ASPECT_W / ASPECT_H;

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 8;
const GUIDE_HIT_HALF = 5;

type DragMode = "move" | "nw" | "ne" | "sw" | "se" | "n" | "s" | "w" | "e" | null;

interface TiffCropEditorProps {
  onSwitchToQueue?: () => void;
}

export function TiffCropEditor({ onSwitchToQueue }: TiffCropEditorProps) {
  const files = usePsdStore((state) => state.files);
  const referenceFileIndex = useTiffStore((state) => state.referenceFileIndex);
  const setReferenceFileIndex = useTiffStore((state) => state.setReferenceFileIndex);
  const cropBounds = useTiffStore((state) => state.settings.crop.bounds);
  const setCropBounds = useTiffStore((state) => state.setCropBounds);
  const pushCropHistory = useTiffStore((state) => state.pushCropHistory);
  const undoCropBounds = useTiffStore((state) => state.undoCropBounds);
  const redoCropBounds = useTiffStore((state) => state.redoCropBounds);
  const setPhase = useTiffStore((state) => state.setPhase);
  const cropMethod = useTiffStore((state) => state.cropMethod);
  const setCropStep = useTiffStore((state) => state.setCropStep);
  const cropEnabled = useTiffStore((state) => state.settings.crop.enabled);
  const loadCropPreset = useTiffStore((state) => state.loadCropPreset);

  // ファイル別クロップ編集モード
  const perFileEditTarget = useTiffStore((state) => state.perFileEditTarget);
  const setPerFileEditTarget = useTiffStore((state) => state.setPerFileEditTarget);
  const setFileOverride = useTiffStore((state) => state.setFileOverride);
  const fileOverrides = useTiffStore((state) => state.fileOverrides);
  const perFileTargetName = perFileEditTarget
    ? (files.find((f) => f.id === perFileEditTarget)?.fileName ?? perFileEditTarget)
    : null;
  const [showJsonLoadDialog, setShowJsonLoadDialog] = useState(false);
  const [jsonBtnVisible, setJsonBtnVisible] = useState(true);
  const [jsonBtnHover, setJsonBtnHover] = useState(false);

  // ガイド
  const cropGuides = useTiffStore((state) => state.cropGuides);
  const addCropGuide = useTiffStore((state) => state.addCropGuide);
  const updateCropGuide = useTiffStore((state) => state.updateCropGuide);
  const selectedCropGuideIndex = useTiffStore((state) => state.selectedCropGuideIndex);
  const setSelectedCropGuideIndex = useTiffStore((state) => state.setSelectedCropGuideIndex);
  const removeCropGuide = useTiffStore((state) => state.removeCropGuide);

  // 基準ファイル
  const referenceFile = useMemo(() => {
    const idx = Math.max(0, Math.min(referenceFileIndex - 1, files.length - 1));
    return files[idx] || null;
  }, [files, referenceFileIndex]);

  // 参照ファイルの個別クロップ設定（perFileEditTarget中は表示しない）
  const refFilePerFileBounds = useMemo(() => {
    if (perFileEditTarget || !referenceFile) return undefined;
    const ov = fileOverrides.get(referenceFile.id);
    return ov?.cropBounds; // undefined=グローバル使用, null=スキップ, TiffCropBounds=個別設定
  }, [perFileEditTarget, referenceFile, fileOverrides]);

  // PSD元ガイド（読み取り専用表示用）
  const psdGuides = useMemo(() => {
    return referenceFile?.metadata?.guides ?? [];
  }, [referenceFile]);

  const setReferenceImageSize = useTiffStore((state) => state.setReferenceImageSize);

  // 高解像度プレビュー
  const { imageUrl, originalSize, isLoading } = useHighResPreview(referenceFile?.filePath ?? null, {
    maxSize: 2000,
    enabled: !!referenceFile,
    pdfPageIndex: referenceFile?.pdfPageIndex,
    pdfSourcePath: referenceFile?.pdfSourcePath,
  });

  // 基準画像サイズをstoreに同期
  useEffect(() => {
    setReferenceImageSize(originalSize);
  }, [originalSize, setReferenceImageSize]);

  // per-file編集開始前のグローバル範囲を保存するref（終了時に復元する）
  const savedGlobalBoundsRef = useRef<TiffCropBounds | null | undefined>(undefined);

  // ファイル別編集モードに入った時: グローバル範囲を保存し、個別cropBoundsをエディタにロード
  useEffect(() => {
    if (!perFileEditTarget) return;
    // 編集開始時にグローバル範囲を保存（undefinedは「未保存」マーカー、nullは「範囲なし」）
    savedGlobalBoundsRef.current = useTiffStore.getState().settings.crop.bounds;
    const override = fileOverrides.get(perFileEditTarget);
    if (override?.cropBounds) {
      setLocalBounds(override.cropBounds);
      setCropBounds(override.cropBounds);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perFileEditTarget]);

  // Canvas container
  const containerRef = useRef<HTMLDivElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  // ズーム・パン
  const [zoom, setZoom] = useState(1);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0, scrollX: 0, scrollY: 0 });

  const showRulers = true;

  // 画像表示の計算
  const imageLayout = useMemo(() => {
    if (!originalSize || containerSize.width === 0) return null;

    const rulerOffset = showRulers ? RULER_SIZE : 0;
    const padding = 40;
    const availW = containerSize.width - padding * 2 - rulerOffset;
    const availH = containerSize.height - padding * 2 - rulerOffset;

    const baseScale = Math.min(availW / originalSize.width, availH / originalSize.height, 1);
    const scale = baseScale * zoom;
    const displayW = originalSize.width * scale;
    const displayH = originalSize.height * scale;

    // When zoomed, the image fills from top-left of preview area
    // When not zoomed, center
    let offsetX: number, offsetY: number;
    if (zoom > 1) {
      offsetX = padding;
      offsetY = padding;
    } else {
      const viewW = containerSize.width - rulerOffset;
      const viewH = containerSize.height - rulerOffset;
      offsetX = (viewW - displayW) / 2;
      offsetY = (viewH - displayH) / 2;
    }

    return { scale, displayW, displayH, offsetX, offsetY, baseScale };
  }, [originalSize, containerSize, zoom, showRulers]);

  // クロップ矩形（ドキュメント座標）
  const [localBounds, setLocalBounds] = useState<TiffCropBounds | null>(cropBounds);

  useEffect(() => {
    setLocalBounds(cropBounds);
  }, [cropBounds]);

  // コンテナサイズ計測
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // --- 座標変換 ---
  const docToScreen = useCallback(
    (docX: number, docY: number) => {
      if (!imageLayout) return { x: 0, y: 0 };
      return {
        x: imageLayout.offsetX + docX * imageLayout.scale,
        y: imageLayout.offsetY + docY * imageLayout.scale,
      };
    },
    [imageLayout],
  );

  const screenToDoc = useCallback(
    (screenX: number, screenY: number) => {
      if (!imageLayout || !originalSize) return { x: 0, y: 0 };
      return {
        x: Math.max(
          0,
          Math.min(originalSize.width, (screenX - imageLayout.offsetX) / imageLayout.scale),
        ),
        y: Math.max(
          0,
          Math.min(originalSize.height, (screenY - imageLayout.offsetY) / imageLayout.scale),
        ),
      };
    },
    [imageLayout, originalSize],
  );

  // --- クロップ作成 (アスペクト比ロック) ---
  const createCropFromCenter = useCallback(
    (centerX: number, centerY: number) => {
      if (!originalSize) return null;
      let width = originalSize.width * 0.8;
      let height = width / ASPECT_RATIO;
      if (height > originalSize.height * 0.8) {
        height = originalSize.height * 0.8;
        width = height * ASPECT_RATIO;
      }
      let left = centerX - width / 2;
      let top = centerY - height / 2;
      left = Math.max(0, Math.min(originalSize.width - width, left));
      top = Math.max(0, Math.min(originalSize.height - height, top));
      return {
        left: Math.round(left),
        top: Math.round(top),
        right: Math.round(left + width),
        bottom: Math.round(top + height),
      };
    },
    [originalSize],
  );

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent) => {
      if (isPanning || isSpacePressed) return;
      if (!cropEnabled) return;
      // ガイド選択解除
      if (selectedCropGuideIndex !== null) {
        setSelectedCropGuideIndex(null);
      }
      if (localBounds) return;
      const el = previewContainerRef.current || containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const doc = screenToDoc(
        e.clientX - rect.left + (el.scrollLeft || 0),
        e.clientY - rect.top + (el.scrollTop || 0),
      );
      const newBounds = createCropFromCenter(doc.x, doc.y);
      if (newBounds) {
        pushCropHistory();
        setLocalBounds(newBounds);
        setCropBounds(newBounds);
      }
    },
    [
      localBounds,
      screenToDoc,
      createCropFromCenter,
      setCropBounds,
      pushCropHistory,
      cropMethod,
      isPanning,
      isSpacePressed,
      setSelectedCropGuideIndex,
      cropEnabled,
    ],
  );

  // --- ドラッグ (クロップ移動/リサイズ) ---
  const dragMode = useRef<DragMode>(null);
  const dragStart = useRef({ x: 0, y: 0 });
  const dragInitBounds = useRef<TiffCropBounds | null>(null);
  const historyPushed = useRef(false);

  const handleCropMouseDown = useCallback(
    (e: React.MouseEvent, mode: DragMode) => {
      if (isPanning || isSpacePressed) return;
      e.preventDefault();
      e.stopPropagation();
      dragMode.current = mode;
      dragStart.current = { x: e.clientX, y: e.clientY };
      dragInitBounds.current = localBounds ? { ...localBounds } : null;
      historyPushed.current = false;
    },
    [localBounds, isPanning, isSpacePressed],
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      // パン中
      if (isPanning && isSpacePressed) {
        const el = previewContainerRef.current;
        if (!el) return;
        el.scrollLeft = panStartRef.current.scrollX - (e.clientX - panStartRef.current.x);
        el.scrollTop = panStartRef.current.scrollY - (e.clientY - panStartRef.current.y);
        return;
      }

      if (!dragMode.current || !dragInitBounds.current || !imageLayout || !originalSize) return;

      if (!historyPushed.current) {
        pushCropHistory();
        historyPushed.current = true;
      }

      const dx = (e.clientX - dragStart.current.x) / imageLayout.scale;
      const dy = (e.clientY - dragStart.current.y) / imageLayout.scale;
      const init = dragInitBounds.current;
      let newBounds: TiffCropBounds;

      if (dragMode.current === "move") {
        const w = init.right - init.left;
        const h = init.bottom - init.top;
        let newLeft = init.left + dx;
        let newTop = init.top + dy;
        newLeft = Math.max(0, Math.min(originalSize.width - w, newLeft));
        newTop = Math.max(0, Math.min(originalSize.height - h, newTop));
        newBounds = {
          left: Math.round(newLeft),
          top: Math.round(newTop),
          right: Math.round(newLeft + w),
          bottom: Math.round(newTop + h),
        };
      } else {
        let newLeft = init.left;
        let newTop = init.top;
        let newRight = init.right;
        let newBottom = init.bottom;

        const mode = dragMode.current!;
        if (mode.includes("e")) newRight = Math.max(newLeft + 20, init.right + dx);
        if (mode.includes("w")) newLeft = Math.min(newRight - 20, init.left + dx);
        if (mode.includes("s")) newBottom = Math.max(newTop + 20, init.bottom + dy);
        if (mode.includes("n")) newTop = Math.min(newBottom - 20, init.top + dy);

        let w = newRight - newLeft;
        let h = newBottom - newTop;
        const currentRatio = w / h;

        if (currentRatio > ASPECT_RATIO) {
          w = h * ASPECT_RATIO;
        } else {
          h = w / ASPECT_RATIO;
        }

        if (mode.includes("e") && !mode.includes("w")) {
          newRight = newLeft + w;
        } else if (mode.includes("w") && !mode.includes("e")) {
          newLeft = newRight - w;
        } else {
          const center = (newLeft + newRight) / 2;
          newLeft = center - w / 2;
          newRight = center + w / 2;
        }
        if (mode.includes("s") && !mode.includes("n")) {
          newBottom = newTop + h;
        } else if (mode.includes("n") && !mode.includes("s")) {
          newTop = newBottom - h;
        } else {
          const center = (newTop + newBottom) / 2;
          newTop = center - h / 2;
          newBottom = center + h / 2;
        }

        newLeft = Math.max(0, newLeft);
        newTop = Math.max(0, newTop);
        newRight = Math.min(originalSize.width, newRight);
        newBottom = Math.min(originalSize.height, newBottom);

        newBounds = {
          left: Math.round(newLeft),
          top: Math.round(newTop),
          right: Math.round(newRight),
          bottom: Math.round(newBottom),
        };
      }

      setLocalBounds(newBounds);
    };

    const handleMouseUp = () => {
      if (isPanning) {
        setIsPanning(false);
        return;
      }
      if (dragMode.current && localBounds) {
        setCropBounds(localBounds);
      }
      dragMode.current = null;

      // ガイドドラッグ終了
      if (guideDragRef.current !== null) {
        guideDragRef.current = null;
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [
    imageLayout,
    originalSize,
    localBounds,
    setCropBounds,
    isPanning,
    isSpacePressed,
    pushCropHistory,
  ]);

  // --- ガイドドラッグ ---
  const guideDragRef = useRef<number | null>(null);
  const [rulerDragging, setRulerDragging] = useState<{
    direction: "horizontal" | "vertical";
    startPos: number;
  } | null>(null);
  const [previewGuidePos, setPreviewGuidePos] = useState<number | null>(null);

  const handleRulerDragStart = useCallback(
    (direction: "horizontal" | "vertical", e: React.MouseEvent) => {
      if (!cropEnabled) return;
      setRulerDragging({ direction, startPos: direction === "horizontal" ? e.clientY : e.clientX });
    },
    [cropEnabled],
  );

  // ルーラードラッグ→ガイド作成
  useEffect(() => {
    if (!rulerDragging) return;

    const handleMove = (e: MouseEvent) => {
      if (!imageLayout || !originalSize) return;
      const el = previewContainerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();

      if (rulerDragging.direction === "horizontal") {
        const screenY = e.clientY - rect.top + el.scrollTop;
        const docY = (screenY - imageLayout.offsetY) / imageLayout.scale;
        if (docY >= 0 && docY <= originalSize.height) {
          setPreviewGuidePos(imageLayout.offsetY + docY * imageLayout.scale);
        } else {
          setPreviewGuidePos(null);
        }
      } else {
        const screenX = e.clientX - rect.left + el.scrollLeft;
        const docX = (screenX - imageLayout.offsetX) / imageLayout.scale;
        if (docX >= 0 && docX <= originalSize.width) {
          setPreviewGuidePos(imageLayout.offsetX + docX * imageLayout.scale);
        } else {
          setPreviewGuidePos(null);
        }
      }
    };

    const handleUp = (e: MouseEvent) => {
      if (!imageLayout || !originalSize) {
        setRulerDragging(null);
        setPreviewGuidePos(null);
        return;
      }
      const el = previewContainerRef.current;
      if (!el) {
        setRulerDragging(null);
        setPreviewGuidePos(null);
        return;
      }
      const rect = el.getBoundingClientRect();

      let position: number;
      if (rulerDragging.direction === "horizontal") {
        const screenY = e.clientY - rect.top + el.scrollTop;
        position = (screenY - imageLayout.offsetY) / imageLayout.scale;
        if (position >= 0 && position <= originalSize.height) {
          addCropGuide({ direction: "horizontal", position: Math.round(position) });
        }
      } else {
        const screenX = e.clientX - rect.left + el.scrollLeft;
        position = (screenX - imageLayout.offsetX) / imageLayout.scale;
        if (position >= 0 && position <= originalSize.width) {
          addCropGuide({ direction: "vertical", position: Math.round(position) });
        }
      }

      setRulerDragging(null);
      setPreviewGuidePos(null);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [rulerDragging, imageLayout, originalSize, addCropGuide]);

  // ガイドライン マウスダウン (選択+ドラッグ移動)
  // - クロップ範囲なし → ガイド交点からクロップ作成を優先
  // - クロップ範囲あり＋選択済み → ガイドドラッグ
  const handleGuideDragStart = useCallback(
    (index: number, e: React.MouseEvent) => {
      if (isPanning || isSpacePressed) return;

      // クロップ範囲が無い場合: ガイド上のクリックでクロップ作成
      // （ガイドの交点から選択範囲を引くワークフロー対応）
      if (!localBounds) {
        e.preventDefault();
        e.stopPropagation();
        setSelectedCropGuideIndex(index);
        const el = previewContainerRef.current || containerRef.current;
        if (el) {
          const rect = el.getBoundingClientRect();
          const doc = screenToDoc(
            e.clientX - rect.left + (el.scrollLeft || 0),
            e.clientY - rect.top + (el.scrollTop || 0),
          );
          const newBounds = createCropFromCenter(doc.x, doc.y);
          if (newBounds) {
            pushCropHistory();
            setLocalBounds(newBounds);
            setCropBounds(newBounds);
          }
        }
        return;
      }

      // クロップ範囲がある場合: 選択済みガイドのみドラッグ可能
      e.preventDefault();
      e.stopPropagation();
      setSelectedCropGuideIndex(index);
      guideDragRef.current = index;

      const guide = cropGuides[index];

      const handleMove = (ev: MouseEvent) => {
        if (guideDragRef.current === null || !imageLayout || !originalSize) return;
        const el = previewContainerRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();

        let newPos: number;
        if (guide.direction === "horizontal") {
          const screenY = ev.clientY - rect.top + el.scrollTop;
          newPos = (screenY - imageLayout.offsetY) / imageLayout.scale;
          newPos = Math.max(0, Math.min(originalSize.height, newPos));
        } else {
          const screenX = ev.clientX - rect.left + el.scrollLeft;
          newPos = (screenX - imageLayout.offsetX) / imageLayout.scale;
          newPos = Math.max(0, Math.min(originalSize.width, newPos));
        }
        updateCropGuide(index, { direction: guide.direction, position: Math.round(newPos) });
      };

      const handleUp = () => {
        guideDragRef.current = null;
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };

      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [
      cropGuides,
      imageLayout,
      originalSize,
      setSelectedCropGuideIndex,
      updateCropGuide,
      localBounds,
      isPanning,
      isSpacePressed,
      screenToDoc,
      createCropFromCenter,
      pushCropHistory,
      setCropBounds,
    ],
  );

  // --- ズーム (Ctrl+wheel) ---
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((prev) => {
        const factor = e.deltaY < 0 ? 1.15 : 0.87;
        return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev * factor));
      });
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  // --- パン (Space+Drag) ---
  const handlePanMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!isSpacePressed || zoom <= 1) return;
      e.preventDefault();
      const el = previewContainerRef.current;
      if (!el) return;
      setIsPanning(true);
      panStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        scrollX: el.scrollLeft,
        scrollY: el.scrollTop,
      };
    },
    [isSpacePressed, zoom],
  );

  // --- キーボードショートカット (Tachimi互換) ---
  useCropEditorKeyboard({
    isActive: true,
    onZoomIn: () => setZoom((z) => Math.min(MAX_ZOOM, z * 1.25)),
    onZoomOut: () => setZoom((z) => Math.max(MIN_ZOOM, z * 0.8)),
    onZoomReset: () => setZoom(1),
    onUndo: undoCropBounds,
    onRedo: redoCropBounds,
    onDeleteGuide: () => {
      if (selectedCropGuideIndex !== null) {
        removeCropGuide(selectedCropGuideIndex);
      }
    },
    onDeleteRange: () => {
      pushCropHistory();
      setCropBounds(null);
      setLocalBounds(null);
      setCropStep("select");
    },
    onEscape: () => {
      if (selectedCropGuideIndex !== null) {
        setSelectedCropGuideIndex(null);
      } else {
        setPhase("idle");
      }
    },
    onNudgeGuide: (dx, dy) => {
      if (selectedCropGuideIndex === null) return;
      const guide = cropGuides[selectedCropGuideIndex];
      if (!guide || !originalSize) return;
      let newPos = guide.position;
      if (guide.direction === "horizontal") {
        newPos = Math.max(0, Math.min(originalSize.height, newPos + dy));
      } else {
        newPos = Math.max(0, Math.min(originalSize.width, newPos + dx));
      }
      updateCropGuide(selectedCropGuideIndex, { ...guide, position: Math.round(newPos) });
    },
    onNudgeRange: (dx, dy, isFirst) => {
      if (!localBounds || !originalSize) return;
      if (isFirst) pushCropHistory();
      const w = localBounds.right - localBounds.left;
      const h = localBounds.bottom - localBounds.top;
      const newLeft = Math.max(0, Math.min(originalSize.width - w, localBounds.left + dx));
      const newTop = Math.max(0, Math.min(originalSize.height - h, localBounds.top + dy));
      const nb: TiffCropBounds = {
        left: Math.round(newLeft),
        top: Math.round(newTop),
        right: Math.round(newLeft + w),
        bottom: Math.round(newTop + h),
      };
      setLocalBounds(nb);
      setCropBounds(nb);
    },
    hasSelectedGuide: selectedCropGuideIndex !== null,
    hasRange: cropEnabled && !!localBounds,
    onSpaceDown: () => setIsSpacePressed(true),
    onSpaceUp: () => {
      setIsSpacePressed(false);
      setIsPanning(false);
    },
  });

  // クロップの表示座標
  const cropScreenRect = useMemo(() => {
    if (!localBounds || !imageLayout) return null;
    const tl = docToScreen(localBounds.left, localBounds.top);
    const br = docToScreen(localBounds.right, localBounds.bottom);
    return { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y };
  }, [localBounds, imageLayout, docToScreen]);

  // 個別クロップがある場合は表示用にそちらを優先
  const isIndividualBoundsActive =
    refFilePerFileBounds !== undefined && refFilePerFileBounds !== null;

  const displayScreenRect = useMemo(() => {
    if (!imageLayout) return cropScreenRect;
    if (refFilePerFileBounds !== undefined && refFilePerFileBounds !== null) {
      const tl = docToScreen(refFilePerFileBounds.left, refFilePerFileBounds.top);
      const br = docToScreen(refFilePerFileBounds.right, refFilePerFileBounds.bottom);
      return { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y };
    }
    return cropScreenRect;
  }, [refFilePerFileBounds, cropScreenRect, imageLayout, docToScreen]);

  // カーソルスタイル
  const cursorClass = isSpacePressed
    ? isPanning
      ? "cursor-grabbing"
      : "cursor-grab"
    : cropEnabled
      ? "cursor-crosshair"
      : "cursor-default";

  // preview area dimensions for scrollable container
  const previewAreaW = imageLayout
    ? Math.max(imageLayout.displayW + 80, containerSize.width - (showRulers ? RULER_SIZE : 0))
    : 0;
  const previewAreaH = imageLayout
    ? Math.max(imageLayout.displayH + 80, containerSize.height - (showRulers ? RULER_SIZE : 0))
    : 0;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="px-4 py-2 border-b border-border flex items-center gap-3">
        <h4 className="text-xs font-medium text-text-primary flex items-center gap-1.5">
          <svg
            className="w-3.5 h-3.5 text-accent-warm"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
            />
          </svg>
          {cropEnabled ? "クロップエディタ" : "プレビュー"}
        </h4>

        <div className="flex items-center gap-1.5 ml-auto">
          <label className="text-[10px] text-text-muted">基準:</label>
          <select
            value={referenceFileIndex}
            onChange={(e) => setReferenceFileIndex(parseInt(e.target.value))}
            className="px-2 py-1 text-xs bg-bg-tertiary border border-border/50 rounded-lg text-text-primary focus:outline-none max-w-[200px]"
          >
            {files.map((f, i) => (
              <option key={f.id} value={i + 1}>
                {i + 1}. {f.fileName}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 参照ファイルの個別クロップ設定バナー（閲覧中・編集モード外） */}
      {!perFileEditTarget && refFilePerFileBounds !== undefined && (
        <div
          className={`px-4 py-1.5 border-b flex items-center gap-2 flex-shrink-0 ${
            refFilePerFileBounds === null
              ? "bg-error/8 border-error/20"
              : "bg-warning/8 border-warning/20"
          }`}
        >
          <svg
            className={`w-3 h-3 flex-shrink-0 ${refFilePerFileBounds === null ? "text-error/70" : "text-warning/70"}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
            />
          </svg>
          <span
            className={`text-[10px] flex-1 ${refFilePerFileBounds === null ? "text-error/70" : "text-warning/70"}`}
          >
            {refFilePerFileBounds === null
              ? `${referenceFile?.fileName}: クロップをスキップ`
              : `${referenceFile?.fileName}: 個別クロップ範囲 (点線表示)`}
          </span>
        </div>
      )}

      {/* ファイル別クロップ編集モード バナー */}
      {perFileEditTarget && (
        <div className="px-4 py-2 bg-warning/10 border-b border-warning/20 flex items-center gap-3 flex-shrink-0">
          <svg
            className="w-4 h-4 text-warning flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
            />
          </svg>
          <span className="text-xs text-warning font-medium flex-1 truncate">
            個別クロップ設定中: <span className="font-bold">{perFileTargetName}</span>
          </span>
          <button
            onClick={() => {
              if (localBounds) {
                setFileOverride(perFileEditTarget, { cropBounds: localBounds });
              }
              // 編集前のグローバル範囲を復元
              if (savedGlobalBoundsRef.current !== undefined) {
                setCropBounds(savedGlobalBoundsRef.current);
                setLocalBounds(savedGlobalBoundsRef.current);
                savedGlobalBoundsRef.current = undefined;
              }
              setPerFileEditTarget(null);
              onSwitchToQueue?.();
            }}
            className="flex-shrink-0 px-3 py-1 text-xs font-medium rounded-lg bg-warning text-white hover:bg-warning/90 transition-all"
          >
            この範囲をファイルに適用
          </button>
          <button
            onClick={() => {
              // 編集前のグローバル範囲を復元
              if (savedGlobalBoundsRef.current !== undefined) {
                setCropBounds(savedGlobalBoundsRef.current);
                setLocalBounds(savedGlobalBoundsRef.current);
                savedGlobalBoundsRef.current = undefined;
              }
              setPerFileEditTarget(null);
              onSwitchToQueue?.();
            }}
            className="flex-shrink-0 px-3 py-1 text-xs rounded-lg bg-bg-tertiary text-text-muted hover:text-text-primary transition-all"
          >
            キャンセル
          </button>
        </div>
      )}

      {/* Canvas Area with optional rulers */}
      <div ref={containerRef} className="flex-1 overflow-hidden relative">
        <div
          className="w-full h-full grid"
          style={{
            gridTemplateColumns: `${RULER_SIZE}px 1fr`,
            gridTemplateRows: `${RULER_SIZE}px 1fr`,
          }}
        >
          {/* Corner */}
          <div className="bg-[#f8f6f3] border-r border-b border-[#ddd8d3]" />

          {/* Horizontal Ruler */}
          {imageLayout && originalSize && (
            <CanvasRuler
              direction="horizontal"
              length={containerSize.width - RULER_SIZE}
              imageSize={originalSize}
              scaledImageSize={imageLayout.displayW}
              offset={imageLayout.offsetX}
              zoom={zoom}
              onDragStart={handleRulerDragStart}
            />
          )}

          {/* Vertical Ruler */}
          {imageLayout && originalSize && (
            <CanvasRuler
              direction="vertical"
              length={containerSize.height - RULER_SIZE}
              imageSize={originalSize}
              scaledImageSize={imageLayout.displayH}
              offset={imageLayout.offsetY}
              zoom={zoom}
              onDragStart={handleRulerDragStart}
            />
          )}

          {/* Preview Container */}
          <div
            ref={previewContainerRef}
            className={`relative bg-[#e8e6e3] ${cursorClass} ${zoom > 1 ? "overflow-auto" : "overflow-hidden"}`}
            onClick={handleCanvasClick}
            onMouseDown={handlePanMouseDown}
          >
            <div style={{ width: previewAreaW, height: previewAreaH, position: "relative" }}>
              {renderPreviewContent()}
            </div>
          </div>
        </div>

        {/* Floating JSON Load Button */}
        {cropEnabled && (
          <div
            className="absolute bottom-14 right-4 z-40"
            onMouseEnter={() => setJsonBtnHover(true)}
            onMouseLeave={() => setJsonBtnHover(false)}
          >
            {jsonBtnVisible ? (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setShowJsonLoadDialog(true)}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="flex items-center gap-2.5 px-5 py-3 text-base font-medium rounded-xl bg-bg-secondary/80 text-text-secondary backdrop-blur-md border border-border/40 shadow-[0_2px_12px_rgba(0,0,0,0.08)] hover:bg-bg-secondary/95 hover:text-text-primary hover:shadow-[0_4px_16px_rgba(0,0,0,0.12)] hover:-translate-y-0.5 transition-all duration-200"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                    />
                  </svg>
                  JSON読み込み
                </button>
                {/* Hide toggle */}
                <button
                  onClick={() => setJsonBtnVisible(false)}
                  onMouseDown={(e) => e.stopPropagation()}
                  className={`p-1.5 rounded-lg transition-all duration-200 ${
                    jsonBtnHover
                      ? "bg-bg-secondary/80 text-text-muted hover:text-text-primary backdrop-blur-sm border border-border/50"
                      : "opacity-0 pointer-events-none"
                  }`}
                  title="ボタンを非表示"
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
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                    />
                  </svg>
                </button>
              </div>
            ) : (
              /* Hidden state — show eye icon on hover to restore */
              <button
                onClick={() => setJsonBtnVisible(true)}
                onMouseDown={(e) => e.stopPropagation()}
                className={`p-2 rounded-lg transition-all duration-300 ${
                  jsonBtnHover
                    ? "bg-bg-secondary/90 text-accent-secondary backdrop-blur-sm border border-accent-secondary/30 shadow-md"
                    : "bg-bg-secondary/40 text-text-muted/30 backdrop-blur-sm"
                }`}
                title="JSON読み込みボタンを表示"
              >
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
              </button>
            )}
          </div>
        )}

        {/* Zoom indicator */}
        {zoom !== 1 && (
          <div className="absolute bottom-2 right-2 z-40 bg-bg-secondary/90 px-3 py-1.5 rounded-md text-xs text-text-muted backdrop-blur-sm border border-text-muted/10">
            {Math.round(zoom * 100)}%
          </div>
        )}
      </div>

      {/* Info Bar */}
      <div className="px-4 py-1.5 border-t border-border flex items-center gap-4 text-[10px] text-text-muted">
        {originalSize && (
          <span>
            キャンバス: {originalSize.width} x {originalSize.height}
          </span>
        )}
        {cropEnabled && localBounds && (
          <span className="font-mono">
            ({localBounds.left},{localBounds.top}) → ({localBounds.right},{localBounds.bottom})
          </span>
        )}
        <div className="flex-1" />
        {cropEnabled && (
          <span className="text-text-muted/60">
            比率 {ASPECT_W}:{ASPECT_H}
          </span>
        )}
      </div>

      {/* JSON Load Dialog */}
      {showJsonLoadDialog && (
        <CropJsonLoadDialog
          onLoad={(preset, jsonPath) => {
            loadCropPreset(preset);
            if (jsonPath) {
              useTiffStore.getState().setCropSourceJsonPath(jsonPath);
            }
            setShowJsonLoadDialog(false);
          }}
          onClose={() => setShowJsonLoadDialog(false)}
        />
      )}
    </div>
  );

  // --- Helper: render preview content ---
  function renderPreviewContent() {
    return (
      <>
        {/* Loading */}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-8 h-8 rounded-full border-2 border-accent-warm/30 border-t-accent-warm animate-spin" />
          </div>
        )}

        {/* Image */}
        {imageUrl && imageLayout && (
          <img
            src={imageUrl}
            alt=""
            className="absolute pointer-events-none select-none"
            style={{
              left: imageLayout.offsetX,
              top: imageLayout.offsetY,
              width: imageLayout.displayW,
              height: imageLayout.displayH,
            }}
            draggable={false}
          />
        )}

        {/* PSD Original Guides (read-only reference overlay) */}
        {imageLayout &&
          originalSize &&
          psdGuides.length > 0 &&
          psdGuides.map((guide, i) =>
            guide.direction === "horizontal" ? (
              <div
                key={`psd-g-${i}`}
                className="absolute z-[5] pointer-events-none"
                style={{
                  left: imageLayout.offsetX,
                  top: imageLayout.offsetY + guide.position * imageLayout.scale,
                  width: imageLayout.displayW,
                  height: 1,
                  background: "#00e5ff",
                  opacity: 0.55,
                  boxShadow: "0 0 3px rgba(0,229,255,0.4)",
                }}
              />
            ) : (
              <div
                key={`psd-g-${i}`}
                className="absolute z-[5] pointer-events-none"
                style={{
                  left: imageLayout.offsetX + guide.position * imageLayout.scale,
                  top: imageLayout.offsetY,
                  width: 1,
                  height: imageLayout.displayH,
                  background: "#00e5ff",
                  opacity: 0.55,
                  boxShadow: "0 0 3px rgba(0,229,255,0.4)",
                }}
              />
            ),
          )}

        {/* Guide Lines (only when crop is enabled) */}
        {cropEnabled && showRulers && imageLayout && originalSize && (
          <>
            {cropGuides.map((guide, i) => {
              const isSelected = selectedCropGuideIndex === i;
              // クロップ範囲がある場合、未選択ガイドはpointer-events: noneにして
              // クロップ矩形の操作（移動/リサイズ）を妨げない
              const guideInteractive = !localBounds || isSelected;
              if (guide.direction === "horizontal") {
                const py = imageLayout.offsetY + guide.position * imageLayout.scale;
                return (
                  <div
                    key={`g-${i}`}
                    className="absolute z-20"
                    style={{
                      left: imageLayout.offsetX,
                      top: py - GUIDE_HIT_HALF,
                      width: imageLayout.displayW,
                      height: GUIDE_HIT_HALF * 2,
                      cursor: guideInteractive ? "ns-resize" : "default",
                      pointerEvents: guideInteractive ? "auto" : "none",
                    }}
                    onMouseDown={(e) => handleGuideDragStart(i, e)}
                  >
                    <div
                      className="absolute left-0 right-0"
                      style={{
                        top: GUIDE_HIT_HALF - 1,
                        height: 2,
                        background: isSelected
                          ? "linear-gradient(90deg, #ff5a8a, #ffb142, #ff5a8a)"
                          : "linear-gradient(90deg, rgba(255,177,66,0.6), rgba(255,90,138,0.6), rgba(255,177,66,0.6))",
                        boxShadow: isSelected ? "0 0 6px rgba(255,177,66,0.4)" : "none",
                      }}
                    />
                    {isSelected && (
                      <div
                        className="absolute w-3 h-3 rounded-full bg-accent-warm border-2 border-white"
                        style={{ left: -6, top: GUIDE_HIT_HALF - 6 }}
                      />
                    )}
                  </div>
                );
              } else {
                const px = imageLayout.offsetX + guide.position * imageLayout.scale;
                return (
                  <div
                    key={`g-${i}`}
                    className="absolute z-20"
                    style={{
                      left: px - GUIDE_HIT_HALF,
                      top: imageLayout.offsetY,
                      width: GUIDE_HIT_HALF * 2,
                      height: imageLayout.displayH,
                      cursor: guideInteractive ? "ew-resize" : "default",
                      pointerEvents: guideInteractive ? "auto" : "none",
                    }}
                    onMouseDown={(e) => handleGuideDragStart(i, e)}
                  >
                    <div
                      className="absolute top-0 bottom-0"
                      style={{
                        left: GUIDE_HIT_HALF - 1,
                        width: 2,
                        background: isSelected
                          ? "linear-gradient(180deg, #ff5a8a, #ffb142, #ff5a8a)"
                          : "linear-gradient(180deg, rgba(255,177,66,0.6), rgba(255,90,138,0.6), rgba(255,177,66,0.6))",
                        boxShadow: isSelected ? "0 0 6px rgba(255,177,66,0.4)" : "none",
                      }}
                    />
                    {isSelected && (
                      <div
                        className="absolute w-3 h-3 rounded-full bg-accent-warm border-2 border-white"
                        style={{ top: -6, left: GUIDE_HIT_HALF - 6 }}
                      />
                    )}
                  </div>
                );
              }
            })}

            {/* Preview guide line (while dragging from ruler) */}
            {rulerDragging &&
              previewGuidePos !== null &&
              (rulerDragging.direction === "horizontal" ? (
                <div
                  className="absolute z-30 pointer-events-none"
                  style={{
                    left: imageLayout.offsetX,
                    top: previewGuidePos - 1,
                    width: imageLayout.displayW,
                    height: 2,
                    background:
                      "linear-gradient(90deg, rgba(255,177,66,0.8), rgba(255,90,138,0.8), rgba(255,177,66,0.8))",
                    boxShadow: "0 0 8px rgba(255,177,66,0.5)",
                  }}
                />
              ) : (
                <div
                  className="absolute z-30 pointer-events-none"
                  style={{
                    left: previewGuidePos - 1,
                    top: imageLayout.offsetY,
                    width: 2,
                    height: imageLayout.displayH,
                    background:
                      "linear-gradient(180deg, rgba(255,177,66,0.8), rgba(255,90,138,0.8), rgba(255,177,66,0.8))",
                    boxShadow: "0 0 8px rgba(255,177,66,0.5)",
                  }}
                />
              ))}
          </>
        )}

        {/* Crop Overlay (only when crop is enabled, or individual bounds active) */}
        {imageLayout &&
          (isIndividualBoundsActive ? displayScreenRect : cropEnabled && cropScreenRect) && (
            <>
              {/* Dark overlay outside crop – uses effective (individual or global) rect */}
              {displayScreenRect && (
                <div className="absolute inset-0 pointer-events-none z-10">
                  <div
                    className="absolute bg-black/40"
                    style={{
                      left: imageLayout.offsetX,
                      top: imageLayout.offsetY,
                      width: imageLayout.displayW,
                      height: displayScreenRect.y - imageLayout.offsetY,
                    }}
                  />
                  <div
                    className="absolute bg-black/40"
                    style={{
                      left: imageLayout.offsetX,
                      top: displayScreenRect.y + displayScreenRect.h,
                      width: imageLayout.displayW,
                      height:
                        imageLayout.offsetY +
                        imageLayout.displayH -
                        (displayScreenRect.y + displayScreenRect.h),
                    }}
                  />
                  <div
                    className="absolute bg-black/40"
                    style={{
                      left: imageLayout.offsetX,
                      top: displayScreenRect.y,
                      width: displayScreenRect.x - imageLayout.offsetX,
                      height: displayScreenRect.h,
                    }}
                  />
                  <div
                    className="absolute bg-black/40"
                    style={{
                      left: displayScreenRect.x + displayScreenRect.w,
                      top: displayScreenRect.y,
                      width:
                        imageLayout.offsetX +
                        imageLayout.displayW -
                        (displayScreenRect.x + displayScreenRect.w),
                      height: displayScreenRect.h,
                    }}
                  />
                </div>
              )}

              {/* Individual crop border (solid amber, read-only) – shown when individual bounds active */}
              {isIndividualBoundsActive && displayScreenRect && refFilePerFileBounds && (
                <div
                  className="absolute border-2 pointer-events-none z-10"
                  style={{
                    left: displayScreenRect.x,
                    top: displayScreenRect.y,
                    width: displayScreenRect.w,
                    height: displayScreenRect.h,
                    borderColor: "rgba(245,158,11,0.9)",
                  }}
                >
                  <div className="absolute inset-0 pointer-events-none">
                    <div
                      className="absolute left-1/3 top-0 bottom-0 w-px"
                      style={{ background: "rgba(245,158,11,0.3)" }}
                    />
                    <div
                      className="absolute left-2/3 top-0 bottom-0 w-px"
                      style={{ background: "rgba(245,158,11,0.3)" }}
                    />
                    <div
                      className="absolute top-1/3 left-0 right-0 h-px"
                      style={{ background: "rgba(245,158,11,0.3)" }}
                    />
                    <div
                      className="absolute top-2/3 left-0 right-0 h-px"
                      style={{ background: "rgba(245,158,11,0.3)" }}
                    />
                  </div>
                  <div
                    className="absolute -top-6 left-1/2 -translate-x-1/2 px-2 py-0.5 text-white text-[10px] font-mono rounded whitespace-nowrap"
                    style={{ background: "rgba(245,158,11,0.9)" }}
                  >
                    個別: {refFilePerFileBounds.right - refFilePerFileBounds.left} x{" "}
                    {refFilePerFileBounds.bottom - refFilePerFileBounds.top}
                  </div>
                </div>
              )}

              {/* Global crop border (solid pink, editable) – shown when individual NOT active */}
              {!isIndividualBoundsActive && cropScreenRect && (
                <div
                  className="absolute border-2 border-accent-warm cursor-move z-10"
                  style={{
                    left: cropScreenRect.x,
                    top: cropScreenRect.y,
                    width: cropScreenRect.w,
                    height: cropScreenRect.h,
                  }}
                  onMouseDown={(e) => handleCropMouseDown(e, "move")}
                >
                  <div className="absolute inset-0 pointer-events-none">
                    <div className="absolute left-1/3 top-0 bottom-0 w-px bg-accent-warm/30" />
                    <div className="absolute left-2/3 top-0 bottom-0 w-px bg-accent-warm/30" />
                    <div className="absolute top-1/3 left-0 right-0 h-px bg-accent-warm/30" />
                    <div className="absolute top-2/3 left-0 right-0 h-px bg-accent-warm/30" />
                  </div>
                  {localBounds && (
                    <div className="absolute -top-6 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-accent-warm text-white text-[10px] font-mono rounded whitespace-nowrap">
                      {localBounds.right - localBounds.left} x{" "}
                      {localBounds.bottom - localBounds.top}
                    </div>
                  )}
                </div>
              )}

              {/* Global crop dashed overlay (editable) – shown when individual is active */}
              {isIndividualBoundsActive && cropEnabled && cropScreenRect && (
                <div
                  className="absolute cursor-move z-[8]"
                  style={{
                    left: cropScreenRect.x,
                    top: cropScreenRect.y,
                    width: cropScreenRect.w,
                    height: cropScreenRect.h,
                    border: "2px dashed rgba(255,90,138,0.6)",
                  }}
                  onMouseDown={(e) => handleCropMouseDown(e, "move")}
                >
                  {localBounds && (
                    <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-accent-warm/80 text-white text-[9px] font-mono rounded whitespace-nowrap">
                      グローバル: {localBounds.right - localBounds.left}×
                      {localBounds.bottom - localBounds.top}
                    </div>
                  )}
                </div>
              )}

              {/* Resize handles – always at global cropScreenRect */}
              {cropEnabled &&
                cropScreenRect &&
                (["nw", "ne", "sw", "se", "n", "s", "w", "e"] as DragMode[]).map((handle) => {
                  if (!handle) return null;
                  const size = 8;
                  const half = size / 2;
                  let left = 0,
                    top = 0;

                  if (handle.includes("w")) left = cropScreenRect.x - half;
                  else if (handle.includes("e")) left = cropScreenRect.x + cropScreenRect.w - half;
                  else left = cropScreenRect.x + cropScreenRect.w / 2 - half;

                  if (handle.includes("n")) top = cropScreenRect.y - half;
                  else if (handle.includes("s")) top = cropScreenRect.y + cropScreenRect.h - half;
                  else top = cropScreenRect.y + cropScreenRect.h / 2 - half;

                  const cursorMap: Record<string, string> = {
                    nw: "nwse-resize",
                    ne: "nesw-resize",
                    sw: "nesw-resize",
                    se: "nwse-resize",
                    n: "ns-resize",
                    s: "ns-resize",
                    w: "ew-resize",
                    e: "ew-resize",
                  };

                  return (
                    <div
                      key={handle}
                      className="absolute w-2 h-2 bg-white border-2 border-accent-warm rounded-sm z-10"
                      style={{ left, top, width: size, height: size, cursor: cursorMap[handle] }}
                      onMouseDown={(e) => handleCropMouseDown(e, handle)}
                    />
                  );
                })}
            </>
          )}

        {/* 参照ファイルのクロップスキップ表示 */}
        {refFilePerFileBounds === null && imageLayout && (
          <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
            <div className="px-3 py-1.5 bg-error/75 text-white text-xs rounded-lg font-medium backdrop-blur-sm">
              このファイルはクロップをスキップ
            </div>
          </div>
        )}

        {/* Empty state (only when crop is enabled) */}
        {cropEnabled && !localBounds && imageUrl && !isLoading && cropGuides.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="px-4 py-2 bg-black/50 text-white text-xs rounded-lg">
              クリックで範囲作成 / 定規からガイド追加
            </div>
          </div>
        )}
      </>
    );
  }
}
