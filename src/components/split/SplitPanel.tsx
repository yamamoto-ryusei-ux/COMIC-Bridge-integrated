import { useMemo } from "react";
import { usePsdStore } from "../../store/psdStore";
import {
  useSplitStore,
  computeMargins,
  type SplitMode,
  type OutputFormat,
  type PageNumbering,
} from "../../store/splitStore";
import { useSplitProcessor } from "../../hooks/useSplitProcessor";
import { SplitResultDialog } from "./SplitResultDialog";

export function SplitPanel() {
  const files = usePsdStore((state) => state.files);
  const activeFileId = usePsdStore((state) => state.activeFileId);
  const selectedFileIds = usePsdStore((state) => state.selectedFileIds);

  const settings = useSplitStore((state) => state.settings);
  const setSettings = useSplitStore((state) => state.setSettings);
  const isProcessing = useSplitStore((state) => state.isProcessing);
  const progress = useSplitStore((state) => state.progress);
  const totalFiles = useSplitStore((state) => state.totalFiles);
  const currentFile = useSplitStore((state) => state.currentFile);
  const results = useSplitStore((state) => state.results);

  const setShowResultDialog = useSplitStore((state) => state.setShowResultDialog);

  const { splitSelectedFiles, splitAllFiles } = useSplitProcessor();

  const hasResults = results.length > 0;

  // 基準ファイルのメタデータから計算
  const referenceFile = useMemo(() => {
    if (activeFileId) return files.find((f) => f.id === activeFileId);
    return files.length > 1 ? files[1] : files[0];
  }, [files, activeFileId]);

  const margins = useMemo(() => {
    if (!settings.selectionBounds || !referenceFile?.metadata) return null;
    return computeMargins(settings.selectionBounds, referenceFile.metadata.width);
  }, [settings.selectionBounds, referenceFile]);

  // 不均等モードのバリデーション
  const canExecuteUneven =
    settings.mode !== "uneven" ||
    (settings.selectionBounds !== null && (!margins || !margins.hasExcessiveOverlap));

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-sm font-display font-medium text-text-primary flex items-center gap-2">
          <svg
            className="w-4 h-4 text-accent-tertiary"
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
          見開き分割
        </h3>
        <p className="text-xs text-text-muted mt-1">Photoshopで見開きページを左右に分割</p>
      </div>

      {/* Settings */}
      <div className="flex-1 overflow-auto p-3 space-y-3">
        {/* Split Mode */}
        <div className="bg-bg-tertiary rounded-xl p-3">
          <h4 className="text-xs font-medium text-text-muted mb-2">分割モード</h4>
          <div className="space-y-1.5">
            <ModeOption
              mode="even"
              label="均等分割"
              description="中央で左右均等に分割"
              currentMode={settings.mode}
              onChange={(mode) => setSettings({ mode })}
            />
            <ModeOption
              mode="uneven"
              label="不均等分割"
              description="選択範囲から余白を自動計算"
              currentMode={settings.mode}
              onChange={(mode) => setSettings({ mode })}
            />
            <ModeOption
              mode="none"
              label="分割なし"
              description="フォーマット変換のみ"
              currentMode={settings.mode}
              onChange={(mode) => setSettings({ mode })}
            />
          </div>
        </div>

        {/* Computed Margins (uneven mode) */}
        {settings.mode === "uneven" && (
          <div className="bg-bg-tertiary rounded-xl p-3">
            <h4 className="text-xs font-medium text-text-muted mb-2">余白計算</h4>
            {margins ? (
              <div className="space-y-1.5">
                <MarginRow label="外側余白" value={`${margins.outerMargin}px`} />
                <MarginRow label="ノド余白" value={`${margins.innerMargin}px`} />
                <div className="border-t border-border/30 my-1" />
                <MarginRow label="追加余白" value={`${margins.marginToAdd}px`} highlight />
                <MarginRow label="出力幅" value={`${margins.finalWidth}px`} accent />

                {margins.hasExcessiveOverlap && (
                  <div className="mt-2 px-2 py-1.5 rounded-lg bg-error/10 border border-error/30">
                    <p className="text-[10px] text-error font-medium">
                      選択範囲が中央を{margins.overlapPercent.toFixed(1)}%超過（上限5%）
                    </p>
                  </div>
                )}
                {margins.hasOverlap && !margins.hasExcessiveOverlap && (
                  <div className="mt-2 px-2 py-1.5 rounded-lg bg-warning/10 border border-warning/30">
                    <p className="text-[10px] text-warning">
                      中央をわずかに超過（{margins.overlapPercent.toFixed(1)}%）。自動補正されます
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2.5">
                <p className="text-xs text-text-secondary leading-relaxed">
                  綴じ側（ノド）の余白が外側より狭い場合、分割後に余白を追加して均等化します。
                </p>
                {/* Visual diagram */}
                <div className="flex items-center justify-center gap-3 py-1.5">
                  {/* Spread (before) */}
                  <div className="flex flex-col items-center">
                    <span className="text-[8px] text-text-muted mb-1">見開き</span>
                    <div className="flex border border-text-muted/30 rounded-sm overflow-hidden">
                      <div className="w-10 h-14 relative">
                        <div className="absolute inset-y-0 left-0 w-1.5 bg-[#00e5ff]/15" />
                        <div className="absolute inset-y-0 right-0 w-0.5 bg-[#00e5ff]/10" />
                      </div>
                      <div className="w-px bg-text-muted/20" />
                      <div className="w-10 h-14 relative">
                        <div className="absolute inset-y-0 left-0 w-0.5 bg-[#00bcd4]/10" />
                        <div className="absolute inset-y-0 right-0 w-1.5 bg-[#00bcd4]/15" />
                      </div>
                    </div>
                    <div className="flex w-full mt-0.5 px-0.5">
                      <span className="text-[7px] text-[#00e5ff]/60 flex-1 text-left">外側</span>
                      <span className="text-[7px] text-text-muted/40">ノド</span>
                      <span className="flex-1" />
                    </div>
                  </div>

                  {/* Arrow */}
                  <svg
                    className="w-4 h-4 text-text-muted/50 flex-shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M13 7l5 5m0 0l-5 5m5-5H6"
                    />
                  </svg>

                  {/* Output (after) */}
                  <div className="flex flex-col items-center">
                    <span className="text-[8px] text-text-muted mb-1">出力</span>
                    <div className="flex gap-1">
                      <div className="w-9 h-14 border border-[#00e5ff]/40 rounded-sm bg-[#00e5ff]/5" />
                      <div className="w-9 h-14 border border-[#00bcd4]/40 rounded-sm bg-[#00bcd4]/5" />
                    </div>
                    <span className="text-[8px] text-[#00e5ff] mt-0.5">同じ幅</span>
                  </div>
                </div>

                <p className="text-[10px] text-text-muted text-center">
                  定規からドラッグでコンテンツ範囲を指定
                </p>
              </div>
            )}
          </div>
        )}

        {/* Page Numbering */}
        {settings.mode !== "none" && (
          <div className="bg-bg-tertiary rounded-xl p-3">
            <h4 className="text-xs font-medium text-text-muted mb-2">ファイル名</h4>
            <div className="space-y-2">
              <div>
                <label className="text-[10px] text-text-muted block mb-1">
                  ベースネーム（空欄＝元ファイル名を使用）
                </label>
                <input
                  type="text"
                  value={settings.customBaseName}
                  onChange={(e) => setSettings({ customBaseName: e.target.value })}
                  placeholder="例: 作品名_第1話"
                  className="w-full px-2.5 py-1.5 text-sm bg-bg-elevated border border-border/50 rounded-lg text-text-primary placeholder:text-text-muted/40 focus:outline-none focus:border-accent-tertiary/50"
                />
              </div>
              <div className="space-y-1.5">
                <PageNumberingOption
                  value="rl"
                  label="_R / _L"
                  description="右ページ / 左ページ"
                  current={settings.pageNumbering}
                  onChange={(v) => setSettings({ pageNumbering: v })}
                />
                <PageNumberingOption
                  value="sequential"
                  label="連番 (_001, _002...)"
                  description="ファイル順で通し番号"
                  current={settings.pageNumbering}
                  onChange={(v) => setSettings({ pageNumbering: v })}
                />
              </div>
              {settings.pageNumbering === "sequential" && (
                <div className="mt-2 space-y-1">
                  <label className="flex items-center gap-2.5 cursor-pointer p-1.5 rounded-lg hover:bg-bg-elevated/50 transition-colors">
                    <input
                      type="checkbox"
                      checked={settings.firstPageBlank}
                      onChange={(e) => setSettings({ firstPageBlank: e.target.checked })}
                      className="rounded accent-accent-tertiary"
                    />
                    <div>
                      <span className="text-sm text-text-primary">1ファイル目の右側が白紙</span>
                      <p className="text-[10px] text-text-muted">
                        右ページを破棄し、左ページから_001で開始
                      </p>
                    </div>
                  </label>
                  <label className="flex items-center gap-2.5 cursor-pointer p-1.5 rounded-lg hover:bg-bg-elevated/50 transition-colors">
                    <input
                      type="checkbox"
                      checked={settings.lastPageBlank}
                      onChange={(e) => setSettings({ lastPageBlank: e.target.checked })}
                      className="rounded accent-accent-tertiary"
                    />
                    <div>
                      <span className="text-sm text-text-primary">最終ファイルの左側が白紙</span>
                      <p className="text-[10px] text-text-muted">
                        最終ファイルの左ページを破棄し、右ページで終了
                      </p>
                    </div>
                  </label>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Output Format */}
        <div className="bg-bg-tertiary rounded-xl p-3">
          <h4 className="text-xs font-medium text-text-muted mb-2">出力形式</h4>
          <div className="flex gap-2">
            <FormatButton
              format="psd"
              label="PSD"
              currentFormat={settings.outputFormat}
              onChange={(format) => setSettings({ outputFormat: format })}
            />
            <FormatButton
              format="jpg"
              label="JPG"
              currentFormat={settings.outputFormat}
              onChange={(format) => setSettings({ outputFormat: format })}
            />
          </div>
          {settings.outputFormat === "jpg" && (
            <div className="mt-3">
              <label className="text-xs text-text-secondary mb-1 block">
                画質: {settings.jpgQuality}%
              </label>
              <input
                type="range"
                min="50"
                max="100"
                value={settings.jpgQuality}
                onChange={(e) => setSettings({ jpgQuality: parseInt(e.target.value) })}
                className="w-full accent-accent-tertiary"
              />
            </div>
          )}
        </div>

        {/* Options */}
        {settings.mode !== "none" && (
          <div className="bg-bg-tertiary rounded-xl p-3">
            <h4 className="text-xs font-medium text-text-muted mb-2">オプション</h4>
            <div className="space-y-2">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.deleteHiddenLayers}
                  onChange={(e) => setSettings({ deleteHiddenLayers: e.target.checked })}
                  className="rounded accent-accent-tertiary"
                />
                <div>
                  <span className="text-sm text-text-primary">非表示レイヤーを削除</span>
                  <p className="text-[10px] text-text-muted">ファイルサイズを削減</p>
                </div>
              </label>
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.deleteOffCanvasText}
                  onChange={(e) => setSettings({ deleteOffCanvasText: e.target.checked })}
                  className="rounded accent-accent-tertiary"
                />
                <div>
                  <span className="text-sm text-text-primary">はみ出しテキストを削除</span>
                  <p className="text-[10px] text-text-muted">
                    反対側にはみ出したテキストレイヤーを除去
                  </p>
                </div>
              </label>
            </div>
          </div>
        )}

        {/* Processing Status */}
        {isProcessing && (
          <div className="bg-accent-tertiary/10 rounded-xl p-3 border border-accent-tertiary/30">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-4 h-4 rounded-full border-2 border-accent-tertiary/30 border-t-accent-tertiary animate-spin" />
              <span className="text-sm text-accent-tertiary font-medium">Photoshopで処理中...</span>
            </div>
            {currentFile && <p className="text-xs text-text-muted truncate">{currentFile}</p>}
            <div className="mt-2 bg-bg-elevated rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-accent-tertiary to-accent-secondary transition-all duration-300"
                style={{ width: `${totalFiles > 0 ? (progress / totalFiles) * 100 : 0}%` }}
              />
            </div>
            <p className="text-xs text-text-muted mt-1 text-right">
              {progress} / {totalFiles}
            </p>
          </div>
        )}

        {/* Last Results Summary (compact) */}
        {hasResults && !isProcessing && (
          <button
            onClick={() => setShowResultDialog(true)}
            className="
              w-full bg-gradient-to-r from-accent-tertiary/10 to-accent-secondary/5
              rounded-xl p-3 border border-accent-tertiary/30
              hover:border-accent-tertiary/50 hover:from-accent-tertiary/15 hover:to-accent-secondary/10
              transition-all text-left group
            "
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <svg
                  className="w-4 h-4 text-accent-tertiary"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span className="text-sm font-medium text-text-primary">
                  処理完了 — {results.filter((r) => r.success).length}/{results.length} 成功
                </span>
              </div>
              <svg
                className="w-4 h-4 text-text-muted group-hover:text-accent-tertiary transition-colors"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </div>
            <p className="text-[10px] text-text-muted mt-1">クリックでレポートを表示</p>
          </button>
        )}

        {/* Result Dialog (portal) */}
        <SplitResultDialog />
      </div>

      {/* Action Bar */}
      <div className="p-3 border-t border-border space-y-2">
        {isProcessing ? (
          <button
            disabled
            className="
              w-full px-4 py-3 text-sm font-medium rounded-xl text-white
              bg-gradient-to-r from-accent-tertiary to-accent-secondary
              opacity-80 cursor-not-allowed
              flex items-center justify-center gap-2
            "
          >
            <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
            Photoshopで処理中...
          </button>
        ) : (
          <div className="flex gap-2">
            {/* 選択ファイルのみ */}
            <button
              onClick={splitSelectedFiles}
              disabled={selectedFileIds.length === 0 || !canExecuteUneven}
              className="
                flex-1 px-3 py-2.5 text-sm font-medium rounded-xl
                bg-bg-tertiary text-text-primary
                border border-accent-tertiary/40
                hover:bg-accent-tertiary/10 hover:border-accent-tertiary/60
                transition-all duration-200
                disabled:opacity-40 disabled:cursor-not-allowed
                flex items-center justify-center gap-1.5
              "
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
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
                />
              </svg>
              <span>選択のみ ({selectedFileIds.length})</span>
            </button>

            {/* 全ファイル */}
            <button
              onClick={splitAllFiles}
              disabled={files.length === 0 || !canExecuteUneven}
              className="
                flex-1 px-3 py-2.5 text-sm font-medium rounded-xl text-white
                bg-gradient-to-r from-accent-tertiary to-accent-secondary
                shadow-[0_3px_12px_rgba(0,212,170,0.25)]
                hover:shadow-[0_5px_16px_rgba(0,212,170,0.35)]
                hover:-translate-y-0.5
                transition-all duration-200
                disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none
                flex items-center justify-center gap-1.5
              "
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
                  d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
                />
              </svg>
              <span>全て実行 ({files.length})</span>
            </button>
          </div>
        )}

        <div className="flex items-center justify-center text-[10px] text-text-muted">
          {settings.mode === "none"
            ? "変換のみ"
            : settings.mode === "uneven"
              ? "不均等分割"
              : "均等分割"}
        </div>
      </div>
    </div>
  );
}

// --- Sub-components ---

function ModeOption({
  mode,
  label,
  description,
  currentMode,
  onChange,
}: {
  mode: SplitMode;
  label: string;
  description: string;
  currentMode: SplitMode;
  onChange: (mode: SplitMode) => void;
}) {
  const isSelected = currentMode === mode;
  return (
    <div
      className={`
        flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-all duration-200
        ${
          isSelected
            ? "bg-accent-tertiary/15 border border-accent-tertiary/50"
            : "bg-bg-elevated border border-white/5 hover:border-white/10"
        }
      `}
      onClick={() => onChange(mode)}
    >
      <div
        className={`
        w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all duration-200
        ${isSelected ? "border-accent-tertiary bg-accent-tertiary" : "border-text-muted/50"}
      `}
      >
        {isSelected && <div className="w-2 h-2 rounded-full bg-white" />}
      </div>
      <div className="flex-1">
        <span className="text-sm text-text-primary">{label}</span>
        <p className="text-xs text-text-muted">{description}</p>
      </div>
    </div>
  );
}

function FormatButton({
  format,
  label,
  currentFormat,
  onChange,
}: {
  format: OutputFormat;
  label: string;
  currentFormat: OutputFormat;
  onChange: (format: OutputFormat) => void;
}) {
  const isSelected = currentFormat === format;
  return (
    <button
      className={`
        flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200
        ${
          isSelected
            ? "bg-accent-tertiary text-white"
            : "bg-bg-elevated text-text-secondary hover:text-text-primary border border-white/10"
        }
      `}
      onClick={() => onChange(format)}
    >
      {label}
    </button>
  );
}

function PageNumberingOption({
  value,
  label,
  description,
  current,
  onChange,
}: {
  value: PageNumbering;
  label: string;
  description: string;
  current: PageNumbering;
  onChange: (v: PageNumbering) => void;
}) {
  const isSelected = current === value;
  return (
    <label className="flex items-center gap-2.5 cursor-pointer p-1.5 rounded-lg hover:bg-bg-elevated/50 transition-colors">
      <div
        className={`
        w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all
        ${isSelected ? "border-accent-tertiary bg-accent-tertiary" : "border-text-muted/40"}
      `}
      >
        {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
      </div>
      <div className="flex-1" onClick={() => onChange(value)}>
        <span className="text-sm text-text-primary">{label}</span>
        <p className="text-[10px] text-text-muted">{description}</p>
      </div>
    </label>
  );
}

function MarginRow({
  label,
  value,
  highlight,
  accent,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-text-muted">{label}</span>
      <span
        className={
          accent
            ? "text-accent-tertiary font-medium"
            : highlight
              ? "text-text-primary font-medium"
              : "text-text-secondary"
        }
      >
        {value}
      </span>
    </div>
  );
}
