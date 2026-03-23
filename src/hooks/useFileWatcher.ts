import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { usePsdStore } from "../store/psdStore";

interface FileChangedPayload {
  filePath: string;
  modifiedSecs: number;
}

function normalizePath(p: string): string {
  return p.replace(/\//g, "\\").toLowerCase();
}

/**
 * ファイル変更検知フック。
 * 読み込み済みファイルの親ディレクトリを監視し、
 * 外部変更を検知したらストアの fileChanged フラグを立てる。
 */
export function useFileWatcher() {
  const files = usePsdStore((s) => s.files);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const prevPathsRef = useRef<string>("");

  // ファイルリスト変化時にウォッチャー開始/更新
  useEffect(() => {
    const filePaths = files.map((f) => f.filePath);
    const pathsKey = filePaths.join("|");

    // パスリストが変わっていなければスキップ
    if (pathsKey === prevPathsRef.current) return;
    prevPathsRef.current = pathsKey;

    if (filePaths.length === 0) {
      invoke("stop_file_watcher").catch(() => {});
      return;
    }

    invoke("start_file_watcher", { filePaths }).catch(console.error);

    return () => {
      invoke("stop_file_watcher").catch(() => {});
      prevPathsRef.current = "";
    };
  }, [files]);

  // file-changed イベントリスナー
  useEffect(() => {
    let mounted = true;

    const setup = async () => {
      const unlisten = await listen<FileChangedPayload>("file-changed", (event) => {
        if (!mounted) return;
        const { filePath, modifiedSecs } = event.payload;
        const normalizedPath = normalizePath(filePath);

        const currentFiles = usePsdStore.getState().files;
        const target = currentFiles.find((f) => normalizePath(f.filePath) === normalizedPath);
        if (!target) return;

        // fileChanged フラグを立てる
        const updates = new Map<string, Partial<(typeof currentFiles)[0]>>();
        updates.set(target.id, {
          fileChanged: true,
          modifiedTime: modifiedSecs * 1000,
        });
        usePsdStore.getState().batchUpdateFiles(updates);
      });

      if (mounted) {
        unlistenRef.current = unlisten;
      } else {
        unlisten();
      }
    };

    setup();
    return () => {
      mounted = false;
      unlistenRef.current?.();
    };
  }, []);
}
