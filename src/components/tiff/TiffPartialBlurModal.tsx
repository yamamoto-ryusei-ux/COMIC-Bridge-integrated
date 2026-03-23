import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { usePsdStore } from "../../store/psdStore";
import { useTiffStore } from "../../store/tiffStore";
import { useHighResPreview } from "../../hooks/useHighResPreview";
import type { PartialBlurEntry, BlurRegion } from "../../types/tiff";

const MAX_ENTRIES = 5;

type DrawTool = "rect" | "polygon";

interface Point {
  x: number;
  y: number;
}

// --- ID生成 ---
let regionIdCounter = 0;
function genRegionId(): string {
  return `rgn_${Date.now()}_${++regionIdCounter}`;
}

// --- SVGドキュメント座標変換 ---
function clientToDoc(
  clientX: number,
  clientY: number,
  svgEl: SVGSVGElement,
  docW: number,
  docH: number,
): Point {
  const rect = svgEl.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * docW;
  const y = ((clientY - rect.top) / rect.height) * docH;
  return {
    x: Math.max(0, Math.min(docW, Math.round(x))),
    y: Math.max(0, Math.min(docH, Math.round(y))),
  };
}

// --- ポリゴン→SVG path文字列 ---
function pointsToPath(pts: Point[]): string {
  if (pts.length === 0) return "";
  return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ") + " Z";
}

// --- 矩形を4点ポリゴンに変換 ---
function rectToPoints(start: Point, end: Point): Point[] {
  const x1 = Math.min(start.x, end.x);
  const y1 = Math.min(start.y, end.y);
  const x2 = Math.max(start.x, end.x);
  const y2 = Math.max(start.y, end.y);
  return [
    { x: x1, y: y1 },
    { x: x2, y: y1 },
    { x: x2, y: y2 },
    { x: x1, y: y2 },
  ];
}

// --- 色パレット（領域ごとに色分け） ---
const REGION_COLORS = [
  "#ff5a8a",
  "#7c5cff",
  "#00c9a7",
  "#f59e0b",
  "#ef4444",
  "#3b82f6",
  "#8b5cf6",
  "#10b981",
  "#f97316",
  "#ec4899",
];
function regionColor(index: number): string {
  return REGION_COLORS[index % REGION_COLORS.length];
}

export function TiffPartialBlurModal({
  onClose,
  externalEntries,
  onSave,
}: {
  onClose: () => void;
  externalEntries?: PartialBlurEntry[];
  onSave?: (entries: PartialBlurEntry[]) => void;
}) {
  const files = usePsdStore((s) => s.files);
  const partialBlurEntries = useTiffStore((s) => s.settings.partialBlurEntries);
  const setPartialBlurEntries = useTiffStore((s) => s.setPartialBlurEntries);

  // --- 状態 ---
  const [entries, setEntries] = useState<PartialBlurEntry[]>(() => {
    // per-fileモード（onSave提供時）: overrideがない場合はグローバル設定にフォールバックしない
    // グローバルモード（onSave未提供時）: グローバル設定を初期値として使用
    const source = externalEntries ?? (onSave ? [] : partialBlurEntries);
    const initial = [...source];
    while (initial.length < MAX_ENTRIES) {
      initial.push({ pageNumber: 0, blurRadius: 0, regions: [] });
    }
    return initial;
  });
  const [activeEntryIndex, setActiveEntryIndex] = useState<number>(() => {
    const firstActive = entries.findIndex((e) => e.pageNumber > 0);
    return firstActive >= 0 ? firstActive : 0;
  });
  const [tool, setTool] = useState<DrawTool>("rect");
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);

  // 描画中の状態
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<Point | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<Point | null>(null);
  const [polygonPoints, setPolygonPoints] = useState<Point[]>([]);

  const svgRef = useRef<SVGSVGElement>(null);

  // 現在のエントリ
  const activeEntry = entries[activeEntryIndex];
  const activePageNumber = activeEntry?.pageNumber ?? 0;

  // プレビュー対象ファイル（ページ番号は1-based → files配列は0-based）
  const previewFileIndex = activePageNumber > 0 ? activePageNumber - 1 : 0;
  const previewFile = files[previewFileIndex] ?? files[0];

  const { imageUrl, originalSize, isLoading } = useHighResPreview(
    previewFile?.filePath ?? undefined,
    {
      maxSize: 2000,
      enabled: !!previewFile,
      pdfPageIndex: previewFile?.pdfPageIndex,
      pdfSourcePath: previewFile?.pdfSourcePath,
    },
  );

  const docW = originalSize?.width ?? 0;
  const docH = originalSize?.height ?? 0;

  // --- エントリ操作 ---
  const updateEntry = (index: number, partial: Partial<PartialBlurEntry>) => {
    setEntries((prev) => prev.map((e, i) => (i === index ? { ...e, ...partial } : e)));
  };

  const addRegionToEntry = useCallback(
    (region: BlurRegion) => {
      setEntries((prev) =>
        prev.map((e, i) =>
          i === activeEntryIndex ? { ...e, regions: [...(e.regions ?? []), region] } : e,
        ),
      );
    },
    [activeEntryIndex],
  );

  const removeRegion = (regionId: string) => {
    setEntries((prev) =>
      prev.map((e, i) =>
        i === activeEntryIndex
          ? { ...e, regions: (e.regions ?? []).filter((r) => r.id !== regionId) }
          : e,
      ),
    );
    if (selectedRegionId === regionId) setSelectedRegionId(null);
  };

  const updateRegionBlur = (regionId: string, blurRadius: number) => {
    setEntries((prev) =>
      prev.map((e, i) =>
        i === activeEntryIndex
          ? {
              ...e,
              regions: (e.regions ?? []).map((r) => (r.id === regionId ? { ...r, blurRadius } : r)),
            }
          : e,
      ),
    );
  };

  // --- 矩形ツール ---
  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (tool !== "rect" || !svgRef.current || docW === 0) return;
    if (activePageNumber <= 0) return;
    e.preventDefault();
    const pt = clientToDoc(e.clientX, e.clientY, svgRef.current, docW, docH);
    setIsDrawing(true);
    setDrawStart(pt);
    setDrawCurrent(pt);
    setSelectedRegionId(null);
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!isDrawing || tool !== "rect" || !svgRef.current || docW === 0) return;
    const pt = clientToDoc(e.clientX, e.clientY, svgRef.current, docW, docH);
    setDrawCurrent(pt);
  };

  const handleMouseUp = () => {
    if (!isDrawing || tool !== "rect" || !drawStart || !drawCurrent) {
      setIsDrawing(false);
      return;
    }
    const dx = Math.abs(drawCurrent.x - drawStart.x);
    const dy = Math.abs(drawCurrent.y - drawStart.y);
    if (dx > 5 && dy > 5) {
      const pts = rectToPoints(drawStart, drawCurrent);
      const region: BlurRegion = {
        id: genRegionId(),
        points: pts,
        blurRadius: activeEntry?.blurRadius ?? 2.8,
      };
      addRegionToEntry(region);
      setSelectedRegionId(region.id);
    }
    setIsDrawing(false);
    setDrawStart(null);
    setDrawCurrent(null);
  };

  // --- ポリゴンツール ---
  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (tool !== "polygon" || !svgRef.current || docW === 0) return;
    if (activePageNumber <= 0) return;
    e.preventDefault();
    const pt = clientToDoc(e.clientX, e.clientY, svgRef.current, docW, docH);

    // 始点近くクリック → 閉じる
    if (polygonPoints.length >= 3) {
      const first = polygonPoints[0];
      const dist = Math.sqrt((pt.x - first.x) ** 2 + (pt.y - first.y) ** 2);
      // ドキュメント座標で閾値を計算（プレビュー幅の2%程度）
      const threshold = Math.max(docW, docH) * 0.02;
      if (dist < threshold) {
        finishPolygon();
        return;
      }
    }

    setPolygonPoints((prev) => [...prev, pt]);
    setSelectedRegionId(null);
  };

  const handleSvgDblClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (tool !== "polygon") return;
    e.preventDefault();
    e.stopPropagation();
    if (polygonPoints.length >= 3) {
      finishPolygon();
    }
  };

  const handleSvgMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (tool === "rect") {
      handleMouseMove(e);
      return;
    }
    if (tool === "polygon" && polygonPoints.length > 0 && svgRef.current && docW > 0) {
      const pt = clientToDoc(e.clientX, e.clientY, svgRef.current, docW, docH);
      setDrawCurrent(pt);
    }
  };

  const finishPolygon = () => {
    if (polygonPoints.length < 3) {
      setPolygonPoints([]);
      return;
    }
    const region: BlurRegion = {
      id: genRegionId(),
      points: [...polygonPoints],
      blurRadius: activeEntry?.blurRadius ?? 2.8,
    };
    addRegionToEntry(region);
    setSelectedRegionId(region.id);
    setPolygonPoints([]);
    setDrawCurrent(null);
  };

  // --- キーボード ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (polygonPoints.length > 0) {
          setPolygonPoints([]);
          setDrawCurrent(null);
        } else if (isDrawing) {
          setIsDrawing(false);
          setDrawStart(null);
          setDrawCurrent(null);
        }
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedRegionId) {
        removeRegion(selectedRegionId);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [polygonPoints, isDrawing, selectedRegionId]);

  // --- 保存 ---
  const handleSave = () => {
    const valid = entries.filter((e) => e.pageNumber > 0);
    if (onSave) {
      onSave(valid);
    } else {
      setPartialBlurEntries(valid);
    }
    onClose();
  };

  // --- 現在のエントリのregions ---
  const regions = activeEntry?.regions ?? [];

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-bg-secondary border border-border rounded-2xl shadow-xl overflow-hidden flex flex-col"
        style={{ width: "90vw", height: "85vh", maxWidth: 1400 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* ===== Header ===== */}
        <div className="px-5 py-3 border-b border-border flex items-center gap-4 flex-shrink-0">
          <h3 className="text-sm font-display font-bold text-text-primary">部分ぼかし設定</h3>

          {/* ページ選択 */}
          <div className="flex items-center gap-2">
            {entries.map((entry, i) => (
              <button
                key={i}
                onClick={() => {
                  setActiveEntryIndex(i);
                  setSelectedRegionId(null);
                  setPolygonPoints([]);
                }}
                className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${
                  i === activeEntryIndex
                    ? "bg-accent/20 text-accent font-medium border border-accent/30"
                    : entry.pageNumber > 0
                      ? "bg-bg-tertiary text-text-secondary hover:bg-bg-tertiary/80"
                      : "bg-bg-tertiary/50 text-text-muted hover:bg-bg-tertiary/80"
                }`}
              >
                {entry.pageNumber > 0 ? `P${entry.pageNumber}` : `${i + 1}`}
                {(entry.regions?.length ?? 0) > 0 && (
                  <span className="ml-1 text-[10px] text-accent-secondary">
                    ({entry.regions!.length})
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="flex-1" />

          {/* ツール切替 */}
          <div className="flex items-center gap-1 bg-bg-tertiary rounded-lg p-0.5">
            <button
              onClick={() => {
                setTool("rect");
                setPolygonPoints([]);
              }}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                tool === "rect"
                  ? "bg-accent-secondary text-white shadow-sm"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              矩形
            </button>
            <button
              onClick={() => {
                setTool("polygon");
                setIsDrawing(false);
              }}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                tool === "polygon"
                  ? "bg-accent-secondary text-white shadow-sm"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              多角形
            </button>
          </div>

          {/* 座標表示 */}
          {drawCurrent && (
            <span className="text-[10px] font-mono text-text-muted">
              ({drawCurrent.x}, {drawCurrent.y})
            </span>
          )}
        </div>

        {/* ===== Content ===== */}
        <div className="flex flex-1 min-h-0">
          {/* ===== Left: Preview + SVG ===== */}
          <div className="flex-1 relative bg-bg-tertiary flex items-center justify-center overflow-hidden">
            {activePageNumber <= 0 ? (
              <div className="text-center p-8">
                <p className="text-sm text-text-muted mb-2">
                  右パネルでページ番号を設定してください
                </p>
                <p className="text-xs text-text-muted">
                  ページ番号 &gt; 0 のエントリを選択すると、プレビューが表示されます
                </p>
              </div>
            ) : isLoading && !imageUrl ? (
              <div className="text-sm text-text-muted animate-pulse">読み込み中...</div>
            ) : imageUrl && docW > 0 && docH > 0 ? (
              <div className="relative w-full h-full flex items-center justify-center p-4">
                <div
                  className="relative"
                  style={{
                    maxWidth: "100%",
                    maxHeight: "100%",
                    aspectRatio: `${docW} / ${docH}`,
                  }}
                >
                  <img
                    src={imageUrl}
                    alt="Preview"
                    className="w-full h-full object-contain pointer-events-none select-none"
                    draggable={false}
                  />
                  {/* SVG Overlay */}
                  <svg
                    ref={svgRef}
                    viewBox={`0 0 ${docW} ${docH}`}
                    className="absolute inset-0 w-full h-full"
                    style={{ cursor: tool === "rect" ? "crosshair" : "crosshair" }}
                    onMouseDown={tool === "rect" ? handleMouseDown : undefined}
                    onMouseMove={handleSvgMouseMove}
                    onMouseUp={tool === "rect" ? handleMouseUp : undefined}
                    onClick={tool === "polygon" ? handleSvgClick : undefined}
                    onDoubleClick={tool === "polygon" ? handleSvgDblClick : undefined}
                  >
                    {/* 既存の領域 */}
                    {regions.map((region, ri) => (
                      <g key={region.id}>
                        <path
                          d={pointsToPath(region.points)}
                          fill={regionColor(ri)}
                          fillOpacity={0.2}
                          stroke={regionColor(ri)}
                          strokeWidth={selectedRegionId === region.id ? 3 : 2}
                          strokeDasharray={selectedRegionId === region.id ? "none" : "6 3"}
                          vectorEffect="non-scaling-stroke"
                          className="cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedRegionId(region.id);
                          }}
                        />
                        {/* 領域番号ラベル */}
                        <text
                          x={region.points[0]?.x ?? 0}
                          y={region.points[0]?.y ?? 0}
                          dy={-8}
                          fill={regionColor(ri)}
                          fontSize={Math.max(docW * 0.015, 14)}
                          fontWeight="bold"
                          style={{ pointerEvents: "none", userSelect: "none" }}
                        >
                          {ri + 1}
                        </text>
                      </g>
                    ))}

                    {/* 矩形描画中 */}
                    {isDrawing && drawStart && drawCurrent && tool === "rect" && (
                      <path
                        d={pointsToPath(rectToPoints(drawStart, drawCurrent))}
                        fill="#ff5a8a"
                        fillOpacity={0.15}
                        stroke="#ff5a8a"
                        strokeWidth={2}
                        strokeDasharray="8 4"
                        vectorEffect="non-scaling-stroke"
                      />
                    )}

                    {/* ポリゴン描画中 */}
                    {polygonPoints.length > 0 && tool === "polygon" && (
                      <g>
                        {/* 確定済みのライン */}
                        <polyline
                          points={polygonPoints.map((p) => `${p.x},${p.y}`).join(" ")}
                          fill="none"
                          stroke="#7c5cff"
                          strokeWidth={2}
                          vectorEffect="non-scaling-stroke"
                        />
                        {/* カーソルへのガイドライン */}
                        {drawCurrent && (
                          <line
                            x1={polygonPoints[polygonPoints.length - 1].x}
                            y1={polygonPoints[polygonPoints.length - 1].y}
                            x2={drawCurrent.x}
                            y2={drawCurrent.y}
                            stroke="#7c5cff"
                            strokeWidth={1}
                            strokeDasharray="4 4"
                            vectorEffect="non-scaling-stroke"
                          />
                        )}
                        {/* 始点閉じるガイド */}
                        {drawCurrent && polygonPoints.length >= 3 && (
                          <line
                            x1={drawCurrent.x}
                            y1={drawCurrent.y}
                            x2={polygonPoints[0].x}
                            y2={polygonPoints[0].y}
                            stroke="#7c5cff"
                            strokeWidth={1}
                            strokeDasharray="2 4"
                            strokeOpacity={0.4}
                            vectorEffect="non-scaling-stroke"
                          />
                        )}
                        {/* 頂点マーカー */}
                        {polygonPoints.map((p, pi) => (
                          <circle
                            key={pi}
                            cx={p.x}
                            cy={p.y}
                            r={pi === 0 ? 6 : 4}
                            fill={pi === 0 ? "#7c5cff" : "white"}
                            stroke="#7c5cff"
                            strokeWidth={2}
                            vectorEffect="non-scaling-stroke"
                          />
                        ))}
                      </g>
                    )}
                  </svg>
                </div>
              </div>
            ) : (
              <div className="text-sm text-text-muted">プレビューを読み込めません</div>
            )}

            {/* ヘルプオーバーレイ */}
            {activePageNumber > 0 && imageUrl && (
              <div className="absolute bottom-3 left-3 bg-black/60 text-white text-[10px] px-2.5 py-1.5 rounded-lg pointer-events-none">
                {tool === "rect"
                  ? "ドラッグで矩形を描画"
                  : "クリックで頂点を追加 / ダブルクリックまたは始点クリックで閉じる"}
                {" | Esc: キャンセル | Del: 選択領域を削除"}
              </div>
            )}
          </div>

          {/* ===== Right: Settings Panel ===== */}
          <div className="w-72 flex-shrink-0 border-l border-border flex flex-col">
            {/* エントリ設定 */}
            <div className="p-4 border-b border-border space-y-3">
              <h4 className="text-xs font-medium text-text-primary">
                スロット {activeEntryIndex + 1}
              </h4>
              <div className="flex items-center gap-2">
                <label className="text-xs text-text-secondary w-16">ページ:</label>
                <select
                  value={activeEntry?.pageNumber ?? 0}
                  onChange={(e) => {
                    updateEntry(activeEntryIndex, {
                      pageNumber: parseInt(e.target.value) || 0,
                    });
                  }}
                  className="flex-1 px-2 py-1 text-sm bg-bg-elevated border border-border/50 rounded-lg text-text-primary focus:outline-none focus:border-accent-warm/50"
                >
                  <option value={0}>-- 未設定 --</option>
                  {files.map((file, i) => (
                    <option key={file.id} value={i + 1}>
                      {i + 1}. {file.fileName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-text-secondary w-16">半径:</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={activeEntry?.blurRadius ?? 0}
                  onChange={(e) =>
                    updateEntry(activeEntryIndex, {
                      blurRadius: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-20 px-2 py-1 text-sm bg-bg-elevated border border-border/50 rounded-lg text-text-primary focus:outline-none focus:border-accent-warm/50"
                />
                <span className="text-xs text-text-muted">px（デフォルト）</span>
              </div>
            </div>

            {/* 領域リスト */}
            <div className="flex-1 overflow-auto p-4 space-y-2">
              <div className="flex items-center justify-between mb-1">
                <h4 className="text-xs font-medium text-text-primary">
                  領域一覧 ({regions.length})
                </h4>
                {regions.length > 0 && (
                  <button
                    onClick={() => {
                      updateEntry(activeEntryIndex, { regions: [] });
                      setSelectedRegionId(null);
                    }}
                    className="text-[10px] text-text-muted hover:text-error transition-colors"
                  >
                    全削除
                  </button>
                )}
              </div>

              {regions.length === 0 && activePageNumber > 0 && (
                <p className="text-[10px] text-text-muted py-2">
                  プレビュー上で範囲を描画してください。
                  領域が無い場合、ドキュメント全体に半径が適用されます。
                </p>
              )}

              {regions.map((region, ri) => (
                <div
                  key={region.id}
                  onClick={() => setSelectedRegionId(region.id)}
                  className={`p-2 rounded-lg border cursor-pointer transition-colors ${
                    selectedRegionId === region.id
                      ? "border-accent/50 bg-accent/5"
                      : "border-border/50 bg-bg-elevated hover:border-border"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-sm flex-shrink-0"
                      style={{ backgroundColor: regionColor(ri) }}
                    />
                    <span className="text-xs text-text-primary font-medium flex-1">
                      領域 {ri + 1}
                    </span>
                    <span className="text-[10px] text-text-muted">{region.points.length}点</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeRegion(region.id);
                      }}
                      className="text-text-muted hover:text-error text-xs transition-colors"
                    >
                      ×
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1.5 ml-5">
                    <label className="text-[10px] text-text-muted">半径:</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={region.blurRadius}
                      onChange={(e) => {
                        e.stopPropagation();
                        updateRegionBlur(region.id, parseFloat(e.target.value) || 0);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="w-16 px-1.5 py-0.5 text-xs bg-bg-secondary border border-border/50 rounded text-text-primary focus:outline-none focus:border-accent-warm/50"
                    />
                    <span className="text-[10px] text-text-muted">px</span>
                  </div>
                </div>
              ))}
            </div>

            {/* ファイル参照リスト */}
            <div className="border-t border-border p-3">
              <h4 className="text-[10px] font-medium text-text-muted mb-1">ファイル一覧</h4>
              <div className="bg-bg-tertiary rounded-lg p-1.5 max-h-24 overflow-auto space-y-0.5">
                {files.map((file, i) => (
                  <div
                    key={file.id}
                    className={`flex items-center gap-1 text-[10px] px-1 rounded ${
                      i + 1 === activePageNumber
                        ? "bg-accent/10 text-accent"
                        : "text-text-secondary"
                    }`}
                  >
                    <span className="font-mono w-4 text-right">{i + 1}.</span>
                    <span className="truncate">{file.fileName}</span>
                  </div>
                ))}
                {files.length === 0 && (
                  <p className="text-[10px] text-text-muted text-center py-1">ファイルなし</p>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="p-3 border-t border-border flex justify-end gap-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-xs font-medium text-text-secondary bg-bg-tertiary rounded-xl hover:bg-bg-tertiary/80 transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={handleSave}
                className="px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-accent-warm to-accent rounded-xl hover:-translate-y-0.5 transition-all shadow-sm"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
