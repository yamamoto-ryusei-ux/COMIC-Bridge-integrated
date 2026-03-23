import { useState, useEffect } from "react";
import { TiffSettingsPanel } from "../tiff/TiffSettingsPanel";
import { TiffBatchQueue } from "../tiff/TiffBatchQueue";
import { TiffCropEditor } from "../tiff/TiffCropEditor";
import { TiffViewerPanel } from "../tiff/TiffViewerPanel";
import { TiffFileList } from "../tiff/TiffFileList";
import { usePsdStore } from "../../store/psdStore";
import { useTiffStore } from "../../store/tiffStore";
import { DropZone } from "../file-browser/DropZone";

export function TiffView() {
  const files = usePsdStore((state) => state.files);
  const selectedFileIds = usePsdStore((state) => state.selectedFileIds);
  const hasFiles = files.length > 0;
  const [centerView, setCenterView] = useState<"preview" | "queue" | "viewer">("preview");

  const perFileEditTarget = useTiffStore((state) => state.perFileEditTarget);
  const setPerFileEditTarget = useTiffStore((state) => state.setPerFileEditTarget);
  const setReferenceFileIndex = useTiffStore((state) => state.setReferenceFileIndex);

  // ファイル別クロップ編集モードが有効になったらプレビュータブへ自動切替
  useEffect(() => {
    if (perFileEditTarget) {
      setCenterView("preview");
    }
  }, [perFileEditTarget]);

  // ファイルリストから個別クロップエディタを開く
  const handleOpenCropEditor = (fileId: string, fileIndex: number) => {
    setPerFileEditTarget(fileId);
    setReferenceFileIndex(fileIndex + 1);
    setCenterView("preview");
  };

  if (!hasFiles) {
    return <DropZone />;
  }

  return (
    <div className="flex h-full overflow-hidden" data-tool-panel>
      {/* Left Sidebar — 設定 */}
      <div className="w-[400px] flex-shrink-0 border-r border-border overflow-hidden">
        <TiffSettingsPanel />
      </div>

      {/* File List — 設定とプレビューの間: スキップ切替 + 個別設定 */}
      <div className="w-[210px] flex-shrink-0 border-r border-border overflow-hidden">
        <TiffFileList onOpenCropEditor={handleOpenCropEditor} />
      </div>

      {/* Center Area */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* View toggle */}
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border/50 bg-bg-primary flex-shrink-0">
          <button
            onClick={() => setCenterView("preview")}
            className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all ${
              centerView === "preview"
                ? "bg-accent-warm/10 text-accent-warm"
                : "text-text-muted hover:text-text-secondary hover:bg-bg-tertiary/50"
            }`}
          >
            プレビュー
          </button>
          <button
            onClick={() => setCenterView("queue")}
            className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all ${
              centerView === "queue"
                ? "bg-accent-warm/10 text-accent-warm"
                : "text-text-muted hover:text-text-secondary hover:bg-bg-tertiary/50"
            }`}
          >
            一覧
          </button>
          <button
            onClick={() => setCenterView("viewer")}
            className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all ${
              centerView === "viewer"
                ? "bg-accent-warm/10 text-accent-warm"
                : "text-text-muted hover:text-text-secondary hover:bg-bg-tertiary/50"
            }`}
          >
            ビューアー
          </button>
          <div className="flex-1" />
          {selectedFileIds.length > 0 && (
            <span className="text-[10px] text-accent font-medium">
              {selectedFileIds.length}件選択中
            </span>
          )}
        </div>

        <div className="flex-1 overflow-hidden">
          {centerView === "preview" && (
            <TiffCropEditor onSwitchToQueue={() => setCenterView("queue")} />
          )}
          {centerView === "queue" && (
            <TiffBatchQueue onSwitchToPreview={() => setCenterView("preview")} />
          )}
          {centerView === "viewer" && <TiffViewerPanel />}
        </div>
      </div>
    </div>
  );
}
