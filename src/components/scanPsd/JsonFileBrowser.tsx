import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

interface FolderContents {
  folders: string[];
  json_files: string[];
}

interface SearchResult {
  label: string;
  title: string;
  path: string;
}

interface Props {
  basePath: string;
  onSelect: (filePath: string) => void;
  onCancel: () => void;
  mode: "open" | "save";
  defaultFileName?: string;
}

/** basePath 以下のみ移動可能なJSON専用ファイルブラウザ（検索機能付き） */
export function JsonFileBrowser({ basePath, onSelect, onCancel, mode, defaultFileName }: Props) {
  const normalizedBase = basePath.replace(/\\/g, "/").replace(/\/+$/, "");
  const [currentPath, setCurrentPath] = useState(normalizedBase);
  const [contents, setContents] = useState<FolderContents | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [saveFileName, setSaveFileName] = useState(defaultFileName || "preset.json");

  // 検索
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearchMode, setIsSearchMode] = useState(false);

  const loadFolder = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    setSelectedFile(null);
    try {
      const result = await invoke<FolderContents>("list_folder_contents", { folderPath: path });
      setContents(result);
      setCurrentPath(path.replace(/\\/g, "/").replace(/\/+$/, ""));
    } catch (e) {
      setError(String(e));
      setContents(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFolder(normalizedBase);
  }, [normalizedBase, loadFolder]);

  // basePath より上には移動できない
  const isAtRoot = currentPath === normalizedBase;

  const navigateUp = () => {
    if (isAtRoot) return;
    const parts = currentPath.split("/");
    parts.pop();
    const parent = parts.join("/");
    // basePath の親には行かない
    if (parent.length < normalizedBase.length) return;
    loadFolder(parent);
  };

  const navigateToFolder = (folderName: string) => {
    loadFolder(currentPath + "/" + folderName);
  };

  const handleConfirm = () => {
    if (mode === "open" && selectedFile) {
      onSelect(currentPath + "/" + selectedFile);
    } else if (mode === "save" && saveFileName.trim()) {
      let name = saveFileName.trim();
      if (!name.endsWith(".json")) name += ".json";
      onSelect(currentPath + "/" + name);
    }
  };

  // 検索（デバウンス300ms）
  useEffect(() => {
    if (!searchQuery.trim()) {
      setIsSearchMode(false);
      setSearchResults([]);
      return;
    }
    setIsSearchMode(true);
    const timer = setTimeout(async () => {
      try {
        const results = await invoke<SearchResult[]>("search_json_folders", {
          basePath: normalizedBase,
          query: searchQuery.trim(),
        });
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, normalizedBase]);

  // 検索結果クリック → フォルダに移動
  const handleSearchSelect = useCallback(
    (result: SearchResult) => {
      const normalized = result.path.replace(/\\/g, "/").replace(/\/+$/, "");
      setSearchQuery("");
      setIsSearchMode(false);
      setSearchResults([]);
      loadFolder(normalized);
    },
    [loadFolder],
  );

  // basePath からの相対パスをパンくずに表示
  const relativePath = currentPath.slice(normalizedBase.length);
  const baseName = normalizedBase.split("/").pop() || normalizedBase;
  const relParts = relativePath.split("/").filter(Boolean);

  return (
    <div className="bg-bg-secondary rounded-xl border border-border overflow-hidden flex flex-col max-h-[500px]">
      {/* Search input */}
      {mode === "open" && (
        <div className="px-3 py-2 border-b border-border">
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
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="作品名で検索..."
              className="w-full pl-8 pr-8 py-1.5 text-xs bg-bg-elevated border border-border/50 rounded-lg text-text-primary placeholder:text-text-muted/40 focus:outline-none focus:border-accent/50"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery("");
                  setIsSearchMode(false);
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
      )}

      {/* Header: パンくず (hidden during search) */}
      {!isSearchMode && (
        <div className="px-3 py-2 border-b border-border flex items-center gap-2">
          <button
            onClick={navigateUp}
            disabled={isAtRoot}
            className="text-text-muted hover:text-text-primary p-1 rounded hover:bg-bg-tertiary transition-colors
              disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 min-w-0 flex items-center gap-0.5 overflow-x-auto text-[10px] scrollbar-none">
            {/* ベースフォルダ（ルート） */}
            <button
              onClick={() => loadFolder(normalizedBase)}
              className={`flex-shrink-0 transition-colors ${
                relParts.length === 0
                  ? "text-accent font-medium"
                  : "text-text-secondary hover:text-accent"
              }`}
            >
              {baseName}
            </button>
            {/* サブパスの各部分 */}
            {relParts.map((part, i) => (
              <span key={i} className="flex items-center gap-0.5 flex-shrink-0">
                <span className="text-text-muted">/</span>
                <button
                  onClick={() => {
                    const target = normalizedBase + "/" + relParts.slice(0, i + 1).join("/");
                    loadFolder(target);
                  }}
                  className={`transition-colors ${
                    i === relParts.length - 1
                      ? "text-accent font-medium"
                      : "text-text-secondary hover:text-accent"
                  }`}
                >
                  {part}
                </button>
              </span>
            ))}
          </div>
          <button
            onClick={() => loadFolder(currentPath)}
            className="text-text-muted hover:text-text-primary p-1 rounded hover:bg-bg-tertiary transition-colors"
            title="更新"
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
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto p-2 space-y-0.5 min-h-[200px]">
        {isSearchMode ? (
          searchResults.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-xs text-text-muted">
                {searchQuery.trim() ? "見つかりませんでした" : "検索中..."}
              </p>
            </div>
          ) : (
            searchResults.map((result, i) => (
              <button
                key={i}
                onClick={() => handleSearchSelect(result)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left hover:bg-bg-tertiary transition-colors"
              >
                <svg
                  className="w-4 h-4 text-accent flex-shrink-0"
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
                <div className="truncate">
                  <span className="text-[9px] text-accent/70 mr-1.5">{result.label}</span>
                  <span className="text-xs text-text-primary">{result.title}</span>
                </div>
              </button>
            ))
          )
        ) : (
          <>
            {loading && (
              <div className="text-center py-8">
                <p className="text-xs text-text-muted">読み込み中...</p>
              </div>
            )}
            {error && (
              <div className="text-center py-4">
                <p className="text-xs text-error">{error}</p>
              </div>
            )}
            {contents && !loading && (
              <>
                {/* Folders — ワンクリックで遷移 */}
                {contents.folders.map((folder) => (
                  <button
                    key={folder}
                    onClick={() => navigateToFolder(folder)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left
                      hover:bg-bg-tertiary transition-colors group"
                  >
                    <svg
                      className="w-4 h-4 text-accent flex-shrink-0"
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
                    <span className="text-xs text-text-primary truncate">{folder}</span>
                    <svg
                      className="w-3.5 h-3.5 flex-shrink-0 text-text-muted/50 ml-auto"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                ))}

                {/* JSON Files */}
                {contents.json_files.map((file) => (
                  <button
                    key={file}
                    onClick={() => {
                      setSelectedFile(file);
                      if (mode === "save") setSaveFileName(file);
                    }}
                    onDoubleClick={() => {
                      if (mode === "open") onSelect(currentPath + "/" + file);
                    }}
                    className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-colors
                      ${
                        selectedFile === file
                          ? "bg-accent/10 border border-accent/30"
                          : "hover:bg-bg-tertiary border border-transparent"
                      }`}
                  >
                    <svg
                      className="w-4 h-4 text-text-muted flex-shrink-0"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                    <span className="text-xs text-text-primary truncate">{file}</span>
                  </button>
                ))}

                {contents.folders.length === 0 && contents.json_files.length === 0 && (
                  <div className="text-center py-8">
                    <p className="text-[10px] text-text-muted">空のフォルダです</p>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Save filename input */}
      {mode === "save" && (
        <div className="px-3 py-2 border-t border-border">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-text-muted flex-shrink-0">ファイル名:</span>
            <input
              type="text"
              value={saveFileName}
              onChange={(e) => setSaveFileName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleConfirm();
              }}
              className="flex-1 bg-bg-tertiary border border-white/10 rounded px-2 py-1 text-xs text-text-primary
                focus:border-accent focus:outline-none"
            />
          </div>
        </div>
      )}

      {/* Actions */}
      {!isSearchMode && (
        <div className="px-3 py-2 border-t border-border flex gap-2">
          <button
            onClick={handleConfirm}
            disabled={mode === "open" ? !selectedFile : !saveFileName.trim()}
            className="flex-1 py-1.5 text-xs font-medium text-white bg-accent rounded-lg
              hover:bg-accent-secondary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {mode === "open" ? "開く" : "保存"}
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-1.5 text-xs text-text-muted hover:text-text-primary transition-colors"
          >
            キャンセル
          </button>
        </div>
      )}
    </div>
  );
}
