import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePsdStore } from "../../store/psdStore";
import { useScanPsdStore } from "../../store/scanPsdStore";
import {
  performLoadPresetJson,
  performPresetJsonSave,
  performExportTextLog,
} from "../../hooks/useScanPsdProcessor";
import { buildScanDataFromFiles, mergeScanData } from "../../lib/agPsdScanner";
import { getAutoSubName } from "../../types/scanPsd";
import { GENRE_LABELS, JSON_BASE_PATH } from "../../types/tiff";
import type { LayerNode } from "../../types";
import type { FontResolveInfo } from "../../hooks/useFontResolver";

interface SpecScanJsonDialogProps {
  onClose: () => void;
}

export function SpecScanJsonDialog({ onClose }: SpecScanJsonDialogProps) {
  const [label, setLabel] = useState("");
  const [title, setTitle] = useState("");
  const [volumeStr, setVolumeStr] = useState("1");
  const volume = parseInt(volumeStr) || 1;
  const [titleSource, setTitleSource] = useState<"existing" | "new">("new");

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

  // スキャン実行状態
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{ success: boolean; message: string } | null>(null);

  // --- レーベル変更時にタイトル一覧を取得 ---
  useEffect(() => {
    if (!label) return;
    setLoadingTitles(true);
    setTitles([]);
    const folderPath = `${JSON_BASE_PATH}/${label}`;
    invoke<{ folders: string[]; json_files: string[] }>("list_folder_contents", { folderPath })
      .then((contents) => {
        setTitles(contents.json_files.map((f) => f.replace(/\.json$/, "")));
      })
      .catch(() => setTitles([]))
      .finally(() => setLoadingTitles(false));
  }, [label]);

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
      setJsonLoaded(false);
    } finally {
      setJsonLoading(false);
    }
  }, []);

  // --- ag-psdスキャン実行（Photoshop不要） ---
  const handleExecute = useCallback(async () => {
    if (!label || !title) return;
    setScanning(true);
    setScanResult(null);

    // ストアの現在状態を退避（Scan PSDタブに影響させない）
    const prevState = useScanPsdStore.getState();
    const savedSnapshot = {
      scanData: prevState.scanData,
      workInfo: { ...prevState.workInfo },
      presetSets: { ...prevState.presetSets },
      currentSetName: prevState.currentSetName,
      selectedGuideIndex: prevState.selectedGuideIndex,
      excludedGuideIndices: new Set(prevState.excludedGuideIndices),
      currentJsonFilePath: prevState.currentJsonFilePath,
      currentScandataFilePath: prevState.currentScandataFilePath,
    };

    try {
      // 1. workInfo設定
      useScanPsdStore.getState().setWorkInfo({ label, title, volume });

      // 2. 既存JSON読み込み（未読み込みの場合）
      if (!jsonLoaded) {
        try {
          await loadExistingJson(label, title);
        } catch {
          // 新規作成扱い
        }
      }

      // 3. フォント名解決
      const allFiles = usePsdStore.getState().files;
      const postScriptNames = new Set<string>();
      for (const file of allFiles) {
        if (!file.metadata?.layerTree) continue;
        const collect = (layers: LayerNode[]) => {
          for (const l of layers) {
            if (l.type === "text" && l.textInfo) {
              for (const f of l.textInfo.fonts) postScriptNames.add(f);
            }
            if (l.children) collect(l.children);
          }
        };
        collect(file.metadata.layerTree);
      }

      const fontResolveMap =
        postScriptNames.size > 0
          ? await invoke<Record<string, FontResolveInfo>>("resolve_font_names", {
              postscriptNames: [...postScriptNames],
            })
          : {};

      // 4. ScanData構築（ag-psdベース、Photoshop不要）
      const scanPsdState = useScanPsdStore.getState();
      const existingScanData = scanPsdState.scanData;
      let scanData = buildScanDataFromFiles(allFiles, {
        fontResolveMap,
        volume,
        existingWorkInfo: scanPsdState.workInfo.title ? scanPsdState.workInfo : undefined,
      });

      // 既存JSONから読み込んだscanDataがあれば蓄積マージ（フォント・サイズ等を累積）
      if (existingScanData) {
        scanData = mergeScanData(existingScanData, scanData);
      }

      // 5. scanPsdStore にデータ反映
      scanPsdState.setScanData(scanData);
      scanPsdState.setWorkInfo({ volume });

      // 6. フォント自動登録
      const { presetSets, currentSetName } = useScanPsdStore.getState();
      const registeredFonts = new Set<string>();
      for (const list of Object.values(presetSets)) {
        for (const p of list) registeredFonts.add(p.font);
      }
      const unregistered = scanData.fonts.filter((f) => !registeredFonts.has(f.name));
      if (unregistered.length > 0) {
        const targetSet = currentSetName || "デフォルト";
        for (const f of unregistered) {
          useScanPsdStore.getState().addFontToPreset(targetSet, {
            name: f.displayName || f.name,
            subName: getAutoSubName(f.name),
            font: f.name,
            description: `使用回数: ${f.count}`,
          });
        }
      }

      // 7. ガイド自動選択
      if (scanData.guideSets.length > 0 && scanPsdState.selectedGuideIndex == null) {
        const indexed = scanData.guideSets.map((gs, i) => {
          const centerX = gs.docWidth / 2;
          const centerY = gs.docHeight / 2;
          let hasAbove = false,
            hasBelow = false,
            hasLeft = false,
            hasRight = false;
          for (const h of gs.horizontal) {
            if (Math.abs(h - centerY) <= 1) continue;
            if (h < centerY) hasAbove = true;
            else hasBelow = true;
          }
          for (const v of gs.vertical) {
            if (Math.abs(v - centerX) <= 1) continue;
            if (v < centerX) hasLeft = true;
            else hasRight = true;
          }
          const valid = hasAbove && hasBelow && hasLeft && hasRight;
          return { i, valid, count: gs.count };
        });
        indexed.sort((a, b) => {
          if (a.valid !== b.valid) return (b.valid ? 1 : 0) - (a.valid ? 1 : 0);
          return b.count - a.count;
        });
        useScanPsdStore.getState().setSelectedGuideIndex(indexed[0].i);
      }

      // 8. プリセットJSON保存 + テキストログ出力
      await performPresetJsonSave();

      const { textLogFolderPath } = useScanPsdStore.getState();
      let textLogSaved = false;
      if (textLogFolderPath) {
        try {
          await performExportTextLog();
          textLogSaved = true;
        } catch {
          // テキストログ失敗はJSON成功に影響させない
        }
      }

      const savedPath = useScanPsdStore.getState().currentJsonFilePath;
      setScanResult({
        success: true,
        message: `JSON保存完了（${scanData.fonts.length}フォント, ${scanData.guideSets.length}ガイドセット）${textLogSaved ? " + テキストログ出力" : ""}${savedPath ? `\n${savedPath.split(/[\\/]/).pop()}` : ""}`,
      });
    } catch (e) {
      setScanResult({
        success: false,
        message: `エラー: ${e instanceof Error ? e.message : String(e)}`,
      });
    } finally {
      setScanning(false);
      // ストア状態を復元（Scan PSDタブの作業を壊さない）
      const s = useScanPsdStore.getState();
      s.setScanData(savedSnapshot.scanData);
      s.setWorkInfo(savedSnapshot.workInfo);
      s.setPresetSets(savedSnapshot.presetSets);
      s.setCurrentSetName(savedSnapshot.currentSetName);
      s.setSelectedGuideIndex(savedSnapshot.selectedGuideIndex);
      s.setExcludedGuideIndices(savedSnapshot.excludedGuideIndices);
      s.setCurrentJsonFilePath(savedSnapshot.currentJsonFilePath);
      s.setCurrentScandataFilePath(savedSnapshot.currentScandataFilePath);
    }
  }, [label, title, volume, jsonLoaded, loadExistingJson]);

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

  const isReady = !!label && !!title && !scanning;
  const fileCount = usePsdStore.getState().files.length;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[10vh] bg-black/40"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="bg-bg-secondary rounded-2xl shadow-2xl w-[400px] max-h-[80vh] flex flex-col border border-border/50 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/50">
          <h3 className="text-sm font-bold text-text-primary">JSON登録</h3>
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
          <div className="text-xs text-text-secondary">
            <span className="bg-accent/10 text-accent px-2.5 py-1 rounded-full font-medium">
              {fileCount}件のPSDファイル
            </span>
          </div>

          {/* モードタブ */}
          <div className="bg-bg-tertiary rounded-xl overflow-hidden">
            <div className="flex border-b border-border/30">
              <button
                onClick={() => {
                  setTitleSource("new");
                  setTitle("");
                  setJsonLoaded(false);
                  setSearchQuery("");
                }}
                className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                  titleSource === "new"
                    ? "text-accent-tertiary border-b-2 border-accent-tertiary bg-accent-tertiary/5"
                    : "text-text-muted hover:text-text-secondary"
                }`}
              >
                新規作成
              </button>
              <button
                onClick={() => {
                  setTitleSource("existing");
                  setTitle("");
                  setJsonLoaded(false);
                }}
                className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                  titleSource === "existing"
                    ? "text-accent-secondary border-b-2 border-accent-secondary bg-accent-secondary/5"
                    : "text-text-muted hover:text-text-secondary"
                }`}
              >
                既存を更新
              </button>
            </div>

            <div className="p-3 space-y-2.5">
              {titleSource === "new" ? (
                <>
                  {/* 新規: レーベル選択 */}
                  <div>
                    <label className="text-[10px] text-text-muted block mb-1">レーベル</label>
                    <select
                      value={label}
                      onChange={(e) => {
                        setLabel(e.target.value);
                        setTitle("");
                      }}
                      className="w-full px-3 py-1.5 text-xs bg-bg-elevated border border-border/50 rounded-lg text-text-primary focus:outline-none focus:border-accent-tertiary/50"
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

                  {/* 新規: タイトル入力 */}
                  <div>
                    <label className="text-[10px] text-text-muted block mb-1">タイトル</label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="作品タイトルを入力"
                      className="w-full px-3 py-1.5 text-xs bg-bg-elevated border border-border/50 rounded-lg text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent-tertiary/50"
                    />
                  </div>
                </>
              ) : (
                <>
                  {/* 既存: 検索 */}
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

                  {/* 既存: レーベル選択 */}
                  <div>
                    <label className="text-[10px] text-text-muted block mb-1">レーベル</label>
                    <select
                      value={label}
                      onChange={(e) => {
                        setLabel(e.target.value);
                        setTitle("");
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

                  {/* 既存: タイトル選択 */}
                  {label && (
                    <div>
                      <label className="text-[10px] text-text-muted block mb-1">タイトル</label>
                      {loadingTitles ? (
                        <div className="text-[10px] text-text-muted py-2">読み込み中...</div>
                      ) : titles.length > 0 ? (
                        <select
                          value={title}
                          onChange={(e) => {
                            setTitle(e.target.value);
                            if (e.target.value) loadExistingJson(label, e.target.value);
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
                          このレーベルにJSONファイルがありません
                        </div>
                      )}
                    </div>
                  )}

                  {/* JSON読み込み済みバッジ */}
                  {jsonLoaded && (
                    <div className="flex items-center gap-1.5 text-[10px] text-success">
                      <svg
                        className="w-3 h-3"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      既存JSONを読み込み済み
                    </div>
                  )}
                </>
              )}

              {/* 巻数（共通） */}
              <div className="flex items-center gap-2 pt-1">
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

              {/* JSON読み込み状態 */}
              {jsonLoading && (
                <div className="flex items-center gap-2 text-[10px] text-text-muted">
                  <div className="w-3 h-3 rounded-full border-2 border-accent-secondary/30 border-t-accent-secondary animate-spin" />
                  JSON読み込み中...
                </div>
              )}
            </div>
          </div>

          {/* スキャン結果 */}
          {scanResult && (
            <div
              className={`rounded-xl px-3 py-2 text-xs ${
                scanResult.success
                  ? "bg-success/8 border border-success/20 text-success"
                  : "bg-error/8 border border-error/20 text-error"
              }`}
            >
              <pre className="whitespace-pre-wrap font-sans">{scanResult.message}</pre>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border/50 flex items-center gap-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 text-xs font-medium rounded-xl bg-bg-tertiary text-text-secondary border border-border/50 hover:bg-bg-elevated transition-colors"
          >
            {scanResult?.success ? "閉じる" : "キャンセル"}
          </button>
          <button
            onClick={handleExecute}
            disabled={!isReady || jsonLoading}
            className="flex-1 px-4 py-2.5 text-xs font-medium rounded-xl text-white bg-gradient-to-r from-accent-secondary to-[#5a3fd6] shadow-[0_3px_12px_rgba(124,92,255,0.25)] hover:shadow-[0_5px_16px_rgba(124,92,255,0.35)] hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none"
          >
            {scanning ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                スキャン中...
              </span>
            ) : (
              "スキャン実行"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
