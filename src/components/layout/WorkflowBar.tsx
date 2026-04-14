import { useState } from "react";
import { useViewStore } from "../../store/viewStore";
import { useScanPsdStore } from "../../store/scanPsdStore";
import { useUnifiedViewerStore } from "../../store/unifiedViewerStore";
import { useProgenStore } from "../../store/progenStore";
import { useWorkflowStore, WORKFLOWS, type Workflow, type WorkflowStep } from "../../store/workflowStore";

// ═══ ナビゲーション実行ヘルパー ═══

function executeStepNav(step: WorkflowStep) {
  if (!step.nav) return;
  const vs = useViewStore.getState();
  // WFステップ経由の場合、ツールメニューの toolMode をクリア
  useProgenStore.getState().setToolMode(null);
  if (step.progenMode) {
    // "_auto" の場合はフォルダセットアップのテキスト有無フラグから判定
    let resolvedMode = step.progenMode;
    if (resolvedMode === "_auto") {
      try {
        resolvedMode = localStorage.getItem("folderSetup_progenMode") || "extraction";
        localStorage.removeItem("progen_wfCheckMode");
      } catch { resolvedMode = "extraction"; }
    }
    // "_check" の場合はルール一覧画面に遷移 + 正誤チェックフラグをセット
    if (resolvedMode === "_check") {
      resolvedMode = "extraction";
      try {
        localStorage.setItem("progen_wfCheckMode", "simple");
        localStorage.removeItem("folderSetup_progenMode");
      } catch { /* ignore */ }
    }
    vs.setProgenMode(resolvedMode as any);
    // レーベル読み込み（ProGen起動時）
    const scan = useScanPsdStore.getState();
    const viewer = useUnifiedViewerStore.getState();
    let lbl = scan.workInfo.label || "";
    if (!lbl) {
      const jp = scan.currentJsonFilePath || viewer.presetJsonPath || "";
      if (jp) { const ps = jp.replace(/\//g, "\\").split("\\"); if (ps.length >= 2) lbl = ps[ps.length - 2]; }
    }
    if (lbl) useProgenStore.getState().loadMasterRule(lbl);
  }

  // テキストチェックステップ: コピー先の画像/PDFを検Aにセット
  if (step.label.includes("テキストチェック")) {
    try {
      const copyDest = localStorage.getItem("folderSetup_copyDestFolder");
      if (copyDest) vs.setKenbanPathA(copyDest);
    } catch { /* ignore */ }
  }

  // ZIP リリースステップ: FolderSetupのコピー先の1つ上の階層をRequestPrepに自動セット
  if (step.label.includes("ZIP リリース")) {
    try {
      const copyDest = localStorage.getItem("folderSetup_copyDestFolder");
      if (copyDest) {
        const parent = copyDest.replace(/[\\/][^\\/]+$/, "");
        if (parent) localStorage.setItem("requestPrep_autoFolder", parent);
      }
    } catch { /* ignore */ }
  }

  vs.setActiveView(step.nav as any);
}

// ═══ WorkflowBar（TopNav内の起動ボタン / フルバー） ═══

export function WorkflowBar() {
  const [showPicker, setShowPicker] = useState(false);
  const activeWorkflow = useWorkflowStore((s) => s.activeWorkflow);
  const currentStep = useWorkflowStore((s) => s.currentStep);

  const handleSelect = (wf: Workflow) => {
    useWorkflowStore.getState().startWorkflow(wf);
    setShowPicker(false);
    if (wf.steps[0]?.nav) executeStepNav(wf.steps[0]);
  };

  // ワークフロー進行中: TopNavの行全体をWFバーで塗りつぶす
  if (activeWorkflow) {
    return (
      <div className="flex-1 flex items-center gap-2 min-w-0">
        {/* ワークフロー名 */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gradient-to-br from-accent to-accent-secondary shadow-sm flex-shrink-0">
          <span className="text-sm">{activeWorkflow.icon}</span>
          <span className="text-[11px] font-bold text-white">{activeWorkflow.name}</span>
        </div>

        {/* 戻るボタン */}
        <button
          onClick={() => {
            useWorkflowStore.getState().prevStep();
            const prevIdx = Math.max(currentStep - 1, 0);
            const step = activeWorkflow.steps[prevIdx];
            if (step?.nav) executeStepNav(step);
          }}
          disabled={currentStep === 0}
          className="flex items-center gap-0.5 px-2 py-1 rounded-md text-[11px] font-medium bg-bg-tertiary hover:bg-bg-elevated text-text-primary border border-border disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0 transition-colors"
          title="前のステップへ戻る"
        >
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          <span>戻る</span>
        </button>

        {/* 進める / 完了ボタン */}
        <button
          onClick={() => {
            // 最終項目の場合はWFを完了して終了
            if (currentStep >= activeWorkflow.steps.length - 1) {
              useWorkflowStore.getState().abortWorkflow();
              return;
            }
            useWorkflowStore.getState().nextStep();
            const nextIdx = currentStep + 1;
            const step = activeWorkflow.steps[nextIdx];
            if (step?.nav) executeStepNav(step);
          }}
          className={`flex items-center gap-0.5 px-2 py-1 rounded-md text-[11px] font-medium text-white shadow-sm flex-shrink-0 transition-colors ${
            currentStep >= activeWorkflow.steps.length - 1
              ? "bg-success hover:bg-success/90"
              : "bg-accent hover:bg-accent-hover"
          }`}
          title={currentStep >= activeWorkflow.steps.length - 1 ? "ワークフローを完了する" : "次のステップへ進む"}
        >
          {currentStep >= activeWorkflow.steps.length - 1 ? (
            <>
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span>完了</span>
            </>
          ) : (
            <>
              <span>進める</span>
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </>
          )}
        </button>

        {/* 中断ボタン */}
        <button
          onClick={() => useWorkflowStore.getState().abortWorkflow()}
          className="flex items-center gap-0.5 px-2 py-1 rounded-md text-[11px] font-medium bg-error/10 hover:bg-error/20 text-error border border-error/30 flex-shrink-0 transition-colors"
          title="ワークフローを中断"
        >
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <rect x="6" y="6" width="12" height="12" rx="1" />
          </svg>
          <span>中断</span>
        </button>

        {/* 区切り線 */}
        <div className="w-px h-6 bg-border/50 flex-shrink-0" />

        {/* 全工程を横並び（自由にクリック可能）— スクロール対応 */}
        <div className="flex-1 flex items-center gap-1 overflow-x-auto min-w-0 scrollbar-thin">
          {activeWorkflow.steps.map((s, i) => {
            const isActive = i === currentStep;
            const isCompleted = i < currentStep;
            return (
              <button
                key={i}
                onClick={() => {
                  useWorkflowStore.getState().jumpToStep(i);
                  if (s.nav) executeStepNav(s);
                }}
                className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-all flex-shrink-0 ${
                  isActive
                    ? "bg-accent text-white shadow-sm ring-2 ring-accent/40"
                    : isCompleted
                      ? "bg-success/15 text-success hover:bg-success/25"
                      : "bg-bg-tertiary text-text-secondary hover:bg-bg-elevated hover:text-text-primary border border-border"
                }`}
                title={s.desc ? `${s.label} — ${s.desc}` : s.label}
              >
                <span className="text-[9px] tabular-nums opacity-70">{i + 1}</span>
                <span className="whitespace-nowrap">{s.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ワークフロー非アクティブ時: 小さなボタンのみ
  return (
    <div className="relative">
      <button
        onClick={() => setShowPicker(!showPicker)}
        className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all flex-shrink-0 ${
          showPicker
            ? "bg-gradient-to-br from-accent to-accent-secondary shadow-md scale-105"
            : "bg-gradient-to-br from-accent to-accent-secondary shadow-sm hover:shadow-md hover:scale-105"
        }`}
        title="ワークフロー"
      >
        <span className="text-[10px] font-bold text-white">WF</span>
      </button>

      {/* ワークフロー選択ドロップダウン */}
      {showPicker && (
        <div className="absolute left-0 top-full mt-1 z-50 bg-bg-secondary border border-border rounded-lg shadow-xl py-1 min-w-[200px]">
          {WORKFLOWS.map((wf) => (
            <button
              key={wf.id}
              className="w-full text-left px-3 py-2 text-[11px] text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors flex items-center gap-2"
              onClick={() => handleSelect(wf)}
            >
              <span className="text-sm">{wf.icon}</span>
              <span>{wf.name}</span>
              <span className="text-[9px] text-text-muted ml-auto">{wf.steps.length}工程</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══ WorkflowDescriptionBar（GlobalAddressBar 置換用） ═══

export function WorkflowDescriptionBar() {
  const activeWorkflow = useWorkflowStore((s) => s.activeWorkflow);
  const currentStep = useWorkflowStore((s) => s.currentStep);

  if (!activeWorkflow) return null;

  const step = activeWorkflow.steps[currentStep];
  const total = activeWorkflow.steps.length;
  const progress = ((currentStep + 1) / total) * 100;

  return (
    <div className="h-9 flex-shrink-0 bg-bg-secondary border-b border-accent/20 flex items-center px-3 gap-3 relative z-10">
      {/* ステップ番号 */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <span className="text-[10px] text-text-muted tabular-nums">
          <span className="text-[13px] font-bold text-accent">{currentStep + 1}</span>
          <span className="mx-0.5 opacity-50">/</span>
          <span>{total}</span>
        </span>
      </div>

      {/* 区切り線 */}
      <div className="w-px h-4 bg-border/50 flex-shrink-0" />

      {/* 現在のステップ名 */}
      <span className="text-xs font-semibold text-text-primary flex-shrink-0">{step.label}</span>

      {/* 区切り線 */}
      {step.desc && <div className="w-px h-4 bg-border/50 flex-shrink-0" />}

      {/* 説明 */}
      {step.desc && (
        <span className="text-[11px] text-text-secondary truncate flex-1 min-w-0">{step.desc}</span>
      )}

      {!step.desc && <div className="flex-1" />}

      {/* プログレスバー */}
      <div className="w-32 h-1.5 bg-border/40 rounded-full overflow-hidden flex-shrink-0">
        <div
          className="h-full bg-gradient-to-r from-accent to-accent-secondary rounded-full transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
      <span className="text-[10px] text-text-muted tabular-nums flex-shrink-0">{Math.round(progress)}%</span>
    </div>
  );
}
