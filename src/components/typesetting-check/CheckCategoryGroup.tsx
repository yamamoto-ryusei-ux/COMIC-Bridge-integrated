import { useState } from "react";
import type { ProofreadingCheckItem } from "../../types/typesettingCheck";
import { CATEGORY_COLORS, getCategoryColorIndex } from "../../types/typesettingCheck";
import { useTypesettingCheckStore } from "../../store/typesettingCheckStore";

interface Props {
  category: string;
  items: ProofreadingCheckItem[];
  onPageClick: (page: string) => void;
  searchQuery?: string;
}

/** アイテムの一意キーを生成 */
function getItemKey(item: ProofreadingCheckItem): string {
  return `${item.checkKind}:${item.page}:${item.excerpt}:${item.content}`;
}

/** ページ文字列を "NP" 形式にフォーマット */
function formatPage(page: string): string {
  if (!page) return "";
  // "3巻 6ページ" → 6, "3巻1P" → 1, "6ページ" → 6 のように最後の数字を取得
  const match = String(page).match(/(\d+)\s*(?:ページ|ぺーじ|P|p)\s*$/i);
  if (match) return `${match[1]}P`;
  // フォールバック: 最後の連続数字
  const lastNum = String(page).match(/(\d+)(?=[^\d]*$)/);
  return lastNum ? `${lastNum[1]}P` : page;
}

/** テキストのハイライト (検索クエリ一致部分を強調) */
function highlightText(text: string, query: string) {
  if (!query || !text) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-accent-warm/30 text-inherit rounded-sm px-0.5">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export function CheckCategoryGroup({ category, items, onPageClick, searchQuery }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const checkedItems = useTypesettingCheckStore((s) => s.checkedItems);
  const toggleChecked = useTypesettingCheckStore((s) => s.toggleChecked);
  const colorIdx = getCategoryColorIndex(category);
  const borderColor = colorIdx >= 0 ? CATEGORY_COLORS[colorIdx] : "#9090a0";

  const checkedCount = items.filter((item) => checkedItems.has(getItemKey(item))).length;

  return (
    <div className="mb-2">
      {/* Category Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-bg-tertiary transition-colors text-left"
        style={{ borderLeft: `3px solid ${borderColor}` }}
      >
        <svg
          className={`w-3 h-3 text-text-muted transition-transform flex-shrink-0 ${collapsed ? "-rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
        <span className="text-[11px] font-medium text-text-primary truncate flex-1">
          {category}
        </span>
        <span className="text-[10px] text-text-muted flex-shrink-0">
          {checkedCount > 0 ? (
            <>
              <span className="text-success">{checkedCount}</span>/{items.length}
            </>
          ) : (
            <>({items.length})</>
          )}
        </span>
      </button>

      {/* Items Table */}
      {!collapsed && (
        <div className="ml-2 mt-0.5" style={{ borderLeft: `2px solid ${borderColor}20` }}>
          <table className="w-full text-[11px]">
            <tbody>
              {items.map((item, i) => {
                const key = getItemKey(item);
                const isChecked = checkedItems.has(key);
                return (
                  <tr
                    key={i}
                    className={`border-b border-border/30 last:border-b-0 hover:bg-bg-tertiary/50 transition-colors ${isChecked ? "opacity-40" : ""}`}
                  >
                    {/* Checkbox */}
                    <td className="pl-2 pr-0 py-1.5 w-[28px] align-top">
                      <button
                        onClick={() => toggleChecked(key)}
                        className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
                          isChecked
                            ? "bg-success border-success text-white"
                            : "border-border hover:border-text-muted"
                        }`}
                        title={isChecked ? "未完了に戻す" : "完了にする"}
                      >
                        {isChecked && (
                          <svg
                            className="w-2.5 h-2.5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={3}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                    </td>
                    {/* Page */}
                    <td className="px-2 py-1.5 w-[42px] flex-shrink-0 align-top">
                      <button
                        onClick={() => onPageClick(item.page)}
                        className={`font-medium underline underline-offset-2 transition-colors ${isChecked ? "text-text-muted" : "text-accent hover:text-accent/80"}`}
                        title={`${formatPage(item.page)} へ移動`}
                      >
                        {formatPage(item.page)}
                      </button>
                    </td>
                    {/* Excerpt */}
                    <td
                      className={`px-2 py-1.5 align-top max-w-[140px] truncate ${isChecked ? "text-text-muted line-through" : "text-text-secondary"}`}
                    >
                      {searchQuery ? highlightText(item.excerpt || "", searchQuery) : item.excerpt}
                    </td>
                    {/* Content */}
                    <td
                      className={`px-2 py-1.5 font-medium align-top ${isChecked ? "text-text-muted line-through" : "text-error"}`}
                    >
                      {searchQuery ? highlightText(item.content || "", searchQuery) : item.content}
                    </td>
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
