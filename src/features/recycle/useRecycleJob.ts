import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useRecycleStore } from "./recycleStore";
import type {
  RecycleJob,
  RecycleStatus,
  RecycleResult,
} from "./recycleTypes";

const POLL_INTERVAL_MS = 700;

/**
 * リサイくるんジョブ送信＆結果監視のフック（v1.2.0コマンド駆動）
 *
 * - submitJob: ジョブJSON書き出し → Photoshop自動起動
 *   → JSXが UXP コマンド `cbRecycleExecute` を runMenuItem で直接呼び出し
 *   → プラグイン側のコマンドハンドラが jobs ディレクトリの最新ジョブを処理
 * - 監視: 結果JSON が書き出されるまで 700ms 間隔で待つ（プラグイン側ポーリング廃止のため
 *   ステータスJSONは通常書かれない。結果のみ確認）
 */
export function useRecycleJob() {
  const phase = useRecycleStore((s) => s.phase);
  const currentJobId = useRecycleStore((s) => s.currentJobId);
  const setPhase = useRecycleStore((s) => s.setPhase);
  const setCurrentJobId = useRecycleStore((s) => s.setCurrentJobId);
  const setStatus = useRecycleStore((s) => s.setStatus);
  const setResult = useRecycleStore((s) => s.setResult);
  const setErrorMessage = useRecycleStore((s) => s.setErrorMessage);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ジョブを送信
  async function submitJob(): Promise<string | null> {
    const state = useRecycleStore.getState();
    if (!state.folderPath || state.scanFiles.length === 0) {
      setErrorMessage("フォルダとスキャン結果が必要です");
      return null;
    }

    setPhase("submitting");
    setErrorMessage(null);
    setResult(null);
    setStatus(null);

    const job: RecycleJob = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      scanResult: {
        folderPath: state.folderPath,
        files: state.scanFiles,
      },
      settings: state.settings,
      perFileOverrides: state.perFileOverrides,
      saveMode: state.saveMode,
      outputPath: null,
    };

    try {
      // ジョブJSON書き出し（Rust側でjobIdを採番）
      const jobId = await invoke<string>("write_recycle_job", {
        jobJson: JSON.stringify(job),
      });
      setCurrentJobId(jobId);
      setPhase("running");

      // Photoshop起動 + パネル展開
      await invoke("launch_photoshop_with_recycle", { jobId });
      return jobId;
    } catch (e) {
      const msg = String(e);
      setErrorMessage(msg);
      setPhase("error");
      return null;
    }
  }

  // 中断要求
  async function cancelJob() {
    const id = useRecycleStore.getState().currentJobId;
    if (!id) return;
    try {
      await invoke("cancel_recycle_job", { jobId: id });
    } catch (e) {
      console.error("Failed to cancel job:", e);
    }
  }

  // クリーンアップ（結果取得後にファイル削除）
  async function cleanupJob(jobId: string) {
    try {
      await invoke("cleanup_recycle_job", { jobId });
    } catch {
      // ignore
    }
  }

  // 結果ポーリング
  useEffect(() => {
    if (phase !== "running" || !currentJobId) {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }

    pollTimerRef.current = setInterval(async () => {
      const id = currentJobId;
      try {
        // 結果が出たら即終了
        const resultJson = await invoke<string | null>("read_recycle_result", { jobId: id });
        if (resultJson) {
          const result: RecycleResult = JSON.parse(resultJson);
          setResult(result);
          if (result.status === "error") {
            setErrorMessage(result.error || "エラーが発生しました");
            setPhase("error");
          } else {
            setPhase("completed");
          }
          // 結果取得後にファイル群クリーンアップ
          await cleanupJob(id);
          return;
        }

        // 進捗更新
        const statusJson = await invoke<string | null>("read_recycle_status", { jobId: id });
        if (statusJson) {
          const status: RecycleStatus = JSON.parse(statusJson);
          setStatus(status);
        }
      } catch (e) {
        console.warn("Polling error:", e);
      }
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [phase, currentJobId]);

  return { submitJob, cancelJob };
}
