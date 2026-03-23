import { usePsdStore } from "../../store/psdStore";
import { useSpecStore } from "../../store/specStore";
import { useOpenInPhotoshop } from "../../hooks/useOpenInPhotoshop";
import { usePhotoshopConverter } from "../../hooks/usePhotoshopConverter";
import { MetadataPanel } from "../metadata/MetadataPanel";
import { FixGuidePanel } from "../spec-checker/FixGuidePanel";
import { GuideSectionPanel } from "../spec-checker/GuideSectionPanel";

export function DetailSlidePanel() {
  const activeFile = usePsdStore((state) => state.getActiveFile());
  const clearSelection = usePsdStore((state) => state.clearSelection);
  const checkResults = useSpecStore((state) => state.checkResults);
  const { openFileInPhotoshop } = useOpenInPhotoshop();
  const { isPhotoshopInstalled } = usePhotoshopConverter();

  const checkResult = activeFile ? checkResults.get(activeFile.id) : undefined;
  const hasError = checkResult && !checkResult.passed;
  const isOpen = !!activeFile;

  return (
    <>
      {/* Backdrop */}
      {isOpen && <div className="absolute inset-0 z-20" onClick={clearSelection} />}

      {/* Panel */}
      <div
        data-detail-panel
        className={`
          absolute top-0 right-0 bottom-0 w-80 z-30
          bg-bg-secondary border-l border-border shadow-lg
          transition-transform duration-300 ease-in-out
          flex flex-col overflow-hidden
          ${isOpen ? "translate-x-0" : "translate-x-full"}
        `}
      >
        {activeFile && (
          <>
            {/* Header */}
            <div className="px-3 py-2 border-b border-border flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-6 h-6 rounded-md bg-accent-secondary/20 flex items-center justify-center flex-shrink-0">
                  <svg
                    className="w-3.5 h-3.5 text-accent-secondary"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
                <span className="text-xs font-medium text-text-primary truncate">
                  {activeFile.fileName}
                </span>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {isPhotoshopInstalled && activeFile.filePath && (
                  <button
                    className="w-6 h-6 flex items-center justify-center rounded transition-all text-[#31A8FF] hover:bg-[#31A8FF]/15 active:scale-95"
                    onClick={(e) => {
                      e.stopPropagation();
                      openFileInPhotoshop(activeFile.filePath);
                    }}
                    title="Photoshopで開く (P)"
                  >
                    <span className="text-sm font-bold leading-none">P</span>
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    clearSelection();
                  }}
                  className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto">
              {hasError && checkResult && (
                <div className="p-3 border-b border-border">
                  <FixGuidePanel checkResult={checkResult} />
                </div>
              )}
              <div className="p-3 border-b border-border">
                <GuideSectionPanel file={activeFile} />
              </div>
              <MetadataPanel file={activeFile} />
            </div>
          </>
        )}
      </div>
    </>
  );
}
