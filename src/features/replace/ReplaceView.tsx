import { ReplacePanel } from "./components/ReplacePanel";
import { ReplaceDropZone } from "./components/ReplaceDropZone";

export function ReplaceView() {
  return (
    <div className="flex h-full overflow-hidden" data-tool-panel>
      {/* Settings panel */}
      <div className="w-[360px] flex-shrink-0 border-r border-border overflow-hidden">
        <ReplacePanel />
      </div>

      {/* Right panel: drop zone */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <ReplaceDropZone />
      </div>
    </div>
  );
}
