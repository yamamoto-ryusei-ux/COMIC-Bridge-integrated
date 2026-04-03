import { useState, useEffect } from "react";
import { useViewStore } from "../../store/viewStore";
import { SpecCheckView } from "../views/SpecCheckView";
import { LayerControlView } from "../views/LayerControlView";
import { SplitView } from "../views/SplitView";
import { ReplaceView } from "../views/ReplaceView";
import { ComposeView } from "../views/ComposeView";
import { RenameView } from "../views/RenameView";
import { TiffView } from "../views/TiffView";
import { ScanPsdView } from "../views/ScanPsdView";
// TypsettingView は隔離中 — 削除予定
// import { TypsettingView } from "../views/TypsettingView";
// KenbanView は隔離中 — 統合ビューアーに移行完了後に削除予定
// import { KenbanView } from "../views/KenbanView";
import { ProgenView } from "../views/ProgenView";
import { UnifiedViewerView } from "../views/UnifiedViewerView";

export function ViewRouter() {
  const activeView = useViewStore((s) => s.activeView);

  // State-preserving mount for heavy tabs (once mounted, never unmount)
  const [progenMounted, setProgenMounted] = useState(false);
  const [unifiedViewerMounted, setUnifiedViewerMounted] = useState(false);

  useEffect(() => {
    if (activeView === "progen") setProgenMounted(true);
    if (activeView === "unifiedViewer") setUnifiedViewerMounted(true);
  }, [activeView]);

  return (
    <div className="flex-1 overflow-hidden bg-bg-primary relative">
      {/* Standard conditional rendering for lightweight tabs */}
      {activeView === "specCheck" && <SpecCheckView />}
      {activeView === "layers" && <LayerControlView />}
      {/* TypsettingView は隔離中 — 削除予定 */}
      {/* {activeView === "typesetting" && <TypsettingView />} */}
      {activeView === "split" && <SplitView />}
      {activeView === "replace" && <ReplaceView />}
      {activeView === "compose" && <ComposeView />}
      {activeView === "rename" && <RenameView />}
      {activeView === "tiff" && <TiffView />}
      {activeView === "scanPsd" && <ScanPsdView />}

      {/* KENBAN: 隔離中 — 統合ビューアーに移行完了後に削除予定 */}
      {/* kenbanMounted && (
        <div style={{ display: activeView === "kenban" ? "contents" : "none" }}>
          <KenbanView />
        </div>
      ) */}

      {/* ProGen: display toggle for state preservation */}
      {progenMounted && (
        <div style={{ display: activeView === "progen" ? "contents" : "none" }}>
          <ProgenView />
        </div>
      )}

      {/* Unified Viewer: display toggle for state preservation */}
      {unifiedViewerMounted && (
        <div style={{ display: activeView === "unifiedViewer" ? "contents" : "none" }}>
          <UnifiedViewerView />
        </div>
      )}
    </div>
  );
}
