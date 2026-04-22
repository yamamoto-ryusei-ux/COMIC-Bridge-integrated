# rename

リネーム（2モード）。レイヤーリネーム（Photoshop JSX経由）: 最下位/背景レイヤー指定、検索→置換、連番別名保存。ファイルリネーム（Rust直接処理、Photoshop不要）: 連番・置換・プレフィックス/サフィックス、D&D並替え、チェックボックス選択。

**関連**: `components/rename/`（LayerRenamePanel, FileRenamePanel, RenamePreview, RenameResultDialog）、`views/RenameView.tsx`、`hooks/useRenameProcessor.ts`、`store/renameStore.ts`、`types/rename.ts`、`src-tauri/scripts/rename_psd.jsx`、Rust: `batch_rename_files`。
