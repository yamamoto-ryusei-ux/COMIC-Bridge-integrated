import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useRenameStore } from "../../store/renameStore";
import { useRenameProcessor } from "../../hooks/useRenameProcessor";
import { isSupportedFile } from "../../types/index";
import type {
  FileRenameMode,
  FileOutputMode,
  MatchMode,
  FileRenameEntry,
} from "../../types/rename";

export function FileRenamePanel() {
  const fileSettings = useRenameStore((s) => s.fileSettings);
  const fileEntries = useRenameStore((s) => s.fileEntries);
  const phase = useRenameStore((s) => s.phase);
  const setFileRenameMode = useRenameStore((s) => s.setFileRenameMode);
  const setSequentialBaseName = useRenameStore((s) => s.setSequentialBaseName);
  const setSequentialStartNumber = useRenameStore((s) => s.setSequentialStartNumber);
  const setSequentialPadding = useRenameStore((s) => s.setSequentialPadding);
  const setSequentialSeparator = useRenameStore((s) => s.setSequentialSeparator);
  const setReplaceSearchText = useRenameStore((s) => s.setReplaceSearchText);
  const setReplaceReplaceText = useRenameStore((s) => s.setReplaceReplaceText);
  const setReplaceMatchMode = useRenameStore((s) => s.setReplaceMatchMode);
  const setPrefix = useRenameStore((s) => s.setPrefix);
  const setSuffix = useRenameStore((s) => s.setSuffix);
  const setFileOutputMode = useRenameStore((s) => s.setFileOutputMode);
  const setFileOutputDirectory = useRenameStore((s) => s.setFileOutputDirectory);
  const addFileEntries = useRenameStore((s) => s.addFileEntries);

  const { executeFileRename } = useRenameProcessor();

  const isProcessing = phase === "processing";
  const selectedCount = fileEntries.filter((e) => e.selected).length;
  const folderCount = new Set(fileEntries.map((e) => e.folderPath)).size;
  const canExecute = selectedCount > 0 && !isProcessing;

  const handleAddFolder = async () => {
    const selected = await open({
      directory: true,
      title: "ファイルが含まれるフォルダを選択",
    });
    if (!selected) return;

    const folderPath = selected as string;
    const folderParts = folderPath.replace(/\\/g, "/").split("/");
    const folderName =
      folderParts[folderParts.length - 1] || folderParts[folderParts.length - 2] || folderPath;

    const files = await invoke<string[]>("list_folder_files", {
      folderPath,
      recursive: false,
    });

    const entries: FileRenameEntry[] = files
      .filter((f) => {
        const name = f.split(/[\\/]/).pop() || "";
        return isSupportedFile(name);
      })
      .map((f) => {
        const name = f.split(/[\\/]/).pop() || "";
        return {
          id: crypto.randomUUID(),
          filePath: f,
          fileName: name,
          folderPath,
          folderName,
          selected: true,
          customName: null,
        };
      });

    addFileEntries(entries);
  };

  const handleSelectOutputDir = async () => {
    const selected = await open({
      directory: true,
      title: "出力先フォルダを選択",
    });
    if (selected) setFileOutputDirectory(selected as string);
  };

  const getLastFolderName = (path: string | null) => {
    if (!path) return "";
    const parts = path.replace(/\\/g, "/").split("/");
    return parts[parts.length - 1] || parts[parts.length - 2] || path;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/5">
        <h3 className="text-sm font-display font-medium text-text-primary flex items-center gap-2">
          <svg
            className="w-4 h-4 text-accent-secondary"
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
          ファイルリネーム
        </h3>
        <p className="text-xs text-text-muted mt-1">画像ファイル名を一括変更（Photoshop不要）</p>
      </div>

      {/* Settings */}
      <div className="flex-1 overflow-auto p-3 space-y-3">
        {/* Folder Add */}
        <div className="bg-bg-tertiary rounded-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-medium text-text-muted">対象ファイル</h4>
            <button
              onClick={handleAddFolder}
              className="px-2.5 py-1 text-[10px] bg-accent-secondary/10 text-accent-secondary border border-accent-secondary/30 rounded-lg hover:bg-accent-secondary/20 transition-colors flex items-center gap-1"
            >
              <svg
                className="w-3 h-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              フォルダ追加
            </button>
          </div>
          <p className="text-[10px] text-text-muted">
            {fileEntries.length > 0
              ? `${folderCount > 1 ? `${folderCount} フォルダ / ` : ""}${fileEntries.length} ファイル読み込み済み（${selectedCount} 件選択中）`
              : "フォルダを追加してファイルを読み込んでください"}
          </p>
        </div>

        {/* Rename Mode */}
        <div className="bg-bg-tertiary rounded-xl p-3">
          <h4 className="text-xs font-medium text-text-muted mb-2">リネームモード</h4>
          <div className="space-y-2">
            <ModeOption
              mode="sequential"
              currentMode={fileSettings.mode}
              label="連番リネーム"
              description="ベース名 + セパレータ + 連番"
              onSelect={setFileRenameMode}
            />
            {fileSettings.mode === "sequential" && (
              <div className="ml-3 pl-3 border-l-2 border-accent-secondary/30 space-y-1.5">
                <input
                  type="text"
                  value={fileSettings.sequential.baseName}
                  onChange={(e) => setSequentialBaseName(e.target.value)}
                  placeholder="ベース名（例: 作品名）"
                  className="w-full bg-bg-elevated border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-primary focus:border-accent-secondary focus:outline-none"
                />
                <div className="flex gap-1.5">
                  <div className="flex-1">
                    <label className="text-[10px] text-text-muted">セパレータ</label>
                    <input
                      type="text"
                      value={fileSettings.sequential.separator}
                      onChange={(e) => setSequentialSeparator(e.target.value)}
                      className="w-full bg-bg-elevated border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-primary focus:border-accent-secondary focus:outline-none"
                    />
                  </div>
                  <div className="w-16">
                    <label className="text-[10px] text-text-muted">開始番号</label>
                    <input
                      type="number"
                      value={fileSettings.sequential.startNumber}
                      onChange={(e) => setSequentialStartNumber(parseInt(e.target.value) || 1)}
                      min={0}
                      className="w-full bg-bg-elevated border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-primary focus:border-accent-secondary focus:outline-none"
                    />
                  </div>
                  <div className="w-14">
                    <label className="text-[10px] text-text-muted">桁数</label>
                    <input
                      type="number"
                      value={fileSettings.sequential.padding}
                      onChange={(e) => setSequentialPadding(parseInt(e.target.value) || 1)}
                      min={1}
                      max={6}
                      className="w-full bg-bg-elevated border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-primary focus:border-accent-secondary focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            )}

            <ModeOption
              mode="replace"
              currentMode={fileSettings.mode}
              label="文字列置換"
              description="ファイル名の一部を検索して置換"
              onSelect={setFileRenameMode}
            />
            {fileSettings.mode === "replace" && (
              <div className="ml-3 pl-3 border-l-2 border-accent-secondary/30 space-y-1.5">
                <input
                  type="text"
                  value={fileSettings.replaceString.searchText}
                  onChange={(e) => setReplaceSearchText(e.target.value)}
                  placeholder="検索文字列"
                  className="w-full bg-bg-elevated border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-primary focus:border-accent-secondary focus:outline-none"
                />
                <div className="flex items-center gap-1">
                  <svg
                    className="w-3 h-3 text-text-muted flex-shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M17 8l4 4m0 0l-4 4m4-4H3"
                    />
                  </svg>
                  <input
                    type="text"
                    value={fileSettings.replaceString.replaceText}
                    onChange={(e) => setReplaceReplaceText(e.target.value)}
                    placeholder="置換文字列"
                    className="w-full bg-bg-elevated border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-primary focus:border-accent-secondary focus:outline-none"
                  />
                </div>
                <select
                  value={fileSettings.replaceString.matchMode}
                  onChange={(e) => setReplaceMatchMode(e.target.value as MatchMode)}
                  className="w-full bg-bg-elevated border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-primary focus:border-accent-secondary focus:outline-none"
                >
                  <option value="partial">部分一致</option>
                  <option value="regex">正規表現</option>
                </select>
              </div>
            )}

            <ModeOption
              mode="prefix"
              currentMode={fileSettings.mode}
              label="プレフィックス/サフィックス"
              description="ファイル名の前後に文字列を追加"
              onSelect={setFileRenameMode}
            />
            {fileSettings.mode === "prefix" && (
              <div className="ml-3 pl-3 border-l-2 border-accent-secondary/30 space-y-1.5">
                <div>
                  <label className="text-[10px] text-text-muted">
                    プレフィックス（先頭に追加）
                  </label>
                  <input
                    type="text"
                    value={fileSettings.prefixSuffix.prefix}
                    onChange={(e) => setPrefix(e.target.value)}
                    placeholder="先頭に追加する文字列"
                    className="w-full bg-bg-elevated border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-primary focus:border-accent-secondary focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-text-muted">サフィックス（末尾に追加）</label>
                  <input
                    type="text"
                    value={fileSettings.prefixSuffix.suffix}
                    onChange={(e) => setSuffix(e.target.value)}
                    placeholder="末尾に追加する文字列"
                    className="w-full bg-bg-elevated border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-primary focus:border-accent-secondary focus:outline-none"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Output Mode */}
        <div className="bg-bg-tertiary rounded-xl p-3">
          <h4 className="text-xs font-medium text-text-muted mb-2">出力方式</h4>
          <div className="space-y-2">
            <OutputOption
              mode="copy"
              currentMode={fileSettings.outputMode}
              label="コピーして出力"
              description="Script_Outputフォルダにコピー"
              onSelect={setFileOutputMode}
            />
            <OutputOption
              mode="overwrite"
              currentMode={fileSettings.outputMode}
              label="元の場所でリネーム"
              description="ファイルを直接リネーム（上書き）"
              onSelect={setFileOutputMode}
            />
          </div>

          {fileSettings.outputMode === "copy" && (
            <div className="mt-2 pt-2 border-t border-white/5">
              <h4 className="text-[10px] text-text-muted mb-1">出力先フォルダ</h4>
              {fileSettings.outputDirectory ? (
                <div className="flex items-center gap-2">
                  <p
                    className="text-xs text-text-primary truncate flex-1"
                    title={fileSettings.outputDirectory}
                  >
                    {getLastFolderName(fileSettings.outputDirectory)}
                  </p>
                  <button
                    onClick={() => setFileOutputDirectory(null)}
                    className="flex-shrink-0 p-0.5 rounded text-text-muted hover:text-error transition-colors"
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
                  <button
                    onClick={handleSelectOutputDir}
                    className="flex-shrink-0 px-2 py-1 text-[10px] bg-bg-elevated border border-white/10 rounded-lg text-text-secondary hover:text-text-primary transition-colors"
                  >
                    変更
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <p className="text-[10px] text-text-muted flex-1">
                    デスクトップ/Script_Output/リネーム_ファイル
                  </p>
                  <button
                    onClick={handleSelectOutputDir}
                    className="text-xs text-accent-secondary hover:text-accent-secondary/80 transition-colors"
                  >
                    変更...
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Action Bar */}
      <div className="p-3 border-t border-white/5 space-y-2">
        {fileEntries.length === 0 && (
          <p className="text-[10px] text-text-muted text-center">
            フォルダを追加してファイルを読み込んでください
          </p>
        )}
        <button
          onClick={executeFileRename}
          disabled={!canExecute}
          className="
            w-full px-4 py-3 text-sm font-medium rounded-xl text-white
            bg-gradient-to-r from-accent-secondary to-accent-tertiary
            shadow-[0_4px_15px_rgba(0,212,170,0.3)]
            hover:shadow-[0_6px_20px_rgba(0,212,170,0.4)]
            hover:-translate-y-0.5
            transition-all duration-200
            disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none
            flex items-center justify-center gap-2
          "
        >
          {isProcessing ? (
            <>
              <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              リネーム中...
            </>
          ) : (
            <>
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              ファイルリネーム実行（{selectedCount} 件）
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// === Sub Components ===

function ModeOption({
  mode,
  currentMode,
  label,
  description,
  onSelect,
}: {
  mode: FileRenameMode;
  currentMode: FileRenameMode;
  label: string;
  description: string;
  onSelect: (mode: FileRenameMode) => void;
}) {
  const isSelected = currentMode === mode;

  return (
    <div
      className={`
        p-2.5 rounded-xl cursor-pointer transition-all duration-200
        ${
          isSelected
            ? "bg-accent-secondary/15 border-2 border-accent-secondary/50"
            : "bg-bg-elevated border-2 border-white/5 hover:border-white/10"
        }
      `}
      onClick={() => onSelect(mode)}
    >
      <div className="flex items-center gap-2.5">
        <div className="flex-1 min-w-0">
          <span className="text-xs font-medium text-text-primary">{label}</span>
          <p className="text-[10px] text-text-muted">{description}</p>
        </div>
        <div
          className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0
            ${isSelected ? "border-accent-secondary bg-accent-secondary" : "border-text-muted/30"}
          `}
        >
          {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
        </div>
      </div>
    </div>
  );
}

function OutputOption({
  mode,
  currentMode,
  label,
  description,
  onSelect,
}: {
  mode: FileOutputMode;
  currentMode: FileOutputMode;
  label: string;
  description: string;
  onSelect: (mode: FileOutputMode) => void;
}) {
  const isSelected = currentMode === mode;

  return (
    <label className="flex items-center gap-2 cursor-pointer" onClick={() => onSelect(mode)}>
      <div
        className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center flex-shrink-0
          ${isSelected ? "border-accent-tertiary bg-accent-tertiary" : "border-text-muted/30"}
        `}
      >
        {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
      </div>
      <div>
        <span className="text-xs text-text-primary">{label}</span>
        <p className="text-[10px] text-text-muted">{description}</p>
      </div>
    </label>
  );
}
