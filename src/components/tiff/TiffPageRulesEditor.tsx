import { useState } from "react";
import { createPortal } from "react-dom";
import { usePsdStore } from "../../store/psdStore";
import { useTiffStore } from "../../store/tiffStore";
import { TiffPartialBlurModal } from "./TiffPartialBlurModal";

export function TiffPageRulesEditor({ onClose }: { onClose: () => void }) {
  const files = usePsdStore((state) => state.files);
  const settings = useTiffStore((state) => state.settings);
  const setSettings = useTiffStore((state) => state.setSettings);
  const addPageRangeRule = useTiffStore((state) => state.addPageRangeRule);
  const updatePageRangeRule = useTiffStore((state) => state.updatePageRangeRule);
  const removePageRangeRule = useTiffStore((state) => state.removePageRangeRule);

  const rules = settings.pageRangeRules;
  const [showPartialBlur, setShowPartialBlur] = useState(false);

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="bg-bg-secondary border border-border rounded-2xl shadow-xl max-w-2xl w-full mx-4 overflow-hidden flex flex-col max-h-[85vh]">
          {/* Header */}
          <div className="px-6 py-4 border-b border-border flex-shrink-0">
            <h3 className="text-sm font-display font-bold text-text-primary">
              カラー・ぼかし 詳細設定
            </h3>
            <p className="text-xs text-text-muted mt-1">
              ページ範囲ごとのカラーモード・個別ぼかし、部分ぼかし設定
            </p>
          </div>

          {/* Content */}
          <div className="flex gap-4 p-6 overflow-auto flex-1">
            {/* Left: Rules + Blur */}
            <div className="flex-1 space-y-4 min-w-0">
              {/* ── カラーモード個別ルール ── */}
              <div>
                <h4 className="text-[10px] font-medium text-text-muted mb-1.5">
                  カラーモード個別ルール
                  <span className="ml-1 text-text-muted/60">(colorMode=個別 のときに有効)</span>
                </h4>

                {rules.map((rule, i) => (
                  <div key={rule.id} className="mb-2 p-2.5 bg-bg-tertiary rounded-lg space-y-1.5">
                    {/* Row 1: ページ範囲 + カラーモード + 削除 */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-text-muted w-4 flex-shrink-0">{i + 1}.</span>
                      <input
                        type="number"
                        min="1"
                        value={rule.fromPage}
                        onChange={(e) =>
                          updatePageRangeRule(rule.id, { fromPage: parseInt(e.target.value) || 1 })
                        }
                        className="w-14 px-1.5 py-1 text-xs bg-bg-elevated border border-border/50 rounded text-text-primary text-center focus:outline-none focus:border-accent-warm/50"
                      />
                      <span className="text-xs text-text-muted">〜</span>
                      <input
                        type="number"
                        min="1"
                        value={rule.toPage}
                        onChange={(e) =>
                          updatePageRangeRule(rule.id, { toPage: parseInt(e.target.value) || 1 })
                        }
                        className="w-14 px-1.5 py-1 text-xs bg-bg-elevated border border-border/50 rounded text-text-primary text-center focus:outline-none focus:border-accent-warm/50"
                      />
                      <select
                        value={rule.colorMode}
                        onChange={(e) =>
                          updatePageRangeRule(rule.id, {
                            colorMode: e.target.value as "mono" | "color" | "noChange",
                          })
                        }
                        className="flex-1 px-2 py-1 text-xs bg-bg-elevated border border-border/50 rounded text-text-primary focus:outline-none"
                      >
                        <option value="color">カラー</option>
                        <option value="mono">モノクロ</option>
                        <option value="noChange">変更なし</option>
                      </select>
                      <button
                        onClick={() => removePageRangeRule(rule.id)}
                        className="p-1 text-text-muted hover:text-error transition-colors flex-shrink-0"
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

                    {/* Row 2: ぼかし */}
                    <div className="flex items-center gap-2 pl-6">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={rule.applyBlur}
                          onChange={(e) =>
                            updatePageRangeRule(rule.id, { applyBlur: e.target.checked })
                          }
                          className="rounded accent-accent-warm"
                        />
                        <span className="text-[10px] text-text-secondary">ぼかし適用</span>
                      </label>
                      {rule.applyBlur && (
                        <>
                          <span className="text-[10px] text-text-muted">半径:</span>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.1"
                            placeholder={`${settings.blur.radius}`}
                            value={rule.blurRadius ?? ""}
                            onChange={(e) => {
                              const v =
                                e.target.value === "" ? undefined : parseFloat(e.target.value) || 0;
                              updatePageRangeRule(rule.id, { blurRadius: v });
                            }}
                            className="w-16 px-1.5 py-0.5 text-[10px] bg-bg-elevated border border-border/50 rounded text-text-primary focus:outline-none focus:border-accent-warm/50"
                          />
                          <span className="text-[10px] text-text-muted">px</span>
                          {rule.blurRadius === undefined && (
                            <span className="text-[9px] text-text-muted/60">
                              (グローバル値を使用)
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ))}

                {rules.length < 3 && (
                  <button
                    onClick={addPageRangeRule}
                    className="w-full px-3 py-2 text-xs text-text-muted border border-dashed border-border rounded-lg hover:border-accent-warm/50 hover:text-accent-warm transition-colors"
                  >
                    + ルールを追加
                  </button>
                )}

                {/* デフォルト処理 */}
                <div className="mt-3 space-y-1.5">
                  <h4 className="text-[10px] font-medium text-text-muted">
                    デフォルト処理（ルール外のページ）
                  </h4>
                  <div className="flex gap-2">
                    {(["mono", "color", "noChange"] as const).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => setSettings({ defaultColorForPerPage: mode })}
                        className={`
                          flex-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-all
                          ${
                            settings.defaultColorForPerPage === mode
                              ? "bg-accent-warm text-white"
                              : "bg-bg-elevated text-text-secondary hover:text-text-primary border border-border/50"
                          }
                        `}
                      >
                        {mode === "mono" ? "モノクロ" : mode === "color" ? "カラー" : "変更なし"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 区切り線 */}
              <div className="border-t border-border/40" />

              {/* ── 部分ぼかし設定 ── */}
              <div>
                <h4 className="text-[10px] font-medium text-text-muted mb-1.5">部分ぼかし設定</h4>
                <button
                  onClick={() => setShowPartialBlur(true)}
                  disabled={!settings.blur.enabled}
                  className={`w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
                    settings.blur.enabled
                      ? "bg-accent-secondary/10 text-accent-secondary border-accent-secondary/30 hover:bg-accent-secondary/20"
                      : "opacity-40 cursor-not-allowed bg-bg-elevated text-text-muted border-border/50"
                  }`}
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
                      d="M12 3a9 9 0 100 18A9 9 0 0012 3z"
                    />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01" />
                  </svg>
                  部分ぼかし設定を開く
                  {settings.partialBlurEntries.length > 0 && (
                    <span className="ml-1 px-1.5 py-0.5 text-[9px] rounded-full bg-accent-secondary/20">
                      {settings.partialBlurEntries.length}ページ設定済み
                    </span>
                  )}
                </button>
                {!settings.blur.enabled && (
                  <p className="mt-1 text-[9px] text-text-muted/60 text-center">
                    ガウスぼかしをONにすると使用できます
                  </p>
                )}
              </div>
            </div>

            {/* Right: File Reference */}
            <div className="w-48 flex-shrink-0">
              <h4 className="text-[10px] font-medium text-text-muted mb-1.5">
                ファイル一覧（順番参照）
              </h4>
              <div className="bg-bg-tertiary rounded-lg p-2 max-h-[400px] overflow-auto space-y-0.5">
                {files.map((file, i) => (
                  <div key={file.id} className="flex items-center gap-1.5 text-xs">
                    <span className="text-text-muted font-mono w-7 text-right flex-shrink-0">
                      ({i + 1})
                    </span>
                    <span className="text-text-secondary truncate">{file.fileName}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-border flex justify-end gap-2 flex-shrink-0">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-text-secondary bg-bg-tertiary rounded-xl hover:bg-bg-tertiary/80 transition-colors"
            >
              キャンセル
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-accent-warm to-accent rounded-xl hover:-translate-y-0.5 transition-all shadow-sm"
            >
              OK
            </button>
          </div>
        </div>
      </div>

      {showPartialBlur && <TiffPartialBlurModal onClose={() => setShowPartialBlur(false)} />}
    </>,
    document.body,
  );
}
