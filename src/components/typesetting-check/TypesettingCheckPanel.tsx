import { useState, useEffect, useMemo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTypesettingCheckStore } from "../../store/typesettingCheckStore";
import type {
  ProofreadingCheckData,
  ProofreadingCheckItem,
  CheckTabMode,
} from "../../types/typesettingCheck";
import { CheckCategoryGroup } from "./CheckCategoryGroup";
import { JsonFileBrowser } from "../scanPsd/JsonFileBrowser";

/** カテゴリ別にグループ化 */
function groupByCategory(items: ProofreadingCheckItem[]): Map<string, ProofreadingCheckItem[]> {
  const map = new Map<string, ProofreadingCheckItem[]>();
  for (const item of items) {
    const cat = item.category || "未分類";
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat)!.push(item);
  }
  return new Map([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

export function TypesettingCheckPanel() {
  const checkData = useTypesettingCheckStore((s) => s.checkData);
  const checkTabMode = useTypesettingCheckStore((s) => s.checkTabMode);
  const setCheckTabMode = useTypesettingCheckStore((s) => s.setCheckTabMode);
  const setCheckData = useTypesettingCheckStore((s) => s.setCheckData);
  const jsonBasePath = useTypesettingCheckStore((s) => s.jsonBasePath);
  const showJsonBrowser = useTypesettingCheckStore((s) => s.showJsonBrowser);
  const setShowJsonBrowser = useTypesettingCheckStore((s) => s.setShowJsonBrowser);
  const searchQuery = useTypesettingCheckStore((s) => s.searchQuery);
  const setSearchQuery = useTypesettingCheckStore((s) => s.setSearchQuery);
  const navigateToPage = useTypesettingCheckStore((s) => s.navigateToPage);

  const [loadError, setLoadError] = useState<string | null>(null);

  // 検索デバウンス
  const [localSearch, setLocalSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(localSearch), 300);
    return () => clearTimeout(timer);
  }, [localSearch, setSearchQuery]);

  // JSONファイル読み込み
  const handleJsonSelect = useCallback(
    async (filePath: string) => {
      setLoadError(null);
      try {
        const content = await invoke<string>("read_text_file", { filePath });
        const raw: ProofreadingCheckData = JSON.parse(content);

        const allItems: ProofreadingCheckItem[] = [];
        if (raw.checks?.variation?.items) allItems.push(...raw.checks.variation.items);
        if (raw.checks?.simple?.items) allItems.push(...raw.checks.simple.items);

        const correctnessItems = allItems.filter((i) => i.checkKind === "correctness");
        const proposalItems = allItems.filter((i) => i.checkKind === "proposal");

        const fileName = filePath.replace(/\\/g, "/").split("/").pop()?.replace(".json", "") || "";
        const title = raw.work ? `${raw.work} ${fileName}` : fileName;

        setCheckData({ title, fileName, filePath, allItems, correctnessItems, proposalItems });
        setShowJsonBrowser(false);

        // タブモード自動選択
        if (correctnessItems.length > 0 && proposalItems.length > 0) {
          setCheckTabMode("both");
        } else if (correctnessItems.length > 0) {
          setCheckTabMode("correctness");
        } else if (proposalItems.length > 0) {
          setCheckTabMode("proposal");
        }
      } catch (e) {
        setLoadError(String(e));
      }
    },
    [setCheckData, setShowJsonBrowser, setCheckTabMode],
  );

  // 検索フィルタ
  const filteredItems = useMemo(() => {
    if (!checkData) return { correctness: [], proposal: [], all: [] };
    const q = searchQuery.toLowerCase();
    const filter = (items: ProofreadingCheckItem[]) =>
      q
        ? items.filter(
            (i) =>
              (i.excerpt || "").toLowerCase().includes(q) ||
              (i.content || "").toLowerCase().includes(q) ||
              (i.category || "").toLowerCase().includes(q) ||
              (i.page || "").toLowerCase().includes(q),
          )
        : items;
    return {
      correctness: filter(checkData.correctnessItems),
      proposal: filter(checkData.proposalItems),
      all: filter(checkData.allItems),
    };
  }, [checkData, searchQuery]);

  // タブ情報
  const hasCorrectness = (checkData?.correctnessItems.length ?? 0) > 0;
  const hasProposal = (checkData?.proposalItems.length ?? 0) > 0;

  // 現在表示するアイテム
  const displayItems = useMemo(() => {
    if (checkTabMode === "correctness") return filteredItems.correctness;
    if (checkTabMode === "proposal") return filteredItems.proposal;
    return filteredItems.all;
  }, [checkTabMode, filteredItems]);

  // JsonFileBrowser表示中
  if (showJsonBrowser) {
    return (
      <div className="flex flex-col h-full p-3">
        <h3 className="text-xs font-medium text-text-primary mb-2">校正チェックJSONを選択</h3>
        <div className="flex-1 min-h-0">
          <JsonFileBrowser
            basePath={jsonBasePath}
            onSelect={handleJsonSelect}
            onCancel={() => setShowJsonBrowser(false)}
            mode="open"
          />
        </div>
        {loadError && <p className="text-[10px] text-error mt-2">{loadError}</p>}
      </div>
    );
  }

  // データ未読込
  if (!checkData) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 px-6">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent/10 to-accent-secondary/10 flex items-center justify-center">
          <svg
            className="w-8 h-8 text-accent/50"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
        </div>
        <div className="text-center">
          <p className="text-xs text-text-secondary mb-1">校正チェックデータがありません</p>
          <p className="text-[10px] text-text-muted">JSONファイルを読み込んでください</p>
        </div>
        <button
          onClick={() => setShowJsonBrowser(true)}
          className="px-4 py-2 text-xs font-medium text-white bg-gradient-to-r from-accent to-accent-secondary rounded-lg hover:-translate-y-0.5 transition-all shadow-sm"
        >
          JSONを読み込む
        </button>
      </div>
    );
  }

  // データ表示
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-display font-medium text-text-primary truncate flex-1">
            {checkData.title}
          </span>
          <span className="text-[10px] text-text-muted flex-shrink-0">
            {checkData.allItems.length}件
          </span>
          <button
            onClick={() => setShowJsonBrowser(true)}
            className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded transition-all text-text-muted hover:text-text-primary hover:bg-bg-tertiary active:scale-95"
            title="別のJSONを読み込む"
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
                d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Tabs */}
      {hasCorrectness && hasProposal && (
        <div className="px-3 py-1.5 border-b border-border flex-shrink-0">
          <div className="flex bg-bg-elevated rounded-md p-0.5 border border-white/5">
            {[
              { mode: "both" as CheckTabMode, label: "両方表示" },
              {
                mode: "correctness" as CheckTabMode,
                label: `正誤チェック (${checkData.correctnessItems.length})`,
              },
              {
                mode: "proposal" as CheckTabMode,
                label: `提案チェック (${checkData.proposalItems.length})`,
              },
            ].map(({ mode, label }) => (
              <button
                key={mode}
                onClick={() => setCheckTabMode(mode)}
                className={`flex-1 px-2 py-1 text-[10px] rounded transition-all ${
                  checkTabMode === mode
                    ? "bg-bg-tertiary text-text-primary font-medium shadow-sm"
                    : "text-text-muted hover:text-text-secondary"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Search */}
      <div className="px-3 py-1.5 border-b border-border flex-shrink-0">
        <div className="relative">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            placeholder="検索..."
            className="w-full pl-8 pr-8 py-1.5 text-xs bg-bg-elevated border border-border/50 rounded-lg text-text-primary placeholder:text-text-muted/40 focus:outline-none focus:border-accent/50"
          />
          {localSearch && (
            <button
              onClick={() => {
                setLocalSearch("");
                setSearchQuery("");
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 p-2">
        {checkTabMode === "both" && hasCorrectness && hasProposal ? (
          /* 上下並び表示 */
          <div className="space-y-3">
            {/* 正誤チェック */}
            <div className="rounded-lg border border-error/20 bg-error/[0.03] overflow-hidden">
              <div className="sticky top-0 z-10 px-2 py-1.5 bg-error/10 text-error text-[10px] font-medium text-center border-b border-error/20">
                正誤チェック ({filteredItems.correctness.length})
              </div>
              <div className="p-1.5">
                <CategoryList
                  items={filteredItems.correctness}
                  onPageClick={navigateToPage}
                  searchQuery={searchQuery}
                />
              </div>
            </div>
            {/* 提案チェック */}
            <div className="rounded-lg border border-accent-secondary/20 bg-accent-secondary/[0.03] overflow-hidden">
              <div className="sticky top-0 z-10 px-2 py-1.5 bg-accent-secondary/10 text-accent-secondary text-[10px] font-medium text-center border-b border-accent-secondary/20">
                提案チェック ({filteredItems.proposal.length})
              </div>
              <div className="p-1.5">
                <CategoryList
                  items={filteredItems.proposal}
                  onPageClick={navigateToPage}
                  searchQuery={searchQuery}
                />
              </div>
            </div>
          </div>
        ) : (
          /* 単一カラム表示 */
          <CategoryList
            items={displayItems}
            onPageClick={navigateToPage}
            searchQuery={searchQuery}
          />
        )}

        {displayItems.length === 0 && (
          <div className="flex items-center justify-center py-8 text-[10px] text-text-muted">
            {searchQuery ? "検索結果がありません" : "項目がありません"}
          </div>
        )}
      </div>
    </div>
  );
}

/** カテゴリ別にグループ化して CheckCategoryGroup を描画 */
function CategoryList({
  items,
  onPageClick,
  searchQuery,
}: {
  items: ProofreadingCheckItem[];
  onPageClick: (page: string) => void;
  searchQuery: string;
}) {
  const grouped = useMemo(() => groupByCategory(items), [items]);

  return (
    <>
      {[...grouped.entries()].map(([category, catItems]) => (
        <CheckCategoryGroup
          key={category}
          category={category}
          items={catItems}
          onPageClick={onPageClick}
          searchQuery={searchQuery}
        />
      ))}
    </>
  );
}
