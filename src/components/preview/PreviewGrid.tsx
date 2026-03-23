import { useMemo } from "react";
import { usePsdStore } from "../../store/psdStore";
import { useSpecStore } from "../../store/specStore";
import { ThumbnailCard } from "./ThumbnailCard";
import { THUMBNAIL_SIZES } from "../../types";
import { useCanvasSizeCheck } from "../../hooks/useCanvasSizeCheck";

export function PreviewGrid() {
  const files = usePsdStore((state) => state.files);
  const thumbnailSize = usePsdStore((state) => state.thumbnailSize);
  const selectedFileIds = usePsdStore((state) => state.selectedFileIds);
  const activeFileId = usePsdStore((state) => state.activeFileId);
  const selectFile = usePsdStore((state) => state.selectFile);
  const selectRange = usePsdStore((state) => state.selectRange);
  const checkResults = useSpecStore((state) => state.checkResults);
  const { outlierFileIds, majoritySize } = useCanvasSizeCheck();

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

  // 注意判定: NGでない + (サイズ外れ値 OR トンボ混在でトンボなし)
  const getCautionInfo = (fileId: string, file: (typeof files)[0]) => {
    const result = checkResults.get(fileId);
    const isNG = result && !result.passed;
    if (isNG) return { isCaution: false, reasons: [] as string[] };

    const reasons: string[] = [];
    if (outlierFileIds.has(fileId)) reasons.push("size");
    if (hasTomboMix && file.metadata && !file.metadata.hasTombo) reasons.push("tombo");

    return { isCaution: reasons.length > 0, reasons };
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

  const size = THUMBNAIL_SIZES[thumbnailSize].value;

  return (
    <div className="h-full overflow-auto p-4 select-none" data-preview-grid>
      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: `repeat(auto-fill, minmax(${size}px, 1fr))`,
        }}
      >
        {files.map((file) => {
          const { isCaution, reasons } = getCautionInfo(file.id, file);
          return (
            <ThumbnailCard
              key={file.id}
              file={file}
              size={size}
              isSelected={selectedFileIds.includes(file.id)}
              isActive={activeFileId === file.id}
              onClick={(e) => handleClick(file.id, e)}
              isCanvasOutlier={outlierFileIds.has(file.id)}
              majoritySize={majoritySize ?? undefined}
              isCaution={isCaution}
              cautionReasons={reasons}
            />
          );
        })}
      </div>
      {/* フローティングボタンとサムネが重ならないよう余白を確保 */}
      <div className="h-44" />
    </div>
  );
}
