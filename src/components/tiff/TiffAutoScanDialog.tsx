import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTiffStore } from "../../store/tiffStore";
import { useScanPsdStore } from "../../store/scanPsdStore";
import { performLoadPresetJson } from "../../hooks/useScanPsdProcessor";
import { GENRE_LABELS, JSON_BASE_PATH } from "../../types/tiff";

interface TiffAutoScanDialogProps {
  mode: "selected" | "all";
  fileCount: number;
  onExecute: () => void;
  onClose: () => void;
}

/** cropSourceJsonPathからレーベル・タイトルを推測する */
function inferFromJsonPath(jsonPath: string): { label: string; title: string } | null {
  // パス例: G:/.../JSONフォルダ/コイパレ/作品名.json
  const normalized = jsonPath.replace(/\\/g, "/");
  const match = normalized.match(/\/([^/]+)\/([^/]+)\.json$/);
  if (!match) return null;
  return { label: match[1], title: match[2] };
}

export function TiffAutoScanDialog({
  mode,
  fileCount,
  onExecute,
  onClose,
}: TiffAutoScanDialogProps) {
  const cropSourceJsonPath = useTiffStore((s) => s.cropSourceJsonPath);
  const cropBounds = useTiffStore((s) => s.settings.crop.bounds);
  const scanWorkInfo = useScanPsdStore((s) => s.workInfo);

  // --- 状態 ---
  const [jsonEnabled, setJsonEnabled] = useState(true);
  const [label, setLabel] = useState("");
  const [title, setTitle] = useState("");
  const [volumeStr, setVolumeStr] = useState(String(useTiffStore.getState().autoScanVolume || 1));
  const volume = parseInt(volumeStr) || 1;
  const [registerRange, setRegisterRange] = useState(!!cropBounds && !cropSourceJsonPath);
  const [titleSource, setTitleSource] = useState<"auto" | "existing" | "new">("auto");

  // 既存タイトル一覧
  const [titles, setTitles] = useState<string[]>([]);
  const [loadingTitles, setLoadingTitles] = useState(false);

  // 検索
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<
    { label: string; title: string; path: string }[]
  >([]);

  // JSON読み込み状態
  const [jsonLoading, setJsonLoading] = useState(false);
  const [jsonLoaded, setJsonLoaded] = useState(false);

  // --- 初期値の推測 ---
  useEffect(() => {
    // 1. cropSourceJsonPathから推測
    if (cropSourceJsonPath) {
      const inferred = inferFromJsonPath(cropSourceJsonPath);
      if (inferred) {
        setLabel(inferred.label);
        setTitle(inferred.title);
        setTitleSource("auto");
        setJsonLoaded(true);
        return;
      }
    }
    // 2. scanPsdStoreのworkInfoから
    if (scanWorkInfo.label && scanWorkInfo.title) {
      setLabel(scanWorkInfo.label);
      setTitle(scanWorkInfo.title);
      setTitleSource("auto");
      setJsonLoaded(true);
      return;
    }
    // 3. どちらもなければ手動選択
    setTitleSource("new");
  }, []);

  // --- レーベル変更時にタイトル一覧を取得 ---
  useEffect(() => {
    if (!label || titleSource === "auto") return;
    setLoadingTitles(true);
    setTitles([]);
    const folderPath = `${JSON_BASE_PATH}/${label}`;
    invoke<{ folders: string[]; json_files: string[] }>("list_folder_contents", { folderPath })
      .then((contents) => {
        setTitles(contents.json_files.map((f) => f.replace(/\.json$/, "")));
      })
      .catch(() => setTitles([]))
      .finally(() => setLoadingTitles(false));
  }, [label, titleSource]);

  // --- タイトル検索 ---
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
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

  // --- 既存JSON読み込み ---
  const loadExistingJson = useCallback(async (targetLabel: string, targetTitle: string) => {
    const jsonPath = `${JSON_BASE_PATH}/${targetLabel}/${targetTitle}.json`;
    setJsonLoading(true);
    try {
      await performLoadPresetJson(jsonPath);
      setJsonLoaded(true);
    } catch {
      // JSONが存在しない場合は新規作成扱い
      setJsonLoaded(false);
    } finally {
      setJsonLoading(false);
    }
  }, []);

  // --- 実行 ---
  const handleExecute = useCallback(async () => {
    if (jsonEnabled && label && title) {
      // scanPsdStore に workInfo を設定
      useScanPsdStore.getState().setWorkInfo({ label, title, volume });

      // 既存JSONが読み込まれていない場合、読み込みを試行
      if (!jsonLoaded) {
        try {
          await loadExistingJson(label, title);
        } catch {
          // 新規作成扱い
        }
      }

      // tiffStore に自動スキャン設定
      const tiffState = useTiffStore.getState();
      tiffState.setAutoScanEnabled(true);
      tiffState.setAutoScanVolume(volume);
      tiffState.setRegisterSelectionRange(registerRange);
    } else {
      useTiffStore.getState().setAutoScanEnabled(false);
    }

    onClose();
    onExecute();
  }, [
    jsonEnabled,
    label,
    title,
    volume,
    registerRange,
    jsonLoaded,
    loadExistingJson,
    onExecute,
    onClose,
  ]);

  // --- 検索結果から選択 ---
  const selectSearchResult = useCallback(
    (result: { label: string; title: string }) => {
      setLabel(result.label);
      setTitle(result.title);
      setTitleSource("existing");
      setSearchQuery("");
      setSearchResults([]);
      loadExistingJson(result.label, result.title);
    },
    [loadExistingJson],
  );

  const isReady = !jsonEnabled || (!!label && !!title);
  const outputSummary = useTiffStore.getState().settings;
  const formatLabel =
    outputSummary.output.proceedAsTiff && outputSummary.output.outputJpg
      ? "TIFF + JPG"
      : outputSummary.output.proceedAsTiff
        ? "TIFF (LZW)"
        : outputSummary.output.outputJpg
          ? "JPG"
          : "PSD";
  const colorLabel =
    outputSummary.colorMode === "mono"
      ? "モノクロ"
      : outputSummary.colorMode === "color"
        ? "カラー"
        : outputSummary.colorMode === "perPage"
          ? "個別"
          : "変更なし";

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="bg-bg-secondary rounded-2xl shadow-2xl w-[420px] max-h-[85vh] flex flex-col border border-border/50 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/50">
          <h3 className="text-sm font-bold text-text-primary">TIFF化 実行確認</h3>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-bg-tertiary transition-colors"
          >
            <svg
              className="w-4 h-4 text-text-muted"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto px-5 py-4 space-y-4">
          {/* 対象ファイル情報 */}
          <div className="flex items-center gap-3 text-xs text-text-secondary">
            <span className="bg-accent-warm/10 text-accent-warm px-2.5 py-1 rounded-full font-medium">
              {mode === "selected" ? `${fileCount}件 選択` : `${fileCount}件 全て`}
            </span>
            <span>
              {formatLabel} / {colorLabel}
            </span>
          </div>

          {/* JSON登録トグル */}
          <div className="bg-bg-tertiary rounded-xl p-3 space-y-3">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={jsonEnabled}
                onChange={(e) => setJsonEnabled(e.target.checked)}
                className="rounded accent-accent-secondary w-4 h-4"
              />
              <div>
                <span className="text-xs font-medium text-text-primary">
                  プリセットJSON同時登録
                </span>
                <p className="text-[10px] text-text-muted">Photoshop不要 / ag-psdで高速スキャン</p>
              </div>
            </label>

            {jsonEnabled && (
              <div className="space-y-3 pt-1 border-t border-border/30">
                {/* 自動検出された場合 */}
                {titleSource === "auto" && label && title ? (
                  <div className="space-y-2">
                    <div className="bg-accent-secondary/8 border border-accent-secondary/20 rounded-lg px-3 py-2">
                      <div className="flex items-center gap-2">
                        <svg
                          className="w-3.5 h-3.5 text-accent-secondary flex-shrink-0"
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
                        <div className="min-w-0">
                          <p className="text-[11px] text-accent-secondary font-medium truncate">
                            {label} / {title}
                          </p>
                          <p className="text-[9px] text-text-muted">
                            {cropSourceJsonPath
                              ? "選択範囲JSONから検出"
                              : "Scan PSDタブの設定から検出"}
                          </p>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => setTitleSource("existing")}
                      className="text-[10px] text-text-muted hover:text-accent-secondary transition-colors"
                    >
                      別の作品を選択...
                    </button>
                  </div>
                ) : (
                  /* 手動選択モード */
                  <div className="space-y-2.5">
                    {/* 検索 */}
                    <div className="relative">
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="タイトルで検索..."
                        className="w-full px-3 py-1.5 text-xs bg-bg-elevated border border-border/50 rounded-lg text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent-secondary/50"
                      />
                      {searchResults.length > 0 && (
                        <div className="absolute z-10 top-full mt-1 w-full bg-bg-secondary border border-border/50 rounded-lg shadow-lg max-h-40 overflow-auto">
                          {searchResults.map((r, i) => (
                            <button
                              key={i}
                              onClick={() => selectSearchResult(r)}
                              className="w-full text-left px-3 py-2 hover:bg-accent-secondary/8 transition-colors border-b border-border/20 last:border-0"
                            >
                              <span className="text-[10px] text-text-muted">{r.label}</span>
                              <span className="text-xs text-text-primary ml-1.5">{r.title}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* レーベル選択 */}
                    <div>
                      <label className="text-[10px] text-text-muted block mb-1">レーベル</label>
                      <select
                        value={label}
                        onChange={(e) => {
                          setLabel(e.target.value);
                          setTitle("");
                          setTitleSource("existing");
                          setJsonLoaded(false);
                        }}
                        className="w-full px-3 py-1.5 text-xs bg-bg-elevated border border-border/50 rounded-lg text-text-primary focus:outline-none focus:border-accent-secondary/50"
                      >
                        <option value="">選択してください</option>
                        {Object.entries(GENRE_LABELS).map(([genre, labels]) => (
                          <optgroup key={genre} label={genre}>
                            {labels.map((l) => (
                              <option key={l} value={l}>
                                {l}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </div>

                    {/* タイトル選択/入力 */}
                    {label && (
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-[10px] text-text-muted">タイトル</label>
                          <div className="flex gap-1">
                            <button
                              onClick={() => setTitleSource("existing")}
                              className={`text-[9px] px-1.5 py-0.5 rounded ${titleSource === "existing" ? "bg-accent-secondary/15 text-accent-secondary" : "text-text-muted hover:text-text-secondary"}`}
                            >
                              既存
                            </button>
                            <button
                              onClick={() => {
                                setTitleSource("new");
                                setTitle("");
                                setJsonLoaded(false);
                              }}
                              className={`text-[9px] px-1.5 py-0.5 rounded ${titleSource === "new" ? "bg-accent-secondary/15 text-accent-secondary" : "text-text-muted hover:text-text-secondary"}`}
                            >
                              新規
                            </button>
                          </div>
                        </div>

                        {titleSource === "existing" ? (
                          loadingTitles ? (
                            <div className="text-[10px] text-text-muted py-2">読み込み中...</div>
                          ) : titles.length > 0 ? (
                            <select
                              value={title}
                              onChange={(e) => {
                                setTitle(e.target.value);
                                if (e.target.value) {
                                  loadExistingJson(label, e.target.value);
                                }
                              }}
                              className="w-full px-3 py-1.5 text-xs bg-bg-elevated border border-border/50 rounded-lg text-text-primary focus:outline-none focus:border-accent-secondary/50"
                            >
                              <option value="">選択してください</option>
                              {titles.map((t) => (
                                <option key={t} value={t}>
                                  {t}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <div className="text-[10px] text-text-muted py-2">
                              JSONファイルがありません
                              <button
                                onClick={() => {
                                  setTitleSource("new");
                                  setTitle("");
                                }}
                                className="ml-2 text-accent-secondary hover:underline"
                              >
                                新規作成
                              </button>
                            </div>
                          )
                        ) : (
                          <input
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="作品タイトルを入力"
                            className="w-full px-3 py-1.5 text-xs bg-bg-elevated border border-border/50 rounded-lg text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent-secondary/50"
                          />
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* 巻数 */}
                <div className="flex items-center gap-2">
                  <label className="text-xs text-text-secondary">巻数:</label>
                  <input
                    type="number"
                    min="1"
                    max="999"
                    value={volumeStr}
                    onChange={(e) => setVolumeStr(e.target.value.replace(/[^0-9]/g, ""))}
                    className="w-16 px-2 py-1.5 text-xs bg-bg-elevated border border-border/50 rounded-lg text-text-primary focus:outline-none focus:border-accent-secondary/50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span className="text-xs text-text-muted">巻</span>
                </div>

                {/* 選択範囲登録 */}
                {cropBounds && (
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={registerRange}
                      onChange={(e) => setRegisterRange(e.target.checked)}
                      className="rounded accent-accent-secondary"
                    />
                    <div>
                      <span className="text-[11px] text-text-primary">選択範囲もJSONに登録</span>
                      <p className="text-[9px] text-text-muted">
                        {cropBounds.right - cropBounds.left} x {cropBounds.bottom - cropBounds.top}{" "}
                        px
                      </p>
                    </div>
                  </label>
                )}

                {/* JSON読み込み状態 */}
                {jsonLoading && (
                  <div className="flex items-center gap-2 text-[10px] text-text-muted">
                    <div className="w-3 h-3 rounded-full border-2 border-accent-secondary/30 border-t-accent-secondary animate-spin" />
                    JSON読み込み中...
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border/50 flex items-center gap-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 text-xs font-medium rounded-xl bg-bg-tertiary text-text-secondary border border-border/50 hover:bg-bg-elevated transition-colors"
          >
            キャンセル
          </button>
          <button
            onClick={handleExecute}
            disabled={!isReady || jsonLoading}
            className="flex-1 px-4 py-2.5 text-xs font-medium rounded-xl text-white bg-gradient-to-r from-accent-warm to-accent shadow-[0_3px_12px_rgba(255,177,66,0.25)] hover:shadow-[0_5px_16px_rgba(255,177,66,0.35)] hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none"
          >
            {jsonEnabled ? "JSON登録して実行" : "実行"}
          </button>
        </div>
      </div>
    </div>
  );
}
