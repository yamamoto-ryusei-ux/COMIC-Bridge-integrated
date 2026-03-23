import { open } from "@tauri-apps/plugin-dialog";
import { useRenameStore } from "../../store/renameStore";
import { usePsdStore } from "../../store/psdStore";
import { useRenameProcessor } from "../../hooks/useRenameProcessor";
import type { MatchMode } from "../../types/rename";

export function LayerRenamePanel() {
  const layerSettings = useRenameStore((s) => s.layerSettings);
  const phase = useRenameStore((s) => s.phase);
  const setBottomLayerEnabled = useRenameStore((s) => s.setBottomLayerEnabled);
  const setBottomLayerName = useRenameStore((s) => s.setBottomLayerName);
  const addRule = useRenameStore((s) => s.addRule);
  const updateRule = useRenameStore((s) => s.updateRule);
  const removeRule = useRenameStore((s) => s.removeRule);
  const setLayerFileOutputEnabled = useRenameStore((s) => s.setLayerFileOutputEnabled);
  const setLayerFileOutputBaseName = useRenameStore((s) => s.setLayerFileOutputBaseName);
  const setLayerFileOutputStartNumber = useRenameStore((s) => s.setLayerFileOutputStartNumber);
  const setLayerFileOutputPadding = useRenameStore((s) => s.setLayerFileOutputPadding);
  const setLayerFileOutputSeparator = useRenameStore((s) => s.setLayerFileOutputSeparator);
  const setLayerOutputDirectory = useRenameStore((s) => s.setLayerOutputDirectory);

  const files = usePsdStore((s) => s.files);
  const psdFiles = files.filter(
    (f) => f.filePath.toLowerCase().endsWith(".psd") || f.filePath.toLowerCase().endsWith(".psb"),
  );

  const { executeLayerRename } = useRenameProcessor();

  const isProcessing = phase === "processing";
  const canExecute = psdFiles.length > 0 && !isProcessing;

  const handleSelectOutputDir = async () => {
    const selected = await open({ directory: true, title: "出力先フォルダを選択" });
    if (selected) setLayerOutputDirectory(selected as string);
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
            className="w-4 h-4 text-accent"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
            />
          </svg>
          レイヤーリネーム
        </h3>
        <p className="text-xs text-text-muted mt-1">
          PSD内のレイヤー名・グループ名を変更（{psdFiles.length} ファイル対象）
        </p>
      </div>

      {/* Settings */}
      <div className="flex-1 overflow-auto p-3 space-y-3">
        {/* Bottom Layer */}
        <div className="bg-bg-tertiary rounded-xl p-3">
          <div className="flex items-center gap-2 mb-2">
            <CheckBox checked={layerSettings.bottomLayer.enabled} onChange={setBottomLayerEnabled}>
              <span className="text-xs font-medium text-text-primary">
                最下位レイヤーをリネーム
              </span>
            </CheckBox>
          </div>
          {layerSettings.bottomLayer.enabled && (
            <input
              type="text"
              value={layerSettings.bottomLayer.newName}
              onChange={(e) => setBottomLayerName(e.target.value)}
              placeholder="新しい名前"
              className="w-full bg-bg-elevated border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none"
            />
          )}
        </div>

        {/* Rename Rules */}
        <div className="bg-bg-tertiary rounded-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-medium text-text-muted">リネームルール</h4>
            <div className="flex gap-1">
              <button
                onClick={() => addRule("layer")}
                className="px-2 py-1 text-[10px] bg-accent/10 text-accent border border-accent/30 rounded-lg hover:bg-accent/20 transition-colors"
              >
                + レイヤー
              </button>
              <button
                onClick={() => addRule("group")}
                className="px-2 py-1 text-[10px] bg-accent-secondary/10 text-accent-secondary border border-accent-secondary/30 rounded-lg hover:bg-accent-secondary/20 transition-colors"
              >
                + グループ
              </button>
            </div>
          </div>

          {layerSettings.rules.length === 0 ? (
            <p className="text-[10px] text-text-muted text-center py-3">
              ルールを追加してレイヤー名やグループ名を変更できます
            </p>
          ) : (
            <div className="space-y-2">
              {layerSettings.rules.map((rule) => (
                <div
                  key={rule.id}
                  className={`p-2.5 rounded-lg border ${
                    rule.target === "layer"
                      ? "border-accent/20 bg-accent/5"
                      : "border-accent-secondary/20 bg-accent-secondary/5"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span
                      className={`text-[10px] font-medium ${
                        rule.target === "layer" ? "text-accent" : "text-accent-secondary"
                      }`}
                    >
                      {rule.target === "layer" ? "レイヤー" : "グループ"}
                    </span>
                    <button
                      onClick={() => removeRule(rule.id)}
                      className="p-0.5 rounded text-text-muted hover:text-error transition-colors"
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
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    <input
                      type="text"
                      value={rule.oldName}
                      onChange={(e) => updateRule(rule.id, { oldName: e.target.value })}
                      placeholder="変更前の名前"
                      className="w-full bg-bg-elevated border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none"
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
                        value={rule.newName}
                        onChange={(e) => updateRule(rule.id, { newName: e.target.value })}
                        placeholder="変更後の名前"
                        className="w-full bg-bg-elevated border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none"
                      />
                    </div>
                    <select
                      value={rule.matchMode}
                      onChange={(e) =>
                        updateRule(rule.id, {
                          matchMode: e.target.value as MatchMode,
                        })
                      }
                      className="w-full bg-bg-elevated border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none"
                    >
                      <option value="exact">完全一致</option>
                      <option value="partial">部分一致</option>
                      <option value="regex">正規表現</option>
                    </select>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* File Output */}
        <div className="bg-bg-tertiary rounded-xl p-3">
          <div className="flex items-center gap-2 mb-2">
            <CheckBox
              checked={layerSettings.fileOutput.enabled}
              onChange={setLayerFileOutputEnabled}
            >
              <span className="text-xs font-medium text-text-primary">
                ファイルを連番リネームして保存
              </span>
            </CheckBox>
          </div>
          {layerSettings.fileOutput.enabled && (
            <div className="space-y-1.5">
              <input
                type="text"
                value={layerSettings.fileOutput.baseName}
                onChange={(e) => setLayerFileOutputBaseName(e.target.value)}
                placeholder="ベース名（例: 作品名）"
                className="w-full bg-bg-elevated border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none"
              />
              <div className="flex gap-1.5">
                <div className="flex-1">
                  <label className="text-[10px] text-text-muted">セパレータ</label>
                  <input
                    type="text"
                    value={layerSettings.fileOutput.separator}
                    onChange={(e) => setLayerFileOutputSeparator(e.target.value)}
                    className="w-full bg-bg-elevated border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none"
                  />
                </div>
                <div className="w-16">
                  <label className="text-[10px] text-text-muted">開始番号</label>
                  <input
                    type="number"
                    value={layerSettings.fileOutput.startNumber}
                    onChange={(e) => setLayerFileOutputStartNumber(parseInt(e.target.value) || 1)}
                    min={0}
                    className="w-full bg-bg-elevated border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none"
                  />
                </div>
                <div className="w-14">
                  <label className="text-[10px] text-text-muted">桁数</label>
                  <input
                    type="number"
                    value={layerSettings.fileOutput.padding}
                    onChange={(e) => setLayerFileOutputPadding(parseInt(e.target.value) || 1)}
                    min={1}
                    max={6}
                    className="w-full bg-bg-elevated border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Output Directory */}
        <div className="bg-bg-tertiary rounded-xl p-3">
          <h4 className="text-xs font-medium text-text-muted mb-2">出力先フォルダ</h4>
          {layerSettings.outputDirectory ? (
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <p
                  className="text-xs text-text-primary truncate"
                  title={layerSettings.outputDirectory}
                >
                  {getLastFolderName(layerSettings.outputDirectory)}
                </p>
              </div>
              <button
                onClick={() => setLayerOutputDirectory(null)}
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
                デスクトップ/Script_Output/リネーム_PSD
              </p>
              <button
                onClick={handleSelectOutputDir}
                className="text-xs text-accent hover:text-accent/80 transition-colors"
              >
                変更...
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Action Bar */}
      <div className="p-3 border-t border-white/5 space-y-2">
        {psdFiles.length === 0 && (
          <p className="text-[10px] text-text-muted text-center">
            PSDファイルを読み込んでください（仕様チェックタブでフォルダを選択）
          </p>
        )}
        <button
          onClick={executeLayerRename}
          disabled={!canExecute}
          className="
            w-full px-4 py-3 text-sm font-medium rounded-xl text-white
            bg-gradient-to-r from-accent to-accent-secondary
            shadow-glow-pink
            hover:shadow-[0_6px_20px_rgba(255,90,138,0.4)]
            hover:-translate-y-0.5
            transition-all duration-200
            disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none
            flex items-center justify-center gap-2
          "
        >
          {isProcessing ? (
            <>
              <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              処理中...
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
              レイヤーリネーム実行
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// === Sub Components ===

function CheckBox({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <div
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 cursor-pointer select-none"
    >
      <div
        className={`
          w-4 h-4 rounded border flex items-center justify-center transition-all flex-shrink-0
          ${checked ? "bg-accent border-accent" : "border-text-muted/30 hover:border-text-muted/50"}
        `}
      >
        {checked && (
          <svg
            className="w-3 h-3 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={3}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </div>
      {children}
    </div>
  );
}
