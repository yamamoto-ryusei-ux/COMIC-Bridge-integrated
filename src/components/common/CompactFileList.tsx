import { useMemo } from "react";
import { usePsdStore } from "../../store/psdStore";
import { useSpecStore } from "../../store/specStore";
import { usePageNumberCheck } from "../../hooks/usePageNumberCheck";
import { useCanvasSizeCheck } from "../../hooks/useCanvasSizeCheck";

export function CompactFileList({ className = "" }: { className?: string }) {
  const files = usePsdStore((state) => state.files);
  const selectedFileIds = usePsdStore((state) => state.selectedFileIds);
  const activeFileId = usePsdStore((state) => state.activeFileId);
  const selectFile = usePsdStore((state) => state.selectFile);
  const selectRange = usePsdStore((state) => state.selectRange);
  const selectAll = usePsdStore((state) => state.selectAll);
  const clearSelection = usePsdStore((state) => state.clearSelection);
  const checkResults = useSpecStore((state) => state.checkResults);
  const { pageNumbers, missingNumbers } = usePageNumberCheck();
  const { outlierFileIds } = useCanvasSizeCheck();

  // トンボ混在判定
  const hasTomboMix = useMemo(() => {
    let has = 0,
      no = 0;
    for (const file of files) {
      if (!file.metadata) continue;
      if (file.metadata.hasTombo) has++;
      else no++;
      if (has > 0 && no > 0) return true;
    }
    return false;
  }, [files]);

  // 各ファイル間の欠番を計算
  const getGapAfter = (currentIndex: number): number[] => {
    if (currentIndex >= files.length - 1) return [];
    const currentNum = pageNumbers.get(files[currentIndex].id);
    const nextNum = pageNumbers.get(files[currentIndex + 1].id);
    if (
      currentNum === null ||
      currentNum === undefined ||
      nextNum === null ||
      nextNum === undefined
    )
      return [];
    const gaps: number[] = [];
    for (let i = currentNum + 1; i < nextNum; i++) {
      if (missingNumbers.includes(i)) gaps.push(i);
    }
    return gaps;
  };

  const handleClick = (fileId: string, e: React.MouseEvent) => {
    if (e.shiftKey) {
      selectRange(fileId);
    } else if (e.ctrlKey || e.metaKey) {
      selectFile(fileId, true);
    } else {
      selectFile(fileId);
    }
  };

  return (
    <div className={`flex flex-col bg-bg-secondary select-none ${className}`}>
      {/* Header */}
      <div className="px-3 py-2 border-b border-border flex items-center justify-between flex-shrink-0">
        <span className="text-xs font-medium text-text-muted">{files.length} ファイル</span>
        <div className="flex items-center gap-2">
          <button
            className="text-[10px] text-text-muted hover:text-accent transition-colors"
            onClick={selectAll}
          >
            全選択
          </button>
          {selectedFileIds.length > 0 && (
            <button
              className="text-[10px] text-text-muted hover:text-accent transition-colors"
              onClick={clearSelection}
            >
              解除
            </button>
          )}
        </div>
      </div>

      {/* File List */}
      <div className="flex-1 overflow-auto">
        {files.map((file, index) => {
          const isSelected = selectedFileIds.includes(file.id);
          const isActive = activeFileId === file.id;
          const checkResult = checkResults.get(file.id);
          const hasError = checkResult && !checkResult.passed;
          const isCaution =
            !hasError &&
            (outlierFileIds.has(file.id) ||
              (hasTomboMix && file.metadata && !file.metadata.hasTombo));
          const gaps = getGapAfter(index);

          // サブフォルダ区切りヘッダー（前のファイルとサブフォルダ名が変わったら表示）
          const prevSubfolder = index > 0 ? files[index - 1].subfolderName || "" : null;
          const currentSubfolder = file.subfolderName || "";
          const showSubfolderHeader = currentSubfolder && prevSubfolder !== currentSubfolder;

          return (
            <div key={file.id}>
              {/* サブフォルダ区切りヘッダー */}
              {showSubfolderHeader && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-warm/5 border-b border-accent-warm/20 sticky top-0 z-10">
                  <svg
                    className="w-3 h-3 text-accent-warm/60 flex-shrink-0"
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
                  <span className="text-[10px] font-semibold text-accent-warm/80 truncate">
                    {currentSubfolder}
                  </span>
                </div>
              )}

              <div
                className={`
                  flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors
                  border-b border-border/30 text-xs
                  ${
                    isActive
                      ? "bg-accent/15"
                      : isSelected
                        ? "bg-accent/8"
                        : "hover:bg-bg-tertiary/50"
                  }
                `}
                onClick={(e) => handleClick(file.id, e)}
              >
                {/* Selection indicator */}
                <div
                  className={`w-3 h-3 rounded flex items-center justify-center flex-shrink-0
                    ${
                      isSelected
                        ? "bg-gradient-to-br from-accent to-accent-secondary"
                        : "border border-text-muted/30"
                    }
                  `}
                >
                  {isSelected && (
                    <svg
                      className="w-2 h-2 text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={3}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>

                {/* Status dot */}
                {hasError ? (
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-error" />
                ) : isCaution ? (
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-warning" />
                ) : checkResult ? (
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-success" />
                ) : null}

                {/* Filename */}
                <span
                  className={`truncate ${hasError ? "text-error/80" : "text-text-primary"}`}
                  title={file.fileName}
                >
                  {file.fileName}
                </span>
              </div>

              {/* 欠番ギャップインジケータ */}
              {gaps.length > 0 && (
                <div className="flex items-center gap-1.5 px-3 py-1 bg-warning/5 border-b border-warning/20">
                  <svg
                    className="w-3 h-3 text-warning flex-shrink-0"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span className="text-[10px] text-warning">
                    {gaps.length === 1
                      ? `p.${gaps[0]} 欠番`
                      : `p.${gaps[0]}〜${gaps[gaps.length - 1]} 欠番 (${gaps.length}件)`}
                  </span>
                </div>
              )}
            </div>
          );
        })}

        {files.length === 0 && (
          <div className="flex items-center justify-center h-24 text-text-muted text-xs">
            ファイルなし
          </div>
        )}
      </div>

      {/* Footer */}
      {selectedFileIds.length > 0 && (
        <div className="px-3 py-1.5 border-t border-border flex-shrink-0">
          <span className="text-[10px] text-accent font-medium">
            {selectedFileIds.length} 件選択中
          </span>
        </div>
      )}
    </div>
  );
}
