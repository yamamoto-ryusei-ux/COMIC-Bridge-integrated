import { create } from "zustand";

// ═══ ワークフロー型定義 ═══

export interface WorkflowStep {
  label: string;
  desc?: string;
  /** 自動ナビゲーション先（AppView） */
  nav?: string;
  /** ProGenモード */
  progenMode?: string;
  /** 統合ビューアーのタブ位置を自動設定（null=非表示） */
  viewerTabSetup?: Partial<Record<string, string | null>>;
  /** RequestPrepView の初期モード */
  requestPrepMode?: string;
  /** 次へ進む前にチェック確認ダイアログを表示 */
  confirmOnNext?: "specCheck" | "textSave" | "wfComplete" | "proofLoad" | "textDiffThenExtract";
}

export interface Workflow {
  id: string;
  name: string;
  icon: string;
  steps: WorkflowStep[];
}

// ═══ ワークフロー定義（開始/終了の分割なし、1ステップ=1工程） ═══

export const WORKFLOWS: Workflow[] = [
  {
    id: "ingest",
    name: "写植入稿",
    icon: "📦",
    steps: [
      { label: "完成原稿 読み込み", desc: "フォルダセットアップ → PSD自動読み込み", nav: "folderSetup" },
      { label: "仕様を一括で修正", desc: "カラーモード・ビット深度・解像度・ガイド一括反映", nav: "specCheck", confirmOnNext: "specCheck" },
      { label: "ProGen テキスト整形・抽出", desc: "テキスト有無で自動分岐（整形/抽出）", nav: "progen", progenMode: "_auto" },
      { label: "テキストチェック", desc: "画像/PDFとテキストを並べて確認", nav: "unifiedViewer", viewerTabSetup: { text: "far-right", files: null, layers: null, spec: null, proofread: null, diff: null }, confirmOnNext: "textSave" },
      { label: "校正プロンプト", desc: "正誤チェック・提案チェック", nav: "progen", progenMode: "_check" },
      { label: "テキストエディタで修正", desc: "確定ボタンで自動保存", nav: "unifiedViewer", confirmOnNext: "textSave" },
      { label: "ZIP リリース", desc: "依頼準備", nav: "requestPrep", confirmOnNext: "wfComplete" },
    ],
  },
  {
    id: "proof",
    name: "初校確認",
    icon: "📝",
    steps: [
      { label: "初校データ 読み込み", desc: "問題を検出", nav: "specCheck", confirmOnNext: "specCheck" },
      { label: "ビューアーで確認・修正", desc: "フォント・サイズ・白消し・AA・カーニング・フォント帳", nav: "unifiedViewer", viewerTabSetup: { diff: "far-right", files: null, layers: null, spec: null, text: null, proofread: null }, confirmOnNext: "textDiffThenExtract" },
      { label: "テキスト抽出", desc: "PSDからテキストを抽出", nav: "specCheck" },
      { label: "提案チェックプロンプト作成", desc: "ProGenで提案チェック生成", nav: "progen", progenMode: "_check_variation" },
      { label: "Tachimiで見開きPDF作成", desc: "メイン画面でTachimi起動", nav: "specCheck" },
      { label: "ZIP リリース（外部校正）", desc: "外部校正タブで依頼準備", nav: "requestPrep", requestPrepMode: "external", confirmOnNext: "wfComplete" },
    ],
  },
  {
    id: "review",
    name: "校正確認",
    icon: "✅",
    steps: [
      { label: "校正確認", desc: "校正内容を確認" },
      { label: "赤字は修正 書きつぎ", desc: "赤字反映" },
      { label: "MojiQ 逆字追加", desc: "MojiQ で逆字追加" },
      { label: "編集確認", desc: "編集者確認" },
    ],
  },
  {
    id: "tiff",
    name: "白消しTIFF",
    icon: "🖼️",
    steps: [
      { label: "白消し(棒消し)差し替え", desc: "差替え or 合成", nav: "replace" },
      { label: "差し替え → 差分検知ビュー", desc: "差分チェック", nav: "unifiedViewer" },
      { label: "TIFF化へ進む", desc: "TIFF変換画面へ", nav: "tiff" },
      { label: "裁ち切り位置 設定・読み込み", desc: "クロップ設定", nav: "tiff" },
      { label: "詳細設定", desc: "ガウス値・カラーモード・リネーム", nav: "tiff" },
      { label: "TIFF化 実行", desc: "変換開始", nav: "tiff" },
      { label: "差分検知ビュー", desc: "変換結果チェック", nav: "unifiedViewer" },
      { label: "TIFF格納", desc: "完了" },
    ],
  },
];

// ═══ ストア型定義 ═══

interface WorkflowState {
  activeWorkflow: Workflow | null;
  currentStep: number;
  setActiveWorkflow: (wf: Workflow | null) => void;
  setCurrentStep: (step: number) => void;
  /** ワークフロー開始（最初のステップを選択） */
  startWorkflow: (wf: Workflow) => void;
  /** ワークフロー中断 */
  abortWorkflow: () => void;
  /** 次のステップへ */
  nextStep: () => void;
  /** 前のステップへ */
  prevStep: () => void;
  /** 特定のステップへジャンプ */
  jumpToStep: (index: number) => void;
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  activeWorkflow: null,
  currentStep: 0,
  setActiveWorkflow: (activeWorkflow) => set({ activeWorkflow }),
  setCurrentStep: (currentStep) => set({ currentStep }),
  startWorkflow: (wf) => set({ activeWorkflow: wf, currentStep: 0 }),
  abortWorkflow: () => set({ activeWorkflow: null, currentStep: 0 }),
  nextStep: () => {
    const { activeWorkflow, currentStep } = get();
    if (!activeWorkflow) return;
    const next = Math.min(currentStep + 1, activeWorkflow.steps.length - 1);
    set({ currentStep: next });
  },
  prevStep: () => {
    const { currentStep } = get();
    const prev = Math.max(currentStep - 1, 0);
    set({ currentStep: prev });
  },
  jumpToStep: (index) => {
    const { activeWorkflow } = get();
    if (!activeWorkflow) return;
    if (index < 0 || index >= activeWorkflow.steps.length) return;
    set({ currentStep: index });
  },
}));
