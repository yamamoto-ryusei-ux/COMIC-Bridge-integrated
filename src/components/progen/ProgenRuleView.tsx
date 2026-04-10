/**
 * ProGen ルール編集ビュー（Phase 1）
 * サイドバー（6カテゴリ）+ メインエリア（ルールカード/リスト）
 */
import { useState, useMemo, useCallback } from "react";
import { useProgenStore } from "../../store/progenStore";
import { EDIT_CATEGORIES, NUMBER_SUB_RULES } from "../../types/progen";
import type { SymbolRule, ProofRule } from "../../types/progen";
import { showPromptDialog } from "../../store/viewStore";
import { openExternalUrl } from "../../hooks/useProgenTauri";
import { useUnifiedViewerStore } from "../../store/unifiedViewerStore";
import { generateSimpleCheckPrompt, generateVariationCheckPrompt, generateExtractionPrompt, generateFormattingPrompt } from "../../lib/progenPrompts";

// ═══ メインコンポーネント ═══

export function ProgenRuleView() {
  const store = useProgenStore();
  const [searchText, setSearchText] = useState("");

  // カテゴリ別ルール数
  const catCounts = useMemo(() => {
    const counts: Record<string, { active: number; total: number }> = {};
    for (const cat of EDIT_CATEGORIES) {
      if (cat.isSymbol) {
        const a = store.symbolRules.filter((r) => r.active).length;
        counts[cat.key] = { active: a, total: store.symbolRules.length };
      } else if (cat.isNumber) {
        counts[cat.key] = { active: store.numberRules.subRulesEnabled ? 4 : 1, total: 4 };
      } else {
        const rules = cat.subCategories
          ? store.currentProofRules.filter((r) => cat.subCategories!.includes(r.category))
          : store.currentProofRules.filter((r) => r.category === cat.key);
        const a = rules.filter((r) => r.active).length;
        counts[cat.key] = { active: a, total: rules.length };
      }
    }
    return counts;
  }, [store.symbolRules, store.currentProofRules, store.numberRules]);

  return (
    <div className="flex h-full overflow-hidden">
      {/* サイドバー */}
      <div className="w-[160px] flex-shrink-0 border-r border-border/50 flex flex-col bg-bg-tertiary/30">
        <div className="flex-1 overflow-y-auto">
          {EDIT_CATEGORIES.map((cat) => {
            const c = catCounts[cat.key];
            return (
              <button
                key={cat.key}
                onClick={() => store.setCurrentEditCategory(cat.key)}
                className={`w-full text-left px-3 py-2.5 text-[10px] transition-colors border-b border-border/10 flex items-center justify-between ${
                  store.currentEditCategory === cat.key
                    ? "bg-accent/10 text-accent font-medium"
                    : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary"
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <span className="text-sm">{cat.icon}</span>
                  <span>{cat.name}</span>
                </span>
                {c && <span className="text-[9px] text-text-muted tabular-nums">{c.active}/{c.total}</span>}
              </button>
            );
          })}
        </div>
        {/* 検索 */}
        <div className="flex-shrink-0 p-2 border-t border-border/30">
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="ルール検索..."
            className="w-full text-[9px] px-2 py-1 bg-bg-primary border border-border/50 rounded text-text-primary outline-none focus:border-accent/50"
          />
        </div>
        {/* Geminiボタン群 */}
        <GeminiButtons />
      </div>

      {/* メインエリア */}
      <div className="flex-1 overflow-auto p-3">
        {store.currentEditCategory === "symbol" ? (
          <SymbolRulePanel searchText={searchText} />
        ) : store.currentEditCategory === "number" ? (
          <NumberRulePanel />
        ) : (
          <ProofRulePanel category={store.currentEditCategory} searchText={searchText} />
        )}
      </div>
    </div>
  );
}

// ═══ 記号ルールパネル ═══

function SymbolRulePanel({ searchText }: { searchText: string }) {
  const { symbolRules, toggleSymbolRule, addSymbolRule, updateSymbolRule, deleteSymbolRule } = useProgenStore();

  const filtered = useMemo(() => {
    if (!searchText) return symbolRules;
    const q = searchText.toLowerCase();
    return symbolRules.filter((r) => `${r.src}${r.dst}${r.note}`.toLowerCase().includes(q));
  }, [symbolRules, searchText]);

  const handleAdd = useCallback(async () => {
    const src = await showPromptDialog("変換前", "");
    if (!src) return;
    const dst = await showPromptDialog("変換後", "");
    if (dst === null) return;
    const note = await showPromptDialog("備考", "");
    addSymbolRule({ src, dst: dst || "", note: note || "", active: true });
  }, [addSymbolRule]);

  const handleEdit = useCallback(async (index: number, rule: SymbolRule) => {
    const src = await showPromptDialog("変換前", rule.src);
    if (!src) return;
    const dst = await showPromptDialog("変換後", rule.dst);
    if (dst === null) return;
    const note = await showPromptDialog("備考", rule.note);
    updateSymbolRule(index, { src, dst: dst || "", note: note || "" });
  }, [updateSymbolRule]);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-bold text-text-primary">記号・句読点ルール ({filtered.length})</h3>
        <button onClick={handleAdd} className="px-2 py-1 text-[9px] font-medium text-accent bg-accent/10 rounded hover:bg-accent/20 transition-colors">＋ 追加</button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {filtered.map((rule, i) => {
          const realIdx = symbolRules.indexOf(rule);
          return (
            <div
              key={i}
              className={`bg-bg-tertiary rounded-lg px-3 py-2 transition-opacity ${!rule.active ? "opacity-40" : ""} hover:ring-1 hover:ring-accent/20 cursor-pointer`}
              onClick={() => handleEdit(realIdx, rule)}
            >
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); toggleSymbolRule(realIdx); }}
                  className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                    rule.active ? "bg-accent border-accent" : "border-border"
                  }`}
                >
                  {rule.active && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                </button>
                <span className="text-[11px] font-mono text-text-primary">{rule.src}</span>
                <span className="text-[10px] text-text-muted">→</span>
                <span className="text-[11px] font-mono text-accent-secondary">{rule.dst === " " ? "(半角スペース)" : rule.dst}</span>
                <div className="flex-1" />
                <button
                  onClick={(e) => { e.stopPropagation(); if (window.confirm("削除しますか？")) deleteSymbolRule(realIdx); }}
                  className="text-[9px] text-text-muted hover:text-error transition-colors"
                >✕</button>
              </div>
              {rule.note && <div className="text-[9px] text-text-muted mt-0.5 ml-6">{rule.note}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══ 校正ルールパネル ═══

function ProofRulePanel({ category, searchText }: { category: string; searchText: string }) {
  const { currentProofRules, toggleProofRule, addProofRule, updateProofRule, deleteProofRule } = useProgenStore();
  const cat = EDIT_CATEGORIES.find((c) => c.key === category);

  const rules = useMemo(() => {
    let filtered = cat?.subCategories
      ? currentProofRules.filter((r) => cat.subCategories!.includes(r.category))
      : currentProofRules.filter((r) => r.category === category);
    if (searchText) {
      const q = searchText.toLowerCase();
      filtered = filtered.filter((r) => `${r.before}${r.after}${r.note}`.toLowerCase().includes(q));
    }
    return filtered;
  }, [currentProofRules, category, cat, searchText]);

  const handleAdd = useCallback(async () => {
    const before = await showPromptDialog("変換前", "");
    if (!before) return;
    const after = await showPromptDialog("変換後", "");
    if (after === null) return;
    const note = await showPromptDialog("備考", "");
    addProofRule({
      before, after: after || "", note: note || "", active: true,
      category: (cat?.subCategories?.[0] || category) as any,
      userAdded: true,
    });
  }, [addProofRule, category, cat]);

  const handleEdit = useCallback(async (realIdx: number, rule: ProofRule) => {
    const before = await showPromptDialog("変換前", rule.before);
    if (!before) return;
    const after = await showPromptDialog("変換後", rule.after);
    if (after === null) return;
    const note = await showPromptDialog("備考", rule.note);
    updateProofRule(realIdx, { before, after: after || "", note: note || "" });
  }, [updateProofRule]);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-bold text-text-primary">{cat?.name || category} ({rules.length})</h3>
        <button onClick={handleAdd} className="px-2 py-1 text-[9px] font-medium text-accent bg-accent/10 rounded hover:bg-accent/20 transition-colors">＋ 追加</button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {rules.map((rule, i) => {
          const realIdx = currentProofRules.indexOf(rule);
          return (
            <div
              key={i}
              className={`bg-bg-tertiary rounded-lg px-3 py-2 transition-opacity ${!rule.active ? "opacity-40" : ""} hover:ring-1 hover:ring-accent/20 cursor-pointer`}
              onClick={() => handleEdit(realIdx, rule)}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={(e) => { e.stopPropagation(); toggleProofRule(realIdx); }}
                  className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                    rule.active ? "bg-accent border-accent" : "border-border"
                  }`}
                >
                  {rule.active && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                </button>
                <span className="text-[11px] font-mono text-text-primary">{rule.before}</span>
                <span className="text-[10px] text-text-muted">→</span>
                <span className="text-[11px] font-mono text-accent-secondary">{rule.after}</span>
                {rule.addRuby && <span className="text-[8px] px-1 rounded bg-warning/20 text-warning">ルビ</span>}
                {rule.mode && rule.mode !== "none" && <span className="text-[8px] px-1 rounded bg-accent/20 text-accent">{rule.mode}</span>}
                <div className="flex-1" />
                <button
                  onClick={(e) => { e.stopPropagation(); if (window.confirm("削除しますか？")) deleteProofRule(realIdx); }}
                  className="text-[9px] text-text-muted hover:text-error transition-colors"
                >✕</button>
              </div>
              {rule.note && <div className="text-[9px] text-text-muted mt-0.5 ml-6">{rule.note}</div>}
            </div>
          );
        })}
        {rules.length === 0 && <div className="col-span-2 text-text-muted text-xs text-center py-8">ルールなし</div>}
      </div>
    </div>
  );
}

// ═══ 数字ルールパネル ═══

function NumberRulePanel() {
  const { numberRules, setNumberRule } = useProgenStore();
  const baseOptions = ["算用数字混在を許容", "全て算用数字に", "全て漢数字に"];

  return (
    <div className="space-y-4">
      <h3 className="text-xs font-bold text-text-primary">数字ルール</h3>
      {/* ベースルール */}
      <div className="bg-bg-tertiary rounded-lg p-3">
        <div className="text-[10px] text-text-muted mb-1.5">基本ルール</div>
        <select
          value={numberRules.base}
          onChange={(e) => setNumberRule("base", Number(e.target.value))}
          className="w-full text-[11px] px-2 py-1.5 bg-bg-primary border border-border/50 rounded text-text-primary outline-none"
        >
          {baseOptions.map((opt, i) => <option key={i} value={i}>{opt}</option>)}
        </select>
      </div>
      {/* サブルール有効化 */}
      <label className="flex items-center gap-2 px-3 cursor-pointer">
        <input type="checkbox" checked={numberRules.subRulesEnabled} onChange={(e) => setNumberRule("subRulesEnabled", e.target.checked)} className="accent-accent" />
        <span className="text-[10px] text-text-primary">サブルールを有効にする</span>
      </label>
      {/* サブルール */}
      {numberRules.subRulesEnabled && (
        <div className="space-y-3">
          {(Object.entries(NUMBER_SUB_RULES) as [string, { label: string; options: readonly string[] }][]).map(([key, def]) => (
            <div key={key} className="bg-bg-tertiary rounded-lg p-3">
              <div className="text-[10px] text-text-muted mb-1.5">{def.label}</div>
              <select
                value={(numberRules as any)[key === "personCount" ? "personCount" : key === "thingCount" ? "thingCount" : "month"]}
                onChange={(e) => setNumberRule(key as any, Number(e.target.value))}
                className="w-full text-[11px] px-2 py-1.5 bg-bg-primary border border-border/50 rounded text-text-primary outline-none"
              >
                {def.options.map((opt, i) => <option key={i} value={i}>{opt}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══ Geminiボタン群 ═══

function GeminiButtons() {
  const store = useProgenStore();
  const [copied, setCopied] = useState<string | null>(null);

  const getTextContent = () => useUnifiedViewerStore.getState().textContent || "";
  const showCopied = (msg: string) => { setCopied(msg); setTimeout(() => setCopied(null), 2000); };
  const gemini = () => openExternalUrl("https://gemini.google.com/app");

  const extraction = async () => {
    // 抽出プロンプトはテキスト不要（後から画像を送信する）
    const prompt = generateExtractionPrompt(
      store.symbolRules,
      store.currentProofRules,
      store.options,
      store.numberRules,
    );
    await navigator.clipboard.writeText(prompt); showCopied("抽出"); gemini();
  };
  const formatting = async () => {
    // 整形プロンプトはルールのみ（テキストは添付ファイルとしてGeminiに送る想定）
    const prompt = generateFormattingPrompt(
      store.symbolRules,
      store.currentProofRules,
      store.options,
      store.numberRules,
    );
    await navigator.clipboard.writeText(prompt); showCopied("整形"); gemini();
  };
  const correctness = async () => {
    const prompt = generateSimpleCheckPrompt(
      getTextContent() || "（未読み込み）",
      store.symbolRules,
      store.currentProofRules,
      store.options,
      store.numberRules,
    );
    await navigator.clipboard.writeText(prompt); showCopied("正誤"); gemini();
  };
  const proposal = async () => {
    const prompt = generateVariationCheckPrompt(
      getTextContent() || "（未読み込み）",
      store.symbolRules,
      store.currentProofRules,
      store.options,
      store.numberRules,
    );
    await navigator.clipboard.writeText(prompt); showCopied("提案"); gemini();
  };

  return (
    <div className="flex-shrink-0 p-2 border-t border-border/30 space-y-1">
      {copied && <div className="text-[9px] text-success text-center">{copied} コピー済</div>}
      <div className="grid grid-cols-2 gap-1">
        <button onClick={extraction} className="px-1 py-1 text-[8px] font-medium text-white bg-blue-500 rounded hover:bg-blue-600 transition-colors">抽出</button>
        <button onClick={formatting} className="px-1 py-1 text-[8px] font-medium text-white bg-blue-500 rounded hover:bg-blue-600 transition-colors">整形</button>
        <button onClick={correctness} className="px-1 py-1 text-[8px] font-medium text-white bg-emerald-500 rounded hover:bg-emerald-600 transition-colors">正誤</button>
        <button onClick={proposal} className="px-1 py-1 text-[8px] font-medium text-white bg-orange-500 rounded hover:bg-orange-600 transition-colors">提案</button>
      </div>
      <button onClick={gemini} className="w-full px-1 py-1 text-[8px] text-blue-500 hover:bg-blue-50 rounded transition-colors">Gemini を開く</button>
    </div>
  );
}
