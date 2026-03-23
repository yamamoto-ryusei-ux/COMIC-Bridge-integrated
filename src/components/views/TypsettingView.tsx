import { useState } from "react";
import { usePsdStore } from "../../store/psdStore";
import { useOpenInPhotoshop } from "../../hooks/useOpenInPhotoshop";
import { CompactFileList } from "../common/CompactFileList";
import { SpecTextGrid, type TextIssueFilter } from "../spec-checker/SpecTextGrid";
import { SpecViewerPanel } from "../spec-checker/SpecViewerPanel";
import { SpecScanJsonDialog } from "../spec-checker/SpecScanJsonDialog";
import { TypesettingViewerPanel } from "../typesetting-check/TypesettingViewerPanel";
import { TypesettingCheckPanel } from "../typesetting-check/TypesettingCheckPanel";
import { TypesettingConfirmPanel } from "../typesetting-confirm/TypesettingConfirmPanel";
import { DropZone } from "../file-browser/DropZone";
import { FontBookView } from "./FontBookView";
import { TextExtractButton } from "../common/TextExtractButton";

type SubTab = "spec" | "viewer" | "fontBook" | "check" | "confirm";

export function TypsettingView() {
  const files = usePsdStore((s) => s.files);
  const [subTab, setSubTab] = useState<SubTab>("spec");
  const [viewerFilterFont, setViewerFilterFont] = useState<string | null>(null);
  const [viewerFilterIssue, setViewerFilterIssue] = useState<TextIssueFilter | null>(null);
  const [viewerFilterStroke, setViewerFilterStroke] = useState<number | null>(null);
  const [showScanJsonDialog, setShowScanJsonDialog] = useState(false);
  const [extractButtonVisible, setExtractButtonVisible] = useState(true);
  const { openFileInPhotoshop } = useOpenInPhotoshop();

  const hasFiles = files.length > 0;

  // 写植調整・写植確認・フォント帳タブはPSDなしでも使用可能
  if (!hasFiles && subTab !== "check" && subTab !== "confirm" && subTab !== "fontBook") {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        {/* Sub-tab bar */}
        <div className="px-4 py-2 bg-bg-secondary border-b border-border flex items-center gap-4 flex-shrink-0">
          <SubTabBar subTab={subTab} setSubTab={setSubTab} />
        </div>
        <DropZone />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Sub-tab bar */}
      <div className="px-4 py-2 bg-bg-secondary border-b border-border flex items-center gap-4 flex-shrink-0">
        <SubTabBar subTab={subTab} setSubTab={setSubTab} />
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {subTab === "spec" && (
          <>
            <CompactFileList className="w-52 flex-shrink-0 border-r border-border" />
            <div className="flex-1 overflow-hidden relative">
              <SpecTextGrid
                onFilterFont={(font) => {
                  setViewerFilterFont(font);
                  setViewerFilterIssue(null);
                  setViewerFilterStroke(null);
                  setSubTab("viewer");
                }}
                onFilterIssue={(issue) => {
                  setViewerFilterIssue(issue);
                  setViewerFilterFont(null);
                  setViewerFilterStroke(null);
                  setSubTab("viewer");
                }}
                onFilterStroke={(size) => {
                  setViewerFilterStroke(size);
                  setViewerFilterFont(null);
                  setViewerFilterIssue(null);
                  setSubTab("viewer");
                }}
              />
              {/* フローティングボタン群 */}
              {files.length > 0 && (
                <div className="absolute bottom-6 right-6 z-10 flex flex-col items-end gap-4">
                  <button
                    className="h-16 min-w-[220px] px-8 text-lg font-bold rounded-2xl shadow-2xl transition-all duration-200 flex items-center justify-center gap-3 bg-bg-secondary border-2 border-accent/40 text-accent hover:bg-bg-elevated hover:border-accent/60 hover:shadow-[0_6px_24px_rgba(255,90,138,0.25)] active:scale-[0.97]"
                    onClick={() => setShowScanJsonDialog(true)}
                  >
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                    JSON登録
                    <span className="px-2 py-1 rounded-lg bg-accent/10 text-accent text-sm font-bold">
                      {files.length}
                    </span>
                  </button>
                  <TextExtractButton />
                </div>
              )}
            </div>
          </>
        )}

        {subTab === "viewer" && (
          <div className="flex-1 overflow-hidden">
            <SpecViewerPanel
              onOpenInPhotoshop={openFileInPhotoshop}
              initialFilterFont={viewerFilterFont}
              onFilterFontConsumed={() => setViewerFilterFont(null)}
              initialFilterIssue={viewerFilterIssue}
              onFilterIssueConsumed={() => setViewerFilterIssue(null)}
              initialFilterStroke={viewerFilterStroke}
              onFilterStrokeConsumed={() => setViewerFilterStroke(null)}
            />
          </div>
        )}

        {subTab === "fontBook" && (
          <div className="flex-1 overflow-hidden">
            <FontBookView
              onNavigateToViewer={(font) => {
                setViewerFilterFont(font);
                setViewerFilterIssue(null);
                setViewerFilterStroke(null);
                setSubTab("viewer");
              }}
            />
          </div>
        )}

        {subTab === "check" &&
          (hasFiles ? (
            <>
              <div className="flex-1 overflow-hidden relative">
                <TypesettingViewerPanel />
                <div className="absolute bottom-6 right-6 z-10">
                  <div className="flex items-center gap-2">
                    {extractButtonVisible ? (
                      <button
                        onClick={() => setExtractButtonVisible(false)}
                        className="p-1.5 rounded-full text-text-muted/40 hover:text-text-muted/70 hover:bg-black/5 transition-all"
                        title="テキスト抽出ボタンを非表示"
                      >
                        <svg
                          className="w-5 h-5"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                          />
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                          />
                        </svg>
                      </button>
                    ) : (
                      <div
                        className="group/eye p-1.5 cursor-pointer"
                        onClick={() => setExtractButtonVisible(true)}
                        title="テキスト抽出ボタンを表示"
                      >
                        <svg
                          className="w-5 h-5 opacity-0 group-hover/eye:opacity-60 transition-opacity duration-200 text-text-muted"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                          />
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                          />
                        </svg>
                      </div>
                    )}
                    <div className={extractButtonVisible ? "" : "invisible"}>
                      <TextExtractButton compact />
                    </div>
                  </div>
                </div>
              </div>
              <div className="w-[480px] flex-shrink-0 border-l border-border overflow-hidden flex flex-col bg-bg-secondary">
                <TypesettingCheckPanel />
              </div>
            </>
          ) : (
            <>
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center space-y-2">
                  <svg
                    className="w-12 h-12 mx-auto text-text-muted/30"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                  <p className="text-xs text-text-muted">
                    PSDファイルをドロップして読み込んでください
                  </p>
                </div>
              </div>
              <div className="w-[480px] flex-shrink-0 border-l border-border overflow-hidden flex flex-col bg-bg-secondary">
                <TypesettingCheckPanel />
              </div>
            </>
          ))}

        {subTab === "confirm" && <TypesettingConfirmPanel />}
      </div>

      {/* JSON登録ダイアログ */}
      {showScanJsonDialog && <SpecScanJsonDialog onClose={() => setShowScanJsonDialog(false)} />}
    </div>
  );
}

function SubTabBar({ subTab, setSubTab }: { subTab: SubTab; setSubTab: (t: SubTab) => void }) {
  const tabs: { id: SubTab; label: string }[] = [
    { id: "spec", label: "写植仕様" },
    { id: "viewer", label: "DTPビューアー" },
    { id: "fontBook", label: "フォント帳" },
    { id: "check", label: "写植調整" },
    { id: "confirm", label: "写植確認" },
  ];

  return (
    <div className="flex bg-bg-elevated rounded-md p-0.5 border border-white/5 flex-shrink-0">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => setSubTab(tab.id)}
          className={`px-2 py-1 text-[10px] rounded transition-all ${
            subTab === tab.id
              ? "bg-bg-tertiary text-text-primary font-medium shadow-sm"
              : "text-text-muted hover:text-text-secondary"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
