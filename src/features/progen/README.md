# progen

ProGen（プロンプト生成ツール、React完全移植済み、v3.6.0）。3モード: 抽出/整形/校正。6画面ルーター（landing/extraction/formatting/admin/comicpot/resultViewer）、正誤/提案チェック、Gemini連携、GドライブJSONブラウザ、COMIC-POTエディタ、パスワード付き管理画面、外部設定同期（G:\Pro-Gen\、試運転中）。

**関連**: `components/progen/`（ProgenRuleView, ProgenProofreadingView, ProgenJsonBrowser, ProgenResultViewer, ProgenCalibrationSave, ProgenAdminView, comicpot/*）、`views/ProgenView.tsx`、`hooks/useProgenTauri.ts`, `useProgenJson.ts`, `useComicPotState.ts`、`store/progenStore.ts`、`lib/progenPrompts.ts`, `progenConfig.ts`、`types/progen.ts`、`src-tauri/src/progen.rs`（26コマンド）、`docs/progen-template/`。
