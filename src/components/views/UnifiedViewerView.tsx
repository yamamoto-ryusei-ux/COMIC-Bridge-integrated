import { useState, useEffect } from "react";
import { UnifiedViewer } from "../unified-viewer/UnifiedViewer";
import KenbanApp from "../kenban/KenbanApp";
import "../../kenban-utils/kenban.css";
import "../../kenban-utils/kenbanApp.css";

type ViewerSubMode = "viewer" | "diff" | "parallel";

const SUB_TABS: { id: ViewerSubMode; label: string }[] = [
  { id: "viewer", label: "統合ビューアー" },
  { id: "diff", label: "差分モード" },
  { id: "parallel", label: "分割ビューアー" },
];

export function UnifiedViewerView() {
  const [activeSubMode, setActiveSubMode] = useState<ViewerSubMode>("viewer");

  // State-preserving mount (once mounted, never unmount)
  const [diffMounted, setDiffMounted] = useState(false);
  const [parallelMounted, setParallelMounted] = useState(false);

  useEffect(() => {
    if (activeSubMode === "diff") setDiffMounted(true);
    if (activeSubMode === "parallel") setParallelMounted(true);
  }, [activeSubMode]);

  return (
    <div className="flex-1 h-full overflow-hidden flex flex-col">
      {/* Sub-mode selector bar */}
      <div className="flex-shrink-0 h-9 bg-bg-secondary border-b border-border flex items-center px-3 gap-1">
        {SUB_TABS.map((tab) => (
          <button
            key={tab.id}
            className={`
              flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-md
              transition-all duration-150 flex-shrink-0
              ${
                activeSubMode === tab.id
                  ? "text-white bg-gradient-to-r from-accent to-accent-secondary shadow-sm"
                  : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary"
              }
            `}
            onClick={() => setActiveSubMode(tab.id)}
          >
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-hidden relative">
        {/* Unified Viewer (3-column) */}
        <div style={{ display: activeSubMode === "viewer" ? "contents" : "none" }}>
          <div className="flex h-full w-full overflow-hidden" style={{ position: "absolute", inset: 0 }}>
            <UnifiedViewer />
          </div>
        </div>

        {/* KENBAN Diff Mode */}
        {diffMounted && (
          <div
            className="kenban-scope"
            style={{ display: activeSubMode === "diff" ? "contents" : "none" }}
          >
            <div
              className="flex h-full w-full overflow-hidden"
              style={{ position: "absolute", inset: 0 }}
            >
              <KenbanApp defaultAppMode="diff-check" />
            </div>
          </div>
        )}

        {/* KENBAN Parallel Viewer */}
        {parallelMounted && (
          <div
            className="kenban-scope"
            style={{ display: activeSubMode === "parallel" ? "contents" : "none" }}
          >
            <div
              className="flex h-full w-full overflow-hidden"
              style={{ position: "absolute", inset: 0 }}
            >
              <KenbanApp defaultAppMode="parallel-view" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
