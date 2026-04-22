import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

interface FontFolderContents {
  folders: string[];
  font_files: string[];
}

interface FontSearchResult {
  file_name: string;
  relative_path: string;
  full_path: string;
}

interface Props {
  basePath: string;
  missingFontNames: string[];
  onInstalled: () => void;
  onClose: () => void;
}

export function FontBrowserDialog({ basePath, missingFontNames, onInstalled, onClose }: Props) {
  const normalizedBase = basePath.replace(/\\/g, "/").replace(/\/+$/, "");
  const [currentPath, setCurrentPath] = useState(normalizedBase);
  const [contents, setContents] = useState<FontFolderContents | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 検索
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<FontSearchResult[]>([]);
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [searching, setSearching] = useState(false);
  const [indexReady, setIndexReady] = useState(false);

  // 選択 & インストール
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [installing, setInstalling] = useState(false);
  const [installedFiles, setInstalledFiles] = useState<Set<string>>(new Set());
  const [installError, setInstallError] = useState<string | null>(null);

  const loadFolder = useCallback(async (path: string, noCache = false) => {
    setLoading(true);
    setError(null);
    setSelectedFiles(new Set());
    try {
      const result = await invoke<FontFolderContents>("list_font_folder_contents", {
        folderPath: path,
        noCache: noCache || undefined,
      });
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
    // ダイアログ表示時にバックグラウンドで検索インデックスを構築
    invoke("search_font_files", { basePath: normalizedBase, query: "__preload__" })
      .then(() => setIndexReady(true))
      .catch(() => {});
  }, [normalizedBase, loadFolder]);

  const isAtRoot = currentPath === normalizedBase;

  const navigateUp = () => {
    if (isAtRoot) return;
    const parts = currentPath.split("/");
    parts.pop();
    const parent = parts.join("/");
    if (parent.length < normalizedBase.length) return;
    loadFolder(parent);
  };

  const navigateToFolder = (folderName: string) => {
    loadFolder(currentPath + "/" + folderName);
  };

  // 検索（デバウンス300ms、インデックス構築済みなら即座に結果返却）
  useEffect(() => {
    if (!searchQuery.trim()) {
      setIsSearchMode(false);
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setIsSearchMode(true);
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const results = await invoke<FontSearchResult[]>("search_font_files", {
          basePath: normalizedBase,
          query: searchQuery.trim(),
        });
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
        if (!indexReady) setIndexReady(true);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, normalizedBase, indexReady]);

  // チェックボックス切り替え
  const toggleSelect = (fullPath: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(fullPath)) next.delete(fullPath);
      else next.add(fullPath);
      return next;
    });
  };

  // フォルダブラウズモード: フルパスを構築
  const getFullPath = (fileName: string) => currentPath + "/" + fileName;

  // インストール
  const handleInstall = async () => {
    const files = [...selectedFiles];
    if (files.length === 0) return;

    setInstalling(true);
    setInstallError(null);
    let successCount = 0;

    for (const filePath of files) {
      try {
        await invoke<string>("install_font_from_path", { fontPath: filePath.replace(/\//g, "\\") });
        setInstalledFiles((prev) => new Set([...prev, filePath]));
        successCount++;
      } catch (e) {
        setInstallError(String(e));
        break;
      }
    }

    setInstalling(false);
    if (successCount > 0) {
      onInstalled();
    }
  };

  // パンくず
  const relativePath = currentPath.slice(normalizedBase.length);
  const baseName = normalizedBase.split("/").pop() || normalizedBase;
  const relParts = relativePath.split("/").filter(Boolean);

  // 現在表示中のフォントファイル一覧（検索 or フォルダ内）
  const displayFiles: { fileName: string; fullPath: string; relative?: string }[] = isSearchMode
    ? searchResults.map((r) => ({
        fileName: r.file_name,
        fullPath: r.full_path,
        relative: r.relative_path,
      }))
    : (contents?.font_files || []).map((f) => ({ fileName: f, fullPath: getFullPath(f) }));

  return (
    <div
      className="bg-bg-secondary rounded-xl border border-border overflow-hidden flex flex-col"
      style={{ maxHeight: "560px" }}
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-border flex items-center gap-2">
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
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
          />
        </svg>
        <span className="text-xs font-medium text-text-primary">フォントインストール</span>
        {installedFiles.size > 0 && (
          <span className="text-[9px] text-emerald-400 ml-auto">
            {installedFiles.size}件インストール済み
          </span>
        )}
      </div>

      {/* Missing font names */}
      {missingFontNames.length > 0 && (
        <div className="px-3 py-2 border-b border-border/50 bg-red-500/3">
          <div className="flex items-center gap-1.5 mb-1">
            <svg
              className="w-3 h-3 text-red-400 flex-shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <span className="text-[9px] text-red-400 font-medium">
              探しているフォント ({missingFontNames.length}件)
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {missingFontNames.map((name) => (
              <span
                key={name}
                className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400/80 border border-red-500/20"
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Search */}
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
            placeholder="ファイル名で検索..."
            className="w-full pl-8 pr-8 py-1.5 text-xs bg-bg-elevated border border-border/50 rounded-lg text-text-primary placeholder:text-text-muted/40 focus:outline-none focus:border-accent/50"
          />
          {searchQuery && (
            <button
              onClick={() => {
                setSearchQuery("");
                setIsSearchMode(false);
                setSelectedFiles(new Set());
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

      {/* Breadcrumb (hidden during search) */}
      {!isSearchMode && (
        <div className="px-3 py-1.5 border-b border-border/50 flex items-center gap-2">
          <button
            onClick={navigateUp}
            disabled={isAtRoot}
            className="text-text-muted hover:text-text-primary p-1 rounded hover:bg-bg-tertiary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 min-w-0 flex items-center gap-0.5 overflow-x-auto text-[10px] scrollbar-none">
            <button
              onClick={() => loadFolder(normalizedBase)}
              className={`flex-shrink-0 transition-colors ${relParts.length === 0 ? "text-accent font-medium" : "text-text-secondary hover:text-accent"}`}
            >
              {baseName}
            </button>
            {relParts.map((part, i) => (
              <span key={i} className="flex items-center gap-0.5 flex-shrink-0">
                <span className="text-text-muted">/</span>
                <button
                  onClick={() =>
                    loadFolder(normalizedBase + "/" + relParts.slice(0, i + 1).join("/"))
                  }
                  className={`transition-colors ${i === relParts.length - 1 ? "text-accent font-medium" : "text-text-secondary hover:text-accent"}`}
                >
                  {part}
                </button>
              </span>
            ))}
          </div>
          <button
            onClick={() => loadFolder(currentPath, true)}
            className="text-text-muted hover:text-text-primary p-1 rounded hover:bg-bg-tertiary transition-colors"
            title="更新（キャッシュクリア）"
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
      <div className="flex-1 overflow-auto p-2 space-y-0.5 min-h-[240px]">
        {loading && (
          <div className="text-center py-8">
            <p className="text-xs text-text-muted">読み込み中...</p>
          </div>
        )}
        {error && (
          <div className="text-center py-4">
            <p className="text-xs text-red-400">{error}</p>
          </div>
        )}

        {!loading && !error && (
          <>
            {/* Folders (not in search mode) */}
            {!isSearchMode &&
              contents?.folders.map((folder) => (
                <button
                  key={folder}
                  onClick={() => navigateToFolder(folder)}
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

            {/* Font files */}
            {displayFiles.map((item) => {
              const isSelected = selectedFiles.has(item.fullPath);
              const isInstalled = installedFiles.has(item.fullPath);
              return (
                <button
                  key={item.fullPath}
                  onClick={() => !isInstalled && toggleSelect(item.fullPath)}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-colors border ${
                    isInstalled
                      ? "bg-emerald-500/5 border-emerald-500/20"
                      : isSelected
                        ? "bg-accent/10 border-accent/30"
                        : "hover:bg-bg-tertiary border-transparent"
                  }`}
                >
                  {/* Checkbox */}
                  <div
                    className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center ${
                      isInstalled
                        ? "bg-emerald-500/20 border-emerald-500/50"
                        : isSelected
                          ? "bg-accent/20 border-accent/50"
                          : "border-border"
                    }`}
                  >
                    {(isSelected || isInstalled) && (
                      <svg
                        className={`w-2.5 h-2.5 ${isInstalled ? "text-emerald-400" : "text-accent"}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={3}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>

                  {/* Font icon */}
                  <svg
                    className="w-3.5 h-3.5 text-text-muted flex-shrink-0"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path d="M5 4h10v2.5h-1.2V5.5H10.6V14h1.5v1.5h-4.2V14h1.5V5.5H6.2v1H5V4z" />
                  </svg>

                  <div className="flex-1 min-w-0">
                    <span className="text-xs text-text-primary truncate block">
                      {item.fileName}
                    </span>
                    {isSearchMode && item.relative && (
                      <span className="text-[9px] text-text-muted truncate block">
                        {item.relative.split(/[/\\]/).slice(0, -1).join(" / ")}
                      </span>
                    )}
                  </div>

                  {isInstalled && (
                    <span className="text-[9px] text-emerald-400 flex-shrink-0">完了</span>
                  )}
                </button>
              );
            })}

            {/* Empty state */}
            {!isSearchMode &&
              contents &&
              contents.folders.length === 0 &&
              contents.font_files.length === 0 && (
                <div className="text-center py-8">
                  <p className="text-[10px] text-text-muted">フォントファイルがありません</p>
                </div>
              )}
            {isSearchMode && searching && (
              <div className="text-center py-8">
                <p className="text-xs text-text-muted">
                  {indexReady ? "検索中..." : "インデックス構築中（初回のみ）..."}
                </p>
              </div>
            )}
            {isSearchMode && !searching && searchResults.length === 0 && searchQuery.trim() && (
              <div className="text-center py-8">
                <p className="text-xs text-text-muted">見つかりませんでした</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Install error */}
      {installError && (
        <div className="px-3 py-1.5 border-t border-red-500/20 bg-red-500/5">
          <p className="text-[10px] text-red-400 truncate">{installError}</p>
        </div>
      )}

      {/* Footer */}
      <div className="px-3 py-2 border-t border-border flex items-center gap-2">
        <span className="text-[10px] text-text-muted flex-1">
          {selectedFiles.size > 0 && `${selectedFiles.size}件選択中`}
        </span>
        <button
          onClick={handleInstall}
          disabled={selectedFiles.size === 0 || installing}
          className="px-3 py-1.5 text-xs font-medium text-white bg-accent rounded-lg
            hover:bg-accent-secondary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {installing ? "インストール中..." : "インストール"}
        </button>
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-xs text-text-muted hover:text-text-primary transition-colors"
        >
          閉じる
        </button>
      </div>
    </div>
  );
}
