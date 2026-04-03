import { useState } from "react";

// ═══ ワークフロー定義 ═══

interface WorkflowStep {
  label: string;
  desc?: string;
}

interface Workflow {
  id: string;
  name: string;
  icon: string;
  steps: WorkflowStep[];
}

const WORKFLOWS: Workflow[] = [
  {
    id: "ingest",
    name: "写植入稿",
    icon: "📦",
    steps: [
      { label: "完成原稿 読み込み", desc: "問題を検出、原稿の仕様を確認して選択" },
      { label: "仕様を一括で修正", desc: "カラーモード・ビット深度・解像度・ガイド一括反映" },
      { label: "ProGen テキスト整形・抽出", desc: "統一表記ルール JSON読み込み or 新規登録" },
      { label: "Geminiで開く", desc: "結果 貼り付け" },
      { label: "校正プロンプト", desc: "結果 貼り付け → JSON登録" },
      { label: "テキストエディタで修正" },
      { label: "ZIP リリース", desc: "完成原稿とテキストをZIPでまとめてリリース" },
    ],
  },
  {
    id: "proof",
    name: "初校確認",
    icon: "📝",
    steps: [
      { label: "初校データ 読み込み", desc: "問題を検出" },
      { label: "ビューアーで確認・修正", desc: "フォント・サイズ・白消し・AA・カーニング・フォント帳" },
      { label: "テキスト抽出→提案チェックプロンプト作成" },
      { label: "Geminiで開く", desc: "結果 貼り付け → JSON登録" },
      { label: "Tachimiで見開きPDF作成" },
      { label: "ZIP リリース", desc: "NGワード・統一表記表・PDFをzipにして校正依頼" },
    ],
  },
  {
    id: "review",
    name: "校正確認",
    icon: "✅",
    steps: [
      { label: "校正確認" },
      { label: "赤字は修正 書きつぎ" },
      { label: "MojiQ 逆字追加" },
      { label: "編集確認" },
    ],
  },
  {
    id: "tiff",
    name: "白消しTIFF",
    icon: "🖼️",
    steps: [
      { label: "白消し(棒消し)差し替え", desc: "原稿読み込み" },
      { label: "差し替え → 差分検知ビュー" },
      { label: "TIFF化へ進む" },
      { label: "裁ち切り位置 設定・読み込み" },
      { label: "詳細設定", desc: "ガウス値・カラーモード・リネーム" },
      { label: "TIFF化 実行" },
      { label: "差分検知ビュー" },
      { label: "TIFF格納" },
    ],
  },
];

// ═══ コンポーネント ═══

export function WorkflowBar() {
  const [showPicker, setShowPicker] = useState(false);
  const [activeWorkflow, setActiveWorkflow] = useState<Workflow | null>(null);
  const [currentStep, setCurrentStep] = useState(0);

  const handleSelect = (wf: Workflow) => {
    setActiveWorkflow(wf);
    setCurrentStep(0);
    setShowPicker(false);
  };

  const handleAdvance = () => {
    if (!activeWorkflow) return;
    if (currentStep < activeWorkflow.steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      // 最終ステップ → 完了 → リセット
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
          className={`px-2 py-0.5 text-[10px] rounded transition-colors flex items-center gap-1 ${
            showPicker
              ? "text-accent bg-accent/10"
              : "text-text-muted hover:text-text-primary hover:bg-bg-tertiary"
          }`}
          title="ワークフロー"
        >
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          WF
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

      {/* 現在のステップ（クリックで次へ） */}
      <button
        onClick={handleAdvance}
        className="flex items-center gap-1 px-2 py-1 rounded-md bg-accent/10 hover:bg-accent/20 text-accent text-[10px] font-medium transition-colors cursor-pointer max-w-[280px]"
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
