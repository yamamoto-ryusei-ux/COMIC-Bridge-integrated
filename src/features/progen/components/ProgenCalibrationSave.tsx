/**
 * ProGen 校正データ保存ダイアログ
 * progen-result-viewer.js の calibration save flow を移植
 *
 * フロー:
 * 1. TXTフォルダツリーからレーベル→作品名を選択
 * 2. 巻数を入力して保存確定
 * 3. 保存成功モーダル
 */
import { useState, useEffect, useCallback } from "react";
import { useProgenJson, type PickedItem } from "../useProgenJson";
import { getTxtFolderPath, listTxtDirectory, createTxtWorkFolder } from "../useProgenTauri";

interface Props {
  items: PickedItem[];
  onClose: () => void;
  onSaved?: (filePath: string) => void;
}

interface TxtFolderItem {
  name: string;
  path: string;
  isDirectory: boolean;
}

type Phase = "folder" | "volume" | "success";

export function ProgenCalibrationSave({ items, onClose, onSaved }: Props) {
  const { saveCalibration } = useProgenJson();

  // Phase
  const [phase, setPhase] = useState<Phase>("folder");

  // Folder browser
  const [, setBasePath] = useState("");
  const [rootFolders, setRootFolders] = useState<TxtFolderItem[]>([]);
  const [expandedLabel, setExpandedLabel] = useState<{ path: string; name: string } | null>(null);
  const [labelChildren, setLabelChildren] = useState<TxtFolderItem[]>([]);
  const [loadingRoot, setLoadingRoot] = useState(false);
  const [loadingChildren, setLoadingChildren] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Selected
  const [selectedLabel, setSelectedLabel] = useState("");
  const [selectedWork, setSelectedWork] = useState("");
  const [, setSelectedFolderPath] = useState("");

  // Volume input
  const [volume, setVolume] = useState(1);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);

  // Success
  const [savedFilePath, setSavedFilePath] = useState("");

  // New work
  const [showNewWork, setShowNewWork] = useState(false);
  const [newWorkTitle, setNewWorkTitle] = useState("");

  // ═══ フォルダ読み込み ═══

  useEffect(() => {
    (async () => {
      setLoadingRoot(true);
      try {
        const path = await getTxtFolderPath();
        setBasePath(path);
        const result = await listTxtDirectory(path);
        if (result?.success && result.items) {
          const folders = result.items
            .filter((it: TxtFolderItem) => it.isDirectory)
            .sort((a: TxtFolderItem, b: TxtFolderItem) => a.name.localeCompare(b.name, "ja"));
          setRootFolders(folders);
        }
      } catch { /* ignore */ }
      setLoadingRoot(false);
    })();
  }, []);

  const toggleLabel = useCallback(async (folder: TxtFolderItem) => {
    if (expandedLabel?.path === folder.path) {
      setExpandedLabel(null);
      setLabelChildren([]);
      return;
    }
    setExpandedLabel({ path: folder.path, name: folder.name });
    setLoadingChildren(true);
    try {
      const result = await listTxtDirectory(folder.path);
      if (result?.success && result.items) {
        const children = result.items
          .filter((it: TxtFolderItem) => it.isDirectory)
          .sort((a: TxtFolderItem, b: TxtFolderItem) => a.name.localeCompare(b.name, "ja"));
        setLabelChildren(children);
      }
    } catch { /* ignore */ }
    setLoadingChildren(false);
  }, [expandedLabel]);

  const selectWork = useCallback((folderPath: string, workName: string) => {
    setSelectedFolderPath(folderPath);
    setSelectedWork(workName);
    setSelectedLabel(expandedLabel?.name || "");
    setPhase("volume");
  }, [expandedLabel]);

  // ═══ 新規作品登録 ═══

  const handleNewWork = useCallback(async () => {
    if (!newWorkTitle.trim() || !expandedLabel) return;
    const sanitized = newWorkTitle.trim().replace(/[\\/:*?"<>|]/g, "_");
    try {
      await createTxtWorkFolder(expandedLabel.name, sanitized);
      const workPath = expandedLabel.path.replace(/\\/g, "/") + "/" + sanitized;
      selectWork(workPath, sanitized);
      setShowNewWork(false);
      setNewWorkTitle("");
    } catch (e) {
      console.error("Failed to create work folder:", e);
    }
  }, [newWorkTitle, expandedLabel, selectWork]);

  // ═══ 保存実行 ═══

  const handleSave = useCallback(async () => {
    if (volume < 1) {
      setSaveError("巻数を1以上で入力してください");
      return;
    }
    setSaveError("");
    setSaving(true);
    try {
      const checkType = items.some((it) => it.type === "variation") ? "variation" : "simple";
      const result = await saveCalibration({
        label: selectedLabel,
        work: selectedWork,
        volume,
        checkType,
        items,
      });
      if (result?.success && result.filePath) {
        setSavedFilePath(result.filePath);
        setPhase("success");
        onSaved?.(result.filePath);
      } else {
        setSaveError(result?.error || "保存に失敗しました");
      }
    } catch (e) {
      setSaveError(String(e));
    }
    setSaving(false);
  }, [volume, selectedLabel, selectedWork, items, saveCalibration, onSaved]);

  // ═══ 検索フィルタ ═══

  const filteredRootFolders = searchQuery.trim()
    ? rootFolders.filter((f) => f.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : rootFolders;

  // ═══ ESCキー ═══

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // ═══ レンダリング ═══

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-bg-primary rounded-xl shadow-2xl w-[520px] flex flex-col overflow-hidden"
        style={{ maxHeight: "70vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-bg-secondary">
          <h3 className="text-[11px] font-medium text-text-primary">
            {phase === "folder" && "校正データ保存先を選択"}
            {phase === "volume" && "巻数を入力"}
            {phase === "success" && "保存完了"}
          </h3>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary text-lg transition-colors"
          >
            ✕
          </button>
        </div>

        {/* ── Phase: Folder ── */}
        {phase === "folder" && (
          <>
            {/* Search */}
            <div className="px-3 py-2 border-b border-border">
              <div className="relative">
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="レーベル検索..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-bg-tertiary border border-border/50 rounded-lg text-text-primary placeholder:text-text-muted/40 focus:outline-none focus:border-accent/50"
                />
              </div>
            </div>

            {/* Tree */}
            <div className="flex-1 overflow-auto p-2 min-h-[250px]">
              {loadingRoot ? (
                <div className="text-center py-8">
                  <p className="text-xs text-text-muted">読み込み中...</p>
                </div>
              ) : filteredRootFolders.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-xs text-text-muted">フォルダが見つかりません</p>
                </div>
              ) : (
                filteredRootFolders.map((folder) => (
                  <div key={folder.path}>
                    {/* Label folder */}
                    <button
                      onClick={() => toggleLabel(folder)}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left hover:bg-bg-tertiary transition-colors"
                    >
                      <svg
                        className={`w-3 h-3 text-text-muted transition-transform ${expandedLabel?.path === folder.path ? "rotate-90" : ""}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                      <svg className="w-4 h-4 text-accent flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                      <span className="text-xs text-text-primary truncate">{folder.name}</span>
                    </button>

                    {/* Children */}
                    {expandedLabel?.path === folder.path && (
                      <div className="ml-6 mt-0.5">
                        {loadingChildren ? (
                          <p className="text-[10px] text-text-muted py-2 pl-2">読み込み中...</p>
                        ) : labelChildren.length === 0 ? (
                          <p className="text-[10px] text-text-muted py-2 pl-2">作品がありません</p>
                        ) : (
                          labelChildren.map((child) => (
                            <button
                              key={child.path}
                              onClick={() => selectWork(child.path, child.name)}
                              className="w-full flex items-center gap-2 px-2.5 py-1 rounded-lg text-left hover:bg-bg-tertiary transition-colors"
                            >
                              <svg className="w-4 h-4 text-text-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                              </svg>
                              <span className="text-[11px] text-text-primary truncate">{child.name}</span>
                              <span className="ml-auto text-[9px] text-accent">選択</span>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="px-3 py-2 border-t border-border">
              {showNewWork ? (
                <div className="flex items-center gap-2">
                  {expandedLabel && (
                    <span className="text-[9px] text-text-muted flex-shrink-0">
                      {expandedLabel.name} /
                    </span>
                  )}
                  <input
                    type="text"
                    value={newWorkTitle}
                    onChange={(e) => setNewWorkTitle(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleNewWork(); }}
                    placeholder="作品名を入力..."
                    className="flex-1 px-2 py-1 text-xs bg-bg-tertiary border border-border/50 rounded text-text-primary placeholder:text-text-muted/40 focus:outline-none focus:border-accent/50"
                    autoFocus
                  />
                  <button
                    onClick={handleNewWork}
                    disabled={!newWorkTitle.trim() || !expandedLabel}
                    className="px-3 py-1 text-[10px] font-medium text-white bg-accent rounded hover:bg-accent-secondary disabled:opacity-40 transition-colors"
                  >
                    登録
                  </button>
                  <button
                    onClick={() => { setShowNewWork(false); setNewWorkTitle(""); }}
                    className="text-[10px] text-text-muted hover:text-text-primary transition-colors"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowNewWork(true)}
                  disabled={!expandedLabel}
                  className="w-full py-1.5 text-[10px] font-medium text-accent bg-accent/10 rounded-lg hover:bg-accent/20 disabled:opacity-40 transition-colors"
                >
                  新規作品を登録
                </button>
              )}
            </div>
          </>
        )}

        {/* ── Phase: Volume ── */}
        {phase === "volume" && (
          <div className="p-4 space-y-4">
            <div className="space-y-2">
              <div className="text-[10px] text-text-muted">保存先</div>
              <div className="px-3 py-2 bg-bg-tertiary rounded-lg">
                <span className="text-[10px] text-accent">{selectedLabel}</span>
                <span className="text-[10px] text-text-muted mx-1">/</span>
                <span className="text-[11px] text-text-primary font-medium">{selectedWork}</span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] text-text-muted">巻数</label>
              <input
                type="number"
                min={1}
                value={volume}
                onChange={(e) => setVolume(parseInt(e.target.value, 10) || 1)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
                className="w-24 px-2 py-1.5 text-xs bg-bg-tertiary border border-border/50 rounded text-text-primary focus:outline-none focus:border-accent/50"
                autoFocus
              />
            </div>

            <div className="text-[10px] text-text-muted">
              チェック済み項目: <span className="text-text-primary font-medium">{items.filter((it) => it.picked).length}件</span>
              <span className="mx-1">/</span>
              全{items.length}件
            </div>

            {saveError && (
              <div className="text-[10px] text-error">{saveError}</div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setPhase("folder")}
                className="px-4 py-1.5 text-[10px] text-text-muted hover:text-text-primary transition-colors"
              >
                ← 戻る
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 py-1.5 text-xs font-medium text-white bg-accent rounded-lg hover:bg-accent-secondary disabled:opacity-40 transition-colors"
              >
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        )}

        {/* ── Phase: Success ── */}
        {phase === "success" && (
          <div className="p-6 text-center space-y-4">
            <div className="w-12 h-12 mx-auto rounded-full bg-emerald-500/15 flex items-center justify-center">
              <svg className="w-6 h-6 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-xs text-text-primary font-medium">校正データを保存しました</p>
            <p className="text-[10px] text-text-muted break-all">{savedFilePath}</p>
            <button
              onClick={onClose}
              className="px-6 py-1.5 text-xs font-medium text-white bg-accent rounded-lg hover:bg-accent-secondary transition-colors"
            >
              閉じる
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
