import { useMemo, useEffect, useState, useRef } from "react";
import { usePsdStore } from "../../store/psdStore";
import { useSpecStore } from "../../store/specStore";
import { useGuideStore } from "../../store/guideStore";
import { useSpecChecker } from "../../hooks/useSpecChecker";
import { usePhotoshopConverter } from "../../hooks/usePhotoshopConverter";
import { usePreparePsd } from "../../hooks/usePreparePsd";
import { usePhotoshopShortcut, useOpenInPhotoshop } from "../../hooks/useOpenInPhotoshop";
import { useOpenFolder } from "../../hooks/useOpenFolder";
import { useCanvasSizeCheck } from "../../hooks/useCanvasSizeCheck";

import { usePageNumberCheck } from "../../hooks/usePageNumberCheck";
import { PreviewGrid } from "../preview/PreviewGrid";
import { CompactFileList } from "../common/CompactFileList";
import { MetadataPanel } from "../metadata/MetadataPanel";
import { FixGuidePanel } from "../spec-checker/FixGuidePanel";
import { GuideSectionPanel } from "../spec-checker/GuideSectionPanel";
import { SpecLayerGrid } from "../spec-checker/SpecLayerGrid";
import { LayerSeparationPanel } from "../spec-checker/LayerSeparationPanel";
import { DropZone } from "../file-browser/DropZone";

import { THUMBNAIL_SIZES, type ThumbnailSize } from "../../types";
import { invoke } from "@tauri-apps/api/core";
import { TextExtractButton } from "../common/TextExtractButton";

export function SpecCheckView() {
  const files = usePsdStore((state) => state.files);
  const selectedFileIds = usePsdStore((state) => state.selectedFileIds);
  const thumbnailSize = usePsdStore((state) => state.thumbnailSize);
  const setThumbnailSize = usePsdStore((state) => state.setThumbnailSize);
  const activeFile = usePsdStore((state) => state.getActiveFile());

  const specifications = useSpecStore((state) => state.specifications);
  const activeSpecId = useSpecStore((state) => state.activeSpecId);
  const setActiveSpec = useSpecStore((state) => state.setActiveSpec);
  const selectSpecAndCheck = useSpecStore((state) => state.selectSpecAndCheck);
  const checkResults = useSpecStore((state) => state.checkResults);
  const conversionSettings = useSpecStore((state) => state.conversionSettings);
  const setConversionSettings = useSpecStore((state) => state.setConversionSettings);
  const conversionResults = useSpecStore((state) => state.conversionResults);
  const clearConversionResults = useSpecStore((state) => state.clearConversionResults);

  const guides = useGuideStore((state) => state.guides);
  const openEditor = useGuideStore((state) => state.openEditor);

  const [showResults, setShowResults] = useState(false);
  const [showGuidePrompt, setShowGuidePrompt] = useState(false);
  const [viewMode, setViewMode] = useState<"thumbnails" | "layers" | "layerCheck">("thumbnails");
  const [tachimiError, setTachimiError] = useState<string | null>(null);

  const guidePromptRef = useRef<HTMLDivElement>(null);

  const { checkAllFiles, isChecking } = useSpecChecker();
  const { isPhotoshopInstalled, isConverting } = usePhotoshopConverter();
  const { isProcessing, prepareFiles } = usePreparePsd();
  const { openFileInPhotoshop } = useOpenInPhotoshop();
  const { openFolderForFile, revealFiles } = useOpenFolder();
  const { outlierFileIds, majoritySize } = useCanvasSizeCheck();
  const { missingNumbers } = usePageNumberCheck();

  usePhotoshopShortcut();

  // 前回選択した仕様を復元（SpecCheckViewマウント時のみ）
  const lastSelectedSpecId = useSpecStore((state) => state.lastSelectedSpecId);
  useEffect(() => {
    if (!activeSpecId && lastSelectedSpecId && files.length > 0) {
      selectSpecAndCheck(lastSelectedSpecId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // アクティブな仕様から変換設定を自動設定
  useEffect(() => {
    if (activeSpecId) {
      const activeSpec = specifications.find((s) => s.id === activeSpecId);
      if (activeSpec) {
        const newSettings: Partial<typeof conversionSettings> = {};
        for (const rule of activeSpec.rules) {
          if (rule.type === "colorMode" && rule.operator === "equals") {
            newSettings.targetColorMode = rule.value as "RGB" | "Grayscale";
          }
          if (rule.type === "bitsPerChannel" && rule.operator === "equals") {
            newSettings.targetBitDepth = rule.value as 8 | 16;
          }
          if (rule.type === "dpi" && rule.operator === "equals") {
            newSettings.targetDpi = rule.value as number;
          }
        }
        setConversionSettings(newSettings);
      }
    }
  }, [activeSpecId, specifications, setConversionSettings]);

  // ポップオーバー外クリックで閉じる
  useEffect(() => {
    if (!showGuidePrompt) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (guidePromptRef.current && !guidePromptRef.current.contains(e.target as Node)) {
        setShowGuidePrompt(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showGuidePrompt]);

  // 変換結果が追加されたらバナーを表示
  useEffect(() => {
    if (conversionResults.length > 0) {
      setShowResults(true);
    }
  }, [conversionResults.length]);

  // トンボ混在判定
  const hasTomboMix = useMemo(() => {
    let has = 0,
      no = 0;
    for (const file of files) {
      if (!file.metadata) continue;
      if (file.metadata.hasTombo) has++;
      else no++;
      if (has > 0 && no > 0) return true;
    }
    return false;
  }, [files]);

  const stats = useMemo(() => {
    let passed = 0;
    let failed = 0;
    let unchecked = 0;
    let noGuides = 0;
    let hasTombo = 0;
    let noTombo = 0;
    let caution = 0;
    files.forEach((file) => {
      const result = checkResults.get(file.id);
      const isNG = result && !result.passed;
      if (!result) unchecked++;
      else if (result.passed) passed++;
      else failed++;
      if (file.metadata) {
        if (!file.metadata.hasGuides) noGuides++;
        if (file.metadata.hasTombo) hasTombo++;
        else noTombo++;
      }
      // 注意判定: NGでない + (サイズ外れ値 OR トンボ混在でトンボなし)
      if (!isNG) {
        const isSizeOutlier = outlierFileIds.has(file.id);
        const isTomboMissing = hasTomboMix && file.metadata && !file.metadata.hasTombo;
        if (isSizeOutlier || isTomboMissing) caution++;
      }
    });
    return { passed, failed, unchecked, noGuides, hasTombo, noTombo, caution };
  }, [files, checkResults, outlierFileIds, hasTomboMix]);

  // 手動再チェック
  const handleRecheck = () => {
    const enabledSpecs = specifications.filter((s) => s.enabled);
    if (enabledSpecs.length > 0) {
      checkAllFiles(enabledSpecs);
    }
  };

  // Tachimi起動（PDF化連携）
  const handleLaunchTachimi = async () => {
    setTachimiError(null);
    try {
      const filePaths = files.map((f) => f.filePath).filter(Boolean);
      if (filePaths.length === 0) return;
      await invoke("launch_tachimi", { filePaths });
    } catch (e) {
      setTachimiError(String(e));
    }
  };

  // 変換結果の集計
  const resultStats = useMemo(() => {
    if (conversionResults.length === 0) return null;
    const successCount = conversionResults.filter((r) => r.success).length;
    const errorCount = conversionResults.filter((r) => !r.success).length;
    const allChanges = conversionResults
      .flatMap((r) => r.changes)
      .filter((c) => c !== "No changes needed");
    return { successCount, errorCount, totalChanges: allChanges.length };
  }, [conversionResults]);

  const hasFiles = files.length > 0;

  if (!hasFiles) {
    return <DropZone />;
  }

  const noSpecSelected = !activeSpecId;
  const hasChecked = checkResults.size > 0;
  const allPassed = hasChecked && stats.failed === 0 && stats.unchecked === 0;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="px-4 py-2 bg-bg-secondary border-b border-border flex items-center gap-4 flex-shrink-0">
        {/* Spec Presets */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted flex-shrink-0">仕様:</span>
          {specifications.map((spec) => (
            <button
              key={spec.id}
              className={`
                px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-200
                ${
                  activeSpecId === spec.id
                    ? "text-white bg-gradient-to-r from-accent to-accent-secondary shadow-sm"
                    : "text-text-secondary bg-bg-tertiary hover:text-text-primary hover:bg-bg-elevated border border-border"
                }
              `}
              onClick={() =>
                spec.id === activeSpecId ? setActiveSpec(null) : selectSpecAndCheck(spec.id)
              }
            >
              {spec.name}
            </button>
          ))}
        </div>

        {/* Separator */}
        <div className="w-px h-5 bg-border flex-shrink-0" />

        {/* Stats */}
        <div className="flex items-center gap-3">
          {hasChecked && (
            <>
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-success" />
                <span className="text-xs font-medium text-success">{stats.passed}</span>
                <span className="text-xs text-text-muted">OK</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-error" />
                <span className="text-xs font-medium text-error">{stats.failed}</span>
                <span className="text-xs text-text-muted">NG</span>
              </div>
              {stats.caution > 0 && (
                <div className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-warning" />
                  <span className="text-xs font-medium text-warning">{stats.caution}</span>
                  <span className="text-xs text-text-muted">注意</span>
                </div>
              )}
            </>
          )}
          {stats.noGuides > 0 && (
            <>
              <div className="w-px h-3 bg-border flex-shrink-0" />
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-warning" />
                <span className="text-xs font-medium text-warning">{stats.noGuides}</span>
                <span className="text-xs text-text-muted">ガイドなし</span>
              </div>
            </>
          )}
          {/* トンボ混在警告（一部あり/一部なしの場合のみ表示） */}
          {stats.hasTombo > 0 && stats.noTombo > 0 && (
            <>
              <div className="w-px h-3 bg-border flex-shrink-0" />
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-manga-peach" />
                <span className="text-xs font-medium text-manga-peach">{stats.noTombo}</span>
                <span className="text-xs text-text-muted">トンボなし</span>
              </div>
            </>
          )}
          {/* キャンバスサイズ不一致 */}
          {outlierFileIds.size > 0 && (
            <>
              <div className="w-px h-3 bg-border flex-shrink-0" />
              <div className="flex items-center gap-1" title={`多数派: ${majoritySize}`}>
                <span className="w-2 h-2 rounded-full bg-warning" />
                <span className="text-xs font-medium text-warning">{outlierFileIds.size}</span>
                <span className="text-xs text-text-muted">サイズ不一致</span>
              </div>
            </>
          )}
          {/* ページ番号欠番 */}
          {missingNumbers.length > 0 && (
            <>
              <div className="w-px h-3 bg-border flex-shrink-0" />
              <div className="flex items-center gap-1" title={`欠番: ${missingNumbers.join(", ")}`}>
                <span className="w-2 h-2 rounded-full bg-warning" />
                <span className="text-xs font-medium text-warning">{missingNumbers.length}</span>
                <span className="text-xs text-text-muted">欠番</span>
              </div>
            </>
          )}
          {/* Re-check button (subtle) */}
          {hasChecked && (
            <button
              onClick={handleRecheck}
              disabled={isChecking}
              className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors disabled:opacity-50"
              title="再チェック"
            >
              <svg
                className={`w-3.5 h-3.5 ${isChecking ? "animate-spin" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>
          )}
        </div>

        {/* Separator */}
        <div className="w-px h-5 bg-border flex-shrink-0" />

        {/* View Mode Switcher */}
        <div className="flex bg-bg-elevated rounded-md p-0.5 border border-white/5 flex-shrink-0">
          <button
            onClick={() => setViewMode("thumbnails")}
            className={`px-2 py-1 text-[10px] rounded transition-all ${
              viewMode === "thumbnails"
                ? "bg-bg-tertiary text-text-primary font-medium shadow-sm"
                : "text-text-muted hover:text-text-secondary"
            }`}
          >
            サムネイル
          </button>
          <button
            onClick={() => setViewMode("layers")}
            className={`px-2 py-1 text-[10px] rounded transition-all ${
              viewMode === "layers"
                ? "bg-bg-tertiary text-text-primary font-medium shadow-sm"
                : "text-text-muted hover:text-text-secondary"
            }`}
          >
            レイヤー構造
          </button>
          <button
            onClick={() => setViewMode("layerCheck")}
            className={`px-2 py-1 text-[10px] rounded transition-all ${
              viewMode === "layerCheck"
                ? "bg-bg-tertiary text-text-primary font-medium shadow-sm"
                : "text-text-muted hover:text-text-secondary"
            }`}
          >
            レイヤー分離確認
          </button>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Thumbnail Size (only in thumbnails mode) */}
        {viewMode === "thumbnails" && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">サイズ:</span>
            <select
              className="bg-bg-tertiary border border-border rounded-md text-xs py-1 px-2 text-text-primary focus:border-accent focus:outline-none"
              value={thumbnailSize}
              onChange={(e) => setThumbnailSize(e.target.value as ThumbnailSize)}
            >
              {Object.entries(THUMBNAIL_SIZES).map(([key, { label }]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Guidance Banner - when no spec selected */}
      {noSpecSelected && !hasChecked && (
        <div className="px-4 py-3 bg-accent/5 border-b border-accent/20 flex items-center gap-3 flex-shrink-0">
          <div className="w-6 h-6 rounded-full bg-accent/15 flex items-center justify-center flex-shrink-0">
            <svg
              className="w-3.5 h-3.5 text-accent"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-xs text-text-primary font-medium">
              上の仕様ボタンを選択するとチェックが自動実行されます
            </p>
            <p className="text-[11px] text-text-muted mt-0.5">
              モノクロ原稿 (Grayscale/600dpi/8bit) またはカラー原稿 (RGB/350dpi/8bit) を選択
            </p>
          </div>
        </div>
      )}

      {/* Conversion Results Banner */}
      {showResults && resultStats && (
        <div
          className={`px-4 py-2 border-b flex items-center gap-3 flex-shrink-0 ${
            resultStats.errorCount > 0
              ? "bg-warning/5 border-warning/20"
              : "bg-success/5 border-success/20"
          }`}
        >
          <div
            className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
              resultStats.errorCount > 0 ? "bg-warning/15" : "bg-success/15"
            }`}
          >
            {resultStats.errorCount > 0 ? (
              <svg className="w-3 h-3 text-warning" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
            ) : (
              <svg className="w-3 h-3 text-success" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
            )}
          </div>
          <div className="flex-1 text-xs">
            <span className="text-text-primary font-medium">処理完了:</span>
            {resultStats.successCount > 0 && (
              <span className="text-success ml-1.5">{resultStats.successCount}件成功</span>
            )}
            {resultStats.errorCount > 0 && (
              <span className="text-error ml-1.5">{resultStats.errorCount}件エラー</span>
            )}
            {resultStats.totalChanges > 0 && (
              <span className="text-text-muted ml-1.5">({resultStats.totalChanges}変更)</span>
            )}
          </div>
          <button
            onClick={() => {
              setShowResults(false);
              clearConversionResults();
            }}
            className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Main Content - 3-Column Layout */}
      <div className="flex-1 flex overflow-hidden" data-tool-panel>
        {/* Left: File List */}
        <CompactFileList className="w-52 flex-shrink-0 border-r border-border" />

        {/* Center: Spec Detail Panel (hidden in layerCheck mode) */}
        {viewMode !== "layerCheck" && (
          <div className="w-[320px] flex-shrink-0 border-r border-border overflow-hidden flex flex-col bg-bg-secondary">
            {activeFile ? (
              <>
                {/* Header */}
                <div className="px-3 py-2 border-b border-border flex items-center gap-2 flex-shrink-0">
                  <div className="w-5 h-5 rounded-md bg-accent-secondary/20 flex items-center justify-center flex-shrink-0">
                    <svg
                      className="w-3 h-3 text-accent-secondary"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  </div>
                  <span className="text-xs font-medium text-text-primary truncate flex-1">
                    {activeFile.fileName}
                  </span>
                  {activeFile.filePath && (
                    <button
                      className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded transition-all text-text-muted hover:text-text-primary hover:bg-bg-tertiary active:scale-95"
                      onClick={() => {
                        if (selectedFileIds.length > 1) {
                          const paths = selectedFileIds
                            .map((id) => files.find((f) => f.id === id)?.filePath)
                            .filter((p): p is string => !!p);
                          revealFiles(paths);
                        } else {
                          openFolderForFile(activeFile.filePath);
                        }
                      }}
                      title={
                        selectedFileIds.length > 1
                          ? `${selectedFileIds.length}件をエクスプローラーで選択 (F)`
                          : "フォルダを開く (F)"
                      }
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
                  {isPhotoshopInstalled && activeFile.filePath && (
                    <button
                      className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded transition-all text-[#31A8FF] hover:bg-[#31A8FF]/15 active:scale-95"
                      onClick={() => openFileInPhotoshop(activeFile.filePath)}
                      title="Photoshopで開く (P)"
                    >
                      <span className="text-sm font-bold leading-none">P</span>
                    </button>
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 overflow-auto">
                  {(() => {
                    const activeCheckResult = checkResults.get(activeFile.id);
                    const activeHasError = activeCheckResult && !activeCheckResult.passed;
                    return (
                      <>
                        {activeHasError && activeCheckResult && (
                          <div className="p-3 border-b border-border">
                            <FixGuidePanel checkResult={activeCheckResult} />
                          </div>
                        )}
                      </>
                    );
                  })()}
                  <div className="p-3 border-b border-border">
                    <GuideSectionPanel file={activeFile} />
                  </div>
                  <MetadataPanel file={activeFile} />
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center px-6">
                  <div className="w-10 h-10 mx-auto mb-3 rounded-xl bg-bg-tertiary flex items-center justify-center">
                    <svg
                      className="w-5 h-5 text-text-muted"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"
                      />
                    </svg>
                  </div>
                  <p className="text-xs text-text-muted">ファイルを選択すると詳細が表示されます</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Right: Thumbnail Grid / Layer Grid */}
        <div className="flex-1 overflow-hidden relative" data-preview-grid>
          {viewMode === "thumbnails" && <PreviewGrid />}
          {viewMode === "layers" && <SpecLayerGrid />}
          {viewMode === "layerCheck" && (
            <LayerSeparationPanel onOpenInPhotoshop={openFileInPhotoshop} />
          )}

          {/* Floating Action Buttons */}
          <div className="absolute bottom-6 right-6 flex flex-row flex-wrap items-end justify-end gap-3 z-10">
            {viewMode === "thumbnails" && stats.noGuides > 0 && (
              <button
                className="h-16 min-w-[220px] px-8 text-lg font-bold rounded-2xl shadow-2xl transition-all duration-200 flex items-center justify-center gap-3 bg-bg-secondary border-2 border-guide-v/50 text-guide-v hover:bg-bg-elevated hover:border-guide-v/70 hover:shadow-[0_8px_30px_rgba(0,188,212,0.25)] active:scale-[0.97]"
                onClick={openEditor}
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
                    d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                  />
                </svg>
                ガイドを編集
                <span className="px-2 py-1 rounded-lg bg-warning/15 text-warning text-sm font-bold">
                  {stats.noGuides}
                </span>
              </button>
            )}
            {viewMode === "thumbnails" && stats.failed > 0 && isPhotoshopInstalled && (
              <div className="relative">
                {/* Guide Prompt Popover */}
                {showGuidePrompt && (
                  <div
                    ref={guidePromptRef}
                    className="absolute bottom-full right-0 mb-3 w-72 bg-white rounded-xl shadow-elevated border border-border p-4 space-y-3"
                    style={{ animation: "toast-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)" }}
                  >
                    <div className="flex items-start gap-2.5">
                      <div className="w-6 h-6 rounded-full bg-warning/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <svg
                          className="w-3.5 h-3.5 text-warning"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-text-primary">ガイドが未設定です</p>
                        <p className="text-xs text-text-muted mt-1">
                          {stats.noGuides}件のファイルにガイドがありません
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        className="flex-1 px-3 py-2 text-xs font-medium rounded-lg border-2 border-guide-v/50 text-guide-v hover:bg-guide-v/10 transition-colors"
                        onClick={() => {
                          setShowGuidePrompt(false);
                          openEditor();
                        }}
                      >
                        ガイドを編集
                      </button>
                      <button
                        className="flex-1 px-3 py-2 text-xs font-medium rounded-lg bg-bg-tertiary text-text-secondary hover:bg-bg-elevated transition-colors"
                        onClick={() => {
                          setShowGuidePrompt(false);
                          prepareFiles({
                            fixSpec: true,
                            applyGuides: false,
                            fileIds: selectedFileIds.length > 0 ? selectedFileIds : undefined,
                          });
                        }}
                      >
                        このまま変換
                      </button>
                    </div>
                  </div>
                )}
                <button
                  className="h-16 min-w-[220px] px-8 text-lg font-bold rounded-2xl shadow-2xl transition-all duration-200 flex items-center justify-center gap-3 text-white bg-gradient-to-r from-[#31A8FF] to-[#0066CC] shadow-[0_4px_16px_rgba(49,168,255,0.4)] hover:shadow-[0_6px_24px_rgba(49,168,255,0.55)] hover:brightness-110 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => {
                    if (stats.noGuides > 0 && guides.length === 0) {
                      setShowGuidePrompt(true);
                    } else {
                      prepareFiles({
                        fixSpec: true,
                        applyGuides: stats.noGuides > 0 && guides.length > 0,
                        fileIds: selectedFileIds.length > 0 ? selectedFileIds : undefined,
                      });
                    }
                  }}
                  disabled={isConverting || isProcessing || !activeSpecId}
                >
                  {isConverting || isProcessing ? (
                    <>
                      <div className="w-5 h-5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                      <span className="text-base">処理中...</span>
                    </>
                  ) : (
                    <>
                      <span className="text-base font-bold leading-none">P</span>
                      一括変換
                      <span className="px-2 py-1 rounded-lg bg-white/25 text-sm font-bold">
                        {selectedFileIds.length > 0 ? selectedFileIds.length : stats.failed}
                      </span>
                    </>
                  )}
                </button>
              </div>
            )}
            {viewMode === "thumbnails" && (
              <>
                {/* PDF化ボタン（Tachimi連携） */}
                <button
                  className={`h-16 min-w-[220px] px-8 text-lg font-bold rounded-2xl shadow-2xl transition-all duration-200 flex items-center justify-center gap-3 bg-bg-secondary active:scale-[0.97] ${
                    allPassed
                      ? "border-2 border-[#ff8a6b]/60 text-[#ff8a6b] hover:bg-bg-elevated hover:border-[#ff8a6b]/80 hover:shadow-[0_6px_20px_rgba(255,138,107,0.25)]"
                      : "border-2 border-[#c8806a]/30 text-[#c8806a]/70 hover:bg-bg-elevated hover:border-[#c8806a]/50 hover:text-[#c8806a]"
                  }`}
                  onClick={handleLaunchTachimi}
                  title="Tachimiを起動してPDF作成"
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
                      d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                    />
                  </svg>
                  PDF化
                  <span
                    className={`px-2 py-1 rounded-lg text-sm font-bold ${
                      allPassed ? "bg-[#ff8a6b]/15" : "bg-[#c8806a]/10"
                    }`}
                  >
                    {files.length}
                  </span>
                </button>
                {/* Tachimi起動エラー */}
                {tachimiError && (
                  <div className="px-4 py-2 rounded-xl bg-error/10 border border-error/30 text-xs text-error max-w-xs">
                    {tachimiError}
                    <button onClick={() => setTachimiError(null)} className="ml-2 underline">
                      閉じる
                    </button>
                  </div>
                )}
              </>
            )}
            {/* テキスト抽出ボタン（常時表示） */}
            <TextExtractButton />
          </div>
        </div>
      </div>
    </div>
  );
}
