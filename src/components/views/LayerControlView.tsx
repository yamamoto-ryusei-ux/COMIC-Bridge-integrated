import { useState } from "react";
import { CompactFileList } from "../common/CompactFileList";
import { LayerControlPanel } from "../layer-control/LayerControlPanel";
import { LayerPreviewPanel } from "../layer-control/LayerPreviewPanel";
import { usePsdStore } from "../../store/psdStore";
import { DropZone } from "../file-browser/DropZone";
import { useOpenInPhotoshop } from "../../hooks/useOpenInPhotoshop";
import { TextExtractButton } from "../common/TextExtractButton";
import { RenameView } from "../../features/rename/RenameView";

type SubTab = "layerControl" | "rename";

export function LayerControlView() {
  const files = usePsdStore((state) => state.files);
  const hasFiles = files.length > 0;
  const { openFileInPhotoshop } = useOpenInPhotoshop();
  const [subTab, setSubTab] = useState<SubTab>("layerControl");

  if (!hasFiles && subTab === "layerControl") {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <SubTabBar subTab={subTab} setSubTab={setSubTab} />
        <DropZone />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <SubTabBar subTab={subTab} setSubTab={setSubTab} />

      {subTab === "layerControl" && (
        <div className="flex flex-1 overflow-hidden" data-tool-panel>
          {/* File List */}
          <CompactFileList className="w-52 flex-shrink-0 border-r border-border" />

          {/* Settings */}
          <div className="w-[360px] flex-shrink-0 border-r border-border overflow-hidden">
            <LayerControlPanel />
          </div>

          {/* Layer Preview */}
          <div className="flex-1 overflow-hidden relative">
            <LayerPreviewPanel onOpenInPhotoshop={openFileInPhotoshop} />
            <div className="absolute bottom-6 right-6 flex flex-col items-end gap-3 z-10">
              <TextExtractButton />
            </div>
          </div>
        </div>
      )}

      {subTab === "rename" && (
        <div className="flex-1 overflow-hidden">
          <RenameView />
        </div>
      )}
    </div>
  );
}

function SubTabBar({ subTab, setSubTab }: { subTab: SubTab; setSubTab: (t: SubTab) => void }) {
  const tabs: { id: SubTab; label: string }[] = [
    { id: "layerControl", label: "レイヤー制御" },
    { id: "rename", label: "リネーム" },
  ];

  return (
    <div className="px-4 py-1.5 bg-bg-secondary border-b border-border flex items-center gap-1 flex-shrink-0">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => setSubTab(tab.id)}
          className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
            subTab === tab.id
              ? "bg-accent/15 text-accent border border-accent/30"
              : "text-text-muted hover:text-text-secondary hover:bg-bg-tertiary border border-transparent"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
