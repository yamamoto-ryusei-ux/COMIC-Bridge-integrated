import { CompactFileList } from "../common/CompactFileList";
import { SplitPanel } from "../split/SplitPanel";
import { SplitPreview } from "../split/SplitPreview";
import { usePsdStore } from "../../store/psdStore";
import { DropZone } from "../file-browser/DropZone";

export function SplitView() {
  const files = usePsdStore((state) => state.files);
  const hasFiles = files.length > 0;

  if (!hasFiles) {
    return <DropZone />;
  }

  return (
    <div className="flex h-full overflow-hidden" data-tool-panel>
      {/* File List */}
      <CompactFileList className="w-52 flex-shrink-0 border-r border-border" />

      {/* Preview Area */}
      <div className="flex-1 overflow-hidden">
        <SplitPreview />
      </div>

      {/* Settings Panel */}
      <div className="w-[320px] flex-shrink-0 border-l border-border overflow-hidden">
        <SplitPanel />
      </div>
    </div>
  );
}
