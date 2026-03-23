import { open } from "@tauri-apps/plugin-dialog";
import { useComposeStore } from "../../store/composeStore";
import { useComposeProcessor } from "../../hooks/useComposeProcessor";
import { ComposePairingModal } from "./ComposePairingModal";
import { ComposeToast } from "./ComposeToast";
import type { ComposeSource, ComposeRestSource } from "../../types/replace";

export function ComposePanel() {
  const folders = useComposeStore((s) => s.folders);
  const composeSettings = useComposeStore((s) => s.composeSettings);
  const setSourceFolder = useComposeStore((s) => s.setSourceFolder);
  const setTargetFolder = useComposeStore((s) => s.setTargetFolder);
  const setComposeSettings = useComposeStore((s) => s.setComposeSettings);
  const setComposeElementSource = useComposeStore((s) => s.setComposeElementSource);
  const addComposeElement = useComposeStore((s) => s.addComposeElement);
  const removeComposeElement = useComposeStore((s) => s.removeComposeElement);
  const updateComposeElement = useComposeStore((s) => s.updateComposeElement);
  const setComposeRestSource = useComposeStore((s) => s.setComposeRestSource);
  const organizePre = useComposeStore((s) => s.organizePre);
  const setOrganizePre = useComposeStore((s) => s.setOrganizePre);
  const subfolderSettings = useComposeStore((s) => s.subfolderSettings);
  const setSubfolderMode = useComposeStore((s) => s.setSubfolderMode);
  const phase = useComposeStore((s) => s.phase);
  const isModalOpen = useComposeStore((s) => s.isModalOpen);

  const { scanAndPair, executeReplacement } = useComposeProcessor();

  const hasBothFolders = folders.sourceFolder && folders.targetFolder;
  const isScanning = phase === "scanning" || phase === "pairing";

  // 少なくとも1つexclude以外の要素があるか
  const hasComposeSelection =
    composeSettings.elements.some((el) => el.source !== "exclude") ||
    composeSettings.restSource !== "none";

  const canProceed = hasBothFolders && !isScanning && hasComposeSelection;

  const handleSelectFolder = async (type: "source" | "target") => {
    const title = type === "source" ? "原稿Aフォルダを選択" : "原稿Bフォルダを選択";
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
            className="w-4 h-4 text-warning"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zm-5 9l3 3m0 0l3-3m-3 3V10"
            />
          </svg>
          レイヤー合成
        </h3>
        <p className="text-xs text-text-muted mt-1">原稿Aと原稿Bから要素を選択して合成</p>
      </div>

      {/* Settings */}
      <div className="flex-1 overflow-auto p-3 space-y-3">
        {/* Folder Selection */}
        <div className="bg-bg-tertiary rounded-xl p-3">
          <h4 className="text-xs font-medium text-text-muted mb-2">フォルダ選択</h4>
          <div className="space-y-2">
            <FolderPicker
              label="原稿A"
              path={folders.sourceFolder}
              displayName={getLastFolderName(folders.sourceFolder)}
              onSelect={() => handleSelectFolder("source")}
              onClear={() => setSourceFolder(null)}
              color="accent"
            />
            <FolderPicker
              label="原稿B"
              path={folders.targetFolder}
              displayName={getLastFolderName(folders.targetFolder)}
              onSelect={() => handleSelectFolder("target")}
              onClear={() => setTargetFolder(null)}
              color="accent-secondary"
            />
          </div>
          <div className="mt-2 pt-2 border-t border-white/5">
            <CheckBox
              checked={subfolderSettings.mode === "advanced"}
              onChange={(v) => setSubfolderMode(v ? "advanced" : "none")}
            >
              <span className="text-[10px] text-text-secondary">サブフォルダ対応</span>
            </CheckBox>
          </div>
        </div>

        {/* Pre-process: Organize layers */}
        <div className="bg-bg-tertiary rounded-xl p-3">
          <CheckBox checked={organizePre.enabled} onChange={(v) => setOrganizePre({ enabled: v })}>
            <div>
              <span className="text-xs text-text-primary font-medium">合成前にフォルダ格納</span>
              <p className="text-[9px] text-text-muted mt-0.5">
                原稿Bのレイヤーを指定フォルダに格納してから合成
              </p>
            </div>
          </CheckBox>
          {organizePre.enabled && (
            <div className="mt-2 pt-2 border-t border-white/5 space-y-2">
              <div>
                <span className="text-[10px] text-text-muted">格納先フォルダ名</span>
                <input
                  type="text"
                  value={organizePre.targetName}
                  onChange={(e) => setOrganizePre({ targetName: e.target.value })}
                  placeholder="#原稿#"
                  className="w-full mt-1 bg-bg-elevated border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-primary focus:border-warning focus:outline-none"
                />
              </div>
              <CheckBox
                checked={organizePre.includeSpecial}
                onChange={(v) => setOrganizePre({ includeSpecial: v })}
              >
                <span className="text-[10px] text-text-secondary">白消し・棒消しも格納する</span>
              </CheckBox>
            </div>
          )}
        </div>

        {/* Compose Settings */}
        <div className="bg-bg-tertiary rounded-xl p-3">
          <h4 className="text-xs font-medium text-text-muted mb-2">合成設定</h4>
          <p className="text-[10px] text-text-muted mb-2">
            原稿Aと原稿Bから要素ごとにソースを選択して合成します。
          </p>

          {/* Element list */}
          <div className="space-y-1.5">
            {composeSettings.elements.map((el) => {
              const isExclusivePair = el.id === "background" || el.id === "manuscript";
              const otherEl = isExclusivePair
                ? composeSettings.elements.find(
                    (e) => e.id === (el.id === "background" ? "manuscript" : "background"),
                  )
                : null;
              const otherIsActive = otherEl && otherEl.source !== "exclude";

              return (
                <div key={el.id}>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-text-primary flex-1 min-w-0 truncate">
                      {el.label}
                      {isExclusivePair && otherIsActive && el.source === "exclude" && (
                        <span className="text-[9px] text-text-muted ml-1">
                          ({otherEl!.label}と排他)
                        </span>
                      )}
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
              );
            })}
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
            className="flex items-center gap-1 text-[10px] text-warning hover:text-warning/80 transition-colors mt-2"
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
              <RestSourcePill value={composeSettings.restSource} onChange={setComposeRestSource} />
            </div>
          </div>

          {/* Options */}
          <div className="pt-1 mt-1 border-t border-warning/15 space-y-1.5">
            <CheckBox
              checked={composeSettings.skipResize}
              onChange={(v) => setComposeSettings({ skipResize: v })}
            >
              <span className="text-[10px] text-text-secondary">サイズ変更を行わない</span>
            </CheckBox>
            <CheckBox
              checked={composeSettings.roundFontSize}
              onChange={(v) => setComposeSettings({ roundFontSize: v })}
            >
              <span className="text-[10px] text-text-secondary">フォントサイズを丸める</span>
            </CheckBox>
          </div>
        </div>
      </div>

      {/* Action Bar */}
      <div className="p-3 border-t border-white/5 space-y-2">
        {!hasBothFolders && (
          <p className="text-[10px] text-text-muted text-center">
            原稿Aと原稿Bのフォルダを選択してください
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
      {isModalOpen && <ComposePairingModal onExecute={executeReplacement} onRescan={scanAndPair} />}

      {/* Completion Toast */}
      <ComposeToast />
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
