import { usePsdStore } from "../../store/psdStore";
import { useSpecStore } from "../../store/specStore";

export function PreviewList() {
  const files = usePsdStore((state) => state.files);
  const selectedFileIds = usePsdStore((state) => state.selectedFileIds);
  const activeFileId = usePsdStore((state) => state.activeFileId);
  const selectFile = usePsdStore((state) => state.selectFile);
  const selectRange = usePsdStore((state) => state.selectRange);
  const checkResults = useSpecStore((state) => state.checkResults);

  const handleClick = (fileId: string, e: React.MouseEvent) => {
    if (e.shiftKey) {
      selectRange(fileId);
    } else if (e.ctrlKey || e.metaKey) {
      selectFile(fileId, true);
    } else {
      selectFile(fileId);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="h-full overflow-auto select-none">
      {/* Header */}
      <div className="sticky top-0 bg-bg-secondary border-b border-text-muted/10 px-4 py-2 grid grid-cols-[auto_1fr_100px_100px_80px_80px_60px] gap-4 text-xs font-medium text-text-muted">
        <div className="w-12">サムネ</div>
        <div>ファイル名</div>
        <div>サイズ</div>
        <div>解像度</div>
        <div>DPI</div>
        <div>モード</div>
        <div>ガイド</div>
      </div>

      {/* Rows */}
      {files.map((file) => {
        const isSelected = selectedFileIds.includes(file.id);
        const isActive = activeFileId === file.id;
        const checkResult = checkResults.get(file.id);
        const hasError = checkResult && !checkResult.passed;

        return (
          <div
            key={file.id}
            className={`
              grid grid-cols-[auto_1fr_100px_100px_80px_80px_60px] gap-4 items-center
              px-4 py-2 cursor-pointer transition-colors border-b border-text-muted/5
              ${
                isActive
                  ? "bg-accent/20"
                  : isSelected
                    ? "bg-bg-tertiary"
                    : "hover:bg-bg-tertiary/50"
              }
              ${hasError ? "border-l-2 border-l-error" : ""}
            `}
            onClick={(e) => handleClick(file.id, e)}
          >
            {/* Thumbnail */}
            <div className="w-12 h-16 bg-bg-tertiary rounded overflow-hidden flex items-center justify-center">
              {file.thumbnailUrl ? (
                <img
                  src={file.thumbnailUrl}
                  alt={file.fileName}
                  className="max-w-full max-h-full object-contain"
                />
              ) : file.thumbnailStatus === "loading" ? (
                <div className="w-4 h-4 border border-accent border-t-transparent rounded-full animate-spin" />
              ) : (
                <div className="text-text-muted text-[8px]">-</div>
              )}
            </div>

            {/* File Name */}
            <div className="text-sm text-text-primary truncate" title={file.fileName}>
              {file.fileName}
            </div>

            {/* Dimensions */}
            <div className="text-xs text-text-secondary font-mono">
              {file.metadata ? `${file.metadata.width} × ${file.metadata.height}` : "-"}
            </div>

            {/* File Size */}
            <div className="text-xs text-text-secondary">
              {file.fileSize ? formatFileSize(file.fileSize) : "-"}
            </div>

            {/* DPI */}
            <div className="text-xs text-text-secondary font-mono">{file.metadata?.dpi || "-"}</div>

            {/* Color Mode */}
            <div>
              {file.metadata && (
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded ${
                    file.metadata.colorMode === "RGB"
                      ? "bg-success/20 text-success"
                      : file.metadata.colorMode === "Grayscale"
                        ? "bg-text-secondary/20 text-text-secondary"
                        : "bg-cyan-500/20 text-cyan-400"
                  }`}
                >
                  {file.metadata.colorMode}
                </span>
              )}
            </div>

            {/* Guides */}
            <div className="text-xs">
              {file.metadata?.hasGuides ? (
                <span className="text-guide-v">{file.metadata.guides.length}本</span>
              ) : (
                <span className="text-text-muted">なし</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
