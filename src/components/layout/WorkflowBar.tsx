import { useState } from "react";
import { useViewStore } from "../../store/viewStore";
import { useScanPsdStore } from "../../store/scanPsdStore";
import { useUnifiedViewerStore } from "../../store/unifiedViewerStore";
import { useProgenStore } from "../../store/progenStore";

// ═══ ワークフロー定義 ═══

interface WorkflowStep {
  label: string;
  desc?: string;
  /** 自動ナビゲーション先（AppView） */
  nav?: string;
  /** ProGenモード */
  progenMode?: string;
}

interface Workflow {
  id: string;
  name: string;
  icon: string;
  steps: WorkflowStep[];
}

// 各ステップを「開始」「終了」の2つに展開（開始にnav/progenModeを引き継ぐ）
function expandSteps(steps: WorkflowStep[]): WorkflowStep[] {
  const result: WorkflowStep[] = [];
  for (const s of steps) {
    result.push({ label: `${s.label} 開始`, desc: s.desc, nav: s.nav, progenMode: s.progenMode });
    result.push({ label: `${s.label} 終了` });
  }
  return result;
}

const WORKFLOWS: Workflow[] = [
  {
    id: "ingest",
    name: "写植入稿",
    icon: "📦",
    steps: expandSteps([
      { label: "完成原稿 読み込み", desc: "フォルダセットアップ → PSD自動読み込み", nav: "folderSetup" },
      { label: "仕様を一括で修正", desc: "カラーモード・ビット深度・解像度・ガイド一括反映", nav: "specCheck" },
      { label: "ProGen テキスト整形・抽出", desc: "テキスト有無で自動分岐（整形/抽出）", nav: "progen", progenMode: "_auto" },
      { label: "テキストチェック", desc: "画像/PDFとテキストを並べて確認", nav: "unifiedViewer" },
      { label: "校正プロンプト", desc: "正誤チェック・提案チェック", nav: "progen", progenMode: "_check" },
      { label: "テキストエディタで修正", nav: "unifiedViewer" },
      { label: "ZIP リリース", desc: "依頼準備", nav: "requestPrep" },
    ]),
  },
  {
    id: "proof",
    name: "初校確認",
    icon: "📝",
    steps: expandSteps([
      { label: "初校データ 読み込み", desc: "問題を検出", nav: "specCheck" },
      { label: "ビューアーで確認・修正", desc: "フォント・サイズ・白消し・AA・カーニング・フォント帳", nav: "unifiedViewer" },
      { label: "テキスト抽出→提案チェックプロンプト作成", nav: "progen", progenMode: "proofreading" },
      { label: "Tachimiで見開きPDF作成" },
      { label: "ZIP リリース", desc: "依頼準備", nav: "requestPrep" },
    ]),
  },
  {
    id: "review",
    name: "校正確認",
    icon: "✅",
    steps: expandSteps([
      { label: "校正確認" },
      { label: "赤字は修正 書きつぎ" },
      { label: "MojiQ 逆字追加" },
      { label: "編集確認" },
    ]),
  },
  {
    id: "tiff",
    name: "白消しTIFF",
    icon: "🖼️",
    steps: expandSteps([
      { label: "白消し(棒消し)差し替え", desc: "差替え or 合成", nav: "replace" },
      { label: "差し替え → 差分検知ビュー", nav: "unifiedViewer" },
      { label: "TIFF化へ進む", nav: "tiff" },
      { label: "裁ち切り位置 設定・読み込み", nav: "tiff" },
      { label: "詳細設定", desc: "ガウス値・カラーモード・リネーム", nav: "tiff" },
      { label: "TIFF化 実行", nav: "tiff" },
      { label: "差分検知ビュー", nav: "unifiedViewer" },
      { label: "TIFF格納" },
    ]),
  },
];

// ═══ コンポーネント ═══

export function WorkflowBar() {
  const [showPicker, setShowPicker] = useState(false);
  const [activeWorkflow, setActiveWorkflow] = useState<Workflow | null>(null);
  const [currentStep, setCurrentStep] = useState(0);

  // ステップのナビゲーションを実行
  const executeStepNav = (step: WorkflowStep) => {
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
          // 整形/抽出時は正誤チェックフラグをクリア
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

    // テキストエディタで修正ステップ: テキスト+校正JSONが読み込み済みであることを確認
    if (step.label.includes("テキストエディタで修正")) {
      // テキストは既にunifiedViewerStoreに読み込み済み（整形/抽出後のResultSaveModalで保存時に自動セット）
      // 校正JSONも既にunifiedViewerStoreのcheckDataに読み込み済み（校正プロンプト後のResultSaveModalで保存時に自動セット）
      // 追加処理不要 — ビューアーに遷移するだけでOK
    }

    // ZIP リリースステップ: FolderSetupのコピー先の1つ上の階層をRequestPrepに自動セット
    if (step.label.includes("ZIP リリース")) {
      try {
        const copyDest = localStorage.getItem("folderSetup_copyDestFolder");
        if (copyDest) {
          // copyDestFolder = numberFolder\1_原稿\sourceName → 親 = numberFolder\1_原稿
          const parent = copyDest.replace(/[\\/][^\\/]+$/, "");
          if (parent) localStorage.setItem("requestPrep_autoFolder", parent);
        }
      } catch { /* ignore */ }
    }

    vs.setActiveView(step.nav as any);
  };

  const handleSelect = (wf: Workflow) => {
    setActiveWorkflow(wf);
    setCurrentStep(0);
    setShowPicker(false);
    // 最初のステップのnavを実行
    if (wf.steps[0]?.nav) executeStepNav(wf.steps[0]);
  };

  const handleAdvance = () => {
    if (!activeWorkflow) return;
    if (currentStep < activeWorkflow.steps.length - 1) {
      const nextStep = currentStep + 1;
      setCurrentStep(nextStep);
      // 次のステップのnavを実行
      const step = activeWorkflow.steps[nextStep];
      if (step?.nav) executeStepNav(step);
    } else {
      setActiveWorkflow(null);
      setCurrentStep(0);
    }
  };

  const handleClose = () => {
    setActiveWorkflow(null);
    setCurrentStep(0);
  };

  // ワークフロー非アクティブ時: ボタンのみ
  if (!activeWorkflow) {
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
          <div className="absolute left-0 top-full mt-1 z-50 bg-bg-secondary border border-border rounded-lg shadow-xl py-1 min-w-[180px]">
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

  // ワークフロー進行中
  const step = activeWorkflow.steps[currentStep];
  const progress = ((currentStep + 1) / activeWorkflow.steps.length) * 100;

  return (
    <div className="flex items-center gap-1.5 flex-shrink-0">
      {/* ワークフロー名 */}
      <span className="text-[9px] text-accent font-bold px-1.5 py-0.5 bg-accent/8 rounded">
        {activeWorkflow.icon} {activeWorkflow.name}
      </span>

      {/* プログレスバー */}
      <div className="w-16 h-1 bg-border/40 rounded-full overflow-hidden flex-shrink-0">
        <div
          className="h-full bg-accent rounded-full transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* ステップ番号 */}
      <span className="text-[9px] text-text-muted tabular-nums flex-shrink-0">
        {currentStep + 1}/{activeWorkflow.steps.length}
      </span>

      {/* 現在のステップ（クリックで次へ）— 開始=青系、終了=緑系 */}
      <button
        onClick={handleAdvance}
        className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-colors cursor-pointer max-w-[280px] ${
          step.label.endsWith("終了")
            ? "bg-success/10 hover:bg-success/20 text-success"
            : "bg-accent/10 hover:bg-accent/20 text-accent"
        }`}
        title={step.desc ? `${step.label} — ${step.desc}` : step.label}
      >
        <span className="truncate">{step.label}</span>
        <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d={
            currentStep < activeWorkflow.steps.length - 1
              ? "M9 5l7 7-7 7"  // → 次へ
              : "M5 13l4 4L19 7" // ✓ 完了
          } />
        </svg>
      </button>

      {/* 説明（あれば） */}
      {step.desc && (
        <span className="text-[9px] text-text-muted/70 truncate max-w-[150px] hidden lg:block">
          {step.desc}
        </span>
      )}

      {/* 閉じる */}
      <button
        onClick={handleClose}
        className="w-4 h-4 flex items-center justify-center text-text-muted/40 hover:text-error transition-colors flex-shrink-0"
        title="ワークフローを終了"
      >
        <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
