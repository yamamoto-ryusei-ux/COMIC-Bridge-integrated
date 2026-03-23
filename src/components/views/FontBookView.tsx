import { useState, useEffect, useMemo, useCallback, useRef, type DragEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useFontBookStore } from "../../store/fontBookStore";
import { useScanPsdStore } from "../../store/scanPsdStore";
import { SUB_NAME_PALETTE, FONT_SUB_NAME_MAP } from "../../types/scanPsd";
import type { FontPreset, PresetJsonData } from "../../types/scanPsd";
import type { FontBookEntry } from "../../types/fontBook";
import { JsonFileBrowser } from "../scanPsd/JsonFileBrowser";
import { performPresetJsonSave } from "../../hooks/useScanPsdProcessor";

// カテゴリ一覧（FONT_SUB_NAME_MAPから重複排除）
const ALL_SUB_NAMES: string[] = [];
const _seen: Record<string, boolean> = {};
FONT_SUB_NAME_MAP.forEach((entry) => {
  if (!_seen[entry.subName]) {
    _seen[entry.subName] = true;
    ALL_SUB_NAMES.push(entry.subName);
  }
});

type PreviewSize = "S" | "M" | "L";

interface FontBookViewProps {
  onNavigateToViewer?: (fontPostScript: string) => void;
}

export function FontBookView({ onNavigateToViewer }: FontBookViewProps = {}) {
  const entries = useFontBookStore((s) => s.entries);
  const fontBookDir = useFontBookStore((s) => s.fontBookDir);
  const isLoaded = useFontBookStore((s) => s.isLoaded);
  const removeEntry = useFontBookStore((s) => s.removeEntry);
  const updateEntry = useFontBookStore((s) => s.updateEntry);
  const reorderEntries = useFontBookStore((s) => s.reorderEntries);
  const loadFontBook = useFontBookStore((s) => s.loadFontBook);

  const currentJsonFilePath = useScanPsdStore((s) => s.currentJsonFilePath);
  const presetSets = useScanPsdStore((s) => s.presetSets);
  const currentSetName = useScanPsdStore((s) => s.currentSetName);
  const workInfo = useScanPsdStore((s) => s.workInfo);
  const textLogFolderPath = useScanPsdStore((s) => s.textLogFolderPath);
  const jsonFolderPath = useScanPsdStore((s) => s.jsonFolderPath);

  const [showJsonBrowser, setShowJsonBrowser] = useState(false);
  const [expandedImage, setExpandedImage] = useState<string | null>(null);
  const [filterSubName, setFilterSubName] = useState<string | null>(null);
  const [activeFontKey, setActiveFontKey] = useState<string | null>(null);
  const [previewSize, setPreviewSize] = useState<PreviewSize>("M");
  const [editingCategoryFont, setEditingCategoryFont] = useState<string | null>(null);
  const [categoryEditValue, setCategoryEditValue] = useState("");
  const [hideEmpty, setHideEmpty] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteEditValue, setNoteEditValue] = useState("");
  const [dragEntryId, setDragEntryId] = useState<string | null>(null);
  const [dragOverEntryId, setDragOverEntryId] = useState<string | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // プレビューサイズ設定
  const sizeConfig = useMemo(() => {
    switch (previewSize) {
      case "S":
        return { minWidth: "380px", cols: 2 };
      case "M":
        return { minWidth: "520px", cols: 2 };
      case "L":
        return { minWidth: "700px", cols: 2 };
    }
  }, [previewSize]);

  // fontCategoryMap: PostScript名 → { index, subName }
  const fontCategoryMap = useMemo(() => {
    const map = new Map<string, { index: number; subName: string }>();
    const presets = presetSets[currentSetName];
    if (!presets) return map;
    for (let i = 0; i < presets.length; i++) {
      const p = presets[i];
      if (p.font) map.set(p.font, { index: i, subName: p.subName || "" });
    }
    return map;
  }, [presetSets, currentSetName]);

  // カテゴリ編集
  const startCategoryEdit = useCallback(
    (fontKey: string) => {
      const entry = fontCategoryMap.get(fontKey);
      setEditingCategoryFont(fontKey);
      setCategoryEditValue(entry?.subName || "");
    },
    [fontCategoryMap],
  );

  const saveCategoryEdit = useCallback(async () => {
    if (!editingCategoryFont) return;
    const entry = fontCategoryMap.get(editingCategoryFont);
    if (!entry) {
      setEditingCategoryFont(null);
      return;
    }
    useScanPsdStore
      .getState()
      .updateFontInPreset(currentSetName, entry.index, { subName: categoryEditValue });
    setEditingCategoryFont(null);
    try {
      await performPresetJsonSave();
    } catch {
      /* ignore */
    }
  }, [editingCategoryFont, fontCategoryMap, currentSetName, categoryEditValue]);

  const cancelCategoryEdit = useCallback(() => {
    setEditingCategoryFont(null);
  }, []);

  // ノート編集
  const startNoteEdit = useCallback(
    (entryId: string) => {
      const entry = entries.find((e) => e.id === entryId);
      setEditingNoteId(entryId);
      setNoteEditValue(entry?.note || "");
    },
    [entries],
  );

  const saveNoteEdit = useCallback(async () => {
    if (!editingNoteId) return;
    await updateEntry(editingNoteId, { note: noteEditValue.trim() || undefined });
    setEditingNoteId(null);
  }, [editingNoteId, noteEditValue, updateEntry]);

  // ドラッグ並べ替え
  const handleDragStart = useCallback((e: DragEvent, entryId: string) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", entryId);
    setDragEntryId(entryId);
  }, []);

  const handleDragOver = useCallback((e: DragEvent, entryId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverEntryId(entryId);
  }, []);

  const handleDrop = useCallback(
    async (e: DragEvent, targetEntryId: string, groupEntries: FontBookEntry[]) => {
      e.preventDefault();
      const sourceId = e.dataTransfer.getData("text/plain");
      if (!sourceId || sourceId === targetEntryId) {
        setDragEntryId(null);
        setDragOverEntryId(null);
        return;
      }
      // グループ内のエントリIDリストを並べ替え
      const ids = groupEntries.map((ent) => ent.id);
      const srcIdx = ids.indexOf(sourceId);
      const tgtIdx = ids.indexOf(targetEntryId);
      if (srcIdx === -1 || tgtIdx === -1) return;
      ids.splice(srcIdx, 1);
      ids.splice(tgtIdx, 0, sourceId);
      // 全エントリのID順を再構築（このグループ分だけ並べ替え）
      const groupIdSet = new Set(groupEntries.map((ent) => ent.id));
      // グループ内エントリの元の最初の出現位置を保持
      const firstGroupIdx = entries.findIndex((ent) => groupIdSet.has(ent.id));
      const allIds = [...entries.map((ent) => ent.id)];
      // グループ分を除去してから挿入
      const withoutGroup = allIds.filter((id) => !groupIdSet.has(id));
      withoutGroup.splice(firstGroupIdx, 0, ...ids);
      await reorderEntries(withoutGroup);
      setDragEntryId(null);
      setDragOverEntryId(null);
    },
    [entries, reorderEntries],
  );

  const handleDragEnd = useCallback(() => {
    setDragEntryId(null);
    setDragOverEntryId(null);
  }, []);

  // JSON読み込み時にフォント帳も読み込む
  useEffect(() => {
    if (currentJsonFilePath && workInfo.label && workInfo.title) {
      loadFontBook(textLogFolderPath, workInfo.label, workInfo.title);
    }
  }, [currentJsonFilePath, workInfo.label, workInfo.title, textLogFolderPath, loadFontBook]);

  // フォントプリセット
  const fonts: FontPreset[] = useMemo(
    () => presetSets[currentSetName] || [],
    [presetSets, currentSetName],
  );

  // フォントごとにエントリをグループ化
  const groupedByFont = useMemo(() => {
    const map = new Map<string, { font: FontPreset; entries: FontBookEntry[] }>();
    // まず全フォントを登録（スクショなしでも表示）
    for (const f of fonts) {
      if (!map.has(f.font)) {
        map.set(f.font, { font: f, entries: [] });
      }
    }
    // エントリを紐づけ
    for (const e of entries) {
      const group = map.get(e.fontPostScript);
      if (group) {
        group.entries.push(e);
      } else {
        // JSON側に無いフォント（削除済み等）
        map.set(e.fontPostScript, {
          font: { name: e.fontDisplayName, subName: e.subName, font: e.fontPostScript },
          entries: [e],
        });
      }
    }
    return map;
  }, [fonts, entries]);

  // カテゴリフィルタ + スクショなし非表示
  const filteredGroups = useMemo(() => {
    let groups = Array.from(groupedByFont.values());
    if (filterSubName) groups = groups.filter((g) => g.font.subName === filterSubName);
    if (hideEmpty) groups = groups.filter((g) => g.entries.length > 0);
    return groups;
  }, [groupedByFont, filterSubName, hideEmpty]);

  // 存在するカテゴリ一覧
  const existingSubNames = useMemo(() => {
    const set = new Set<string>();
    for (const g of groupedByFont.values()) {
      if (g.font.subName) set.add(g.font.subName);
    }
    return Array.from(set);
  }, [groupedByFont]);

  // JSON選択ハンドラ
  const handleJsonSelect = useCallback(async (filePath: string) => {
    setShowJsonBrowser(false);
    try {
      const content = await invoke<string>("read_text_file", { filePath });
      const data = JSON.parse(content) as PresetJsonData;
      const store = useScanPsdStore.getState();
      store.loadFromPresetJson(data);
      store.setCurrentJsonFilePath(filePath);
    } catch (e) {
      console.error("Failed to load JSON:", e);
    }
  }, []);

  const handleRemoveEntry = useCallback(
    async (id: string) => {
      await removeEntry(id);
    },
    [removeEntry],
  );

  // 画像URL取得
  const getImageUrl = useCallback(
    (entryId: string) => {
      if (!fontBookDir) return "";
      return convertFileSrc(`${fontBookDir}/${entryId}.jpg`);
    },
    [fontBookDir],
  );

  // フォントにスクロール
  const scrollToFont = useCallback((fontKey: string) => {
    setActiveFontKey(fontKey);
    const el = document.getElementById(`fontbook-${fontKey}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  // JSON未読込
  if (!currentJsonFilePath) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="text-center space-y-2">
          <svg
            className="w-12 h-12 mx-auto text-text-muted/30"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
            />
          </svg>
          <p className="text-sm text-text-muted">作品のJSONを読み込んでください</p>
          <p className="text-[10px] text-text-muted/60">
            DTPビューアーでスクショを撮ってフォントと紐づけられます
          </p>
        </div>
        <button
          className="px-4 py-2 text-xs font-medium text-white bg-gradient-to-r from-accent to-accent-secondary rounded-xl hover:-translate-y-0.5 transition-all shadow-sm"
          onClick={() => setShowJsonBrowser(true)}
        >
          JSON読み込み
        </button>

        {showJsonBrowser && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setShowJsonBrowser(false);
            }}
          >
            <div className="w-[420px]" onMouseDown={(e) => e.stopPropagation()}>
              <JsonFileBrowser
                basePath={jsonFolderPath}
                onSelect={handleJsonSelect}
                onCancel={() => setShowJsonBrowser(false)}
                mode="open"
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-sm font-display font-bold text-text-primary">
              {workInfo.title || "無題"}
            </h2>
            <div className="flex items-center gap-2 mt-0.5">
              {workInfo.label && (
                <span className="text-[10px] text-text-muted">{workInfo.label}</span>
              )}
              <span className="text-[10px] text-text-muted">
                {fonts.length} フォント / {entries.length} スクショ
              </span>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {/* Preview size toggle */}
            <div className="flex items-center gap-1.5">
              <svg
                className="w-3 h-3 text-text-muted"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z"
                />
              </svg>
              <div className="flex items-center bg-bg-tertiary rounded-lg p-0.5">
                {(["S", "M", "L"] as PreviewSize[]).map((size) => (
                  <button
                    key={size}
                    className={`text-[9px] px-2 py-0.5 rounded-md transition-all ${
                      previewSize === size
                        ? "bg-white text-text-primary shadow-sm font-medium"
                        : "text-text-muted hover:text-text-secondary"
                    }`}
                    onClick={() => setPreviewSize(size)}
                    title={`プレビューサイズ: ${size === "S" ? "小" : size === "M" ? "中" : "大"}`}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
            {/* スクショなしフォント非表示トグル */}
            <button
              className={`text-[10px] px-2 py-1 rounded-lg transition-colors flex items-center gap-1 ${
                hideEmpty
                  ? "bg-accent/10 text-accent"
                  : "text-text-muted hover:text-text-secondary hover:bg-bg-tertiary"
              }`}
              onClick={() => setHideEmpty(!hideEmpty)}
              title={hideEmpty ? "すべてのフォントを表示" : "スクショなしを非表示"}
            >
              <svg
                className="w-3 h-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                {hideEmpty ? (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"
                  />
                ) : (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178zM15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                )}
              </svg>
              {hideEmpty ? "非表示中" : "空を隠す"}
            </button>
            {fontBookDir && (
              <button
                className="text-[10px] px-2 py-1 rounded-lg text-text-muted hover:text-text-secondary hover:bg-bg-tertiary transition-colors flex items-center gap-1"
                onClick={() => invoke("open_folder_in_explorer", { folderPath: fontBookDir })}
                title={`保存先を開く: ${fontBookDir}`}
              >
                <svg
                  className="w-3 h-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
                  />
                </svg>
                保存先
              </button>
            )}
            <button
              className="text-[10px] px-2 py-1 rounded-lg text-text-muted hover:text-text-secondary hover:bg-bg-tertiary transition-colors"
              onClick={() => setShowJsonBrowser(true)}
            >
              別の作品を開く
            </button>
          </div>
        </div>

        {/* Category filter */}
        {existingSubNames.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            <button
              className={`text-[9px] px-2 py-0.5 rounded-full transition-all ${
                !filterSubName
                  ? "bg-text-primary/10 text-text-primary font-medium"
                  : "text-text-muted hover:text-text-secondary hover:bg-bg-tertiary"
              }`}
              onClick={() => setFilterSubName(null)}
            >
              すべて
            </button>
            {existingSubNames.map((name) => {
              const palette = SUB_NAME_PALETTE[name];
              const isActive = filterSubName === name;
              return (
                <button
                  key={name}
                  className="text-[9px] px-2 py-0.5 rounded-full transition-all"
                  style={{
                    color: palette?.color || "#888",
                    backgroundColor: isActive
                      ? palette?.bg || "rgba(255,255,255,0.1)"
                      : "transparent",
                    border: isActive
                      ? `1px solid ${palette?.border || "#444"}`
                      : "1px solid transparent",
                  }}
                  onClick={() => setFilterSubName(isActive ? null : name)}
                >
                  {name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Main content: sidebar + cards */}
      <div className="flex-1 flex overflow-hidden">
        {/* Font sidebar */}
        <div className="w-[200px] flex-shrink-0 border-r border-border overflow-y-auto select-none">
          <div className="py-1">
            {filteredGroups.map((group) => {
              const palette = group.font.subName ? SUB_NAME_PALETTE[group.font.subName] : undefined;
              const isActive = activeFontKey === group.font.font;
              const hasScreenshots = group.entries.length > 0;
              return (
                <button
                  key={group.font.font}
                  className={`w-full text-left px-3 py-1 flex items-center gap-1.5 transition-colors text-[10px] ${
                    isActive
                      ? "bg-accent/10 text-text-primary"
                      : "text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
                  }`}
                  onClick={() => scrollToFont(group.font.font)}
                >
                  <span className="truncate flex-1" style={{ opacity: hasScreenshots ? 1 : 0.5 }}>
                    {group.font.name}
                  </span>
                  {group.font.subName && (
                    <span
                      className="text-[7px] px-1 rounded flex-shrink-0 cursor-pointer hover:ring-1 hover:ring-accent/30"
                      style={{
                        color: palette?.color || "#888",
                        backgroundColor: palette?.bg || "rgba(255,255,255,0.05)",
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        startCategoryEdit(group.font.font);
                      }}
                      title="カテゴリを編集"
                    >
                      {group.font.subName}
                    </span>
                  )}
                  {!group.font.subName && (
                    <span
                      className="text-[7px] px-1 rounded flex-shrink-0 text-text-muted/30 cursor-pointer hover:text-text-muted/60 hover:bg-bg-tertiary"
                      onClick={(e) => {
                        e.stopPropagation();
                        startCategoryEdit(group.font.font);
                      }}
                      title="カテゴリを設定"
                    >
                      +
                    </span>
                  )}
                  {hasScreenshots && (
                    <span className="text-[8px] text-text-muted flex-shrink-0">
                      {group.entries.length}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Font card grid */}
        <div className="flex-1 overflow-y-auto p-3" ref={scrollContainerRef}>
          {!isLoaded ? (
            <div className="flex items-center justify-center h-full">
              <div className="w-6 h-6 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
            </div>
          ) : (
            <div
              className="grid gap-3"
              style={{
                gridTemplateColumns: `repeat(auto-fill, minmax(${sizeConfig.minWidth}, 1fr))`,
              }}
            >
              {filteredGroups.map((group) => {
                const palette = group.font.subName
                  ? SUB_NAME_PALETTE[group.font.subName]
                  : undefined;
                return (
                  <div
                    key={group.font.font}
                    id={`fontbook-${group.font.font}`}
                    className={`bg-bg-secondary border rounded-lg overflow-hidden flex flex-col ${
                      activeFontKey === group.font.font
                        ? "border-accent/40 shadow-sm"
                        : "border-border"
                    }`}
                  >
                    {/* Font header */}
                    <div className="px-2.5 py-1.5 border-b border-border/50 flex items-center gap-1.5 flex-shrink-0">
                      <span
                        className={`text-[11px] font-medium text-text-primary truncate ${
                          onNavigateToViewer
                            ? "cursor-pointer hover:text-accent transition-colors"
                            : ""
                        }`}
                        onClick={() => onNavigateToViewer?.(group.font.font)}
                        title={onNavigateToViewer ? "DTPビューアーでこのフォントを表示" : undefined}
                      >
                        {group.font.name}
                      </span>
                      {editingCategoryFont === group.font.font ? (
                        <div
                          className="flex items-center gap-1 flex-shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            list="fontbook-subname-list"
                            className="text-[9px] w-24 px-1.5 py-0.5 rounded border border-accent/40 bg-bg-primary text-text-primary outline-none focus:border-accent"
                            value={categoryEditValue}
                            onChange={(e) => setCategoryEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveCategoryEdit();
                              if (e.key === "Escape") cancelCategoryEdit();
                            }}
                            autoFocus
                            placeholder="カテゴリ名"
                          />
                          <button
                            className="text-[9px] px-1 py-0.5 rounded bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
                            onClick={saveCategoryEdit}
                          >
                            OK
                          </button>
                          <button
                            className="text-[9px] px-1 py-0.5 rounded text-text-muted hover:bg-bg-tertiary transition-colors"
                            onClick={cancelCategoryEdit}
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <>
                          {group.font.subName ? (
                            <span
                              className="text-[8px] px-1 py-0.5 rounded flex-shrink-0 cursor-pointer hover:ring-1 hover:ring-accent/30 transition-all"
                              style={{
                                color: palette?.color || "#888",
                                backgroundColor: palette?.bg || "rgba(255,255,255,0.05)",
                              }}
                              onClick={() => startCategoryEdit(group.font.font)}
                              title="カテゴリを編集"
                            >
                              {group.font.subName}
                            </span>
                          ) : (
                            <span
                              className="text-[8px] px-1 py-0.5 rounded flex-shrink-0 text-text-muted/40 cursor-pointer hover:text-text-muted/70 hover:bg-bg-tertiary transition-all"
                              onClick={() => startCategoryEdit(group.font.font)}
                              title="カテゴリを設定"
                            >
                              + カテゴリ
                            </span>
                          )}
                        </>
                      )}
                      <span className="text-[8px] text-text-muted ml-auto flex-shrink-0">
                        {group.entries.length > 0 ? `${group.entries.length}` : "0"}
                      </span>
                    </div>

                    {/* Screenshots */}
                    {group.entries.length > 0 ? (
                      <div
                        className={`p-1.5 grid gap-1.5 flex-1 ${previewSize === "S" ? "grid-cols-3" : "grid-cols-2"}`}
                      >
                        {group.entries.map((entry) => (
                          <div
                            key={entry.id}
                            className={`group rounded overflow-hidden border bg-bg-primary hover:shadow-sm transition-all ${
                              dragOverEntryId === entry.id && dragEntryId !== entry.id
                                ? "border-accent ring-1 ring-accent/30"
                                : dragEntryId === entry.id
                                  ? "opacity-40 border-border/20"
                                  : "border-border/20 hover:border-border"
                            }`}
                            draggable
                            onDragStart={(e) => handleDragStart(e, entry.id)}
                            onDragOver={(e) => handleDragOver(e, entry.id)}
                            onDrop={(e) => handleDrop(e, entry.id, group.entries)}
                            onDragEnd={handleDragEnd}
                            onDragLeave={() => setDragOverEntryId(null)}
                          >
                            {/* Image area */}
                            <div
                              className="relative cursor-pointer"
                              onClick={() => setExpandedImage(entry.id)}
                            >
                              <img
                                src={getImageUrl(entry.id)}
                                alt={entry.fontDisplayName}
                                className="w-full h-auto object-contain bg-white cursor-grab active:cursor-grabbing"
                                loading="lazy"
                                draggable={false}
                              />
                              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                              <div className="absolute bottom-0 left-0 right-0 p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <p className="text-[7px] text-white/80 truncate">
                                  {entry.sourceFile}
                                </p>
                              </div>
                              {/* Delete button */}
                              <button
                                className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/50 hover:bg-error/80 flex items-center justify-center text-white/60 hover:text-white opacity-0 group-hover:opacity-100 transition-all"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRemoveEntry(entry.id);
                                }}
                                title="削除"
                              >
                                <svg
                                  className="w-2.5 h-2.5"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                  strokeWidth={2.5}
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M6 18L18 6M6 6l12 12"
                                  />
                                </svg>
                              </button>
                            </div>
                            {/* Note area - inline editable */}
                            {editingNoteId === entry.id ? (
                              <div className="px-2 py-1.5 border-t border-accent/30 bg-bg-tertiary">
                                <input
                                  type="text"
                                  className="w-full text-base px-2 py-1 rounded border border-accent/30 bg-bg-primary text-text-primary outline-none focus:border-accent"
                                  value={noteEditValue}
                                  onChange={(e) => setNoteEditValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") saveNoteEdit();
                                    if (e.key === "Escape") setEditingNoteId(null);
                                  }}
                                  onBlur={saveNoteEdit}
                                  autoFocus
                                  placeholder="メモを入力..."
                                />
                              </div>
                            ) : (
                              <div
                                className={`px-2 py-1.5 border-t border-border/30 cursor-text min-h-[32px] transition-colors ${
                                  entry.note
                                    ? "text-base text-text-secondary hover:bg-bg-tertiary"
                                    : "text-base text-text-muted/30 hover:text-text-muted/50 hover:bg-bg-tertiary"
                                }`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  startNoteEdit(entry.id);
                                }}
                              >
                                {entry.note || "メモを追加..."}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="py-3 text-center text-[9px] text-text-muted/40">
                        スクショなし
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Expanded image modal */}
      {expandedImage && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setExpandedImage(null)}
        >
          <div className="max-w-[80vw] max-h-[80vh] relative" onClick={(e) => e.stopPropagation()}>
            <img
              src={getImageUrl(expandedImage)}
              alt=""
              className="max-w-full max-h-[80vh] object-contain rounded-xl shadow-2xl bg-white"
            />
            <button
              className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-bg-secondary border border-border shadow-lg flex items-center justify-center text-text-muted hover:text-text-primary transition-colors"
              onClick={() => setExpandedImage(null)}
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            {/* Entry info */}
            {(() => {
              const entry = entries.find((e) => e.id === expandedImage);
              if (!entry) return null;
              const palette = entry.subName ? SUB_NAME_PALETTE[entry.subName] : undefined;
              return (
                <div className="absolute bottom-0 left-0 right-0 px-4 py-3 bg-gradient-to-t from-black/80 to-transparent rounded-b-xl">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-white">{entry.fontDisplayName}</span>
                    {entry.subName && (
                      <span
                        className="text-[9px] px-1.5 py-0.5 rounded"
                        style={{
                          color: palette?.color || "#ccc",
                          backgroundColor: `${palette?.color || "#888"}20`,
                        }}
                      >
                        {entry.subName}
                      </span>
                    )}
                  </div>
                  <p className="text-[9px] text-white/60 mt-0.5">{entry.sourceFile}</p>
                  {entry.note && (
                    <p className="text-[9px] text-white/50 mt-0.5 italic">{entry.note}</p>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Category datalist: 定義済み + プリセット内カスタムカテゴリ */}
      <datalist id="fontbook-subname-list">
        {ALL_SUB_NAMES.map((sn) => (
          <option key={sn} value={sn} />
        ))}
        {existingSubNames
          .filter((sn) => !_seen[sn])
          .map((sn) => (
            <option key={`custom-${sn}`} value={sn} />
          ))}
      </datalist>

      {/* JSON file browser modal */}
      {showJsonBrowser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowJsonBrowser(false);
          }}
        >
          <div className="w-[420px]" onMouseDown={(e) => e.stopPropagation()}>
            <JsonFileBrowser
              basePath={jsonFolderPath}
              onSelect={handleJsonSelect}
              onCancel={() => setShowJsonBrowser(false)}
              mode="open"
            />
          </div>
        </div>
      )}
    </div>
  );
}
