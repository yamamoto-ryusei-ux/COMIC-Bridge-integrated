import { createPortal } from "react-dom";
import type { CanvasMismatchAction } from "../../types/tiff";

interface TiffCanvasMismatchDialogProps {
  fileName: string;
  expectedSize: { width: number; height: number };
  actualSize: { width: number; height: number };
  onAction: (action: CanvasMismatchAction) => void;
}

export function TiffCanvasMismatchDialog({
  fileName,
  expectedSize,
  actualSize,
  onAction,
}: TiffCanvasMismatchDialogProps) {
  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-bg-secondary border border-border rounded-2xl shadow-xl max-w-md w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-warning/10 flex items-center justify-center">
              <svg
                className="w-5 h-5 text-warning"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-display font-bold text-text-primary">
                キャンバスサイズの不一致
              </h3>
              <p className="text-xs text-text-muted truncate max-w-[280px]">{fileName}</p>
            </div>
          </div>
        </div>

        {/* Size Comparison */}
        <div className="px-6 py-4">
          <div className="flex items-center gap-4 justify-center mb-4">
            <div className="text-center">
              <span className="text-[10px] text-text-muted block">期待サイズ</span>
              <span className="text-sm font-mono text-text-primary">
                {expectedSize.width} x {expectedSize.height}
              </span>
            </div>
            <svg
              className="w-4 h-4 text-warning"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
              />
            </svg>
            <div className="text-center">
              <span className="text-[10px] text-text-muted block">実際サイズ</span>
              <span className="text-sm font-mono text-error">
                {actualSize.width} x {actualSize.height}
              </span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="space-y-2">
            <ActionButton
              label="ラベル選択"
              description="JSONから別のラベルを選択"
              onClick={() => onAction("reselect")}
            />
            <ActionButton
              label="手動選択"
              description="クロップエディタで範囲を選択"
              onClick={() => onAction("manual")}
            />
            <ActionButton
              label="そのまま処理"
              description="現在の範囲でクロップを適用"
              onClick={() => onAction("force")}
            />
            <ActionButton
              label="スキップ"
              description="このファイルをスキップ"
              onClick={() => onAction("skip")}
              variant="muted"
            />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ActionButton({
  label,
  description,
  onClick,
  variant = "default",
}: {
  label: string;
  description: string;
  onClick: () => void;
  variant?: "default" | "muted";
}) {
  return (
    <button
      onClick={onClick}
      className={`
        w-full text-left px-4 py-2.5 rounded-xl border transition-all
        ${
          variant === "muted"
            ? "bg-bg-tertiary border-border/50 hover:border-text-muted/30"
            : "bg-bg-tertiary border-accent-warm/20 hover:border-accent-warm/40 hover:bg-accent-warm/5"
        }
      `}
    >
      <span className="text-sm text-text-primary">{label}</span>
      <p className="text-[10px] text-text-muted">{description}</p>
    </button>
  );
}
