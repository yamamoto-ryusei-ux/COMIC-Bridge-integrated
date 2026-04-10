/**
 * ProGen 校正結果ビューア（Phase 3）
 * CSV解析結果をカテゴリ別・色分け表示
 */
import { useState, useMemo, useCallback } from "react";
import { useProgenStore } from "../../store/progenStore";
import {
  parseVariationCSV,
  parseSimpleCSV,
  groupVariationByCategory,
  groupSimpleByCategory,
  getCategoryColor,
  getSimpleCategoryColor,
  formatPageShort,
} from "../../hooks/useProgenJson";
import type {
  VariationItem,
  SimpleItem,
  VariationGroup,
  PickedItem,
} from "../../hooks/useProgenJson";

// ═══ 型定義 ═══

interface Props {
  onBack: () => void;
  onGoToProofreading?: () => void;
  onSaveCalibration?: (items: PickedItem[]) => void;
}

type TabMode = "variation" | "simple" | "parallel";
type SimpleDisplayMode = "page" | "category";

// ═══ ヘルパー ═══

/** ピックアップの安定キーを生成 */
function pickKey(type: string, category: string, page: string, excerpt: string): string {
  return `${type}|${category}|${page}|${excerpt}`;
}

// ═══ メインコンポーネント ═══

export function ProgenResultViewer({ onBack, onGoToProofreading, onSaveCalibration }: Props) {
  const currentVariationData = useProgenStore((s) => s.currentVariationData) as Record<string, VariationGroup>;
  const currentSimpleData = useProgenStore((s) => s.currentSimpleData) as SimpleItem[];

  const [currentTab, setCurrentTab] = useState<TabMode>("variation");
  const [simpleDisplayMode, setSimpleDisplayMode] = useState<SimpleDisplayMode>("page");
  const [filterValue, setFilterValue] = useState("all");
  const [pickedState, setPickedState] = useState<Map<string, boolean>>(new Map());
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pasteType, setPasteType] = useState<"variation" | "simple">("variation");
  const [pasteTexts, setPasteTexts] = useState({ variation: "", simple: "" });

  // --- データ派生 ---

  const variationEntries = useMemo(() => {
    const entries = Object.entries(currentVariationData);
    entries.sort(([, a], [, b]) => a.order - b.order);
    return entries;
  }, [currentVariationData]);

  const simpleGrouped = useMemo(() => groupSimpleByCategory(currentSimpleData), [currentSimpleData]);

  const variationCategories = useMemo(() => variationEntries.map(([cat]) => cat), [variationEntries]);
  const simpleCategories = useMemo(() => Object.keys(simpleGrouped), [simpleGrouped]);

  const filteredVariationEntries = useMemo(() => {
    if (filterValue === "all") return variationEntries;
    return variationEntries.filter(([cat]) => cat === filterValue);
  }, [variationEntries, filterValue]);

  const filteredSimpleData = useMemo(() => {
    if (filterValue === "all") return currentSimpleData;
    return currentSimpleData.filter((item) => item.category === filterValue);
  }, [currentSimpleData, filterValue]);

  const filteredSimpleGrouped = useMemo(() => {
    if (filterValue === "all") return simpleGrouped;
    const result: Record<string, SimpleItem[]> = {};
    if (simpleGrouped[filterValue]) result[filterValue] = simpleGrouped[filterValue];
    return result;
  }, [simpleGrouped, filterValue]);

  // カテゴリ一覧（現タブ用）
  const currentCategories = useMemo(() => {
    if (currentTab === "variation") return variationCategories;
    if (currentTab === "simple") return simpleCategories;
    return [...new Set([...variationCategories, ...simpleCategories])];
  }, [currentTab, variationCategories, simpleCategories]);

  // 結果件数
  const resultCount = useMemo(() => {
    if (currentTab === "variation") {
      let count = 0;
      for (const [, group] of filteredVariationEntries) {
        for (const sub of Object.values(group.subGroups)) count += sub.items.length;
      }
      return count;
    }
    if (currentTab === "simple") return filteredSimpleData.length;
    // parallel
    let vCount = 0;
    for (const [, group] of variationEntries) {
      for (const sub of Object.values(group.subGroups)) vCount += sub.items.length;
    }
    return vCount + currentSimpleData.length;
  }, [currentTab, filteredVariationEntries, filteredSimpleData, variationEntries, currentSimpleData]);

  const hasData = variationEntries.length > 0 || currentSimpleData.length > 0;

  // --- ピックアップ操作 ---

  const togglePick = useCallback((key: string) => {
    setPickedState((prev) => {
      const next = new Map(prev);
      next.set(key, !prev.get(key));
      return next;
    });
  }, []);

  const toggleCategoryPick = useCallback((type: string, items: { category: string; page: string; excerpt: string }[]) => {
    setPickedState((prev) => {
      const next = new Map(prev);
      const keys = items.map((it) => pickKey(type, it.category, it.page, it.excerpt));
      const allPicked = keys.every((k) => prev.get(k));
      for (const k of keys) next.set(k, !allPicked);
      return next;
    });
  }, []);

  const getPickedItems = useCallback((): PickedItem[] => {
    const items: PickedItem[] = [];
    for (const [key, picked] of pickedState) {
      if (!picked) continue;
      const [type, category, page, excerpt] = key.split("|");
      // content lookup
      let content = "";
      if (type === "variation") {
        const group = currentVariationData[category];
        if (group) {
          for (const sub of Object.values(group.subGroups)) {
            const found = sub.items.find((it) => it.page === page && it.excerpt === excerpt);
            if (found) { content = found.content; break; }
          }
        }
      } else {
        const found = currentSimpleData.find((it) => it.category === category && it.page === page && it.excerpt === excerpt);
        if (found) content = found.content;
      }
      items.push({ type: type as "variation" | "simple", category, page, excerpt, content, picked: true });
    }
    return items;
  }, [pickedState, currentVariationData, currentSimpleData]);

  // --- 貼り付けモーダル ---

  const handleParse = useCallback(() => {
    const store = useProgenStore.getState();
    if (pasteType === "variation") {
      const text = pasteTexts.variation;
      if (!text.trim()) return;
      const items = parseVariationCSV(text);
      const grouped = groupVariationByCategory(items);
      store.currentVariationData = grouped;
      useProgenStore.setState({ currentVariationData: grouped });
    } else {
      const text = pasteTexts.simple;
      if (!text.trim()) return;
      const items = parseSimpleCSV(text);
      useProgenStore.setState({ currentSimpleData: items });
    }
    setShowPasteModal(false);
  }, [pasteType, pasteTexts]);

  // --- 保存 ---

  const handleSave = useCallback(() => {
    if (onSaveCalibration) onSaveCalibration(getPickedItems());
  }, [onSaveCalibration, getPickedItems]);

  // ═══ レンダリング ═══

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ヘッダー */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-border bg-bg-secondary">
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-[10px] text-text-secondary hover:text-text-primary transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
            </svg>
            <span>戻る</span>
          </button>
          <span className="text-xs font-bold text-text-primary">校正結果ビューア</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPasteModal(true)}
            className="px-2.5 py-1 text-[10px] bg-bg-tertiary hover:bg-accent/10 hover:text-accent rounded transition-colors text-text-secondary"
          >
            結果を貼り付け
          </button>
          <button
            onClick={handleSave}
            className="px-2.5 py-1 text-[10px] bg-bg-tertiary hover:bg-emerald-500/10 hover:text-emerald-500 rounded transition-colors text-text-secondary"
          >
            保存
          </button>
          {onGoToProofreading && (
            <button
              onClick={onGoToProofreading}
              className="px-2.5 py-1 text-[10px] bg-accent/10 text-accent hover:bg-accent/20 rounded transition-colors font-medium"
            >
              校正画面へ
            </button>
          )}
        </div>
      </div>

      {/* タブバー */}
      <div className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 border-b border-border bg-bg-secondary/50">
        {([
          { key: "variation" as TabMode, label: "提案チェック", color: "orange" },
          { key: "simple" as TabMode, label: "正誤チェック", color: "emerald" },
          { key: "parallel" as TabMode, label: "並列表示", color: "blue" },
        ]).map((tab) => (
          <button
            key={tab.key}
            onClick={() => { setCurrentTab(tab.key); setFilterValue("all"); }}
            className={`px-3 py-1 text-[10px] rounded-md transition-colors ${
              currentTab === tab.key
                ? `bg-${tab.color}-500 text-white font-medium`
                : "text-text-muted hover:text-text-secondary hover:bg-bg-tertiary"
            }`}
          >
            {tab.label}
          </button>
        ))}

        <div className="flex-1" />

        {/* 件数表示 */}
        <span className="text-[9px] text-text-muted tabular-nums mr-2">{resultCount}件</span>

        {/* フィルタ */}
        <select
          value={filterValue}
          onChange={(e) => setFilterValue(e.target.value)}
          className="text-[9px] px-1.5 py-0.5 bg-bg-primary border border-border/50 rounded text-text-secondary outline-none focus:border-accent/50"
        >
          <option value="all">すべて</option>
          {currentCategories.map((cat) => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>

        {/* 正誤チェック表示モード切替 */}
        {currentTab === "simple" && (
          <div className="flex bg-bg-tertiary rounded p-0.5 ml-2">
            <button
              onClick={() => setSimpleDisplayMode("page")}
              className={`px-2 py-0.5 text-[9px] rounded transition-colors ${
                simpleDisplayMode === "page" ? "bg-bg-primary text-text-primary font-medium shadow-sm" : "text-text-muted"
              }`}
            >
              ページ順
            </button>
            <button
              onClick={() => setSimpleDisplayMode("category")}
              className={`px-2 py-0.5 text-[9px] rounded transition-colors ${
                simpleDisplayMode === "category" ? "bg-bg-primary text-text-primary font-medium shadow-sm" : "text-text-muted"
              }`}
            >
              カテゴリ別
            </button>
          </div>
        )}
      </div>

      {/* コンテンツ */}
      <div className="flex-1 overflow-auto p-3">
        {!hasData ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-text-muted text-center leading-relaxed">
              結果がありません。<br />「結果を貼り付け」ボタンからCSVを貼り付けてください。
            </p>
          </div>
        ) : currentTab === "variation" ? (
          <VariationContent
            entries={filteredVariationEntries}
            pickedState={pickedState}
            togglePick={togglePick}
            toggleCategoryPick={toggleCategoryPick}
          />
        ) : currentTab === "simple" ? (
          simpleDisplayMode === "page" ? (
            <SimplePageContent
              items={filteredSimpleData}
              pickedState={pickedState}
              togglePick={togglePick}
            />
          ) : (
            <SimpleCategoryContent
              grouped={filteredSimpleGrouped}
              pickedState={pickedState}
              togglePick={togglePick}
              toggleCategoryPick={toggleCategoryPick}
            />
          )
        ) : (
          <ParallelContent
            variationEntries={filterValue === "all" ? variationEntries : filteredVariationEntries}
            simpleData={filterValue === "all" ? currentSimpleData : filteredSimpleData}
            pickedState={pickedState}
            togglePick={togglePick}
            toggleCategoryPick={toggleCategoryPick}
          />
        )}
      </div>

      {/* 貼り付けモーダル */}
      {showPasteModal && (
        <PasteModal
          pasteType={pasteType}
          setPasteType={setPasteType}
          pasteTexts={pasteTexts}
          setPasteTexts={setPasteTexts}
          onParse={handleParse}
          onClose={() => setShowPasteModal(false)}
        />
      )}
    </div>
  );
}

// ═══ 提案チェック表示 ═══

function VariationContent({
  entries,
  pickedState,
  togglePick,
  toggleCategoryPick,
}: {
  entries: [string, VariationGroup][];
  pickedState: Map<string, boolean>;
  togglePick: (key: string) => void;
  toggleCategoryPick: (type: string, items: { category: string; page: string; excerpt: string }[]) => void;
}) {
  return (
    <div className="space-y-3">
      {entries.map(([category, group]) => {
        const allItems: VariationItem[] = [];
        for (const sub of Object.values(group.subGroups)) allItems.push(...sub.items);
        return (
          <VariationCategoryCard
            key={category}
            category={category}
            group={group}
            allItems={allItems}
            colorClass={getCategoryColor(group.order)}
            pickedState={pickedState}
            togglePick={togglePick}
            toggleCategoryPick={toggleCategoryPick}
          />
        );
      })}
    </div>
  );
}

function VariationCategoryCard({
  category,
  group,
  allItems,
  colorClass,
  pickedState,
  togglePick,
  toggleCategoryPick,
}: {
  category: string;
  group: VariationGroup;
  allItems: VariationItem[];
  colorClass: string;
  pickedState: Map<string, boolean>;
  togglePick: (key: string) => void;
  toggleCategoryPick: (type: string, items: { category: string; page: string; excerpt: string }[]) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const subGroupEntries = Object.entries(group.subGroups);
  const hasMultipleSubs = subGroupEntries.length > 1;

  const allKeys = allItems.map((it) => pickKey("variation", it.category, it.page, it.excerpt));
  const allPicked = allKeys.length > 0 && allKeys.every((k) => pickedState.get(k));
  const somePicked = allKeys.some((k) => pickedState.get(k));

  return (
    <div className="border border-border/50 rounded-lg overflow-hidden">
      {/* ヘッダー */}
      <div
        className={`flex items-center gap-2 px-3 py-2 cursor-pointer select-none ${colorClass}`}
        onClick={() => setCollapsed(!collapsed)}
      >
        <div
          role="checkbox"
          aria-checked={allPicked}
          onClick={(e) => {
            e.stopPropagation();
            toggleCategoryPick("variation", allItems.map((it) => ({ category: it.category, page: it.page, excerpt: it.excerpt })));
          }}
          className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center cursor-pointer transition-colors ${
            allPicked
              ? "bg-accent border-accent"
              : somePicked
              ? "bg-accent/30 border-accent"
              : "border-current/40 hover:border-current/60"
          }`}
        >
          {(allPicked || somePicked) && (
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              {allPicked ? <path d="M20 6L9 17l-5-5" /> : <path d="M5 12h14" />}
            </svg>
          )}
        </div>

        <svg
          width="10" height="10" viewBox="0 0 24 24" fill="currentColor"
          className={`flex-shrink-0 transition-transform ${collapsed ? "-rotate-90" : ""}`}
        >
          <path d="M7 10l5 5 5-5z" />
        </svg>

        <span className="text-[11px] font-medium flex-1">{category}</span>
        <span className="text-[9px] opacity-70">{allItems.length}件</span>
      </div>

      {/* ボディ */}
      {!collapsed && (
        <div className="bg-bg-primary">
          {subGroupEntries.map(([subKey, sub]) => (
            <div key={subKey}>
              {hasMultipleSubs && (
                <div className="px-3 py-1 text-[9px] text-text-muted bg-bg-tertiary/50 border-b border-border/20 font-medium">
                  {sub.label}
                </div>
              )}
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="text-text-muted border-b border-border/20">
                    <th className="w-8 px-2 py-1 text-center font-normal">選択</th>
                    <th className="w-20 px-2 py-1 text-left font-normal">ページ</th>
                    <th className="px-2 py-1 text-left font-normal">セリフ</th>
                    <th className="px-2 py-1 text-left font-normal">指摘内容</th>
                  </tr>
                </thead>
                <tbody>
                  {sub.items.map((item, idx) => {
                    const key = pickKey("variation", item.category, item.page, item.excerpt);
                    const picked = !!pickedState.get(key);
                    return (
                      <tr
                        key={idx}
                        className={`border-b border-border/10 transition-colors hover:bg-bg-tertiary/30 ${
                          picked ? "bg-accent/5" : ""
                        }`}
                      >
                        <td className="px-2 py-1.5 text-center">
                          <div
                            role="checkbox"
                            aria-checked={picked}
                            onClick={() => togglePick(key)}
                            className={`w-3 h-3 rounded border mx-auto flex items-center justify-center cursor-pointer transition-colors ${
                              picked ? "bg-accent border-accent" : "border-border hover:border-accent/50"
                            }`}
                          >
                            {picked && (
                              <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M20 6L9 17l-5-5" />
                              </svg>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-1.5 text-text-muted whitespace-nowrap">{formatPageShort(item.page)}</td>
                        <td className="px-2 py-1.5 text-text-primary max-w-[200px] truncate">{item.excerpt}</td>
                        <td className="px-2 py-1.5 text-text-secondary">{item.content}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══ 正誤チェック - ページ順表示 ═══

function SimplePageContent({
  items,
  pickedState,
  togglePick,
}: {
  items: SimpleItem[];
  pickedState: Map<string, boolean>;
  togglePick: (key: string) => void;
}) {
  const sorted = useMemo(() => {
    return [...items].sort((a, b) => {
      if (a.volumeNum !== b.volumeNum) return a.volumeNum - b.volumeNum;
      return a.pageNum - b.pageNum;
    });
  }, [items]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[10px]">
        <thead>
          <tr className="text-text-muted border-b border-border/30 bg-bg-tertiary/30">
            <th className="w-8 px-2 py-1.5 text-center font-normal">選択</th>
            <th className="w-20 px-2 py-1.5 text-left font-normal">ページ</th>
            <th className="w-24 px-2 py-1.5 text-left font-normal">カテゴリ</th>
            <th className="px-2 py-1.5 text-left font-normal">セリフ</th>
            <th className="px-2 py-1.5 text-left font-normal">指摘内容</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((item, idx) => {
            const key = pickKey("simple", item.category, item.page, item.excerpt);
            const picked = !!pickedState.get(key);
            const catColor = getSimpleCategoryColor(item.category);
            return (
              <tr
                key={idx}
                className={`border-b border-border/10 transition-colors hover:bg-bg-tertiary/30 ${
                  picked ? "bg-accent/5" : ""
                }`}
              >
                <td className="px-2 py-1.5 text-center">
                  <div
                    role="checkbox"
                    aria-checked={picked}
                    onClick={() => togglePick(key)}
                    className={`w-3 h-3 rounded border mx-auto flex items-center justify-center cursor-pointer transition-colors ${
                      picked ? "bg-accent border-accent" : "border-border hover:border-accent/50"
                    }`}
                  >
                    {picked && (
                      <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    )}
                  </div>
                </td>
                <td className="px-2 py-1.5 text-text-muted whitespace-nowrap">{formatPageShort(item.page)}</td>
                <td className="px-2 py-1.5">
                  <span
                    className="inline-block px-1.5 py-0.5 text-[9px] rounded text-white font-medium"
                    style={{ backgroundColor: catColor }}
                  >
                    {item.category}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-text-primary max-w-[200px] truncate">{item.excerpt}</td>
                <td className="px-2 py-1.5 text-text-secondary">{item.content}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ═══ 正誤チェック - カテゴリ別表示 ═══

function SimpleCategoryContent({
  grouped,
  pickedState,
  togglePick,
  toggleCategoryPick,
}: {
  grouped: Record<string, SimpleItem[]>;
  pickedState: Map<string, boolean>;
  togglePick: (key: string) => void;
  toggleCategoryPick: (type: string, items: { category: string; page: string; excerpt: string }[]) => void;
}) {
  const entries = Object.entries(grouped);

  return (
    <div className="space-y-3">
      {entries.map(([category, items]) => (
        <SimpleCategoryCard
          key={category}
          category={category}
          items={items}
          pickedState={pickedState}
          togglePick={togglePick}
          toggleCategoryPick={toggleCategoryPick}
        />
      ))}
    </div>
  );
}

function SimpleCategoryCard({
  category,
  items,
  pickedState,
  togglePick,
  toggleCategoryPick,
}: {
  category: string;
  items: SimpleItem[];
  pickedState: Map<string, boolean>;
  togglePick: (key: string) => void;
  toggleCategoryPick: (type: string, items: { category: string; page: string; excerpt: string }[]) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const catColor = getSimpleCategoryColor(category);

  const allKeys = items.map((it) => pickKey("simple", it.category, it.page, it.excerpt));
  const allPicked = allKeys.length > 0 && allKeys.every((k) => pickedState.get(k));
  const somePicked = allKeys.some((k) => pickedState.get(k));

  return (
    <div className="border border-border/50 rounded-lg overflow-hidden">
      {/* ヘッダー */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none bg-bg-tertiary/50"
        onClick={() => setCollapsed(!collapsed)}
      >
        <div
          role="checkbox"
          aria-checked={allPicked}
          onClick={(e) => {
            e.stopPropagation();
            toggleCategoryPick("simple", items.map((it) => ({ category: it.category, page: it.page, excerpt: it.excerpt })));
          }}
          className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center cursor-pointer transition-colors ${
            allPicked
              ? "bg-accent border-accent"
              : somePicked
              ? "bg-accent/30 border-accent"
              : "border-border hover:border-accent/50"
          }`}
        >
          {(allPicked || somePicked) && (
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              {allPicked ? <path d="M20 6L9 17l-5-5" /> : <path d="M5 12h14" />}
            </svg>
          )}
        </div>

        <svg
          width="10" height="10" viewBox="0 0 24 24" fill="currentColor"
          className={`flex-shrink-0 transition-transform text-text-muted ${collapsed ? "-rotate-90" : ""}`}
        >
          <path d="M7 10l5 5 5-5z" />
        </svg>

        <span
          className="inline-block px-1.5 py-0.5 text-[9px] rounded text-white font-medium"
          style={{ backgroundColor: catColor }}
        >
          {category}
        </span>

        <span className="flex-1" />
        <span className="text-[9px] text-text-muted">{items.length}件</span>
      </div>

      {/* ボディ */}
      {!collapsed && (
        <div className="bg-bg-primary">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-text-muted border-b border-border/20">
                <th className="w-8 px-2 py-1 text-center font-normal">選択</th>
                <th className="w-20 px-2 py-1 text-left font-normal">ページ</th>
                <th className="px-2 py-1 text-left font-normal">セリフ</th>
                <th className="px-2 py-1 text-left font-normal">指摘内容</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => {
                const key = pickKey("simple", item.category, item.page, item.excerpt);
                const picked = !!pickedState.get(key);
                return (
                  <tr
                    key={idx}
                    className={`border-b border-border/10 transition-colors hover:bg-bg-tertiary/30 ${
                      picked ? "bg-accent/5" : ""
                    }`}
                  >
                    <td className="px-2 py-1.5 text-center">
                      <div
                        role="checkbox"
                        aria-checked={picked}
                        onClick={() => togglePick(key)}
                        className={`w-3 h-3 rounded border mx-auto flex items-center justify-center cursor-pointer transition-colors ${
                          picked ? "bg-accent border-accent" : "border-border hover:border-accent/50"
                        }`}
                      >
                        {picked && (
                          <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 6L9 17l-5-5" />
                          </svg>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-text-muted whitespace-nowrap">{formatPageShort(item.page)}</td>
                    <td className="px-2 py-1.5 text-text-primary max-w-[200px] truncate">{item.excerpt}</td>
                    <td className="px-2 py-1.5 text-text-secondary">{item.content}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ═══ 並列表示 ═══

function ParallelContent({
  variationEntries,
  simpleData,
  pickedState,
  togglePick,
  toggleCategoryPick,
}: {
  variationEntries: [string, VariationGroup][];
  simpleData: SimpleItem[];
  pickedState: Map<string, boolean>;
  togglePick: (key: string) => void;
  toggleCategoryPick: (type: string, items: { category: string; page: string; excerpt: string }[]) => void;
}) {
  const simpleGrouped = useMemo(() => groupSimpleByCategory(simpleData), [simpleData]);

  return (
    <div className="flex gap-3 h-full">
      {/* 左: 提案チェック */}
      <div className="flex-1 overflow-auto border border-border/30 rounded-lg">
        <div className="sticky top-0 z-10 px-3 py-1.5 bg-orange-500/10 border-b border-orange-500/20 text-[10px] font-medium text-orange-500">
          提案チェック
        </div>
        <div className="p-2 space-y-2">
          {variationEntries.length > 0 ? (
            variationEntries.map(([category, group]) => {
              const allItems: VariationItem[] = [];
              for (const sub of Object.values(group.subGroups)) allItems.push(...sub.items);
              return (
                <VariationCategoryCard
                  key={category}
                  category={category}
                  group={group}
                  allItems={allItems}
                  colorClass={getCategoryColor(group.order)}
                  pickedState={pickedState}
                  togglePick={togglePick}
                  toggleCategoryPick={toggleCategoryPick}
                />
              );
            })
          ) : (
            <p className="text-[10px] text-text-muted text-center py-4">データなし</p>
          )}
        </div>
      </div>

      {/* 右: 正誤チェック */}
      <div className="flex-1 overflow-auto border border-border/30 rounded-lg">
        <div className="sticky top-0 z-10 px-3 py-1.5 bg-emerald-500/10 border-b border-emerald-500/20 text-[10px] font-medium text-emerald-500">
          正誤チェック
        </div>
        <div className="p-2 space-y-2">
          {Object.keys(simpleGrouped).length > 0 ? (
            Object.entries(simpleGrouped).map(([category, items]) => (
              <SimpleCategoryCard
                key={category}
                category={category}
                items={items}
                pickedState={pickedState}
                togglePick={togglePick}
                toggleCategoryPick={toggleCategoryPick}
              />
            ))
          ) : (
            <p className="text-[10px] text-text-muted text-center py-4">データなし</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══ 貼り付けモーダル ═══

function PasteModal({
  pasteType,
  setPasteType,
  pasteTexts,
  setPasteTexts,
  onParse,
  onClose,
}: {
  pasteType: "variation" | "simple";
  setPasteType: (t: "variation" | "simple") => void;
  pasteTexts: { variation: string; simple: string };
  setPasteTexts: (t: { variation: string; simple: string }) => void;
  onParse: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-[560px] max-h-[80vh] flex flex-col bg-bg-secondary border border-border rounded-xl shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* モーダルヘッダー */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-xs font-bold text-text-primary">結果CSVを貼り付け</span>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18" /><path d="M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* タブ切替 */}
        <div className="flex gap-1 px-4 pt-3">
          <button
            onClick={() => setPasteType("variation")}
            className={`px-3 py-1 text-[10px] rounded-md transition-colors ${
              pasteType === "variation"
                ? "bg-orange-500 text-white font-medium"
                : "text-text-muted hover:text-text-secondary bg-bg-tertiary"
            }`}
          >
            提案チェック
          </button>
          <button
            onClick={() => setPasteType("simple")}
            className={`px-3 py-1 text-[10px] rounded-md transition-colors ${
              pasteType === "simple"
                ? "bg-emerald-500 text-white font-medium"
                : "text-text-muted hover:text-text-secondary bg-bg-tertiary"
            }`}
          >
            正誤チェック
          </button>
        </div>

        {/* テキストエリア */}
        <div className="flex-1 overflow-auto px-4 py-3">
          <textarea
            value={pasteType === "variation" ? pasteTexts.variation : pasteTexts.simple}
            onChange={(e) =>
              setPasteTexts(
                pasteType === "variation"
                  ? { ...pasteTexts, variation: e.target.value }
                  : { ...pasteTexts, simple: e.target.value }
              )
            }
            placeholder={
              pasteType === "variation"
                ? "提案チェックCSVを貼り付け...\nカテゴリ, ページ, セリフ, 指摘内容"
                : "正誤チェックCSVを貼り付け...\nページ, カテゴリ, セリフ, 指摘内容"
            }
            className="w-full h-[300px] text-[10px] font-mono p-3 bg-bg-primary border border-border/50 rounded-lg text-text-primary outline-none focus:border-accent/50 resize-none leading-relaxed"
          />
        </div>

        {/* アクション */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[10px] text-text-secondary bg-bg-tertiary rounded-lg hover:bg-bg-primary transition-colors"
          >
            キャンセル
          </button>
          <button
            onClick={onParse}
            className="px-4 py-1.5 text-[10px] font-medium text-white bg-accent hover:bg-accent/90 rounded-lg transition-colors"
          >
            解析して表示
          </button>
        </div>
      </div>
    </div>
  );
}
