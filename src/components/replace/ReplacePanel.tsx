import { open } from "@tauri-apps/plugin-dialog";
import { useReplaceStore } from "../../store/replaceStore";
import { useReplaceProcessor } from "../../hooks/useReplaceProcessor";
import { ReplacePairingModal } from "./ReplacePairingModal";
import { ReplaceToast } from "./ReplaceToast";
import type { ReplaceMode, ComposeSource, ComposeRestSource } from "../../types/replace";

export function ReplacePanel() {
  const folders = useReplaceStore((s) => s.folders);
  const settings = useReplaceStore((s) => s.settings);
  const setSourceFolder = useReplaceStore((s) => s.setSourceFolder);
  const setTargetFolder = useReplaceStore((s) => s.setTargetFolder);
  const setMode = useReplaceStore((s) => s.setMode);
  const setTextSubMode = useReplaceStore((s) => s.setTextSubMode);
  const setTextGroupName = useReplaceStore((s) => s.setTextGroupName);
  const setTextPartialMatch = useReplaceStore((s) => s.setTextPartialMatch);
  const setImageSettings = useReplaceStore((s) => s.setImageSettings);
  const setSwitchSettings = useReplaceStore((s) => s.setSwitchSettings);
  const setSwitchSubMode = useReplaceStore((s) => s.setSwitchSubMode);
  const setGeneralSettings = useReplaceStore((s) => s.setGeneralSettings);
  const setSubfolderMode = useReplaceStore((s) => s.setSubfolderMode);
  const setComposeSettings = useReplaceStore((s) => s.setComposeSettings);
  const setComposeElementSource = useReplaceStore((s) => s.setComposeElementSource);
  const addComposeElement = useReplaceStore((s) => s.addComposeElement);
  const removeComposeElement = useReplaceStore((s) => s.removeComposeElement);
  const updateComposeElement = useReplaceStore((s) => s.updateComposeElement);
  const setComposeRestSource = useReplaceStore((s) => s.setComposeRestSource);
  const phase = useReplaceStore((s) => s.phase);
  const isModalOpen = useReplaceStore((s) => s.isModalOpen);

  const { scanAndPair, executeReplacement } = useReplaceProcessor();

  const batchFolders = useReplaceStore((s) => s.batchFolders);

  const hasBothFolders =
    settings.mode === "batch"
      ? folders.sourceFolder && (folders.targetFolder || batchFolders.length > 0)
      : folders.sourceFolder && folders.targetFolder;
  const isScanning = phase === "scanning" || phase === "pairing";

  // 画像モードで少なくとも1つ選択されているか
  const hasImageSelection =
    settings.imageSettings.replaceBackground ||
    settings.imageSettings.replaceSpecialLayer ||
    settings.imageSettings.replaceNamedGroup;

  // 合成モードで少なくとも1つexclude以外の要素があるか
  const hasComposeSelection =
    settings.composeSettings.elements.some((el) => el.source !== "exclude") ||
    settings.composeSettings.restSource !== "none";

  const canProceed =
    hasBothFolders &&
    !isScanning &&
    (settings.mode !== "image" || hasImageSelection) &&
    (settings.mode !== "compose" || hasComposeSelection);

  const isSwitch = settings.mode === "switch";
  const isCompose = settings.mode === "compose";
  const isWhiteToBar = settings.switchSettings.subMode === "whiteToBar";

  const handleSelectFolder = async (type: "source" | "target") => {
    const title = isCompose
      ? type === "source"
        ? "原稿Aフォルダを選択"
        : "原稿Bフォルダを選択"
      : isSwitch
        ? type === "source"
          ? "差替え元フォルダを選択"
          : "差替え対象フォルダを選択"
        : type === "source"
          ? "植字データフォルダを選択"
          : "画像データフォルダを選択";
    const selected = await open({ directory: true, title });
    if (selected) {
      if (type === "source") setSourceFolder(selected as string);
      else setTargetFolder(selected as string);
    }
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
              d="M8 7h12m0 0l-4-4m4 4l-4 4M16 17H4m0 0l4-4m-4 4l4 4"
            />
          </svg>
          レイヤー差替え
        </h3>
        <p className="text-xs text-text-muted mt-1">植字データと画像データ間でレイヤーを差し替え</p>
      </div>

      {/* Settings */}
      <div className="flex-1 overflow-auto p-3 space-y-3">
        {/* Folder Selection */}
        <div className="bg-bg-tertiary rounded-xl p-3">
          <h4 className="text-xs font-medium text-text-muted mb-2">フォルダ選択</h4>
          <div className="space-y-2">
            <FolderPicker
              label={
                isCompose
                  ? "原稿A"
                  : isSwitch
                    ? isWhiteToBar
                      ? "棒消しデータ"
                      : "白消しデータ"
                    : "植字データ"
              }
              path={folders.sourceFolder}
              displayName={getLastFolderName(folders.sourceFolder)}
              onSelect={() => handleSelectFolder("source")}
              onClear={() => setSourceFolder(null)}
              color={isSwitch ? "warning" : "accent"}
            />
            <FolderPicker
              label={isCompose ? "原稿B" : isSwitch ? "差替え対象PSD" : "画像データ"}
              path={folders.targetFolder}
              displayName={getLastFolderName(folders.targetFolder)}
              onSelect={() => handleSelectFolder("target")}
              onClear={() => setTargetFolder(null)}
              color="accent-secondary"
            />
          </div>
          {settings.mode !== "batch" && (
            <div className="mt-2 pt-2 border-t border-white/5">
              <CheckBox
                checked={settings.subfolderSettings.mode === "advanced"}
                onChange={(v) => setSubfolderMode(v ? "advanced" : "none")}
              >
                <span className="text-[10px] text-text-secondary">サブフォルダ対応</span>
              </CheckBox>
            </div>
          )}
        </div>

        {/* Mode Selection */}
        <div className="bg-bg-tertiary rounded-xl p-3">
          <h4 className="text-xs font-medium text-text-muted mb-2">差替えモード</h4>
          <div className="space-y-2">
            {/* Text Mode */}
            <ModeCard
              mode="text"
              currentMode={settings.mode}
              label="テキスト差替え"
              description="植字データ → 画像データ"
              icon={<TextIcon />}
              color="accent"
              onSelect={setMode}
            />
            {settings.mode === "text" && (
              <div className="ml-3 pl-3 border-l-2 border-accent/30 space-y-2">
                <label
                  className="flex items-center gap-2 cursor-pointer"
                  onClick={() => setTextSubMode("textLayers")}
                >
                  <RadioDot selected={settings.textSettings.subMode === "textLayers"} />
                  <div>
                    <span className="text-xs text-text-primary">テキストレイヤーを差替え</span>
                    <p className="text-[10px] text-text-muted">
                      フォルダ階層を維持、画像レイヤーは除外
                    </p>
                  </div>
                </label>
                <label
                  className="flex items-center gap-2 cursor-pointer"
                  onClick={() => setTextSubMode("namedGroup")}
                >
                  <RadioDot selected={settings.textSettings.subMode === "namedGroup"} />
                  <div>
                    <span className="text-xs text-text-primary">特定名グループを差替え</span>
                  </div>
                </label>
                {settings.textSettings.subMode === "namedGroup" && (
                  <div className="space-y-1.5">
                    <input
                      type="text"
                      value={settings.textSettings.groupName}
                      onChange={(e) => setTextGroupName(e.target.value)}
                      placeholder="グループ名"
                      className="w-full bg-bg-elevated border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none"
                    />
                    <CheckBox
                      checked={settings.textSettings.partialMatch}
                      onChange={setTextPartialMatch}
                    >
                      <span className="text-[10px] text-text-secondary">部分一致</span>
                    </CheckBox>
                  </div>
                )}

                <div className="pt-1 mt-1 border-t border-accent/15">
                  <CheckBox
                    checked={settings.generalSettings.roundFontSize}
                    onChange={(v) => setGeneralSettings({ roundFontSize: v })}
                  >
                    <span className="text-[10px] text-text-secondary">フォントサイズを丸める</span>
                  </CheckBox>
                </div>
              </div>
            )}

            {/* Image Mode */}
            <ModeCard
              mode="image"
              currentMode={settings.mode}
              label="画像差替え"
              description="画像データ → 植字データ"
              icon={<ImageIcon />}
              color="accent-secondary"
              onSelect={setMode}
            />
            {settings.mode === "image" && (
              <div className="ml-3 pl-3 border-l-2 border-accent-secondary/30 space-y-2">
                {/* Background */}
                <CheckBox
                  checked={settings.imageSettings.replaceBackground}
                  onChange={(v) => setImageSettings({ replaceBackground: v })}
                >
                  <span className="text-xs text-text-primary">背景レイヤー差替え</span>
                </CheckBox>

                {/* Special Layer */}
                <CheckBox
                  checked={settings.imageSettings.replaceSpecialLayer}
                  onChange={(v) => setImageSettings({ replaceSpecialLayer: v })}
                >
                  <span className="text-xs text-text-primary">特定名レイヤー差替え</span>
                </CheckBox>
                {settings.imageSettings.replaceSpecialLayer && (
                  <div className="ml-6 space-y-1.5">
                    <input
                      type="text"
                      value={settings.imageSettings.specialLayerName}
                      onChange={(e) => setImageSettings({ specialLayerName: e.target.value })}
                      placeholder="レイヤー名"
                      className="w-full bg-bg-elevated border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-primary focus:border-accent-secondary focus:outline-none"
                    />
                    <CheckBox
                      checked={settings.imageSettings.specialLayerPartialMatch}
                      onChange={(v) => setImageSettings({ specialLayerPartialMatch: v })}
                    >
                      <span className="text-[10px] text-text-secondary">部分一致</span>
                    </CheckBox>
                  </div>
                )}

                {/* Named Group */}
                <CheckBox
                  checked={settings.imageSettings.replaceNamedGroup}
                  onChange={(v) => setImageSettings({ replaceNamedGroup: v })}
                >
                  <span className="text-xs text-text-primary">特定名グループ差替え</span>
                </CheckBox>
                {settings.imageSettings.replaceNamedGroup && (
                  <div className="ml-6 space-y-1.5">
                    <input
                      type="text"
                      value={settings.imageSettings.namedGroupName}
                      onChange={(e) => setImageSettings({ namedGroupName: e.target.value })}
                      placeholder="グループ名"
                      className="w-full bg-bg-elevated border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-primary focus:border-accent-secondary focus:outline-none"
                    />
                    <CheckBox
                      checked={settings.imageSettings.namedGroupPartialMatch}
                      onChange={(v) => setImageSettings({ namedGroupPartialMatch: v })}
                    >
                      <span className="text-[10px] text-text-secondary">部分一致</span>
                    </CheckBox>
                    <CheckBox
                      checked={settings.imageSettings.placeFromBottom}
                      onChange={(v) => setImageSettings({ placeFromBottom: v })}
                    >
                      <span className="text-[10px] text-text-secondary">
                        下から数えて同じ位置に配置
                      </span>
                    </CheckBox>
                  </div>
                )}

                <div className="pt-1 mt-1 border-t border-accent-secondary/15">
                  <CheckBox
                    checked={settings.generalSettings.skipResize}
                    onChange={(v) => setGeneralSettings({ skipResize: v })}
                  >
                    <span className="text-[10px] text-text-secondary">サイズ変更を行わない</span>
                  </CheckBox>
                </div>
              </div>
            )}

            {/* Batch Mode */}
            <ModeCard
              mode="batch"
              currentMode={settings.mode}
              label="同時処理"
              description="白消し・棒消しを一括差替え"
              icon={<BatchIcon />}
              color="accent-tertiary"
              onSelect={setMode}
            />
            {settings.mode === "batch" && (
              <div className="ml-3 pl-3 border-l-2 border-accent-tertiary/30 space-y-2">
                <p className="text-[10px] text-text-muted">
                  画像データフォルダのサブフォルダ（白消し、棒消し等）を
                  自動検出して植字データに一括適用します。
                  特定名レイヤー・グループの部分一致が自動で有効になります。
                </p>
                <div className="pt-1 border-t border-accent-tertiary/15 space-y-1.5">
                  <CheckBox
                    checked={settings.generalSettings.roundFontSize}
                    onChange={(v) => setGeneralSettings({ roundFontSize: v })}
                  >
                    <span className="text-[10px] text-text-secondary">フォントサイズを丸める</span>
                  </CheckBox>
                  <CheckBox
                    checked={settings.generalSettings.skipResize}
                    onChange={(v) => setGeneralSettings({ skipResize: v })}
                  >
                    <span className="text-[10px] text-text-secondary">サイズ変更を行わない</span>
                  </CheckBox>
                </div>
              </div>
            )}

            {/* Switch Mode */}
            <ModeCard
              mode="switch"
              currentMode={settings.mode}
              label="スイッチ差替え"
              description="白消し ⇔ 棒消し を切り替え"
              icon={<SwitchIcon />}
              color="warning"
              onSelect={setMode}
            />
            {settings.mode === "switch" && (
              <div className="ml-3 pl-3 border-l-2 border-warning/30 space-y-2">
                <label
                  className="flex items-center gap-2 cursor-pointer"
                  onClick={() => setSwitchSubMode("whiteToBar")}
                >
                  <RadioDot selected={settings.switchSettings.subMode === "whiteToBar"} />
                  <div>
                    <span className="text-xs text-text-primary">白消し → 棒消し</span>
                    <p className="text-[10px] text-text-muted">
                      白消しレイヤーを非表示にして棒消しグループをコピー
                    </p>
                  </div>
                </label>
                <label
                  className="flex items-center gap-2 cursor-pointer"
                  onClick={() => setSwitchSubMode("barToWhite")}
                >
                  <RadioDot selected={settings.switchSettings.subMode === "barToWhite"} />
                  <div>
                    <span className="text-xs text-text-primary">棒消し → 白消し</span>
                    <p className="text-[10px] text-text-muted">
                      棒消しグループを非表示にして白消しレイヤーをコピー
                    </p>
                  </div>
                </label>

                <div className="pt-1 mt-1 border-t border-warning/15 space-y-1.5">
                  <CheckBox
                    checked={settings.switchSettings.placeFromBottom}
                    onChange={(v) => setSwitchSettings({ placeFromBottom: v })}
                  >
                    <span className="text-[10px] text-text-secondary">
                      下から数えて同じ位置に配置
                    </span>
                  </CheckBox>
                  <CheckBox
                    checked={settings.generalSettings.skipResize}
                    onChange={(v) => setGeneralSettings({ skipResize: v })}
                  >
                    <span className="text-[10px] text-text-secondary">サイズ変更を行わない</span>
                  </CheckBox>
                </div>
              </div>
            )}

            {/* Compose Mode */}
            <ModeCard
              mode="compose"
              currentMode={settings.mode}
              label="合成"
              description="2種類の原稿から要素を選択して合成"
              icon={<ComposeIcon />}
              color="warning"
              onSelect={setMode}
            />
            {settings.mode === "compose" && (
              <div className="ml-3 pl-3 border-l-2 border-warning/30 space-y-2">
                <p className="text-[10px] text-text-muted">
                  原稿Aと原稿Bから要素ごとにソースを選択して合成します。
                </p>

                {/* Element list */}
                <div className="space-y-1.5">
                  {settings.composeSettings.elements.map((el) => (
                    <div key={el.id}>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-text-primary flex-1 min-w-0 truncate">
                          {el.label}
                        </span>
                        <SourcePill
                          value={el.source}
                          onChange={(s) => setComposeElementSource(el.id, s)}
                        />
                        {el.type === "custom" && (
                          <button
                            onClick={() => removeComposeElement(el.id)}
                            className="flex-shrink-0 p-0.5 rounded text-text-muted hover:text-error transition-colors"
                          >
                            <svg
                              className="w-3 h-3"
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
                        )}
                      </div>

                      {/* Options for specialLayer / namedGroup / custom */}
                      {(el.type === "specialLayer" ||
                        el.type === "namedGroup" ||
                        el.type === "custom") &&
                        el.source !== "exclude" && (
                          <div className="ml-4 mt-1 space-y-1">
                            {el.type === "custom" && (
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="text"
                                  value={el.customName || ""}
                                  onChange={(e) =>
                                    updateComposeElement(el.id, {
                                      customName: e.target.value,
                                      label: e.target.value || "カスタム",
                                    })
                                  }
                                  placeholder="検索名"
                                  className="flex-1 bg-bg-elevated border border-white/10 rounded-lg px-2 py-1 text-[10px] text-text-primary focus:border-warning focus:outline-none"
                                />
                                <select
                                  value={el.customKind || "layer"}
                                  onChange={(e) =>
                                    updateComposeElement(el.id, {
                                      customKind: e.target.value as "layer" | "group",
                                    })
                                  }
                                  className="bg-bg-elevated border border-white/10 rounded-lg px-1.5 py-1 text-[10px] text-text-primary focus:border-warning focus:outline-none"
                                >
                                  <option value="layer">レイヤー</option>
                                  <option value="group">グループ</option>
                                </select>
                              </div>
                            )}
                            <CheckBox
                              checked={el.partialMatch ?? true}
                              onChange={(v) => updateComposeElement(el.id, { partialMatch: v })}
                            >
                              <span className="text-[10px] text-text-secondary">部分一致</span>
                            </CheckBox>
                          </div>
                        )}
                    </div>
                  ))}
                </div>

                {/* Add custom element */}
                <button
                  onClick={() => {
                    const id = "custom_" + Date.now();
                    addComposeElement({
                      id,
                      type: "custom",
                      label: "カスタム",
                      source: "A",
                      customName: "",
                      customKind: "layer",
                      partialMatch: true,
                    });
                  }}
                  className="flex items-center gap-1 text-[10px] text-warning hover:text-warning/80 transition-colors"
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
                  カスタム要素を追加
                </button>

                {/* Rest source */}
                <div className="pt-1.5 mt-1.5 border-t border-warning/15">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-text-primary flex-1">指定以外</span>
                    <RestSourcePill
                      value={settings.composeSettings.restSource}
                      onChange={setComposeRestSource}
                    />
                  </div>
                </div>

                {/* Options */}
                <div className="pt-1 mt-1 border-t border-warning/15 space-y-1.5">
                  <CheckBox
                    checked={settings.composeSettings.skipResize}
                    onChange={(v) => setComposeSettings({ skipResize: v })}
                  >
                    <span className="text-[10px] text-text-secondary">サイズ変更を行わない</span>
                  </CheckBox>
                  <CheckBox
                    checked={settings.composeSettings.roundFontSize}
                    onChange={(v) => setComposeSettings({ roundFontSize: v })}
                  >
                    <span className="text-[10px] text-text-secondary">フォントサイズを丸める</span>
                  </CheckBox>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Action Bar */}
      <div className="p-3 border-t border-white/5 space-y-2">
        {!hasBothFolders && (
          <p className="text-[10px] text-text-muted text-center">
            {isCompose
              ? "原稿Aと原稿Bのフォルダを選択してください"
              : "植字データと画像データのフォルダを選択してください"}
          </p>
        )}
        <button
          onClick={scanAndPair}
          disabled={!canProceed}
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
          {isScanning ? (
            <>
              <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              スキャン中...
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
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              ペアリング確認
            </>
          )}
        </button>
      </div>

      {/* Pairing Modal */}
      {isModalOpen && <ReplacePairingModal onExecute={executeReplacement} onRescan={scanAndPair} />}

      {/* Completion Toast */}
      <ReplaceToast />
    </div>
  );
}

// === Sub Components ===

function FolderPicker({
  label,
  path,
  displayName,
  onSelect,
  onClear,
  color,
}: {
  label: string;
  path: string | null;
  displayName: string;
  onSelect: () => void;
  onClear: () => void;
  color: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className={`w-1.5 h-8 rounded-full bg-${color} flex-shrink-0`} />
      <div className="flex-1 min-w-0">
        <span className="text-[10px] text-text-muted">{label}</span>
        {path ? (
          <div className="flex items-center gap-1">
            <p className="text-xs text-text-primary truncate" title={path}>
              {displayName}
            </p>
            <button
              onClick={onClear}
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
          </div>
        ) : (
          <button
            onClick={onSelect}
            className="text-xs text-accent hover:text-accent/80 transition-colors"
          >
            選択...
          </button>
        )}
      </div>
      {path && (
        <button
          onClick={onSelect}
          className="flex-shrink-0 px-2 py-1 text-[10px] bg-bg-elevated border border-white/10 rounded-lg text-text-secondary hover:text-text-primary transition-colors"
        >
          変更
        </button>
      )}
    </div>
  );
}

function ModeCard({
  mode,
  currentMode,
  label,
  description,
  icon,
  color,
  onSelect,
}: {
  mode: ReplaceMode;
  currentMode: ReplaceMode;
  label: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  onSelect: (mode: ReplaceMode) => void;
}) {
  const isSelected = currentMode === mode;

  return (
    <div
      className={`
        p-2.5 rounded-xl cursor-pointer transition-all duration-200
        ${
          isSelected
            ? `bg-${color}/15 border-2 border-${color}/50`
            : "bg-bg-elevated border-2 border-white/5 hover:border-white/10"
        }
      `}
      onClick={() => onSelect(mode)}
    >
      <div className="flex items-center gap-2.5">
        <div
          className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0
            ${isSelected ? `bg-${color} text-white` : "bg-bg-tertiary text-text-muted"}
          `}
        >
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-xs font-medium text-text-primary">{label}</span>
          <p className="text-[10px] text-text-muted">{description}</p>
        </div>
        <div
          className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0
            ${isSelected ? `border-${color} bg-${color}` : "border-text-muted/30"}
          `}
        >
          {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
        </div>
      </div>
    </div>
  );
}

function RadioDot({ selected }: { selected: boolean }) {
  return (
    <div
      className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center flex-shrink-0
        ${selected ? "border-accent bg-accent" : "border-text-muted/30"}
      `}
    >
      {selected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
    </div>
  );
}

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
      className="flex items-center gap-2 cursor-pointer"
    >
      <div
        className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-all
          ${
            checked
              ? "bg-gradient-to-br from-accent to-accent-secondary"
              : "border-2 border-text-muted/30 hover:border-text-muted/50"
          }
        `}
      >
        {checked && (
          <svg
            className="w-2.5 h-2.5 text-white"
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

// === Icons ===

function TextIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h8m-8 6h16" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
      />
    </svg>
  );
}

function BatchIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
      />
    </svg>
  );
}

function SwitchIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7 16V4m0 0L3 8m4-4l4 4m6 4v12m0 0l4-4m-4 4l-4-4"
      />
    </svg>
  );
}

function ComposeIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zm-5 9l3 3m0 0l3-3m-3 3V10"
      />
    </svg>
  );
}

function SourcePill({
  value,
  onChange,
}: {
  value: ComposeSource;
  onChange: (value: ComposeSource) => void;
}) {
  const options: { key: ComposeSource; label: string }[] = [
    { key: "A", label: "A" },
    { key: "B", label: "B" },
    { key: "exclude", label: "除外" },
  ];
  return (
    <div className="flex rounded-lg overflow-hidden border border-white/10 flex-shrink-0">
      {options.map((opt) => (
        <button
          key={opt.key}
          onClick={() => onChange(opt.key)}
          className={`px-2 py-0.5 text-[10px] font-medium transition-colors
            ${
              value === opt.key
                ? opt.key === "A"
                  ? "bg-accent text-white"
                  : opt.key === "B"
                    ? "bg-accent-secondary text-white"
                    : "bg-text-muted/30 text-text-primary"
                : "bg-bg-elevated text-text-muted hover:text-text-secondary"
            }
          `}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function RestSourcePill({
  value,
  onChange,
}: {
  value: ComposeRestSource;
  onChange: (value: ComposeRestSource) => void;
}) {
  const options: { key: ComposeRestSource; label: string }[] = [
    { key: "A", label: "原稿A" },
    { key: "B", label: "原稿B" },
    { key: "none", label: "なし" },
  ];
  return (
    <div className="flex rounded-lg overflow-hidden border border-white/10 flex-shrink-0">
      {options.map((opt) => (
        <button
          key={opt.key}
          onClick={() => onChange(opt.key)}
          className={`px-2 py-0.5 text-[10px] font-medium transition-colors
            ${
              value === opt.key
                ? opt.key === "A"
                  ? "bg-accent text-white"
                  : opt.key === "B"
                    ? "bg-accent-secondary text-white"
                    : "bg-text-muted/30 text-text-primary"
                : "bg-bg-elevated text-text-muted hover:text-text-secondary"
            }
          `}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
