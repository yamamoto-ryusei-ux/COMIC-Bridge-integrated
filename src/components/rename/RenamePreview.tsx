import { useState, useMemo, useCallback } from "react";
import { useRenameStore, internalDragState } from "../../store/renameStore";
import { usePsdStore } from "../../store/psdStore";
import { useRenameProcessor } from "../../hooks/useRenameProcessor";
import type { LayerNode } from "../../types/index";
import type { RenameRule, FileRenamePreview } from "../../types/rename";

export function RenamePreview() {
  const subMode = useRenameStore((s) => s.subMode);

  return subMode === "layer" ? <LayerPreview /> : <FilePreview />;
}

// ==============================
// レイヤーリネーム プレビュー
// ==============================

/** ノードごとのリネーム結果 */
interface RenameInfo {
  willRename: boolean;
  newName: string;
  reason: "bottomLayer" | "rule" | null;
}

/** ツリー全体のリネーム対象マップを構築 */
function buildRenameMap(
  tree: LayerNode[],
  rules: RenameRule[],
  bottomLayer: { enabled: boolean; newName: string },
): Map<string, RenameInfo> {
  const map = new Map<string, RenameInfo>();
  const activeRules = rules.filter((r) => r.oldName.trim() !== "");

  // Bottom layer (ag-psd: bottom-to-top順 → 配列の先頭が最下位)
  if (bottomLayer.enabled && bottomLayer.newName.trim() !== "" && tree.length > 0) {
    const bottom = tree[0];
    if (bottom.name !== bottomLayer.newName) {
      map.set(bottom.id, {
        willRename: true,
        newName: bottomLayer.newName,
        reason: "bottomLayer",
      });
    }
  }

  function traverse(nodes: LayerNode[]) {
    for (const node of nodes) {
      // ルールマッチング（bottomLayerで既にマップ済みならスキップ）
      if (!map.has(node.id)) {
        for (const rule of activeRules) {
          const isTarget =
            (rule.target === "layer" && node.type !== "group") ||
            (rule.target === "group" && node.type === "group");
          if (!isTarget) continue;

          if (matchName(node.name, rule.oldName, rule.matchMode)) {
            map.set(node.id, {
              willRename: true,
              newName: applyRename(node.name, rule.oldName, rule.newName, rule.matchMode),
              reason: "rule",
            });
            break; // 最初にマッチしたルールを適用
          }
        }
      }
      if (node.children) traverse(node.children);
    }
  }

  traverse(tree);
  return map;
}

function LayerPreview() {
  const layerSettings = useRenameStore((s) => s.layerSettings);
  const files = usePsdStore((s) => s.files);
  const psdFiles = files.filter(
    (f) => f.filePath.toLowerCase().endsWith(".psd") || f.filePath.toLowerCase().endsWith(".psb"),
  );

  if (psdFiles.length === 0) {
    return (
      <EmptyState message="PSDファイルをドラッグ＆ドロップ、または仕様チェックタブでフォルダを選択して読み込んでください" />
    );
  }

  const hasRules =
    layerSettings.bottomLayer.enabled || layerSettings.rules.some((r) => r.oldName.trim() !== "");

  return (
    <div className="h-full flex flex-col">
      {/* Legend (ルールがあるときのみ) */}
      {hasRules && (
        <div className="flex items-center gap-3 px-4 py-1.5 border-b border-border/50 flex-shrink-0">
          <span className="text-[9px] text-text-muted">凡例:</span>
          <span className="flex items-center gap-1 text-[9px]">
            <span className="w-2 h-2 rounded-sm bg-accent-secondary/30 border border-accent-secondary/50" />
            <span className="text-text-muted">リネーム対象</span>
          </span>
        </div>
      )}

      {/* File columns */}
      <div className="flex-1 overflow-auto">
        <div
          className="grid h-fit"
          style={{
            gridTemplateColumns: `repeat(${Math.min(psdFiles.length, 3)}, 1fr)`,
          }}
        >
          {psdFiles.map((file) => {
            const tree = file.metadata?.layerTree || [];
            const renameMap = hasRules
              ? buildRenameMap(tree, layerSettings.rules, layerSettings.bottomLayer)
              : new Map<string, RenameInfo>();
            const renameCount = renameMap.size;

            return (
              <div key={file.id} className="flex flex-col min-w-0 border-r border-b border-border">
                {/* File header */}
                <div className="px-2 py-1.5 border-b border-border/60 bg-bg-secondary/30 flex items-center gap-1.5 flex-shrink-0">
                  <span className="text-[11px] font-medium text-text-primary truncate flex-1">
                    {file.fileName.replace(/\.(psd|psb)$/i, "")}
                  </span>
                  {renameCount > 0 && (
                    <span className="text-[9px] px-1 py-px rounded bg-accent-secondary/10 text-accent-secondary flex-shrink-0">
                      {renameCount}
                    </span>
                  )}
                  <span className="text-[9px] text-text-muted/60 flex-shrink-0">
                    {file.metadata?.layerCount ?? 0}
                  </span>
                </div>

                {/* Layer tree */}
                <div className="p-1">
                  {tree.length === 0 ? (
                    <div className="flex items-center justify-center py-4 text-[10px] text-text-muted">
                      レイヤー情報なし
                    </div>
                  ) : (
                    <RenameTree layers={tree} depth={0} renameMap={renameMap} parentVisible />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// --- Rename-aware layer tree ---

function RenameTree({
  layers,
  depth,
  renameMap,
  parentVisible,
}: {
  layers: LayerNode[];
  depth: number;
  renameMap: Map<string, RenameInfo>;
  parentVisible: boolean;
}) {
  const reversed = useMemo(() => [...layers].reverse(), [layers]);
  return (
    <div className="text-[11px]">
      {reversed.map((layer) => (
        <RenameItem
          key={layer.id}
          layer={layer}
          depth={depth}
          renameMap={renameMap}
          parentVisible={parentVisible}
        />
      ))}
    </div>
  );
}

function RenameItem({
  layer,
  depth,
  renameMap,
  parentVisible,
}: {
  layer: LayerNode;
  depth: number;
  renameMap: Map<string, RenameInfo>;
  parentVisible: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(depth < 2);
  const hasChildren = layer.children && layer.children.length > 0;
  const info = renameMap.get(layer.id);
  const effectiveVisible = layer.visible && parentVisible;

  // リネーム対象はハイライト
  const rowBg = info?.willRename ? "bg-accent-secondary/8" : "";
  const borderLeft = info?.willRename ? "border-l-[2px] border-accent-secondary/50" : "";

  return (
    <div>
      <div
        className={`
          flex items-center gap-1 py-[3px] px-1 rounded transition-colors
          hover:bg-bg-tertiary/50 cursor-default
          ${rowBg} ${borderLeft}
        `}
        style={{ paddingLeft: `${depth * 12 + 2}px` }}
      >
        <ExpandBtn
          has={!!hasChildren}
          open={isExpanded}
          toggle={() => setIsExpanded(!isExpanded)}
        />
        <VisIcon visible={layer.visible} effective={effectiveVisible} />
        <TypeIcon type={layer.type} visible={effectiveVisible} />

        {info?.willRename ? (
          <>
            <span className="text-text-muted line-through truncate" title={layer.name}>
              {layer.name || <span className="italic text-text-muted/50">名称なし</span>}
            </span>
            <svg
              className="w-2.5 h-2.5 text-text-muted/60 flex-shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
            <span className="text-accent-secondary font-medium truncate" title={info.newName}>
              {info.newName}
            </span>
          </>
        ) : (
          <span
            className={`truncate flex-1 ${effectiveVisible ? "text-text-primary" : "text-text-muted/50"}`}
            title={layer.name}
          >
            {layer.name || <span className="italic text-text-muted/50">名称なし</span>}
          </span>
        )}

        <div className={effectiveVisible ? "" : "opacity-40"}>
          <Badges layer={layer} />
        </div>
      </div>
      {hasChildren && isExpanded && (
        <div className="relative">
          <div
            className="absolute left-0 top-0 bottom-1 w-px bg-border/40"
            style={{ marginLeft: `${depth * 12 + 9}px` }}
          />
          <RenameTree
            layers={layer.children!}
            depth={depth + 1}
            renameMap={renameMap}
            parentVisible={effectiveVisible}
          />
        </div>
      )}
    </div>
  );
}

// --- Compact sub-components (same as LayerPreviewPanel) ---

function ExpandBtn({ has, open, toggle }: { has: boolean; open: boolean; toggle: () => void }) {
  if (!has) return <div className="w-3.5" />;
  return (
    <button
      className="w-3.5 h-3.5 flex items-center justify-center text-text-muted hover:text-accent transition-colors"
      onClick={(e) => {
        e.stopPropagation();
        toggle();
      }}
    >
      <svg
        className={`w-2.5 h-2.5 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
        fill="currentColor"
        viewBox="0 0 20 20"
      >
        <path
          fillRule="evenodd"
          d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
          clipRule="evenodd"
        />
      </svg>
    </button>
  );
}

function VisIcon({ visible, effective = visible }: { visible: boolean; effective?: boolean }) {
  const color = effective ? "text-accent-tertiary" : "text-text-muted/50";
  return (
    <div className={`w-3.5 h-3.5 flex items-center justify-center ${color}`}>
      {visible ? (
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
          <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
          <path
            fillRule="evenodd"
            d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z"
            clipRule="evenodd"
          />
        </svg>
      ) : (
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z"
            clipRule="evenodd"
          />
          <path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z" />
        </svg>
      )}
    </div>
  );
}

function TypeIcon({ type, visible = true }: { type: LayerNode["type"]; visible?: boolean }) {
  const cls = `w-3 h-3 ${visible ? "" : "opacity-35"}`;
  switch (type) {
    case "group":
      return (
        <svg className={`${cls} text-manga-lavender`} fill="currentColor" viewBox="0 0 20 20">
          <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
        </svg>
      );
    case "text":
      return (
        <svg className={`${cls} text-[#f06292]`} viewBox="0 0 20 20" fill="currentColor">
          <path d="M5 4h10v2.5h-1.2V5.5H10.6V14h1.5v1.5h-4.2V14h1.5V5.5H6.2v1H5V4z" />
        </svg>
      );
    case "adjustment":
      return (
        <svg className={`${cls} text-accent-warm`} viewBox="0 0 20 20" fill="currentColor">
          <path d="M10 2a8 8 0 100 16 8 8 0 000-16zM4 10a6 6 0 0112 0H4z" />
        </svg>
      );
    case "smartObject":
      return (
        <svg className={`${cls} text-accent-tertiary`} viewBox="0 0 20 20" fill="currentColor">
          <path d="M10 2L3 6v8l7 4 7-4V6l-7-4zm0 2.24L14.5 7 10 9.76 5.5 7 10 4.24z" />
        </svg>
      );
    case "shape":
      return (
        <svg className={`${cls} text-[#59a8f8]`} viewBox="0 0 20 20" fill="currentColor">
          <path d="M3 3h14v14H3V3zm2 2v10h10V5H5z" />
        </svg>
      );
    default:
      return (
        <svg className={`${cls} text-[#42a5f5]`} viewBox="0 0 20 20" fill="currentColor">
          <path d="M2 5a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V5zm2 0v6.586l3.293-3.293a1 1 0 011.414 0L13 12.586l1.293-1.293a1 1 0 011.414 0L16 11.586V5H4zm0 10v-1l3.293-3.293L12 15.414V15H4zm12 0v-1.586l-2-2-1.293 1.293L15.414 15H16zM13.5 8a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
        </svg>
      );
  }
}

function Badges({ layer }: { layer: LayerNode }) {
  return (
    <>
      {layer.clipping && (
        <span className="text-[8px] px-0.5 rounded bg-accent/12 text-accent flex-shrink-0">
          clip
        </span>
      )}
      {layer.hasMask && (
        <span className="flex-shrink-0">
          <svg className="w-2.5 h-2.5 text-text-muted/60" viewBox="0 0 16 16" fill="currentColor">
            <rect
              x="1"
              y="1"
              width="14"
              height="14"
              rx="2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <circle cx="8" cy="8" r="4" />
          </svg>
        </span>
      )}
      {layer.hasVectorMask && (
        <span className="flex-shrink-0">
          <svg className="w-2.5 h-2.5 text-[#59a8f8]/60" viewBox="0 0 16 16" fill="currentColor">
            <rect
              x="1"
              y="1"
              width="14"
              height="14"
              rx="2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path d="M4 12L8 4l4 8H4z" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </span>
      )}
      {layer.opacity < 100 && (
        <span className="text-[9px] px-0.5 rounded bg-bg-tertiary text-text-muted/60 flex-shrink-0">
          {layer.opacity}%
        </span>
      )}
    </>
  );
}

// --- Match / Rename helpers ---

function matchName(name: string, pattern: string, mode: string): boolean {
  if (mode === "exact") return name === pattern;
  if (mode === "partial") return name.includes(pattern);
  if (mode === "regex") {
    try {
      return new RegExp(pattern).test(name);
    } catch {
      return false;
    }
  }
  return false;
}

function applyRename(name: string, oldName: string, newName: string, mode: string): string {
  if (mode === "exact") return newName;
  if (mode === "partial") return name.split(oldName).join(newName);
  if (mode === "regex") {
    try {
      return name.replace(new RegExp(oldName, "g"), newName);
    } catch {
      return name;
    }
  }
  return name;
}

// ==============================
// ファイルリネーム プレビュー
// ==============================
function FilePreview() {
  const fileEntries = useRenameStore((s) => s.fileEntries);
  const fileSettings = useRenameStore((s) => s.fileSettings);
  const toggleEntrySelected = useRenameStore((s) => s.toggleEntrySelected);
  const toggleAllSelected = useRenameStore((s) => s.toggleAllSelected);
  const removeFolder = useRenameStore((s) => s.removeFolder);
  const setEntryCustomName = useRenameStore((s) => s.setEntryCustomName);
  const clearFileEntries = useRenameStore((s) => s.clearFileEntries);
  const reorderFolder = useRenameStore((s) => s.reorderFolder);

  const { computeFilePreview } = useRenameProcessor();
  const previews = useMemo(computeFilePreview, [fileEntries, fileSettings, computeFilePreview]);

  const previewMap = useMemo(() => {
    const map = new Map<string, FileRenamePreview>();
    for (const p of previews) map.set(p.id, p);
    return map;
  }, [previews]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [dragFolder, setDragFolder] = useState<string | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);

  const allSelected = fileEntries.length > 0 && fileEntries.every((e) => e.selected);

  // Group by folder
  const folderGroups = useMemo(() => {
    const groups: { folderPath: string; folderName: string; entries: typeof fileEntries }[] = [];
    const seen = new Map<string, number>();
    for (const entry of fileEntries) {
      const gi = seen.get(entry.folderPath);
      if (gi !== undefined) {
        groups[gi].entries.push(entry);
      } else {
        seen.set(entry.folderPath, groups.length);
        groups.push({
          folderPath: entry.folderPath,
          folderName: entry.folderName,
          entries: [entry],
        });
      }
    }
    return groups;
  }, [fileEntries]);

  const startEdit = useCallback(
    (id: string, currentName: string) => {
      setEditingId(id);
      const preview = previewMap.get(id);
      setEditValue(preview?.newName || currentName);
    },
    [previewMap],
  );

  const commitEdit = useCallback(
    (id: string, originalName: string) => {
      if (editValue.trim() === "" || editValue === originalName) {
        setEntryCustomName(id, null);
      } else {
        setEntryCustomName(id, editValue.trim());
      }
      setEditingId(null);
    },
    [editValue, setEntryCustomName],
  );

  // Folder D&D
  const handleFolderDragStart = (e: React.DragEvent, folderPath: string) => {
    internalDragState.active = true;
    e.dataTransfer.effectAllowed = "move";
    setDragFolder(folderPath);
  };

  const handleFolderDragOver = (e: React.DragEvent, folderPath: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragFolder && dragFolder !== folderPath) {
      setDragOverFolder(folderPath);
    }
  };

  const handleFolderDrop = (e: React.DragEvent, toFolderPath: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragFolder && dragFolder !== toFolderPath) {
      reorderFolder(dragFolder, toFolderPath);
    }
    internalDragState.active = false;
    setDragFolder(null);
    setDragOverFolder(null);
  };

  const handleFolderDragEnd = () => {
    internalDragState.active = false;
    setDragFolder(null);
    setDragOverFolder(null);
  };

  if (fileEntries.length === 0) {
    return (
      <EmptyState message="フォルダやファイルをドラッグ＆ドロップ、または左パネルの「フォルダ追加」で読み込んでください" />
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border/50 flex-shrink-0">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={(e) => toggleAllSelected(e.target.checked)}
            className="rounded border-white/20 text-accent-secondary focus:ring-accent-secondary"
          />
          <span className="text-[10px] text-text-muted">全選択</span>
        </label>
        <span className="text-[10px] text-text-muted">
          {folderGroups.length > 1 && `${folderGroups.length} フォルダ / `}
          {fileEntries.length} ファイル
        </span>
        <div className="flex-1" />
        <button
          onClick={clearFileEntries}
          className="px-2 py-1 text-[10px] text-text-muted hover:text-error transition-colors"
        >
          クリア
        </button>
      </div>

      {/* Folder columns grid */}
      <div className="flex-1 overflow-auto">
        <div
          className="grid h-fit"
          style={{
            gridTemplateColumns: `repeat(${Math.min(folderGroups.length, 3)}, 1fr)`,
          }}
        >
          {folderGroups.map((group) => (
            <div
              key={group.folderPath}
              draggable={folderGroups.length > 1}
              onDragStart={(e) => handleFolderDragStart(e, group.folderPath)}
              onDragOver={(e) => handleFolderDragOver(e, group.folderPath)}
              onDrop={(e) => handleFolderDrop(e, group.folderPath)}
              onDragEnd={handleFolderDragEnd}
              className={`
                flex flex-col min-w-0 border-r border-b border-border transition-colors
                ${dragOverFolder === group.folderPath && dragFolder !== group.folderPath ? "bg-accent-secondary/5" : ""}
                ${dragFolder === group.folderPath ? "opacity-50" : ""}
              `}
            >
              {/* Folder header */}
              <div className="px-2 py-1.5 border-b border-border/60 bg-bg-secondary/30 flex items-center gap-1.5 flex-shrink-0 group">
                {/* Drag handle (when multi-folder) */}
                {folderGroups.length > 1 && (
                  <svg
                    className="w-3 h-3 text-text-muted/40 flex-shrink-0 cursor-grab active:cursor-grabbing"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <circle cx="9" cy="7" r="1.5" />
                    <circle cx="15" cy="7" r="1.5" />
                    <circle cx="9" cy="12" r="1.5" />
                    <circle cx="15" cy="12" r="1.5" />
                    <circle cx="9" cy="17" r="1.5" />
                    <circle cx="15" cy="17" r="1.5" />
                  </svg>
                )}
                <svg
                  className="w-3.5 h-3.5 text-accent-secondary flex-shrink-0"
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
                <span className="text-[11px] font-medium text-text-secondary truncate flex-1">
                  {group.folderName}
                </span>
                <span className="text-[10px] text-text-muted/60 flex-shrink-0">
                  {group.entries.length}
                </span>
                <button
                  onClick={() => removeFolder(group.folderPath)}
                  className="p-0.5 rounded text-text-muted/40 hover:text-error transition-colors opacity-0 group-hover:opacity-100"
                >
                  <svg
                    className="w-3 h-3"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* File list */}
              <div className="p-1">
                {group.entries.map((entry) => {
                  const preview = previewMap.get(entry.id);
                  const isEditing = editingId === entry.id;
                  const newName = preview?.newName || entry.fileName;
                  const hasChange = newName !== entry.fileName;

                  return (
                    <div
                      key={entry.id}
                      className={`
                        flex items-center gap-1 py-[3px] px-1 rounded transition-colors
                        hover:bg-bg-tertiary/50 cursor-default
                        ${!entry.selected ? "opacity-40" : ""}
                      `}
                    >
                      <input
                        type="checkbox"
                        checked={entry.selected}
                        onChange={() => toggleEntrySelected(entry.id)}
                        className="w-3 h-3 rounded border-white/20 text-accent-secondary focus:ring-accent-secondary flex-shrink-0"
                      />

                      {/* File name area */}
                      <div className="flex-1 min-w-0">
                        {isEditing ? (
                          <input
                            autoFocus
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => commitEdit(entry.id, entry.fileName)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitEdit(entry.id, entry.fileName);
                              if (e.key === "Escape") setEditingId(null);
                            }}
                            className="w-full bg-bg-elevated border border-accent-secondary/50 rounded px-1.5 py-0.5 text-[11px] text-text-primary focus:outline-none"
                          />
                        ) : hasChange && entry.selected ? (
                          <div
                            className="cursor-text"
                            onDoubleClick={() => startEdit(entry.id, entry.fileName)}
                            title="ダブルクリックで個別編集"
                          >
                            <div className="text-[11px] text-text-muted/60 line-through truncate">
                              {entry.fileName}
                            </div>
                            <div
                              className={`text-[11px] truncate text-accent-tertiary font-medium ${entry.customName ? "underline decoration-dotted" : ""}`}
                            >
                              {newName}
                            </div>
                          </div>
                        ) : (
                          <div
                            className="text-[11px] text-text-primary truncate cursor-text"
                            onDoubleClick={() => startEdit(entry.id, entry.fileName)}
                            title="ダブルクリックで個別編集"
                          >
                            {entry.fileName}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ==============================
// 空状態
// ==============================
function EmptyState({ message }: { message: string }) {
  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="text-center space-y-3">
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
            d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
          />
        </svg>
        <p className="text-sm text-text-muted">{message}</p>
      </div>
    </div>
  );
}
