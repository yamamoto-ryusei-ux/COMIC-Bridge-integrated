import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePsdStore } from "../../store/psdStore";
import { useTypesettingCheckStore } from "../../store/typesettingCheckStore";
import {
  useHighResPreview,
  prefetchPreview,
  invalidateUrlCache,
} from "../../hooks/useHighResPreview";
import { useOpenFolder } from "../../hooks/useOpenFolder";
import { useOpenInPhotoshop } from "../../hooks/useOpenInPhotoshop";

export function TypesettingViewerPanel() {
  const files = usePsdStore((s) => s.files);
  const selectedFileIds = usePsdStore((s) => s.selectedFileIds);
  const viewerFileIndex = useTypesettingCheckStore((s) => s.viewerFileIndex);
  const setViewerFileIndex = useTypesettingCheckStore((s) => s.setViewerFileIndex);
  const { openFolderForFile } = useOpenFolder();
  const { openFileInPhotoshop } = useOpenInPhotoshop();
  const viewerRef = useRef<HTMLDivElement>(null);

  const viewerFile = files[viewerFileIndex] ?? files[0] ?? null;

  // High-res preview
  const {
    imageUrl,
    isLoading,
    error: viewerError,
    reload: viewerReload,
  } = useHighResPreview(viewerFile?.filePath, {
    maxSize: 2000,
    enabled: !!viewerFile,
    pdfPageIndex: viewerFile?.pdfPageIndex,
    pdfSourcePath: viewerFile?.pdfSourcePath,
  });

  // ファイル外部変更時のリロード
  useEffect(() => {
    if (!viewerFile?.fileChanged || !viewerFile.filePath) return;
    invalidateUrlCache(viewerFile.filePath);
    invoke("invalidate_file_cache", { filePath: viewerFile.filePath }).catch(() => {});
    viewerReload();
  }, [viewerFile?.fileChanged, viewerFile?.filePath]);

  // ファイル数変更時にインデックスリセット
  useEffect(() => {
    setViewerFileIndex(0);
  }, [files.length, setViewerFileIndex]);

  // サイドバー選択との同期
  useEffect(() => {
    if (selectedFileIds.length === 0) return;
    const idx = files.findIndex((f) => f.id === selectedFileIds[0]);
    if (idx >= 0) setViewerFileIndex(idx);
  }, [selectedFileIds, files, setViewerFileIndex]);

  // 隣接ファイル先読み (±3)
  useEffect(() => {
    if (files.length <= 1) return;
    for (let offset = 1; offset <= 3; offset++) {
      for (const idx of [viewerFileIndex - offset, viewerFileIndex + offset]) {
        if (idx < 0 || idx >= files.length) continue;
        const f = files[idx];
        if (!f?.filePath) continue;
        prefetchPreview(f.filePath, 2000, f.pdfPageIndex, f.pdfSourcePath);
      }
    }
  }, [viewerFileIndex, files]);

  // キーボード: ←→ ページ送り
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (files.length <= 1) return;

      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        setViewerFileIndex(Math.max(0, viewerFileIndex - 1));
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        setViewerFileIndex(Math.min(files.length - 1, viewerFileIndex + 1));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [files.length, viewerFileIndex, setViewerFileIndex]);

  // マウスホイール ページ送り
  useEffect(() => {
    const el = viewerRef.current;
    if (!el || files.length <= 1) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const idx = useTypesettingCheckStore.getState().viewerFileIndex;
      if (e.deltaY > 0) {
        useTypesettingCheckStore.getState().setViewerFileIndex(Math.min(files.length - 1, idx + 1));
      } else if (e.deltaY < 0) {
        useTypesettingCheckStore.getState().setViewerFileIndex(Math.max(0, idx - 1));
      }
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [files.length]);

  // P/F ショートカット (capture phase)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!viewerFile) return;

      if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        e.stopImmediatePropagation();
        openFileInPhotoshop(viewerFile.filePath);
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        e.stopImmediatePropagation();
        openFolderForFile(viewerFile.filePath);
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [viewerFile, openFileInPhotoshop, openFolderForFile]);

  if (files.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[11px] text-text-muted">
        ファイルを読み込んでください
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border flex-shrink-0 bg-bg-secondary">
        <div className="flex items-center gap-2">
          <span className="text-xs font-display font-medium text-text-primary truncate flex-1">
            {viewerFile?.fileName}
          </span>
          {files.length > 1 && (
            <span className="text-[10px] text-text-muted flex-shrink-0">
              {viewerFileIndex + 1} / {files.length}
            </span>
          )}
          {viewerFile && (
            <button
              className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded transition-all text-text-muted hover:text-text-primary hover:bg-bg-tertiary active:scale-95"
              onClick={() => openFolderForFile(viewerFile.filePath)}
              title="フォルダを開く (F)"
            >
              <svg
                className="w-3.5 h-3.5"
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
            </button>
          )}
          {viewerFile && (
            <button
              className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded transition-all text-[#31A8FF] hover:bg-[#31A8FF]/15 active:scale-95"
              onClick={() => openFileInPhotoshop(viewerFile.filePath)}
              title="Photoshopで開く (P)"
            >
              <span className="text-sm font-bold leading-none">Ps</span>
            </button>
          )}
        </div>
        {/* メタデータバッジ */}
        {viewerFile?.metadata && (
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-text-muted">
              {viewerFile.metadata.width} x {viewerFile.metadata.height}
            </span>
            <span className="text-[10px] text-text-muted">{viewerFile.metadata.dpi} dpi</span>
            <span className="text-[10px] text-text-muted">{viewerFile.metadata.colorMode}</span>
          </div>
        )}
      </div>

      {/* Image Viewer */}
      <div
        ref={viewerRef}
        className="flex-1 overflow-hidden relative flex items-center justify-center bg-[#1a1a1e]"
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={viewerFile?.fileName}
            className={`max-w-full max-h-full object-contain select-none transition-opacity duration-150 ${isLoading ? "opacity-40" : "opacity-100"}`}
            draggable={false}
          />
        ) : viewerFile?.thumbnailUrl ? (
          <img
            src={viewerFile.thumbnailUrl}
            alt={viewerFile.fileName}
            className="max-w-full max-h-full object-contain select-none opacity-60"
            draggable={false}
          />
        ) : null}

        {/* Loading spinner */}
        {isLoading && (
          <div className="absolute top-3 right-3 z-10">
            <div className="w-5 h-5 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
          </div>
        )}

        {/* Error state */}
        {viewerError && !imageUrl && (
          <div className="flex flex-col items-center gap-2 text-center px-6">
            <svg
              className="w-8 h-8 text-error/50"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
              />
            </svg>
            <p className="text-[11px] text-text-muted">プレビューの読み込みに失敗</p>
            <button
              onClick={viewerReload}
              className="text-[10px] text-accent hover:text-accent/80 transition-colors"
            >
              再試行
            </button>
          </div>
        )}

        {/* Navigation arrows */}
        {files.length > 1 && (
          <>
            {viewerFileIndex > 0 && (
              <button
                onClick={() => setViewerFileIndex(viewerFileIndex - 1)}
                className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center text-white/70 hover:text-white transition-all backdrop-blur-sm"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            {viewerFileIndex < files.length - 1 && (
              <button
                onClick={() => setViewerFileIndex(viewerFileIndex + 1)}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center text-white/70 hover:text-white transition-all backdrop-blur-sm"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
