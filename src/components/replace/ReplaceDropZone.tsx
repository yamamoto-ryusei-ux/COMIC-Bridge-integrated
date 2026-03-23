import { useState, useEffect, useRef, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { readDir, stat } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { useReplaceStore } from "../../store/replaceStore";

/** readDir でフォルダ内のファイル数をカウント */
async function countFiles(folderPath: string): Promise<number> {
  const entries = await readDir(folderPath);
  return entries.filter((e) => e.isFile).length;
}

/** サブフォルダも含めて再帰的にファイル数をカウント */
async function countFilesRecursive(folderPath: string): Promise<number> {
  const entries = await readDir(folderPath);
  let count = 0;
  for (const entry of entries) {
    if (entry.isFile) {
      count++;
    } else if (entry.isDirectory && entry.name) {
      count += await countFilesRecursive(`${folderPath}\\${entry.name}`);
    }
  }
  return count;
}

type DragTarget = "source" | "target" | "batch-parent" | "batch-shiro" | "batch-bou" | null;

export function ReplaceDropZone() {
  const folders = useReplaceStore((s) => s.folders);
  const settings = useReplaceStore((s) => s.settings);
  const batchFolders = useReplaceStore((s) => s.batchFolders);
  const setSourceFolder = useReplaceStore((s) => s.setSourceFolder);
  const setTargetFolder = useReplaceStore((s) => s.setTargetFolder);
  const removeBatchFolder = useReplaceStore((s) => s.removeBatchFolder);
  const setNamedBatchFolder = useReplaceStore((s) => s.setNamedBatchFolder);
  const setBatchFolders = useReplaceStore((s) => s.setBatchFolders);
  const clearBatchFolders = useReplaceStore((s) => s.clearBatchFolders);

  const [dragTarget, setDragTarget] = useState<DragTarget>(null);
  const [sourceFileCount, setSourceFileCount] = useState<number | null>(null);
  const [targetFileCount, setTargetFileCount] = useState<number | null>(null);
  const [shiroFileCount, setShiroFileCount] = useState<number | null>(null);
  const [bouFileCount, setBouFileCount] = useState<number | null>(null);

  const sourceRef = useRef<HTMLDivElement>(null!);
  const targetRef = useRef<HTMLDivElement>(null!);
  const batchShiroRef = useRef<HTMLDivElement>(null!);
  const batchBouRef = useRef<HTMLDivElement>(null!);
  const batchParentRef = useRef<HTMLDivElement>(null!);

  const isBatch = settings.mode === "batch";
  const isSwitch = settings.mode === "switch";
  const isCompose = settings.mode === "compose";
  const isWhiteToBar = settings.switchSettings.subMode === "whiteToBar";
  // 排他制御: 親フォルダモード ↔ 個別指定モード
  const parentActive = isBatch && !!folders.targetFolder;
  const individualActive =
    isBatch &&
    !folders.targetFolder &&
    batchFolders.some((f) => f.name === "白消し" || f.name === "棒消し");

  // ファイル数カウント
  useEffect(() => {
    if (folders.sourceFiles) {
      // 個別ファイル指定時はそのカウントを使用
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
      const counter = isBatch ? countFilesRecursive : countFiles;
      counter(folders.targetFolder)
        .then(setTargetFileCount)
        .catch(() => setTargetFileCount(null));
    } else {
      setTargetFileCount(null);
    }
  }, [folders.targetFolder, folders.targetFiles, isBatch]);

  // 白消し・棒消しフォルダのファイル数カウント
  useEffect(() => {
    const shiro = batchFolders.find((f) => f.name === "白消し");
    if (shiro) {
      countFiles(shiro.path)
        .then(setShiroFileCount)
        .catch(() => setShiroFileCount(null));
    } else {
      setShiroFileCount(null);
    }

    const bou = batchFolders.find((f) => f.name === "棒消し");
    if (bou) {
      countFiles(bou.path)
        .then(setBouFileCount)
        .catch(() => setBouFileCount(null));
    } else {
      setBouFileCount(null);
    }
  }, [batchFolders]);

  // バッチモード: targetFolder 設定時にサブフォルダ自動検出
  useEffect(() => {
    if (isBatch && folders.targetFolder) {
      invoke<string[]>("list_subfolders", {
        folderPath: folders.targetFolder,
      })
        .then((subs) => {
          const detected = subs
            .map((s) => ({
              name: s.split(/[\\/]/).pop() || "",
              path: s,
            }))
            .filter((f) => f.name === "白消し" || f.name === "棒消し");
          setBatchFolders(detected);
        })
        .catch(() => {});
    }
  }, [folders.targetFolder, isBatch, setBatchFolders]);

  // ドロップ位置判定（排他制御付き、カード全体をカバー）
  const getDragTarget = useCallback(
    (x: number, y: number): DragTarget => {
      const hitTest = (ref: React.RefObject<HTMLDivElement | null>) => {
        if (!ref.current) return false;
        const r = ref.current.getBoundingClientRect();
        return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      };

      // source は常に有効
      if (hitTest(sourceRef)) return "source";

      if (isBatch) {
        // まず正確な ref ヒットをチェック
        if (!parentActive) {
          if (hitTest(batchShiroRef)) return "batch-shiro";
          if (hitTest(batchBouRef)) return "batch-bou";
        }
        if (!individualActive && hitTest(batchParentRef)) return "batch-parent";

        // ギャップ領域のフォールバック: カード全体内なら最寄りゾーンに割り当て
        if (hitTest(targetRef)) {
          const parentBottom = batchParentRef.current?.getBoundingClientRect().bottom ?? 0;
          const shiroTop = batchShiroRef.current?.getBoundingClientRect().top ?? Infinity;
          const splitY = (parentBottom + shiroTop) / 2;

          if (y <= splitY && !individualActive) {
            return "batch-parent";
          }
          if (y > splitY && !parentActive) {
            const cardRect = targetRef.current!.getBoundingClientRect();
            const midX = (cardRect.left + cardRect.right) / 2;
            return x <= midX ? "batch-shiro" : "batch-bou";
          }
        }
      } else {
        // 通常モード: 画像データゾーン
        if (hitTest(targetRef)) return "target";
      }

      return null;
    },
    [isBatch, parentActive, individualActive],
  );

  // ドロップハンドラ（stat で確実にファイル/フォルダを判別）
  const handleDrop = useCallback(
    async (paths: string[], target: DragTarget) => {
      if (!paths.length || !target) return;

      let folderPath = paths[0];
      let fileList: string[] | null = null;

      try {
        const info = await stat(paths[0]);
        if (info.isFile) {
          // ファイルドロップ → 親ディレクトリを使い、個別ファイルリストを保存
          folderPath = paths[0].replace(/[\\/][^\\/]+$/, "");
          fileList = paths;
        }
      } catch {
        // stat 失敗時は拡張子で判定（フォールバック）
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
        case "batch-parent":
          setTargetFolder(folderPath, fileList);
          break;
        case "batch-shiro":
          setNamedBatchFolder("白消し", folderPath);
          break;
        case "batch-bou":
          setNamedBatchFolder("棒消し", folderPath);
          break;
      }
    },
    [setSourceFolder, setTargetFolder, setNamedBatchFolder],
  );

  // Tauri drag-drop event
  useEffect(() => {
    const currentWindow = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    let mounted = true;

    const setup = async () => {
      const fn = await currentWindow.onDragDropEvent((event) => {
        // Tauri は物理ピクセル座標を返すが getBoundingClientRect は CSS 座標
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
  const handleSelectFolder = async (
    type: "source" | "target" | "batch-parent" | "batch-shiro" | "batch-bou",
  ) => {
    const titles: Record<string, string> = {
      source: isCompose ? "原稿Aフォルダを選択" : "植字データフォルダを選択",
      target: isCompose ? "原稿Bフォルダを選択" : "画像データフォルダを選択",
      "batch-parent": "画像データ親フォルダを選択",
      "batch-shiro": "白消しフォルダを選択",
      "batch-bou": "棒消しフォルダを選択",
    };
    const selected = await open({ directory: true, title: titles[type] });
    if (selected) {
      handleDrop([selected as string], type);
    }
  };

  // 準備完了判定（0件フォルダは不可）
  const sourceOk = !!folders.sourceFolder && sourceFileCount !== 0;
  const targetOk = isBatch
    ? !!(folders.targetFolder && targetFileCount !== 0) ||
      batchFolders.some(
        (f) =>
          (f.name === "白消し" || f.name === "棒消し") &&
          (f.name === "白消し" ? shiroFileCount !== 0 : bouFileCount !== 0),
      )
    : !!folders.targetFolder && targetFileCount !== 0;
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
        {/* === 植字データ / 差替え元 / 原稿A（左） === */}
        <div ref={sourceRef} className="flex-1 min-w-0">
          <DropCard
            label={
              isCompose
                ? "原稿A"
                : isSwitch
                  ? isWhiteToBar
                    ? "棒消しデータ"
                    : "白消しデータ"
                  : "植字データ"
            }
            sublabel={
              isCompose
                ? "合成元ファイル"
                : isSwitch
                  ? isWhiteToBar
                    ? "差し替え用の棒消しレイヤーを含むファイル"
                    : "差し替え用の白消しレイヤーを含むファイル"
                  : "テキスト等を取り出すファイル"
            }
            icon={<TextIcon />}
            color={isSwitch ? "amber" : "pink"}
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
            <span className="text-[10px] font-medium text-text-muted">
              {settings.mode === "text"
                ? "テキスト差替え"
                : settings.mode === "batch"
                  ? "一括差替え"
                  : settings.mode === "switch"
                    ? "スイッチ差替え"
                    : settings.mode === "compose"
                      ? "合成"
                      : "画像差替え"}
            </span>
          )}

          {/* 大きな方向矢印 */}
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
              {settings.mode === "compose" ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 7h12m0 0l-4-4m4 4l-4 4M16 17H4m0 0l4-4m-4 4l4 4"
                />
              ) : settings.mode === "switch" ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M7 16V4m0 0L3 8m4-4l4 4m6 4v12m0 0l4-4m-4 4l-4-4"
                />
              ) : settings.mode === "text" ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7m0 0l-7 7m7-7H4" />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M11 19l-7-7m0 0l7-7m-7 7h16"
                />
              )}
            </svg>
          </div>
        </div>

        {/* === 画像データ（右） === */}
        <div ref={targetRef} className="flex-1 min-w-0">
          {isBatch ? (
            <BatchTargetCard
              batchParentRef={batchParentRef}
              batchShiroRef={batchShiroRef}
              batchBouRef={batchBouRef}
              parentFolder={folders.targetFolder}
              batchFolders={batchFolders}
              parentActive={parentActive}
              individualActive={individualActive}
              parentFileCount={targetFileCount}
              shiroFileCount={shiroFileCount}
              bouFileCount={bouFileCount}
              isDragOverParent={dragTarget === "batch-parent"}
              isDragOverShiro={dragTarget === "batch-shiro"}
              isDragOverBou={dragTarget === "batch-bou"}
              onSelectParent={() => handleSelectFolder("batch-parent")}
              onSelectShiro={() => handleSelectFolder("batch-shiro")}
              onSelectBou={() => handleSelectFolder("batch-bou")}
              onClearAll={() => {
                setTargetFolder(null);
                clearBatchFolders();
              }}
              onRemoveFolder={removeBatchFolder}
            />
          ) : (
            <DropCard
              label={isCompose ? "原稿B" : isSwitch ? "差替え対象PSD" : "画像データ"}
              sublabel={
                isCompose
                  ? "合成元ファイル"
                  : isSwitch
                    ? isWhiteToBar
                      ? "白消しレイヤーが非表示になります"
                      : "棒消しグループが非表示になります"
                    : "ベースとなる原稿ファイル"
              }
              icon={<ImageIcon />}
              color="purple"
              folderPath={folders.targetFolder}
              fileCount={targetFileCount}
              isFileSelection={!!folders.targetFiles}
              isDragOver={dragTarget === "target"}
              onSelect={() => handleSelectFolder("target")}
              onClear={() => setTargetFolder(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ============================
// 通常ドロップカード
// ============================

interface DropCardProps {
  label: string;
  sublabel: string;
  icon: React.ReactNode;
  color: "pink" | "purple" | "amber";
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
    amber: {
      border: isDragOver
        ? "border-warning bg-warning/10 shadow-[inset_0_0_40px_rgba(245,158,11,0.12)]"
        : folderPath
          ? "border-warning/40 bg-warning/5"
          : "border-text-muted/20 hover:border-warning/40 hover:bg-warning/5",
      icon: "from-warning to-[#fbbf24]",
      badge: "bg-warning/15 text-warning",
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
            className={`text-lg font-display font-medium mb-2 transition-colors duration-300 ${isDragOver ? (color === "pink" ? "text-accent" : color === "amber" ? "text-warning" : "text-accent-secondary") : "text-text-primary"}`}
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
// バッチモード用カード（3ゾーン: 親フォルダ・白消し・棒消し）
// ============================

interface BatchTargetCardProps {
  batchParentRef: React.RefObject<HTMLDivElement>;
  batchShiroRef: React.RefObject<HTMLDivElement>;
  batchBouRef: React.RefObject<HTMLDivElement>;
  parentFolder: string | null;
  batchFolders: { name: string; path: string }[];
  parentActive: boolean;
  individualActive: boolean;
  parentFileCount: number | null;
  shiroFileCount: number | null;
  bouFileCount: number | null;
  isDragOverParent: boolean;
  isDragOverShiro: boolean;
  isDragOverBou: boolean;
  onSelectParent: () => void;
  onSelectShiro: () => void;
  onSelectBou: () => void;
  onClearAll: () => void;
  onRemoveFolder: (path: string) => void;
}

function BatchTargetCard({
  batchParentRef,
  batchShiroRef,
  batchBouRef,
  parentFolder,
  batchFolders,
  parentActive,
  individualActive,
  parentFileCount,
  shiroFileCount,
  bouFileCount,
  isDragOverParent,
  isDragOverShiro,
  isDragOverBou,
  onSelectParent,
  onSelectShiro,
  onSelectBou,
  onClearAll,
  onRemoveFolder,
}: BatchTargetCardProps) {
  const shiroFolder = batchFolders.find((f) => f.name === "白消し");
  const bouFolder = batchFolders.find((f) => f.name === "棒消し");
  const hasAny = !!(shiroFolder || bouFolder || parentFolder);
  const isDragOver = isDragOverParent || isDragOverShiro || isDragOverBou;

  return (
    <div
      className={`
        relative border-2 border-dashed rounded-2xl p-6
        flex flex-col text-center
        transition-all duration-300 min-h-[280px]
        ${
          isDragOver
            ? "border-accent-secondary bg-accent-secondary/10 shadow-[inset_0_0_40px_rgba(124,92,255,0.12)] scale-[1.02]"
            : hasAny
              ? "border-accent-secondary/40 bg-accent-secondary/5"
              : "border-text-muted/20 hover:border-accent-secondary/40"
        }
      `}
    >
      {/* ヘッダー */}
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-accent-secondary to-[#a78bfa] flex items-center justify-center">
          <span className="text-white text-xs font-bold">B</span>
        </div>
        <div className="text-left">
          <p className="text-sm font-medium text-text-primary">画像データ</p>
          <p className="text-[10px] text-text-muted">白消し・棒消し一括処理</p>
        </div>
        {hasAny && (
          <button
            onClick={onClearAll}
            className="ml-auto p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
          >
            <svg
              width="14"
              height="14"
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
        )}
      </div>

      {/* 親フォルダ（自動検出） */}
      <div
        ref={batchParentRef}
        className={`
          w-full border border-dashed rounded-xl p-4 mb-3
          flex items-center justify-center
          transition-all duration-200 min-h-[90px]
          ${
            individualActive
              ? "border-text-muted/10 bg-bg-tertiary/20 opacity-40 cursor-not-allowed"
              : isDragOverParent
                ? "border-accent-secondary bg-accent-secondary/10"
                : parentFolder
                  ? "border-accent-secondary/30 bg-accent-secondary/5 cursor-pointer"
                  : "border-text-muted/20 hover:border-accent-secondary/30 hover:bg-bg-tertiary/50 cursor-pointer"
          }
        `}
        onClick={!individualActive ? onSelectParent : undefined}
      >
        {parentFolder ? (
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-accent-secondary/15 flex items-center justify-center flex-shrink-0">
              <svg
                className="w-4 h-4 text-accent-secondary"
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
            </div>
            <div className="text-left min-w-0">
              <p className="text-[10px] text-text-muted">親フォルダ（自動検出）</p>
              <p className="text-xs text-text-primary font-medium truncate">
                {parentFolder.split(/[\\/]/).pop()}
              </p>
            </div>
            {parentFileCount !== null &&
              (parentFileCount === 0 ? (
                <span className="ml-auto px-2 py-0.5 text-[10px] rounded-full font-medium bg-error/15 text-error flex-shrink-0 flex items-center gap-0.5">
                  <svg
                    className="w-2.5 h-2.5"
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
                  0 件
                </span>
              ) : (
                <span className="ml-auto px-2 py-0.5 text-[10px] rounded-full font-medium bg-accent-secondary/15 text-accent-secondary flex-shrink-0">
                  {parentFileCount} ファイル
                </span>
              ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5">
            <div
              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${isDragOverParent ? "bg-accent-secondary/20" : "bg-bg-tertiary"}`}
            >
              <svg
                className={`w-4 h-4 transition-colors ${isDragOverParent ? "text-accent-secondary" : "text-text-muted"}`}
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
            </div>
            <p className="text-xs font-medium text-text-primary">親フォルダ</p>
            <p className="text-[10px] text-text-muted">ドロップで白消し・棒消しを自動検出</p>
          </div>
        )}
      </div>

      {/* 「または」区切り */}
      <div className="flex items-center gap-2 mb-3">
        <div className="flex-1 h-px bg-border" />
        <span className="text-[10px] text-text-muted px-1">または</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      {/* 白消し・棒消し個別ゾーン */}
      <div className="flex gap-3 flex-1">
        {/* 白消し */}
        <div
          ref={batchShiroRef}
          className={`
            flex-1 border border-dashed rounded-xl p-4
            flex flex-col items-center justify-center
            transition-all duration-200 min-h-[120px]
            ${
              parentActive
                ? "border-text-muted/10 bg-bg-tertiary/20 opacity-40 cursor-not-allowed"
                : isDragOverShiro
                  ? "border-accent-secondary bg-accent-secondary/15 scale-[1.03]"
                  : shiroFolder
                    ? "border-accent-secondary/30 bg-accent-secondary/5 cursor-pointer"
                    : "border-text-muted/15 hover:border-accent-secondary/30 hover:bg-bg-tertiary/50 cursor-pointer"
            }
          `}
          onClick={!parentActive && !shiroFolder ? onSelectShiro : undefined}
        >
          {shiroFolder ? (
            <>
              <div className="w-8 h-8 rounded-lg bg-accent-secondary/15 flex items-center justify-center mb-2">
                <svg
                  className="w-4 h-4 text-accent-secondary"
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
              </div>
              <p className="text-[10px] text-text-muted mb-0.5">白消し</p>
              <p className="text-xs text-text-primary font-medium truncate max-w-full">
                {shiroFolder.path.split(/[\\/]/).pop()}
              </p>
              {shiroFileCount !== null &&
                (shiroFileCount === 0 ? (
                  <span className="mt-1 px-2 py-0.5 text-[10px] rounded-full font-medium bg-error/15 text-error flex items-center gap-0.5">
                    <svg
                      className="w-2.5 h-2.5"
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
                    0 件
                  </span>
                ) : (
                  <span className="mt-1 px-2 py-0.5 text-[10px] rounded-full font-medium bg-accent-secondary/15 text-accent-secondary">
                    {shiroFileCount} ファイル
                  </span>
                ))}
              {parentActive ? (
                <span className="mt-1 text-[10px] text-text-muted/60">自動検出</span>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveFolder(shiroFolder.path);
                  }}
                  className="mt-1 text-[10px] text-text-muted hover:text-error transition-colors"
                >
                  解除
                </button>
              )}
            </>
          ) : (
            <>
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 transition-colors ${isDragOverShiro ? "bg-accent-secondary/20" : "bg-bg-tertiary"}`}
              >
                <svg
                  className={`w-4 h-4 transition-colors ${isDragOverShiro ? "text-accent-secondary" : "text-text-muted"}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </div>
              <p className="text-xs font-medium text-text-primary mb-1">白消し</p>
              <p className="text-[10px] text-text-muted">ドロップ</p>
            </>
          )}
        </div>

        {/* 棒消し */}
        <div
          ref={batchBouRef}
          className={`
            flex-1 border border-dashed rounded-xl p-4
            flex flex-col items-center justify-center
            transition-all duration-200 min-h-[120px]
            ${
              parentActive
                ? "border-text-muted/10 bg-bg-tertiary/20 opacity-40 cursor-not-allowed"
                : isDragOverBou
                  ? "border-accent-secondary bg-accent-secondary/15 scale-[1.03]"
                  : bouFolder
                    ? "border-accent-secondary/30 bg-accent-secondary/5 cursor-pointer"
                    : "border-text-muted/15 hover:border-accent-secondary/30 hover:bg-bg-tertiary/50 cursor-pointer"
            }
          `}
          onClick={!parentActive && !bouFolder ? onSelectBou : undefined}
        >
          {bouFolder ? (
            <>
              <div className="w-8 h-8 rounded-lg bg-accent-secondary/15 flex items-center justify-center mb-2">
                <svg
                  className="w-4 h-4 text-accent-secondary"
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
              </div>
              <p className="text-[10px] text-text-muted mb-0.5">棒消し</p>
              <p className="text-xs text-text-primary font-medium truncate max-w-full">
                {bouFolder.path.split(/[\\/]/).pop()}
              </p>
              {bouFileCount !== null &&
                (bouFileCount === 0 ? (
                  <span className="mt-1 px-2 py-0.5 text-[10px] rounded-full font-medium bg-error/15 text-error flex items-center gap-0.5">
                    <svg
                      className="w-2.5 h-2.5"
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
                    0 件
                  </span>
                ) : (
                  <span className="mt-1 px-2 py-0.5 text-[10px] rounded-full font-medium bg-accent-secondary/15 text-accent-secondary">
                    {bouFileCount} ファイル
                  </span>
                ))}
              {parentActive ? (
                <span className="mt-1 text-[10px] text-text-muted/60">自動検出</span>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveFolder(bouFolder.path);
                  }}
                  className="mt-1 text-[10px] text-text-muted hover:text-error transition-colors"
                >
                  解除
                </button>
              )}
            </>
          ) : (
            <>
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 transition-colors ${isDragOverBou ? "bg-accent-secondary/20" : "bg-bg-tertiary"}`}
              >
                <svg
                  className={`w-4 h-4 transition-colors ${isDragOverBou ? "text-accent-secondary" : "text-text-muted"}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </div>
              <p className="text-xs font-medium text-text-primary mb-1">棒消し</p>
              <p className="text-[10px] text-text-muted">ドロップ</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================
// アイコン
// ============================

function TextIcon() {
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

function ImageIcon() {
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
