import { useState, useMemo } from "react";
import { usePsdStore } from "../../store/psdStore";
import {
  useFontResolver,
  collectTextLayers,
  MISSING_FONT_COLOR,
  type FontHelpers,
  type TextLayerEntry,
} from "../../hooks/useFontResolver";
import { FontBrowserDialog } from "./FontBrowserDialog";

const FONT_SHARE_PATH = "\\\\haku\\CLLENN\\■アシスタント\\★フォント\\★全フォント";

const AA_LABELS: Record<string, string> = {
  // ag-psd format
  antiAliasSharp: "シャープ",
  antiAliasCrisp: "鮮明",
  antiAliasStrong: "強く",
  antiAliasSmooth: "滑らか",
  antiAliasNone: "なし",
  antiAliasPlatformLCD: "LCD",
  antiAliasPlatformLCDSmooth: "LCD(滑らか)",
  // PSD raw OSType (Rust psd_metadata)
  Shrp: "シャープ",
  Crsp: "鮮明",
  Strg: "強く",
  Smth: "滑らか",
  Anno: "なし",
  AnCr: "LCD",
};

const AA_SHARP_VALUES = new Set(["antiAliasSharp", "Shrp"]);

function getAALabel(code: string): string {
  return AA_LABELS[code] || code;
}

function isSharp(code: string): boolean {
  return AA_SHARP_VALUES.has(code);
}

export type TextIssueFilter = "antiAlias" | "tracking";

interface SpecTextGridProps {
  onFilterFont?: (font: string) => void;
  onFilterIssue?: (issue: TextIssueFilter) => void;
  onFilterStroke?: (strokeSize: number) => void;
}

export function SpecTextGrid({
  onFilterFont,
  onFilterIssue,
  onFilterStroke,
}: SpecTextGridProps = {}) {
  const files = usePsdStore((s) => s.files);
  const activeFileId = usePsdStore((s) => s.activeFileId);
  const selectFile = usePsdStore((s) => s.selectFile);

  const { fontInfo, allFonts, totalTextLayers, missingFonts, refreshFonts } =
    useFontResolver(files);

  const [useActualFont, setUseActualFont] = useState(false);
  const [sortDesc, setSortDesc] = useState(false);
  const [showFontBrowser, setShowFontBrowser] = useState(false);

  // サイズ統計の集計（頻度順）
  const sizeStats = useMemo(() => {
    const sizeCount = new Map<number, number>();
    for (const file of files) {
      if (!file.metadata?.layerTree) continue;
      for (const entry of collectTextLayers(file.metadata.layerTree)) {
        if (!entry.textInfo) continue;
        for (const size of entry.textInfo.fontSizes) {
          sizeCount.set(size, (sizeCount.get(size) || 0) + 1);
        }
      }
    }
    return [...sizeCount.entries()].sort((a, b) => b[1] - a[1]);
  }, [files]);

  // 白フチ統計の集計（サイズ別頻度順）
  const strokeStats = useMemo(() => {
    const strokeCount = new Map<number, number>();
    let totalWithStroke = 0;
    for (const file of files) {
      if (!file.metadata?.layerTree) continue;
      for (const entry of collectTextLayers(file.metadata.layerTree)) {
        const s = entry.textInfo?.strokeSize;
        if (s != null && s > 0) {
          strokeCount.set(s, (strokeCount.get(s) || 0) + 1);
          totalWithStroke++;
        }
      }
    }
    return {
      entries: [...strokeCount.entries()].sort((a, b) => b[1] - a[1]),
      total: totalWithStroke,
    };
  }, [files]);

  // カーニング（トラッキング）統計
  const trackingStats = useMemo(() => {
    const trackingCount = new Map<number, number>();
    let totalTextLayers = 0;
    let totalWithNonZero = 0;
    for (const file of files) {
      if (!file.metadata?.layerTree) continue;
      for (const entry of collectTextLayers(file.metadata.layerTree)) {
        if (!entry.textInfo) continue;
        totalTextLayers++;
        const t = entry.textInfo.tracking;
        if (t && t.length > 0) {
          for (const val of t) {
            trackingCount.set(val, (trackingCount.get(val) || 0) + 1);
          }
          totalWithNonZero++;
        }
      }
    }
    return {
      entries: [...trackingCount.entries()].sort((a, b) => b[1] - a[1]),
      totalTextLayers,
      totalWithNonZero,
    };
  }, [files]);

  // アンチエイリアス統計
  const antiAliasStats = useMemo(() => {
    const aaCount = new Map<string, number>();
    let total = 0;
    for (const file of files) {
      if (!file.metadata?.layerTree) continue;
      for (const entry of collectTextLayers(file.metadata.layerTree)) {
        const aa = entry.textInfo?.antiAlias;
        if (aa) {
          aaCount.set(aa, (aaCount.get(aa) || 0) + 1);
          total++;
        }
      }
    }
    let sharpCount = 0;
    for (const [key, count] of aaCount) {
      if (isSharp(key)) sharpCount += count;
    }
    const nonSharpCount = total - sharpCount;
    return {
      entries: [...aaCount.entries()].sort((a, b) => b[1] - a[1]),
      total,
      nonSharpCount,
    };
  }, [files]);

  return (
    <div className="h-full overflow-auto p-4 pb-24 select-none">
      {/* Primary summary: Font + Size */}
      {(allFonts.length > 0 || sizeStats.length > 0) && (
        <div
          className="mb-3 grid gap-3"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}
        >
          {/* Font Summary */}
          {allFonts.length > 0 && (
            <div className="p-3 bg-bg-secondary/80 border border-border rounded-xl">
              <div className="flex items-center gap-2 mb-2">
                <svg className="w-3.5 h-3.5 text-[#f06292]" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M5 4h10v2.5h-1.2V5.5H10.6V14h1.5v1.5h-4.2V14h1.5V5.5H6.2v1H5V4z" />
                </svg>
                <span className="text-[11px] font-medium text-text-primary">使用フォント</span>
                <span className="text-[10px] text-text-muted">
                  {allFonts.length} 種類 / {totalTextLayers} レイヤー
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {allFonts.map(([font, count]) => {
                  const color = fontInfo.getFontColor(font);
                  const missing = fontInfo.isMissing(font);
                  return (
                    <button
                      key={font}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[10px] transition-all ${
                        onFilterFont
                          ? "cursor-pointer hover:brightness-125 hover:scale-[1.03] active:scale-[0.98]"
                          : ""
                      }`}
                      style={{
                        backgroundColor: `${color}10`,
                        borderColor: `${color}30`,
                      }}
                      title={
                        onFilterFont
                          ? `ビューアーで ${fontInfo.getFontLabel(font)} を絞り込み`
                          : missing
                            ? `${font} (未インストール)`
                            : font
                      }
                      onClick={onFilterFont ? () => onFilterFont(font) : undefined}
                    >
                      <span className="font-medium" style={{ color }}>
                        {fontInfo.getFontLabel(font)}
                      </span>
                      <span className="text-text-muted">({count})</span>
                      {missing && (
                        <span
                          className="text-[8px] px-1 py-px rounded font-bold"
                          style={{
                            backgroundColor: `${MISSING_FONT_COLOR}20`,
                            color: MISSING_FONT_COLOR,
                          }}
                        >
                          未インストール
                        </span>
                      )}
                      {onFilterFont && (
                        <svg
                          className="w-2.5 h-2.5 ml-0.5 opacity-40"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
                          />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Size Summary */}
          {sizeStats.length > 0 && (
            <div className="p-3 bg-bg-secondary/80 border border-border rounded-xl">
              <div className="flex items-center gap-2 mb-2">
                <svg
                  className="w-3.5 h-3.5 text-[#64b5f6]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h10M4 18h6" />
                </svg>
                <span className="text-[11px] font-medium text-text-primary">サイズ統計</span>
                <span className="text-[12px] font-semibold text-[#64b5f6]">
                  基本 {sizeStats[0][0]}pt
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {sizeStats.map(([size, count]) => (
                  <span
                    key={size}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[#64b5f6]/30 bg-[#64b5f6]/10 text-[10px]"
                  >
                    <span className="font-medium text-[#64b5f6]">{size}pt</span>
                    <span className="text-text-muted">({count})</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Secondary summary: Stroke + AntiAlias + Tracking (compact inline) */}
      {(strokeStats.entries.length > 0 ||
        antiAliasStats.total > 0 ||
        trackingStats.totalTextLayers > 0) && (
        <div className="mb-4 flex flex-wrap gap-2">
          {/* Stroke compact */}
          {strokeStats.entries.length > 0 && (
            <div
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-all ${
                onFilterStroke
                  ? "bg-accent-tertiary/5 border-accent-tertiary/25 hover:bg-accent-tertiary/10 hover:border-accent-tertiary/40"
                  : "bg-bg-secondary/60 border-border/50"
              }`}
            >
              <svg
                className="w-3 h-3 text-accent-tertiary flex-shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              <span className="text-[10px] text-text-muted">白フチ</span>
              {strokeStats.entries.map(([size, count]) => (
                <button
                  key={size}
                  className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-accent-tertiary/25 bg-accent-tertiary/8 text-[9px] ${
                    onFilterStroke
                      ? "cursor-pointer hover:bg-accent-tertiary/20 hover:border-accent-tertiary/40 transition-all"
                      : ""
                  }`}
                  title={onFilterStroke ? `ビューアーで白フチ${size}pxを絞り込み` : undefined}
                  onClick={onFilterStroke ? () => onFilterStroke(size) : undefined}
                >
                  <span className="font-medium text-accent-tertiary">{size}px</span>
                  <span className="text-text-muted">({count})</span>
                </button>
              ))}
              {onFilterStroke && (
                <svg
                  className="w-2.5 h-2.5 ml-0.5 text-accent-tertiary/60"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
                  />
                </svg>
              )}
            </div>
          )}

          {/* AntiAlias compact */}
          {antiAliasStats.total > 0 && (
            <button
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-all ${
                antiAliasStats.nonSharpCount > 0
                  ? "bg-red-500/5 border-red-500/25 hover:bg-red-500/10 hover:border-red-500/40 cursor-pointer"
                  : "bg-bg-secondary/60 border-border/50"
              }`}
              onClick={
                antiAliasStats.nonSharpCount > 0 && onFilterIssue
                  ? () => onFilterIssue("antiAlias")
                  : undefined
              }
              title={
                antiAliasStats.nonSharpCount > 0 && onFilterIssue
                  ? "DTPビューアーで確認"
                  : undefined
              }
            >
              <svg
                className={`w-3 h-3 flex-shrink-0 ${antiAliasStats.nonSharpCount > 0 ? "text-red-400" : "text-emerald-400"}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h8m-8 6h16" />
              </svg>
              <span className="text-[10px] text-text-muted">AA</span>
              {antiAliasStats.nonSharpCount > 0 ? (
                <>
                  {antiAliasStats.entries.map(([aa, count]) => {
                    const sharp = isSharp(aa);
                    return (
                      <span
                        key={aa}
                        className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[9px] ${
                          sharp
                            ? "border-emerald-500/25 bg-emerald-500/8"
                            : "border-red-500/25 bg-red-500/8"
                        }`}
                      >
                        <span
                          className={`font-medium ${sharp ? "text-emerald-400" : "text-red-400"}`}
                        >
                          {getAALabel(aa)}
                        </span>
                        <span className="text-text-muted">({count})</span>
                      </span>
                    );
                  })}
                  {onFilterIssue && (
                    <svg
                      className="w-2.5 h-2.5 ml-0.5 text-red-400/60"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
                      />
                    </svg>
                  )}
                </>
              ) : (
                <span className="text-[10px] font-medium text-emerald-400">全てシャープ</span>
              )}
            </button>
          )}

          {/* Tracking (kerning) compact */}
          {trackingStats.totalTextLayers > 0 && (
            <button
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-all ${
                trackingStats.totalWithNonZero > 0
                  ? "bg-red-500/5 border-red-500/25 hover:bg-red-500/10 hover:border-red-500/40 cursor-pointer"
                  : "bg-bg-secondary/60 border-border/50"
              }`}
              onClick={
                trackingStats.totalWithNonZero > 0 && onFilterIssue
                  ? () => onFilterIssue("tracking")
                  : undefined
              }
              title={
                trackingStats.totalWithNonZero > 0 && onFilterIssue
                  ? "DTPビューアーで確認"
                  : undefined
              }
            >
              <svg
                className={`w-3 h-3 flex-shrink-0 ${trackingStats.totalWithNonZero > 0 ? "text-red-400" : "text-emerald-400"}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
                />
              </svg>
              <span className="text-[10px] text-text-muted">カーニング</span>
              {trackingStats.totalWithNonZero > 0 ? (
                <>
                  {trackingStats.entries.map(([val, count]) => (
                    <span
                      key={val}
                      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-red-500/25 bg-red-500/8 text-[9px]"
                    >
                      <span className="font-medium text-red-400">{val > 0 ? `+${val}` : val}</span>
                      <span className="text-text-muted">({count})</span>
                    </span>
                  ))}
                  {onFilterIssue && (
                    <svg
                      className="w-2.5 h-2.5 ml-0.5 text-red-400/60"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
                      />
                    </svg>
                  )}
                </>
              ) : (
                <span className="text-[10px] font-medium text-emerald-400">全て0</span>
              )}
            </button>
          )}
        </div>
      )}

      {/* Missing font warning banner */}
      {missingFonts.size > 0 && (
        <div className="mb-4 p-3 bg-red-500/5 border border-red-500/30 rounded-xl flex items-start gap-2">
          <svg
            className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-medium text-red-400">
              未インストールフォント ({missingFonts.size}件)
            </div>
            <div className="text-[10px] text-red-400/70 mt-0.5">{[...missingFonts].join("、")}</div>
          </div>
          <button
            onClick={() => setShowFontBrowser(true)}
            className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-md border border-blue-400/30 bg-blue-400/10 text-blue-400 hover:bg-blue-400/20 transition-colors"
          >
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
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
            共有フォルダから探す
          </button>
        </div>
      )}

      {/* Font browser dialog */}
      {showFontBrowser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowFontBrowser(false);
          }}
        >
          <div className="w-[480px]" onMouseDown={(e) => e.stopPropagation()}>
            <FontBrowserDialog
              basePath={FONT_SHARE_PATH}
              missingFontNames={[...missingFonts]}
              onInstalled={refreshFonts}
              onClose={() => setShowFontBrowser(false)}
            />
          </div>
        </div>
      )}

      {/* Toolbar: font toggle + sort toggle */}
      <div className="mb-3 flex items-center gap-3">
        <div className="flex rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => setUseActualFont(false)}
            className={`px-2.5 py-1 text-[10px] transition-all ${
              !useActualFont
                ? "bg-bg-tertiary text-text-primary font-medium"
                : "bg-bg-secondary/50 text-text-muted hover:text-text-secondary"
            }`}
          >
            デフォルト
          </button>
          <button
            onClick={() => setUseActualFont(true)}
            className={`px-2.5 py-1 text-[10px] border-l border-border transition-all ${
              useActualFont
                ? "bg-bg-tertiary text-text-primary font-medium"
                : "bg-bg-secondary/50 text-text-muted hover:text-text-secondary"
            }`}
          >
            プレビュー
          </button>
        </div>
        <div className="flex rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => setSortDesc(false)}
            className={`px-2.5 py-1 text-[10px] transition-all ${
              !sortDesc
                ? "bg-bg-tertiary text-text-primary font-medium"
                : "bg-bg-secondary/50 text-text-muted hover:text-text-secondary"
            }`}
          >
            昇順
          </button>
          <button
            onClick={() => setSortDesc(true)}
            className={`px-2.5 py-1 text-[10px] border-l border-border transition-all ${
              sortDesc
                ? "bg-bg-tertiary text-text-primary font-medium"
                : "bg-bg-secondary/50 text-text-muted hover:text-text-secondary"
            }`}
          >
            降順
          </button>
        </div>
      </div>

      {/* Per-file text layers */}
      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
        }}
      >
        {files.map((file) => {
          const raw = file.metadata?.layerTree ? collectTextLayers(file.metadata.layerTree) : [];
          const textLayers = sortDesc ? [...raw].reverse() : raw;

          return (
            <div
              key={file.id}
              className={`
                border rounded-xl cursor-pointer bg-bg-secondary/50 transition-all
                hover:bg-bg-secondary/80
                ${
                  activeFileId === file.id
                    ? "border-accent/50 ring-1 ring-accent/20"
                    : "border-border hover:border-border-strong/50"
                }
              `}
              onClick={() => selectFile(file.id)}
            >
              {/* Header */}
              <div className="px-3 py-2 border-b border-border/60 flex items-center gap-2">
                <span
                  className={`text-[11px] font-medium truncate flex-1 ${
                    activeFileId === file.id ? "text-accent" : "text-text-primary"
                  }`}
                >
                  {file.fileName.replace(/\.(psd|psb)$/i, "")}
                </span>
                <span className="text-[10px] text-text-muted flex-shrink-0">
                  {textLayers.length > 0 ? `${textLayers.length} テキスト` : "テキストなし"}
                </span>
              </div>

              {/* Text layer list */}
              <div className="p-2 space-y-1">
                {textLayers.length === 0 ? (
                  <div className="flex items-center justify-center py-6 text-[10px] text-text-muted">
                    テキストレイヤーなし
                  </div>
                ) : (
                  textLayers.map((entry, i) => (
                    <TextLayerRow
                      key={i}
                      entry={entry}
                      fontInfo={fontInfo}
                      useActualFont={useActualFont}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TextLayerRow({
  entry,
  fontInfo,
  useActualFont = false,
  highlightFont,
  isSelected = false,
  onSelect,
}: {
  entry: TextLayerEntry;
  fontInfo: FontHelpers;
  useActualFont?: boolean;
  highlightFont?: string | null;
  isSelected?: boolean;
  onSelect?: () => void;
}) {
  const info = entry.textInfo;
  const rawText = info?.text ?? "";
  // テキスト内容がなければレイヤー名をフォールバック
  const displayText = rawText.length > 0 ? rawText : entry.layerName;
  const hasHighlightedFont = highlightFont ? info?.fonts.includes(highlightFont) : false;
  const highlightColor = highlightFont ? fontInfo.getFontColor(highlightFont) : undefined;

  return (
    <div
      onClick={onSelect}
      className={`
        py-1.5 rounded-lg border transition-all
        ${onSelect ? "cursor-pointer" : ""}
        ${
          isSelected
            ? "pl-2 border-l-2 pr-2.5 bg-[rgba(194,90,90,0.08)] border-border/30"
            : hasHighlightedFont
              ? "pl-2 border-l-2 pr-2.5 bg-bg-tertiary/50 border-border/30"
              : highlightFont
                ? "px-2.5 bg-bg-tertiary/30 border-border/15 opacity-35"
                : "px-2.5 bg-bg-tertiary/50 border-border/30"
        }
        ${entry.visible ? "" : "opacity-50"}
      `}
      style={
        isSelected
          ? { borderLeftColor: "rgba(194, 90, 90, 0.5)" }
          : hasHighlightedFont
            ? { borderLeftColor: `${highlightColor}60` }
            : undefined
      }
    >
      {/* Font badges + size + visibility */}
      <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
        <svg
          className="w-3 h-3 text-[#f06292] flex-shrink-0"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path d="M5 4h10v2.5h-1.2V5.5H10.6V14h1.5v1.5h-4.2V14h1.5V5.5H6.2v1H5V4z" />
        </svg>
        {info?.fonts.map((font) => {
          const color = fontInfo.getFontColor(font);
          const missing = fontInfo.isMissing(font);
          const isHighlighted = highlightFont === font;
          return (
            <span
              key={font}
              className="text-[9px] px-1.5 py-0.5 rounded font-medium transition-all"
              style={{
                backgroundColor: isHighlighted ? `${color}25` : `${color}15`,
                color,
                ...(missing
                  ? { textDecoration: "line-through", textDecorationColor: `${color}60` }
                  : {}),
              }}
              title={missing ? `${font} (未インストール)` : font}
            >
              {fontInfo.getFontLabel(font)}
              {missing && " !"}
            </span>
          );
        })}
        {info && info.fontSizes.length > 0 && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-text-muted">
            {info.fontSizes.join(" / ")}pt
          </span>
        )}
        {info?.strokeSize != null && info.strokeSize > 0 && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent-tertiary/15 text-accent-tertiary">
            白フチ{info.strokeSize}px
          </span>
        )}
        {info?.antiAlias && !isSharp(info.antiAlias) && (
          <span
            className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 font-medium"
            title={`アンチエイリアス: ${getAALabel(info.antiAlias)}`}
          >
            AA:{getAALabel(info.antiAlias)}
          </span>
        )}
        {info?.tracking && info.tracking.length > 0 && (
          <span
            className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-medium"
            title={`カーニング: ${info.tracking.join(", ")}`}
          >
            K:{info.tracking.map((v) => (v > 0 ? `+${v}` : v)).join("/")}
          </span>
        )}
        {!entry.visible && (
          <span className="text-[9px] px-1 py-px rounded bg-text-muted/10 text-text-muted">
            非表示
          </span>
        )}
      </div>

      {/* Text content (with line breaks preserved) */}
      <div
        className="text-[10px] text-text-primary leading-relaxed pl-[18px] whitespace-pre-wrap"
        style={{
          fontFamily:
            useActualFont && info?.fonts[0] ? fontInfo.getFontFamily(info.fonts[0]) : undefined,
        }}
      >
        {displayText}
      </div>
    </div>
  );
}
