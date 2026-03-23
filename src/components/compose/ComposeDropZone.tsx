import { useState, useEffect, useRef, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { readDir, stat } from "@tauri-apps/plugin-fs";
import { useComposeStore } from "../../store/composeStore";

/** readDir でフォルダ内のファイル数をカウント */
async function countFiles(folderPath: string): Promise<number> {
  const entries = await readDir(folderPath);
  return entries.filter((e) => e.isFile).length;
}

type DragTarget = "source" | "target" | null;

export function ComposeDropZone() {
  const folders = useComposeStore((s) => s.folders);
  const setSourceFolder = useComposeStore((s) => s.setSourceFolder);
  const setTargetFolder = useComposeStore((s) => s.setTargetFolder);

  const [dragTarget, setDragTarget] = useState<DragTarget>(null);
  const [sourceFileCount, setSourceFileCount] = useState<number | null>(null);
  const [targetFileCount, setTargetFileCount] = useState<number | null>(null);

  const sourceRef = useRef<HTMLDivElement>(null!);
  const targetRef = useRef<HTMLDivElement>(null!);

  // ファイル数カウント
  useEffect(() => {
    if (folders.sourceFiles) {
      setSourceFileCount(folders.sourceFiles.length);
    } else if (folders.sourceFolder) {
      countFiles(folders.sourceFolder)
        .then(setSourceFileCount)
        .catch(() => setSourceFileCount(null));
    } else {
      setSourceFileCount(null);
    }
  }, [folders.sourceFolder, folders.sourceFiles]);

  useEffect(() => {
    if (folders.targetFiles) {
      setTargetFileCount(folders.targetFiles.length);
    } else if (folders.targetFolder) {
      countFiles(folders.targetFolder)
        .then(setTargetFileCount)
        .catch(() => setTargetFileCount(null));
    } else {
      setTargetFileCount(null);
    }
  }, [folders.targetFolder, folders.targetFiles]);

  // ドロップ位置判定
  const getDragTarget = useCallback((x: number, y: number): DragTarget => {
    const hitTest = (ref: React.RefObject<HTMLDivElement | null>) => {
      if (!ref.current) return false;
      const r = ref.current.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    };

    if (hitTest(sourceRef)) return "source";
    if (hitTest(targetRef)) return "target";
    return null;
  }, []);

  // ドロップハンドラ
  const handleDrop = useCallback(
    async (paths: string[], target: DragTarget) => {
      if (!paths.length || !target) return;

      let folderPath = paths[0];
      let fileList: string[] | null = null;

      try {
        const info = await stat(paths[0]);
        if (info.isFile) {
          folderPath = paths[0].replace(/[\\/][^\\/]+$/, "");
          fileList = paths;
        }
      } catch {
        if (/\.(psd|psb|tif|tiff|jpg|jpeg|png|bmp|gif|webp)$/i.test(paths[0])) {
          folderPath = paths[0].replace(/[\\/][^\\/]+$/, "");
          fileList = paths;
        }
      }

      switch (target) {
        case "source":
          setSourceFolder(folderPath, fileList);
          break;
        case "target":
          setTargetFolder(folderPath, fileList);
          break;
      }
    },
    [setSourceFolder, setTargetFolder],
  );

  // Tauri drag-drop event
  useEffect(() => {
    const currentWindow = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    let mounted = true;

    const setup = async () => {
      const fn = await currentWindow.onDragDropEvent((event) => {
        const dpr = window.devicePixelRatio || 1;

        if (event.payload.type === "over") {
          const pos = event.payload.position;
          setDragTarget(getDragTarget(pos.x / dpr, pos.y / dpr));
        } else if (event.payload.type === "leave") {
          setDragTarget(null);
        } else if (event.payload.type === "drop") {
          const pos = event.payload.position;
          const target = getDragTarget(pos.x / dpr, pos.y / dpr);
          handleDrop(event.payload.paths, target);
          setDragTarget(null);
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
  }, [getDragTarget, handleDrop]);

  // ダイアログでフォルダ選択
  const handleSelectFolder = async (type: "source" | "target") => {
    const titles: Record<string, string> = {
      source: "原稿Aフォルダを選択",
      target: "原稿Bフォルダを選択",
    };
    const selected = await open({ directory: true, title: titles[type] });
    if (selected) {
      handleDrop([selected as string], type);
    }
  };

  // 準備完了判定
  const sourceOk = !!folders.sourceFolder && sourceFileCount !== 0;
  const targetOk = !!folders.targetFolder && targetFileCount !== 0;
  const isReady = sourceOk && targetOk;

  // ブラウザのデフォルトdrag挙動を防止
  const preventDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      className="flex items-center justify-center h-full p-6"
      onDragOver={preventDrag}
      onDragLeave={preventDrag}
      onDrop={preventDrag}
    >
      <div className="flex items-stretch gap-6 w-full max-w-5xl">
        {/* === 原稿A（左） === */}
        <div ref={sourceRef} className="flex-1 min-w-0">
          <DropCard
            label="原稿A"
            sublabel="合成元ファイル"
            icon={<SourceIcon />}
            color="pink"
            folderPath={folders.sourceFolder}
            fileCount={sourceFileCount}
            isFileSelection={!!folders.sourceFiles}
            isDragOver={dragTarget === "source"}
            onSelect={() => handleSelectFolder("source")}
            onClear={() => setSourceFolder(null)}
          />
        </div>

        {/* === 中央ステータス + 矢印 === */}
        <div className="flex-shrink-0 flex flex-col items-center justify-center gap-3 px-1">
          {isReady ? (
            <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-accent-tertiary/15">
              <svg
                className="w-3 h-3 text-accent-tertiary"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={3}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-[10px] font-medium text-accent-tertiary">準備完了</span>
            </span>
          ) : (
            <span className="text-[10px] font-medium text-text-muted">合成</span>
          )}

          {/* 大きな方向矢印（双方向） */}
          <div
            className={`
            w-14 h-14 rounded-full flex items-center justify-center
            transition-all duration-500
            ${
              isReady
                ? "bg-accent-tertiary/15 border-2 border-accent-tertiary/30"
                : "bg-bg-tertiary border border-border/50 opacity-30 scale-90"
            }
          `}
          >
            <svg
              className={`w-7 h-7 ${isReady ? "text-accent-tertiary" : "text-text-muted"}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8 7h12m0 0l-4-4m4 4l-4 4M16 17H4m0 0l4-4m-4 4l4 4"
              />
            </svg>
          </div>
        </div>

        {/* === 原稿B（右） === */}
        <div ref={targetRef} className="flex-1 min-w-0">
          <DropCard
            label="原稿B"
            sublabel="合成元ファイル"
            icon={<TargetIcon />}
            color="purple"
            folderPath={folders.targetFolder}
            fileCount={targetFileCount}
            isFileSelection={!!folders.targetFiles}
            isDragOver={dragTarget === "target"}
            onSelect={() => handleSelectFolder("target")}
            onClear={() => setTargetFolder(null)}
          />
        </div>
      </div>
    </div>
  );
}

// ============================
// ドロップカード
// ============================

interface DropCardProps {
  label: string;
  sublabel: string;
  icon: React.ReactNode;
  color: "pink" | "purple";
  folderPath: string | null;
  fileCount: number | null;
  isFileSelection?: boolean;
  isDragOver: boolean;
  onSelect: () => void;
  onClear: () => void;
}

function DropCard({
  label,
  sublabel,
  icon,
  color,
  folderPath,
  fileCount,
  isFileSelection,
  isDragOver,
  onSelect,
  onClear,
}: DropCardProps) {
  const colorStyles = {
    pink: {
      border: isDragOver
        ? "border-accent bg-accent/10 shadow-[inset_0_0_40px_rgba(255,90,138,0.12)]"
        : folderPath
          ? "border-accent/40 bg-accent/5"
          : "border-text-muted/20 hover:border-accent/40 hover:bg-accent/5",
      icon: "from-accent to-accent-secondary",
      badge: "bg-accent/15 text-accent",
    },
    purple: {
      border: isDragOver
        ? "border-accent-secondary bg-accent-secondary/10 shadow-[inset_0_0_40px_rgba(124,92,255,0.12)]"
        : folderPath
          ? "border-accent-secondary/40 bg-accent-secondary/5"
          : "border-text-muted/20 hover:border-accent-secondary/40 hover:bg-accent-secondary/5",
      icon: "from-accent-secondary to-[#a78bfa]",
      badge: "bg-accent-secondary/15 text-accent-secondary",
    },
  };

  const styles = colorStyles[color];

  return (
    <div
      className={`
        relative border-2 border-dashed rounded-2xl p-8
        flex flex-col items-center justify-center text-center
        transition-all duration-300 cursor-pointer min-h-[280px]
        ${styles.border}
        ${isDragOver ? "scale-[1.02]" : ""}
      `}
      onClick={!folderPath ? onSelect : undefined}
    >
      {folderPath ? (
        // 選択済み
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
            className="absolute top-3 right-3 p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>

          <div
            className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${styles.icon} flex items-center justify-center mb-4 shadow-lg`}
          >
            <div className="text-white">{icon}</div>
          </div>

          <p className="text-xs text-text-muted mb-1">{label}</p>
          <p className="text-sm font-medium text-text-primary truncate max-w-full px-4">
            {folderPath.split(/[\\/]/).pop()}
          </p>

          {fileCount !== null &&
            (fileCount === 0 ? (
              <span className="mt-3 px-3 py-1 text-xs rounded-full font-medium bg-error/15 text-error flex items-center gap-1">
                <svg
                  className="w-3 h-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                  />
                </svg>
                ファイルが見つかりません
              </span>
            ) : (
              <span className={`mt-3 px-3 py-1 text-xs rounded-full font-medium ${styles.badge}`}>
                {fileCount} ファイル{isFileSelection ? " 選択中" : ""}
              </span>
            ))}

          <button
            onClick={(e) => {
              e.stopPropagation();
              onSelect();
            }}
            className="mt-3 text-xs text-text-muted hover:text-text-primary transition-colors underline underline-offset-2"
          >
            変更
          </button>
        </>
      ) : (
        // 未選択
        <>
          <div
            className={`
            w-16 h-16 rounded-2xl flex items-center justify-center mb-5
            transition-all duration-300
            ${
              isDragOver ? `bg-gradient-to-br ${styles.icon} shadow-lg scale-110` : "bg-bg-tertiary"
            }
          `}
          >
            <div
              className={`transition-colors duration-300 ${isDragOver ? "text-white" : "text-text-muted"}`}
            >
              {icon}
            </div>
          </div>

          <p
            className={`text-lg font-display font-medium mb-2 transition-colors duration-300 ${isDragOver ? (color === "pink" ? "text-accent" : "text-accent-secondary") : "text-text-primary"}`}
          >
            {label}
          </p>
          <p className="text-xs text-text-muted mb-4">{sublabel}</p>
          <p className="text-[11px] text-text-muted/60">
            フォルダをドロップ または クリックして選択
          </p>
        </>
      )}
    </div>
  );
}

// ============================
// アイコン
// ============================

function SourceIcon() {
  return (
    <svg
      className="w-8 h-8"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
      />
    </svg>
  );
}

function TargetIcon() {
  return (
    <svg
      className="w-8 h-8"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
      />
    </svg>
  );
}
