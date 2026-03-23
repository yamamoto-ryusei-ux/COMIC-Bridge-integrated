import { useState } from "react";
import { useScanPsdStore } from "../../../store/scanPsdStore";

export function FontSizesTab() {
  const scanData = useScanPsdStore((s) => s.scanData);
  const updateSizeStats = useScanPsdStore((s) => s.updateSizeStats);

  const [editingBase, setEditingBase] = useState(false);
  const [editBaseValue, setEditBaseValue] = useState("");
  const [sizeModalOpen, setSizeModalOpen] = useState(false);
  const [addingSize, setAddingSize] = useState(false);
  const [newSizeValue, setNewSizeValue] = useState("");

  if (!scanData) {
    return (
      <div className="text-center py-8">
        <p className="text-xs text-text-muted">スキャンデータがありません</p>
      </div>
    );
  }

  const sizeStats = scanData.sizeStats ?? {
    mostFrequent: null,
    sizes: [],
    excludeRange: null,
    allSizes: {},
  };
  const strokeSizes = scanData.strokeStats?.sizes ?? [];
  const top10 = (sizeStats.sizes ?? []).slice(0, 10);
  const remaining = (sizeStats.sizes ?? []).slice(10);
  const maxCount = top10.length > 0 ? top10[0].count : 1;

  const applyBaseSize = (newSize: number) => {
    if (isNaN(newSize) || newSize <= 0) return;
    const oldCount = sizeStats.mostFrequent?.count ?? 0;
    updateSizeStats({
      mostFrequent: { size: newSize, count: oldCount },
      excludeRange: {
        min: Math.floor(newSize / 2) - 1,
        max: Math.ceil(newSize / 2) + 1,
      },
    });
  };

  const handleBaseEditStart = () => {
    setEditBaseValue(String(sizeStats.mostFrequent?.size ?? ""));
    setEditingBase(true);
  };

  const handleBaseEditConfirm = () => {
    const val = parseFloat(editBaseValue);
    if (!isNaN(val) && val > 0) {
      applyBaseSize(val);
    }
    setEditingBase(false);
  };

  const handleBaseEditCancel = () => {
    setEditingBase(false);
  };

  const handleTop10Click = (size: number) => {
    applyBaseSize(size);
  };

  const handleDeleteSize = (sizeToDelete: number) => {
    const newSizes = (sizeStats.sizes ?? []).filter((s) => s.size !== sizeToDelete);
    const newAllSizes = { ...sizeStats.allSizes };
    delete newAllSizes[String(sizeToDelete)];
    updateSizeStats({ sizes: newSizes, allSizes: newAllSizes });
  };

  const handleAddSize = () => {
    const val = parseFloat(newSizeValue);
    if (isNaN(val) || val <= 0) return;
    const existing = (sizeStats.sizes ?? []).find((s) => s.size === val);
    if (existing) return;
    const newEntry = { size: val, count: 1 };
    const newSizes = [...(sizeStats.sizes ?? []), newEntry].sort(
      (a, b) => b.count - a.count || a.size - b.size,
    );
    const newAllSizes = { ...sizeStats.allSizes, [String(val)]: 1 };
    updateSizeStats({ sizes: newSizes, allSizes: newAllSizes });
    setNewSizeValue("");
    setAddingSize(false);
  };

  return (
    <div className="space-y-4">
      {/* ベースサイズ — ヒーロー表示 */}
      <div
        className="rounded-xl p-4 text-center relative overflow-hidden"
        style={{
          background: "linear-gradient(135deg, rgba(255,177,66,0.1), rgba(255,90,138,0.08))",
        }}
      >
        <div className="absolute inset-0 bg-tone opacity-50" />
        <div className="relative">
          <p className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1">
            ベースフォントサイズ
          </p>
          {editingBase ? (
            <div className="flex items-center justify-center gap-1">
              <input
                type="number"
                className="w-20 text-center text-2xl font-black bg-white border border-accent rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-accent"
                value={editBaseValue}
                onChange={(e) => setEditBaseValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleBaseEditConfirm();
                  if (e.key === "Escape") handleBaseEditCancel();
                }}
                autoFocus
              />
              <span className="text-sm font-bold text-text-muted">pt</span>
            </div>
          ) : sizeStats.mostFrequent ? (
            <>
              <div className="flex items-center justify-center gap-1">
                <span
                  className="text-3xl font-black font-display"
                  style={{
                    background: "linear-gradient(135deg, #ff5a8a, #7c5cff)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                >
                  {sizeStats.mostFrequent.size}
                </span>
                <span className="text-sm font-bold text-text-muted ml-0.5">pt</span>
                <button
                  onClick={handleBaseEditStart}
                  className="ml-1 p-1 rounded-lg hover:bg-white/50 transition-colors text-text-muted hover:text-accent"
                  title="ベースサイズを編集"
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
                      d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                    />
                  </svg>
                </button>
              </div>
              <p className="text-[10px] text-text-muted mt-0.5">
                {sizeStats.mostFrequent.count}回使用
              </p>
            </>
          ) : (
            <p className="text-sm text-text-muted">検出なし</p>
          )}
        </div>
      </div>

      {/* Top10サイズ — バー付き */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-[10px] font-bold text-text-secondary">登録サイズ Top10</h4>
          <button
            onClick={() => setSizeModalOpen(true)}
            className="text-[9px] font-bold text-accent hover:text-accent-hover transition-colors px-1.5 py-0.5 rounded hover:bg-accent/10"
          >
            編集
          </button>
        </div>
        <div className="space-y-1">
          {top10.map((s, i) => (
            <div
              key={s.size}
              className="flex items-center gap-2 cursor-pointer rounded-lg px-1 py-0.5 hover:bg-white/60 transition-colors"
              onClick={() => handleTop10Click(s.size)}
              title={`${s.size}pt をベースサイズに設定`}
            >
              <span
                className={`text-[11px] font-bold w-10 text-right flex-shrink-0 ${
                  i === 0 ? "text-accent" : "text-text-primary"
                }`}
              >
                {s.size}pt
              </span>
              <div className="flex-1 h-4 bg-bg-tertiary rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.max((s.count / maxCount) * 100, 4)}%`,
                    background:
                      i === 0
                        ? "linear-gradient(90deg, #ff5a8a, #7c5cff)"
                        : `rgba(124, 92, 255, ${0.5 - i * 0.04})`,
                  }}
                />
              </div>
              <span className="text-[9px] text-text-muted w-7 text-right flex-shrink-0">
                {s.count}
              </span>
            </div>
          ))}
        </div>
        {remaining.length > 0 && (
          <details className="mt-2">
            <summary className="text-[10px] text-accent cursor-pointer hover:text-accent-hover font-medium">
              その他 ({remaining.length}サイズ)
            </summary>
            <div className="flex flex-wrap gap-1 mt-1.5">
              {remaining.map((s) => (
                <span
                  key={s.size}
                  className="text-[9px] text-text-muted bg-bg-tertiary px-1.5 py-0.5 rounded-lg border border-border/30"
                >
                  {s.size}pt({s.count})
                </span>
              ))}
            </div>
          </details>
        )}
      </div>

      {/* ルビ除外範囲 */}
      {sizeStats.excludeRange && (
        <div className="flex items-center gap-2 px-3 py-2.5 bg-manga-lavender/30 rounded-xl border border-accent-secondary/15">
          <svg
            className="w-3.5 h-3.5 text-accent-secondary flex-shrink-0"
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
          <div>
            <span className="text-[10px] font-bold text-accent-secondary block">ルビ除外範囲</span>
            <span className="text-xs text-text-primary font-medium">
              {sizeStats.excludeRange.min}pt 〜 {sizeStats.excludeRange.max}pt
            </span>
            <span className="text-[9px] text-text-muted ml-1.5">(ベースの約半分 ±1pt)</span>
          </div>
        </div>
      )}

      {/* 白フチサイズ */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <h4 className="text-[10px] font-bold text-text-secondary">白フチサイズ</h4>
          <span className="text-[9px] font-bold text-accent-tertiary bg-accent-tertiary/10 px-2 py-0.5 rounded-full">
            {strokeSizes.length}
          </span>
        </div>
        {strokeSizes.length === 0 ? (
          <p className="text-xs text-text-muted py-2 text-center bg-bg-tertiary/30 rounded-xl border border-dashed border-border">
            検出なし
          </p>
        ) : (
          <div className="space-y-1.5">
            {strokeSizes.map((s) => (
              <div
                key={s.size}
                className="bg-bg-tertiary/40 rounded-lg px-3 py-2 border border-border/30 hover:border-accent-tertiary/30 transition-colors"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-accent-tertiary">{s.size}px</span>
                  <span className="text-[9px] text-text-muted bg-bg-primary px-1.5 py-0.5 rounded">
                    {s.count}回
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {s.fontSizes.slice(0, 8).map((fs) => (
                    <span
                      key={fs}
                      className="text-[9px] text-text-secondary bg-white px-1.5 py-0.5 rounded border border-border/40"
                    >
                      {fs}pt
                    </span>
                  ))}
                  {s.fontSizes.length > 8 && (
                    <span className="text-[9px] text-text-muted">+{s.fontSizes.length - 8}</span>
                  )}
                </div>
                {s.maxFontSize && (
                  <span className="text-[9px] text-text-muted mt-1 block">
                    最大フォント: {s.maxFontSize}pt
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* フォントサイズ編集モーダル */}
      {sizeModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSizeModalOpen(false);
          }}
        >
          <div
            className="bg-bg-secondary rounded-2xl shadow-xl w-80 max-h-[70vh] flex flex-col border border-border/50"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <h3 className="text-sm font-bold text-text-primary">フォントサイズ一覧</h3>
              <button
                onClick={() => setSizeModalOpen(false)}
                className="text-text-muted hover:text-text-primary transition-colors p-1 rounded-lg hover:bg-bg-tertiary"
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
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1">
              {(sizeStats.sizes ?? []).length === 0 ? (
                <p className="text-xs text-text-muted text-center py-4">サイズデータなし</p>
              ) : (
                (sizeStats.sizes ?? []).map((s) => (
                  <div
                    key={s.size}
                    className="flex items-center justify-between px-3 py-2 bg-bg-tertiary/40 rounded-lg border border-border/30 hover:border-accent/30 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-text-primary">{s.size}pt</span>
                      <span className="text-[9px] text-text-muted">{s.count}回</span>
                    </div>
                    <button
                      onClick={() => handleDeleteSize(s.size)}
                      className="text-text-muted hover:text-error transition-colors p-1 rounded hover:bg-error/10"
                      title="削除"
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
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="px-4 pb-4 pt-2 border-t border-border/30">
              {addingSize ? (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    className="flex-1 text-xs bg-white border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent"
                    placeholder="サイズ (pt)"
                    value={newSizeValue}
                    onChange={(e) => setNewSizeValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddSize();
                      if (e.key === "Escape") {
                        setAddingSize(false);
                        setNewSizeValue("");
                      }
                    }}
                    autoFocus
                  />
                  <button
                    onClick={handleAddSize}
                    className="text-[10px] font-bold text-white bg-accent hover:bg-accent-hover rounded-lg px-3 py-1.5 transition-colors"
                  >
                    確定
                  </button>
                  <button
                    onClick={() => {
                      setAddingSize(false);
                      setNewSizeValue("");
                    }}
                    className="text-[10px] font-bold text-text-muted hover:text-text-primary rounded-lg px-2 py-1.5 transition-colors"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setAddingSize(true)}
                  className="w-full text-[10px] font-bold text-accent hover:text-accent-hover border border-dashed border-accent/40 hover:border-accent rounded-lg py-2 transition-colors hover:bg-accent/5"
                >
                  + 追加
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
