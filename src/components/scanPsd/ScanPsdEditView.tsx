import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useScanPsdStore } from "../../store/scanPsdStore";
import { useScanPsdProcessor } from "../../hooks/useScanPsdProcessor";
import type { ScanResult } from "../../hooks/useScanPsdProcessor";
import { WorkInfoTab } from "./tabs/WorkInfoTab";
import { FontTypesTab } from "./tabs/FontTypesTab";
import { FontSizesTab } from "./tabs/FontSizesTab";
import { GuideLinesTab } from "./tabs/GuideLinesTab";
import { TextRubyTab } from "./tabs/TextRubyTab";

interface PendingFolder {
  path: string;
  name: string;
  volume: number;
}

/** 既存の最大巻数を取得（複数ソースから総合判定） */
function getMaxExistingVolume(): number {
  const state = useScanPsdStore.getState();
  let maxVol = 0;

  // 1) folderVolumeMapping（スキャン結果に含まれるフォルダ名→巻数マップ）
  if (state.scanData?.folderVolumeMapping) {
    for (const vol of Object.values(state.scanData.folderVolumeMapping)) {
      if (vol > maxVol) maxVol = vol;
    }
  }

  // 2) store.folders（新規モードで追加されたフォルダ）
  for (const f of state.folders) {
    if (f.volume > maxVol) maxVol = f.volume;
  }

  // 3) rubyList（ルビエントリの巻数 — JSON読込時に最も確実なソース）
  for (const r of state.rubyList) {
    if (r.volume > maxVol) maxVol = r.volume;
  }

  // 4) scannedFolders数（folderVolumeMappingが無い古いデータ用のフォールバック）
  if (maxVol === 0 && state.scanData?.scannedFolders) {
    const folderCount = Object.keys(state.scanData.scannedFolders).length;
    if (folderCount > 0) maxVol = folderCount;
  }

  return maxVol;
}

export function ScanPsdEditView() {
  const setMode = useScanPsdStore((s) => s.setMode);
  const reset = useScanPsdStore((s) => s.reset);
  const currentJsonFilePath = useScanPsdStore((s) => s.currentJsonFilePath);
  const phase = useScanPsdStore((s) => s.phase);
  const workInfo = useScanPsdStore((s) => s.workInfo);
  const pendingTitleLabel = useScanPsdStore((s) => s.pendingTitleLabel);
  const scanData = useScanPsdStore((s) => s.scanData);
  const { savePresetJson, startScan, removeVolumeData } = useScanPsdProcessor();

  // 追加スキャンダイアログ
  const [showScanDialog, setShowScanDialog] = useState(false);
  const [pendingFolders, setPendingFolders] = useState<PendingFolder[]>([]);

  // スキャン完了ダイアログ
  const [scanCompleteResult, setScanCompleteResult] = useState<ScanResult | null>(null);

  // 巻数管理ダイアログ
  const [showVolumeDialog, setShowVolumeDialog] = useState(false);

  const fileName = currentJsonFilePath ? currentJsonFilePath.split(/[\\/]/).pop() || "" : "";

  const handleSave = async () => {
    try {
      await savePresetJson();
    } catch (e) {
      console.error(e);
    }
  };

  // --- 追加スキャンダイアログ操作 ---

  /** 追加スキャンボタン: フォルダ選択 → ダイアログ表示 */
  const handleOpenScanDialog = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (!selected || typeof selected !== "string") return;

    const maxVol = getMaxExistingVolume();
    let detected: PendingFolder[] = [];

    try {
      const result = await invoke<{ mode: string; folders: { path: string; name: string }[] }>(
        "detect_psd_folders",
        { folderPath: selected },
      );
      if (result.folders.length > 0) {
        detected = result.folders.map((f, i) => ({
          path: f.path,
          name: f.name,
          volume: maxVol + 1 + i,
        }));
      } else {
        const name = selected.split(/[\\/]/).pop() || selected;
        detected = [{ path: selected, name, volume: maxVol + 1 }];
      }
    } catch {
      const name = selected.split(/[\\/]/).pop() || selected;
      detected = [{ path: selected, name, volume: maxVol + 1 }];
    }

    setPendingFolders(detected);
    setShowScanDialog(true);
  };

  /** ダイアログ内: 個別フォルダ追加 */
  const handleDialogAddFolder = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (!selected || typeof selected !== "string") return;

    const maxVol = Math.max(getMaxExistingVolume(), ...pendingFolders.map((f) => f.volume), 0);
    const name = selected.split(/[\\/]/).pop() || selected;
    setPendingFolders((prev) => [...prev, { path: selected, name, volume: maxVol + 1 }]);
  };

  /** ダイアログ内: サブフォルダ自動検出追加 */
  const handleDialogAutoDetect = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (!selected || typeof selected !== "string") return;

    const maxVol = Math.max(getMaxExistingVolume(), ...pendingFolders.map((f) => f.volume), 0);

    try {
      const result = await invoke<{ mode: string; folders: { path: string; name: string }[] }>(
        "detect_psd_folders",
        { folderPath: selected },
      );
      if (result.folders.length > 0) {
        const existingPaths = new Set(pendingFolders.map((f) => f.path));
        let addedCount = 0;
        const newFolders: PendingFolder[] = [];
        for (const f of result.folders) {
          if (!existingPaths.has(f.path)) {
            newFolders.push({ path: f.path, name: f.name, volume: maxVol + 1 + addedCount });
            addedCount++;
          }
        }
        setPendingFolders((prev) => [...prev, ...newFolders]);
      }
    } catch {
      /* ignore */
    }
  };

  /** ダイアログ内: フォルダ削除 */
  const handleDialogRemoveFolder = (index: number) => {
    setPendingFolders((prev) => prev.filter((_, i) => i !== index));
  };

  /** ダイアログ内: 巻数変更 */
  const handleDialogVolumeChange = (index: number, volume: number) => {
    setPendingFolders((prev) => prev.map((f, i) => (i === index ? { ...f, volume } : f)));
  };

  /** ダイアログ確定: storeにフォルダ追加してスキャン開始 */
  const handleConfirmScan = async () => {
    if (pendingFolders.length === 0) return;
    const store = useScanPsdStore.getState();
    for (const f of pendingFolders) {
      store.addFolder(f.path, f.name, f.volume);
    }
    setShowScanDialog(false);
    setPendingFolders([]);
    const result = await startScan();
    if (result) {
      setScanCompleteResult(result);
    }
  };

  const handleCancelScanDialog = () => {
    setShowScanDialog(false);
    setPendingFolders([]);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-bg-primary">
      {/* Header */}
      <div className="px-5 py-2.5 border-b border-border bg-white flex items-center gap-3 flex-shrink-0 shadow-soft">
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm"
          style={{ background: "linear-gradient(135deg, #ff5a8a, #7c5cff)" }}
        >
          <svg
            className="w-4 h-4 text-white"
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
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-text-primary font-display leading-tight">
            PSDスキャナー
          </p>
          <p className="text-[10px] text-text-muted truncate">{fileName}</p>
        </div>
        {pendingTitleLabel && (
          <span className="text-[10px] text-warning font-semibold bg-warning/10 px-2.5 py-1 rounded-full border border-warning/20">
            仮保存中
          </span>
        )}
        <button
          onClick={() => setShowVolumeDialog(true)}
          disabled={
            phase !== "idle" ||
            !scanData?.folderVolumeMapping ||
            Object.keys(scanData.folderVolumeMapping).length === 0
          }
          className="px-3 py-2 text-[11px] font-bold text-text-secondary bg-bg-tertiary/60 rounded-xl
            hover:bg-bg-tertiary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          巻数管理
        </button>
        <button
          onClick={handleOpenScanDialog}
          disabled={phase !== "idle"}
          className="px-3 py-2 text-[11px] font-bold text-accent bg-accent/10 rounded-xl
            hover:bg-accent/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          追加スキャン
        </button>
        <button
          onClick={handleSave}
          disabled={phase !== "idle"}
          className={`btn px-4 py-2 text-[11px] font-bold text-white rounded-xl
            disabled:opacity-40 disabled:cursor-not-allowed transition-all
            ${
              pendingTitleLabel && workInfo.title && workInfo.label
                ? "bg-gradient-to-r from-success to-emerald-500 shadow-glow-success animate-pulse"
                : ""
            }`}
          style={
            !(pendingTitleLabel && workInfo.title && workInfo.label)
              ? {
                  background: "linear-gradient(135deg, #ff5a8a, #7c5cff)",
                  boxShadow: "0 4px 15px rgba(255, 90, 138, 0.3)",
                }
              : undefined
          }
        >
          {pendingTitleLabel && workInfo.title && workInfo.label ? "正式保存" : "保存"}
        </button>
        <button
          onClick={() => {
            reset();
            setMode(null);
          }}
          className="text-[11px] text-text-muted hover:text-text-primary px-3 py-2 rounded-xl hover:bg-bg-tertiary transition-colors"
        >
          戻る
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto bg-tone">
        <div className="px-5 py-4">
          <div className="grid grid-cols-3 gap-5 items-start">
            {/* Column 1: Work Info */}
            <div>
              <SectionHeader icon="info" color="pink">
                作品情報
              </SectionHeader>
              <div className="bg-white rounded-2xl border border-border/60 shadow-card p-4">
                <WorkInfoTab />
              </div>
            </div>
            {/* Column 2: Fonts + Guides */}
            <div className="space-y-5">
              <div>
                <SectionHeader icon="font" color="purple">
                  フォント種類
                </SectionHeader>
                <div className="bg-white rounded-2xl border border-border/60 shadow-card p-4">
                  <FontTypesTab />
                </div>
              </div>
              <div>
                <SectionHeader icon="guide" color="mint">
                  ガイド線
                </SectionHeader>
                <div className="bg-white rounded-2xl border border-border/60 shadow-card p-4">
                  <GuideLinesTab />
                </div>
              </div>
            </div>
            {/* Column 3: Sizes + Ruby */}
            <div className="space-y-5">
              <div>
                <SectionHeader icon="size" color="warm">
                  サイズ統計
                </SectionHeader>
                <div className="bg-white rounded-2xl border border-border/60 shadow-card p-4">
                  <FontSizesTab />
                </div>
              </div>
              <div>
                <SectionHeader icon="ruby" color="sky">
                  テキスト / ルビ
                </SectionHeader>
                <div className="bg-white rounded-2xl border border-border/60 shadow-card p-4">
                  <TextRubyTab />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 追加スキャンダイアログ */}
      {showScanDialog && (
        <AdditionalScanDialog
          folders={pendingFolders}
          onAddFolder={handleDialogAddFolder}
          onAutoDetect={handleDialogAutoDetect}
          onRemoveFolder={handleDialogRemoveFolder}
          onVolumeChange={handleDialogVolumeChange}
          onConfirm={handleConfirmScan}
          onCancel={handleCancelScanDialog}
        />
      )}

      {/* 巻数管理ダイアログ */}
      {showVolumeDialog && scanData?.folderVolumeMapping && (
        <VolumeManageDialog
          folderVolumeMapping={scanData.folderVolumeMapping}
          scannedFolders={scanData.scannedFolders}
          onRemove={async (volume) => {
            await removeVolumeData(volume);
          }}
          onClose={() => setShowVolumeDialog(false)}
        />
      )}

      {/* スキャン完了ダイアログ */}
      {scanCompleteResult && (
        <ScanCompleteDialog
          result={scanCompleteResult}
          onClose={() => setScanCompleteResult(null)}
        />
      )}
    </div>
  );
}

// === スキャン完了ダイアログ ===

function ScanCompleteDialog({ result, onClose }: { result: ScanResult; onClose: () => void }) {
  const isSuccess = result.success;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-[360px] overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div
          className="px-5 py-4 text-center"
          style={{
            background: isSuccess
              ? "linear-gradient(135deg, rgba(16,185,129,0.08), rgba(77,184,255,0.06))"
              : "linear-gradient(135deg, rgba(239,68,68,0.08), rgba(255,90,138,0.06))",
          }}
        >
          {isSuccess ? (
            <svg
              className="w-10 h-10 mx-auto mb-2 text-success"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          ) : (
            <svg
              className="w-10 h-10 mx-auto mb-2 text-error"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
              />
            </svg>
          )}
          <h3 className="text-sm font-bold text-text-primary">
            {isSuccess ? "スキャン完了" : "スキャン失敗"}
          </h3>
        </div>

        {/* 内容 */}
        <div className="px-5 py-4">
          {isSuccess && result.success ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-muted">処理ファイル数</span>
                <span className="font-bold text-text-primary">{result.processedFiles}</span>
              </div>
              {result.newFolders.length > 0 && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-muted">追加フォルダ</span>
                  <span className="font-bold text-text-primary">{result.newFolders.length}</span>
                </div>
              )}
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-muted">ルビ</span>
                <span className="font-bold text-text-primary">{result.rubyCount}件</span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-error">{!result.success && result.error}</p>
          )}
        </div>

        {/* フッター */}
        <div className="px-5 pb-4">
          <button
            onClick={onClose}
            className="w-full py-2 text-xs font-bold text-white rounded-xl transition-all hover:-translate-y-0.5"
            style={{
              background: "linear-gradient(135deg, #ff5a8a, #7c5cff)",
              boxShadow: "0 3px 12px rgba(255,90,138,0.2)",
            }}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

// === 追加スキャンダイアログ ===

function AdditionalScanDialog({
  folders,
  onAddFolder,
  onAutoDetect,
  onRemoveFolder,
  onVolumeChange,
  onConfirm,
  onCancel,
}: {
  folders: PendingFolder[];
  onAddFolder: () => void;
  onAutoDetect: () => void;
  onRemoveFolder: (index: number) => void;
  onVolumeChange: (index: number, volume: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-[520px] max-h-[80vh] flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border/60">
          <div className="flex items-center gap-2.5">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: "linear-gradient(135deg, #ff5a8a, #7c5cff)" }}
            >
              <svg
                className="w-3.5 h-3.5 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-bold text-text-primary">追加スキャン - フォルダ選択</h3>
              <p className="text-[10px] text-text-muted mt-0.5">
                既存のデータに追記されます（カウントは加算）
              </p>
            </div>
          </div>
        </div>

        {/* Folder List */}
        <div className="flex-1 overflow-auto px-5 py-3">
          {folders.length === 0 ? (
            <div className="text-center py-8 text-xs text-text-muted">
              フォルダを追加してください
            </div>
          ) : (
            <div className="space-y-1.5">
              {/* Column headers */}
              <div className="flex items-center gap-2 px-2 text-[10px] text-text-muted font-semibold">
                <span className="flex-1">フォルダ名</span>
                <span className="w-[72px] text-center">巻数</span>
                <span className="w-7" />
              </div>
              {folders.map((f, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 bg-bg-secondary rounded-lg px-3 py-2"
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
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-text-primary truncate">{f.name}</p>
                    <p className="text-[9px] text-text-muted truncate">{f.path}</p>
                  </div>
                  <select
                    value={f.volume}
                    onChange={(e) => onVolumeChange(i, Number(e.target.value))}
                    className="w-[72px] bg-white border border-border rounded-lg px-1.5 py-1 text-[11px] text-text-primary text-center"
                  >
                    {Array.from({ length: 50 }, (_, j) => j + 1).map((v) => (
                      <option key={v} value={v}>
                        {v}巻
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => onRemoveFolder(i)}
                    className="w-7 h-7 flex items-center justify-center text-text-muted hover:text-error rounded-lg hover:bg-error/10 transition-colors"
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
        </div>

        {/* Add Buttons */}
        <div className="px-5 pb-3">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={onAddFolder}
              className="py-2.5 border border-dashed border-border rounded-lg text-text-muted
                hover:border-accent/50 hover:text-accent transition-colors flex flex-col items-center gap-1"
            >
              <div className="flex items-center gap-1.5">
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
                <span className="text-[11px] font-semibold">個別追加</span>
              </div>
              <span className="text-[9px] opacity-60">1フォルダずつ選択</span>
            </button>
            <button
              onClick={onAutoDetect}
              className="py-2.5 border border-dashed border-border rounded-lg text-text-muted
                hover:border-accent/50 hover:text-accent transition-colors flex flex-col items-center gap-1"
            >
              <div className="flex items-center gap-1.5">
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
                    d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                  />
                </svg>
                <span className="text-[11px] font-semibold">自動検出</span>
              </div>
              <span className="text-[9px] opacity-60">親フォルダからPSD含むサブフォルダを検出</span>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border/60 flex items-center justify-between">
          <p className="text-[10px] text-text-muted">
            {folders.length > 0 ? `${folders.length} フォルダ選択中` : ""}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-[11px] text-text-muted hover:text-text-primary rounded-lg hover:bg-bg-tertiary transition-colors"
            >
              キャンセル
            </button>
            <button
              onClick={onConfirm}
              disabled={folders.length === 0}
              className="px-5 py-2 text-[11px] font-bold text-white rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              style={{
                background: "linear-gradient(135deg, #ff5a8a, #7c5cff)",
                boxShadow: folders.length > 0 ? "0 4px 15px rgba(255, 90, 138, 0.3)" : undefined,
              }}
            >
              スキャン開始
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// === 巻数管理ダイアログ ===

function VolumeManageDialog({
  folderVolumeMapping,
  scannedFolders,
  onRemove,
  onClose,
}: {
  folderVolumeMapping: Record<string, number>;
  scannedFolders: Record<string, { files: string[]; scanDate: string }>;
  onRemove: (volume: number) => Promise<void>;
  onClose: () => void;
}) {
  const [removing, setRemoving] = useState<number | null>(null);

  // 巻数ごとにフォルダをグループ化
  const volumeGroups = new Map<number, { folders: string[]; fileCount: number }>();
  for (const [folderName, vol] of Object.entries(folderVolumeMapping)) {
    if (!volumeGroups.has(vol)) volumeGroups.set(vol, { folders: [], fileCount: 0 });
    const group = volumeGroups.get(vol)!;
    group.folders.push(folderName);
    // scannedFoldersからファイル数を取得（キーがフルパスなので末尾マッチ）
    for (const [fullPath, info] of Object.entries(scannedFolders)) {
      const pathName = fullPath.split(/[\\/]/).pop() || fullPath;
      if (pathName === folderName) {
        group.fileCount += info.files.length;
      }
    }
  }
  const sortedVolumes = [...volumeGroups.entries()].sort(([a], [b]) => a - b);

  const handleRemove = async (volume: number) => {
    if (
      !confirm(
        `${String(volume).padStart(2, "0")}巻のスキャンデータを削除しますか？\n削除後、追加スキャンで再スキャンできます。`,
      )
    )
      return;
    setRemoving(volume);
    try {
      await onRemove(volume);
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-[420px] max-h-[70vh] flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border/60">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 bg-bg-tertiary">
              <svg
                className="w-3.5 h-3.5 text-text-secondary"
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
            </div>
            <div>
              <h3 className="text-sm font-bold text-text-primary">巻数管理</h3>
              <p className="text-[10px] text-text-muted mt-0.5">
                削除した巻は追加スキャンで再スキャンできます
              </p>
            </div>
          </div>
        </div>

        {/* Volume List */}
        <div className="flex-1 overflow-auto px-5 py-3">
          {sortedVolumes.length === 0 ? (
            <div className="text-center py-8 text-xs text-text-muted">
              スキャン済み巻数がありません
            </div>
          ) : (
            <div className="space-y-1.5">
              {sortedVolumes.map(([vol, group]) => (
                <div
                  key={vol}
                  className="flex items-center gap-3 bg-bg-secondary rounded-lg px-3 py-2.5"
                >
                  <div className="w-10 h-10 rounded-lg bg-white border border-border/60 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-black text-text-primary">
                      {String(vol).padStart(2, "0")}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-text-primary font-semibold">
                      {String(vol).padStart(2, "0")}巻
                    </p>
                    <p className="text-[9px] text-text-muted truncate">
                      {group.folders.join(", ")}
                      {group.fileCount > 0 && ` (${group.fileCount}ファイル)`}
                    </p>
                  </div>
                  <button
                    onClick={() => handleRemove(vol)}
                    disabled={removing !== null}
                    className="px-2.5 py-1.5 text-[10px] font-semibold text-error bg-error/8 rounded-lg
                      hover:bg-error/15 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {removing === vol ? "削除中..." : "削除"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border/60 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[11px] font-semibold text-text-secondary hover:text-text-primary rounded-lg hover:bg-bg-tertiary transition-colors"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

// === セクションヘッダー ===

const SECTION_COLORS = {
  pink: { from: "#ff5a8a", to: "#ff8ab5", bg: "rgba(255,90,138,0.08)", text: "#ff5a8a" },
  purple: { from: "#7c5cff", to: "#a78bff", bg: "rgba(124,92,255,0.08)", text: "#7c5cff" },
  mint: { from: "#00c9a7", to: "#5ce0c9", bg: "rgba(0,201,167,0.08)", text: "#00c9a7" },
  warm: { from: "#ffb142", to: "#ffc875", bg: "rgba(255,177,66,0.08)", text: "#e69a00" },
  sky: { from: "#4db8ff", to: "#85cfff", bg: "rgba(77,184,255,0.08)", text: "#2d9cdb" },
};

const SECTION_ICONS: Record<string, React.ReactNode> = {
  info: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
    />
  ),
  font: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129"
    />
  ),
  size: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
    />
  ),
  guide: <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />,
  ruby: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
    />
  ),
};

function SectionHeader({
  icon,
  color,
  children,
}: {
  icon: string;
  color: keyof typeof SECTION_COLORS;
  children: React.ReactNode;
}) {
  const c = SECTION_COLORS[color];
  return (
    <div className="flex items-center gap-2 mb-2.5">
      <div
        className="w-5 h-5 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: c.bg }}
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke={c.text} strokeWidth={2.5}>
          {SECTION_ICONS[icon]}
        </svg>
      </div>
      <span className="text-[11px] font-bold font-display tracking-wide" style={{ color: c.text }}>
        {children}
      </span>
      <div
        className="flex-1 h-px"
        style={{ background: `linear-gradient(to right, ${c.from}30, transparent)` }}
      />
    </div>
  );
}
