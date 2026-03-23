import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { readDir } from "@tauri-apps/plugin-fs";
import { usePsdLoader } from "./usePsdLoader";
import { useViewStore } from "../store/viewStore";
import { usePsdStore } from "../store/psdStore";
import { useTiffStore } from "../store/tiffStore";
import { isSupportedFile } from "../types";

/**
 * グローバルなドラッグ＆ドロップリスナー
 * AppLayout でマウントし、常にファイル/フォルダのドロップを受け付ける
 * (replace / rename タブは独自に処理するためスキップ)
 * TIFF タブでincludeSubfolders有効時はサブフォルダも走査
 */
export function useGlobalDragDrop() {
  const { loadFiles, loadFolderWithSubfolders } = usePsdLoader();

  useEffect(() => {
    const currentWindow = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    let mounted = true;

    const setup = async () => {
      const fn = await currentWindow.onDragDropEvent(async (event) => {
        const activeView = useViewStore.getState().activeView;
        if (activeView === "replace" || activeView === "rename") return;

        if (event.payload.type === "drop") {
          const paths = event.payload.paths;
          if (!paths || paths.length === 0) return;

          // ドロップされたフォルダパスを記録（サブフォルダ再スキャン用）
          const folderPaths: string[] = [];
          const imageFiles: string[] = [];

          for (const path of paths) {
            try {
              const entries = await readDir(path);
              // readDir成功 = フォルダ
              folderPaths.push(path);
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

          // フォルダパスを記録
          if (folderPaths.length > 0) {
            usePsdStore.getState().setDroppedFolderPaths(folderPaths);
          }

          // TIFFタブ: includeSubfolders有効 or ルートに画像なし（サブフォルダのみ）→自動サブフォルダ読み込み
          if (activeView === "tiff" && folderPaths.length > 0) {
            const shouldIncludeSubfolders =
              useTiffStore.getState().settings.includeSubfolders || imageFiles.length === 0; // ルートに画像がない＝サブフォルダのみ

            if (shouldIncludeSubfolders) {
              // 設定を自動的に有効化（UIチェックボックスも同期）
              if (!useTiffStore.getState().settings.includeSubfolders) {
                useTiffStore.getState().setSettings({ includeSubfolders: true });
              }
              await loadFolderWithSubfolders(folderPaths);
              return;
            }
          }

          if (imageFiles.length > 0) {
            await loadFiles(imageFiles);
          }
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
  }, [loadFiles, loadFolderWithSubfolders]);
}
