/**
 * ProGen 管理画面ビュー
 * マスタールールのレーベル横断管理。パスワード保護付き。
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  readMasterRule, writeMasterRule, createMasterLabel, getMasterLabelList,
} from "../../hooks/useProgenTauri";
import type { SymbolRule, ProofRule, ProofCategory, ProgenOptions, NumberRuleState } from "../../types/progen";
import { EDIT_CATEGORIES, NUMBER_SUB_RULES, DEFAULT_SYMBOL_RULES, DEFAULT_OPTIONS, DEFAULT_NUMBER_RULES } from "../../types/progen";

// ═══ 定数 ═══

const ADMIN_PASSWORD = "progen2026";

const OPTIONS_LABELS: { key: keyof ProgenOptions; label: string }[] = [
  { key: "ngWordMasking", label: "NGワード伏字" },
  { key: "punctuationToSpace", label: "句読点→スペース" },
  { key: "difficultRuby", label: "難読漢字ルビ" },
  { key: "typoCheck", label: "誤字チェック" },
  { key: "missingCharCheck", label: "脱字チェック" },
  { key: "nameRubyCheck", label: "人名ルビチェック" },
  { key: "nonJoyoCheck", label: "常用外漢字チェック" },
];

const DIFFICULT_MODES = [
  { value: "open", label: "ひらく" },
  { value: "ruby", label: "ルビ" },
  { value: "none", label: "なし" },
] as const;

// ═══ Props ═══

interface Props {
  onBack: () => void;
}

// ═══ メインコンポーネント ═══

export function ProgenAdminView({ onBack }: Props) {
  // --- Auth ---
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");

  // --- Data ---
  const [labels, setLabels] = useState<{ key: string; displayName: string }[]>([]);
  const [currentLabel, setCurrentLabel] = useState("default");
  const [proofRules, setProofRules] = useState<ProofRule[]>([]);
  const [symbolRules, setSymbolRules] = useState<SymbolRule[]>([...DEFAULT_SYMBOL_RULES]);
  const [options, setOptions] = useState<ProgenOptions>({ ...DEFAULT_OPTIONS });
  const [numberRules, setNumberRules] = useState<NumberRuleState>({ ...DEFAULT_NUMBER_RULES });

  // --- UI ---
  const [currentCategory, setCurrentCategory] = useState("symbol");
  const [viewMode, setViewMode] = useState<"edit" | "list">("edit");
  const [saving, setSaving] = useState(false);

  // --- Edit modal ---
  const [editModal, setEditModal] = useState<{
    open: boolean; index: number; category: string;
    src: string; dst: string; note: string;
  } | null>(null);

  // --- New label modal ---
  const [showNewLabel, setShowNewLabel] = useState(false);
  const [newLabelKey, setNewLabelKey] = useState("");
  const [newLabelDisplay, setNewLabelDisplay] = useState("");
  const [newLabelError, setNewLabelError] = useState("");

  // ═══ ラベル一覧読み込み ═══

  const loadLabels = useCallback(async () => {
    try {
      const res = await getMasterLabelList();
      if (res.success && res.labels) {
        setLabels(res.labels.map((l) => ({
          key: l.key,
          displayName: l.display_name || l.displayName || l.key,
        })));
      }
    } catch (e) {
      console.error("Failed to load labels:", e);
    }
  }, []);

  // ═══ ルール読み込み ═══

  const loadRules = useCallback(async (label: string) => {
    try {
      const res = await readMasterRule(label);
      if (res.success && res.data) {
        const d = res.data.proofRules || res.data;
        if (d.symbol && Array.isArray(d.symbol)) {
          setSymbolRules(d.symbol);
        } else {
          setSymbolRules([...DEFAULT_SYMBOL_RULES]);
        }
        if (d.proof && Array.isArray(d.proof)) {
          setProofRules(d.proof);
        } else {
          setProofRules([]);
        }
        if (d.options) {
          setOptions({ ...DEFAULT_OPTIONS, ...d.options });
        } else {
          setOptions({ ...DEFAULT_OPTIONS });
        }
        if (d.number) {
          setNumberRules({ ...DEFAULT_NUMBER_RULES, ...d.number });
        } else {
          setNumberRules({ ...DEFAULT_NUMBER_RULES });
        }
      }
    } catch (e) {
      console.error("Failed to load master rule:", e);
    }
  }, []);

  // ═══ 認証後の初期化 ═══

  useEffect(() => {
    if (authenticated) {
      loadLabels();
      loadRules(currentLabel);
    }
  }, [authenticated]);

  // ═══ ラベル変更 ═══

  useEffect(() => {
    if (authenticated) {
      loadRules(currentLabel);
    }
  }, [currentLabel]);

  // ═══ 認証処理 ═══

  const handleAuth = useCallback(() => {
    if (password === ADMIN_PASSWORD) {
      setAuthenticated(true);
      setAuthError("");
    } else {
      setAuthError("パスワードが違います");
    }
  }, [password]);

  // ═══ 保存処理 ═══

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await writeMasterRule(currentLabel, {
        proofRules: {
          proof: proofRules,
          symbol: symbolRules,
          options,
          number: numberRules,
        },
      });
    } catch (e) {
      console.error("Failed to save:", e);
    } finally {
      setSaving(false);
    }
  }, [currentLabel, proofRules, symbolRules, options, numberRules]);

  // ═══ 新規ラベル作成 ═══

  const handleCreateLabel = useCallback(async () => {
    setNewLabelError("");
    if (!newLabelKey) {
      setNewLabelError("キーを入力してください");
      return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(newLabelKey)) {
      setNewLabelError("英数字とアンダースコアのみ使用可能です");
      return;
    }
    if (labels.some((l) => l.key === newLabelKey)) {
      setNewLabelError("このキーは既に存在します");
      return;
    }
    try {
      await createMasterLabel(newLabelKey, newLabelDisplay || newLabelKey);
      setShowNewLabel(false);
      setNewLabelKey("");
      setNewLabelDisplay("");
      await loadLabels();
      setCurrentLabel(newLabelKey);
    } catch (e) {
      setNewLabelError("作成に失敗しました");
    }
  }, [newLabelKey, newLabelDisplay, labels, loadLabels]);

  // ═══ ルール操作ヘルパー ═══

  const handleToggleSymbol = useCallback((index: number) => {
    setSymbolRules((prev) => prev.map((r, i) => i === index ? { ...r, active: !r.active } : r));
  }, []);

  const handleDeleteSymbol = useCallback((index: number) => {
    if (!window.confirm("この記号ルールを削除しますか？")) return;
    setSymbolRules((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleToggleProof = useCallback((index: number) => {
    setProofRules((prev) => prev.map((r, i) => i === index ? { ...r, active: !r.active } : r));
  }, []);

  const handleDeleteProof = useCallback((index: number) => {
    if (!window.confirm("このルールを削除しますか？")) return;
    setProofRules((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSetDifficultMode = useCallback((index: number, mode: "open" | "ruby" | "none") => {
    setProofRules((prev) => prev.map((r, i) => i === index ? { ...r, mode } : r));
  }, []);

  // ═══ ルール追加 ═══

  const handleAddRule = useCallback(() => {
    if (currentCategory === "symbol") {
      const newRule: SymbolRule = { src: "", dst: "", note: "", active: true };
      setSymbolRules((prev) => [...prev, newRule]);
      setEditModal({
        open: true, index: symbolRules.length, category: "symbol",
        src: "", dst: "", note: "",
      });
    } else if (currentCategory === "number") {
      return; // number has no add
    } else {
      const cat = EDIT_CATEGORIES.find((c) => c.key === currentCategory);
      const category: ProofCategory = (cat?.subCategories?.[0] || currentCategory) as ProofCategory;
      const newRule: ProofRule = { before: "", after: "", note: "", active: true, category };
      setProofRules((prev) => [...prev, newRule]);
      setEditModal({
        open: true, index: proofRules.length, category: currentCategory,
        src: "", dst: "", note: "",
      });
    }
  }, [currentCategory, symbolRules.length, proofRules.length]);

  // ═══ 編集モーダル保存 ═══

  const handleEditSave = useCallback(() => {
    if (!editModal) return;
    if (editModal.category === "symbol") {
      setSymbolRules((prev) => prev.map((r, i) =>
        i === editModal.index ? { ...r, src: editModal.src, dst: editModal.dst, note: editModal.note } : r
      ));
    } else {
      setProofRules((prev) => prev.map((r, i) =>
        i === editModal.index ? { ...r, before: editModal.src, after: editModal.dst, note: editModal.note } : r
      ));
    }
    setEditModal(null);
  }, [editModal]);

  // ═══ 編集モーダルを開く ═══

  const openEditSymbol = useCallback((index: number, rule: SymbolRule) => {
    setEditModal({ open: true, index, category: "symbol", src: rule.src, dst: rule.dst, note: rule.note });
  }, []);

  const openEditProof = useCallback((index: number, rule: ProofRule) => {
    setEditModal({ open: true, index, category: currentCategory, src: rule.before, dst: rule.after, note: rule.note });
  }, [currentCategory]);

  // ═══ カテゴリ別フィルタ ═══

  const filteredProofRules = useMemo(() => {
    const cat = EDIT_CATEGORIES.find((c) => c.key === currentCategory);
    if (cat?.subCategories) {
      return proofRules.map((r, i) => ({ rule: r, index: i })).filter(({ rule }) => cat.subCategories!.includes(rule.category));
    }
    return proofRules.map((r, i) => ({ rule: r, index: i })).filter(({ rule }) => rule.category === currentCategory);
  }, [proofRules, currentCategory]);

  // ═══ カテゴリ別カウント ═══

  const catCounts = useMemo(() => {
    const counts: Record<string, { active: number; total: number }> = {};
    for (const cat of EDIT_CATEGORIES) {
      if (cat.isSymbol) {
        const a = symbolRules.filter((r) => r.active).length;
        counts[cat.key] = { active: a, total: symbolRules.length };
      } else if (cat.isNumber) {
        counts[cat.key] = { active: numberRules.subRulesEnabled ? 4 : 1, total: 4 };
      } else {
        const rules = cat.subCategories
          ? proofRules.filter((r) => cat.subCategories!.includes(r.category))
          : proofRules.filter((r) => r.category === cat.key);
        const a = rules.filter((r) => r.active).length;
        counts[cat.key] = { active: a, total: rules.length };
      }
    }
    return counts;
  }, [symbolRules, proofRules, numberRules]);

  // ═══ リスト表示用グループ ═══

  const listGroups = useMemo(() => {
    const col1 = [
      { key: "symbol", name: "記号・句読点", items: symbolRules.map((r, idx) => ({ type: "symbol" as const, rule: r, index: idx })) },
      { key: "notation", name: "表記変更", items: proofRules.filter((r) => r.category === "basic" || r.category === "recommended").map((r) => ({ type: "proof" as const, rule: r, index: proofRules.indexOf(r) })) },
    ];
    const col2 = [
      { key: "auxiliary", name: "補助動詞", items: proofRules.filter((r) => r.category === "auxiliary").map((r) => ({ type: "proof" as const, rule: r, index: proofRules.indexOf(r) })) },
      { key: "pronoun", name: "人称", items: proofRules.filter((r) => r.category === "pronoun").map((r) => ({ type: "proof" as const, rule: r, index: proofRules.indexOf(r) })) },
      { key: "character", name: "人物名", items: proofRules.filter((r) => r.category === "character").map((r) => ({ type: "proof" as const, rule: r, index: proofRules.indexOf(r) })) },
    ];
    const col3 = [
      { key: "number", name: "数字", items: [] as any[] },
      { key: "difficult", name: "難読文字", items: proofRules.filter((r) => r.category === "difficult").map((r) => ({ type: "proof" as const, rule: r, index: proofRules.indexOf(r) })) },
    ];
    return [col1, col2, col3];
  }, [symbolRules, proofRules]);

  // ═══ 認証画面 ═══

  if (!authenticated) {
    return (
      <div className="flex items-center justify-center h-full bg-bg-primary">
        <div className="bg-bg-secondary rounded-xl shadow-card p-6 w-[320px]">
          <h2 className="text-sm font-bold text-text-primary mb-4 text-center">ProGen 管理画面</h2>
          <p className="text-[10px] text-text-muted mb-3 text-center">パスワードを入力してください</p>
          <input
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setAuthError(""); }}
            onKeyDown={(e) => { if (e.key === "Enter") handleAuth(); }}
            placeholder="パスワード"
            autoFocus
            className="w-full text-[11px] px-3 py-2 bg-bg-primary border border-border/50 rounded-lg text-text-primary outline-none focus:border-accent/50 mb-2"
          />
          {authError && <p className="text-[9px] text-error mb-2 text-center">{authError}</p>}
          <div className="flex gap-2">
            <button
              onClick={onBack}
              className="flex-1 px-3 py-1.5 text-[10px] text-text-secondary bg-bg-tertiary rounded-lg hover:bg-bg-tertiary/80 transition-colors"
            >
              戻る
            </button>
            <button
              onClick={handleAuth}
              className="flex-1 px-3 py-1.5 text-[10px] font-medium text-white bg-accent rounded-lg hover:bg-accent/90 transition-colors"
            >
              ログイン
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ═══ メイン画面 ═══

  return (
    <div className="flex flex-col h-full">
      {/* ═══ ヘッダー ═══ */}
      <div className="px-4 py-2 border-b border-border/50 bg-bg-secondary flex items-center gap-3 flex-shrink-0">
        <button
          onClick={onBack}
          className="px-2 py-1 text-[9px] text-text-secondary hover:text-text-primary transition-colors"
        >
          ← 戻る
        </button>
        <h2 className="text-xs font-bold text-text-primary">ProGen 管理画面</h2>

        {/* ラベル選択 */}
        <select
          value={currentLabel}
          onChange={(e) => setCurrentLabel(e.target.value)}
          className="text-[10px] px-2 py-1 bg-bg-primary border border-border/50 rounded text-text-primary outline-none"
        >
          {labels.map((l) => (
            <option key={l.key} value={l.key}>{l.displayName}</option>
          ))}
          {labels.length === 0 && <option value="default">default</option>}
        </select>

        {/* 新規ラベル */}
        <button
          onClick={() => setShowNewLabel(true)}
          className="px-2 py-1 text-[9px] font-medium text-accent bg-accent/10 rounded hover:bg-accent/20 transition-colors"
        >
          +
        </button>

        <div className="flex-1" />

        {/* ビューモード切替 */}
        <div className="flex bg-bg-tertiary rounded overflow-hidden">
          <button
            onClick={() => setViewMode("edit")}
            className={`px-2 py-1 text-[9px] transition-colors ${viewMode === "edit" ? "bg-accent text-white" : "text-text-secondary hover:text-text-primary"}`}
          >
            編集
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={`px-2 py-1 text-[9px] transition-colors ${viewMode === "list" ? "bg-accent text-white" : "text-text-secondary hover:text-text-primary"}`}
          >
            一覧
          </button>
        </div>

        {/* 保存 */}
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-1 text-[9px] font-medium text-white bg-accent rounded hover:bg-accent/90 transition-colors disabled:opacity-50"
        >
          {saving ? "保存中..." : "保存"}
        </button>
      </div>

      {/* ═══ コンテンツ ═══ */}
      <div className="flex-1 flex overflow-hidden">
        {viewMode === "edit" ? (
          <>
            {/* サイドバー */}
            <div className="w-[160px] flex-shrink-0 border-r border-border/50 flex flex-col bg-bg-tertiary/30">
              <div className="flex-1 overflow-y-auto">
                {EDIT_CATEGORIES.map((cat) => {
                  const c = catCounts[cat.key];
                  return (
                    <button
                      key={cat.key}
                      onClick={() => setCurrentCategory(cat.key)}
                      className={`w-full text-left px-3 py-2.5 text-[10px] transition-colors border-b border-border/10 flex items-center justify-between ${
                        currentCategory === cat.key
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
              {/* オプションチェックボックス */}
              <div className="flex-shrink-0 p-2 border-t border-border/30 space-y-1">
                <div className="text-[9px] text-text-muted font-medium mb-1">オプション</div>
                {OPTIONS_LABELS.map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={options[key]}
                      onChange={(e) => setOptions((prev) => ({ ...prev, [key]: e.target.checked }))}
                      className="accent-accent w-3 h-3"
                    />
                    <span className="text-[9px] text-text-primary">{label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* メインエリア */}
            <div className="flex-1 overflow-auto p-3">
              {currentCategory === "symbol" ? (
                <SymbolPanel
                  rules={symbolRules}
                  onToggle={handleToggleSymbol}
                  onDelete={handleDeleteSymbol}
                  onEdit={openEditSymbol}
                  onAdd={handleAddRule}
                />
              ) : currentCategory === "number" ? (
                <NumberPanel
                  numberRules={numberRules}
                  setNumberRules={setNumberRules}
                />
              ) : currentCategory === "difficult" ? (
                <DifficultPanel
                  rules={filteredProofRules}
                  onToggle={handleToggleProof}
                  onDelete={handleDeleteProof}
                  onEdit={openEditProof}
                  onAdd={handleAddRule}
                  onSetMode={handleSetDifficultMode}
                />
              ) : (
                <ProofPanel
                  category={currentCategory}
                  rules={filteredProofRules}
                  onToggle={handleToggleProof}
                  onDelete={handleDeleteProof}
                  onEdit={openEditProof}
                  onAdd={handleAddRule}
                />
              )}
            </div>
          </>
        ) : (
          /* 一覧モード: 3カラム */
          <div className="flex-1 overflow-auto p-3">
            <div className="grid grid-cols-3 gap-4 h-full">
              {listGroups.map((col, ci) => (
                <div key={ci} className="space-y-4 overflow-auto">
                  {col.map((group) => (
                    <div key={group.key}>
                      <h4 className="text-[10px] font-bold text-text-primary mb-2 border-b border-border/30 pb-1">{group.name}</h4>
                      {group.key === "number" ? (
                        <NumberSummary numberRules={numberRules} />
                      ) : (
                        <div className="space-y-1">
                          {group.items.map((item, ii) => (
                            <div
                              key={ii}
                              className={`text-[9px] flex items-center gap-1.5 px-2 py-1 rounded transition-opacity ${
                                !("active" in item.rule && item.rule.active) ? "opacity-40" : ""
                              }`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${item.rule.active ? "bg-accent" : "bg-border"}`} />
                              <span className="font-mono text-text-primary">
                                {item.type === "symbol" ? (item.rule as SymbolRule).src : (item.rule as ProofRule).before}
                              </span>
                              <span className="text-text-muted">→</span>
                              <span className="font-mono text-accent-secondary">
                                {item.type === "symbol"
                                  ? ((item.rule as SymbolRule).dst === " " ? "(半角SP)" : (item.rule as SymbolRule).dst)
                                  : (item.rule as ProofRule).after}
                              </span>
                              {item.type === "proof" && (item.rule as ProofRule).mode && (item.rule as ProofRule).mode !== "none" && (
                                <span className="text-[8px] px-1 rounded bg-accent/20 text-accent">{(item.rule as ProofRule).mode}</span>
                              )}
                            </div>
                          ))}
                          {group.items.length === 0 && (
                            <div className="text-[9px] text-text-muted py-2 text-center">ルールなし</div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ═══ 編集モーダル ═══ */}
      {editModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setEditModal(null)}>
          <div className="bg-bg-secondary rounded-xl shadow-card p-4 w-[360px]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xs font-bold text-text-primary mb-3">ルール編集</h3>
            <div className="space-y-2">
              <div>
                <label className="text-[9px] text-text-muted">変換前</label>
                <input
                  type="text"
                  value={editModal.src}
                  onChange={(e) => setEditModal({ ...editModal, src: e.target.value })}
                  autoFocus
                  className="w-full text-[11px] px-2 py-1.5 bg-bg-primary border border-border/50 rounded text-text-primary outline-none focus:border-accent/50"
                />
              </div>
              <div>
                <label className="text-[9px] text-text-muted">変換後</label>
                <input
                  type="text"
                  value={editModal.dst}
                  onChange={(e) => setEditModal({ ...editModal, dst: e.target.value })}
                  className="w-full text-[11px] px-2 py-1.5 bg-bg-primary border border-border/50 rounded text-text-primary outline-none focus:border-accent/50"
                />
              </div>
              <div>
                <label className="text-[9px] text-text-muted">備考</label>
                <input
                  type="text"
                  value={editModal.note}
                  onChange={(e) => setEditModal({ ...editModal, note: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") handleEditSave(); }}
                  className="w-full text-[11px] px-2 py-1.5 bg-bg-primary border border-border/50 rounded text-text-primary outline-none focus:border-accent/50"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setEditModal(null)}
                className="px-3 py-1.5 text-[9px] text-text-secondary bg-bg-tertiary rounded hover:bg-bg-tertiary/80 transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={handleEditSave}
                className="px-3 py-1.5 text-[9px] font-medium text-white bg-accent rounded hover:bg-accent/90 transition-colors"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ 新規ラベルモーダル ═══ */}
      {showNewLabel && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowNewLabel(false)}>
          <div className="bg-bg-secondary rounded-xl shadow-card p-4 w-[320px]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xs font-bold text-text-primary mb-3">新規レーベル作成</h3>
            <div className="space-y-2">
              <div>
                <label className="text-[9px] text-text-muted">キー（英数字+_）</label>
                <input
                  type="text"
                  value={newLabelKey}
                  onChange={(e) => { setNewLabelKey(e.target.value); setNewLabelError(""); }}
                  autoFocus
                  placeholder="例: shonen_jump"
                  className="w-full text-[11px] px-2 py-1.5 bg-bg-primary border border-border/50 rounded text-text-primary outline-none focus:border-accent/50"
                />
              </div>
              <div>
                <label className="text-[9px] text-text-muted">表示名</label>
                <input
                  type="text"
                  value={newLabelDisplay}
                  onChange={(e) => setNewLabelDisplay(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleCreateLabel(); }}
                  placeholder="例: 少年ジャンプ"
                  className="w-full text-[11px] px-2 py-1.5 bg-bg-primary border border-border/50 rounded text-text-primary outline-none focus:border-accent/50"
                />
              </div>
            </div>
            {newLabelError && <p className="text-[9px] text-error mt-2">{newLabelError}</p>}
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => { setShowNewLabel(false); setNewLabelKey(""); setNewLabelDisplay(""); setNewLabelError(""); }}
                className="px-3 py-1.5 text-[9px] text-text-secondary bg-bg-tertiary rounded hover:bg-bg-tertiary/80 transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={handleCreateLabel}
                className="px-3 py-1.5 text-[9px] font-medium text-white bg-accent rounded hover:bg-accent/90 transition-colors"
              >
                作成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══ 記号ルールパネル ═══

function SymbolPanel({
  rules, onToggle, onDelete, onEdit, onAdd,
}: {
  rules: SymbolRule[];
  onToggle: (i: number) => void;
  onDelete: (i: number) => void;
  onEdit: (i: number, r: SymbolRule) => void;
  onAdd: () => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-bold text-text-primary">記号・句読点ルール ({rules.length})</h3>
        <button onClick={onAdd} className="px-2 py-1 text-[9px] font-medium text-accent bg-accent/10 rounded hover:bg-accent/20 transition-colors">＋ 追加</button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {rules.map((rule, i) => (
          <div
            key={i}
            className={`bg-bg-tertiary rounded-lg px-3 py-2 transition-opacity ${!rule.active ? "opacity-40" : ""} hover:ring-1 hover:ring-accent/20 cursor-pointer`}
            onClick={() => onEdit(i, rule)}
          >
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); onToggle(i); }}
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
                onClick={(e) => { e.stopPropagation(); onDelete(i); }}
                className="text-[9px] text-text-muted hover:text-error transition-colors"
              >✕</button>
            </div>
            {rule.note && <div className="text-[9px] text-text-muted mt-0.5 ml-6">{rule.note}</div>}
          </div>
        ))}
        {rules.length === 0 && <div className="col-span-2 text-text-muted text-xs text-center py-8">ルールなし</div>}
      </div>
    </div>
  );
}

// ═══ 校正ルールパネル ═══

function ProofPanel({
  category, rules, onToggle, onDelete, onEdit, onAdd,
}: {
  category: string;
  rules: { rule: ProofRule; index: number }[];
  onToggle: (i: number) => void;
  onDelete: (i: number) => void;
  onEdit: (i: number, r: ProofRule) => void;
  onAdd: () => void;
}) {
  const cat = EDIT_CATEGORIES.find((c) => c.key === category);
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-bold text-text-primary">{cat?.name || category} ({rules.length})</h3>
        <button onClick={onAdd} className="px-2 py-1 text-[9px] font-medium text-accent bg-accent/10 rounded hover:bg-accent/20 transition-colors">＋ 追加</button>
      </div>
      {/* notation has sub-sections */}
      {cat?.subCategories ? (
        <div className="space-y-4">
          {cat.subCategories.map((subCat) => {
            const subRules = rules.filter(({ rule }) => rule.category === subCat);
            const subLabel = subCat === "basic" ? "基本" : subCat === "recommended" ? "推奨" : subCat;
            return (
              <div key={subCat}>
                <div className="text-[10px] text-text-muted font-medium mb-1.5 border-b border-border/20 pb-1">{subLabel}</div>
                <div className="grid grid-cols-2 gap-2">
                  {subRules.map(({ rule, index }) => (
                    <ProofCard key={index} rule={rule} index={index} onToggle={onToggle} onDelete={onDelete} onEdit={onEdit} />
                  ))}
                  {subRules.length === 0 && <div className="col-span-2 text-text-muted text-[9px] text-center py-4">ルールなし</div>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {rules.map(({ rule, index }) => (
            <ProofCard key={index} rule={rule} index={index} onToggle={onToggle} onDelete={onDelete} onEdit={onEdit} />
          ))}
          {rules.length === 0 && <div className="col-span-2 text-text-muted text-xs text-center py-8">ルールなし</div>}
        </div>
      )}
    </div>
  );
}

// ═══ 校正ルールカード ═══

function ProofCard({
  rule, index, onToggle, onDelete, onEdit,
}: {
  rule: ProofRule; index: number;
  onToggle: (i: number) => void;
  onDelete: (i: number) => void;
  onEdit: (i: number, r: ProofRule) => void;
}) {
  return (
    <div
      className={`bg-bg-tertiary rounded-lg px-3 py-2 transition-opacity ${!rule.active ? "opacity-40" : ""} hover:ring-1 hover:ring-accent/20 cursor-pointer`}
      onClick={() => onEdit(index, rule)}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={(e) => { e.stopPropagation(); onToggle(index); }}
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
          onClick={(e) => { e.stopPropagation(); onDelete(index); }}
          className="text-[9px] text-text-muted hover:text-error transition-colors"
        >✕</button>
      </div>
      {rule.note && <div className="text-[9px] text-text-muted mt-0.5 ml-6">{rule.note}</div>}
    </div>
  );
}

// ═══ 難読文字パネル ═══

function DifficultPanel({
  rules, onToggle, onDelete, onEdit, onAdd, onSetMode,
}: {
  rules: { rule: ProofRule; index: number }[];
  onToggle: (i: number) => void;
  onDelete: (i: number) => void;
  onEdit: (i: number, r: ProofRule) => void;
  onAdd: () => void;
  onSetMode: (i: number, mode: "open" | "ruby" | "none") => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-bold text-text-primary">難読文字 ({rules.length})</h3>
        <button onClick={onAdd} className="px-2 py-1 text-[9px] font-medium text-accent bg-accent/10 rounded hover:bg-accent/20 transition-colors">＋ 追加</button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {rules.map(({ rule, index }) => (
          <div
            key={index}
            className={`bg-bg-tertiary rounded-lg px-3 py-2 transition-opacity ${!rule.active ? "opacity-40" : ""} hover:ring-1 hover:ring-accent/20 cursor-pointer`}
            onClick={() => onEdit(index, rule)}
          >
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={(e) => { e.stopPropagation(); onToggle(index); }}
                className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                  rule.active ? "bg-accent border-accent" : "border-border"
                }`}
              >
                {rule.active && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
              </button>
              <span className="text-[11px] font-mono text-text-primary">{rule.before}</span>
              <span className="text-[10px] text-text-muted">→</span>
              <span className="text-[11px] font-mono text-accent-secondary">{rule.after}</span>
              <div className="flex-1" />
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(index); }}
                className="text-[9px] text-text-muted hover:text-error transition-colors"
              >✕</button>
            </div>
            {/* モードセレクタ */}
            <div className="flex items-center gap-1 mt-1.5 ml-6" onClick={(e) => e.stopPropagation()}>
              {DIFFICULT_MODES.map((m) => (
                <button
                  key={m.value}
                  onClick={() => onSetMode(index, m.value)}
                  className={`px-1.5 py-0.5 text-[8px] rounded transition-colors ${
                    rule.mode === m.value
                      ? "bg-accent text-white"
                      : "bg-bg-primary text-text-muted hover:text-text-primary"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            {rule.note && <div className="text-[9px] text-text-muted mt-0.5 ml-6">{rule.note}</div>}
          </div>
        ))}
        {rules.length === 0 && <div className="col-span-2 text-text-muted text-xs text-center py-8">ルールなし</div>}
      </div>
    </div>
  );
}

// ═══ 数字ルールパネル ═══

function NumberPanel({
  numberRules, setNumberRules,
}: {
  numberRules: NumberRuleState;
  setNumberRules: React.Dispatch<React.SetStateAction<NumberRuleState>>;
}) {
  const baseOptions = ["算用数字混在を許容", "全て算用数字に", "全て漢数字に"];

  const setField = useCallback((key: string, value: number | boolean) => {
    setNumberRules((prev) => ({ ...prev, [key]: value }));
  }, [setNumberRules]);

  return (
    <div className="space-y-4">
      <h3 className="text-xs font-bold text-text-primary">数字ルール</h3>
      {/* ベースルール */}
      <div className="bg-bg-tertiary rounded-lg p-3">
        <div className="text-[10px] text-text-muted mb-1.5">基本ルール</div>
        <select
          value={numberRules.base}
          onChange={(e) => setField("base", Number(e.target.value))}
          className="w-full text-[11px] px-2 py-1.5 bg-bg-primary border border-border/50 rounded text-text-primary outline-none"
        >
          {baseOptions.map((opt, i) => <option key={i} value={i}>{opt}</option>)}
        </select>
      </div>
      {/* サブルール有効化 */}
      <label className="flex items-center gap-2 px-3 cursor-pointer">
        <input
          type="checkbox"
          checked={numberRules.subRulesEnabled}
          onChange={(e) => setField("subRulesEnabled", e.target.checked)}
          className="accent-accent"
        />
        <span className="text-[10px] text-text-primary">サブルールを有効にする</span>
      </label>
      {/* サブルール */}
      {numberRules.subRulesEnabled && (
        <div className="space-y-3">
          {(Object.entries(NUMBER_SUB_RULES) as [string, { label: string; options: readonly string[] }][]).map(([key, def]) => (
            <div key={key} className="bg-bg-tertiary rounded-lg p-3">
              <div className="text-[10px] text-text-muted mb-1.5">{def.label}</div>
              <select
                value={(numberRules as any)[key]}
                onChange={(e) => setField(key, Number(e.target.value))}
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

// ═══ 数字サマリー（一覧モード用） ═══

function NumberSummary({ numberRules }: { numberRules: NumberRuleState }) {
  const baseLabels = ["混在許容", "全て算用", "全て漢数字"];
  return (
    <div className="space-y-1 text-[9px]">
      <div className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" />
        <span className="text-text-muted">基本:</span>
        <span className="text-text-primary">{baseLabels[numberRules.base] || "?"}</span>
      </div>
      {numberRules.subRulesEnabled && (
        <>
          {(Object.entries(NUMBER_SUB_RULES) as [string, { label: string; options: readonly string[] }][]).map(([key, def]) => (
            <div key={key} className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" />
              <span className="text-text-muted">{def.label}:</span>
              <span className="text-text-primary">{def.options[(numberRules as any)[key]] || "?"}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
