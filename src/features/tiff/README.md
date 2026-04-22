# tiff

TIFF化機能（Photoshop JSX経由）。TIPPY v2.92準拠パイプライン、ビジュアルクロップエディタ（640:909）、バッチキュー＋個別上書き、部分ぼかし、メトリクスカーニング/リンクグループ2点プリフライト、Tachimi互換JSONライブラリ。

**関連**: `components/tiff/`（TiffSettingsPanel, TiffFileList, TiffBatchQueue, TiffCropEditor, TiffCropSidePanel, TiffViewerPanel, TiffPageRulesEditor, TiffPartialBlurModal, TiffResultDialog, TiffCanvasMismatchDialog, TiffAutoScanDialog）、`views/TiffView.tsx`、`hooks/useTiffProcessor.ts`, `useCropEditorKeyboard.ts`、`store/tiffStore.ts`、`types/tiff.ts`、`src-tauri/scripts/tiff_convert.jsx`。
