import { usePsdStore } from "../../store/psdStore";
import { LayerTree } from "../metadata/LayerTree";

export function SpecLayerGrid() {
  const files = usePsdStore((s) => s.files);
  const activeFileId = usePsdStore((s) => s.activeFileId);
  const selectFile = usePsdStore((s) => s.selectFile);

  return (
    <div className="h-full overflow-auto p-4 select-none">
      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        }}
      >
        {files.map((file) => (
          <div
            key={file.id}
            className={`
              border rounded-xl cursor-pointer bg-bg-secondary/50 transition-all
              hover:bg-bg-secondary/80
              ${
                activeFileId === file.id
                  ? "border-accent/50 ring-1 ring-accent/20"
                  : "border-border hover:border-border-strong/50"
              }
            `}
            onClick={(e) => {
              if (e.shiftKey || e.ctrlKey || e.metaKey) return;
              selectFile(file.id);
            }}
          >
            {/* Header */}
            <div className="px-3 py-2 border-b border-border/60 flex items-center gap-2">
              <span
                className={`text-[11px] font-medium truncate flex-1 ${
                  activeFileId === file.id ? "text-accent" : "text-text-primary"
                }`}
              >
                {file.fileName.replace(/\.(psd|psb)$/i, "")}
              </span>
              <span className="text-[10px] text-text-muted flex-shrink-0">
                {file.metadata?.layerCount ?? 0} レイヤー
              </span>
            </div>
            {/* Layer Tree */}
            <div className="p-1.5">
              {file.metadata?.layerTree?.length ? (
                <LayerTree layers={file.metadata.layerTree} />
              ) : (
                <div className="flex items-center justify-center py-6 text-[10px] text-text-muted">
                  レイヤー情報なし
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
