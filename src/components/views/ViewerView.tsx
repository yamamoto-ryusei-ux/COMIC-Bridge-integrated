import { usePsdStore } from "../../store/psdStore";
import { useOpenInPhotoshop } from "../../hooks/useOpenInPhotoshop";
import { usePhotoshopConverter } from "../../hooks/usePhotoshopConverter";
import { SpecViewerPanel } from "../spec-checker/SpecViewerPanel";
import { DropZone } from "../file-browser/DropZone";

export function ViewerView() {
  const files = usePsdStore((s) => s.files);
  const { openFileInPhotoshop } = useOpenInPhotoshop();
  const { isPhotoshopInstalled } = usePhotoshopConverter();

  if (files.length === 0) {
    return <DropZone />;
  }

  return (
    <div className="flex-1 h-full overflow-hidden">
      <SpecViewerPanel onOpenInPhotoshop={isPhotoshopInstalled ? openFileInPhotoshop : undefined} />
    </div>
  );
}
