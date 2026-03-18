/**
 * useHandoff — Photoshop UXPプラグインからのハンドオフを検出し、
 * PSDファイル読み込み → TIFF化タブ遷移 → クロップ範囲設定を実行
 */
import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useViewStore } from "../store/viewStore";
import { useTiffStore } from "../store/tiffStore";
import { usePsdLoader } from "./usePsdLoader";

interface HandoffSelection {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface HandoffDocument {
  path?: string;
  fileName?: string;
  folderPath?: string;
  width?: number;
  height?: number;
  dpi?: number;
}

interface HandoffOptions {
  sendSelection?: boolean;
  loadFolder?: boolean;
}

interface HandoffData {
  version?: number;
  timestamp?: string;
  source?: string;
  document?: HandoffDocument;
  selection?: HandoffSelection;
  options?: HandoffOptions;
  folderFiles?: string[];
}

export function useHandoff() {
  const { loadFiles, loadFolder } = usePsdLoader();
  const checkedRef = useRef(false);

  useEffect(() => {
    if (checkedRef.current) return;
    checkedRef.current = true;

    const check = async () => {
      try {
        const data = await invoke<HandoffData | null>("check_handoff");
        if (!data || !data.document) return;

        console.log("[useHandoff] Handoff detected:", data);

        const doc = data.document;
        const setActiveView = useViewStore.getState().setActiveView;

        // 1. ファイル/フォルダ読み込み
        if (data.options?.loadFolder && data.folderFiles && data.folderFiles.length > 0) {
          // UXPプラグインから取得したフォルダ内全PSDファイルリストを使用
          await loadFiles(data.folderFiles);
        } else if (data.options?.loadFolder && doc.folderPath) {
          await loadFolder(doc.folderPath);
        } else if (doc.path) {
          await loadFiles([doc.path]);
        }

        // 2. TIFF化タブに遷移（読み込み完了を少し待つ）
        await new Promise((r) => setTimeout(r, 800));
        setActiveView("tiff");

        // 3. 選択範囲をクロップ範囲として設定
        if (data.selection && data.options?.sendSelection !== false) {
          const store = useTiffStore.getState();

          // クロップを有効化
          store.setSettings({
            crop: {
              ...store.settings.crop,
              enabled: true,
            },
          });

          store.pushCropHistory();
          store.setCropBounds({
            left: Math.round(data.selection.left),
            top: Math.round(data.selection.top),
            right: Math.round(data.selection.right),
            bottom: Math.round(data.selection.bottom),
          });

          console.log("[useHandoff] Crop bounds set from selection:", data.selection);
        }
      } catch (e) {
        // ハンドオフファイルがなければ何もしない（通常起動）
        console.debug("[useHandoff] No handoff:", e);
      }
    };

    // フロントエンド初期化完了を少し待ってからチェック
    const timer = setTimeout(check, 500);
    return () => clearTimeout(timer);
  }, [loadFiles, loadFolder]);
}
