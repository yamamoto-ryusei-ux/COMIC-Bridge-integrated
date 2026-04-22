import { useState, useMemo } from "react";
import { usePsdStore } from "../../store/psdStore";
import { LayerTree } from "../metadata/LayerTree";
import {
  collectTextLayers,
  useFontResolver,
} from "../../hooks/useFontResolver";
import { LayerDiagnosticsBar } from "../../features/layer-control/components/LayerPreviewPanel";

export function SpecLayerGrid() {
  const files = usePsdStore((s) => s.files);
  const activeFileId = usePsdStore((s) => s.activeFileId);
  const selectFile = usePsdStore((s) => s.selectFile);
  const [textOnly, setTextOnly] = useState(false);
  const { fontInfo } = useFontResolver(files);

  // 全ファイル合計サマリー
  const totalSummary = useMemo(() => {
    const fontCounts = new Map<string, number>();
    const sizeCounts = new Map<number, number>();
    const nonSharpLayers: string[] = [];
    const metricsLayers: string[] = [];
    let totalTextLayers = 0;
    for (const file of files) {
      if (!file.metadata?.layerTree) continue;
      const tls = collectTextLayers(file.metadata.layerTree);
      totalTextLayers += tls.length;
      for (const tl of tls) {
        if (tl.textInfo) {
          for (const f of tl.textInfo.fonts) fontCounts.set(f, (fontCounts.get(f) || 0) + 1);
          for (const s of tl.textInfo.fontSizes) sizeCounts.set(s, (sizeCounts.get(s) || 0) + 1);
          // isAllSharp未計算時（Rustメタデータ）はantiAlias値から判定
          const aa = tl.textInfo.antiAlias;
          const sharp = tl.textInfo.isAllSharp ?? (!aa || aa.toLowerCase().includes("sharp") || aa.toLowerCase() === "ansh");
          if (!sharp) nonSharpLayers.push(`${file.fileName}/${tl.layerName}`);
          // メトリクスカーニングのみ集計
          if (tl.textInfo.hasMetricsKerning) metricsLayers.push(`${file.fileName}/${tl.layerName}`);
        }
      }
    }
    const fonts = [...fontCounts.entries()].sort((a, b) => b[1] - a[1]);
    const sizes = [...sizeCounts.entries()].sort((a, b) => b[1] - a[1]);
    return { fonts, sizes, mostFreqSize: sizes[0]?.[0] || 0, nonSharpLayers, metricsLayers, totalTextLayers };
  }, [files]);

  return (
    <div className="h-full overflow-auto select-none">
      {/* Controls */}
      <div className="sticky top-0 z-10 bg-bg-primary/95 backdrop-blur-sm px-4 py-2 border-b border-border/30 flex items-center gap-3">
        <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-text-secondary hover:text-text-primary">
          <input
            type="checkbox"
            checked={textOnly}
            onChange={(e) => setTextOnly(e.target.checked)}
            className="rounded border-border accent-accent w-3.5 h-3.5"
          />
          写植仕様のみ表示
        </label>
      </div>

      {/* 診断バー: 未インストールフォント + 共有フォルダ検索 + 白フチ/カーニング統計 */}
      <LayerDiagnosticsBar targetFiles={files} />

      {/* 全ファイル合計サマリー */}
      {totalSummary.totalTextLayers > 0 && (
        <div className="mx-4 mt-3 mb-1 p-3 bg-bg-secondary rounded-xl border border-border/40 text-[10px] space-y-2">
          {/* 使用フォント */}
          <div>
            <div className="flex items-center gap-1 mb-1">
              <span className="text-accent font-bold">T</span>
              <span className="font-medium text-text-primary">使用フォント</span>
              <span className="text-text-muted">{totalSummary.fonts.length}種類 / {totalSummary.totalTextLayers} レイヤー</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {totalSummary.fonts.map(([font, count]) => (
                <span key={font} className="px-1.5 py-0.5 rounded-md bg-accent/10 text-accent border border-accent/20 truncate max-w-[200px]">
                  {fontInfo.getFontLabel(font)} ({count})
                </span>
              ))}
            </div>
          </div>
          {/* サイズ統計 */}
          <div>
            <div className="flex items-center gap-1 mb-1">
              <span className="text-accent-secondary font-bold">≡</span>
              <span className="font-medium text-text-primary">サイズ統計</span>
              <span className="text-text-muted">基本 {totalSummary.mostFreqSize}pt</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {totalSummary.sizes.map(([size, count]) => (
                <span key={size} className="px-1.5 py-0.5 rounded-md bg-accent-secondary/10 text-accent-secondary border border-accent-secondary/20">
                  {size}pt ({count})
                </span>
              ))}
            </div>
          </div>
          {/* シャープ/カーニング判定 */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-bold text-text-muted">AA</span>
            {totalSummary.nonSharpLayers.length === 0 ? (
              <span className="text-success font-medium">全てシャープ</span>
            ) : (
              <span className="px-1.5 py-0.5 rounded bg-error/10 text-error border border-error/20">⚠ シャープ以外 {totalSummary.nonSharpLayers.length}件</span>
            )}
            {totalSummary.metricsLayers.length > 0 && (
              <>
                <span className="w-px h-3 bg-border/40" />
                <span className="px-1.5 py-0.5 rounded bg-error/10 text-error border border-error/20">⚠ メトリクス {totalSummary.metricsLayers.length}件</span>
              </>
            )}
          </div>
        </div>
      )}

      <div
        className="grid gap-3 p-4"
        style={{
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
        }}
      >
        {files.map((file) => {
          const textLayers = file.metadata?.layerTree
            ? collectTextLayers(file.metadata.layerTree)
            : [];
          return (
            <SpecLayerCard
              key={file.id}
              file={file}
              textLayers={textLayers}
              isActive={activeFileId === file.id}
              textOnly={textOnly}
              fontInfo={fontInfo}
              onSelect={() => selectFile(file.id)}
            />
          );
        })}
      </div>
    </div>
  );
}

/** 各ファイルのカード */
function SpecLayerCard({
  file,
  textLayers,
  isActive,
  textOnly,
  fontInfo,
  onSelect,
}: {
  file: any;
  textLayers: any[];
  isActive: boolean;
  textOnly: boolean;
  fontInfo: any;
  onSelect: () => void;
}) {
  return (
    <div
      className={`border rounded-xl cursor-pointer transition-all ${
        isActive
          ? "border-accent ring-2 ring-accent/30 bg-accent/5 shadow-md"
          : "border-border bg-bg-secondary/50 hover:bg-bg-secondary/80 hover:border-border-strong/50"
      }`}
      onClick={(e) => { if (!e.shiftKey && !e.ctrlKey && !e.metaKey) onSelect(); }}
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-border/60 flex items-center gap-2">
        <span className={`text-[11px] font-medium truncate flex-1 ${isActive ? "text-accent" : "text-text-primary"}`}>
          {file.fileName.replace(/\.(psd|psb)$/i, "")}
        </span>
        <span className="text-[10px] text-text-muted flex-shrink-0">{file.metadata?.layerCount ?? 0}L</span>
        {textLayers.length > 0 && <span className="text-[10px] text-accent/60 flex-shrink-0">{textLayers.length}T</span>}
      </div>

      {/* 個別サマリーは廃止 — 全ファイル合計を上部に表示 */}

      {/* Text Layer Spec (写植仕様) — 各レイヤー詳細 */}
      {textLayers.length > 0 ? (
        <div className="p-1.5 border-b border-border/30">
          {textLayers.map((tl, i) => {
            const mainFont = tl.textInfo?.fonts[0];
            const color = mainFont ? fontInfo.getFontColor(mainFont) : "#888";
            return (
              <div key={i} className="flex items-start gap-1.5 py-0.5 text-[10px]">
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1" style={{ backgroundColor: color }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="text-text-primary font-medium truncate">{tl.layerName}</span>
                    {tl.textInfo?.fontSizes?.length ? (
                      <span className="text-text-muted flex-shrink-0">{tl.textInfo.fontSizes.join("/")}pt</span>
                    ) : null}
                  </div>
                  {mainFont && (
                    <div className="truncate" style={{ color }}>
                      {fontInfo.getFontLabel(mainFont)}
                      {fontInfo.isMissing(mainFont) && <span className="text-error ml-1">[未]</span>}
                    </div>
                  )}
                  {/* シャープ以外/メトリクス/白フチ/カーニング値 表示 */}
                  {(() => {
                    const ti: any = tl.textInfo;
                    const aa = ti?.antiAlias;
                    const sharp = ti?.isAllSharp ?? (!aa || aa.toLowerCase().includes("sharp") || aa.toLowerCase() === "ansh");
                    const stroke = (typeof ti?.strokeSize === "number" && ti.strokeSize > 0) ? ti.strokeSize : null;
                    const tracking: number[] = Array.isArray(ti?.tracking) ? ti.tracking.filter((t: number) => t !== 0) : [];
                    const hasAny = !sharp || ti?.hasMetricsKerning || stroke != null || tracking.length > 0;
                    if (!hasAny) return null;
                    return (
                      <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                        {!sharp && <span className="text-[9px] px-1 py-px rounded bg-error/10 text-error">{aa || "非シャープ"}</span>}
                        {ti?.hasMetricsKerning && <span className="text-[9px] px-1 py-px rounded bg-error/10 text-error">メトリクス</span>}
                        {stroke != null && <span className="text-[9px] px-1 py-px rounded bg-accent-tertiary/10 text-accent-tertiary">白フチ {stroke}px</span>}
                        {tracking.length > 0 && (
                          <span className="text-[9px] px-1 py-px rounded bg-warning/10 text-warning">
                            カーニング {tracking.map((t) => (t > 0 ? `+${t}` : t)).join(",")}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                  {tl.textInfo?.text && (
                    <div className="text-text-muted/50 truncate">{tl.textInfo.text.replace(/\n/g, " ").substring(0, 40)}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : textOnly ? (
        <div className="flex items-center justify-center py-4 text-[10px] text-text-muted">テキストレイヤーなし</div>
      ) : null}

      {/* Layer Tree (hidden when textOnly) */}
      {!textOnly && (
        <div className="p-1.5">
          {file.metadata?.layerTree?.length ? (
            <LayerTree layers={file.metadata.layerTree} />
          ) : (
            <div className="flex items-center justify-center py-4 text-[10px] text-text-muted">レイヤー情報なし</div>
          )}
        </div>
      )}
    </div>
  );
}
