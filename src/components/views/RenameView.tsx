import { useState, useEffect, useCallback, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { readDir } from "@tauri-apps/plugin-fs";
import { useRenameStore, internalDragState } from "../../store/renameStore";
import { usePsdStore } from "../../store/psdStore";
import { usePsdLoader } from "../../hooks/usePsdLoader";
import { isSupportedFile, isPsdFile } from "../../types";
import { LayerRenamePanel } from "../rename/LayerRenamePanel";
import { FileRenamePanel } from "../rename/FileRenamePanel";
import { RenamePreview } from "../rename/RenamePreview";
import { RenameResultDialog } from "../rename/RenameResultDialog";
import type { PsdFile } from "../../types";
import type { RenameSubMode, FileRenameEntry } from "../../types/rename";

const SUB_TABS: { id: RenameSubMode; label: string }[] = [
  { id: "file", label: "ファイルリネーム" },
  { id: "layer", label: "レイヤーリネーム" },
];

export function RenameView() {
  const subMode = useRenameStore((s) => s.subMode);
  const setSubMode = useRenameStore((s) => s.setSubMode);
  const addFileEntries = useRenameStore((s) => s.addFileEntries);
  const fileEntries = useRenameStore((s) => s.fileEntries);
  const { loadFiles } = usePsdLoader();
  const [isDragOver, setIsDragOver] = useState(false);

  // fileEntries 内の PSD/PSB を psdStore へ自動同期（レイヤーリネーム用）
  const syncedPathsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const psdPaths = fileEntries.filter((e) => isPsdFile(e.fileName)).map((e) => e.filePath);

    // 未同期の PSD パスを抽出
    const existingPaths = new Set(usePsdStore.getState().files.map((f) => f.filePath));
    const newPaths = psdPaths.filter(
      (p) => !existingPaths.has(p) && !syncedPathsRef.current.has(p),
    );
    if (newPaths.length === 0) return;

    // 同期中マーク
    for (const p of newPaths) syncedPathsRef.current.add(p);

    const syncPsdFiles = async () => {
      const skeletons: PsdFile[] = newPaths.map((filePath, idx) => ({
        id: `rename-sync-${Date.now()}-${idx}`,
        filePath,
        fileName: filePath.split(/[\\/]/).pop() || "",
        fileSize: 0,
        modifiedTime: Date.now(),
        thumbnailStatus: "pending" as const,
      }));

      usePsdStore.getState().addFiles(skeletons);
      const { updateFile } = usePsdStore.getState();

      try {
        const results = await invoke<
          {
            filePath: string;
            metadata: any;
            thumbnailData: string | null;
            fileSize: number;
            error: string | null;
          }[]
        >("parse_psd_metadata_batch", { filePaths: skeletons.map((f) => f.filePath) });
        for (const result of results) {
          const file = skeletons.find((f) => f.filePath === result.filePath);
          if (!file || !result.metadata) continue;
          const thumbnailUrl = result.thumbnailData
            ? `data:image/jpeg;base64,${result.thumbnailData}`
            : undefined;
          updateFile(file.id, {
            metadata: result.metadata,
            thumbnailUrl,
            thumbnailStatus: "ready",
            fileSize: result.fileSize,
          });
        }
      } catch (err) {
        console.error("PSD sync failed:", err);
      }
    };

    syncPsdFiles();
  }, [fileEntries]);

  // Tauri native drag-drop handler
  const handleDrop = useCallback(
    async (paths: string[]) => {
      if (!paths || paths.length === 0) return;

      const currentSubMode = useRenameStore.getState().subMode;

      if (currentSubMode === "file") {
        // ファイルリネームモード: fileEntries に追加
        for (const path of paths) {
          let folderPath: string;
          let files: string[];

          try {
            // フォルダかどうかを readDir で判定
            const entries = await readDir(path);
            folderPath = path;
            files = entries
              .filter((e) => e.isFile && e.name && isSupportedFile(e.name))
              .map((e) => `${path}\\${e.name}`);
          } catch {
            // readDir 失敗 → ファイルとして扱う
            if (isSupportedFile(path)) {
              folderPath = path.replace(/[\\/][^\\/]+$/, "");
              files = [path];
            } else {
              continue;
            }
          }

          if (files.length === 0) continue;

          const folderParts = folderPath.replace(/\\/g, "/").split("/");
          const folderName =
            folderParts[folderParts.length - 1] ||
            folderParts[folderParts.length - 2] ||
            folderPath;

          const newEntries: FileRenameEntry[] = files.map((f) => {
            const name = f.split(/[\\/]/).pop() || "";
            return {
              id: crypto.randomUUID(),
              filePath: f,
              fileName: name,
              folderPath,
              folderName,
              selected: true,
              customName: null,
            };
          });

          addFileEntries(newEntries);
        }
      } else {
        // レイヤーリネームモード: psdStore にロード（グローバルハンドラと同じ動作）
        const imageFiles: string[] = [];

        for (const path of paths) {
          try {
            const entries = await readDir(path);
            for (const entry of entries) {
              if (entry.isFile && entry.name && isSupportedFile(entry.name)) {
                imageFiles.push(`${path}\\${entry.name}`);
              }
            }
          } catch {
            if (isSupportedFile(path)) {
              imageFiles.push(path);
            }
          }
        }

        if (imageFiles.length > 0) {
          await loadFiles(imageFiles);
        }
      }
    },
    [addFileEntries, loadFiles],
  );

  useEffect(() => {
    const currentWindow = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    let mounted = true;

    const setup = async () => {
      const fn = await currentWindow.onDragDropEvent((event) => {
        // 内部ドラッグ（フォルダ並替え等）中はオーバーレイを抑制
        if (internalDragState.active) return;

        if (event.payload.type === "over") {
          setIsDragOver(true);
        } else if (event.payload.type === "leave") {
          setIsDragOver(false);
        } else if (event.payload.type === "drop") {
          setIsDragOver(false);
          handleDrop(event.payload.paths);
        }
      });

      if (mounted) {
        unlisten = fn;
      } else {
        fn();
      }
    };

    setup();
    return () => {
      mounted = false;
      if (unlisten) unlisten();
    };
  }, [handleDrop]);

  // ブラウザのデフォルトdrag挙動を防止
  const preventDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      data-tool-panel
      onDragOver={preventDrag}
      onDragLeave={preventDrag}
      onDrop={preventDrag}
    >
      {/* Sub-mode tabs */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-border bg-bg-secondary/50">
        {SUB_TABS.map((tab) => {
          const isActive = subMode === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setSubMode(tab.id)}
              className={`
                px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-200
                ${
                  isActive
                    ? "bg-accent/15 text-accent border border-accent/30"
                    : "text-text-muted hover:text-text-secondary hover:bg-bg-tertiary border border-transparent"
                }
              `}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Left settings panel */}
        <div className="w-[360px] flex-shrink-0 border-r border-border overflow-hidden">
          {subMode === "layer" ? <LayerRenamePanel /> : <FileRenamePanel />}
        </div>

        {/* Right preview panel */}
        <div className="flex-1 flex flex-col overflow-hidden bg-bg-primary relative">
          <RenamePreview />

          {/* Drag overlay */}
          {isDragOver && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-bg-primary/80 backdrop-blur-sm border-2 border-dashed border-accent-secondary rounded-lg m-2 pointer-events-none">
              <div className="text-center space-y-3">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-accent-secondary to-accent-tertiary flex items-center justify-center shadow-lg animate-pulse">
                  <svg
                    className="w-8 h-8 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    {subMode === "file" ? (
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                      />
                    ) : (
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
                      />
                    )}
                  </svg>
                </div>
                <p className="text-sm font-medium text-accent-secondary">
                  {subMode === "file"
                    ? "ファイル / フォルダをドロップして追加"
                    : "PSDファイル / フォルダをドロップして読み込み"}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Result Dialog */}
      <RenameResultDialog />
    </div>
  );
}
