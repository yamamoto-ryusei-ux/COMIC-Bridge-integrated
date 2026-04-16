/**
 * 統合ビューアー サブコンポーネント
 */
import React, { useState, useEffect, useCallback } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { invoke } from "@tauri-apps/api/core";
import type { LayerNode } from "../../types";
import type { TextBlock } from "../../store/unifiedViewerStore";
import type { UnifiedDiffEntry } from "../../kenban-utils/textExtract";
import type { DiffPart } from "../../kenban-utils/kenbanTypes";
import { CHECK_JSON_BASE_PATH, CHECK_DATA_SUBFOLDER } from "./utils";

// ─── ToolBtn ────────────────────────────────────────────
export function ToolBtn({ children, onClick, disabled, title }: {
  children: React.ReactNode; onClick: () => void; disabled?: boolean; title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="px-2 py-1 text-text-secondary hover:text-text-primary hover:bg-bg-tertiary rounded transition-colors disabled:opacity-30 disabled:pointer-events-none"
    >
      {children}
    </button>
  );
}

// ─── PanelTabBtn ────────────────────────────────────────
export function PanelTabBtn({ children, active, onClick, onContextMenu, badge }: {
  children: React.ReactNode; active: boolean; onClick: () => void; onContextMenu?: (e: React.MouseEvent) => void; badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={`px-1 py-0.5 rounded transition-colors text-[9px] whitespace-nowrap ${
        active ? "bg-accent/15 text-accent font-medium" : "text-text-muted hover:text-text-secondary hover:bg-bg-tertiary/60"
      }`}
    >
      {children}
      {badge !== undefined && badge > 0 && (
        <span className="ml-0.5 px-0.5 py-px rounded-full bg-accent/20 text-accent text-[8px] tabular-nums">{badge}</span>
      )}
    </button>
  );
}

// ─── LayerTreeView ──────────────────────────────────────
export function LayerTreeView({ nodes, depth = 0, _counter }: { nodes: LayerNode[]; depth?: number; _counter?: { v: number } }) {
  const c = _counter || { v: 0 };
  return (
    <>
      {nodes.map((node) => {
        const rowIdx = c.v++;
        return (
          <div key={node.id}>
            <div
              className={`flex items-center gap-1 py-0.5 text-[11px] border-b border-border/15 ${
                !node.visible ? "opacity-40" : ""
              }`}
              style={{
                paddingLeft: depth * 12 + 4,
                backgroundColor: rowIdx % 2 === 0 ? "#ffffff" : "#f0f8f0",
              }}
            >
              <span className={`w-3 text-center text-[9px] ${
                node.type === "group" ? "text-accent-secondary" :
                node.type === "text" ? "text-accent" :
                "text-text-muted"
              }`}>
                {node.type === "group" ? "G" : node.type === "text" ? "T" : node.type === "adjustment" ? "A" : "L"}
              </span>
              <span className="truncate text-text-secondary">{node.name}</span>
            </div>
            {node.children && <LayerTreeView nodes={node.children} depth={depth + 1} _counter={c} />}
          </div>
        );
      })}
    </>
  );
}

// ─── SortableBlockItem ──────────────────────────────────
export function SortableBlockItem({
  block,
  blockIdx,
  isSelected,
  fontColor,
  fontLabel,
  onClick,
  onEditBlock,
}: {
  block: TextBlock;
  blockIdx: number;
  isSelected: boolean;
  fontColor?: string;
  fontLabel?: string;
  onClick: (e: React.MouseEvent) => void;
  onEditBlock?: (blockId: string, newLines: string[]) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
  });
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const editRef = React.useRef<HTMLTextAreaElement>(null);

  const isDeleted = block.lines[0]?.startsWith("//") ?? false;
  const isAdded = !!block.isAdded;

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    borderLeft: fontColor ? `3px solid ${fontColor}` : undefined,
  };

  const commitEdit = () => {
    if (!onEditBlock) return;
    const newLines = editText.split("\n").filter((l, _i, a) => l.trim() !== "" || a.length === 1);
    if (newLines.length === 0) { setEditing(false); return; }
    onEditBlock(block.id, newLines);
    setEditing(false);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-start gap-1 px-1 py-1.5 rounded text-sm font-mono whitespace-pre-wrap cursor-pointer transition-colors mb-0.5 ${
        isSelected ? "bg-accent/8 ring-1 ring-accent/30"
          : isDeleted ? "bg-error/5 border border-error/20"
          : isAdded ? "bg-success/5 border border-success/20"
          : "hover:bg-bg-tertiary/60"
      }`}
      onClick={editing ? undefined : onClick}
      onDoubleClick={() => {
        if (!onEditBlock) return;
        setEditText(block.lines.join("\n"));
        setEditing(true);
        setTimeout(() => editRef.current?.focus(), 0);
      }}
    >
      <div
        className="flex-shrink-0 mt-0.5 cursor-grab active:cursor-grabbing text-text-muted/30 hover:text-text-muted/60"
        {...attributes}
        {...listeners}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
          <circle cx="3" cy="2" r="1.2" /><circle cx="7" cy="2" r="1.2" />
          <circle cx="3" cy="5.5" r="1.2" /><circle cx="7" cy="5.5" r="1.2" />
          <circle cx="3" cy="9" r="1.2" /><circle cx="7" cy="9" r="1.2" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        {(block.assignedFont && fontLabel || isAdded || isDeleted) && (
          <div className="text-[9px] mb-0.5 flex items-center gap-1">
            {fontColor && fontLabel && (
              <span className="px-1 py-px rounded text-white" style={{ backgroundColor: fontColor }}>
                {fontLabel}
              </span>
            )}
            {isAdded && <span className="px-1 py-px rounded bg-success/15 text-success font-medium">追加</span>}
            {isDeleted && <span className="px-1 py-px rounded bg-error/15 text-error font-medium">削除</span>}
          </div>
        )}
        {editing ? (
          <div>
            <textarea
              ref={editRef}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditing(false);
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commitEdit(); }
              }}
              className="w-full text-[11px] text-text-primary leading-relaxed bg-transparent border border-accent/30 rounded px-1 py-0.5 resize-y outline-none focus:border-accent"
              rows={Math.max(2, block.lines.length + 1)}
            />
            <span className="text-[8px] text-text-muted">Ctrl+Enter: 確定 / Esc: キャンセル</span>
          </div>
        ) : (
          <div className={isDeleted ? "text-error/60 line-through" : isAdded ? "text-success" : "text-black"}>
            {block.lines.join("\n") || <span className="text-text-muted/40 italic">（空）</span>}
          </div>
        )}
      </div>
      {/* Block number (right side) */}
      <span className={`flex-shrink-0 self-center text-[8px] font-mono leading-none px-0.5 ${
        block.originalIndex !== blockIdx ? "text-warning font-bold" : "text-text-muted/40"
      }`}>
        {block.originalIndex !== blockIdx
          ? `${block.originalIndex + 1}→${blockIdx + 1}`
          : `${blockIdx + 1}`}
      </span>
    </div>
  );
}

// ─── UnifiedDiffDisplay ─────────────────────────────────
export function UnifiedDiffDisplay({ entries }: { entries: UnifiedDiffEntry[] }) {
  return (
    <div className="text-[11px] font-mono border border-border/30 rounded overflow-hidden divide-y divide-border/20">
      {entries.map((entry, i) => {
        if (entry.type === "separator") {
          return <div key={i} className="h-1 bg-border/20" />;
        }
        if (entry.type === "match") {
          return (
            <div key={i} className="px-2 py-0.5 text-text-secondary whitespace-pre-wrap break-all">
              {entry.text}
            </div>
          );
        }
        if (entry.type === "linebreak") {
          return (
            <div key={i} className="px-2 py-0.5 bg-accent/5 text-text-muted whitespace-pre-wrap break-all">
              <span className="text-[9px] text-accent mr-1">改行差異</span>
              {entry.psdText}
            </div>
          );
        }
        return (
          <div key={i} className="grid grid-cols-2 gap-0 bg-warning/5">
            <div className="px-2 py-0.5 whitespace-pre-wrap break-all">
              {entry.psdParts ? (
                <DiffPartSpans parts={entry.psdParts} side="psd" />
              ) : (
                <span className="opacity-30">—</span>
              )}
            </div>
            <div className="px-2 py-0.5 whitespace-pre-wrap break-all border-l border-border/30">
              {entry.memoParts ? (
                <DiffPartSpans parts={entry.memoParts} side="memo" />
              ) : (
                <span className="opacity-30">—</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DiffPartSpans({ parts, side }: { parts: DiffPart[]; side: "psd" | "memo" }) {
  return (
    <>
      {parts.map((p, i) => {
        if (p.added) {
          return side === "memo" ? (
            <span key={i} className="bg-success/20 text-success font-medium">{p.value}</span>
          ) : null;
        }
        if (p.removed) {
          return side === "psd" ? (
            <span key={i} className="bg-error/20 text-error line-through">{p.value}</span>
          ) : null;
        }
        return <span key={i} className="text-text-secondary">{p.value}</span>;
      })}
    </>
  );
}

// ─── CheckJsonBrowser ───────────────────────────────────
export function CheckJsonBrowser({ onSelect, onCancel }: { onSelect: (path: string) => void; onCancel: () => void }) {
  const [step, setStep] = useState<"label" | "title" | "files">("label");
  const [labels, setLabels] = useState<string[]>([]);
  const [titles, setTitles] = useState<string[]>([]);
  const [jsonFiles, setJsonFiles] = useState<string[]>([]);
  const [selectedLabel, setSelectedLabel] = useState("");
  const [selectedTitle, setSelectedTitle] = useState("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [, setCurrentPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    invoke<{ folders: string[]; json_files: string[] }>("list_folder_contents", { folderPath: CHECK_JSON_BASE_PATH })
      .then((r) => { setLabels(r.folders.sort()); setLoading(false); })
      .catch(() => { setError(`パスにアクセスできません: ${CHECK_JSON_BASE_PATH}`); setLoading(false); });
  }, []);

  const selectLabel = useCallback(async (label: string) => {
    setSelectedLabel(label);
    setLoading(true);
    try {
      const path = `${CHECK_JSON_BASE_PATH}/${label}`;
      const r = await invoke<{ folders: string[]; json_files: string[] }>("list_folder_contents", { folderPath: path });
      // 「校正チェックデータ」サブフォルダはスキップ（表示しない）
      setTitles(r.folders.filter((f) => f !== CHECK_DATA_SUBFOLDER).sort());
      setStep("title");
    } catch { setError("フォルダ読み込みエラー"); }
    setLoading(false);
  }, []);

  const selectTitle = useCallback(async (title: string) => {
    setSelectedTitle(title);
    setLoading(true);
    const basePath = `${CHECK_JSON_BASE_PATH}/${selectedLabel}/${title}`;
    try {
      const checkPath = `${basePath}/${CHECK_DATA_SUBFOLDER}`;
      let targetPath = basePath;
      try {
        const checkContents = await invoke<{ folders: string[]; json_files: string[] }>("list_folder_contents", { folderPath: checkPath });
        if (checkContents.json_files.length > 0 || checkContents.folders.length > 0) {
          targetPath = checkPath;
        }
      } catch { /* skip */ }
      const r = await invoke<{ folders: string[]; json_files: string[] }>("list_folder_contents", { folderPath: targetPath });
      let allJsons = r.json_files.map((f) => `${targetPath}/${f}`);
      for (const sub of r.folders) {
        try {
          const subR = await invoke<{ folders: string[]; json_files: string[] }>("list_folder_contents", { folderPath: `${targetPath}/${sub}` });
          allJsons.push(...subR.json_files.map((f) => `${targetPath}/${sub}/${f}`));
        } catch { /* skip */ }
      }
      setJsonFiles(allJsons);
      setCurrentPath(targetPath);
      setStep("files");
    } catch { setError("フォルダ読み込みエラー"); }
    setLoading(false);
  }, [selectedLabel]);

  const goBack = () => {
    if (step === "files") { setStep("title"); setJsonFiles([]); setSelectedFile(null); }
    else if (step === "title") { setStep("label"); setTitles([]); }
  };

  if (error) return (
    <div className="p-4 text-center">
      <p className="text-xs text-error mb-2">{error}</p>
      <button onClick={onCancel} className="text-xs text-text-muted hover:text-text-primary">閉じる</button>
    </div>
  );
  if (loading) return (
    <div className="p-4 flex items-center justify-center gap-2 text-text-muted text-xs">
      <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
      読み込み中...
    </div>
  );

  return (
    <div className="flex flex-col">
      <div className="px-3 py-1.5 bg-bg-tertiary/30 border-b border-border/30 flex items-center gap-1 text-[11px] text-text-muted">
        {step !== "label" && (<button onClick={goBack} className="hover:text-text-primary mr-1">◀</button>)}
        <span className="opacity-60">校正テキストログ</span>
        {selectedLabel && <><span className="opacity-40">/</span><span>{selectedLabel}</span></>}
        {selectedTitle && <><span className="opacity-40">/</span><span>{selectedTitle}</span></>}
      </div>
      <div className="max-h-[50vh] overflow-auto">
        {step === "label" && (labels.length === 0 ? (
          <p className="p-4 text-xs text-text-muted text-center">レーベルフォルダがありません</p>
        ) : labels.map((label) => (
          <div key={label} className="px-3 py-2 text-xs cursor-pointer hover:bg-bg-tertiary transition-colors flex items-center gap-2" onDoubleClick={() => selectLabel(label)}>
            <span className="text-accent-secondary">📁</span><span className="text-text-primary">{label}</span>
          </div>
        )))}
        {step === "title" && (titles.length === 0 ? (
          <p className="p-4 text-xs text-text-muted text-center">タイトルフォルダがありません</p>
        ) : titles.map((title) => (
          <div key={title} className="px-3 py-2 text-xs cursor-pointer hover:bg-bg-tertiary transition-colors flex items-center gap-2" onDoubleClick={() => selectTitle(title)}>
            <span className="text-accent-secondary">📁</span><span className="text-text-primary">{title}</span>
          </div>
        )))}
        {step === "files" && (jsonFiles.length === 0 ? (
          <p className="p-4 text-xs text-text-muted text-center">JSONファイルがありません</p>
        ) : jsonFiles.map((fp) => {
          const name = fp.substring(fp.lastIndexOf("/") + 1);
          const isSelected = selectedFile === fp;
          return (
            <div key={fp} className={`px-3 py-2 text-xs cursor-pointer transition-colors flex items-center gap-2 ${isSelected ? "bg-accent/10 text-accent" : "hover:bg-bg-tertiary text-text-secondary"}`}
              onClick={() => setSelectedFile(fp)} onDoubleClick={() => onSelect(fp)}>
              <span className="opacity-60">📄</span><span>{name}</span>
            </div>
          );
        }))}
      </div>
      {step === "files" && (
        <div className="px-3 py-2 border-t border-border/30 flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1 text-xs text-text-muted hover:text-text-primary">キャンセル</button>
          <button onClick={() => selectedFile && onSelect(selectedFile)} disabled={!selectedFile}
            className="px-3 py-1 text-xs font-medium text-white bg-gradient-to-r from-accent to-accent-secondary rounded disabled:opacity-30">選択</button>
        </div>
      )}
    </div>
  );
}
