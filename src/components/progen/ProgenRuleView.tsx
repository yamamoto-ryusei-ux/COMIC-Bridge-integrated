/**
 * ProGen ルール編集ビュー（Phase 1）
 * サイドバー（6カテゴリ）+ メインエリア（ルールカード/リスト）
 */
import { useState, useMemo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { useProgenStore } from "../../store/progenStore";
import { useScanPsdStore } from "../../store/scanPsdStore";
import { EDIT_CATEGORIES, NUMBER_SUB_RULES } from "../../types/progen";
import type { SymbolRule, ProofRule } from "../../types/progen";
import { showPromptDialog } from "../../store/viewStore";
import { openExternalUrl } from "../../hooks/useProgenTauri";
import { useUnifiedViewerStore } from "../../store/unifiedViewerStore";
import { generateSimpleCheckPrompt, generateVariationCheckPrompt, generateExtractionPrompt, generateFormattingPrompt } from "../../lib/progenPrompts";

// ═══ メインコンポーネント ═══

export function ProgenRuleView({ listMode = false }: { listMode?: boolean } = {}) {
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
          <SymbolRulePanel searchText={searchText} listMode={listMode} />
        ) : store.currentEditCategory === "number" ? (
          <NumberRulePanel />
        ) : (
          <ProofRulePanel category={store.currentEditCategory} searchText={searchText} listMode={listMode} />
        )}
      </div>
    </div>
  );
}

// ═══ 記号ルールパネル ═══

function SymbolRulePanel({ searchText, listMode }: { searchText: string; listMode: boolean }) {
  const { symbolRules, toggleSymbolRule, addSymbolRule, updateSymbolRule, deleteSymbolRule } = useProgenStore();
  const [addSrc, setAddSrc] = useState("");
  const [addDst, setAddDst] = useState("");
  const [addNote, setAddNote] = useState("");

  const filtered = useMemo(() => {
    if (!searchText) return symbolRules;
    const q = searchText.toLowerCase();
    return symbolRules.filter((r) => `${r.src}${r.dst}${r.note}`.toLowerCase().includes(q));
  }, [symbolRules, searchText]);

  const handleEdit = useCallback(async (index: number, rule: SymbolRule) => {
    const src = await showPromptDialog("変換前", rule.src);
    if (!src) return;
    const dst = await showPromptDialog("変換後", rule.dst);
    if (dst === null) return;
    const note = await showPromptDialog("備考", rule.note);
    updateSymbolRule(index, { src, dst: dst || "", note: note || "" });
  }, [updateSymbolRule]);

  // ─── 一覧モード（スキャナー経由） ───
  if (listMode) {
    return (
      <div className="flex flex-col h-full">
        <h3 className="text-xs font-bold text-text-primary mb-2">記号・句読点ルール ({filtered.length})</h3>
        <div className="flex-1 overflow-auto">
          <table className="w-full text-[10px] border-collapse">
            <thead className="sticky top-0 bg-bg-secondary">
              <tr className="border-b border-border/30 text-text-muted text-left">
                <th className="w-6 px-1 py-1"></th>
                <th className="px-1 py-1">変換前</th>
                <th className="w-4 px-0 py-1"></th>
                <th className="px-1 py-1">変換後</th>
                <th className="px-1 py-1">備考</th>
                <th className="w-5 px-0 py-1"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((rule, i) => {
                const realIdx = symbolRules.indexOf(rule);
                return (
                  <tr key={i} className={`border-b border-border/10 hover:bg-bg-tertiary/60 cursor-pointer ${!rule.active ? "opacity-40" : ""}`} onClick={() => handleEdit(realIdx, rule)}>
                    <td className="px-1 py-0.5">
                      <button onClick={(e) => { e.stopPropagation(); toggleSymbolRule(realIdx); }} className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center ${rule.active ? "bg-accent border-accent" : "border-border"}`}>
                        {rule.active && <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                      </button>
                    </td>
                    <td className="px-1 py-0.5 font-mono text-text-primary">{rule.src}</td>
                    <td className="px-0 py-0.5 text-text-muted text-center">→</td>
                    <td className="px-1 py-0.5 font-mono text-accent-secondary">{rule.dst === " " ? "(半角SP)" : rule.dst}</td>
                    <td className="px-1 py-0.5 text-text-muted truncate max-w-[120px]">{rule.note}</td>
                    <td className="px-0 py-0.5"><button onClick={(e) => { e.stopPropagation(); deleteSymbolRule(realIdx); }} className="text-text-muted/40 hover:text-error">✕</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex-shrink-0 border-t border-border/30 pt-2 mt-1">
          <div className="flex items-center gap-1">
            <input value={addSrc} onChange={(e) => setAddSrc(e.target.value)} placeholder="変換前" className="flex-1 min-w-0 text-[10px] px-1.5 py-1 bg-bg-primary border border-border/50 rounded text-text-primary outline-none focus:border-accent/50 font-mono" />
            <span className="text-[9px] text-text-muted">→</span>
            <input value={addDst} onChange={(e) => setAddDst(e.target.value)} placeholder="変換後" className="flex-1 min-w-0 text-[10px] px-1.5 py-1 bg-bg-primary border border-border/50 rounded text-text-primary outline-none focus:border-accent/50 font-mono" />
            <input value={addNote} onChange={(e) => setAddNote(e.target.value)} placeholder="備考" className="flex-1 min-w-0 text-[10px] px-1.5 py-1 bg-bg-primary border border-border/50 rounded text-text-primary outline-none focus:border-accent/50" />
            <button onClick={() => { if (!addSrc) return; addSymbolRule({ src: addSrc, dst: addDst, note: addNote, active: true }); setAddSrc(""); setAddDst(""); setAddNote(""); }} disabled={!addSrc} className="px-2 py-1 text-[9px] font-medium text-white bg-accent rounded hover:bg-accent/90 disabled:opacity-30 flex-shrink-0">追加</button>
          </div>
        </div>
      </div>
    );
  }

  // ─── カードモード（ツールメニュー経由） ───
  const [showAddForm, setShowAddForm] = useState(false);
  return (
    <div>
      <h3 className="text-xs font-bold text-text-primary mb-3">記号・句読点ルール ({filtered.length})</h3>
      <div className="grid grid-cols-2 gap-2">
        {filtered.map((rule, i) => {
          const realIdx = symbolRules.indexOf(rule);
          return (
            <div key={i} className={`bg-bg-tertiary rounded-lg px-3 py-2 transition-opacity ${!rule.active ? "opacity-40" : ""} hover:ring-1 hover:ring-accent/20 cursor-pointer`} onClick={() => handleEdit(realIdx, rule)}>
              <div className="flex items-center gap-2">
                <button onClick={(e) => { e.stopPropagation(); toggleSymbolRule(realIdx); }} className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${rule.active ? "bg-accent border-accent" : "border-border"}`}>
                  {rule.active && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                </button>
                <span className="text-[11px] font-mono text-text-primary">{rule.src}</span>
                <span className="text-[10px] text-text-muted">→</span>
                <span className="text-[11px] font-mono text-accent-secondary">{rule.dst === " " ? "(半角スペース)" : rule.dst}</span>
                <div className="flex-1" />
                <button onClick={(e) => { e.stopPropagation(); deleteSymbolRule(realIdx); }} className="text-[9px] text-text-muted hover:text-error transition-colors">✕</button>
              </div>
              {rule.note && <div className="text-[9px] text-text-muted mt-0.5 ml-6">{rule.note}</div>}
            </div>
          );
        })}
        {/* 追加カード（最後尾） */}
        {showAddForm ? (
          <div className="bg-accent/5 border-2 border-dashed border-accent/30 rounded-lg px-3 py-2">
            <div className="flex items-center gap-2 mb-1.5">
              <input value={addSrc} onChange={(e) => setAddSrc(e.target.value)} placeholder="変換前" autoFocus className="flex-1 min-w-0 text-[11px] px-1.5 py-0.5 bg-bg-primary border border-border/50 rounded text-text-primary outline-none focus:border-accent/50 font-mono" />
              <span className="text-[10px] text-text-muted">→</span>
              <input value={addDst} onChange={(e) => setAddDst(e.target.value)} placeholder="変換後" className="flex-1 min-w-0 text-[11px] px-1.5 py-0.5 bg-bg-primary border border-border/50 rounded text-text-primary outline-none focus:border-accent/50 font-mono" />
            </div>
            <input value={addNote} onChange={(e) => setAddNote(e.target.value)} placeholder="備考" className="w-full text-[10px] px-1.5 py-0.5 bg-bg-primary border border-border/50 rounded text-text-primary outline-none focus:border-accent/50 mb-1.5" />
            <div className="flex items-center gap-1.5">
              <button onClick={() => { if (!addSrc) return; addSymbolRule({ src: addSrc, dst: addDst, note: addNote, active: true }); setAddSrc(""); setAddDst(""); setAddNote(""); }} disabled={!addSrc} className="px-2.5 py-1 text-[9px] font-medium text-white bg-accent rounded hover:bg-accent/90 disabled:opacity-30">追加</button>
              <button onClick={() => { setShowAddForm(false); setAddSrc(""); setAddDst(""); setAddNote(""); }} className="px-2 py-1 text-[9px] text-text-muted hover:text-text-primary">キャンセル</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowAddForm(true)} className="bg-bg-tertiary/50 border-2 border-dashed border-border/30 rounded-lg px-3 py-3 text-[10px] text-text-muted hover:text-accent hover:border-accent/30 transition-colors flex items-center justify-center gap-1">
            <span className="text-sm">＋</span> 追加
          </button>
        )}
      </div>
    </div>
  );
}

// ═══ 校正ルールパネル ═══

function ProofRulePanel({ category, searchText, listMode }: { category: string; searchText: string; listMode: boolean }) {
  const { currentProofRules, toggleProofRule, addProofRule, updateProofRule, deleteProofRule } = useProgenStore();
  const cat = EDIT_CATEGORIES.find((c) => c.key === category);
  const [addBefore, setAddBefore] = useState("");
  const [addAfter, setAddAfter] = useState("");
  const [addNote, setAddNote] = useState("");

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

  const handleEdit = useCallback(async (realIdx: number, rule: ProofRule) => {
    const before = await showPromptDialog("変換前", rule.before);
    if (!before) return;
    const after = await showPromptDialog("変換後", rule.after);
    if (after === null) return;
    const note = await showPromptDialog("備考", rule.note);
    updateProofRule(realIdx, { before, after: after || "", note: note || "" });
  }, [updateProofRule]);

  // ─── 一覧モード ───
  if (listMode) {
    return (
      <div className="flex flex-col h-full">
        <h3 className="text-xs font-bold text-text-primary mb-2">{cat?.name || category} ({rules.length})</h3>
        <div className="flex-1 overflow-auto">
          <table className="w-full text-[10px] border-collapse">
            <thead className="sticky top-0 bg-bg-secondary">
              <tr className="border-b border-border/30 text-text-muted text-left">
                <th className="w-6 px-1 py-1"></th>
                <th className="px-1 py-1">変換前</th>
                <th className="w-4 px-0 py-1"></th>
                <th className="px-1 py-1">変換後</th>
                <th className="px-1 py-1">備考</th>
                <th className="w-5 px-0 py-1"></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule, i) => {
                const realIdx = currentProofRules.indexOf(rule);
                return (
                  <tr key={i} className={`border-b border-border/10 hover:bg-bg-tertiary/60 cursor-pointer ${!rule.active ? "opacity-40" : ""}`} onClick={() => handleEdit(realIdx, rule)}>
                    <td className="px-1 py-0.5">
                      <button onClick={(e) => { e.stopPropagation(); toggleProofRule(realIdx); }} className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center ${rule.active ? "bg-accent border-accent" : "border-border"}`}>
                        {rule.active && <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                      </button>
                    </td>
                    <td className="px-1 py-0.5 font-mono text-text-primary">{rule.before}</td>
                    <td className="px-0 py-0.5 text-text-muted text-center">→</td>
                    <td className="px-1 py-0.5 font-mono text-accent-secondary">
                      {rule.after}
                      {rule.addRuby && <span className="ml-1 text-[8px] px-0.5 rounded bg-warning/20 text-warning">ルビ</span>}
                      {rule.mode && rule.mode !== "none" && <span className="ml-1 text-[8px] px-0.5 rounded bg-accent/20 text-accent">{rule.mode}</span>}
                    </td>
                    <td className="px-1 py-0.5 text-text-muted truncate max-w-[120px]">{rule.note}</td>
                    <td className="px-0 py-0.5"><button onClick={(e) => { e.stopPropagation(); deleteProofRule(realIdx); }} className="text-text-muted/40 hover:text-error">✕</button></td>
                  </tr>
                );
              })}
              {rules.length === 0 && <tr><td colSpan={6} className="text-text-muted text-center py-6">ルールなし</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex-shrink-0 border-t border-border/30 pt-2 mt-1">
          <div className="flex items-center gap-1">
            <input value={addBefore} onChange={(e) => setAddBefore(e.target.value)} placeholder="変換前" className="flex-1 min-w-0 text-[10px] px-1.5 py-1 bg-bg-primary border border-border/50 rounded text-text-primary outline-none focus:border-accent/50 font-mono" />
            <span className="text-[9px] text-text-muted">→</span>
            <input value={addAfter} onChange={(e) => setAddAfter(e.target.value)} placeholder="変換後" className="flex-1 min-w-0 text-[10px] px-1.5 py-1 bg-bg-primary border border-border/50 rounded text-text-primary outline-none focus:border-accent/50 font-mono" />
            <input value={addNote} onChange={(e) => setAddNote(e.target.value)} placeholder="備考" className="flex-1 min-w-0 text-[10px] px-1.5 py-1 bg-bg-primary border border-border/50 rounded text-text-primary outline-none focus:border-accent/50" />
            <button onClick={() => { if (!addBefore) return; addProofRule({ before: addBefore, after: addAfter, note: addNote, active: true, category: (cat?.subCategories?.[0] || category) as any, userAdded: true }); setAddBefore(""); setAddAfter(""); setAddNote(""); }} disabled={!addBefore} className="px-2 py-1 text-[9px] font-medium text-white bg-accent rounded hover:bg-accent/90 disabled:opacity-30 flex-shrink-0">追加</button>
          </div>
        </div>
      </div>
    );
  }

  // ─── カードモード ───
  const [showAddForm, setShowAddForm] = useState(false);
  return (
    <div>
      <h3 className="text-xs font-bold text-text-primary mb-3">{cat?.name || category} ({rules.length})</h3>
      <div className="grid grid-cols-2 gap-2">
        {rules.map((rule, i) => {
          const realIdx = currentProofRules.indexOf(rule);
          return (
            <div key={i} className={`bg-bg-tertiary rounded-lg px-3 py-2 transition-opacity ${!rule.active ? "opacity-40" : ""} hover:ring-1 hover:ring-accent/20 cursor-pointer`} onClick={() => handleEdit(realIdx, rule)}>
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={(e) => { e.stopPropagation(); toggleProofRule(realIdx); }} className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${rule.active ? "bg-accent border-accent" : "border-border"}`}>
                  {rule.active && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                </button>
                <span className="text-[11px] font-mono text-text-primary">{rule.before}</span>
                <span className="text-[10px] text-text-muted">→</span>
                <span className="text-[11px] font-mono text-accent-secondary">{rule.after}</span>
                {rule.addRuby && <span className="text-[8px] px-1 rounded bg-warning/20 text-warning">ルビ</span>}
                {rule.mode && rule.mode !== "none" && <span className="text-[8px] px-1 rounded bg-accent/20 text-accent">{rule.mode}</span>}
                <div className="flex-1" />
                <button onClick={(e) => { e.stopPropagation(); deleteProofRule(realIdx); }} className="text-[9px] text-text-muted hover:text-error transition-colors">✕</button>
              </div>
              {rule.note && <div className="text-[9px] text-text-muted mt-0.5 ml-6">{rule.note}</div>}
            </div>
          );
        })}
        {rules.length === 0 && !showAddForm && <div className="col-span-2 text-text-muted text-xs text-center py-8">ルールなし</div>}
        {/* 追加カード（最後尾） */}
        {showAddForm ? (
          <div className="bg-accent/5 border-2 border-dashed border-accent/30 rounded-lg px-3 py-2">
            <div className="flex items-center gap-2 mb-1.5">
              <input value={addBefore} onChange={(e) => setAddBefore(e.target.value)} placeholder="変換前" autoFocus className="flex-1 min-w-0 text-[11px] px-1.5 py-0.5 bg-bg-primary border border-border/50 rounded text-text-primary outline-none focus:border-accent/50 font-mono" />
              <span className="text-[10px] text-text-muted">→</span>
              <input value={addAfter} onChange={(e) => setAddAfter(e.target.value)} placeholder="変換後" className="flex-1 min-w-0 text-[11px] px-1.5 py-0.5 bg-bg-primary border border-border/50 rounded text-text-primary outline-none focus:border-accent/50 font-mono" />
            </div>
            <input value={addNote} onChange={(e) => setAddNote(e.target.value)} placeholder="備考" className="w-full text-[10px] px-1.5 py-0.5 bg-bg-primary border border-border/50 rounded text-text-primary outline-none focus:border-accent/50 mb-1.5" />
            <div className="flex items-center gap-1.5">
              <button onClick={() => { if (!addBefore) return; addProofRule({ before: addBefore, after: addAfter, note: addNote, active: true, category: (cat?.subCategories?.[0] || category) as any, userAdded: true }); setAddBefore(""); setAddAfter(""); setAddNote(""); }} disabled={!addBefore} className="px-2.5 py-1 text-[9px] font-medium text-white bg-accent rounded hover:bg-accent/90 disabled:opacity-30">追加</button>
              <button onClick={() => { setShowAddForm(false); setAddBefore(""); setAddAfter(""); setAddNote(""); }} className="px-2 py-1 text-[9px] text-text-muted hover:text-text-primary">キャンセル</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowAddForm(true)} className="bg-bg-tertiary/50 border-2 border-dashed border-border/30 rounded-lg px-3 py-3 text-[10px] text-text-muted hover:text-accent hover:border-accent/30 transition-colors flex items-center justify-center gap-1">
            <span className="text-sm">＋</span> 追加
          </button>
        )}
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
  const [textSources, setTextSources] = useState<{ name: string; content: string }[]>([]);
  const [showTextPicker, setShowTextPicker] = useState<"correctness" | "proposal" | null>(null);
  const [browseDir, setBrowseDir] = useState("");
  const [browseFolders, setBrowseFolders] = useState<string[]>([]);
  const [browseFiles, setBrowseFiles] = useState<string[]>([]);

  const loadBrowseDir = useCallback(async (dir: string) => {
    try {
      const r = await invoke<{ folders: string[]; json_files: string[] }>("list_folder_contents", { folderPath: dir });
      setBrowseDir(dir);
      setBrowseFolders(r.folders || []);
      // カレントディレクトリの全ファイルからtxtをフィルタ（list_all_filesは再帰なので kenban_list_files_in_folder を使用）
      const allFiles = await invoke<string[]>("kenban_list_files_in_folder", { path: dir, extensions: ["txt"] }).catch(() => [] as string[]);
      const txtFiles = allFiles
        .map((f: string) => f.replace(/\//g, "\\").split("\\").pop() || "")
        .filter(Boolean);
      setBrowseFiles(txtFiles);
    } catch { setBrowseFolders([]); setBrowseFiles([]); }
  }, []);

  const getAllText = (): string => {
    const current = useUnifiedViewerStore.getState().textContent || "";
    const extra = textSources.map((s) => s.content).join("\n\n");
    return [current, extra].filter(Boolean).join("\n\n");
  };
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
    useProgenStore.getState().setResultSaveMode("text");
  };
  const formatting = async () => {
    const prompt = generateFormattingPrompt(
      store.symbolRules,
      store.currentProofRules,
      store.options,
      store.numberRules,
    );
    await navigator.clipboard.writeText(prompt); showCopied("整形"); gemini();
    useProgenStore.getState().setResultSaveMode("text");
  };
  const correctness = async () => {
    const text = getAllText();
    if (!text) { setShowTextPicker("correctness"); return; }
    const prompt = generateSimpleCheckPrompt(text, store.symbolRules, store.currentProofRules, store.options, store.numberRules);
    await navigator.clipboard.writeText(prompt); showCopied("正誤"); gemini();
    useProgenStore.getState().setResultSaveMode("json");
  };
  const proposal = async () => {
    const text = getAllText();
    if (!text) { setShowTextPicker("proposal"); return; }
    const prompt = generateVariationCheckPrompt(text, store.symbolRules, store.currentProofRules, store.options, store.numberRules);
    await navigator.clipboard.writeText(prompt); showCopied("提案"); gemini();
    useProgenStore.getState().setResultSaveMode("json");
  };

  return (
    <div className="flex-shrink-0 p-2 border-t border-border/30 space-y-1">
      {copied && <div className="text-[9px] text-success text-center">{copied} コピー済</div>}
      <div className="text-[8px] text-text-muted/60 mb-0.5">プロンプト生成</div>
      <div className="grid grid-cols-2 gap-1">
        <button onClick={extraction} className="px-1 py-1 text-[8px] font-medium text-white bg-blue-500 rounded hover:bg-blue-600 transition-colors">抽出</button>
        <button onClick={formatting} className="px-1 py-1 text-[8px] font-medium text-white bg-blue-500 rounded hover:bg-blue-600 transition-colors">整形</button>
        <button onClick={correctness} className="px-1 py-1 text-[8px] font-medium text-white bg-emerald-500 rounded hover:bg-emerald-600 transition-colors">正誤</button>
        <button onClick={proposal} className="px-1 py-1 text-[8px] font-medium text-white bg-orange-500 rounded hover:bg-orange-600 transition-colors">提案</button>
      </div>
      <button onClick={gemini} className="w-full px-1 py-1 text-[8px] text-blue-500 hover:bg-blue-50 rounded transition-colors">Gemini を開く</button>
      {/* テキストソース管理 */}
      <div className="text-[8px] text-text-muted/60 mt-2 mb-0.5">
        校正用テキスト追加 {textSources.length > 0 ? `(+${textSources.length}件)` : ""}
      </div>
      {textSources.length > 0 && (
        <div className="space-y-0.5 mb-1 max-h-16 overflow-auto">
          {textSources.map((s, i) => (
            <div key={i} className="flex items-center gap-0.5 text-[8px] text-text-muted">
              <span className="truncate flex-1">{s.name}</span>
              <button onClick={() => setTextSources((prev) => prev.filter((_, j) => j !== i))} className="text-text-muted/40 hover:text-error flex-shrink-0">✕</button>
            </div>
          ))}
          <button onClick={() => setTextSources([])} className="text-[7px] text-text-muted/40 hover:text-error">全クリア</button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-0.5 mb-1">
        <button
          onClick={async () => {
            const path = await dialogOpen({ filters: [{ name: "テキスト", extensions: ["txt"] }], multiple: true });
            if (!path) return;
            const paths = Array.isArray(path) ? path : [path];
            for (const p of paths) {
              try {
                const bytes = await readFile(p as string);
                const content = new TextDecoder("utf-8").decode(bytes);
                const name = (p as string).replace(/\\/g, "/").split("/").pop() || "text.txt";
                setTextSources((prev) => [...prev, { name, content }]);
              } catch { /* ignore */ }
            }
          }}
          className="px-0.5 py-0.5 text-[7px] rounded border border-border/40 text-text-muted hover:text-accent hover:border-accent/30 transition-colors truncate"
          title="エクスプローラーからテキストファイルを選択"
        >参照</button>
        <button
          onClick={() => {
            const base = useScanPsdStore.getState().textLogFolderPath || "";
            if (base) loadBrowseDir(base);
            setShowTextPicker("correctness");
          }}
          className="px-0.5 py-0.5 text-[7px] rounded border border-border/40 text-text-muted hover:text-accent hover:border-accent/30 transition-colors truncate"
          title="テキストフォルダから選択"
        >フォルダ</button>
      </div>

      {/* 結果貼り付けボタン */}
      <div className="text-[8px] text-text-muted/60 mt-1 mb-0.5">結果を貼り付け</div>
      <div className="grid grid-cols-2 gap-1">
        <button
          onClick={() => useProgenStore.getState().setResultSaveMode("text")}
          className="px-1 py-1 text-[8px] font-medium rounded border border-blue-400 text-blue-500 hover:bg-blue-50 transition-colors"
        >テキスト保存</button>
        <button
          onClick={() => useProgenStore.getState().setResultSaveMode("json")}
          className="px-1 py-1 text-[8px] font-medium rounded border border-emerald-400 text-emerald-500 hover:bg-emerald-50 transition-colors"
        >JSON保存</button>
      </div>

      {/* テキストフォルダブラウザ（チェックボックス付き） */}
      {showTextPicker && browseDir && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowTextPicker(null)}>
          <div className="bg-bg-secondary rounded-xl shadow-2xl w-[400px] max-h-[60vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-bg-tertiary/30">
              <span className="text-[10px] font-medium text-text-primary truncate flex-1">{browseDir.split(/[/\\]/).pop()}</span>
              <button onClick={() => setShowTextPicker(null)} className="text-text-muted hover:text-text-primary">✕</button>
            </div>
            <div className="flex-1 overflow-auto">
              <button
                onClick={() => { const parent = browseDir.replace(/[/\\][^/\\]+$/, ""); if (parent && parent !== browseDir) loadBrowseDir(parent); }}
                className="w-full px-3 py-1.5 text-left text-[10px] text-text-secondary hover:bg-bg-tertiary/50 flex items-center gap-1"
              >← 上へ</button>
              {browseFolders.map((f) => (
                <button key={f} onClick={() => loadBrowseDir(`${browseDir}/${f}`)} className="w-full px-3 py-1.5 text-left text-[10px] text-text-primary hover:bg-bg-tertiary/50 flex items-center gap-1.5">
                  <span className="text-sm">📁</span> {f}
                </button>
              ))}
              {browseFiles.filter((f) => f.endsWith(".txt")).map((f) => {
                const fullPath = `${browseDir}/${f}`;
                const isChecked = textSources.some((s) => s.name === f);
                return (
                  <label key={f} className="w-full px-3 py-1.5 text-left text-[10px] hover:bg-accent/5 flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={async () => {
                        if (isChecked) {
                          setTextSources((prev) => prev.filter((s) => s.name !== f));
                        } else {
                          try {
                            const content = await invoke<string>("read_text_file", { filePath: fullPath });
                            setTextSources((prev) => [...prev, { name: f, content }]);
                          } catch { /* ignore */ }
                        }
                      }}
                      className="accent-accent w-3 h-3 flex-shrink-0"
                    />
                    <span className={isChecked ? "text-accent font-medium" : "text-text-primary"}>{f}</span>
                  </label>
                );
              })}
            </div>
            <div className="px-3 py-2 border-t border-border flex items-center gap-2">
              <span className="text-[9px] text-text-muted">{textSources.length}件追加</span>
              <div className="flex-1" />
              <button onClick={() => setShowTextPicker(null)} className="px-3 py-1 text-[9px] font-medium text-white bg-accent rounded hover:bg-accent/90">完了</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
