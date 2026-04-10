/**
 * ComicPotChunkList — COMIC-POT セレクトモードのチャンクリスト
 * パース済みテキストチャンクを選択・D&Dリオーダー・視覚インジケーター付きで表示
 */
import { useCallback, useRef } from "react";
import type { CpChunk } from "../../../hooks/useComicPotState";

interface Props {
  chunks: CpChunk[];
  selectedIndex: number | null;
  draggedIndex: number | null;
  dragOverIndex: number | null;
  dropPosition: "before" | "after";
  onSelect: (index: number) => void;
  onDragStart: (index: number) => void;
  onDragOver: (index: number, position: "before" | "after") => void;
  onDrop: (index: number) => void;
  onDragEnd: () => void;
}

// ── ヘルパー: チャンク内容をHTML化 ──

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** ルビパターン [text](ruby) をスタイル付きspanに変換し、//行を打ち消し線にする */
function renderChunkContent(content: string): string {
  const lines = content.split("\n");
  const displayLines = lines.slice(0, 3);
  const truncated = lines.length > 3;

  const processed = displayLines.map((line) => {
    const escaped = escapeHtml(line);

    // //で始まる行は打ち消し線
    if (line.trimStart().startsWith("//")) {
      return `<span class="line-through opacity-40">${escaped}</span>`;
    }

    // [text](ruby) パターンをスタイル付きspanに変換
    return escaped.replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<span class="text-accent">$1</span><span class="text-text-muted text-[9px]">($2)</span>'
    );
  });

  return processed.join("<br/>") + (truncated ? '<br/><span class="text-text-muted">...</span>' : "");
}

/** セパレーターの種類に応じたスタイルクラスを返す */
function getSeparatorClass(content: string): string {
  // [N巻] パターン
  if (/^\[.+巻\]$/.test(content.trim())) return "text-purple-400";
  // <<NPage>> パターン
  if (/^<<.+Page>>$/.test(content.trim())) return "text-blue-400";
  // ダッシュセパレーター
  return "text-text-muted/50";
}

// ── コンポーネント ──

export default function ComicPotChunkList({
  chunks,
  selectedIndex,
  draggedIndex,
  dragOverIndex,
  dropPosition,
  onSelect,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: Props) {
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // ── D&D ハンドラー ──

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLDivElement>, index: number) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(index));
      // ドラッグ開始時に半透明化（次フレームで反映）
      requestAnimationFrame(() => {
        const el = itemRefs.current.get(index);
        if (el) el.style.opacity = "0.5";
      });
      onDragStart(index);
    },
    [onDragStart]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>, index: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const rect = e.currentTarget.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const position: "before" | "after" = e.clientY < midY ? "before" : "after";
      onDragOver(index, position);
    },
    [onDragOver]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>, index: number) => {
      e.preventDefault();
      onDrop(index);
    },
    [onDrop]
  );

  const handleDragEnd = useCallback(() => {
    // 全要素のopacityをリセット
    itemRefs.current.forEach((el) => {
      el.style.opacity = "";
    });
    onDragEnd();
  }, [onDragEnd]);

  // dialogueチャンクのみをカウントして番号バッジを付与
  let dialogueCount = 0;

  // ── 空状態 ──

  if (chunks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted py-12">
        <svg
          className="w-8 h-8 mb-2 opacity-30"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
          />
        </svg>
        <span className="text-[11px]">テキストファイルを読み込んでください</span>
      </div>
    );
  }

  // ── リスト描画 ──

  return (
    <div className="space-y-0.5 p-2">
      {chunks.map((chunk, index) => {
        const isSelected = selectedIndex === index;
        const isDragging = draggedIndex === index;
        const showDropBefore = dragOverIndex === index && dropPosition === "before";
        const showDropAfter = dragOverIndex === index && dropPosition === "after";

        // ── セパレーター ──

        if (chunk.type === "separator") {
          return (
            <div key={index}>
              {showDropBefore && (
                <div className="h-0.5 bg-accent/60 rounded-full mx-2 my-0.5" />
              )}
              <div
                className={`text-center py-0.5 text-[10px] italic select-none ${getSeparatorClass(chunk.content)}`}
                onDragOver={(e) => handleDragOver(e, index)}
                onDrop={(e) => handleDrop(e, index)}
              >
                {chunk.content}
              </div>
              {showDropAfter && (
                <div className="h-0.5 bg-accent/60 rounded-full mx-2 my-0.5" />
              )}
            </div>
          );
        }

        // ── ダイアログ ──

        dialogueCount++;
        const badgeNum = dialogueCount;

        return (
          <div key={index}>
            {showDropBefore && (
              <div className="h-0.5 bg-accent/60 rounded-full mx-2 my-0.5" />
            )}
            <div
              ref={(el) => {
                if (el) itemRefs.current.set(index, el);
                else itemRefs.current.delete(index);
              }}
              draggable
              className={[
                "px-3 py-1.5 rounded-md transition-colors text-[11px] cursor-pointer select-none",
                "hover:bg-bg-tertiary",
                isSelected ? "bg-accent/10 border-l-2 border-l-accent" : "",
                isDragging ? "opacity-50" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => onSelect(index)}
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
            >
              <div className="flex items-start gap-1">
                {/* 番号バッジ */}
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-bg-tertiary text-[8px] text-text-muted mr-2 shrink-0 mt-0.5">
                  {badgeNum}
                </span>
                {/* コンテンツ */}
                <span
                  className="leading-relaxed break-all"
                  dangerouslySetInnerHTML={{
                    __html: renderChunkContent(chunk.content),
                  }}
                />
              </div>
            </div>
            {showDropAfter && (
              <div className="h-0.5 bg-accent/60 rounded-full mx-2 my-0.5" />
            )}
          </div>
        );
      })}

      {/* リスト末尾のドロップゾーン */}
      <div
        className="h-6 rounded-md transition-colors"
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (chunks.length > 0) {
            onDragOver(chunks.length - 1, "after");
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (chunks.length > 0) {
            onDrop(chunks.length - 1);
          }
        }}
      />
    </div>
  );
}
