import { usePsdStore } from "../../store/psdStore";
import { FileList } from "./FileList";
import { open } from "@tauri-apps/plugin-dialog";
import { usePsdLoader } from "../../hooks/usePsdLoader";

export function FileBrowser() {
  const currentFolderPath = usePsdStore((state) => state.currentFolderPath);
  const loadingStatus = usePsdStore((state) => state.loadingStatus);
  const setCurrentFolderPath = usePsdStore((state) => state.setCurrentFolderPath);
  const { loadFolder, loadFiles } = usePsdLoader();

  const handleOpenFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "フォルダを選択",
      });

      if (selected && typeof selected === "string") {
        setCurrentFolderPath(selected);
        await loadFolder(selected);
      }
    } catch (error) {
      console.error("Failed to open folder:", error);
    }
  };

  const handleOpenFiles = async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [
          {
            name: "画像ファイル",
            extensions: [
              "psd",
              "psb",
              "jpg",
              "jpeg",
              "png",
              "tif",
              "tiff",
              "bmp",
              "pdf",
              "gif",
              "eps",
            ],
          },
          {
            name: "PSD/PSB",
            extensions: ["psd", "psb"],
          },
        ],
        title: "ファイルを選択",
      });

      if (selected && Array.isArray(selected) && selected.length > 0) {
        await loadFiles(selected);
      }
    } catch (error) {
      console.error("Failed to open files:", error);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Actions */}
      <div className="p-3 border-b border-white/5 space-y-2">
        <button
          className="
            w-full px-4 py-2.5 text-sm font-medium rounded-xl
            bg-bg-tertiary text-text-primary
            border border-white/10 hover:border-accent/30
            hover:bg-bg-elevated
            transition-all duration-200
            disabled:opacity-50 disabled:cursor-not-allowed
            flex items-center justify-center gap-2
          "
          onClick={handleOpenFolder}
          disabled={loadingStatus === "loading"}
        >
          <svg
            className="w-4 h-4"
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
          フォルダを開く
        </button>
        <button
          className="
            w-full px-4 py-2.5 text-sm font-medium rounded-xl
            bg-bg-tertiary text-text-primary
            border border-white/10 hover:border-accent/30
            hover:bg-bg-elevated
            transition-all duration-200
            disabled:opacity-50 disabled:cursor-not-allowed
            flex items-center justify-center gap-2
          "
          onClick={handleOpenFiles}
          disabled={loadingStatus === "loading"}
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          ファイルを選択
        </button>
      </div>

      {/* Current Path */}
      {currentFolderPath && (
        <div className="px-3 py-2 bg-bg-tertiary/50 border-b border-white/5">
          <div className="flex items-center gap-2">
            <svg
              className="w-3.5 h-3.5 text-text-muted flex-shrink-0"
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
            <p className="text-xs text-text-muted truncate" title={currentFolderPath}>
              {currentFolderPath}
            </p>
          </div>
        </div>
      )}

      {/* File List */}
      <div className="flex-1 overflow-auto">
        <FileList />
      </div>

      {/* Loading Indicator */}
      {loadingStatus === "loading" && (
        <div className="px-3 py-2 bg-accent/10 border-t border-accent/20">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
            <span className="text-xs text-accent">読み込み中...</span>
          </div>
        </div>
      )}
    </div>
  );
}
