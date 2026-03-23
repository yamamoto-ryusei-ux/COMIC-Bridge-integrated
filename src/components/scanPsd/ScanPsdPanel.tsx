import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useScanPsdStore } from "../../store/scanPsdStore";
import { TAB_LABELS } from "../../types/scanPsd";
import type { ScanPsdTab } from "../../types/scanPsd";
import { WorkInfoTab } from "./tabs/WorkInfoTab";
import { FontTypesTab } from "./tabs/FontTypesTab";
import { FontSizesTab } from "./tabs/FontSizesTab";
import { GuideLinesTab } from "./tabs/GuideLinesTab";
import { TextRubyTab } from "./tabs/TextRubyTab";
import { useScanPsdProcessor } from "../../hooks/useScanPsdProcessor";

export function ScanPsdPanel() {
  const activeTab = useScanPsdStore((s) => s.activeTab);
  const setActiveTab = useScanPsdStore((s) => s.setActiveTab);
  const mode = useScanPsdStore((s) => s.mode);
  const setMode = useScanPsdStore((s) => s.setMode);
  const reset = useScanPsdStore((s) => s.reset);
  const currentJsonFilePath = useScanPsdStore((s) => s.currentJsonFilePath);
  const phase = useScanPsdStore((s) => s.phase);
  const workInfo = useScanPsdStore((s) => s.workInfo);
  const pendingTitleLabel = useScanPsdStore((s) => s.pendingTitleLabel);

  const { savePresetJson, startScan } = useScanPsdProcessor();

  const handleSave = async () => {
    try {
      const isProperSave = await savePresetJson();
      if (!isProperSave) {
        // 仮保存 → 作品情報タブに切替えて入力を促す
        useScanPsdStore.getState().setActiveTab(0);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleTabExport = async () => {
    const state = useScanPsdStore.getState();
    let data: Record<string, unknown> = {};

    switch (activeTab) {
      case 0:
        data = { workInfo: state.workInfo };
        break;
      case 1:
        data = { fonts: state.scanData?.fonts ?? [] };
        break;
      case 2:
        data = {
          sizeStats: state.scanData?.sizeStats ?? null,
          strokeStats: state.scanData?.strokeStats ?? null,
        };
        break;
      case 3:
        data = {
          guideSets: state.scanData?.guideSets ?? [],
          selectedGuideSetIndex: state.selectedGuideIndex,
          excludedGuideIndices: [...state.excludedGuideIndices],
        };
        break;
      case 4:
        data = {
          rubyList: state.rubyList,
          textLogByFolder: state.scanData?.textLogByFolder ?? {},
        };
        break;
    }

    const defaultName = `${TAB_LABELS[activeTab]}_export.json`;

    try {
      const filePath = await save({
        defaultPath: defaultName,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!filePath) return;
      await invoke("write_text_file", {
        filePath,
        content: JSON.stringify(data, null, 2),
      });
    } catch (e) {
      console.error(e);
    }
  };

  // ヘッダーに表示するファイル情報
  const displayFileName = currentJsonFilePath
    ? currentJsonFilePath.split("/").pop()?.split("\\").pop()
    : pendingTitleLabel
      ? "(仮保存中)"
      : null;

  return (
    <>
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-accent/10 flex items-center justify-center">
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
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-xs font-bold text-text-primary">PSDスキャナー</h2>
            <p className="text-[10px] text-text-muted truncate">
              {mode === "new" ? "新規作成" : "JSON編集"}
              {displayFileName && ` - ${displayFileName}`}
            </p>
          </div>
          <button
            onClick={() => {
              reset();
              setMode(null);
            }}
            className="text-[10px] text-text-muted hover:text-text-primary px-2 py-1 rounded-lg hover:bg-bg-tertiary transition-colors"
          >
            戻る
          </button>
        </div>
      </div>

      {/* 仮保存警告バナー */}
      {pendingTitleLabel && (
        <div className="px-3 py-2 bg-warning/10 border-b border-warning/30 flex-shrink-0">
          <p className="text-[10px] text-warning font-medium">
            タイトルとレーベルを入力して再度保存してください（現在は仮保存状態です）
          </p>
        </div>
      )}

      {/* Tab Bar */}
      <div className="flex border-b border-border flex-shrink-0 bg-bg-secondary">
        {TAB_LABELS.map((label, i) => (
          <button
            key={i}
            onClick={() => setActiveTab(i as ScanPsdTab)}
            className={`
              flex-1 py-2 text-[10px] font-medium transition-colors relative
              ${activeTab === i ? "text-accent" : "text-text-muted hover:text-text-secondary"}
            `}
          >
            {label}
            {activeTab === i && (
              <div className="absolute bottom-0 left-1 right-1 h-0.5 bg-accent rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-auto p-3 space-y-3 relative">
        {activeTab === 0 && <WorkInfoTab />}
        {activeTab === 1 && <FontTypesTab />}
        {activeTab === 2 && <FontSizesTab />}
        {activeTab === 3 && <GuideLinesTab />}
        {activeTab === 4 && <TextRubyTab />}
      </div>

      {/* Bottom Action Bar */}
      <div className="p-3 border-t border-border flex-shrink-0 space-y-2">
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={phase !== "idle"}
            className={`flex-1 px-3 py-2 text-xs font-medium text-white rounded-xl
              disabled:opacity-40 disabled:cursor-not-allowed hover:-translate-y-0.5 transition-all shadow-sm
              ${
                pendingTitleLabel && workInfo.title && workInfo.label
                  ? "bg-gradient-to-r from-success to-emerald-500 animate-pulse"
                  : "bg-gradient-to-r from-accent to-accent-secondary"
              }`}
          >
            {pendingTitleLabel && workInfo.title && workInfo.label ? "正式保存する" : "保存"}
          </button>
          <button
            onClick={handleTabExport}
            disabled={phase !== "idle"}
            className="px-2.5 py-2 text-[10px] font-medium text-text-secondary bg-bg-tertiary
              rounded-xl hover:bg-bg-tertiary/80 hover:text-text-primary
              disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            タブ保存
          </button>
        </div>
        <button
          onClick={startScan}
          disabled={phase !== "idle"}
          className="w-full px-3 py-2 text-xs font-medium text-accent bg-accent/10
            rounded-xl hover:bg-accent/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          追加スキャン
        </button>
      </div>
    </>
  );
}
