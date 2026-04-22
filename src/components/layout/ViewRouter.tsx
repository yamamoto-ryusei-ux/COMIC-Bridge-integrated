import { useState, useEffect } from "react";
import { useViewStore } from "../../store/viewStore";
import { SpecCheckView } from "../views/SpecCheckView";
import { LayerControlView } from "../views/LayerControlView";
import { SplitView } from "../../features/split/SplitView";
import { ReplaceView } from "../../features/replace/ReplaceView";
import { ComposeView } from "../../features/compose/ComposeView";
import { RenameView } from "../../features/rename/RenameView";
import { TiffView } from "../views/TiffView";
import { ScanPsdView } from "../views/ScanPsdView";
// TypsettingView は隔離中 — 削除予定
// import { TypsettingView } from "../views/TypsettingView";
// KENBAN は完全削除済み（差分・分割は統合ビューアーへReact移植完了）
import { ProgenView } from "../views/ProgenView";
import { UnifiedViewerView } from "../views/UnifiedViewerView";
import { FolderSetupView } from "../views/FolderSetupView";
import { RequestPrepView } from "../views/RequestPrepView";

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
      {activeView === "folderSetup" && <FolderSetupView />}
      {activeView === "requestPrep" && <RequestPrepView />}

      {/* ProGen: React native (state-preserving via display toggle) */}
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
