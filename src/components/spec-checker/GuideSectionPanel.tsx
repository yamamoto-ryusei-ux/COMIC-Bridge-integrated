import type { PsdFile } from "../../types";
import { useGuideStore } from "../../store/guideStore";
import { useSpecStore } from "../../store/specStore";

interface GuideSectionPanelProps {
  file: PsdFile;
}

export function GuideSectionPanel({ file }: GuideSectionPanelProps) {
  const openEditor = useGuideStore((state) => state.openEditor);
  const guides = useGuideStore((state) => state.guides);
  const activeSpecId = useSpecStore((state) => state.activeSpecId);
  const checkResults = useSpecStore((state) => state.checkResults);

  const hasGuides = file.metadata?.hasGuides;
  const fileCheckResult = checkResults.get(file.id);
  const hasSpecNG = fileCheckResult && !fileCheckResult.passed;
  const hCount = file.metadata?.guides?.filter((g) => g.direction === "horizontal").length ?? 0;
  const vCount = file.metadata?.guides?.filter((g) => g.direction === "vertical").length ?? 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded-md bg-guide-v/20 flex items-center justify-center flex-shrink-0">
          <svg
            className="w-3 h-3 text-guide-v"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M3 20h18M4 3v18M20 3v18" />
          </svg>
        </div>
        <span className="text-xs font-medium text-text-primary">ガイド状態</span>
      </div>

      <div className="pl-7">
        {hasGuides ? (
          <div className="text-xs text-text-secondary space-y-0.5">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-guide-v" />
              <span>
                水平: {hCount}本 / 垂直: {vCount}本
              </span>
            </div>
          </div>
        ) : (
          <div className="text-xs text-text-muted flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-text-muted/40" />
            <span>ガイドなし</span>
          </div>
        )}

        <button
          onClick={openEditor}
          className={`
            mt-2 w-full text-xs px-3 py-1.5 rounded-lg transition-all
            flex items-center justify-center gap-1.5
            ${
              !hasGuides && guides.length > 0
                ? "bg-guide-v/20 text-guide-v hover:bg-guide-v/30 font-medium"
                : "bg-bg-tertiary text-text-secondary hover:bg-bg-elevated hover:text-text-primary"
            }
          `}
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
              d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
            />
          </svg>
          ガイド編集を開く
        </button>
        {activeSpecId && hasSpecNG && (
          <p className="mt-1.5 text-[11px] text-accent">適用時に仕様修正も同時実行されます</p>
        )}
      </div>
    </div>
  );
}
