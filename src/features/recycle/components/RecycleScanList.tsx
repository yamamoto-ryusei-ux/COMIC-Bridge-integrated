import { useMemo } from "react";
import { useRecycleStore } from "../recycleStore";
import type { RecycleTextLayer } from "../recycleTypes";

interface Props {
  disabled?: boolean;
}

interface FlatRow {
  filePath: string;
  fileName: string;
  layer: RecycleTextLayer;
}

/**
 * スキャン結果の一覧表示。
 * フィルタ（フォント・サイズ・白フチ）と個別変更予約への入口を提供。
 *
 * Phase 5 で個別変更予約UIを完全実装する。当面は読み取り専用。
 */
export function RecycleScanList({ disabled: _disabled }: Props) {
  const scanFiles = useRecycleStore((s) => s.scanFiles);
  const filterFont = useRecycleStore((s) => s.filterFont);
  const filterSize = useRecycleStore((s) => s.filterSize);
  const filterStroke = useRecycleStore((s) => s.filterStroke);
  const setFilterFont = useRecycleStore((s) => s.setFilterFont);
  const setFilterSize = useRecycleStore((s) => s.setFilterSize);
  const setFilterStroke = useRecycleStore((s) => s.setFilterStroke);
  const selectedLayerKey = useRecycleStore((s) => s.selectedLayerKey);
  const setSelectedLayerKey = useRecycleStore((s) => s.setSelectedLayerKey);
  const perFileOverrides = useRecycleStore((s) => s.perFileOverrides);

  const overrideMap = new Set(
    perFileOverrides.map((o) => `${o.filePath}|${o.layerId}`),
  );

  const rows: FlatRow[] = useMemo(() => {
    const result: FlatRow[] = [];
    for (const f of scanFiles) {
      const fileName = f.filePath.split(/[\\/]/).pop() || f.filePath;
      for (const l of f.textLayers) {
        result.push({ filePath: f.filePath, fileName, layer: l });
      }
    }
    return result;
  }, [scanFiles]);

  const fontOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => r.layer.fontPostScriptName && set.add(r.layer.fontPostScriptName));
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filterFont && r.layer.fontPostScriptName !== filterFont) return false;
      if (filterSize) {
        const sz = r.layer.fontSize;
        if (filterSize === "small" && sz > 10) return false;
        if (filterSize === "medium" && (sz < 11 || sz > 15)) return false;
        if (filterSize === "large" && (sz < 16 || sz > 20)) return false;
        if (filterSize === "xlarge" && sz < 21) return false;
      }
      if (filterStroke === "yes" && !r.layer.hasStroke) return false;
      if (filterStroke === "no" && r.layer.hasStroke) return false;
      return true;
    });
  }, [rows, filterFont, filterSize, filterStroke]);

  if (scanFiles.length === 0) {
    return (
      <div className="p-6 text-center text-text-dim text-xs">
        フォルダを選択するとテキストレイヤーが一覧表示されます
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* フィルタ */}
      <div className="flex items-center gap-2 p-2 border-b border-border-subtle">
        <select
          value={filterFont}
          onChange={(e) => setFilterFont(e.target.value)}
          className="px-2 py-1 text-xs bg-bg-primary border border-border-subtle rounded"
        >
          <option value="">フォント: すべて</option>
          {fontOptions.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <select
          value={filterSize}
          onChange={(e) => setFilterSize(e.target.value as typeof filterSize)}
          className="px-2 py-1 text-xs bg-bg-primary border border-border-subtle rounded"
        >
          <option value="">サイズ: すべて</option>
          <option value="small">10pt以下</option>
          <option value="medium">11-15pt</option>
          <option value="large">16-20pt</option>
          <option value="xlarge">21pt以上</option>
        </select>
        <select
          value={filterStroke}
          onChange={(e) => setFilterStroke(e.target.value as typeof filterStroke)}
          className="px-2 py-1 text-xs bg-bg-primary border border-border-subtle rounded"
        >
          <option value="">白フチ: すべて</option>
          <option value="yes">白フチあり</option>
          <option value="no">白フチなし</option>
        </select>
        <span className="text-xs text-text-dim ml-auto">
          {filtered.length} / {rows.length}件
        </span>
      </div>

      {/* リスト */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-bg-secondary text-text-dim">
            <tr>
              <th className="text-left p-2 font-normal">ファイル</th>
              <th className="text-left p-2 font-normal">テキスト</th>
              <th className="text-left p-2 font-normal">フォント</th>
              <th className="text-left p-2 font-normal">サイズ</th>
              <th className="text-left p-2 font-normal">白フチ</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, idx) => {
              const key = `${r.filePath}|${r.layer.layerId}`;
              const isSelected = selectedLayerKey === key;
              const hasOverride = overrideMap.has(key);
              return (
                <tr
                  key={`${r.filePath}-${r.layer.layerId}-${idx}`}
                  onClick={() => setSelectedLayerKey(isSelected ? null : key)}
                  className={`border-b border-border-subtle cursor-pointer transition-colors ${
                    isSelected
                      ? "bg-accent/15"
                      : hasOverride
                        ? "bg-success/8 hover:bg-success/12"
                        : "hover:bg-surface-raised"
                  }`}
                >
                  <td className="p-2 truncate max-w-[140px] text-text-secondary">
                    {hasOverride && <span className="mr-1 text-success">●</span>}
                    {r.fileName}
                  </td>
                  <td className="p-2 truncate max-w-[200px]">{r.layer.text}</td>
                  <td className="p-2 truncate max-w-[160px] text-text-secondary">
                    {r.layer.fontPostScriptName}
                  </td>
                  <td className="p-2">{r.layer.fontSize.toFixed(1)}pt</td>
                  <td className="p-2">{r.layer.hasStroke ? "✓" : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
