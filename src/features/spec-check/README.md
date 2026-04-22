# spec-check

ホーム画面兼仕様チェック機能。PSD/PDF/画像ファイルの読み込み、サムネイル/リスト/レイヤー構造の3ビュー切替、カラーモード・DPI・ビット深度・αチャンネルの自動チェック、右プレビューパネル、フォルダ階層ツリー。

**関連**: `spec-checker/` 配下のコンポーネント群（SpecCheckerPanel, SpecCardList, SpecLayerGrid, SpecTextGrid, SpecCheckTable, FixGuidePanel, SpecSelectionModal, ConversionToast, CaptureOverlay, FontBrowserDialog, SpecScanJsonDialog, SpecViewerPanel, GuideSectionPanel）、`views/SpecCheckView.tsx`、`preview/`（PreviewGrid, PreviewList, ThumbnailCard）、`metadata/`（MetadataPanel, LayerTree）、`guide-editor/`（GuideEditorModal, GuideCanvas 等）、`hooks/useSpecChecker.ts`, `usePhotoshopConverter.ts`, `useSpecConverter.ts`, `usePreparePsd.ts`, `useCanvasSizeCheck.ts`, `usePageNumberCheck.ts`、`store/psdStore.ts`, `specStore.ts`, `guideStore.ts`。
