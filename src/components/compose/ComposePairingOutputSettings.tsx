import { useState } from "react";
import { useComposeStore } from "../../store/composeStore";

export function ComposePairingOutputSettings() {
  const generalSettings = useComposeStore((s) => s.generalSettings);
  const setGeneralSettings = useComposeStore((s) => s.setGeneralSettings);
  const pairingJobs = useComposeStore((s) => s.pairingJobs);
  const pairingDialogMode = useComposeStore((s) => s.pairingDialogMode);
  const manualPairs = useComposeStore((s) => s.manualPairs);
  const [isOpen, setIsOpen] = useState(false);

  const firstPair = pairingDialogMode === "manual" ? manualPairs[0] : pairingJobs[0]?.pairs[0];
  const exampleName = firstPair
    ? generalSettings.saveFileName === "target"
      ? firstPair.targetName
      : firstPair.sourceName
    : "example_001.psd";
  const folderName = generalSettings.outputFolderName.trim() || "YYYYMMDD_HHmmss";

  return (
    <div className="border-t border-border">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
      >
        <svg
          className={`w-3.5 h-3.5 transition-transform ${isOpen ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-xs font-medium">出力設定</span>
      </button>

      {isOpen && (
        <div className="px-4 pb-3 space-y-3">
          {/* Output Folder Name */}
          <div>
            <label className="text-[10px] text-text-muted mb-1 block">出力フォルダ名</label>
            <input
              type="text"
              value={generalSettings.outputFolderName}
              onChange={(e) => setGeneralSettings({ outputFolderName: e.target.value })}
              placeholder="空欄＝日時で自動生成"
              className="w-full bg-bg-elevated border border-white/10 rounded-lg px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted/50 focus:border-accent focus:outline-none"
            />
          </div>

          {/* Save File Name */}
          <div>
            <label className="text-[10px] text-text-muted mb-1 block">保存ファイル名</label>
            <div className="flex gap-1.5">
              <button
                className={`flex-1 px-2 py-1.5 text-[10px] rounded-lg transition-all ${
                  generalSettings.saveFileName === "target"
                    ? "bg-accent/20 text-accent border border-accent/30"
                    : "bg-bg-elevated text-text-secondary border border-white/5"
                }`}
                onClick={() => setGeneralSettings({ saveFileName: "target" })}
              >
                原稿B名
              </button>
              <button
                className={`flex-1 px-2 py-1.5 text-[10px] rounded-lg transition-all ${
                  generalSettings.saveFileName === "source"
                    ? "bg-accent/20 text-accent border border-accent/30"
                    : "bg-bg-elevated text-text-secondary border border-white/5"
                }`}
                onClick={() => setGeneralSettings({ saveFileName: "source" })}
              >
                原稿A名
              </button>
            </div>
          </div>

          {/* Output Preview */}
          <div className="px-3 py-2 bg-bg-elevated/50 rounded-lg border border-white/5">
            <div className="text-[9px] text-text-muted mb-0.5">出力パス例:</div>
            <div className="text-[10px] text-text-secondary font-mono truncate">
              {"~/Desktop/Script_Output/合成ファイル_出力/"}
              <span className="text-accent">{folderName}</span>
              {"/"}
              <span className="text-accent">{exampleName}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
