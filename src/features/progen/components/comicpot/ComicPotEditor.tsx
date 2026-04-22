/**
 * ComicPotEditor - COMIC-POT エディタ メインコンポーネント
 *
 * テキスト編集（textarea）とチャンク選択（select mode）を切り替えながら
 * COMIC-POT形式テキストを編集する。ルビ付与・形式変換モーダルを内蔵。
 */
import { useState, useEffect, useCallback, useRef } from "react";
import {
  useComicPotState,
  cpFormatRuby,
  cpFormatRubyPlaceholder,
  cpParseTextToChunks,
  type CpRubyMode,
} from "../../useComicPotState";
import { useUnifiedViewerStore } from "../../../../store/unifiedViewerStore";

// ═══ ヘルパー ═══

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** チャンクコンテンツ内の [text](ruby) パターンをハイライト表示用HTMLに変換 */
function renderChunkHtml(content: string): string {
  const escaped = escapeHtml(content);
  return escaped.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<span class="text-accent">$1</span><span class="text-text-muted text-[9px]">($2)</span>',
  );
}

// ═══ Props ═══

interface Props {
  onBack: () => void;
}

// ═══ メインコンポーネント ═══

export default function ComicPotEditor({ onBack }: Props) {
  const {
    state,
    textareaRef,
    isDirty,
    setText,
    selectChunk,
    toggleEditMode,
    moveChunkUp,
    moveChunkDown,
    deleteChunk,
    toggleDeleteMark,
    undo,
    redo,
    applyRuby,
    applyConvert,
    setDrag,
    dropChunk,
    togglePanel,
    setPanelTab,
    setPanelWidth,
    handleSave,
    handleSaveAs,
    handleCopy,
  } = useComicPotState();

  // ── モーダル状態 ──
  const [showRubyModal, setShowRubyModal] = useState(false);
  const [rubySelection, setRubySelection] = useState({ start: 0, end: 0, text: "" });
  const [showConvertModal, setShowConvertModal] = useState(false);

  // ── ルビモーダル入力 ──
  const [rubyInput, setRubyInput] = useState("");
  const [rubyModalMode, setRubyModalMode] = useState<CpRubyMode>(state.rubyMode);

  // ── 変換モーダル入力 ──
  const [convertSort, setConvertSort] = useState<"bottomToTop" | "topToBottom">("bottomToTop");
  const [convertVolume, setConvertVolume] = useState("1");
  const [convertStartPage, setConvertStartPage] = useState("1");

  // ── Shiftキーでモード切替 ──
  const shiftPressedRef = useRef(false);
  const otherKeyPressedRef = useRef(false);

  // ── パネルリサイズ ──
  const resizingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── 統合ビューアーからテキスト受け取り ──
  const textContent = useUnifiedViewerStore((s) => s.textContent);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!mountedRef.current && textContent) {
      setText(textContent);
      mountedRef.current = true;
    }
  }, [textContent, setText]);

  // ═══ キーボードイベント ═══

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Shift追跡
      if (e.key === "Shift") {
        shiftPressedRef.current = true;
        otherKeyPressedRef.current = false;
        return;
      }
      if (shiftPressedRef.current) {
        otherKeyPressedRef.current = true;
      }

      // モーダルが開いている間はショートカット無効
      if (showRubyModal || showConvertModal) return;

      // Ctrl系ショートカット
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "s" && e.shiftKey) {
          e.preventDefault();
          handleSaveAs();
        } else if (e.key === "s") {
          e.preventDefault();
          handleSave();
        } else if (e.key === "z" && e.shiftKey) {
          e.preventDefault();
          redo();
        } else if (e.key === "z") {
          e.preventDefault();
          undo();
        }
        return;
      }

      // 選択モードのみ
      if (!state.isEditing) {
        if (e.key === "ArrowUp" && e.shiftKey) {
          e.preventDefault();
          moveChunkUp();
        } else if (e.key === "ArrowDown" && e.shiftKey) {
          e.preventDefault();
          moveChunkDown();
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          navigateChunk(-1);
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          navigateChunk(1);
        } else if (e.key === "Delete") {
          e.preventDefault();
          toggleDeleteMark();
        } else if (e.key === "Backspace") {
          e.preventDefault();
          deleteChunk();
        }
      }
    },
    [
      state.isEditing,
      showRubyModal,
      showConvertModal,
      handleSave,
      handleSaveAs,
      undo,
      redo,
      moveChunkUp,
      moveChunkDown,
      toggleDeleteMark,
      deleteChunk,
    ],
  );

  const handleKeyUp = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Shift") {
        if (shiftPressedRef.current && !otherKeyPressedRef.current) {
          // Shift単押し: モード切替
          if (!showRubyModal && !showConvertModal) {
            toggleEditMode();
          }
        }
        shiftPressedRef.current = false;
        otherKeyPressedRef.current = false;
      }
    },
    [toggleEditMode, showRubyModal, showConvertModal],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);

  // ═══ チャンクナビゲーション ═══

  const navigateChunk = useCallback(
    (dir: 1 | -1) => {
      const dialogueIndices = state.chunks
        .map((c, i) => (c.type === "dialogue" ? i : -1))
        .filter((i) => i >= 0);
      if (dialogueIndices.length === 0) return;

      if (state.selectedChunkIndex === null) {
        selectChunk(dialogueIndices[dir === 1 ? 0 : dialogueIndices.length - 1]);
        return;
      }

      const curPos = dialogueIndices.indexOf(state.selectedChunkIndex);
      if (curPos < 0) {
        selectChunk(dialogueIndices[0]);
        return;
      }

      const nextPos = curPos + dir;
      if (nextPos >= 0 && nextPos < dialogueIndices.length) {
        selectChunk(dialogueIndices[nextPos]);
      }
    },
    [state.chunks, state.selectedChunkIndex, selectChunk],
  );

  // ═══ ルビ操作 ═══

  const handleOpenRuby = useCallback(() => {
    if (state.isEditing && textareaRef.current) {
      const ta = textareaRef.current;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      if (start === end) return;

      const selectedText = state.text.substring(start, end);
      // 改行を含む場合は無効
      if (selectedText.includes("\n")) return;

      setRubySelection({ start, end, text: selectedText });
      setRubyInput("");
      setRubyModalMode(state.rubyMode);
      setShowRubyModal(true);
    }
  }, [state.isEditing, state.text, state.rubyMode, textareaRef]);

  const handleApplyRuby = useCallback(() => {
    if (!rubyInput.trim()) return;
    const replacement = cpFormatRuby(rubySelection.text, rubyInput.trim(), rubyModalMode);
    applyRuby(rubySelection.start, rubySelection.end, replacement);
    setShowRubyModal(false);
  }, [rubySelection, rubyInput, rubyModalMode, applyRuby]);

  // ═══ 変換操作 ═══

  const handleOpenConvert = useCallback(() => {
    setConvertSort("bottomToTop");
    setConvertVolume("1");
    setConvertStartPage("1");
    setShowConvertModal(true);
  }, []);

  const convertPreviewText = useCallback(() => {
    const header = `[COMIC-POT:${convertSort}]`;
    const vol = parseInt(convertVolume) || 1;
    const startPage = parseInt(convertStartPage) || 1;
    const chunks = state.chunks.map((c) => {
      if (c.type === "separator") return c;
      return c;
    });

    // ヘッダー + 巻 + ページ区切り付きプレビュー
    let preview = header + "\n\n";
    preview += `[${String(vol).padStart(2, "0")}巻]\n`;
    preview += `<<${startPage}Page>>\n`;
    for (const chunk of chunks) {
      preview += chunk.content + "\n\n";
    }
    return preview.trim();
  }, [convertSort, convertVolume, convertStartPage, state.chunks]);

  const handleApplyConvert = useCallback(() => {
    const header = `[COMIC-POT:${convertSort}]`;
    const parsed = cpParseTextToChunks(convertPreviewText());
    applyConvert(header, parsed);
    setShowConvertModal(false);
  }, [convertSort, convertPreviewText, applyConvert]);

  // ═══ D&D ═══

  const handleDragStart = useCallback(
    (e: React.DragEvent, index: number) => {
      if (state.chunks[index]?.type !== "dialogue") {
        e.preventDefault();
        return;
      }
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(index));
      setDrag(index, null, "before");
    },
    [state.chunks, setDrag],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent, index: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const pos = e.clientY < midY ? "before" : "after";
      setDrag(state.draggedIndex, index, pos);
    },
    [state.draggedIndex, setDrag],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const fromIndex = state.draggedIndex;
      const toIndex = state.dragOverIndex;
      if (fromIndex !== null && toIndex !== null) {
        dropChunk(fromIndex, toIndex, state.dropPosition);
      }
      setDrag(null, null, "before");
    },
    [state.draggedIndex, state.dragOverIndex, state.dropPosition, dropChunk, setDrag],
  );

  const handleDragEnd = useCallback(() => {
    setDrag(null, null, "before");
  }, [setDrag]);

  // ═══ パネルリサイズ ═══

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      resizingRef.current = true;

      const onMouseMove = (ev: MouseEvent) => {
        if (!resizingRef.current || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const percent = ((rect.right - ev.clientX) / rect.width) * 100;
        setPanelWidth(percent);
      };

      const onMouseUp = () => {
        resizingRef.current = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [setPanelWidth],
  );

  // ═══ ファイル名表示 ═══

  const displayFileName = isDirty ? `* ${state.fileName}` : state.fileName;

  // ═══ レンダリング ═══

  return (
    <div className="flex flex-col h-full overflow-hidden" ref={containerRef}>
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border bg-bg-secondary">
        {/* 戻るボタン */}
        <button
          onClick={onBack}
          className="px-2 py-1 text-[9px] rounded transition-colors hover:bg-bg-tertiary text-text-secondary"
        >
          ← 戻る
        </button>

        {/* ファイル名 */}
        <span className="text-[10px] text-text-secondary truncate max-w-[140px]" title={state.fileName}>
          {displayFileName}
        </span>

        {/* モードトグル */}
        <div className="flex items-center border border-border rounded overflow-hidden ml-2">
          <button
            onClick={() => {
              if (state.isEditing) toggleEditMode();
            }}
            className={`px-2 py-1 text-[9px] transition-colors ${
              !state.isEditing ? "bg-accent/10 text-accent font-medium" : "text-text-secondary hover:bg-bg-tertiary"
            }`}
          >
            選択モード
          </button>
          <button
            onClick={() => {
              if (!state.isEditing) toggleEditMode();
            }}
            className={`px-2 py-1 text-[9px] transition-colors ${
              state.isEditing ? "bg-accent/10 text-accent font-medium" : "text-text-secondary hover:bg-bg-tertiary"
            }`}
          >
            編集モード
          </button>
        </div>

        <div className="flex-1" />

        {/* アクションボタン群 */}
        <button
          onClick={() => handleCopy()}
          className="px-2 py-1 text-[9px] rounded transition-colors hover:bg-bg-tertiary text-text-secondary"
        >
          コピー
        </button>
        <button
          onClick={toggleDeleteMark}
          className="px-2 py-1 text-[9px] rounded transition-colors hover:bg-bg-tertiary text-text-secondary"
          disabled={state.isEditing || state.selectedChunkIndex === null}
        >
          削除マーク
        </button>
        <button
          onClick={handleOpenRuby}
          className="px-2 py-1 text-[9px] rounded transition-colors hover:bg-bg-tertiary text-text-secondary"
          disabled={!state.isEditing}
        >
          ルビ
        </button>
        <button
          onClick={handleOpenConvert}
          className="px-2 py-1 text-[9px] rounded transition-colors hover:bg-bg-tertiary text-text-secondary"
        >
          変換
        </button>
        <button
          onClick={() => handleSave()}
          className="px-2 py-1 text-[9px] rounded transition-colors hover:bg-bg-tertiary text-text-secondary"
        >
          保存
        </button>
        <button
          onClick={() => handleSaveAs()}
          className="px-2 py-1 text-[9px] rounded transition-colors hover:bg-bg-tertiary text-text-secondary"
        >
          別名保存
        </button>
        <button
          onClick={togglePanel}
          className={`px-2 py-1 text-[9px] rounded transition-colors ${
            state.resultPanelVisible
              ? "bg-accent/10 text-accent font-medium"
              : "hover:bg-bg-tertiary text-text-secondary"
          }`}
        >
          パネル
        </button>
      </div>

      {/* ── Status bar ── */}
      <div className="px-3 py-1 text-[9px] text-text-muted border-b border-border bg-bg-tertiary/30 flex items-center gap-3">
        <span>チャンク: {state.chunks.filter((c) => c.type === "dialogue").length}</span>
        {state.selectedChunkIndex !== null && <span>選択: #{state.selectedChunkIndex + 1}</span>}
        <span>{state.isEditing ? "編集モード — テキストを直接編集" : "選択モード — ↑↓ナビ / Shift+↑↓移動 / Del削除マーク"}</span>
      </div>

      {/* ── Main content ── */}
      <div className="flex-1 flex overflow-hidden">
        {/* Editor column */}
        <div className="flex-1 overflow-auto">
          {state.isEditing ? (
            /* ── 編集モード: textarea ── */
            <textarea
              ref={textareaRef}
              value={state.text}
              onChange={(e) => setText(e.target.value)}
              className="w-full h-full resize-none bg-transparent text-text-primary text-[11px] font-mono leading-relaxed focus:outline-none p-3"
              spellCheck={false}
            />
          ) : (
            /* ── 選択モード: チャンクリスト ── */
            <div className="p-2 space-y-0.5">
              {state.chunks.map((chunk, index) => {
                const isSelected = state.selectedChunkIndex === index;
                const isDeleteMarked =
                  chunk.type === "dialogue" && chunk.content.split("\n").every((l) => l.trimStart().startsWith("//"));
                const isDragOver = state.dragOverIndex === index && state.draggedIndex !== null;
                const showDropBefore = isDragOver && state.dropPosition === "before";
                const showDropAfter = isDragOver && state.dropPosition === "after";

                return (
                  <div key={index}>
                    {/* ドロップインジケーター (before) */}
                    {showDropBefore && <div className="h-0.5 bg-accent rounded-full my-0.5" />}

                    {chunk.type === "separator" ? (
                      /* セパレータ */
                      <div className="px-3 py-1 text-text-muted italic text-[10px] select-none">{chunk.content}</div>
                    ) : (
                      /* ダイアログチャンク */
                      <div
                        draggable
                        onClick={() => selectChunk(index)}
                        onDragStart={(e) => handleDragStart(e, index)}
                        onDragOver={(e) => handleDragOver(e, index)}
                        onDrop={handleDrop}
                        onDragEnd={handleDragEnd}
                        className={`px-3 py-1.5 rounded-md cursor-pointer transition-colors hover:bg-bg-tertiary text-[11px] leading-relaxed ${
                          isSelected ? "bg-accent/10 border border-accent/30" : ""
                        } ${isDeleteMarked ? "opacity-40 line-through" : ""}`}
                        dangerouslySetInnerHTML={{
                          __html: renderChunkHtml(chunk.content),
                        }}
                      />
                    )}

                    {/* ドロップインジケーター (after) */}
                    {showDropAfter && <div className="h-0.5 bg-accent rounded-full my-0.5" />}
                  </div>
                );
              })}

              {state.chunks.length === 0 && (
                <div className="text-center text-text-muted text-[10px] py-8">テキストがありません</div>
              )}
            </div>
          )}
        </div>

        {/* ── Result Panel ── */}
        {state.resultPanelVisible && (
          <>
            {/* リサイズハンドル */}
            <div
              className="w-1 cursor-col-resize hover:bg-accent/30 transition-colors flex-shrink-0"
              onMouseDown={handleResizeStart}
            />

            {/* パネル本体 */}
            <div
              className="border-l border-border overflow-hidden flex flex-col bg-bg-secondary"
              style={{ width: `${state.panelWidthPercent}%` }}
            >
              {/* タブバー */}
              <div className="flex items-center border-b border-border">
                {(
                  [
                    { key: "simple", label: "提案チェック" },
                    { key: "variation", label: "正誤チェック" },
                    { key: "viewer", label: "ビューアー" },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setPanelTab(tab.key)}
                    className={`px-3 py-1.5 text-[9px] transition-colors ${
                      state.panelTab === tab.key
                        ? "text-accent border-b-2 border-accent font-medium"
                        : "text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* パネル本体 */}
              <div className="flex-1 overflow-auto p-3">
                {state.panelTab === "simple" && (
                  <div className="text-text-muted text-[10px] text-center py-8">提案チェック結果がここに表示されます</div>
                )}
                {state.panelTab === "variation" && (
                  <div className="text-text-muted text-[10px] text-center py-8">正誤チェック結果がここに表示されます</div>
                )}
                {state.panelTab === "viewer" && (
                  <div className="text-text-muted text-[10px] text-center py-8">ビューアーがここに表示されます</div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ═══ ルビモーダル ═══ */}
      {showRubyModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowRubyModal(false)}>
          <div
            className="bg-bg-secondary rounded-lg shadow-lg p-4 w-80 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-medium text-text-primary">ルビ付与</h3>

            {/* 選択テキスト表示 */}
            <div className="text-[11px] text-text-secondary bg-bg-tertiary rounded px-2 py-1.5">
              対象: <span className="text-accent font-medium">{rubySelection.text}</span>
            </div>

            {/* モードトグル */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setRubyModalMode("comicpot")}
                className={`px-2 py-1 text-[9px] rounded transition-colors ${
                  rubyModalMode === "comicpot" ? "bg-accent/10 text-accent font-medium" : "text-text-secondary hover:bg-bg-tertiary"
                }`}
              >
                COMIC-POT形式
              </button>
              <button
                onClick={() => setRubyModalMode("standard")}
                className={`px-2 py-1 text-[9px] rounded transition-colors ${
                  rubyModalMode === "standard" ? "bg-accent/10 text-accent font-medium" : "text-text-secondary hover:bg-bg-tertiary"
                }`}
              >
                標準形式
              </button>
            </div>

            {/* ルビ入力 */}
            <input
              type="text"
              value={rubyInput}
              onChange={(e) => setRubyInput(e.target.value)}
              placeholder="ルビを入力..."
              autoFocus
              className="w-full px-2 py-1.5 text-[11px] rounded border border-border bg-bg-primary text-text-primary focus:outline-none focus:border-accent"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleApplyRuby();
                } else if (e.key === "Escape") {
                  setShowRubyModal(false);
                }
              }}
            />

            {/* プレビュー */}
            <div className="text-[10px] text-text-muted">
              プレビュー:{" "}
              <span className="text-text-primary">
                {rubyInput.trim()
                  ? cpFormatRuby(rubySelection.text, rubyInput.trim(), rubyModalMode)
                  : cpFormatRubyPlaceholder(rubySelection.text, rubyModalMode)}
              </span>
            </div>

            {/* ボタン */}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowRubyModal(false)}
                className="px-3 py-1 text-[10px] rounded transition-colors hover:bg-bg-tertiary text-text-secondary"
              >
                キャンセル
              </button>
              <button
                onClick={handleApplyRuby}
                disabled={!rubyInput.trim()}
                className="px-3 py-1 text-[10px] rounded transition-colors bg-accent/10 text-accent hover:bg-accent/20 disabled:opacity-40"
              >
                適用
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ 変換モーダル ═══ */}
      {showConvertModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowConvertModal(false)}>
          <div
            className="bg-bg-secondary rounded-lg shadow-lg p-4 w-96 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-medium text-text-primary">COMIC-POT形式変換</h3>

            {/* ソートモード */}
            <div className="space-y-1">
              <label className="text-[10px] text-text-secondary">ソート方式</label>
              <select
                value={convertSort}
                onChange={(e) => setConvertSort(e.target.value as "bottomToTop" | "topToBottom")}
                className="w-full px-2 py-1.5 text-[11px] rounded border border-border bg-bg-primary text-text-primary focus:outline-none focus:border-accent"
              >
                <option value="bottomToTop">bottomToTop（下→上）</option>
                <option value="topToBottom">topToBottom（上→下）</option>
              </select>
            </div>

            {/* 巻 */}
            <div className="space-y-1">
              <label className="text-[10px] text-text-secondary">巻</label>
              <input
                type="number"
                value={convertVolume}
                onChange={(e) => setConvertVolume(e.target.value)}
                min={1}
                className="w-full px-2 py-1.5 text-[11px] rounded border border-border bg-bg-primary text-text-primary focus:outline-none focus:border-accent"
              />
            </div>

            {/* 開始ページ */}
            <div className="space-y-1">
              <label className="text-[10px] text-text-secondary">開始ページ</label>
              <input
                type="number"
                value={convertStartPage}
                onChange={(e) => setConvertStartPage(e.target.value)}
                min={1}
                className="w-full px-2 py-1.5 text-[11px] rounded border border-border bg-bg-primary text-text-primary focus:outline-none focus:border-accent"
              />
            </div>

            {/* プレビュー */}
            <div className="space-y-1">
              <label className="text-[10px] text-text-secondary">プレビュー</label>
              <textarea
                readOnly
                value={convertPreviewText()}
                className="w-full h-32 resize-none px-2 py-1.5 text-[10px] font-mono rounded border border-border bg-bg-tertiary/50 text-text-secondary focus:outline-none"
              />
            </div>

            {/* ボタン */}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowConvertModal(false)}
                className="px-3 py-1 text-[10px] rounded transition-colors hover:bg-bg-tertiary text-text-secondary"
              >
                キャンセル
              </button>
              <button
                onClick={handleApplyConvert}
                className="px-3 py-1 text-[10px] rounded transition-colors bg-accent/10 text-accent hover:bg-accent/20"
              >
                適用
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
