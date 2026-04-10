import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useScanPsdStore } from "../../store/scanPsdStore";
import { useUnifiedViewerStore } from "../../store/unifiedViewerStore";

interface SymbolRule { src: string; dst: string; note: string; active: boolean; }
interface ProofRule { category: string; before: string; after: string; note?: string; active: boolean; addRuby?: boolean; mode?: string; userAdded?: boolean; [key: string]: any; }
interface MasterRuleData { proofRules?: { symbol?: SymbolRule[]; proof?: ProofRule[]; options?: Record<string, any>; }; }

const CATEGORIES = [
  { key: "symbol", name: "記号・句読点", icon: "⋮" },
  { key: "notation", name: "表記変更", icon: "✏️", subCategories: ["basic", "recommended"] },
  { key: "difficult", name: "難読文字", icon: "字" },
  { key: "number", name: "数字", icon: "#" },
  { key: "pronoun", name: "人称", icon: "👤" },
  { key: "character", name: "人物名", icon: "🏷️" },
];

export function ProgenJsonBrowser() {
  const workInfo = useScanPsdStore((s) => s.workInfo);
  const [masterData, setMasterData] = useState<MasterRuleData | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [selectedCat, setSelectedCat] = useState("symbol");
  const [searchText, setSearchText] = useState("");

  // workInfo.labelからマスタールール自動読み込み
  useEffect(() => {
    if (!workInfo.label) return;
    (async () => {
      try {
        const listRes = await invoke<any>("progen_get_master_label_list");
        if (!listRes?.success || !Array.isArray(listRes.labels)) return;
        const labelLower = workInfo.label.toLowerCase();
        const match = listRes.labels.find((l: any) => {
          const dn = (l.display_name || l.displayName || "").toLowerCase();
          const k = (l.key || "").toLowerCase();
          return dn === labelLower || k === labelLower || dn.includes(labelLower) || labelLower.includes(dn);
        });
        if (!match) return;
        const ruleRes = await invoke<any>("progen_read_master_rule", { labelValue: match.key });
        if (ruleRes?.success && ruleRes.data) setMasterData(ruleRes.data);
      } catch { /* ignore */ }
    })();
  }, [workInfo.label]);

  const showCopied = (msg: string) => { setCopied(msg); setTimeout(() => setCopied(null), 2000); };
  const handleOpenGemini = useCallback(async () => { await invoke("open_with_default_app", { filePath: "https://gemini.google.com/app" }).catch(() => {}); }, []);
  const getTextContent = () => useUnifiedViewerStore.getState().textContent || "";

  const buildSymbolRulesText = () => (masterData?.proofRules?.symbol?.filter((r) => r.active) || []).map((r) => `「${r.src}」→「${r.dst}」（${r.note}）`).join("\n");

  const handleExtractionGemini = useCallback(async () => {
    const prompt = `以下の統一表記ルールに従って、テキストからセリフを抽出・整形してください。\n\n【統一表記ルール】\n${buildSymbolRulesText() || "（ルールなし）"}\n\n【対象テキスト】\n${getTextContent() || "（テキスト未読み込み）"}\n\n【指示】\n- 漫画の読み順（右上→左下）でセリフを抽出\n- 吹き出し1つにつき1ブロック、空行で区切る\n- 統一表記ルールの記号変換を適用\n- 手書き効果音は除外`;
    await navigator.clipboard.writeText(prompt).catch(() => {}); showCopied("抽出"); handleOpenGemini();
  }, [masterData]);

  const handleFormattingGemini = useCallback(async () => {
    const prompt = `以下のルールに従って、テキストを整形・校正してください。\n\n【統一表記ルール】\n${buildSymbolRulesText() || "（ルールなし）"}\n\n【校正ルール】\n${JSON.stringify(masterData?.proofRules?.proof || [], null, 2)}\n\n【対象テキスト】\n${getTextContent() || "（テキスト未読み込み）"}\n\n【指示】\n- 統一表記ルールの記号変換を適用\n- 校正ルールに従って表記を統一\n- 吹き出し区切り（空行）を維持`;
    await navigator.clipboard.writeText(prompt).catch(() => {}); showCopied("整形"); handleOpenGemini();
  }, [masterData]);

  const handleCorrectnessGemini = useCallback(async () => {
    const prompt = `以下のテキストについて、正誤チェック（誤字・脱字・人名ルビ）を5パス実行してください。\n\n【対象テキスト】\n${getTextContent() || "（テキスト未読み込み）"}\n\n【チェック項目】\n1. 誤字（変換ミス、タイプミス）\n2. 脱字（文字の脱落）\n3. 人名ルビ（初出のみ）\n\n【出力形式】\n| 種別 | 箇所(ページ) | セリフ抜粋 | 指摘内容 |`;
    await navigator.clipboard.writeText(prompt).catch(() => {}); showCopied("正誤"); handleOpenGemini();
  }, []);

  const handleProposalGemini = useCallback(async () => {
    const prompt = `以下のテキストについて、表記ゆれ・提案チェックを5パス実行してください。\n\n【対象テキスト】\n${getTextContent() || "（テキスト未読み込み）"}\n\n【チェック10項目】\n1. 漢字/ひらがな/カタカナの混在\n2. 送り仮名のゆれ\n3. 外来語・長音符のゆれ\n4. 数字・漢数字の統一\n5. 略称・別表現の混在\n6. 異体字\n7. 文体の統一\n8. 固有名詞・商標の正確性\n9. 専門用語・事実確認\n10. 未成年表現チェック\n\n【出力形式】\n| チェック項目 | 箇所(ページ) | セリフ抜粋 | 指摘内容 |`;
    await navigator.clipboard.writeText(prompt).catch(() => {}); showCopied("提案"); handleOpenGemini();
  }, []);

  // カテゴリ別ルール取得
  const symbolRules = masterData?.proofRules?.symbol || [];
  const proofRules = masterData?.proofRules?.proof || [];
  const options = masterData?.proofRules?.options || {};

  const getCatRules = useCallback((catKey: string) => {
    const cat = CATEGORIES.find((c) => c.key === catKey);
    if (!cat) return [];
    if (catKey === "symbol") return symbolRules;
    if ((cat as any).subCategories) return proofRules.filter((r) => (cat as any).subCategories.includes(r.category));
    return proofRules.filter((r) => r.category === catKey);
  }, [symbolRules, proofRules]);

  const catRules = useMemo(() => getCatRules(selectedCat), [selectedCat, getCatRules]);
  const filteredRules = useMemo(() => {
    if (!searchText) return catRules;
    const q = searchText.toLowerCase();
    return catRules.filter((r: any) => {
      const text = `${r.src || ""}${r.dst || ""}${r.before || ""}${r.after || ""}${r.note || ""}`.toLowerCase();
      return text.includes(q);
    });
  }, [catRules, searchText]);

  const catCounts = useMemo(() => {
    const counts: Record<string, { active: number; total: number }> = {};
    for (const cat of CATEGORIES) {
      const rules = getCatRules(cat.key);
      const active = cat.key === "symbol"
        ? (rules as SymbolRule[]).filter((r) => r.active).length
        : cat.key === "number" ? (options.numberRuleBase ? 1 : 0)
        : (rules as ProofRule[]).filter((r) => r.active).length;
      counts[cat.key] = { active, total: rules.length };
    }
    return counts;
  }, [getCatRules, options]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ヘッダー */}
      <div className="flex-shrink-0 px-4 py-2 border-b border-border bg-bg-secondary flex items-center gap-2 flex-wrap">
        <span className="text-xs font-bold text-text-primary">ProGen ルール一覧</span>
        {workInfo.label && <span className="text-[10px] px-2 py-0.5 rounded bg-accent-secondary/15 text-accent-secondary font-medium">{workInfo.label}</span>}
        <div className="flex-1" />
        {copied && <span className="text-[9px] text-success font-medium">{copied} コピー済</span>}
        <div className="flex items-center gap-1">
          <button onClick={handleExtractionGemini} className="px-2 py-1 text-[9px] font-medium text-white bg-blue-500 rounded hover:bg-blue-600 transition-colors">抽出</button>
          <button onClick={handleFormattingGemini} className="px-2 py-1 text-[9px] font-medium text-white bg-blue-500 rounded hover:bg-blue-600 transition-colors">整形</button>
          <button onClick={handleCorrectnessGemini} className="px-2 py-1 text-[9px] font-medium text-white bg-emerald-500 rounded hover:bg-emerald-600 transition-colors">正誤</button>
          <button onClick={handleProposalGemini} className="px-2 py-1 text-[9px] font-medium text-white bg-orange-500 rounded hover:bg-orange-600 transition-colors">提案</button>
          <button onClick={handleOpenGemini} className="px-2 py-1 text-[9px] text-blue-500 hover:bg-blue-50 rounded transition-colors">Gemini</button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* サイドバー: カテゴリ */}
        <div className="w-[150px] flex-shrink-0 border-r border-border/50 flex flex-col bg-bg-tertiary/30">
          <div className="flex-1 overflow-y-auto">
            {CATEGORIES.map((cat) => {
              const c = catCounts[cat.key];
              return (
                <button
                  key={cat.key}
                  onClick={() => setSelectedCat(cat.key)}
                  className={`w-full text-left px-3 py-2 text-[10px] transition-colors border-b border-border/10 flex items-center justify-between ${
                    selectedCat === cat.key ? "bg-accent/10 text-accent font-medium" : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary"
                  }`}
                >
                  <span>{cat.icon} {cat.name}</span>
                  {c && <span className="text-[9px] text-text-muted">{c.active}/{c.total}</span>}
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
              placeholder="検索..."
              className="w-full text-[9px] px-2 py-1 bg-bg-primary border border-border/50 rounded text-text-primary outline-none"
            />
          </div>
        </div>

        {/* メイン: ルール一覧 */}
        <div className="flex-1 overflow-auto p-3">
          {!masterData ? (
            <div className="flex items-center justify-center h-full text-text-muted text-xs">
              {workInfo.label ? `「${workInfo.label}」のルールを読み込み中...` : "レーベル未設定"}
            </div>
          ) : selectedCat === "symbol" ? (
            /* 記号・句読点 */
            <div className="grid grid-cols-2 gap-2">
              {(filteredRules as SymbolRule[]).map((rule, i) => (
                <div key={i} className={`bg-bg-tertiary rounded-lg px-3 py-2 ${!rule.active ? "opacity-40" : ""}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-mono text-text-primary">{rule.src}</span>
                    <span className="text-[10px] text-text-muted">→</span>
                    <span className="text-[11px] font-mono text-accent-secondary">{rule.dst}</span>
                  </div>
                  {rule.note && <div className="text-[9px] text-text-muted mt-0.5">{rule.note}</div>}
                </div>
              ))}
            </div>
          ) : selectedCat === "number" ? (
            /* 数字 */
            <div className="space-y-2">
              {Object.entries(options).filter(([k]) => k.startsWith("numberRule")).map(([key, val]) => (
                <div key={key} className="bg-bg-tertiary rounded-lg px-3 py-2 flex items-center justify-between">
                  <span className="text-[10px] text-text-primary">{key.replace("numberRule", "")}</span>
                  <span className="text-[10px] font-mono text-accent">{String(val)}</span>
                </div>
              ))}
              {Object.entries(options).filter(([k]) => k.startsWith("numberRule")).length === 0 && (
                <div className="text-text-muted text-xs text-center py-4">数字ルールなし</div>
              )}
            </div>
          ) : (
            /* 校正ルール（表記変更、難読文字、人称、人物名） */
            <div className="grid grid-cols-2 gap-2">
              {(filteredRules as ProofRule[]).map((rule, i) => (
                <div key={i} className={`bg-bg-tertiary rounded-lg px-3 py-2 ${!rule.active ? "opacity-40" : ""}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-mono text-text-primary">{rule.before}</span>
                    <span className="text-[10px] text-text-muted">→</span>
                    <span className="text-[11px] font-mono text-accent-secondary">{rule.after}</span>
                    {rule.addRuby && <span className="text-[8px] px-1 py-0 rounded bg-warning/20 text-warning">ルビ</span>}
                    {rule.mode && rule.mode !== "none" && <span className="text-[8px] px-1 py-0 rounded bg-accent/20 text-accent">{rule.mode}</span>}
                  </div>
                  {rule.note && <div className="text-[9px] text-text-muted mt-0.5">{rule.note}</div>}
                  <div className="text-[8px] text-text-muted/50 mt-0.5">{rule.category}</div>
                </div>
              ))}
              {filteredRules.length === 0 && (
                <div className="col-span-2 text-text-muted text-xs text-center py-4">ルールなし</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
