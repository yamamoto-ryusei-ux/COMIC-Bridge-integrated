import { useEffect, useMemo, useState } from "react";
import { useRecycleStore } from "../recycleStore";
import { useScanPsdStore } from "../../scan-psd/scanPsdStore";
import type { RecycleTextLayer } from "../recycleTypes";
import type { FontPreset } from "../../../types/scanPsd";

/**
 * 個別レイヤー編集パネル
 * scanPsdStore のプリセット JSON（フォント帳）から
 * フォント種類とサイズを選択して perFileOverride として記録する。
 */
export function RecycleLayerDetailPanel() {
  const selectedLayerKey = useRecycleStore((s) => s.selectedLayerKey);
  const setSelectedLayerKey = useRecycleStore((s) => s.setSelectedLayerKey);
  const scanFiles = useRecycleStore((s) => s.scanFiles);
  const perFileOverrides = useRecycleStore((s) => s.perFileOverrides);
  const addPerFileOverride = useRecycleStore((s) => s.addPerFileOverride);
  const removePerFileOverride = useRecycleStore((s) => s.removePerFileOverride);

  // scanPsdStore からプリセット情報を取得
  const presetSets = useScanPsdStore((s) => s.presetSets);
  const currentSetName = useScanPsdStore((s) => s.currentSetName);
  const scanData = useScanPsdStore((s) => s.scanData);
  const currentJsonFilePath = useScanPsdStore((s) => s.currentJsonFilePath);

  // 現在選択中のレイヤー解決
  const selectedLayer: { filePath: string; fileName: string; layer: RecycleTextLayer } | null = useMemo(() => {
    if (!selectedLayerKey) return null;
    const sepIdx = selectedLayerKey.lastIndexOf("|");
    if (sepIdx === -1) return null;
    const filePath = selectedLayerKey.substring(0, sepIdx);
    const layerId = parseInt(selectedLayerKey.substring(sepIdx + 1));
    const file = scanFiles.find((f) => f.filePath === filePath);
    if (!file) return null;
    const layer = file.textLayers.find((l) => l.layerId === layerId);
    if (!layer) return null;
    const fileName = filePath.split(/[\\/]/).pop() || filePath;
    return { filePath, fileName, layer };
  }, [selectedLayerKey, scanFiles]);

  // 既存の override
  const existingOverride = useMemo(() => {
    if (!selectedLayer) return null;
    return perFileOverrides.find(
      (o) => o.filePath === selectedLayer.filePath && o.layerId === selectedLayer.layer.layerId,
    );
  }, [selectedLayer, perFileOverrides]);

  // フォーム state（変更前は元の値、変更時に上書き）
  const [pendingFont, setPendingFont] = useState<string>("");
  const [pendingSize, setPendingSize] = useState<number | "">("");

  // 選択レイヤー切替時にフォームを既存値で初期化
  useEffect(() => {
    if (!selectedLayer) {
      setPendingFont("");
      setPendingSize("");
      return;
    }
    setPendingFont(existingOverride?.fontPostScriptName || selectedLayer.layer.fontPostScriptName);
    setPendingSize(existingOverride?.fontSize ?? selectedLayer.layer.fontSize);
  }, [selectedLayer, existingOverride]);

  // フォントプリセット一覧（カテゴリで絞り込み）
  const fontPresets: FontPreset[] = useMemo(() => {
    if (!presetSets) return [];
    // 現在のセット + 他セットを統合（重複除去）
    const seen = new Set<string>();
    const result: FontPreset[] = [];
    const addFromSet = (setName: string) => {
      const list = presetSets[setName];
      if (!list) return;
      for (const p of list) {
        if (!p.font || seen.has(p.font)) continue;
        seen.add(p.font);
        result.push(p);
      }
    };
    if (currentSetName) addFromSet(currentSetName);
    for (const name of Object.keys(presetSets)) {
      if (name !== currentSetName) addFromSet(name);
    }
    return result;
  }, [presetSets, currentSetName]);

  // サイズ統計（出現回数順）
  const sizeOptions: number[] = useMemo(() => {
    if (!scanData?.sizeStats) return [];
    const sizes = scanData.sizeStats.sizes || [];
    return sizes.map((s) => s.size).filter((v) => typeof v === "number");
  }, [scanData]);

  if (!selectedLayer) {
    return (
      <div className="p-6 text-center text-text-dim text-xs border-t border-border-subtle">
        テキストレイヤーをクリックすると、ここでフォント・サイズを変更できます
      </div>
    );
  }

  const presetLoaded = !!currentJsonFilePath || fontPresets.length > 0;
  const isChanged =
    pendingFont !== selectedLayer.layer.fontPostScriptName ||
    pendingSize !== selectedLayer.layer.fontSize;

  function handleApply() {
    if (!selectedLayer) return;
    addPerFileOverride({
      filePath: selectedLayer.filePath,
      layerId: selectedLayer.layer.layerId,
      fontPostScriptName: pendingFont !== selectedLayer.layer.fontPostScriptName ? pendingFont : undefined,
      fontSize: pendingSize !== "" && pendingSize !== selectedLayer.layer.fontSize ? Number(pendingSize) : undefined,
    });
  }

  function handleClear() {
    if (!selectedLayer) return;
    removePerFileOverride(selectedLayer.filePath, selectedLayer.layer.layerId);
  }

  return (
    <div className="border-t border-border-subtle bg-bg-secondary">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle">
        <div className="text-xs font-semibold">テキストレイヤー編集</div>
        <button
          onClick={() => setSelectedLayerKey(null)}
          className="text-text-dim hover:text-text-primary text-sm"
          title="閉じる"
        >
          ×
        </button>
      </div>

      <div className="p-3 space-y-3">
        {/* 対象レイヤー情報 */}
        <div className="text-xs space-y-0.5">
          <div className="text-text-dim">対象:</div>
          <div className="font-mono text-text-secondary truncate">{selectedLayer.fileName}</div>
          <div className="text-text-secondary">「{selectedLayer.layer.text}」</div>
          <div className="text-[10px] text-text-dim">
            元: {selectedLayer.layer.fontPostScriptName} / {selectedLayer.layer.fontSize.toFixed(1)}pt
          </div>
        </div>

        {/* プリセット未読込時の案内 */}
        {!presetLoaded && (
          <div className="px-2 py-2 bg-warn/10 text-warn text-[11px] rounded">
            作品情報JSONを読み込むと、ここでフォント候補が選べるようになります。
            <br />
            画面上部の「作品情報」ボタンから読み込んでください。
          </div>
        )}

        {/* フォント選択 */}
        <div>
          <div className="text-[10px] uppercase tracking-wide text-text-dim font-semibold mb-1">
            フォント {fontPresets.length > 0 && `（${fontPresets.length}件）`}
          </div>
          {fontPresets.length > 0 ? (
            <div className="max-h-[180px] overflow-y-auto border border-border-subtle rounded">
              {fontPresets.map((p) => (
                <button
                  key={p.font}
                  onClick={() => setPendingFont(p.font)}
                  className={`w-full text-left px-2 py-1 text-xs flex items-center gap-2 ${
                    pendingFont === p.font
                      ? "bg-accent/15 text-accent"
                      : "hover:bg-surface-raised text-text-secondary"
                  }`}
                  title={p.font}
                >
                  <span className="flex-1 truncate">{p.name}</span>
                  {p.subName && <span className="text-[10px] text-text-dim">{p.subName}</span>}
                </button>
              ))}
            </div>
          ) : (
            <input
              type="text"
              value={pendingFont}
              onChange={(e) => setPendingFont(e.target.value)}
              placeholder="PostScript名を直接入力"
              className="w-full px-2 py-1 text-xs bg-bg-primary border border-border-subtle rounded font-mono"
            />
          )}
        </div>

        {/* サイズ選択 */}
        <div>
          <div className="text-[10px] uppercase tracking-wide text-text-dim font-semibold mb-1">
            サイズ {sizeOptions.length > 0 && `（${sizeOptions.length}件）`}
          </div>
          <div className="flex items-center gap-2 mb-1">
            <input
              type="number"
              value={pendingSize}
              onChange={(e) => setPendingSize(e.target.value === "" ? "" : Number(e.target.value))}
              step={0.5}
              min={1}
              max={200}
              className="w-20 px-2 py-1 text-xs bg-bg-primary border border-border-subtle rounded"
            />
            <span className="text-xs text-text-dim">pt</span>
          </div>
          {sizeOptions.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {sizeOptions.slice(0, 12).map((s) => (
                <button
                  key={s}
                  onClick={() => setPendingSize(s)}
                  className={`px-2 py-0.5 text-[11px] rounded border ${
                    pendingSize === s
                      ? "bg-accent text-white border-accent"
                      : "border-border-subtle text-text-secondary hover:bg-surface-raised"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* アクション */}
        <div className="flex items-center gap-2 pt-2 border-t border-border-subtle">
          <button
            onClick={handleApply}
            disabled={!isChanged && !existingOverride}
            className="flex-1 px-3 py-1.5 text-xs rounded bg-accent text-white hover:opacity-90 disabled:opacity-40 font-medium"
          >
            {existingOverride ? "予約を更新" : "変更を予約"}
          </button>
          {existingOverride && (
            <button
              onClick={handleClear}
              className="px-3 py-1.5 text-xs rounded border border-danger/40 text-danger hover:bg-danger/10"
            >
              取消
            </button>
          )}
        </div>

        {/* 既存予約表示 */}
        {existingOverride && (
          <div className="text-[10px] text-success">
            予約済み:
            {existingOverride.fontPostScriptName && ` フォント=${existingOverride.fontPostScriptName}`}
            {existingOverride.fontSize != null && ` / サイズ=${existingOverride.fontSize}pt`}
          </div>
        )}
      </div>
    </div>
  );
}
