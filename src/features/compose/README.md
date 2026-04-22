# compose

合成（Photoshop JSX経由）。原稿A/Bを1つの合成ファイルに統合。5要素ルーティング（テキストフォルダ/背景/#背景#/白消し/棒消し、A/B/除外）、ペアリングUIをReplaceと共有。

**関連**: `components/compose/`（ComposePanel, ComposeDropZone, ComposePairingModal, ComposePairingAutoTab, ComposePairingManualTab, ComposePairingOutputSettings, ComposeToast）、`views/ComposeView.tsx`、`hooks/useComposeProcessor.ts`、`store/composeStore.ts`、`src-tauri/scripts/replace_layers.jsx`（compose設定で処理）。
