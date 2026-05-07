import { useState } from "react";
import { useRecycleStore } from "../recycleStore";
import type { RecycleSettings } from "../recycleTypes";

type Tab = "optimize" | "textFormat" | "other";

interface Props {
  disabled?: boolean;
}

/**
 * リサイくるん 3タブ設定UI（雛形）
 * 完全再現は Phase 4 で実施。当面は主要オプションのみ。
 */
export function RecycleSettingsPanel({ disabled }: Props) {
  const [tab, setTab] = useState<Tab>("optimize");
  const settings = useRecycleStore((s) => s.settings);
  const updateSettings = useRecycleStore((s) => s.updateSettings);

  function update<K extends keyof RecycleSettings>(
    section: K,
    updater: (s: RecycleSettings[K]) => RecycleSettings[K],
  ) {
    updateSettings((prev) => ({ ...prev, [section]: updater(prev[section]) }));
  }

  return (
    <div className={`p-3 ${disabled ? "opacity-50 pointer-events-none" : ""}`}>
      {/* タブヘッダー */}
      <div className="flex gap-1 mb-3 border-b border-border-subtle">
        {(
          [
            ["optimize", "最適化"],
            ["textFormat", "テキスト整形"],
            ["other", "その他"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3 py-1.5 text-xs border-b-2 transition-colors ${
              tab === key
                ? "border-accent text-accent font-medium"
                : "border-transparent text-text-secondary hover:text-text-primary"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* タブ1: 最適化 */}
      {tab === "optimize" && (
        <div className="space-y-2">
          <Section title="フォント・スタイル">
            <Check
              checked={settings.optimize.sharpAntiAlias}
              onChange={(v) => update("optimize", (o) => ({ ...o, sharpAntiAlias: v }))}
              label="アンチエイリアスをシャープに"
            />
            <Check
              checked={settings.optimize.convertToPoint}
              onChange={(v) => update("optimize", (o) => ({ ...o, convertToPoint: v }))}
              label="段落テキスト → ポイント変換"
            />
            <Check
              checked={settings.optimize.blackColor}
              onChange={(v) => update("optimize", (o) => ({ ...o, blackColor: v }))}
              label="フォントカラーを黒に統一"
            />
            <Check
              checked={settings.optimize.missingFontReplace}
              onChange={(v) => update("optimize", (o) => ({ ...o, missingFontReplace: v }))}
              label="不在フォントをコミックフォントに置換"
            />
          </Section>
          <Section title="縦中横">
            <Check
              checked={settings.optimize.tateChuYoko}
              onChange={(v) => update("optimize", (o) => ({ ...o, tateChuYoko: v }))}
              label="!? !! ?? に適用"
            />
            <Check
              checked={settings.optimize.tateChuYokoNumbers}
              onChange={(v) => update("optimize", (o) => ({ ...o, tateChuYokoNumbers: v }))}
              label="半角英数字に適用"
            />
          </Section>
          <Section title="文字間・行間">
            <CheckWithNum
              checked={settings.optimize.leading.enabled}
              onCheckChange={(v) =>
                update("optimize", (o) => ({ ...o, leading: { ...o.leading, enabled: v } }))
              }
              value={settings.optimize.leading.value}
              onValueChange={(v) =>
                update("optimize", (o) => ({ ...o, leading: { ...o.leading, value: v } }))
              }
              label="行間"
              unit="%"
            />
            <Check
              checked={settings.optimize.kerning}
              onChange={(v) => update("optimize", (o) => ({ ...o, kerning: v }))}
              label="カーニング: 0"
            />
            <Check
              checked={settings.optimize.tsume0}
              onChange={(v) => update("optimize", (o) => ({ ...o, tsume0: v }))}
              label="文字ツメ: 0"
            />
            <CheckWithNum
              checked={settings.optimize.tracking.enabled}
              onCheckChange={(v) =>
                update("optimize", (o) => ({ ...o, tracking: { ...o.tracking, enabled: v } }))
              }
              value={settings.optimize.tracking.value}
              onValueChange={(v) =>
                update("optimize", (o) => ({ ...o, tracking: { ...o.tracking, value: v } }))
              }
              label="文字ツメ"
              unit="%"
            />
            <CheckWithNum
              checked={settings.optimize.directTracking.enabled}
              onCheckChange={(v) =>
                update("optimize", (o) => ({
                  ...o,
                  directTracking: { ...o.directTracking, enabled: v },
                }))
              }
              value={settings.optimize.directTracking.value}
              onValueChange={(v) =>
                update("optimize", (o) => ({
                  ...o,
                  directTracking: { ...o.directTracking, value: v },
                }))
              }
              label="トラッキング"
              unit=""
            />
          </Section>
          <Section title="その他">
            <Check
              checked={settings.optimize.heartFont}
              onChange={(v) => update("optimize", (o) => ({ ...o, heartFont: v }))}
              label="ハートを小塚ゴシックProHに"
            />
            <Check
              checked={settings.optimize.fontSizeAdjust}
              onChange={(v) => update("optimize", (o) => ({ ...o, fontSizeAdjust: v }))}
              label="フォントサイズの端数調整"
            />
            <Check
              checked={settings.optimize.groupTextLayers}
              onChange={(v) => update("optimize", (o) => ({ ...o, groupTextLayers: v }))}
              label="テキストをまとめる"
            />
          </Section>
        </div>
      )}

      {/* タブ2: テキスト整形 */}
      {tab === "textFormat" && (
        <div className="space-y-2">
          <Section title="記号変換">
            <Check
              checked={settings.textFormat.commaToSpace}
              onChange={(v) => update("textFormat", (o) => ({ ...o, commaToSpace: v }))}
              label="「、」→ 半角スペース"
            />
            <Check
              checked={settings.textFormat.periodToSpace}
              onChange={(v) => update("textFormat", (o) => ({ ...o, periodToSpace: v }))}
              label="「。」→ 半角スペース"
            />
          </Section>
          <Section title="!? 処理">
            <Check
              checked={settings.textFormat.exclamQuestion}
              onChange={(v) => update("textFormat", (o) => ({ ...o, exclamQuestion: v }))}
              label="「⁉」→「!?」"
            />
            <Check
              checked={settings.textFormat.punctuationConvert}
              onChange={(v) => update("textFormat", (o) => ({ ...o, punctuationConvert: v }))}
              label="!? 調整 (1つ→全角 / 2つ→半角)"
            />
            <Check
              checked={settings.textFormat.questionExclamSwap}
              onChange={(v) => update("textFormat", (o) => ({ ...o, questionExclamSwap: v }))}
              label="「?!」→「!?」"
            />
          </Section>
          <Section title="文字変換">
            <Check
              checked={settings.textFormat.fullwidthToHalf}
              onChange={(v) => update("textFormat", (o) => ({ ...o, fullwidthToHalf: v }))}
              label="全角英数字 → 半角"
            />
          </Section>
          <Section title="空白処理">
            <Check
              checked={settings.textFormat.trimStart}
              onChange={(v) => update("textFormat", (o) => ({ ...o, trimStart: v }))}
              label="文頭の空白を削除"
            />
            <Check
              checked={settings.textFormat.trimEnd}
              onChange={(v) => update("textFormat", (o) => ({ ...o, trimEnd: v }))}
              label="文末の空白を削除"
            />
          </Section>
        </div>
      )}

      {/* タブ3: その他 */}
      {tab === "other" && (
        <div className="space-y-2">
          <Section title="白フチ設定">
            <div className="flex items-center gap-2">
              <select
                value={settings.other.stroke.mode}
                onChange={(e) =>
                  update("other", (o) => ({
                    ...o,
                    stroke: { ...o.stroke, mode: e.target.value as "none" | "apply" | "unify" | "remove" },
                  }))
                }
                className="px-2 py-1 text-xs bg-bg-primary border border-border-subtle rounded flex-1"
              >
                <option value="none">処理しない</option>
                <option value="apply">白フチを付ける</option>
                <option value="unify">既存白フチを統一</option>
                <option value="remove">白フチを削除</option>
              </select>
              <input
                type="number"
                value={settings.other.stroke.size}
                onChange={(e) =>
                  update("other", (o) => ({
                    ...o,
                    stroke: { ...o.stroke, size: Number(e.target.value) || 0 },
                  }))
                }
                min={1}
                max={100}
                className="w-16 px-2 py-1 text-xs bg-bg-primary border border-border-subtle rounded"
              />
              <span className="text-xs text-text-dim">px</span>
            </div>
          </Section>

          <Section title="非表示設定">
            <Check
              checked={settings.other.hide.textLayers}
              onChange={(v) =>
                update("other", (o) => ({ ...o, hide: { ...o.hide, textLayers: v } }))
              }
              label="すべてのテキストレイヤー"
            />
            <Check
              checked={settings.other.hide.textFolder}
              onChange={(v) =>
                update("other", (o) => ({ ...o, hide: { ...o.hide, textFolder: v } }))
              }
              label="「Text」「写植」「セリフ」フォルダ"
            />
            <Check
              checked={settings.other.hide.kihonwaku}
              onChange={(v) =>
                update("other", (o) => ({ ...o, hide: { ...o.hide, kihonwaku: v } }))
              }
              label="「基本枠」レイヤー"
            />
            <Check
              checked={settings.other.hide.shirokeshi}
              onChange={(v) =>
                update("other", (o) => ({ ...o, hide: { ...o.hide, shirokeshi: v } }))
              }
              label="「白消し」レイヤー"
            />
          </Section>

          <Section title="再表示設定">
            <Check
              checked={settings.other.show.textLayers}
              onChange={(v) =>
                update("other", (o) => ({ ...o, show: { ...o.show, textLayers: v } }))
              }
              label="すべてのテキストレイヤー"
            />
            <Check
              checked={settings.other.show.textFolder}
              onChange={(v) =>
                update("other", (o) => ({ ...o, show: { ...o.show, textFolder: v } }))
              }
              label="「Text」「写植」「セリフ」フォルダ"
            />
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface rounded p-2 space-y-1.5">
      <div className="text-[10px] uppercase tracking-wide text-text-dim font-semibold">{title}</div>
      {children}
    </div>
  );
}

function Check({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 text-xs cursor-pointer hover:bg-surface-raised rounded px-1 py-0.5">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function CheckWithNum({
  checked,
  onCheckChange,
  value,
  onValueChange,
  label,
  unit,
}: {
  checked: boolean;
  onCheckChange: (v: boolean) => void;
  value: number;
  onValueChange: (v: number) => void;
  label: string;
  unit: string;
}) {
  return (
    <div className="flex items-center gap-2 text-xs px-1 py-0.5">
      <label className="flex items-center gap-1.5 cursor-pointer">
        <input type="checkbox" checked={checked} onChange={(e) => onCheckChange(e.target.checked)} />
        <span>{label}:</span>
      </label>
      <input
        type="number"
        value={value}
        onChange={(e) => onValueChange(Number(e.target.value) || 0)}
        className="w-16 px-1 py-0.5 text-xs bg-bg-primary border border-border-subtle rounded"
      />
      {unit && <span className="text-text-dim">{unit}</span>}
    </div>
  );
}
