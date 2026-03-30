import { useState } from "react";
import { usePsdStore } from "../../store/psdStore";
import { LayerTree } from "../metadata/LayerTree";
import {
  collectTextLayers,
  useFontResolver,
} from "../../hooks/useFontResolver";

export function SpecLayerGrid() {
  const files = usePsdStore((s) => s.files);
  const activeFileId = usePsdStore((s) => s.activeFileId);
  const selectFile = usePsdStore((s) => s.selectFile);
  const [textOnly, setTextOnly] = useState(false);
  const { fontInfo } = useFontResolver(files);

  return (
    <div className="h-full overflow-auto select-none">
      {/* Controls */}
      <div className="sticky top-0 z-10 bg-bg-primary/95 backdrop-blur-sm px-4 py-2 border-b border-border/30 flex items-center gap-3">
        <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-text-secondary hover:text-text-primary">
          <input
            type="checkbox"
            checked={textOnly}
            onChange={(e) => setTextOnly(e.target.checked)}
            className="rounded border-border accent-accent w-3.5 h-3.5"
          />
          写植仕様のみ表示
        </label>
      </div>

      <div
        className="grid gap-3 p-4"
        style={{
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
        }}
      >
        {files.map((file) => {
          const textLayers = file.metadata?.layerTree
            ? collectTextLayers(file.metadata.layerTree)
            : [];
          return (
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
                  {file.metadata?.layerCount ?? 0}L
                </span>
                {textLayers.length > 0 && (
                  <span className="text-[10px] text-accent/60 flex-shrink-0">
                    {textLayers.length}T
                  </span>
                )}
              </div>

              {/* Text Layer Spec (写植仕様) — shown first */}
              {textLayers.length > 0 ? (
                <div className="p-1.5 border-b border-border/30">
                  {textLayers.map((tl, i) => {
                    const mainFont = tl.textInfo?.fonts[0];
                    const color = mainFont ? fontInfo.getFontColor(mainFont) : "#888";
                    return (
                      <div key={i} className="flex items-start gap-1.5 py-0.5 text-[10px]">
                        <div
                          className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1"
                          style={{ backgroundColor: color }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1">
                            <span className="text-text-primary font-medium truncate">
                              {tl.layerName}
                            </span>
                            {tl.textInfo?.fontSizes?.length ? (
                              <span className="text-text-muted flex-shrink-0">
                                {tl.textInfo.fontSizes.join("/")}pt
                              </span>
                            ) : null}
                          </div>
                          {mainFont && (
                            <div className="truncate" style={{ color }}>
                              {fontInfo.getFontLabel(mainFont)}
                              {fontInfo.isMissing(mainFont) && (
                                <span className="text-error ml-1">[未]</span>
                              )}
                            </div>
                          )}
                          {tl.textInfo?.text && (
                            <div className="text-text-muted/50 truncate">
                              {tl.textInfo.text.replace(/\n/g, " ").substring(0, 40)}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : textOnly ? (
                <div className="flex items-center justify-center py-4 text-[10px] text-text-muted">
                  テキストレイヤーなし
                </div>
              ) : null}

              {/* Layer Tree (hidden when textOnly) */}
              {!textOnly && (
                <div className="p-1.5">
                  {file.metadata?.layerTree?.length ? (
                    <LayerTree layers={file.metadata.layerTree} />
                  ) : (
                    <div className="flex items-center justify-center py-4 text-[10px] text-text-muted">
                      レイヤー情報なし
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
