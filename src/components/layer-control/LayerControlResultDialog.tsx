import { useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { useLayerStore } from "../../store/layerStore";

interface MatchItem {
  type: string; // テキスト, レイヤー, フォルダ
  name: string;
  parent?: string; // 親フォルダ名
}

interface TreeNode {
  type: string;
  name: string;
  children: TreeNode[];
}

/** changesからマッチしたレイヤー/フォルダ名・種別・親を抽出 */
function extractMatchedItems(changes: string[]): MatchItem[] {
  const items: MatchItem[] = [];
  for (const c of changes) {
    // "  → テキスト「セリフ1」∈「text」" or "  → フォルダ「text」"
    const m = c.match(/^\s+→\s+(テキスト|レイヤー|フォルダ)「(.+?)」(?:∈「(.+?)」)?$/);
    if (m) items.push({ type: m[1], name: m[2], parent: m[3] || undefined });
  }
  return items;
}

/** フラットなアイテム配列をツリー構造に変換 */
function buildTree(items: MatchItem[]): TreeNode[] {
  // 親フォルダごとに子をグルーピング
  const childrenByParent = new Map<string, MatchItem[]>();
  const roots: MatchItem[] = [];

  for (const item of items) {
    if (item.parent) {
      const list = childrenByParent.get(item.parent) || [];
      list.push(item);
      childrenByParent.set(item.parent, list);
    } else {
      roots.push(item);
    }
  }

  const result: TreeNode[] = [];

  // ルートアイテムを追加（フォルダの場合は子を紐付け）
  for (const item of roots) {
    const node: TreeNode = { type: item.type, name: item.name, children: [] };
    if (item.type === "フォルダ" && childrenByParent.has(item.name)) {
      node.children = (childrenByParent.get(item.name) || []).map((child) => ({
        type: child.type,
        name: child.name,
        children: [],
      }));
      childrenByParent.delete(item.name);
    }
    result.push(node);
  }

  // 親フォルダ自体が結果に含まれていない場合、コンテキストとしてグループノードを生成
  for (const [parentName, children] of childrenByParent) {
    result.push({
      type: "グループ",
      name: parentName,
      children: children.map((child) => ({
        type: child.type,
        name: child.name,
        children: [],
      })),
    });
  }

  return result;
}

const TYPE_ICONS: Record<string, { label: string; class: string }> = {
  フォルダ: { label: "F", class: "bg-amber-100 text-amber-600 border-amber-200" },
  グループ: { label: "G", class: "bg-amber-50 text-amber-500 border-amber-200" },
  テキスト: { label: "T", class: "bg-blue-100 text-blue-600 border-blue-200" },
  レイヤー: { label: "L", class: "bg-violet-100 text-violet-600 border-violet-200" },
};

export function LayerControlResultDialog() {
  const lastResults = useLayerStore((s) => s.lastResults);
  const lastActionMode = useLayerStore((s) => s.lastActionMode);
  const clearLastResults = useLayerStore((s) => s.clearLastResults);
  const lastMergeOutputFolder = useLayerStore((s) => s.lastMergeOutputFolder);
  const lastMergeSourceFolder = useLayerStore((s) => s.lastMergeSourceFolder);

  const handleOpenFolder = useCallback(async () => {
    if (!lastMergeOutputFolder) return;
    try {
      await invoke("open_folder_in_explorer", {
        folderPath: lastMergeOutputFolder.replace(/\//g, "\\"),
      });
    } catch (e) {
      console.error("Failed to open folder:", e);
    }
  }, [lastMergeOutputFolder]);

  const handleOpenKenban = useCallback(async () => {
    if (!lastMergeSourceFolder || !lastMergeOutputFolder) return;
    try {
      await invoke("launch_kenban_diff", {
        folderA: lastMergeSourceFolder.replace(/\//g, "\\"),
        folderB: lastMergeOutputFolder.replace(/\//g, "\\"),
        mode: "psd",
      });
    } catch (e) {
      console.error("Failed to launch KENBAN:", e);
    }
  }, [lastMergeSourceFolder, lastMergeOutputFolder, clearLastResults]);

  // ESC to close
  useEffect(() => {
    if (lastResults.length === 0) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") clearLastResults();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [lastResults.length, clearLastResults]);

  // Scroll lock
  useEffect(() => {
    if (lastResults.length === 0) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [lastResults.length]);

  if (lastResults.length === 0) return null;

  const successCount = lastResults.filter((r) => r.success).length;
  const errorCount = lastResults.filter((r) => !r.success).length;
  const totalChanged = lastResults.reduce((acc, r) => acc + r.changedCount, 0);
  const isHideMode = lastActionMode === "hide";
  const isOrganizeMode = lastActionMode === "organize";
  const isLayerMoveMode = lastActionMode === "layerMove";
  const isMergeMode = lastActionMode === "merge";

  const matchDetails = lastResults
    .filter((r) => r.success)
    .map((r) => ({
      fileName: r.fileName,
      tree: buildTree(extractMatchedItems(r.changes)),
    }))
    .filter((d) => d.tree.length > 0);

  // Theme colors based on mode
  const accent = isMergeMode
    ? {
        detail: "bg-emerald-500/5 border-emerald-500/20",
        detailHeader: "bg-emerald-500/10 border-emerald-500/15",
        detailTitle: "text-emerald-400",
        detailDivider: "divide-emerald-500/10",
        btn: "from-emerald-500 to-teal-500 shadow-[0_4px_15px_rgba(16,185,129,0.3)]",
      }
    : isLayerMoveMode
      ? {
          detail: "bg-violet-500/5 border-violet-500/20",
          detailHeader: "bg-violet-500/10 border-violet-500/15",
          detailTitle: "text-violet-400",
          detailDivider: "divide-violet-500/10",
          btn: "from-violet-500 to-purple-500 shadow-[0_4px_15px_rgba(139,92,246,0.3)]",
        }
      : isOrganizeMode
        ? {
            detail: "bg-warning/5 border-warning/20",
            detailHeader: "bg-warning/10 border-warning/15",
            detailTitle: "text-warning",
            detailDivider: "divide-warning/10",
            btn: "from-warning to-amber-500 shadow-[0_4px_15px_rgba(245,158,11,0.3)]",
          }
        : isHideMode
          ? {
              detail: "bg-accent-secondary/5 border-accent-secondary/20",
              detailHeader: "bg-accent-secondary/10 border-accent-secondary/15",
              detailTitle: "text-accent-secondary",
              detailDivider: "divide-accent-secondary/10",
              btn: "from-accent to-accent-secondary shadow-glow-pink",
            }
          : {
              detail: "bg-accent-tertiary/5 border-accent-tertiary/20",
              detailHeader: "bg-accent-tertiary/10 border-accent-tertiary/15",
              detailTitle: "text-accent-tertiary",
              detailDivider: "divide-accent-tertiary/10",
              btn: "from-accent-tertiary to-manga-sky shadow-[0_4px_15px_rgba(0,212,170,0.3)]",
            };

  const changedLabel = isMergeMode
    ? `${totalChanged} レイヤーを統合`
    : isOrganizeMode || isLayerMoveMode
      ? `${totalChanged} レイヤーを移動`
      : `${totalChanged} レイヤーを${isHideMode ? "非表示" : "表示"}に変更`;

  const dialog = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={clearLastResults}
    >
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="relative w-full max-w-2xl max-h-[80vh] bg-bg-secondary rounded-2xl border border-border shadow-elevated animate-slide-up flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <h2 className="text-lg font-display font-medium text-text-primary flex items-center gap-2">
            <svg
              className="w-5 h-5 text-text-muted"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
              />
            </svg>
            処理完了
          </h2>
          <button
            onClick={clearLastResults}
            className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6 space-y-4">
          {/* Summary badges */}
          <div className="flex gap-3">
            {successCount > 0 && (
              <div className="flex-1 bg-success/10 rounded-xl p-3 border border-success/30">
                <div className="flex items-center gap-2">
                  <svg
                    className="w-5 h-5 text-success"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-sm font-medium text-success">
                    {successCount} ファイル成功
                  </span>
                </div>
                <p className="text-xs text-success/70 mt-1">
                  {totalChanged > 0 ? changedLabel : "一致するレイヤーなし"}
                </p>
              </div>
            )}
            {errorCount > 0 && (
              <div className="flex-1 bg-error/10 rounded-xl p-3 border border-error/30">
                <div className="flex items-center gap-2">
                  <svg
                    className="w-5 h-5 text-error"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
                    />
                  </svg>
                  <span className="text-sm font-medium text-error">{errorCount} 失敗</span>
                </div>
              </div>
            )}
          </div>

          {/* Match Details (Tree) */}
          {matchDetails.length > 0 && (
            <div className={`rounded-xl border overflow-hidden ${accent.detail}`}>
              <div className={`px-4 py-2.5 border-b ${accent.detailHeader}`}>
                <h4
                  className={`text-xs font-medium ${accent.detailTitle} flex items-center gap-1.5`}
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
                      d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                    />
                  </svg>
                  マッチ詳細 — {matchDetails.length}/{successCount} ファイルでマッチ
                </h4>
              </div>
              <div className={`divide-y ${accent.detailDivider}`}>
                {matchDetails.map((d, idx) => (
                  <div key={idx} className="px-4 py-2.5">
                    {/* File name */}
                    <p
                      className="text-xs text-text-primary font-medium mb-1.5 truncate"
                      title={d.fileName}
                    >
                      {d.fileName}
                    </p>
                    {/* Tree */}
                    <div className="space-y-0.5">
                      {d.tree.map((node, nIdx) => (
                        <TreeItem key={nIdx} node={node} isLast={nIdx === d.tree.length - 1} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* File-by-file result table */}
          <div className="border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-bg-tertiary">
                  <th className="px-3 py-2 text-left text-xs font-medium text-text-muted w-10">
                    #
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-text-muted">
                    ファイル名
                  </th>
                  <th className="px-3 py-2 text-center text-xs font-medium text-text-muted w-20">
                    変更数
                  </th>
                  <th className="px-3 py-2 text-center text-xs font-medium text-text-muted w-16">
                    状態
                  </th>
                </tr>
              </thead>
              <tbody>
                {lastResults.map((r, idx) => (
                  <tr key={idx} className="border-t border-border/50 hover:bg-bg-tertiary/50">
                    <td className="px-3 py-2 text-xs text-text-muted">{idx + 1}</td>
                    <td
                      className="px-3 py-2 text-xs text-text-primary truncate max-w-[300px]"
                      title={r.fileName}
                    >
                      {r.fileName}
                    </td>
                    <td className="px-3 py-2 text-center text-xs text-text-secondary">
                      {r.success ? (r.changedCount > 0 ? `${r.changedCount} レイヤー` : "—") : "—"}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {r.success ? (
                        <span className="inline-flex w-5 h-5 items-center justify-center rounded-full bg-success/20">
                          <svg
                            className="w-3 h-3 text-success"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={3}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </span>
                      ) : (
                        <span
                          className="inline-flex w-5 h-5 items-center justify-center rounded-full bg-error/20"
                          title={r.error}
                        >
                          <svg
                            className="w-3 h-3 text-error"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={3}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M6 18L18 6M6 6l12 12"
                            />
                          </svg>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Error Details */}
          {errorCount > 0 && (
            <div className="bg-error/5 rounded-xl p-3 border border-error/20">
              <h4 className="text-xs font-medium text-error mb-2">エラー詳細</h4>
              <div className="space-y-1">
                {lastResults
                  .filter((r) => !r.success)
                  .slice(0, 5)
                  .map((r, idx) => (
                    <p key={idx} className="text-[10px] text-error/80 truncate">
                      {r.fileName}: {r.error}
                    </p>
                  ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex items-center justify-end gap-2 flex-shrink-0">
          {isMergeMode && successCount > 0 && lastMergeOutputFolder && (
            <>
              <button
                onClick={handleOpenFolder}
                className="px-4 py-2.5 text-sm font-medium rounded-xl text-text-primary bg-bg-tertiary border border-border hover:bg-bg-elevated hover:-translate-y-0.5 transition-all duration-200 flex items-center gap-1.5"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z"
                  />
                </svg>
                フォルダを開く
              </button>
              {lastMergeSourceFolder && (
                <button
                  onClick={handleOpenKenban}
                  className="px-4 py-2.5 text-sm font-medium rounded-xl text-white bg-gradient-to-r from-blue-500 to-indigo-500 shadow-[0_4px_15px_rgba(59,130,246,0.3)] hover:-translate-y-0.5 transition-all duration-200 flex items-center gap-1.5"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                  KENBANで差分確認
                </button>
              )}
            </>
          )}
          <button
            onClick={clearLastResults}
            className={`px-6 py-2.5 text-sm font-medium rounded-xl text-white bg-gradient-to-r ${accent.btn} hover:-translate-y-0.5 transition-all duration-200`}
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}

/** ツリーノード1項目 */
function TreeItem({
  node,
  isLast,
  depth = 0,
}: {
  node: TreeNode;
  isLast: boolean;
  depth?: number;
}) {
  const icon = TYPE_ICONS[node.type] || {
    label: "?",
    class: "bg-gray-100 text-gray-600 border-gray-200",
  };
  const hasChildren = node.children.length > 0;

  return (
    <>
      <div className="flex items-center gap-1.5" style={{ paddingLeft: depth * 16 }}>
        {/* Tree connector */}
        {depth > 0 && (
          <span className="text-text-muted/30 text-[10px] font-mono w-3 text-center flex-shrink-0">
            {isLast ? "└" : "├"}
          </span>
        )}
        {/* Type badge */}
        <span
          className={`inline-flex items-center justify-center w-4 h-4 rounded text-[8px] font-bold border flex-shrink-0 ${icon.class}`}
        >
          {icon.label}
        </span>
        {/* Name */}
        <span className="text-[11px] text-text-primary truncate">{node.name}</span>
        {/* Child count */}
        {hasChildren && (
          <span className="text-[9px] text-text-muted/60 flex-shrink-0">
            ({node.children.length})
          </span>
        )}
      </div>
      {/* Children */}
      {node.children.map((child, cIdx) => (
        <TreeItem
          key={cIdx}
          node={child}
          isLast={cIdx === node.children.length - 1}
          depth={depth + 1}
        />
      ))}
    </>
  );
}
