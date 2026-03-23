import { useState, useMemo } from "react";
import type { LayerNode, LayerBounds } from "../../types";

interface LayerTreeProps {
  layers: LayerNode[];
  depth?: number;
  parentVisible?: boolean;
  selectedLayerId?: string | null;
  onSelectLayer?: (layerId: string | null, bounds: LayerBounds | null) => void;
}

export function LayerTree({
  layers,
  depth = 0,
  parentVisible = true,
  selectedLayerId,
  onSelectLayer,
}: LayerTreeProps) {
  // ag-psdはbottom-to-top順で返すため、reverseしてPhotoshop表示順（上がforeground）に変換
  const reversed = useMemo(() => [...layers].reverse(), [layers]);
  return (
    <div className="text-xs space-y-0.5">
      {reversed.map((layer) => (
        <LayerItem
          key={layer.id}
          layer={layer}
          depth={depth}
          parentVisible={parentVisible}
          selectedLayerId={selectedLayerId}
          onSelectLayer={onSelectLayer}
        />
      ))}
    </div>
  );
}

interface LayerItemProps {
  layer: LayerNode;
  depth: number;
  parentVisible: boolean;
  selectedLayerId?: string | null;
  onSelectLayer?: (layerId: string | null, bounds: LayerBounds | null) => void;
}

function LayerItem({
  layer,
  depth,
  parentVisible,
  selectedLayerId,
  onSelectLayer,
}: LayerItemProps) {
  const [isExpanded, setIsExpanded] = useState(depth < 2);
  const hasChildren = layer.children && layer.children.length > 0;
  const effectiveVisible = layer.visible && parentVisible;

  const getLayerIcon = () => {
    const iconClass = `w-3.5 h-3.5 ${effectiveVisible ? "" : "opacity-35"}`;
    switch (layer.type) {
      case "group":
        return (
          <svg
            className={`${iconClass} text-manga-lavender`}
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
          </svg>
        );
      case "text":
        return (
          <svg className={`${iconClass} text-[#f06292]`} viewBox="0 0 20 20" fill="currentColor">
            <path d="M5 4h10v2.5h-1.2V5.5H10.6V14h1.5v1.5h-4.2V14h1.5V5.5H6.2v1H5V4z" />
          </svg>
        );
      case "adjustment":
        return (
          <svg className={`${iconClass} text-accent-warm`} viewBox="0 0 20 20" fill="currentColor">
            <path d="M10 2a8 8 0 100 16 8 8 0 000-16zM4 10a6 6 0 0112 0H4z" />
          </svg>
        );
      case "smartObject":
        return (
          <svg
            className={`${iconClass} text-accent-tertiary`}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path d="M10 2L3 6v8l7 4 7-4V6l-7-4zm0 2.24L14.5 7 10 9.76 5.5 7 10 4.24z" />
          </svg>
        );
      case "shape":
        return (
          <svg className={`${iconClass} text-[#59a8f8]`} viewBox="0 0 20 20" fill="currentColor">
            <path d="M3 3h14v14H3V3zm2 2v10h10V5H5z" />
          </svg>
        );
      default:
        return (
          <svg className={`${iconClass} text-[#42a5f5]`} viewBox="0 0 20 20" fill="currentColor">
            <path d="M2 5a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V5zm2 0v6.586l3.293-3.293a1 1 0 011.414 0L13 12.586l1.293-1.293a1 1 0 011.414 0L16 11.586V5H4zm0 10v-1l3.293-3.293L12 15.414V15H4zm12 0v-1.586l-2-2-1.293 1.293L15.414 15H16zM13.5 8a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
          </svg>
        );
    }
  };

  const getTypeLabel = () => {
    switch (layer.type) {
      case "group":
        return "グループ";
      case "text":
        return "テキスト";
      case "adjustment":
        return "調整";
      case "smartObject":
        return "スマートオブジェクト";
      case "shape":
        return "シェイプ";
      default:
        return "レイヤー";
    }
  };

  return (
    <div>
      <div
        className={`
          flex items-center gap-1.5 py-1 px-1.5 rounded-lg transition-all duration-150
          ${onSelectLayer && layer.bounds ? "cursor-pointer hover:bg-white/8" : "cursor-default hover:bg-white/5"}
          ${selectedLayerId === layer.id ? "bg-white/8 border-l-2 border-[rgba(194,90,90,0.5)]" : ""}
        `}
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
        onClick={
          onSelectLayer && layer.bounds
            ? (e) => {
                e.stopPropagation();
                onSelectLayer(
                  selectedLayerId === layer.id ? null : layer.id,
                  selectedLayerId === layer.id ? null : layer.bounds!,
                );
              }
            : undefined
        }
      >
        {/* Expand/Collapse Button */}
        {hasChildren ? (
          <button
            className="w-4 h-4 flex items-center justify-center text-text-muted hover:text-accent transition-colors rounded"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            <svg
              className={`w-3 h-3 transition-transform duration-200 ${
                isExpanded ? "rotate-90" : ""
              }`}
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        ) : (
          <div className="w-4" />
        )}

        {/* Visibility Indicator */}
        <div
          className={`w-4 h-4 flex items-center justify-center rounded transition-colors ${
            effectiveVisible ? "text-accent-tertiary" : "text-text-muted"
          }`}
          title={layer.visible ? "表示" : "非表示"}
        >
          {layer.visible ? (
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
              <path
                fillRule="evenodd"
                d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z"
                clipRule="evenodd"
              />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z"
                clipRule="evenodd"
              />
              <path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z" />
            </svg>
          )}
        </div>

        {/* Layer Type Icon */}
        <div className="flex-shrink-0">{getLayerIcon()}</div>

        {/* Layer Name */}
        <span
          className={`truncate flex-1 ${
            effectiveVisible ? "text-text-primary" : "text-text-muted/50"
          }`}
          title={`${layer.name} (${getTypeLabel()})`}
        >
          {layer.name}
        </span>

        {/* Mask Badges */}
        <div className={`flex items-center gap-1 ${effectiveVisible ? "" : "opacity-40"}`}>
          {layer.clipping && (
            <span
              className="text-[9px] px-1 py-0.5 rounded bg-accent/15 text-accent flex-shrink-0"
              title="クリッピングマスク"
            >
              clip
            </span>
          )}
          {layer.hasMask && (
            <span className="flex-shrink-0" title="レイヤーマスク">
              <svg className="w-3 h-3 text-text-muted" viewBox="0 0 16 16" fill="currentColor">
                <rect
                  x="1"
                  y="1"
                  width="14"
                  height="14"
                  rx="2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <circle cx="8" cy="8" r="4" />
              </svg>
            </span>
          )}
          {layer.hasVectorMask && (
            <span className="flex-shrink-0" title="ベクトルマスク">
              <svg className="w-3 h-3 text-[#59a8f8]" viewBox="0 0 16 16" fill="currentColor">
                <rect
                  x="1"
                  y="1"
                  width="14"
                  height="14"
                  rx="2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <path d="M4 12L8 4l4 8H4z" fill="none" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </span>
          )}
          {layer.locked && (
            <span className="flex-shrink-0" title="ロック">
              <svg
                className="w-3 h-3 text-text-muted"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3.5" y="7" width="9" height="7" rx="1" />
                <path d="M5.5 7V5a2.5 2.5 0 015 0v2" />
              </svg>
            </span>
          )}

          {/* Opacity Badge */}
          {layer.opacity < 100 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-text-muted ml-auto flex-shrink-0">
              {layer.opacity}%
            </span>
          )}
        </div>
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div className="relative">
          {/* 接続線 */}
          <div
            className="absolute left-0 top-0 bottom-2 w-px bg-white/10"
            style={{ marginLeft: `${depth * 14 + 12}px` }}
          />
          <LayerTree
            layers={layer.children!}
            depth={depth + 1}
            parentVisible={effectiveVisible}
            selectedLayerId={selectedLayerId}
            onSelectLayer={onSelectLayer}
          />
        </div>
      )}
    </div>
  );
}
