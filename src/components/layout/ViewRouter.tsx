import { useViewStore } from "../../store/viewStore";
import { SpecCheckView } from "../views/SpecCheckView";
import { LayerControlView } from "../views/LayerControlView";
import { SplitView } from "../views/SplitView";
import { ReplaceView } from "../views/ReplaceView";
import { ComposeView } from "../views/ComposeView";
import { RenameView } from "../views/RenameView";
import { TiffView } from "../views/TiffView";
import { ScanPsdView } from "../views/ScanPsdView";
import { TypsettingView } from "../views/TypsettingView";

export function ViewRouter() {
  const activeView = useViewStore((s) => s.activeView);

  return (
    <div className="flex-1 overflow-hidden bg-bg-primary relative">
      {activeView === "specCheck" && <SpecCheckView />}
      {activeView === "layers" && <LayerControlView />}
      {activeView === "typesetting" && <TypsettingView />}
      {activeView === "split" && <SplitView />}
      {activeView === "replace" && <ReplaceView />}
      {activeView === "compose" && <ComposeView />}
      {activeView === "rename" && <RenameView />}
      {activeView === "tiff" && <TiffView />}
      {activeView === "scanPsd" && <ScanPsdView />}
    </div>
  );
}
