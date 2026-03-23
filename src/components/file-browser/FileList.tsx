import { usePsdStore } from "../../store/psdStore";
import { useSpecStore } from "../../store/specStore";
import type { PsdFile } from "../../types";

export function FileList() {
  const files = usePsdStore((state) => state.files);
  const selectedFileIds = usePsdStore((state) => state.selectedFileIds);
  const activeFileId = usePsdStore((state) => state.activeFileId);
  const selectFile = usePsdStore((state) => state.selectFile);
  const selectRange = usePsdStore((state) => state.selectRange);
  const loadingStatus = usePsdStore((state) => state.loadingStatus);
  const checkResults = useSpecStore((state) => state.checkResults);

  const handleClick = (file: PsdFile, e: React.MouseEvent) => {
    if (e.shiftKey) {
      selectRange(file.id);
    } else if (e.ctrlKey || e.metaKey) {
      selectFile(file.id, true);
    } else {
      selectFile(file.id);
    }
  };

  if (loadingStatus === "loading") {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="text-text-muted text-sm">読み込み中...</div>
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-text-muted text-sm">
        ファイルがありません
      </div>
    );
  }

  return (
    <div className="py-1 select-none">
      {files.map((file) => {
        const isSelected = selectedFileIds.includes(file.id);
        const isActive = activeFileId === file.id;
        const checkResult = checkResults.get(file.id);
        const hasError = checkResult && !checkResult.passed;

        return (
          <div
            key={file.id}
            className={`
              flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors
              ${isActive ? "bg-accent/20" : isSelected ? "bg-bg-tertiary" : "hover:bg-bg-tertiary/50"}
              ${hasError ? "border-l-2 border-error" : ""}
            `}
            onClick={(e) => handleClick(file, e)}
          >
            {/* Status Indicator */}
            <div className="w-2 h-2 rounded-full flex-shrink-0">
              {file.thumbnailStatus === "loading" && (
                <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
              )}
              {file.thumbnailStatus === "ready" && (
                <div className="w-2 h-2 rounded-full bg-success" />
              )}
              {file.thumbnailStatus === "error" && (
                <div className="w-2 h-2 rounded-full bg-error" />
              )}
            </div>

            {/* File Name */}
            <span
              className={`flex-1 text-sm truncate ${
                isActive ? "text-text-primary" : "text-text-secondary"
              }`}
              title={file.fileName}
            >
              {file.fileName}
            </span>

            {/* Color Mode Badge */}
            {file.metadata && (
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded ${
                  file.metadata.colorMode === "RGB"
                    ? "bg-success/20 text-success"
                    : file.metadata.colorMode === "Grayscale"
                      ? "bg-text-secondary/20 text-text-secondary"
                      : file.metadata.colorMode === "CMYK"
                        ? "bg-cyan-500/20 text-cyan-400"
                        : "bg-text-muted/20 text-text-muted"
                }`}
              >
                {file.metadata.colorMode}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
