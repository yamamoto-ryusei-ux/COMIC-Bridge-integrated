import { useState, useCallback, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { useTiffStore } from "../../store/tiffStore";
import { usePsdStore } from "../../store/psdStore";
import type { TiffCropPreset, TiffScandataFile, TiffCropStep } from "../../types/tiff";
import { GENRE_LABELS, JSON_BASE_PATH } from "../../types/tiff";
import { TiffPartialBlurModal } from "./TiffPartialBlurModal";

const ASPECT_W = 640;
const ASPECT_H = 909;
const ASPECT_RATIO = ASPECT_W / ASPECT_H;
const ASPECT_TOLERANCE = 0.01;

// ============================================================
// Main Component
// ============================================================

export function TiffCropSidePanel() {
  const setPhase = useTiffStore((s) => s.setPhase);
  const cropStep = useTiffStore((s) => s.cropStep);
  const setCropStep = useTiffStore((s) => s.setCropStep);
  const cropBounds = useTiffStore((s) => s.settings.crop.bounds);
  const setCropBounds = useTiffStore((s) => s.setCropBounds);
  const pushCropHistory = useTiffStore((s) => s.pushCropHistory);
  const undoCropBounds = useTiffStore((s) => s.undoCropBounds);
  const redoCropBounds = useTiffStore((s) => s.redoCropBounds);
  const cropHistory = useTiffStore((s) => s.cropHistory);
  const cropFuture = useTiffStore((s) => s.cropFuture);
  const cropGuides = useTiffStore((s) => s.cropGuides);
  const clearCropGuides = useTiffStore((s) => s.clearCropGuides);
  const removeCropGuide = useTiffStore((s) => s.removeCropGuide);
  const selectedCropGuideIndex = useTiffStore((s) => s.selectedCropGuideIndex);
  const setSelectedCropGuideIndex = useTiffStore((s) => s.setSelectedCropGuideIndex);
  const applyCropGuidesToBounds = useTiffStore((s) => s.applyCropGuidesToBounds);
  const resetCropEditor = useTiffStore((s) => s.resetCropEditor);

  const psdFiles = usePsdStore((s) => s.files);
  const referenceFileIndex = useTiffStore((s) => s.referenceFileIndex);
  const partialBlurEntries = useTiffStore((s) => s.settings.partialBlurEntries);
  const blurEnabled = useTiffStore((s) => s.settings.blur.enabled);

  const [showPartialBlurModal, setShowPartialBlurModal] = useState(false);

  // ガイドの水平・垂直本数
  const hGuideCount = cropGuides.filter((g) => g.direction === "horizontal").length;
  const vGuideCount = cropGuides.filter((g) => g.direction === "vertical").length;
  const canApplyGuides = hGuideCount >= 2 && vGuideCount >= 2;

  // PSD埋め込みガイドの有無チェック（基準ファイル → 全ファイルからフォールバック）
  const refIdx = Math.max(0, Math.min(referenceFileIndex - 1, psdFiles.length - 1));
  const refFile = psdFiles[refIdx] || null;

  // 基準ファイルのガイドを優先、なければ全ファイルからガイド付きを探す
  const guideSource = useMemo(() => {
    if (refFile?.metadata?.guides && refFile.metadata.guides.length >= 2) {
      return refFile;
    }
    return psdFiles.find((f) => f.metadata?.guides && f.metadata.guides.length >= 2) || null;
  }, [refFile, psdFiles]);

  const psdGuides = guideSource?.metadata?.guides;
  const hasPsdGuides = !!(psdGuides && psdGuides.length >= 2);

  // デバッグ: ガイド検出状況をログ出力
  useEffect(() => {
    if (psdFiles.length > 0) {
      const guideCounts = psdFiles.map((f) => ({
        name: f.fileName,
        hasMetadata: !!f.metadata,
        hasGuides: !!f.metadata?.hasGuides,
        guideCount: f.metadata?.guides?.length ?? 0,
        guides: f.metadata?.guides ?? [],
      }));
      console.log("[TiffCropSidePanel] PSD Guide Debug:", {
        totalFiles: psdFiles.length,
        refIdx,
        referenceFileIndex,
        hasPsdGuides,
        guideSource: guideSource?.fileName ?? "none",
        guideCounts,
      });
    }
  }, [psdFiles, refIdx, referenceFileIndex, hasPsdGuides, guideSource]);

  // PSDガイドから自動範囲設定（縦ガイドのみでも動作）
  const handleAutoGuideSelect = useCallback(() => {
    if (!psdGuides || !guideSource?.metadata) return;
    const docWidth = guideSource.metadata.width ?? 0;
    const docHeight = guideSource.metadata.height ?? 0;
    if (!docWidth || !docHeight) return;

    const hPositions = psdGuides.filter((g) => g.direction === "horizontal").map((g) => g.position);
    const vPositions = psdGuides.filter((g) => g.direction === "vertical").map((g) => g.position);

    // tachimi準拠: ドキュメント中心±1pxのガイドを除外し、最適範囲を算出
    const getOptimalRange = (positions: number[], docSize: number): [number, number] | null => {
      const center = docSize / 2;
      const filtered = positions.filter((p) => Math.abs(p - center) > 1);
      const sorted = [...new Set(filtered.map((p) => Math.round(p)))].sort((a, b) => a - b);
      if (sorted.length < 2) return null;
      return [sorted[0], sorted[sorted.length - 1]];
    };

    const hRange = getOptimalRange(hPositions, docHeight);
    const vRange = getOptimalRange(vPositions, docWidth);

    // 縦ガイドのみの場合: 水平方向はドキュメント全体を使用
    if (!vRange && !hRange) {
      alert("ガイド線が不足しています（中心以外に2本以上必要）");
      return;
    }

    pushCropHistory();
    setCropBounds({
      left: vRange ? vRange[0] : 0,
      top: hRange ? hRange[0] : 0,
      right: vRange ? vRange[1] : docWidth,
      bottom: hRange ? hRange[1] : docHeight,
    });
  }, [psdGuides, guideSource, pushCropHistory, setCropBounds]);

  // 比率検証
  const ratioValid = useMemo(() => {
    if (!cropBounds) return null;
    const w = cropBounds.right - cropBounds.left;
    const h = cropBounds.bottom - cropBounds.top;
    const ratio = w / h;
    return Math.abs(ratio - ASPECT_RATIO) / ASPECT_RATIO <= ASPECT_TOLERANCE;
  }, [cropBounds]);

  // bounds変更でステップ自動進行
  useEffect(() => {
    if (cropBounds && cropStep === "select") {
      setCropStep("confirm");
    }
  }, [cropBounds, cropStep, setCropStep]);

  const handleApply = () => {
    setPhase("idle");
  };

  const handleCancel = () => {
    resetCropEditor();
    setPhase("idle");
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-display font-medium text-text-primary flex items-center gap-2">
            <svg
              className="w-4 h-4 text-accent-warm"
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
            版面指定
          </h3>
          <div className="flex items-center gap-1">
            {/* Undo */}
            <button
              onClick={undoCropBounds}
              disabled={cropHistory.length === 0}
              className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
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
                  d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
                />
              </svg>
            </button>
            {/* Redo */}
            <button
              onClick={redoCropBounds}
              disabled={cropFuture.length === 0}
              className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
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
                  d="M21 10H11a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-auto p-3 space-y-3">
        {/* Step Indicator */}
        <CropStepIndicator currentStep={cropStep} />

        {/* Hint Text */}
        <CropHintText
          step={cropStep}
          guideCount={cropGuides.length}
          canApplyGuides={canApplyGuides}
        />

        {/* Operation Guide */}
        <div className="bg-bg-tertiary rounded-xl p-3">
          <h4 className="text-xs font-medium text-text-muted mb-2">操作方法</h4>
          <div className="space-y-1.5 text-[10px] text-text-secondary">
            <div className="flex items-start gap-2">
              <svg
                className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-accent-warm"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"
                />
              </svg>
              <span>画像上をクリック/ドラッグで範囲を作成</span>
            </div>
            <div className="flex items-start gap-2">
              <svg
                className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-accent-warm"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              <span>定規からドラッグでガイドを追加</span>
            </div>
            <div className="flex items-start gap-2">
              <svg
                className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-text-muted"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7"
                />
              </svg>
              <span>Ctrl+Wheel: ズーム / Space+ドラッグ: パン</span>
            </div>
          </div>
        </div>

        {/* Bounds Display */}
        <div className="bg-bg-tertiary rounded-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-medium text-text-muted">クロップ範囲</h4>
            {ratioValid !== null && (
              <span
                className={`px-2 py-0.5 text-[10px] font-medium rounded ${
                  ratioValid ? "bg-success/10 text-success" : "bg-error/10 text-error"
                }`}
              >
                {ratioValid ? "比率OK" : "比率NG"}
              </span>
            )}
          </div>
          {cropBounds ? (
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-text-muted">
                サイズ:{" "}
                <span className="font-mono text-accent-warm">
                  {cropBounds.right - cropBounds.left} x {cropBounds.bottom - cropBounds.top}
                </span>
              </span>
              <button
                onClick={() => {
                  pushCropHistory();
                  setCropBounds(null);
                  setCropStep("select");
                }}
                className="text-text-muted hover:text-error transition-colors"
              >
                クリア
              </button>
            </div>
          ) : (
            <p className="text-xs text-text-muted/60 px-1">範囲未設定</p>
          )}

          {/* PSD Guide Auto-Select — 常時表示、ガイド未検出時はdisabled */}
          {psdFiles.length > 0 && (
            <button
              onClick={handleAutoGuideSelect}
              disabled={!hasPsdGuides}
              className={`w-full mt-2 px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
                hasPsdGuides
                  ? "text-accent-secondary bg-accent-secondary/10 border border-accent-secondary/30 hover:bg-accent-secondary/20"
                  : "text-text-muted/50 bg-bg-tertiary border border-transparent cursor-not-allowed"
              }`}
            >
              PSDガイドから自動設定
              {hasPsdGuides ? (
                <span className="ml-1 text-[10px] text-text-muted">({psdGuides!.length}本)</span>
              ) : (
                <span className="ml-1 text-[10px] text-text-muted/40">（ガイド未検出）</span>
              )}
            </button>
          )}
        </div>

        {/* Guide Section */}
        {cropGuides.length > 0 && (
          <div className="bg-bg-tertiary rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-medium text-text-muted">ガイド ({cropGuides.length})</h4>
              <button
                onClick={clearCropGuides}
                className="text-[10px] text-text-muted hover:text-error transition-colors"
              >
                全削除
              </button>
            </div>

            {canApplyGuides && (
              <button
                onClick={applyCropGuidesToBounds}
                className="w-full mb-2 px-3 py-2 text-xs font-medium text-white bg-gradient-to-r from-accent-warm to-accent rounded-lg hover:-translate-y-0.5 transition-all shadow-sm"
              >
                ガイドから範囲を設定
              </button>
            )}

            {/* Guide list */}
            <div className="space-y-0.5 max-h-36 overflow-auto">
              {cropGuides.map((guide, i) => (
                <div
                  key={i}
                  className={`flex items-center gap-2 px-2 py-1 rounded-lg cursor-pointer text-xs transition-colors ${
                    selectedCropGuideIndex === i
                      ? "bg-accent-warm/15 border border-accent-warm/40"
                      : "hover:bg-bg-elevated border border-transparent"
                  }`}
                  onClick={() => setSelectedCropGuideIndex(selectedCropGuideIndex === i ? null : i)}
                >
                  <span className="text-accent-warm/70 font-mono w-4 text-center">
                    {guide.direction === "horizontal" ? "─" : "│"}
                  </span>
                  <span className="text-text-secondary font-mono flex-1">
                    {Math.round(guide.position)} px
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeCropGuide(i);
                    }}
                    className="text-text-muted/50 hover:text-error transition-colors p-0.5"
                  >
                    <svg
                      className="w-3 h-3"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Partial Blur Section */}
      {blurEnabled && (
        <div className="px-3 pb-2">
          <button
            onClick={() => setShowPartialBlurModal(true)}
            className="w-full px-3 py-2 text-xs font-medium text-accent-secondary bg-accent-secondary/10 border border-accent-secondary/30 rounded-lg hover:bg-accent-secondary/20 transition-colors flex items-center justify-center gap-1.5"
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
                d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"
              />
            </svg>
            部分ぼかし設定
            {partialBlurEntries.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-[10px] bg-accent-secondary/20 rounded-full">
                {partialBlurEntries.length}
              </span>
            )}
          </button>
        </div>
      )}

      {showPartialBlurModal && (
        <TiffPartialBlurModal onClose={() => setShowPartialBlurModal(false)} />
      )}

      {/* Action Bar */}
      <div className="p-3 border-t border-border space-y-2">
        <div className="flex gap-2">
          <button
            onClick={handleCancel}
            className="flex-1 px-3 py-2.5 text-sm font-medium rounded-xl bg-bg-tertiary text-text-secondary hover:bg-bg-tertiary/80 transition-colors"
          >
            キャンセル
          </button>
          <button
            onClick={handleApply}
            disabled={!cropBounds}
            className="
              flex-1 px-3 py-2.5 text-sm font-medium rounded-xl text-white
              bg-gradient-to-r from-accent-warm to-accent
              shadow-[0_3px_12px_rgba(255,177,66,0.25)]
              hover:shadow-[0_5px_16px_rgba(255,177,66,0.35)]
              hover:-translate-y-0.5
              transition-all duration-200
              disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none
            "
          >
            適用
          </button>
        </div>
        <div className="flex items-center justify-center text-[10px] text-text-muted">
          比率 {ASPECT_W}:{ASPECT_H}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Sub-components
// ============================================================

function CropStepIndicator({ currentStep }: { currentStep: TiffCropStep }) {
  const steps: { key: TiffCropStep; label: string }[] = [
    { key: "select", label: "選択" },
    { key: "confirm", label: "確認" },
    { key: "apply", label: "適用" },
  ];
  const currentIdx = steps.findIndex((s) => s.key === currentStep);

  return (
    <div className="flex items-center gap-1 px-1">
      {steps.map((step, i) => (
        <div key={step.key} className="flex items-center gap-1 flex-1">
          <div
            className={`
            w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0 transition-all
            ${
              i < currentIdx
                ? "bg-success text-white"
                : i === currentIdx
                  ? "bg-accent-warm text-white"
                  : "bg-bg-tertiary text-text-muted"
            }
          `}
          >
            {i < currentIdx ? (
              <svg
                className="w-3 h-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={3}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              i + 1
            )}
          </div>
          <span
            className={`text-[10px] ${i === currentIdx ? "text-text-primary font-medium" : "text-text-muted"}`}
          >
            {step.label}
          </span>
          {i < steps.length - 1 && (
            <div className={`flex-1 h-px mx-1 ${i < currentIdx ? "bg-success" : "bg-border"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

function CropHintText({
  step,
  guideCount,
  canApplyGuides,
}: {
  step: TiffCropStep;
  guideCount: number;
  canApplyGuides: boolean;
}) {
  let hint = "";
  if (step === "select") {
    if (guideCount > 0 && canApplyGuides) {
      hint = "「ガイドから範囲を設定」をクリックして適用してください";
    } else if (guideCount > 0) {
      hint = `ガイド ${guideCount}本。あと${Math.max(0, 4 - guideCount)}本追加してください`;
    } else {
      hint = "画像上をクリックで範囲を作成、または定規からガイドを追加してください";
    }
  } else if (step === "confirm") {
    hint = "範囲を確認してください。矢印キーで微調整、Ctrl+Z で元に戻せます";
  } else {
    hint = "「適用」ボタンを押して設定に反映します";
  }

  return (
    <div className="px-3 py-2 bg-bg-tertiary/60 rounded-lg text-[11px] text-text-secondary leading-relaxed">
      {hint}
    </div>
  );
}

// ============================================================
// JSON Inline Sections
// ============================================================

interface FolderEntry {
  name: string;
  isDir: boolean;
}

export function CropJsonLoadDialog({
  onLoad,
  onClose,
}: {
  onLoad: (preset: TiffCropPreset, jsonFilePath?: string) => void;
  onClose: () => void;
}) {
  const [currentPath, setCurrentPath] = useState(JSON_BASE_PATH);
  const [pathHistory, setPathHistory] = useState<string[]>([]);
  const [entries, setEntries] = useState<FolderEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [presets, setPresets] = useState<TiffCropPreset[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 検索
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<
    { label: string; title: string; path: string }[]
  >([]);
  const [isSearchMode, setIsSearchMode] = useState(false);

  // 現在のフォルダの内容を読み込む（Rustコマンド経由）
  const loadContents = useCallback(async (path: string) => {
    setLoading(true);
    setEntries([]);
    setPresets([]);
    setSelectedFile(null);
    setError(null);
    try {
      const contents = await invoke<{ folders: string[]; json_files: string[] }>(
        "list_folder_contents",
        {
          folderPath: path,
        },
      );
      const items: FolderEntry[] = [
        ...contents.folders.map((name) => ({ name, isDir: true })),
        ...contents.json_files.map((name) => ({ name, isDir: false })),
      ];
      setEntries(items);

      // 自動選択: フォルダ0個 + JSONファイル1個の場合、自動で選択
      if (contents.json_files.length === 1 && contents.folders.length === 0) {
        handleSelectFile(path, contents.json_files[0]);
      }
    } catch {
      setError("フォルダを読み込めません");
    } finally {
      setLoading(false);
    }
  }, []);

  // 初回読み込み
  useEffect(() => {
    loadContents(currentPath);
  }, []);

  // フォルダに入る（ワンクリック）
  const enterFolder = useCallback(
    (folderName: string) => {
      const newPath = `${currentPath}/${folderName}`;
      setPathHistory((prev) => [...prev, currentPath]);
      setCurrentPath(newPath);
      loadContents(newPath);
    },
    [currentPath, loadContents],
  );

  // 戻る
  const goBack = useCallback(() => {
    if (pathHistory.length === 0) return;
    const prev = pathHistory[pathHistory.length - 1];
    setPathHistory((h) => h.slice(0, -1));
    setCurrentPath(prev);
    loadContents(prev);
  }, [pathHistory, loadContents]);

  // JSONファイル選択 → プリセット読み込み（Rustコマンド経由）
  const handleSelectFile = useCallback(async (dirPath: string, fileName: string) => {
    const filePath = `${dirPath}/${fileName}`;
    setSelectedFile(fileName);
    setPresets([]);
    setError(null);
    try {
      const content = await invoke<string>("read_text_file", { filePath });
      const data: TiffScandataFile = JSON.parse(content);
      if (data.presetData?.selectionRanges && data.presetData.selectionRanges.length > 0) {
        setPresets(data.presetData.selectionRanges);
      }
      // プリセットがなくてもエラーにしない（JSONパス選択として有効）
    } catch {
      setError("JSONの読み込みに失敗しました");
    }
  }, []);

  // 検索（デバウンス300ms）
  useEffect(() => {
    if (!searchQuery.trim()) {
      setIsSearchMode(false);
      setSearchResults([]);
      return;
    }
    setIsSearchMode(true);
    const timer = setTimeout(async () => {
      try {
        const results = await invoke<{ label: string; title: string; path: string }[]>(
          "search_json_folders",
          { basePath: JSON_BASE_PATH, query: searchQuery.trim() },
        );
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // 検索結果クリック → JSONファイル読み込みまたはフォルダ移動
  const handleSearchSelect = useCallback(
    async (result: { path: string }) => {
      const resultPath = result.path.replace(/\\/g, "/");
      setSearchQuery("");
      setIsSearchMode(false);

      if (resultPath.toLowerCase().endsWith(".json")) {
        // JSONファイルパス → 直接読み込み
        const dirPath = resultPath.replace(/\/[^/]+$/, "");
        const fileName = resultPath.split("/").pop() || "";
        handleSelectFile(dirPath, fileName);
      } else {
        // フォルダパス → そのフォルダに移動
        setPathHistory((prev) => [...prev, currentPath]);
        setCurrentPath(resultPath);
        loadContents(resultPath);
      }
    },
    [handleSelectFile, currentPath, loadContents],
  );

  // パス表示（ベースパスからの相対）
  const displayPath = useMemo(() => {
    const rel = currentPath.replace(JSON_BASE_PATH, "").replace(/^[/\\]/, "");
    return rel || "JSONフォルダ";
  }, [currentPath]);

  const isAtRoot = currentPath === JSON_BASE_PATH;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-bg-secondary border border-border rounded-2xl shadow-xl max-w-lg w-full mx-4 max-h-[80vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-display font-bold text-text-primary">JSONファイルを選択</h3>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition-colors"
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
        </div>

        {/* Search input */}
        <div className="px-5 py-2 border-b border-border/50">
          <div className="relative">
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="タイトルで検索..."
              className="w-full pl-8 pr-8 py-1.5 text-xs bg-bg-elevated border border-border/50 rounded-lg text-text-primary placeholder:text-text-muted/40 focus:outline-none focus:border-accent-warm/50"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery("");
                  setIsSearchMode(false);
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
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
            )}
          </div>
        </div>

        {/* Path breadcrumb (hidden during search) */}
        {!isSearchMode && (
          <div className="px-5 py-2 border-b border-border/50 flex items-center gap-2">
            <button
              onClick={goBack}
              disabled={isAtRoot}
              className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="text-[10px] text-text-muted font-mono truncate flex-1">
              {displayPath}
            </span>
          </div>
        )}

        {/* File browser / Search results */}
        <div className="flex-1 overflow-auto min-h-0">
          {isSearchMode ? (
            searchResults.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-text-muted">
                {searchQuery.trim() ? "見つかりませんでした" : "検索中..."}
              </div>
            ) : (
              searchResults.map((result, i) => {
                const isJsonFile = result.path.toLowerCase().endsWith(".json");
                return (
                  <button
                    key={i}
                    onClick={() => handleSearchSelect(result)}
                    className="w-full text-left px-4 py-2.5 text-xs transition-colors border-b border-border/30 last:border-b-0 flex items-center gap-2.5 text-text-secondary hover:bg-bg-tertiary"
                  >
                    {isJsonFile ? (
                      <svg
                        className="w-4 h-4 flex-shrink-0 opacity-60"
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
                    ) : (
                      <svg
                        className="w-4 h-4 flex-shrink-0 opacity-60"
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
                    )}
                    <div className="truncate">
                      <span className="text-[9px] text-accent-warm/70 mr-1.5">{result.label}</span>
                      <span>{result.title}</span>
                    </div>
                  </button>
                );
              })
            )
          ) : loading ? (
            <div className="px-4 py-8 text-center text-xs text-text-muted">読み込み中...</div>
          ) : entries.length === 0 && !error ? (
            <div className="px-4 py-8 text-center text-xs text-text-muted">
              {isAtRoot ? "JSONフォルダにアクセスできません" : "このフォルダは空です"}
            </div>
          ) : (
            entries.map((entry) => (
              <button
                key={entry.name}
                onClick={() => {
                  if (entry.isDir) {
                    enterFolder(entry.name);
                  } else {
                    handleSelectFile(currentPath, entry.name);
                  }
                }}
                className={`w-full text-left px-4 py-2.5 text-xs transition-colors border-b border-border/30 last:border-b-0 flex items-center gap-2.5 ${
                  selectedFile === entry.name && !entry.isDir
                    ? "bg-accent-warm/15 text-accent-warm font-medium"
                    : "text-text-secondary hover:bg-bg-tertiary"
                }`}
              >
                {entry.isDir ? (
                  <svg
                    className="w-4 h-4 flex-shrink-0 text-accent-warm/70"
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
                ) : (
                  <svg
                    className="w-4 h-4 flex-shrink-0 opacity-60"
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
                )}
                <span className="truncate">
                  {entry.isDir ? entry.name : entry.name.replace(/\.json$/, "")}
                </span>
                {entry.isDir && (
                  <svg
                    className="w-3.5 h-3.5 flex-shrink-0 text-text-muted/50 ml-auto"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                )}
              </button>
            ))
          )}
        </div>

        {error && (
          <div className="mx-5 mb-2 px-3 py-2 rounded-lg bg-error/10 text-[10px] text-error">
            {error}
          </div>
        )}

        {/* Preset list */}
        {/* Preset list or empty JSON select */}
        {selectedFile && (
          <div className="px-5 py-2 border-t border-border/50 space-y-1 max-h-48 overflow-auto">
            {presets.length > 0 ? (
              <>
                <label className="text-[10px] text-text-muted block">
                  プリセット ({presets.length})
                </label>
                {presets.map((preset, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      onLoad(preset, selectedFile ? `${currentPath}/${selectedFile}` : undefined);
                      onClose();
                    }}
                    className="w-full text-left px-3 py-2.5 bg-bg-tertiary rounded-lg hover:bg-accent-warm/10 border border-transparent hover:border-accent-warm/30 transition-all group"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-text-primary font-medium truncate">
                        {preset.label}
                      </span>
                      <svg
                        className="w-4 h-4 text-text-muted group-hover:text-accent-warm transition-colors flex-shrink-0"
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
                    </div>
                    <div className="flex gap-3 text-[9px] text-text-muted mt-0.5">
                      <span>
                        doc: {preset.documentSize?.width}x{preset.documentSize?.height}
                      </span>
                      {preset.size && (
                        <span>
                          range: {preset.size.width}x{preset.size.height}
                        </span>
                      )}
                      {preset.blurRadius !== undefined && <span>blur: {preset.blurRadius}px</span>}
                      {preset.savedAt && (
                        <span>{new Date(preset.savedAt).toLocaleDateString()}</span>
                      )}
                    </div>
                  </button>
                ))}
              </>
            ) : (
              <div className="text-center py-2">
                <p className="text-[10px] text-text-muted mb-2">範囲プリセットなし</p>
                <button
                  onClick={() => {
                    // プリセットなしでもJSONパスだけ保存して閉じる
                    onLoad(
                      {
                        label: "",
                        units: "px",
                        bounds: { left: 0, top: 0, right: 0, bottom: 0 },
                        size: { width: 0, height: 0 },
                        documentSize: { width: 0, height: 0 },
                        savedAt: "",
                      },
                      `${currentPath}/${selectedFile}`,
                    );
                    onClose();
                  }}
                  className="px-3 py-1.5 text-[11px] font-medium rounded-lg text-accent-secondary bg-accent-secondary/10 border border-accent-secondary/30 hover:bg-accent-secondary/20 transition-colors"
                >
                  このJSONを保存先に選択
                </button>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-text-secondary bg-bg-tertiary rounded-xl hover:bg-bg-tertiary/80 transition-colors"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function CropJsonRegisterDialog({ onClose }: { onClose: () => void }) {
  const cropBounds = useTiffStore((s) => s.settings.crop.bounds);
  const referenceImageSize = useTiffStore((s) => s.referenceImageSize);
  const blurSettings = useTiffStore((s) => s.settings.blur);

  const genres = Object.keys(GENRE_LABELS);
  const [selectedGenre, setSelectedGenre] = useState(genres[0]);
  const [selectedLabel, setSelectedLabel] = useState("");
  const [title, setTitle] = useState("");
  const [rangeLabel, setRangeLabel] = useState("基本範囲");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const labels = GENRE_LABELS[selectedGenre] || [];

  useEffect(() => {
    setSelectedLabel(labels[0] || "");
  }, [selectedGenre]);

  // 参考スクリプト互換ラベル: "基本範囲_ぼかし半径px_キャンバスサイズ"
  const effectiveBlurRadius = blurSettings.enabled ? blurSettings.radius : 0;
  const fullRangeLabel = useMemo(() => {
    const prefix = rangeLabel.trim() || "基本範囲";
    const blurSuffix = `_${effectiveBlurRadius}px`;
    if (referenceImageSize) {
      return `${prefix}${blurSuffix}_${referenceImageSize.width}x${referenceImageSize.height}`;
    }
    return `${prefix}${blurSuffix}`;
  }, [rangeLabel, referenceImageSize, effectiveBlurRadius]);

  // 現在の選択範囲からプリセットデータを作成（参考スクリプト互換）
  const currentSelectionData = useMemo(() => {
    if (!cropBounds || !referenceImageSize) return null;
    return {
      label: fullRangeLabel,
      units: "px",
      bounds: { ...cropBounds },
      size: {
        width: cropBounds.right - cropBounds.left,
        height: cropBounds.bottom - cropBounds.top,
      },
      documentSize: { ...referenceImageSize },
      blurRadius: effectiveBlurRadius,
      savedAt: new Date().toISOString(),
    };
  }, [cropBounds, referenceImageSize, fullRangeLabel, effectiveBlurRadius]);

  const handleCreate = useCallback(async () => {
    if (!title.trim() || !selectedLabel) return;
    setCreating(true);
    setError(null);
    try {
      const safeTitle = title.trim().replace(/[\\/:*?"<>|]/g, "_");
      const fileName = `${safeTitle}.json`;
      const filePath = `${JSON_BASE_PATH}/${selectedLabel}/${fileName}`;

      // 参考スクリプト互換: 同名ラベル上書き + Scandata連動
      const addRangeToData = (data: TiffScandataFile) => {
        if (!data.presetData) {
          data.presetData = {
            workInfo: { genre: selectedGenre, label: selectedLabel, title: title.trim() },
            selectionRanges: [],
          };
        }
        if (!data.presetData.selectionRanges) {
          data.presetData.selectionRanges = [];
        }
        if (currentSelectionData) {
          // 同名ラベルを全て削除してから追加（上書き）
          data.presetData.selectionRanges = data.presetData.selectionRanges.filter(
            (r) => r.label !== currentSelectionData.label,
          );
          data.presetData.selectionRanges.push(currentSelectionData);
        }
        return data;
      };

      const fileExists = await invoke<boolean>("path_exists", { path: filePath });
      if (fileExists) {
        try {
          const content = await invoke<string>("read_text_file", { filePath });
          let existingData = JSON.parse(content) as TiffScandataFile;
          existingData = addRangeToData(existingData);
          await invoke("write_text_file", {
            filePath,
            content: JSON.stringify(existingData, null, 4),
          });

          // Scandata連動保存
          const saveDataPath =
            existingData.presetData?.saveDataPath ||
            (existingData as Record<string, unknown>).saveDataPath;
          if (saveDataPath && currentSelectionData) {
            try {
              const sdContent = await invoke<string>("read_text_file", {
                filePath: saveDataPath as string,
              });
              let sdData = JSON.parse(sdContent) as TiffScandataFile;
              sdData = addRangeToData(sdData);
              await invoke("write_text_file", {
                filePath: saveDataPath as string,
                content: JSON.stringify(sdData, null, 4),
              });
            } catch {
              /* Scandata保存エラーは無視 */
            }
          }

          useTiffStore.getState().setCropSourceJsonPath(filePath);
          setSuccess(true);
          setTimeout(() => onClose(), 1200);
        } catch {
          setError("既存ファイルへの追加に失敗しました");
        }
        setCreating(false);
        return;
      }

      // 新規作成（参考スクリプト互換構造）
      const newData: TiffScandataFile = addRangeToData({
        presetData: {
          workInfo: { genre: selectedGenre, label: selectedLabel, title: title.trim() },
          selectionRanges: [],
          createdAt: new Date().toISOString(),
        },
      });
      await invoke("write_text_file", { filePath, content: JSON.stringify(newData, null, 4) });
      useTiffStore.getState().setCropSourceJsonPath(filePath);
      setSuccess(true);
      setTimeout(() => onClose(), 1200);
    } catch {
      setError("ファイルの作成に失敗しました");
    } finally {
      setCreating(false);
    }
  }, [selectedGenre, selectedLabel, title, onClose, currentSelectionData]);

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-bg-secondary border border-border rounded-2xl shadow-xl w-96 mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-display font-bold text-text-primary flex items-center gap-2">
            <svg
              className="w-4 h-4 text-accent-warm"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            JSONに新規登録
          </h3>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition-colors"
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
        </div>

        {/* Form */}
        <div className="px-5 py-4 space-y-3">
          {/* Genre & Label */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-[10px] text-text-muted block mb-1">ジャンル</label>
              <select
                value={selectedGenre}
                onChange={(e) => setSelectedGenre(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs bg-bg-elevated border border-border/50 rounded-lg text-text-primary focus:outline-none"
              >
                {genres.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="text-[10px] text-text-muted block mb-1">レーベル</label>
              <select
                value={selectedLabel}
                onChange={(e) => setSelectedLabel(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs bg-bg-elevated border border-border/50 rounded-lg text-text-primary focus:outline-none"
              >
                {labels.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="text-[10px] text-text-muted block mb-1">作品タイトル</label>
            <input
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && title.trim()) handleCreate();
              }}
              placeholder="作品名を入力"
              autoFocus
              className="w-full px-2.5 py-2 text-xs bg-bg-elevated border border-border/50 rounded-lg text-text-primary placeholder:text-text-muted/40 focus:outline-none focus:border-accent-warm/50"
            />
          </div>

          {/* Range Label */}
          <div>
            <label className="text-[10px] text-text-muted block mb-1">範囲ラベル</label>
            <input
              type="text"
              value={rangeLabel}
              onChange={(e) => setRangeLabel(e.target.value)}
              placeholder="基本範囲"
              className="w-full px-2.5 py-2 text-xs bg-bg-elevated border border-border/50 rounded-lg text-text-primary placeholder:text-text-muted/40 focus:outline-none focus:border-accent-warm/50"
            />
            <p className="text-[9px] text-text-muted/60 mt-1 font-mono">{fullRangeLabel}</p>
          </div>

          {/* Selection range preview */}
          {currentSelectionData ? (
            <div className="px-3 py-2 bg-accent-warm/5 border border-accent-warm/20 rounded-lg">
              <p className="text-[9px] text-accent-warm mb-1">保存する選択範囲</p>
              <p className="text-[10px] text-text-secondary font-mono">
                ({currentSelectionData.bounds.left}, {currentSelectionData.bounds.top}) → (
                {currentSelectionData.bounds.right}, {currentSelectionData.bounds.bottom})
              </p>
              <p className="text-[9px] text-text-muted mt-0.5">
                {currentSelectionData.size.width} x {currentSelectionData.size.height} / doc:{" "}
                {currentSelectionData.documentSize.width} x{" "}
                {currentSelectionData.documentSize.height}
              </p>
            </div>
          ) : (
            <div className="px-3 py-2 bg-error/5 border border-error/20 rounded-lg">
              <p className="text-[10px] text-error">選択範囲が設定されていません</p>
            </div>
          )}

          {/* File path preview */}
          {title.trim() && selectedLabel && (
            <div className="px-3 py-2 bg-bg-tertiary rounded-lg">
              <p className="text-[9px] text-text-muted mb-0.5">保存先</p>
              <p className="text-[10px] text-text-secondary font-mono break-all">
                .../{selectedLabel}/{title.trim().replace(/[\\/:*?"<>|]/g, "_")}.json
              </p>
            </div>
          )}

          {error && (
            <div className="px-3 py-2 rounded-lg bg-error/10 text-[10px] text-error">{error}</div>
          )}

          {success && (
            <div className="px-3 py-2 rounded-lg bg-success/10 text-[10px] text-success flex items-center gap-1.5">
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              作成しました
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 px-3 py-2 text-xs font-medium text-text-secondary bg-bg-tertiary rounded-xl hover:bg-bg-tertiary/80 transition-colors"
          >
            キャンセル
          </button>
          <button
            onClick={handleCreate}
            disabled={!title.trim() || !selectedLabel || creating || success}
            className="flex-1 px-3 py-2 text-xs font-medium text-white bg-gradient-to-r from-accent-warm to-accent rounded-xl hover:-translate-y-0.5 transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {creating ? "作成中..." : "作成"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ============================================================
// Unlock Dialog
// ============================================================
