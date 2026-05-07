import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { useRecycleStore } from "./recycleStore";
import { useRecycleScanner } from "./useRecycleScanner";
import { useRecycleJob } from "./useRecycleJob";
import { RecycleSettingsPanel } from "./components/RecycleSettingsPanel";
import { RecycleScanList } from "./components/RecycleScanList";
import { RecycleStatusCard } from "./components/RecycleStatusCard";
import { RecycleLayerDetailPanel } from "./components/RecycleLayerDetailPanel";
import { useViewStore } from "../../store/viewStore";
import { useScanPsdStore } from "../scan-psd/scanPsdStore";

/**
 * リサイくるん（CB連携版）メインビュー
 * 構成:
 *   - 左ペイン: 3タブ設定 + 実行ボタン
 *   - 右ペイン: スキャン結果リスト + 個別変更予約
 *
 * 起動モデル: コマンド駆動（v1.2.0+）
 *   - Photoshop の UXP プラグインに manifest で command を登録
 *   - アプリは app.runMenuItem() で直接コマンドを呼び出す
 *   - セットアップ・ポーリング不要
 */
export function RecycleView() {
  const folderPath = useRecycleStore((s) => s.folderPath);
  const setFolderPath = useRecycleStore((s) => s.setFolderPath);
  const scanFiles = useRecycleStore((s) => s.scanFiles);
  const scanInProgress = useRecycleStore((s) => s.scanInProgress);
  const phase = useRecycleStore((s) => s.phase);
  const saveMode = useRecycleStore((s) => s.saveMode);
  const setSaveMode = useRecycleStore((s) => s.setSaveMode);

  const { scanFolder } = useRecycleScanner();
  const { submitJob, cancelJob } = useRecycleJob();

  const [scanError, setScanError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // ワークスペース自動セットアップの状態
  const [workspaceSetupRunning, setWorkspaceSetupRunning] = useState(false);
  const [workspaceSetupMessage, setWorkspaceSetupMessage] = useState<string | null>(null);

  // Photoshop 起動時の自動展開（Script Events Manager）
  const [startupSetupRunning, setStartupSetupRunning] = useState(false);
  const [startupSetupMessage, setStartupSetupMessage] = useState<string | null>(null);

  // PowerShell COM 強制起動
  const [forceOpenRunning, setForceOpenRunning] = useState(false);

  async function handleForceOpenPanel() {
    setForceOpenRunning(true);
    setStartupSetupMessage("PowerShell COM Automationでパネルを強制起動中…");
    try {
      const msg = await invoke<string>("force_open_recycle_panel");
      setStartupSetupMessage("✅ " + msg);
    } catch (e) {
      setStartupSetupMessage("❌ 強制起動エラー: " + String(e));
    } finally {
      setForceOpenRunning(false);
    }
  }

  async function handleSetupStartup(enable: boolean) {
    setStartupSetupRunning(true);
    setStartupSetupMessage(
      enable
        ? "Photoshop で起動時自動展開を登録中…（最大30秒）"
        : "Photoshop で起動時自動展開を解除中…（最大30秒）",
    );
    try {
      const resultJson = await invoke<string>("setup_recycle_startup", { enable });
      const result = JSON.parse(resultJson);
      if (result.success) {
        setStartupSetupMessage(
          enable
            ? "✅ 登録完了！次回 Photoshop 起動時から自動でリサイくるんパネルが開きます。"
            : "✅ 解除完了。次回 Photoshop 起動時から自動展開は停止します。",
        );
      } else {
        setStartupSetupMessage(
          "⚠ 失敗: " + (result.errors || []).join(", "),
        );
      }
    } catch (e) {
      setStartupSetupMessage("❌ エラー: " + String(e));
    } finally {
      setStartupSetupRunning(false);
    }
  }

  async function handleSetupWorkspace() {
    setWorkspaceSetupRunning(true);
    setWorkspaceSetupMessage(
      "Photoshopでワークスペース設定中…（最大3分・Photoshopが起動します）" +
      "\n※Photoshopの起動に時間がかかる場合、自動的に待機します",
    );
    try {
      const resultJson = await invoke<string>("setup_recycle_workspace");
      const result = JSON.parse(resultJson);
      if (result.workspaceSaved && result.workspaceActivated) {
        setWorkspaceSetupMessage(
          "✅ 設定完了！次回からPhotoshop起動時に自動でリサイくるんパネルが開きます。",
        );
      } else if (result.workspaceSaved) {
        setWorkspaceSetupMessage(
          "⚠ ワークスペースは保存されましたが、アクティブ化に失敗。手動でワークスペース「リサイくるん用」を選択してください。",
        );
      } else {
        setWorkspaceSetupMessage(
          "❌ ワークスペース保存に失敗。Photoshopで手動でパネルを開いた状態で再実行してください。詳細: " +
            (result.errors || []).join(", "),
        );
      }
    } catch (e) {
      setWorkspaceSetupMessage("❌ エラー: " + String(e));
    } finally {
      setWorkspaceSetupRunning(false);
    }
  }

  async function loadFolder(path: string) {
    setFolderPath(path);
    setScanError(null);
    try {
      await scanFolder(path);
    } catch (e) {
      setScanError(String(e));
    }
  }

  async function handleSelectFolder() {
    try {
      const result = await openDialog({ directory: true, multiple: false });
      if (typeof result === "string") {
        await loadFolder(result);
      }
    } catch (e) {
      console.error("Folder dialog failed:", e);
    }
  }

  // ====== D&D 受信（recycleビューがアクティブな時のみ） ======
  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    let mounted = true;

    (async () => {
      const fn = await win.onDragDropEvent(async (event) => {
        // recycle ビューがアクティブな時のみ処理（他ビューに干渉しない）
        if (useViewStore.getState().activeView !== "recycle") return;

        if (event.payload.type === "enter" || event.payload.type === "over") {
          setIsDragOver(true);
        } else if (event.payload.type === "leave") {
          setIsDragOver(false);
        } else if (event.payload.type === "drop") {
          setIsDragOver(false);
          const paths = event.payload.paths;
          if (!paths || paths.length === 0) return;

          // 最初のパスを優先。フォルダかどうかは Rust 側で判定
          const target = paths[0];
          try {
            const exists = await invoke<boolean>("path_exists", { path: target });
            if (!exists) return;
            // フォルダなら直接読み込み、ファイルならその親フォルダを読み込み
            // 簡易判定: 拡張子があればファイル、なければフォルダとみなす
            const isProbablyFile = /\.[a-zA-Z0-9]{1,5}$/.test(target);
            const folderPath = isProbablyFile
              ? target.replace(/[\\/][^\\/]*$/, "")
              : target;
            await loadFolder(folderPath);
          } catch (e) {
            setScanError("D&D読み込みエラー: " + String(e));
          }
        }
      });
      if (mounted) unlisten = fn;
      else fn();
    })();

    return () => {
      mounted = false;
      if (unlisten) unlisten();
    };
  }, []);

  async function handleRescan() {
    if (!folderPath) return;
    try {
      setScanError(null);
      await scanFolder(folderPath);
    } catch (e) {
      setScanError(String(e));
    }
  }

  const isRunning = phase === "running" || phase === "submitting";
  const totalLayers = scanFiles.reduce((sum, f) => sum + f.textLayers.length, 0);

  return (
    <div className="flex flex-col h-full bg-bg-primary text-text-primary relative">
      {/* D&D オーバーレイ */}
      {isDragOver && (
        <div className="absolute inset-0 z-50 bg-accent/10 border-4 border-dashed border-accent flex items-center justify-center pointer-events-none">
          <div className="bg-bg-secondary px-8 py-6 rounded-2xl shadow-2xl border border-accent text-center">
            <div className="text-3xl mb-2">📂</div>
            <div className="text-base font-semibold text-accent">フォルダをドロップして読み込み</div>
            <div className="text-xs text-text-dim mt-1">PSDファイルを再帰的にスキャンします</div>
          </div>
        </div>
      )}

      {/* ヘッダー */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border-subtle bg-bg-secondary">
        <div className="font-semibold text-sm">リサイくるん</div>
        <div className="text-xs text-text-dim">CB連携版（実行はPhotoshopプラグイン）</div>
        <div className="flex-1" />
        <RecycleStatusCard />
      </div>

      {/* フォルダ選択バー */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border-subtle">
        <button
          onClick={handleSelectFolder}
          disabled={isRunning}
          className="px-3 py-1.5 text-xs rounded border border-accent text-accent hover:bg-accent/10 disabled:opacity-40"
        >
          フォルダ選択
        </button>
        <div className="flex-1 px-2 py-1 text-xs text-text-secondary truncate bg-bg-secondary rounded">
          {folderPath || "フォルダ未選択（フォルダをドロップ可）"}
        </div>
        <span className="text-xs text-text-dim">
          {scanFiles.length}ファイル / {totalLayers}テキストレイヤー
        </span>
        {folderPath && (
          <button
            onClick={handleRescan}
            disabled={isRunning || scanInProgress}
            className="px-2 py-1 text-xs rounded border border-border-subtle hover:bg-surface-raised disabled:opacity-40"
          >
            {scanInProgress ? "スキャン中..." : "再スキャン"}
          </button>
        )}
      </div>

      {scanError && (
        <div className="px-4 py-2 bg-danger/10 text-danger text-xs">
          スキャンエラー: {scanError}
        </div>
      )}

      {/* 初回設定（3 ステップ手順） */}
      <div className="px-4 py-2 border-b border-border-subtle bg-bg-tertiary">
        <div className="text-[11px] text-text-secondary mb-1.5">
          💡 <strong>初回設定（3ステップ）</strong>: UXPプラグインの仕様上、手動でパネルを一度開く必要があります
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-text-dim">①</span>
          <span className="text-text-secondary">
            Photoshopで <strong>ウィンドウ &gt; エクステンション &gt; リサイくるん (CB連携)</strong> を手動で開く
          </span>
          <span className="text-text-dim mx-2">→</span>
          <span className="text-text-dim">②</span>
          <button
            onClick={handleSetupWorkspace}
            disabled={workspaceSetupRunning}
            className="px-2.5 py-1 rounded border border-accent text-accent hover:bg-accent/10 disabled:opacity-40"
            title="パネルが開いた状態でワークスペースに保存"
          >
            {workspaceSetupRunning ? "保存中..." : "ワークスペース保存"}
          </button>
          <span className="text-text-dim mx-2">→</span>
          <span className="text-text-dim">③</span>
          <button
            onClick={() => handleSetupStartup(true)}
            disabled={startupSetupRunning}
            className="px-2.5 py-1 rounded border border-success text-success hover:bg-success/10 disabled:opacity-40"
            title="Photoshop起動時に自動展開を登録"
          >
            {startupSetupRunning ? "登録中..." : "起動時自動展開を登録"}
          </button>
          <span className="text-text-dim ml-2">|</span>
          <button
            onClick={() => handleSetupStartup(false)}
            disabled={startupSetupRunning}
            className="px-2 py-1 text-[10px] text-text-dim hover:text-text-secondary"
            title="自動展開を解除"
          >
            解除
          </button>
        </div>
        {/* 強制起動ボタン（手動起動の代替） */}
        <div className="mt-1.5 flex items-center gap-2 text-[11px]">
          <span className="text-text-dim">困った時:</span>
          <button
            onClick={handleForceOpenPanel}
            disabled={forceOpenRunning}
            className="px-3 py-1 rounded bg-warn/15 text-warn border border-warn/30 hover:bg-warn/25 disabled:opacity-40"
            title="PowerShell COM Automation でパネルを強制的に開く（最強の方法）"
          >
            {forceOpenRunning ? "起動中..." : "🔧 PowerShell COMでパネルを強制起動"}
          </button>
          <span className="text-text-dim">
            ※自動起動が失敗する場合の最終手段
          </span>
        </div>
      </div>
      {(workspaceSetupMessage || startupSetupMessage) && (
        <div className="px-4 py-1.5 bg-surface text-[11px] text-text-secondary border-b border-border-subtle space-y-0.5">
          {workspaceSetupMessage && <div>① {workspaceSetupMessage}</div>}
          {startupSetupMessage && <div>② {startupSetupMessage}</div>}
        </div>
      )}

      {/* JSON プリセット情報バー */}
      <PresetJsonInfoBar />

      {/* 2カラム */}
      <div className="flex-1 flex overflow-hidden">
        <div className="w-[420px] border-r border-border-subtle overflow-y-auto">
          <RecycleSettingsPanel disabled={isRunning} />
        </div>
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            <RecycleScanList disabled={isRunning} />
          </div>
          {/* レイヤー編集パネル（行クリック時に展開） */}
          <RecycleLayerDetailPanel />
        </div>
      </div>

      {/* フッター: 保存方法 + 実行 */}
      <div className="flex items-center gap-3 px-4 py-3 border-t border-border-subtle bg-bg-secondary">
        <label className="text-xs text-text-secondary">保存:</label>
        <select
          value={saveMode}
          onChange={(e) => setSaveMode(e.target.value as "separate" | "overwrite")}
          disabled={isRunning}
          className="px-2 py-1 text-xs bg-bg-primary border border-border-subtle rounded"
        >
          <option value="separate">別フォルダ</option>
          <option value="overwrite">上書き</option>
        </select>
        <div className="flex-1" />
        {isRunning ? (
          <button
            onClick={cancelJob}
            className="px-4 py-1.5 text-xs rounded bg-danger text-white hover:opacity-90"
          >
            中断
          </button>
        ) : (
          <button
            onClick={submitJob}
            disabled={!folderPath || scanFiles.length === 0}
            className="px-6 py-1.5 text-xs rounded bg-accent text-white hover:opacity-90 disabled:opacity-40 font-medium"
          >
            実行（Photoshopで処理）
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * 作品情報JSON プリセット情報の表示バー。
 * scanPsdStore に既にロード済みのプリセットを参照する（TopNav経由で読み込む想定）。
 * 未読込時は読み込み案内を表示。
 */
function PresetJsonInfoBar() {
  const presetSets = useScanPsdStore((s) => s.presetSets);
  const currentJsonFilePath = useScanPsdStore((s) => s.currentJsonFilePath);
  const workInfo = useScanPsdStore((s) => s.workInfo);
  const scanData = useScanPsdStore((s) => s.scanData);

  const fontCount = Object.values(presetSets || {}).reduce((sum, list) => sum + list.length, 0);
  const sizeCount = scanData?.sizeStats?.sizes?.length || 0;
  const isLoaded = !!currentJsonFilePath || fontCount > 0;

  const fileName = currentJsonFilePath ? currentJsonFilePath.split(/[\\/]/).pop() || "" : "";

  if (!isLoaded) {
    return (
      <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border-subtle bg-warn/5 text-[11px]">
        <span className="text-warn">ⓘ</span>
        <span className="text-text-secondary">
          作品情報JSONが未読込。画面上部のナビバー
          <span className="font-mono mx-1">作品情報</span>
          ボタンから読み込むと、レイヤー編集でフォント・サイズを選択できます。
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-4 py-1.5 border-b border-border-subtle bg-success/5 text-[11px]">
      <span className="text-success">✓</span>
      <span className="text-text-secondary truncate flex-1">
        作品情報: <span className="font-medium">{workInfo.title || fileName || "（タイトル未設定）"}</span>
        {workInfo.label && <span className="text-text-dim ml-2">— {workInfo.label}</span>}
      </span>
      <span className="text-text-dim">
        フォント {fontCount} 件 / サイズ {sizeCount} 件
      </span>
    </div>
  );
}
