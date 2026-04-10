import { useState, useEffect } from "react";
import { UnifiedViewer } from "../unified-viewer/UnifiedViewer";
import { useViewStore } from "../../store/viewStore";
import { DiffViewerView } from "../diff-viewer/DiffViewerView";
import { ParallelViewerView } from "../parallel-viewer/ParallelViewerView";
import { useDiffStore, computeCompareMode } from "../../store/diffStore";
import { useParallelStore } from "../../store/parallelStore";

type ViewerSubMode = "viewer" | "diff" | "parallel";

const SUB_TABS: { id: ViewerSubMode; label: string }[] = [
  { id: "viewer", label: "統合ビューアー" },
  { id: "diff", label: "差分モード" },
  { id: "parallel", label: "分割ビューアー" },
];

export function UnifiedViewerView() {
  const [activeSubMode, setActiveSubMode] = useState<ViewerSubMode>("viewer");
  const isFullscreen = useViewStore((s) => s.isViewerFullscreen);
  const kenbanPathA = useViewStore((s) => s.kenbanPathA);
  const kenbanPathB = useViewStore((s) => s.kenbanPathB);

  // 差分タブ移動時: ファイル読み込み + compareMode 自動判定
  useEffect(() => {
    if (activeSubMode !== "diff") return;

    const setupDiffTab = async () => {
      const diffState = useDiffStore.getState();
      const getExt = (p: string) => p.substring(p.lastIndexOf(".") + 1).toLowerCase();

      // ── ステップ1: ファイルが未ロードでパスがあれば、明示的に読み込む ──
      const loadPromises: Promise<void>[] = [];
      if (kenbanPathA && diffState.folderA !== kenbanPathA) {
        loadPromises.push(diffState.loadFolderSide(kenbanPathA, "A"));
      }
      if (kenbanPathB && diffState.folderB !== kenbanPathB) {
        loadPromises.push(diffState.loadFolderSide(kenbanPathB, "B"));
      }
      await Promise.all(loadPromises);

      // ── ステップ2: ロード後の filesA/B から compareMode を判定 ──
      const after = useDiffStore.getState();
      const extA = after.filesA[0] ? getExt(after.filesA[0].filePath) : "";
      const extB = after.filesB[0] ? getExt(after.filesB[0].filePath) : "";
      const mode = computeCompareMode(extA, extB);
      if (mode && mode !== after.compareMode) {
        after.setCompareMode(mode);
      }
    };

    setupDiffTab();
  }, [activeSubMode, kenbanPathA, kenbanPathB]);

  // 分割タブ移動時: ファイル読み込み
  useEffect(() => {
    if (activeSubMode !== "parallel") return;
    const ps = useParallelStore.getState();
    if (kenbanPathA && ps.A.folder !== kenbanPathA) {
      ps.loadFolderSide("A", kenbanPathA);
    }
    if (kenbanPathB && ps.B.folder !== kenbanPathB) {
      ps.loadFolderSide("B", kenbanPathB);
    }
  }, [activeSubMode, kenbanPathA, kenbanPathB]);

  return (
    <div className="flex-1 h-full overflow-hidden flex flex-col">
      {/* Sub-mode selector bar — 全画面時は非表示 */}
      {!isFullscreen && <div className="flex-shrink-0 h-9 bg-bg-secondary border-b border-border flex items-center px-3 gap-1">
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
      </div>}

      {/* Content area — タブ切替で毎回マウント（検A/B propsを確実に反映） */}
      <div className="flex-1 overflow-hidden relative">
        {activeSubMode === "viewer" && (
          <div className="flex h-full w-full overflow-hidden" style={{ position: "absolute", inset: 0 }}>
            <UnifiedViewer />
          </div>
        )}

        {activeSubMode === "diff" && (
          <div className="flex h-full w-full overflow-hidden" style={{ position: "absolute", inset: 0 }}>
            <DiffViewerView externalPathA={kenbanPathA} externalPathB={kenbanPathB} />
          </div>
        )}

        {activeSubMode === "parallel" && (
          <div className="flex h-full w-full overflow-hidden" style={{ position: "absolute", inset: 0 }}>
            <ParallelViewerView externalPathA={kenbanPathA} externalPathB={kenbanPathB} />
          </div>
        )}
      </div>
    </div>
  );
}
