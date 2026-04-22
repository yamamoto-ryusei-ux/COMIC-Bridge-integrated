/**
 * ProGen JSONファイルブラウザ（Phase 3）
 * Gドライブのフォルダツリーを表示し、JSONファイルを選択・読み込み・保存する
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useProgenJson } from "../useProgenJson";
import type { FolderItem, JsonFileCache } from "../useProgenJson";


// ═══ Props ═══

interface Props {
  mode: "edit" | "save" | "proofreading" | "formatting";
  onClose: () => void;
  onJsonLoaded?: (result: { hasRules: boolean; labelName: string }) => void;
  onFolderSelected?: (folderPath: string, folderName: string) => void;
  autoExpandLabel?: string;
}

// ═══ メインコンポーネント ═══

export function ProgenJsonBrowser({ mode, onClose, onJsonLoaded, onFolderSelected, autoExpandLabel }: Props) {
  const { getBasePath, loadFolderContents, loadJsonFile, createNewWorkJson } = useProgenJson();

  const [, setBasePath] = useState("");
  const [expandedFolders, setExpandedFolders] = useState<Record<string, { items: FolderItem[]; loaded: boolean }>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<JsonFileCache[]>([]);
  const [allFilesCache, setAllFilesCache] = useState<JsonFileCache[]>([]);
  const [rootItems, setRootItems] = useState<FolderItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [newWorkMode, setNewWorkMode] = useState(false);
  const [newWorkTitle, setNewWorkTitle] = useState("");
  const [selectedFolderPath, setSelectedFolderPath] = useState("");
  const [selectedFolderName, setSelectedFolderName] = useState("");

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ═══ 初期化 ═══

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const bp = await getBasePath();
        setBasePath(bp);
        const items = await loadFolderContents(bp);
        items.sort((a, b) => {
          if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
          return a.name.localeCompare(b.name, "ja");
        });
        setRootItems(items);

        // 全JSONファイルをキャッシュ（検索用）
        collectAllJsonFiles(bp, items);

        // autoExpandLabel処理
        if (autoExpandLabel) {
          const target = items.find((it) => it.isFolder && it.name === autoExpandLabel);
          if (target) {
            const children = await loadFolderContents(target.path);
            children.sort((a, b) => {
              if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
              return a.name.localeCompare(b.name, "ja");
            });
            setExpandedFolders((prev) => ({ ...prev, [target.path]: { items: children, loaded: true } }));
          }
        }
      } catch (e) {
        console.error("ProgenJsonBrowser init error:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ═══ 全JSONファイル収集（検索キャッシュ用） ═══

  const collectAllJsonFiles = useCallback(async (_bp: string, items: FolderItem[]) => {
    const cache: JsonFileCache[] = [];

    const traverse = async (parentItems: FolderItem[], parentRelPath: string) => {
      for (const item of parentItems) {
        if (!item.isFolder) {
          cache.push({
            name: item.name,
            path: item.path,
            relativePath: parentRelPath ? `${parentRelPath}/${item.name}` : item.name,
          });
        } else {
          try {
            const children = await loadFolderContents(item.path);
            const relPath = parentRelPath ? `${parentRelPath}/${item.name}` : item.name;
            await traverse(children, relPath);
          } catch { /* skip inaccessible folders */ }
        }
      }
    };

    await traverse(items, "");
    setAllFilesCache(cache);
  }, [loadFolderContents]);

  // ═══ ESCキー ═══

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // ═══ 検索（デバウンス300ms） ═══

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    searchTimerRef.current = setTimeout(() => {
      const q = searchQuery.toLowerCase();
      const results = allFilesCache.filter((f) => f.name.toLowerCase().includes(q));
      setSearchResults(results);
    }, 300);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchQuery, allFilesCache]);

  // ═══ フォルダ展開/折りたたみ ═══

  const toggleFolder = useCallback(async (folderPath: string) => {
    if (expandedFolders[folderPath]?.loaded) {
      // 折りたたみ
      setExpandedFolders((prev) => {
        const next = { ...prev };
        delete next[folderPath];
        return next;
      });
      return;
    }
    // 展開 → 読み込み
    setExpandedFolders((prev) => ({ ...prev, [folderPath]: { items: [], loaded: false } }));
    try {
      const children = await loadFolderContents(folderPath);
      children.sort((a, b) => {
        if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
        return a.name.localeCompare(b.name, "ja");
      });
      setExpandedFolders((prev) => ({ ...prev, [folderPath]: { items: children, loaded: true } }));
    } catch (e) {
      console.error("Failed to load folder:", e);
      setExpandedFolders((prev) => {
        const next = { ...prev };
        delete next[folderPath];
        return next;
      });
    }
  }, [expandedFolders, loadFolderContents]);

  // ═══ ファイルクリック ═══

  const handleFileClick = useCallback(async (filePath: string, fileName: string) => {
    if (mode === "save") {
      // saveモード: ファイルを上書き対象として選択
      setSelectedFolderPath(filePath);
      setSelectedFolderName(fileName);
      if (onFolderSelected) onFolderSelected(filePath, fileName);
      onClose();
      return;
    }
    // edit / proofreading / formatting: JSONを読み込み
    setLoading(true);
    try {
      const result = await loadJsonFile(filePath, fileName);
      if (onJsonLoaded) onJsonLoaded(result);
      onClose();
    } catch (e) {
      console.error("Failed to load JSON:", e);
    } finally {
      setLoading(false);
    }
  }, [mode, loadJsonFile, onJsonLoaded, onFolderSelected, onClose]);

  // ═══ フォルダクリック（saveモード） ═══

  const handleFolderSelect = useCallback((folderPath: string, folderName: string) => {
    if (mode !== "save") return;
    setSelectedFolderPath(folderPath);
    setSelectedFolderName(folderName);
    if (onFolderSelected) onFolderSelected(folderPath, folderName);
    onClose();
  }, [mode, onFolderSelected, onClose]);

  // ═══ 新規作品作成 ═══

  const handleCreateNewWork = useCallback(async () => {
    if (!newWorkTitle.trim() || !selectedFolderPath) return;
    setLoading(true);
    try {
      await createNewWorkJson(selectedFolderPath, newWorkTitle.trim(), selectedFolderName);
      onClose();
    } catch (e) {
      console.error("Failed to create new work:", e);
    } finally {
      setLoading(false);
    }
  }, [newWorkTitle, selectedFolderPath, selectedFolderName, createNewWorkJson, onClose]);

  // ═══ タイトル ═══

  const title = mode === "save" ? "保存先を選択" : "JSONファイル選択";

  // ═══ レンダリング ═══

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-bg-primary rounded-xl shadow-2xl w-[600px] h-[70vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        ref={containerRef}
      >
        {/* ヘッダー */}
        <div className="px-4 py-2.5 border-b border-border flex items-center justify-between flex-shrink-0">
          <span className="text-xs font-bold text-text-primary">{title}</span>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center text-text-muted hover:text-text-primary transition-colors rounded hover:bg-bg-tertiary"
          >
            <span className="text-sm">&#10005;</span>
          </button>
        </div>

        {/* 検索バー */}
        <div className="px-3 py-2 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2 bg-bg-tertiary rounded px-2 py-1">
            <svg className="w-3.5 h-3.5 text-text-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ファイル名で検索..."
              className="flex-1 text-[11px] bg-transparent text-text-primary outline-none placeholder:text-text-muted"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} className="text-text-muted hover:text-text-primary transition-colors text-xs">
                &#10005;
              </button>
            )}
          </div>
        </div>

        {/* メインコンテンツ */}
        <div className="flex-1 overflow-auto p-2">
          {loading && rootItems.length === 0 ? (
            <div className="text-text-muted text-[11px] text-center py-8">読み込み中...</div>
          ) : searchQuery.trim() ? (
            // 検索結果
            searchResults.length === 0 ? (
              <div className="text-text-muted text-[11px] text-center py-8">一致するファイルがありません</div>
            ) : (
              <div className="space-y-0.5">
                {searchResults.map((file) => (
                  <button
                    key={file.path}
                    onClick={() => handleFileClick(file.path, file.name)}
                    className="w-full text-left px-2 py-1.5 rounded hover:bg-bg-tertiary transition-colors flex items-center gap-2 group"
                  >
                    <svg className="w-3.5 h-3.5 text-text-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <div className="min-w-0">
                      <div className="text-[11px] text-text-primary truncate group-hover:text-accent transition-colors">{file.name}</div>
                      <div className="text-[9px] text-text-muted truncate">{file.relativePath}</div>
                    </div>
                  </button>
                ))}
              </div>
            )
          ) : (
            // フォルダツリー
            <div className="space-y-0.5">
              {rootItems.map((item) =>
                item.isFolder ? (
                  <FolderItemView
                    key={item.path}
                    item={item}
                    depth={0}
                    mode={mode}
                    expandedFolders={expandedFolders}
                    onToggle={toggleFolder}
                    onFileClick={handleFileClick}
                    onFolderSelect={handleFolderSelect}
                    loadFolderContents={loadFolderContents}
                  />
                ) : (
                  <FileItemView
                    key={item.path}
                    item={item}
                    depth={0}
                    onClick={() => handleFileClick(item.path, item.name)}
                  />
                )
              )}
              {rootItems.length === 0 && !loading && (
                <div className="text-text-muted text-[11px] text-center py-8">フォルダが見つかりません</div>
              )}
            </div>
          )}
        </div>

        {/* フッター（saveモードのみ） */}
        {mode === "save" && (
          <div className="px-3 py-2 border-t border-border flex-shrink-0">
            {newWorkMode ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newWorkTitle}
                  onChange={(e) => setNewWorkTitle(e.target.value)}
                  placeholder="作品タイトルを入力..."
                  className="flex-1 text-[11px] px-2 py-1.5 bg-bg-tertiary border border-border/50 rounded text-text-primary outline-none focus:border-accent/50"
                  onKeyDown={(e) => { if (e.key === "Enter") handleCreateNewWork(); }}
                  autoFocus
                />
                <button
                  onClick={handleCreateNewWork}
                  disabled={!newWorkTitle.trim() || !selectedFolderPath || loading}
                  className="px-3 py-1.5 text-[10px] font-medium text-white bg-accent rounded hover:bg-accent/80 transition-colors disabled:opacity-30"
                >
                  作成
                </button>
                <button
                  onClick={() => { setNewWorkMode(false); setNewWorkTitle(""); }}
                  className="px-2 py-1.5 text-[10px] text-text-muted hover:text-text-primary transition-colors"
                >
                  キャンセル
                </button>
              </div>
            ) : (
              <button
                onClick={() => setNewWorkMode(true)}
                className="px-3 py-1.5 text-[10px] font-medium text-accent bg-accent/10 rounded hover:bg-accent/20 transition-colors"
              >
                + 新規作品を登録
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══ フォルダアイテム ═══

function FolderItemView({
  item,
  depth,
  mode,
  expandedFolders,
  onToggle,
  onFileClick,
  onFolderSelect,
  loadFolderContents,
}: {
  item: FolderItem;
  depth: number;
  mode: "edit" | "save" | "proofreading" | "formatting";
  expandedFolders: Record<string, { items: FolderItem[]; loaded: boolean }>;
  onToggle: (path: string) => void;
  onFileClick: (path: string, name: string) => void;
  onFolderSelect: (path: string, name: string) => void;
  loadFolderContents: (path: string) => Promise<FolderItem[]>;
}) {
  const expanded = expandedFolders[item.path];
  const isExpanded = !!expanded;
  const isLoaded = expanded?.loaded ?? false;

  return (
    <div>
      <div
        className="flex items-center gap-1 px-1 py-1 rounded hover:bg-bg-tertiary transition-colors cursor-pointer group"
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
      >
        {/* 展開矢印 */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggle(item.path); }}
          className="w-4 h-4 flex items-center justify-center text-text-muted hover:text-text-primary transition-colors flex-shrink-0"
        >
          <span className={`text-[10px] transition-transform ${isExpanded ? "rotate-90" : ""}`} style={{ display: "inline-block" }}>&#9654;</span>
        </button>
        {/* フォルダアイコン */}
        <svg className="w-3.5 h-3.5 text-accent flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
        {/* フォルダ名 */}
        <span
          className={`text-[11px] text-text-primary truncate ${mode === "save" && depth === 0 ? "hover:text-accent cursor-pointer" : ""}`}
          onClick={() => {
            if (mode === "save" && depth === 0) {
              onFolderSelect(item.path, item.name);
            } else {
              onToggle(item.path);
            }
          }}
        >
          {item.name}
        </span>
        {/* saveモード: ルートレベルフォルダの選択ボタン */}
        {mode === "save" && depth === 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); onFolderSelect(item.path, item.name); }}
            className="ml-auto text-[9px] text-accent opacity-0 group-hover:opacity-100 transition-opacity px-1.5 py-0.5 bg-accent/10 rounded"
          >
            選択
          </button>
        )}
      </div>
      {/* 子要素 */}
      {isExpanded && (
        <div>
          {!isLoaded ? (
            <div className="text-[10px] text-text-muted py-1" style={{ paddingLeft: `${(depth + 1) * 16 + 20}px` }}>読み込み中...</div>
          ) : expanded.items.length === 0 ? (
            <div className="text-[10px] text-text-muted py-1" style={{ paddingLeft: `${(depth + 1) * 16 + 20}px` }}>空のフォルダ</div>
          ) : (
            expanded.items.map((child) =>
              child.isFolder ? (
                <FolderItemView
                  key={child.path}
                  item={child}
                  depth={depth + 1}
                  mode={mode}
                  expandedFolders={expandedFolders}
                  onToggle={onToggle}
                  onFileClick={onFileClick}
                  onFolderSelect={onFolderSelect}
                  loadFolderContents={loadFolderContents}
                />
              ) : (
                <FileItemView
                  key={child.path}
                  item={child}
                  depth={depth + 1}
                  onClick={() => onFileClick(child.path, child.name)}
                />
              )
            )
          )}
        </div>
      )}
    </div>
  );
}

// ═══ ファイルアイテム ═══

function FileItemView({ item, depth, onClick }: { item: FolderItem; depth: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left flex items-center gap-1.5 px-1 py-1 rounded hover:bg-bg-tertiary transition-colors group"
      style={{ paddingLeft: `${depth * 16 + 22}px` }}
    >
      <svg className="w-3.5 h-3.5 text-text-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      <span className="text-[11px] text-text-primary truncate group-hover:text-accent transition-colors">{item.name}</span>
    </button>
  );
}
