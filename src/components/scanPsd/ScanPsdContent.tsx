import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useScanPsdStore } from "../../store/scanPsdStore";
import { useScanPsdProcessor } from "../../hooks/useScanPsdProcessor";
import { JsonFileBrowser } from "./JsonFileBrowser";

export function ScanPsdContent() {
  const mode = useScanPsdStore((s) => s.mode);
  const phase = useScanPsdStore((s) => s.phase);
  const folders = useScanPsdStore((s) => s.folders);
  const addFolder = useScanPsdStore((s) => s.addFolder);
  const removeFolder = useScanPsdStore((s) => s.removeFolder);
  const updateFolderVolume = useScanPsdStore((s) => s.updateFolderVolume);
  const scanData = useScanPsdStore((s) => s.scanData);
  const progress = useScanPsdStore((s) => s.progress);

  const workInfo = useScanPsdStore((s) => s.workInfo);
  const currentJsonFilePath = useScanPsdStore((s) => s.currentJsonFilePath);
  const jsonFolderPath = useScanPsdStore((s) => s.jsonFolderPath);
  const setMode = useScanPsdStore((s) => s.setMode);

  const { startScan, loadPresetJson } = useScanPsdProcessor();

  const [startVolume, setStartVolume] = useState(1);

  // 個別フォルダ追加
  const handleAddFolder = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected && typeof selected === "string") {
      const name = selected.split(/[\\/]/).pop() || selected;
      // 既に追加済みの最大巻数の次を自動設定
      const maxVol =
        folders.length > 0 ? Math.max(...folders.map((f) => f.volume)) : startVolume - 1;
      addFolder(selected, name, maxVol + 1);
    }
  };

  // サブフォルダ一括追加
  const handleAddSubfolders = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (!selected || typeof selected !== "string") return;

    try {
      const result = await invoke<{ mode: string; folders: { path: string; name: string }[] }>(
        "detect_psd_folders",
        { folderPath: selected },
      );

      if (result.folders.length === 0) return;

      // 既に追加済みの最大巻数の次から連番
      const maxVol =
        folders.length > 0 ? Math.max(...folders.map((f) => f.volume)) : startVolume - 1;
      const existingPaths = new Set(folders.map((f) => f.path));

      let addedCount = 0;
      for (const folder of result.folders) {
        const normalized = folder.path.replace(/\\/g, "/");
        if (!existingPaths.has(normalized) && !existingPaths.has(folder.path)) {
          addFolder(folder.path, folder.name, maxVol + 1 + addedCount);
          addedCount++;
        }
      }
    } catch (e) {
      console.error("Failed to detect PSD folders:", e);
    }
  };

  // --- スキャン中 ---
  if (phase === "scanning") {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center space-y-6 max-w-sm">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-accent/10 flex items-center justify-center">
            <svg
              className="w-8 h-8 text-accent animate-spin"
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
          </div>
          <div>
            <h3 className="text-sm font-bold text-text-primary">スキャン中...</h3>
            <p className="text-xs text-text-muted mt-1">{progress.message || "準備中"}</p>
          </div>
          {progress.total > 0 && (
            <div className="space-y-2">
              <div className="h-2 bg-bg-tertiary rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-accent to-accent-secondary rounded-full transition-all duration-300"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                />
              </div>
              <p className="text-[10px] text-text-muted">
                {progress.current} / {progress.total} ファイル
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // --- editモードでJSON読み込み完了 ---
  if (mode === "edit" && currentJsonFilePath && !scanData) {
    const fileName = currentJsonFilePath.split(/[\\/]/).pop() || currentJsonFilePath;
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center space-y-4 max-w-sm">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-success/10 flex items-center justify-center">
            <svg
              className="w-7 h-7 text-success"
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
          </div>
          <div>
            <h3 className="text-sm font-bold text-text-primary">JSON読み込み完了</h3>
            <p className="text-[10px] text-text-muted mt-1 break-all">{fileName}</p>
          </div>
          <p className="text-[10px] text-text-muted">
            左パネルの各タブでデータを確認・編集できます
          </p>
        </div>
      </div>
    );
  }

  // --- スキャン完了後: サマリー ---
  if (scanData) {
    return (
      <div className="h-full overflow-auto p-6">
        <div className="max-w-lg mx-auto space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center">
              <svg
                className="w-5 h-5 text-success"
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
            </div>
            <div>
              <h3 className="text-sm font-bold text-text-primary">スキャン完了</h3>
              <p className="text-[10px] text-text-muted">
                {scanData.processedFiles ?? 0} ファイルを処理
              </p>
            </div>
          </div>

          {/* 統計カード */}
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="フォント数" value={scanData.fonts?.length ?? 0} />
            <StatCard label="ガイドセット" value={scanData.guideSets?.length ?? 0} />
            <StatCard
              label="ベースサイズ"
              value={
                scanData.sizeStats?.mostFrequent ? `${scanData.sizeStats.mostFrequent.size}pt` : "-"
              }
            />
            <StatCard label="ストロークサイズ" value={scanData.strokeStats?.sizes?.length ?? 0} />
          </div>

          {/* スキャン済みフォルダ */}
          {scanData.scannedFolders && Object.keys(scanData.scannedFolders).length > 0 && (
            <div className="bg-bg-secondary rounded-xl p-4 space-y-2">
              <h4 className="text-xs font-bold text-text-primary">スキャン済みフォルダ</h4>
              {Object.entries(scanData.scannedFolders).map(([path, info]) => (
                <div key={path} className="flex items-center justify-between text-[10px]">
                  <span className="text-text-secondary truncate flex-1 mr-2">
                    {path.split(/[\\/]/).pop()}
                  </span>
                  <span className="text-text-muted flex-shrink-0">
                    {info.files.length} ファイル
                  </span>
                </div>
              ))}
            </div>
          )}

          <p className="text-[10px] text-text-muted text-center">
            左パネルの各タブでデータを確認・編集できます
          </p>
        </div>
      </div>
    );
  }

  // --- 新規: フォルダ選択 ---
  if (mode === "new") {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="max-w-md w-full space-y-6 px-6">
          <div className="text-center space-y-2">
            <h3 className="text-sm font-bold text-text-primary">スキャンするフォルダを選択</h3>
            <p className="text-[10px] text-text-muted">
              PSDファイルが含まれるフォルダを追加してください
            </p>
          </div>

          {/* 開始巻数 */}
          <div className="flex items-center gap-2 justify-center">
            <span className="text-xs text-text-secondary">開始巻:</span>
            <select
              value={startVolume}
              onChange={(e) => setStartVolume(Number(e.target.value))}
              className="bg-bg-secondary border border-border rounded-lg px-2 py-1 text-xs text-text-primary"
            >
              {Array.from({ length: 50 }, (_, i) => i + 1).map((v) => (
                <option key={v} value={v}>
                  {v}巻
                </option>
              ))}
            </select>
          </div>

          {/* フォルダリスト */}
          {folders.length > 0 && (
            <div className="bg-bg-secondary rounded-xl p-3 space-y-2">
              {folders.map((f, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 bg-bg-tertiary rounded-lg px-3 py-2"
                >
                  <svg
                    className="w-4 h-4 text-text-muted flex-shrink-0"
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
                  <span className="text-xs text-text-primary flex-1 truncate">{f.name}</span>
                  <select
                    value={f.volume}
                    onChange={(e) => updateFolderVolume(i, Number(e.target.value))}
                    className="bg-bg-elevated border border-white/10 rounded px-1.5 py-0.5 text-[10px] text-text-primary"
                  >
                    {Array.from({ length: 50 }, (_, j) => j + 1).map((v) => (
                      <option key={v} value={v}>
                        {v}巻
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => removeFolder(i)}
                    className="text-text-muted hover:text-error transition-colors"
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
              ))}
            </div>
          )}

          {/* 追加ボタン */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={handleAddFolder}
              className="py-3 border-2 border-dashed border-border rounded-xl text-xs text-text-muted
                hover:border-accent/50 hover:text-accent transition-colors"
            >
              <svg
                className="w-4 h-4 mx-auto mb-1 opacity-60"
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
              フォルダを個別追加
            </button>
            <button
              onClick={handleAddSubfolders}
              className="py-3 border-2 border-dashed border-border rounded-xl text-xs text-text-muted
                hover:border-accent/50 hover:text-accent transition-colors"
            >
              <svg
                className="w-4 h-4 mx-auto mb-1 opacity-60"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                />
              </svg>
              サブフォルダ一括追加
            </button>
          </div>

          {/* スキャン実行ボタン */}
          {folders.length > 0 && (
            <>
              {(!workInfo.label || !workInfo.title) && (
                <p className="text-[10px] text-warning text-center">
                  スキャンを開始するには、左パネルの作品情報タブでレーベルとタイトルを入力してください
                </p>
              )}
              <button
                onClick={startScan}
                disabled={!workInfo.label || !workInfo.title}
                className="w-full py-3 text-sm font-medium text-white bg-gradient-to-r from-accent to-accent-secondary
                  rounded-xl hover:-translate-y-0.5 transition-all shadow-md
                  disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
              >
                スキャン開始
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // --- edit: インラインJSONファイルブラウザ ---
  return (
    <div className="h-full flex flex-col p-6">
      <div className="text-center mb-4">
        <h3 className="text-sm font-bold text-text-primary">プリセットJSONを選択</h3>
        <p className="text-[10px] text-text-muted mt-1">
          JSONフォルダ内のファイルを選択してください
        </p>
      </div>
      <div className="flex-1 min-h-0 max-w-lg mx-auto w-full">
        <JsonFileBrowser
          basePath={jsonFolderPath}
          mode="open"
          onSelect={async (filePath) => {
            try {
              await loadPresetJson(filePath);
            } catch (e) {
              console.error(e);
            }
          }}
          onCancel={() => setMode(null)}
        />
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-bg-secondary rounded-xl p-3">
      <p className="text-[10px] text-text-muted">{label}</p>
      <p className="text-lg font-bold text-text-primary mt-0.5">{value}</p>
    </div>
  );
}
