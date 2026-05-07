import { useRecycleStore } from "../recycleStore";

export function RecycleStatusCard() {
  const phase = useRecycleStore((s) => s.phase);
  const status = useRecycleStore((s) => s.status);
  const result = useRecycleStore((s) => s.result);
  const errorMessage = useRecycleStore((s) => s.errorMessage);
  const currentJobId = useRecycleStore((s) => s.currentJobId);

  let label = "待機";
  let className = "bg-surface text-text-dim";

  switch (phase) {
    case "submitting":
      label = "送信中…";
      className = "bg-accent/15 text-accent";
      break;
    case "running":
      if (status) {
        label = `処理中 ${status.currentIndex}/${status.totalFiles}`;
      } else {
        label = "処理中…";
      }
      className = "bg-warn/15 text-warn animate-pulse";
      break;
    case "completed":
      label = result
        ? `完了 ${result.filesProcessed || 0}件${result.filesErrors ? ` / ${result.filesErrors}エラー` : ""}`
        : "完了";
      className = "bg-success/15 text-success";
      break;
    case "error":
      label = `エラー: ${errorMessage || "不明"}`;
      className = "bg-danger/15 text-danger";
      break;
  }

  return (
    <div className={`px-3 py-1 rounded text-xs ${className}`} title={currentJobId || ""}>
      {label}
    </div>
  );
}
