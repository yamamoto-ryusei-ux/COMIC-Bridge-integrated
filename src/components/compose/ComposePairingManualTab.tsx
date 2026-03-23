import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useComposeStore } from "../../store/composeStore";

interface Props {
  isReversed: boolean;
}

function getFileName(fullPath: string) {
  return fullPath.split(/[\\/]/).pop() || "";
}

export function ComposePairingManualTab({ isReversed }: Props) {
  const scannedFileGroups = useComposeStore((s) => s.scannedFileGroups);
  const manualPairs = useComposeStore((s) => s.manualPairs);
  const addManualPair = useComposeStore((s) => s.addManualPair);
  const removeManualPair = useComposeStore((s) => s.removeManualPair);

  const [selectedFile, setSelectedFile] = useState<{
    side: "left" | "right";
    path: string;
  } | null>(null);

  const [dragSource, setDragSource] = useState<{
    side: "left" | "right";
    path: string;
  } | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const isDraggingRef = useRef(false);
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);

  const allSourceFiles = useMemo(
    () => scannedFileGroups.flatMap((g) => g.sourceFiles),
    [scannedFileGroups],
  );
  const allTargetFiles = useMemo(
    () => scannedFileGroups.flatMap((g) => g.targetFiles),
    [scannedFileGroups],
  );

  const leftFiles = isReversed ? allTargetFiles : allSourceFiles;
  const rightFiles = isReversed ? allSourceFiles : allTargetFiles;
  const leftLabel = isReversed ? "原稿B" : "原稿A";
  const rightLabel = isReversed ? "原稿A" : "原稿B";

  const pairedLeftFiles = useMemo(() => {
    const set = new Set<string>();
    for (const p of manualPairs) {
      set.add(isReversed ? p.targetFile : p.sourceFile);
    }
    return set;
  }, [manualPairs, isReversed]);

  const pairedRightFiles = useMemo(() => {
    const set = new Set<string>();
    for (const p of manualPairs) {
      set.add(isReversed ? p.sourceFile : p.targetFile);
    }
    return set;
  }, [manualPairs, isReversed]);

  const nextPairIndex = useMemo(() => {
    if (manualPairs.length === 0) return 0;
    return Math.max(...manualPairs.map((p) => p.pairIndex)) + 1;
  }, [manualPairs]);

  const createPair = useCallback(
    (leftPath: string, rightPath: string) => {
      const sourceFile = isReversed ? rightPath : leftPath;
      const targetFile = isReversed ? leftPath : rightPath;
      addManualPair({
        sourceFile,
        sourceName: getFileName(sourceFile),
        targetFile,
        targetName: getFileName(targetFile),
        pairIndex: nextPairIndex,
      });
    },
    [isReversed, addManualPair, nextPairIndex],
  );

  const isPairedFile = useCallback(
    (side: "left" | "right", path: string) => {
      return side === "left" ? pairedLeftFiles.has(path) : pairedRightFiles.has(path);
    },
    [pairedLeftFiles, pairedRightFiles],
  );

  const handleClick = useCallback(
    (side: "left" | "right", path: string) => {
      if (isDraggingRef.current) return;
      if (isPairedFile(side, path)) return;

      if (!selectedFile) {
        setSelectedFile({ side, path });
        return;
      }

      if (selectedFile.side === side) {
        if (selectedFile.path === path) {
          setSelectedFile(null);
        } else {
          setSelectedFile({ side, path });
        }
        return;
      }

      const leftPath = side === "left" ? path : selectedFile.path;
      const rightPath = side === "right" ? path : selectedFile.path;
      createPair(leftPath, rightPath);
      setSelectedFile(null);
    },
    [selectedFile, isPairedFile, createPair],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, side: "left" | "right", path: string) => {
      if (e.button !== 0) return;
      if (isPairedFile(side, path)) return;
      dragStartPos.current = { x: e.clientX, y: e.clientY };
      setDragSource({ side, path });
      isDraggingRef.current = false;
    },
    [isPairedFile],
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragSource || !dragStartPos.current) return;
      const dx = e.clientX - dragStartPos.current.x;
      const dy = e.clientY - dragStartPos.current.y;
      if (!isDraggingRef.current && Math.sqrt(dx * dx + dy * dy) > 5) {
        isDraggingRef.current = true;
      }
    };

    const handleMouseUp = () => {
      if (isDraggingRef.current && dragSource && dragOverPath) {
        const dropSide: "left" | "right" = leftFiles.includes(dragOverPath) ? "left" : "right";
        if (dropSide !== dragSource.side) {
          const leftPath = dragSource.side === "left" ? dragSource.path : dragOverPath;
          const rightPath = dragSource.side === "right" ? dragSource.path : dragOverPath;
          createPair(leftPath, rightPath);
        }
      }

      const wasDragging = isDraggingRef.current;
      setTimeout(() => {
        isDraggingRef.current = false;
      }, 0);
      if (wasDragging) {
        setDragSource(null);
        setSelectedFile(null);
      }
      setDragOverPath(null);
      dragStartPos.current = null;
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragSource, dragOverPath, leftFiles, createPair]);

  const handleMouseEnter = useCallback(
    (side: "left" | "right", path: string) => {
      if (!isDraggingRef.current || !dragSource) return;
      if (dragSource.side === side) return;
      if (isPairedFile(side, path)) return;
      setDragOverPath(path);
    },
    [dragSource, isPairedFile],
  );

  const handleMouseLeave = useCallback(() => {
    if (isDraggingRef.current) {
      setDragOverPath(null);
    }
  }, []);

  const renderFileItem = (path: string, side: "left" | "right", isPaired: boolean) => {
    const isSelected = selectedFile?.side === side && selectedFile?.path === path;
    const isDragging =
      isDraggingRef.current && dragSource?.side === side && dragSource?.path === path;
    const isDropCandidate = isDraggingRef.current && dragOverPath === path;

    return (
      <div
        key={path}
        onMouseDown={(e) => handleMouseDown(e, side, path)}
        onClick={() => handleClick(side, path)}
        onMouseEnter={() => handleMouseEnter(side, path)}
        onMouseLeave={handleMouseLeave}
        className={`
          px-2.5 py-1.5 text-xs rounded-lg transition-all select-none
          ${
            isPaired
              ? "opacity-40 cursor-default"
              : isDragging
                ? "opacity-50 bg-accent/10"
                : "cursor-pointer hover:bg-bg-tertiary"
          }
          ${isSelected ? "ring-2 ring-accent bg-accent/10" : ""}
          ${isDropCandidate ? "ring-2 ring-accent/50 bg-accent/5" : ""}
        `}
      >
        <div className="flex items-center gap-1.5">
          {isPaired && (
            <svg
              className="w-3 h-3 text-success flex-shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={3}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
          <span
            className={`truncate ${isPaired ? "text-text-muted" : "text-text-primary"}`}
            title={getFileName(path)}
          >
            {getFileName(path)}
          </span>
        </div>
      </div>
    );
  };

  const selectionHint = selectedFile
    ? `「${getFileName(selectedFile.path)}」を選択中 — ${
        selectedFile.side === "left" ? "右" : "左"
      }列のファイルをクリックしてペアを作成`
    : null;

  return (
    <div className="space-y-3">
      {selectionHint && (
        <div className="flex items-center gap-2 px-3 py-2 bg-accent/10 rounded-xl border border-accent/20">
          <svg
            className="w-3.5 h-3.5 text-accent flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
          <span className="text-[10px] text-accent">{selectionHint}</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-[10px] text-text-muted font-medium mb-1.5 px-1">
            {leftLabel} ({leftFiles.length})
          </div>
          <div className="border border-border rounded-xl overflow-hidden">
            <div className="max-h-[250px] overflow-y-auto p-1.5 space-y-0.5">
              {leftFiles.map((path) => renderFileItem(path, "left", pairedLeftFiles.has(path)))}
              {leftFiles.length === 0 && (
                <div className="text-[10px] text-text-muted text-center py-4">
                  ファイルがありません
                </div>
              )}
            </div>
          </div>
        </div>

        <div>
          <div className="text-[10px] text-text-muted font-medium mb-1.5 px-1">
            {rightLabel} ({rightFiles.length})
          </div>
          <div className="border border-border rounded-xl overflow-hidden">
            <div className="max-h-[250px] overflow-y-auto p-1.5 space-y-0.5">
              {rightFiles.map((path) => renderFileItem(path, "right", pairedRightFiles.has(path)))}
              {rightFiles.length === 0 && (
                <div className="text-[10px] text-text-muted text-center py-4">
                  ファイルがありません
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div>
        <div className="text-[10px] text-text-muted font-medium mb-1.5 px-1">
          ペア一覧 ({manualPairs.length})
        </div>
        <div className="border border-border rounded-xl overflow-hidden">
          {manualPairs.length === 0 ? (
            <div className="text-[10px] text-text-muted text-center py-4 px-3">
              左右のファイルを1つずつクリックしてペアを作成
            </div>
          ) : (
            <div className="max-h-[160px] overflow-y-auto divide-y divide-border/50">
              {manualPairs.map((pair, idx) => {
                const leftName = isReversed ? pair.targetName : pair.sourceName;
                const rightName = isReversed ? pair.sourceName : pair.targetName;
                return (
                  <div
                    key={pair.pairIndex}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-bg-tertiary/50"
                  >
                    <span className="text-text-muted w-5 text-right flex-shrink-0">{idx + 1}</span>
                    <span className="text-text-primary truncate flex-1" title={leftName}>
                      {leftName}
                    </span>
                    <svg
                      className="w-3 h-3 text-text-muted flex-shrink-0"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M13 7l5 5m0 0l-5 5m5-5H6"
                      />
                    </svg>
                    <span className="text-text-primary truncate flex-1" title={rightName}>
                      {rightName}
                    </span>
                    <button
                      onClick={() => removeManualPair(pair.pairIndex)}
                      className="p-0.5 rounded text-text-muted hover:text-error hover:bg-error/10 transition-colors flex-shrink-0"
                      title="ペアを削除"
                    >
                      <svg
                        className="w-3.5 h-3.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
