import { useState } from "react";
import {
  useLayerStore,
  PRESET_CONDITIONS,
  type HideCondition,
  type LayerActionMode,
  type LayerSaveMode,
} from "../../store/layerStore";
import { usePsdStore } from "../../store/psdStore";
import { useLayerControl } from "../../hooks/useLayerControl";
import { LayerControlResultDialog } from "./LayerControlResultDialog";

const LockIcon = () => (
  <svg
    className="w-3.5 h-3.5"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
  >
    <rect x="5" y="11" width="14" height="10" rx="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8 11V7a4 4 0 018 0v4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function LayerControlPanel() {
  const [customName, setCustomName] = useState("");
  const [customType, setCustomType] = useState<"layerName" | "folderName">("layerName");
  const [partialMatch, setPartialMatch] = useState(true);

  const selectedConditions = useLayerStore((state) => state.selectedConditions);
  const customConditions = useLayerStore((state) => state.customConditions);
  const toggleCondition = useLayerStore((state) => state.toggleCondition);
  const addCustomCondition = useLayerStore((state) => state.addCustomCondition);
  const removeCustomCondition = useLayerStore((state) => state.removeCustomCondition);
  const isProcessing = useLayerStore((state) => state.isProcessing);
  const actionMode = useLayerStore((state) => state.actionMode);
  const setActionMode = useLayerStore((state) => state.setActionMode);
  const saveMode = useLayerStore((state) => state.saveMode);
  const setSaveMode = useLayerStore((state) => state.setSaveMode);
  const organizeTargetName = useLayerStore((state) => state.organizeTargetName);
  const setOrganizeTargetName = useLayerStore((state) => state.setOrganizeTargetName);
  const organizeIncludeSpecial = useLayerStore((state) => state.organizeIncludeSpecial);
  const setOrganizeIncludeSpecial = useLayerStore((state) => state.setOrganizeIncludeSpecial);
  const deleteHiddenText = useLayerStore((state) => state.deleteHiddenText);
  const setDeleteHiddenText = useLayerStore((state) => state.setDeleteHiddenText);
  const lockBottomLayer = useLayerStore((state) => state.lockBottomLayer);
  const setLockBottomLayer = useLayerStore((state) => state.setLockBottomLayer);
  const unlockAllLayers = useLayerStore((state) => state.unlockAllLayers);
  const setUnlockAllLayers = useLayerStore((state) => state.setUnlockAllLayers);
  const files = usePsdStore((state) => state.files);
  const selectedFileIds = usePsdStore((state) => state.selectedFileIds);

  // レイヤー整理（条件ベース移動）のステート
  const layerMoveTargetName = useLayerStore((state) => state.layerMoveTargetName);
  const setLayerMoveTargetName = useLayerStore((state) => state.setLayerMoveTargetName);
  const layerMoveCreateIfMissing = useLayerStore((state) => state.layerMoveCreateIfMissing);
  const setLayerMoveCreateIfMissing = useLayerStore((state) => state.setLayerMoveCreateIfMissing);
  const layerMoveSearchScope = useLayerStore((state) => state.layerMoveSearchScope);
  const setLayerMoveSearchScope = useLayerStore((state) => state.setLayerMoveSearchScope);
  const layerMoveSearchGroupName = useLayerStore((state) => state.layerMoveSearchGroupName);
  const setLayerMoveSearchGroupName = useLayerStore((state) => state.setLayerMoveSearchGroupName);
  const layerMoveCondTextLayer = useLayerStore((state) => state.layerMoveCondTextLayer);
  const setLayerMoveCondTextLayer = useLayerStore((state) => state.setLayerMoveCondTextLayer);
  const layerMoveCondSubgroupTop = useLayerStore((state) => state.layerMoveCondSubgroupTop);
  const setLayerMoveCondSubgroupTop = useLayerStore((state) => state.setLayerMoveCondSubgroupTop);
  const layerMoveCondSubgroupBottom = useLayerStore((state) => state.layerMoveCondSubgroupBottom);
  const setLayerMoveCondSubgroupBottom = useLayerStore(
    (state) => state.setLayerMoveCondSubgroupBottom,
  );
  const layerMoveCondNameEnabled = useLayerStore((state) => state.layerMoveCondNameEnabled);
  const setLayerMoveCondNameEnabled = useLayerStore((state) => state.setLayerMoveCondNameEnabled);
  const layerMoveCondName = useLayerStore((state) => state.layerMoveCondName);
  const setLayerMoveCondName = useLayerStore((state) => state.setLayerMoveCondName);
  const layerMoveCondNamePartial = useLayerStore((state) => state.layerMoveCondNamePartial);
  const setLayerMoveCondNamePartial = useLayerStore((state) => state.setLayerMoveCondNamePartial);

  // カスタム操作
  const customVisibilityOps = useLayerStore((state) => state.customVisibilityOps);
  const customMoveOps = useLayerStore((state) => state.customMoveOps);
  const clearCustomOps = useLayerStore((state) => state.clearCustomOps);

  const mergeReorganizeText = useLayerStore((state) => state.mergeReorganizeText);
  const setMergeReorganizeText = useLayerStore((state) => state.setMergeReorganizeText);
  const mergeOutputFolderName = useLayerStore((state) => state.mergeOutputFolderName);
  const setMergeOutputFolderName = useLayerStore((state) => state.setMergeOutputFolderName);

  const {
    applyLayerVisibility,
    organizeLayersIntoFolder,
    moveLayersByConditions,
    applyCustomOperations,
    applyLayerLock,
    applyMergeLayers,
  } = useLayerControl();

  const targetCount = selectedFileIds.length > 0 ? selectedFileIds.length : files.length;
  const isHideMode = actionMode === "hide";
  const isOrganizeMode = actionMode === "organize";
  const isLayerMoveMode = actionMode === "layerMove";
  const isCustomMode = actionMode === "custom";
  const isLockMode = actionMode === "lock";
  const isMergeMode = actionMode === "merge";

  // カスタム操作のサマリー
  const customVisCount = Array.from(customVisibilityOps.values()).reduce(
    (acc, ops) => acc + ops.length,
    0,
  );
  const customMoveCount = Array.from(customMoveOps.values()).reduce(
    (acc, ops) => acc + ops.length,
    0,
  );
  const customTotalCount = customVisCount + customMoveCount;

  const hasAnyLayerMoveCondition =
    layerMoveCondTextLayer ||
    layerMoveCondSubgroupTop ||
    layerMoveCondSubgroupBottom ||
    layerMoveCondNameEnabled;
  const layerMoveCondCount = [
    layerMoveCondTextLayer,
    layerMoveCondSubgroupTop,
    layerMoveCondSubgroupBottom,
    layerMoveCondNameEnabled,
  ].filter(Boolean).length;

  const handleAddCustom = () => {
    if (!customName.trim()) return;
    addCustomCondition({
      name: `「${customName}」${customType === "layerName" ? "レイヤー" : "フォルダ"}`,
      type: customType,
      value: customName,
      partialMatch,
    });
    setCustomName("");
  };

  const handleApply = async () => {
    try {
      if (isMergeMode) {
        await applyMergeLayers();
      } else if (isLockMode) {
        await applyLayerLock();
      } else if (isCustomMode) {
        await applyCustomOperations();
      } else if (isOrganizeMode) {
        await organizeLayersIntoFolder();
      } else if (isLayerMoveMode) {
        await moveLayersByConditions();
      } else {
        await applyLayerVisibility();
      }
    } catch (error) {
      console.error("Layer operation failed:", error);
    }
  };

  const canExecute = isMergeMode
    ? !isProcessing && files.length > 0
    : isLockMode
      ? !isProcessing && files.length > 0 && (lockBottomLayer || unlockAllLayers)
      : isCustomMode
        ? !isProcessing && files.length > 0 && (customTotalCount > 0 || deleteHiddenText)
        : isOrganizeMode
          ? !isProcessing && files.length > 0 && organizeTargetName.trim() !== ""
          : isLayerMoveMode
            ? !isProcessing &&
              files.length > 0 &&
              layerMoveTargetName.trim() !== "" &&
              hasAnyLayerMoveCondition
            : !isProcessing &&
              files.length > 0 &&
              (selectedConditions.length > 0 || (isHideMode && deleteHiddenText));

  return (
    <div className="flex flex-col h-full">
      {/* ヘッダー */}
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
              d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
            />
          </svg>
          {isMergeMode
            ? "レイヤー統合"
            : isLockMode
              ? "レイヤーロック"
              : isCustomMode
                ? "カスタム操作"
                : isLayerMoveMode
                  ? "レイヤー整理"
                  : isOrganizeMode
                    ? "フォルダ格納"
                    : "レイヤー可視性"}
        </h3>
        <p className="text-xs text-text-muted mt-1">
          {isMergeMode
            ? "背景を1枚に統合し、テキストグループを分離"
            : isLockMode
              ? "レイヤーのロック・ロック解除"
              : isCustomMode
                ? "レイヤーを個別に操作"
                : isLayerMoveMode
                  ? "条件に一致するレイヤーを指定グループに移動"
                  : isOrganizeMode
                    ? "レイヤーを指定フォルダに格納"
                    : "条件を選択してレイヤーを一括操作"}
        </p>
      </div>

      {/* 条件リスト */}
      <div className="flex-1 overflow-auto p-3 space-y-4">
        {/* モード切り替え */}
        <div className="bg-bg-tertiary rounded-xl p-1 flex flex-col gap-1">
          <div className="flex gap-1">
            <ModeButton
              mode="hide"
              label="非表示"
              icon={
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
                    d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                  />
                </svg>
              }
              currentMode={actionMode}
              onChange={setActionMode}
            />
            <ModeButton
              mode="show"
              label="表示"
              icon={
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
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                  />
                </svg>
              }
              currentMode={actionMode}
              onChange={setActionMode}
            />
            <ModeButton
              mode="custom"
              label="カスタム"
              icon={
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
                    d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                  />
                </svg>
              }
              currentMode={actionMode}
              onChange={setActionMode}
            />
          </div>
          <div className="h-px bg-white/5" />
          <div className="flex gap-1">
            <ModeButton
              mode="organize"
              label="格納"
              icon={
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
              }
              currentMode={actionMode}
              onChange={setActionMode}
            />
            <ModeButton
              mode="layerMove"
              label="整理"
              icon={
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
                    d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
                  />
                </svg>
              }
              currentMode={actionMode}
              onChange={setActionMode}
            />
            <ModeButton
              mode="lock"
              label="ロック"
              icon={<LockIcon />}
              currentMode={actionMode}
              onChange={setActionMode}
            />
            <ModeButton
              mode="merge"
              label="統合"
              icon={
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
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
              }
              currentMode={actionMode}
              onChange={setActionMode}
            />
          </div>
        </div>

        {isMergeMode ? (
          /* 統合モード設定 */
          <>
            <div className="bg-bg-tertiary rounded-xl p-3">
              <p className="text-xs text-text-secondary leading-relaxed">
                テキストグループはそのまま残し、それ以外のレイヤーを1枚の背景に統合します。
              </p>
            </div>

            {/* テキスト整理オプション */}
            <div className="bg-bg-tertiary rounded-xl p-3 space-y-2">
              <h4 className="text-xs font-medium text-text-muted">オプション</h4>
              <div
                className={`
                  flex items-center gap-2 p-2.5 rounded-xl cursor-pointer transition-all duration-200
                  ${
                    mergeReorganizeText
                      ? "bg-emerald-500/15 border border-emerald-500/50"
                      : "bg-bg-secondary border border-white/5 hover:border-white/10"
                  }
                `}
                onClick={() => setMergeReorganizeText(!mergeReorganizeText)}
              >
                <div
                  className={`
                    w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-all duration-200
                    ${
                      mergeReorganizeText
                        ? "bg-emerald-500 border-emerald-500"
                        : "border-text-muted/50"
                    }
                  `}
                >
                  {mergeReorganizeText && (
                    <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                </div>
                <div className="flex-1">
                  <span className="text-sm text-text-primary">テキスト整理</span>
                  <p className="text-[10px] text-text-muted mt-0.5">
                    散在するテキストレイヤーをテキストグループに集約
                  </p>
                </div>
              </div>
            </div>
          </>
        ) : isLockMode ? (
          /* ロックモード設定 */
          <>
            <div className="bg-bg-tertiary rounded-xl p-3 space-y-3">
              <div className="flex items-center gap-2">
                <svg
                  className="w-4 h-4 text-amber-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <p className="text-xs text-text-secondary leading-relaxed">
                  レイヤーのロック・ロック解除を行います。右のプレビューで対象を確認できます。
                </p>
              </div>
            </div>

            {/* ロック対象 */}
            <div className="bg-bg-tertiary rounded-xl p-3 space-y-2">
              <h4 className="text-xs font-medium text-text-muted">ロック</h4>
              <div
                className={`
                  flex items-center gap-2 p-2.5 rounded-xl cursor-pointer transition-all duration-200
                  ${
                    lockBottomLayer
                      ? "bg-amber-500/15 border border-amber-500/50"
                      : "bg-bg-secondary border border-white/5 hover:border-white/10"
                  }
                `}
                onClick={() => {
                  const next = !lockBottomLayer;
                  setLockBottomLayer(next);
                  if (next) setUnlockAllLayers(false);
                }}
              >
                <div
                  className={`
                    w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-all duration-200
                    ${lockBottomLayer ? "bg-amber-500 border-amber-500" : "border-text-muted/50"}
                  `}
                >
                  {lockBottomLayer && (
                    <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                </div>
                <div className="flex-1">
                  <span className="text-sm text-text-primary">最下層レイヤー</span>
                  <p className="text-[10px] text-text-muted mt-0.5">
                    各ファイルの最下位レイヤーをロック
                  </p>
                </div>
                <svg
                  className="w-4 h-4 text-amber-500/60 flex-shrink-0"
                  fill="none"
                  viewBox="0 0 16 16"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3.5" y="7" width="9" height="7" rx="1" />
                  <path d="M5.5 7V5a2.5 2.5 0 015 0v2" />
                </svg>
              </div>
            </div>

            {/* ロック解除 */}
            <div className="bg-bg-tertiary rounded-xl p-3 space-y-2">
              <h4 className="text-xs font-medium text-text-muted">ロック解除</h4>
              <div
                className={`
                  flex items-center gap-2 p-2.5 rounded-xl cursor-pointer transition-all duration-200
                  ${
                    unlockAllLayers
                      ? "bg-sky-500/15 border border-sky-500/50"
                      : "bg-bg-secondary border border-white/5 hover:border-white/10"
                  }
                `}
                onClick={() => {
                  const next = !unlockAllLayers;
                  setUnlockAllLayers(next);
                  if (next) setLockBottomLayer(false);
                }}
              >
                <div
                  className={`
                    w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-all duration-200
                    ${unlockAllLayers ? "bg-sky-500 border-sky-500" : "border-text-muted/50"}
                  `}
                >
                  {unlockAllLayers && (
                    <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                </div>
                <div className="flex-1">
                  <span className="text-sm text-text-primary">すべてのロックを解除</span>
                  <p className="text-[10px] text-text-muted mt-0.5">
                    全レイヤー・グループのロックを解除
                  </p>
                </div>
                <svg
                  className="w-4 h-4 text-sky-500/60 flex-shrink-0"
                  fill="none"
                  viewBox="0 0 16 16"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3.5" y="7" width="9" height="7" rx="1" />
                  <path d="M5.5 7V5a2.5 2.5 0 015 0" />
                </svg>
              </div>
            </div>
          </>
        ) : isCustomMode ? (
          /* カスタム操作モード */
          <>
            <div className="bg-bg-tertiary rounded-xl p-3 space-y-3">
              <div className="flex items-center gap-2">
                <svg
                  className="w-4 h-4 text-sky-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <p className="text-xs text-text-secondary leading-relaxed">
                  右のプレビューでレイヤーの目アイコンをクリックして、個別に表示/非表示を設定できます。
                </p>
              </div>
            </div>

            {/* 操作サマリー */}
            <div className="bg-bg-tertiary rounded-xl p-3 space-y-2">
              <h4 className="text-xs font-medium text-text-muted">操作一覧</h4>
              {customTotalCount === 0 ? (
                <p className="text-xs text-text-muted/60 py-2 text-center">
                  まだ操作が登録されていません
                </p>
              ) : (
                <div className="space-y-1.5">
                  {customVisCount > 0 && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="w-2 h-2 rounded-full bg-sky-400" />
                      <span className="text-text-secondary">表示/非表示: {customVisCount} 件</span>
                    </div>
                  )}
                  {customMoveCount > 0 && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="w-2 h-2 rounded-full bg-violet-400" />
                      <span className="text-text-secondary">移動: {customMoveCount} 件</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* クリアボタン */}
            {customTotalCount > 0 && (
              <button
                onClick={() => clearCustomOps()}
                className="w-full px-3 py-2 text-xs font-medium rounded-lg bg-bg-elevated text-text-secondary border border-white/10 hover:border-error/30 hover:text-error transition-all duration-200"
              >
                すべてクリア
              </button>
            )}

            {/* 非表示テキストレイヤー削除オプション */}
            <div className="bg-bg-tertiary rounded-xl p-3">
              <div
                className={`
                  flex items-center gap-2 p-2.5 rounded-xl cursor-pointer transition-all duration-200
                  ${
                    deleteHiddenText
                      ? "bg-error/15 border border-error/50"
                      : "bg-bg-secondary border border-white/5 hover:border-white/10"
                  }
                `}
                onClick={() => setDeleteHiddenText(!deleteHiddenText)}
              >
                <div
                  className={`
                    w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-all duration-200
                    ${deleteHiddenText ? "bg-error border-error" : "border-text-muted/50"}
                  `}
                >
                  {deleteHiddenText && (
                    <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                </div>
                <span className="text-sm text-text-primary flex-1">
                  非表示テキストレイヤーを削除
                </span>
                <svg
                  className="w-4 h-4 text-error/60 flex-shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                  />
                </svg>
              </div>
              <p className="text-[10px] text-text-muted mt-1.5 px-1 leading-tight">
                非表示のテキストレイヤーをすべて削除します（元に戻せません）
              </p>
            </div>
          </>
        ) : isLayerMoveMode ? (
          /* レイヤー整理（条件ベース移動）モード設定 */
          <>
            {/* 検索範囲 */}
            <div className="bg-bg-tertiary rounded-xl p-3 space-y-2">
              <h4 className="text-xs font-medium text-text-muted">検索範囲</h4>
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="layerMoveSearchScope"
                    checked={layerMoveSearchScope === "all"}
                    onChange={() => setLayerMoveSearchScope("all")}
                    className="accent-violet-500"
                  />
                  <span className="text-sm text-text-primary">ドキュメント全体</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="layerMoveSearchScope"
                    checked={layerMoveSearchScope === "group"}
                    onChange={() => setLayerMoveSearchScope("group")}
                    className="accent-violet-500"
                  />
                  <span className="text-sm text-text-primary">特定グループ内</span>
                </label>
                {layerMoveSearchScope === "group" && (
                  <input
                    type="text"
                    value={layerMoveSearchGroupName}
                    onChange={(e) => setLayerMoveSearchGroupName(e.target.value)}
                    placeholder="グループ名"
                    className="w-full bg-bg-elevated border border-white/10 rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-violet-500 focus:outline-none ml-5"
                    style={{ width: "calc(100% - 20px)" }}
                  />
                )}
              </div>
            </div>

            {/* 移動先グループ */}
            <div>
              <h4 className="text-xs font-medium text-text-muted mb-2">移動先グループ</h4>
              <input
                type="text"
                value={layerMoveTargetName}
                onChange={(e) => setLayerMoveTargetName(e.target.value)}
                placeholder="移動先グループ名"
                className="w-full bg-bg-elevated border border-white/10 rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-violet-500 focus:outline-none"
              />
              <div
                className={`
                  flex items-center gap-2 p-2.5 rounded-xl cursor-pointer transition-all duration-200 mt-2
                  ${
                    layerMoveCreateIfMissing
                      ? "bg-violet-500/15 border border-violet-500/50"
                      : "bg-bg-secondary border border-white/5 hover:border-white/10"
                  }
                `}
                onClick={() => setLayerMoveCreateIfMissing(!layerMoveCreateIfMissing)}
              >
                <div
                  className={`
                    w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-all duration-200
                    ${
                      layerMoveCreateIfMissing
                        ? "bg-violet-500 border-violet-500"
                        : "border-text-muted/50"
                    }
                  `}
                >
                  {layerMoveCreateIfMissing && (
                    <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                </div>
                <span className="text-sm text-text-primary flex-1">存在しない場合は新規作成</span>
              </div>
            </div>

            {/* 条件（AND論理） */}
            <div className="bg-bg-tertiary rounded-xl p-3 space-y-2">
              <h4 className="text-xs font-medium text-text-muted">条件（すべて一致で移動）</h4>
              <div className="space-y-1.5">
                <LayerMoveConditionItem
                  label="テキストレイヤー"
                  checked={layerMoveCondTextLayer}
                  onToggle={() => setLayerMoveCondTextLayer(!layerMoveCondTextLayer)}
                />
                <LayerMoveConditionItem
                  label="サブグループの最上位レイヤー"
                  checked={layerMoveCondSubgroupTop}
                  onToggle={() => setLayerMoveCondSubgroupTop(!layerMoveCondSubgroupTop)}
                />
                <LayerMoveConditionItem
                  label="サブグループの最下位レイヤー"
                  checked={layerMoveCondSubgroupBottom}
                  onToggle={() => setLayerMoveCondSubgroupBottom(!layerMoveCondSubgroupBottom)}
                />
                <LayerMoveConditionItem
                  label="レイヤー名"
                  checked={layerMoveCondNameEnabled}
                  onToggle={() => setLayerMoveCondNameEnabled(!layerMoveCondNameEnabled)}
                />
                {layerMoveCondNameEnabled && (
                  <div className="ml-7 space-y-1.5">
                    <input
                      type="text"
                      value={layerMoveCondName}
                      onChange={(e) => setLayerMoveCondName(e.target.value)}
                      placeholder="レイヤー名"
                      className="w-full bg-bg-elevated border border-white/10 rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-violet-500 focus:outline-none"
                    />
                    <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
                      <input
                        type="checkbox"
                        checked={layerMoveCondNamePartial}
                        onChange={(e) => setLayerMoveCondNamePartial(e.target.checked)}
                        className="rounded accent-violet-500"
                      />
                      部分一致
                    </label>
                  </div>
                )}
              </div>
            </div>
          </>
        ) : isOrganizeMode ? (
          /* 整理モード設定 */
          <>
            {/* 格納先フォルダ名 */}
            <div>
              <h4 className="text-xs font-medium text-text-muted mb-2">格納先フォルダ名</h4>
              <input
                type="text"
                value={organizeTargetName}
                onChange={(e) => setOrganizeTargetName(e.target.value)}
                placeholder="#原稿#"
                className="w-full bg-bg-elevated border border-white/10 rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-warning focus:outline-none"
              />
            </div>

            {/* 格納対象 */}
            <div className="bg-bg-tertiary rounded-xl p-3 space-y-3">
              <h4 className="text-xs font-medium text-text-muted">格納対象</h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                テキストレイヤー・グループ・背景レイヤーを除く、ドキュメント直下の全レイヤーを格納先フォルダに移動します。
              </p>

              {/* 白消し・棒消し含むチェックボックス */}
              <div
                className={`
                  flex items-center gap-2 p-2.5 rounded-xl cursor-pointer transition-all duration-200
                  ${
                    organizeIncludeSpecial
                      ? "bg-warning/15 border border-warning/50"
                      : "bg-bg-secondary border border-white/5 hover:border-white/10"
                  }
                `}
                onClick={() => setOrganizeIncludeSpecial(!organizeIncludeSpecial)}
              >
                <div
                  className={`
                    w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-all duration-200
                    ${organizeIncludeSpecial ? "bg-warning border-warning" : "border-text-muted/50"}
                  `}
                >
                  {organizeIncludeSpecial && (
                    <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                </div>
                <span className="text-sm text-text-primary flex-1">白消し・棒消しも含む</span>
              </div>
              {!organizeIncludeSpecial && (
                <p className="text-[10px] text-text-muted px-1 leading-tight">
                  名前に「白消し」「棒消し」を含むレイヤーは除外されます
                </p>
              )}
            </div>

            {/* フォルダ作成 */}
            <div className="bg-bg-tertiary rounded-xl p-3">
              <div className="flex items-center gap-2">
                <svg
                  className="w-4 h-4 text-accent-tertiary"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <p className="text-xs text-text-secondary">
                  フォルダが存在しない場合は自動作成されます
                </p>
              </div>
            </div>
          </>
        ) : (
          /* 非表示/表示モード: 既存の条件リスト */
          <>
            {/* プリセット条件 */}
            <div>
              <h4 className="text-xs font-medium text-text-muted mb-2">プリセット条件</h4>
              <div className="space-y-1.5">
                {PRESET_CONDITIONS.map((condition) => (
                  <ConditionItem
                    key={condition.id}
                    condition={condition}
                    isSelected={selectedConditions.includes(condition.id)}
                    onToggle={() => toggleCondition(condition.id)}
                    isHideMode={isHideMode}
                  />
                ))}
              </div>
            </div>

            {/* カスタム条件 */}
            {customConditions.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-text-muted mb-2">カスタム条件</h4>
                <div className="space-y-1.5">
                  {customConditions.map((condition) => (
                    <ConditionItem
                      key={condition.id}
                      condition={condition}
                      isSelected={selectedConditions.includes(condition.id)}
                      onToggle={() => toggleCondition(condition.id)}
                      onRemove={() => removeCustomCondition(condition.id)}
                      isCustom
                      isHideMode={isHideMode}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* カスタム条件追加 */}
            <div className="bg-bg-tertiary rounded-xl p-3">
              <h4 className="text-xs font-medium text-text-muted mb-2">条件を追加</h4>
              <div className="space-y-2">
                <input
                  type="text"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="レイヤー/フォルダ名"
                  className="w-full bg-bg-elevated border border-white/10 rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-accent focus:outline-none"
                />
                <div className="flex gap-2">
                  <select
                    value={customType}
                    onChange={(e) => setCustomType(e.target.value as "layerName" | "folderName")}
                    className="flex-1 bg-bg-elevated border border-white/10 rounded-lg px-2 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none"
                  >
                    <option value="layerName">レイヤー名</option>
                    <option value="folderName">フォルダ名</option>
                  </select>
                  <label className="flex items-center gap-1.5 text-xs text-text-secondary">
                    <input
                      type="checkbox"
                      checked={partialMatch}
                      onChange={(e) => setPartialMatch(e.target.checked)}
                      className="rounded"
                    />
                    部分一致
                  </label>
                </div>
                <button
                  onClick={handleAddCustom}
                  disabled={!customName.trim()}
                  className="
                w-full px-3 py-2 text-xs font-medium rounded-lg
                bg-bg-elevated text-text-primary
                border border-white/10 hover:border-accent/30
                hover:bg-accent/10
                transition-all duration-200
                disabled:opacity-50 disabled:cursor-not-allowed
              "
                >
                  + 追加
                </button>
              </div>
            </div>
            {/* 非表示テキストレイヤー削除オプション */}
            {isHideMode && (
              <div className="bg-bg-tertiary rounded-xl p-3">
                <div
                  className={`
                  flex items-center gap-2 p-2.5 rounded-xl cursor-pointer transition-all duration-200
                  ${
                    deleteHiddenText
                      ? "bg-error/15 border border-error/50"
                      : "bg-bg-secondary border border-white/5 hover:border-white/10"
                  }
                `}
                  onClick={() => setDeleteHiddenText(!deleteHiddenText)}
                >
                  <div
                    className={`
                    w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-all duration-200
                    ${deleteHiddenText ? "bg-error border-error" : "border-text-muted/50"}
                  `}
                  >
                    {deleteHiddenText && (
                      <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </div>
                  <span className="text-sm text-text-primary flex-1">
                    非表示テキストレイヤーを削除
                  </span>
                  <svg
                    className="w-4 h-4 text-error/60 flex-shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                    />
                  </svg>
                </div>
                <p className="text-[10px] text-text-muted mt-1.5 px-1 leading-tight">
                  非表示のテキストレイヤーをすべて削除します（元に戻せません）
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {/* アクションバー */}
      <div className="p-3 border-t border-white/5 space-y-2">
        {/* 保存先切り替え */}
        {isMergeMode ? (
          <div className="bg-bg-tertiary rounded-xl px-3 py-2 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <label className="text-[10px] text-text-muted whitespace-nowrap">
                出力フォルダ名
              </label>
              <input
                type="text"
                value={mergeOutputFolderName}
                onChange={(e) => setMergeOutputFolderName(e.target.value)}
                placeholder={
                  files.length > 0
                    ? `${files[0].filePath.replace(/\\/g, "/").split("/").slice(-2, -1)[0] || "output"}_統合`
                    : "output"
                }
                className="flex-1 min-w-0 px-2 py-0.5 text-[11px] bg-white/80 border border-black/5 rounded-lg text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
              />
            </div>
            <p className="text-[10px] text-text-muted leading-tight">
              保存先: Desktop/Script_Output/レイヤー統合/
              {mergeOutputFolderName.trim() ||
                (files.length > 0
                  ? `${files[0].filePath.replace(/\\/g, "/").split("/").slice(-2, -1)[0] || ""}_統合`
                  : "")}
              /
            </p>
          </div>
        ) : (
          <SaveModeSelector
            saveMode={saveMode}
            onChange={setSaveMode}
            folderHint={
              files.length > 0
                ? files[0].filePath.replace(/\\/g, "/").split("/").slice(-2, -1)[0] || ""
                : ""
            }
            isOrganizeMode={isOrganizeMode || isLayerMoveMode || isCustomMode || isLockMode}
          />
        )}
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span>対象: {targetCount} ファイル</span>
          {isMergeMode ? null : isLockMode ? (
            <span>{lockBottomLayer || unlockAllLayers ? "1" : "0"} 条件選択中</span>
          ) : isCustomMode ? (
            <span>{customTotalCount} 操作登録中</span>
          ) : isLayerMoveMode ? (
            <span>{layerMoveCondCount} 条件選択中</span>
          ) : (
            !isOrganizeMode && <span>{selectedConditions.length} 条件選択中</span>
          )}
        </div>
        <button
          onClick={handleApply}
          disabled={!canExecute}
          className={`
            w-full px-4 py-3 text-sm font-medium rounded-xl text-white
            ${
              isMergeMode
                ? "bg-gradient-to-r from-emerald-500 to-teal-500 shadow-[0_4px_15px_rgba(16,185,129,0.3)] hover:shadow-[0_6px_20px_rgba(16,185,129,0.4)]"
                : isLockMode
                  ? "bg-gradient-to-r from-amber-500 to-yellow-500 shadow-[0_4px_15px_rgba(245,158,11,0.3)] hover:shadow-[0_6px_20px_rgba(245,158,11,0.4)]"
                  : isCustomMode
                    ? "bg-gradient-to-r from-sky-500 to-blue-500 shadow-[0_4px_15px_rgba(14,165,233,0.3)] hover:shadow-[0_6px_20px_rgba(14,165,233,0.4)]"
                    : isLayerMoveMode
                      ? "bg-gradient-to-r from-violet-500 to-purple-500 shadow-[0_4px_15px_rgba(139,92,246,0.3)] hover:shadow-[0_6px_20px_rgba(139,92,246,0.4)]"
                      : isOrganizeMode
                        ? "bg-gradient-to-r from-warning to-amber-500 shadow-[0_4px_15px_rgba(245,158,11,0.3)] hover:shadow-[0_6px_20px_rgba(245,158,11,0.4)]"
                        : isHideMode
                          ? "bg-gradient-to-r from-accent to-accent-secondary shadow-glow-pink hover:shadow-[0_6px_20px_rgba(255,107,157,0.4)]"
                          : "bg-gradient-to-r from-accent-tertiary to-manga-sky shadow-[0_4px_15px_rgba(0,212,170,0.3)] hover:shadow-[0_6px_20px_rgba(0,212,170,0.4)]"
            }
            hover:-translate-y-0.5
            transition-all duration-200
            disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none
            flex items-center justify-center gap-2
          `}
        >
          {isProcessing ? (
            <>
              <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              処理中...
            </>
          ) : isMergeMode ? (
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
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              レイヤーを統合
            </>
          ) : isLockMode ? (
            <>
              <LockIcon />
              {unlockAllLayers ? "ロック解除を適用" : "ロックを適用"}
            </>
          ) : isCustomMode ? (
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
                  d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                />
              </svg>
              カスタム操作を適用 ({customTotalCount})
            </>
          ) : isLayerMoveMode ? (
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
                  d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
                />
              </svg>
              レイヤーを移動
            </>
          ) : isOrganizeMode ? (
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
                  d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                />
              </svg>
              フォルダに格納
            </>
          ) : isHideMode ? (
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
                  d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                />
              </svg>
              非表示を適用
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
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                />
              </svg>
              表示を適用
            </>
          )}
        </button>
      </div>

      {/* Result dialog (portal) */}
      <LayerControlResultDialog />
    </div>
  );
}

// モードボタンコンポーネント
function ModeButton({
  mode,
  label,
  icon,
  currentMode,
  onChange,
}: {
  mode: LayerActionMode;
  label: string;
  icon: React.ReactNode;
  currentMode: LayerActionMode;
  onChange: (mode: LayerActionMode) => void;
}) {
  const isSelected = currentMode === mode;

  const selectedClass =
    mode === "hide"
      ? "bg-accent text-white"
      : mode === "show"
        ? "bg-accent-tertiary text-white"
        : mode === "layerMove"
          ? "bg-violet-500 text-white"
          : mode === "custom"
            ? "bg-sky-500 text-white"
            : mode === "lock"
              ? "bg-amber-500 text-white"
              : mode === "merge"
                ? "bg-emerald-500 text-white"
                : "bg-warning text-white";

  return (
    <button
      className={`
        flex-1 px-2 py-1.5 text-[11px] font-medium rounded-lg transition-all duration-200
        flex items-center justify-center gap-1
        ${
          isSelected
            ? selectedClass
            : "text-text-secondary hover:text-text-primary hover:bg-bg-elevated"
        }
      `}
      onClick={() => onChange(mode)}
    >
      {icon}
      {label}
    </button>
  );
}

// 条件アイテムコンポーネント
function ConditionItem({
  condition,
  isSelected,
  onToggle,
  onRemove,
  isCustom = false,
  isHideMode = true,
}: {
  condition: HideCondition;
  isSelected: boolean;
  onToggle: () => void;
  onRemove?: () => void;
  isCustom?: boolean;
  isHideMode?: boolean;
}) {
  return (
    <div
      className={`
        flex items-center gap-2 p-2.5 rounded-xl cursor-pointer transition-all duration-200
        ${
          isSelected
            ? isHideMode
              ? "bg-accent/15 border border-accent/50"
              : "bg-accent-tertiary/15 border border-accent-tertiary/50"
            : "bg-bg-tertiary border border-white/5 hover:border-white/10"
        }
      `}
      onClick={onToggle}
    >
      <div
        className={`
          w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-all duration-200
          ${
            isSelected
              ? isHideMode
                ? "bg-gradient-to-br from-accent to-accent-secondary border-accent"
                : "bg-gradient-to-br from-accent-tertiary to-manga-sky border-accent-tertiary"
              : "border-text-muted/50"
          }
        `}
      >
        {isSelected && (
          <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        )}
      </div>
      <span className="text-sm text-text-primary flex-1">{condition.name}</span>
      {isCustom && onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="p-1 text-text-muted hover:text-error transition-colors rounded"
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
      )}
    </div>
  );
}

// レイヤー整理用の条件チェックボックス
function LayerMoveConditionItem({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={`
        flex items-center gap-2 p-2.5 rounded-xl cursor-pointer transition-all duration-200
        ${
          checked
            ? "bg-violet-500/15 border border-violet-500/50"
            : "bg-bg-secondary border border-white/5 hover:border-white/10"
        }
      `}
      onClick={onToggle}
    >
      <div
        className={`
          w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-all duration-200
          ${checked ? "bg-violet-500 border-violet-500" : "border-text-muted/50"}
        `}
      >
        {checked && (
          <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        )}
      </div>
      <span className="text-sm text-text-primary flex-1">{label}</span>
    </div>
  );
}

// 保存先セレクター
function SaveModeSelector({
  saveMode,
  onChange,
  folderHint,
  isOrganizeMode = false,
}: {
  saveMode: LayerSaveMode;
  onChange: (mode: LayerSaveMode) => void;
  folderHint: string;
  isOrganizeMode?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className="bg-bg-tertiary rounded-xl p-1 flex gap-1">
        <button
          className={`
            flex-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-200
            ${
              saveMode === "overwrite"
                ? "bg-bg-elevated text-text-primary shadow-sm"
                : "text-text-secondary hover:text-text-primary"
            }
          `}
          onClick={() => onChange("overwrite")}
        >
          上書き保存
        </button>
        <button
          className={`
            flex-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-200
            ${
              saveMode === "copyToFolder"
                ? "bg-bg-elevated text-text-primary shadow-sm"
                : "text-text-secondary hover:text-text-primary"
            }
          `}
          onClick={() => onChange("copyToFolder")}
        >
          別フォルダに保存
        </button>
      </div>
      {saveMode === "copyToFolder" && folderHint && (
        <p className="text-[10px] text-text-muted px-1 leading-tight">
          保存先: Desktop/Script_Output/{isOrganizeMode ? "レイヤー整理" : "レイヤー制御"}/
          {folderHint}/
        </p>
      )}
    </div>
  );
}
