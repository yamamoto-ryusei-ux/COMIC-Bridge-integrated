# scan-psd

Scan PSD（フォントプリセット管理）。PSDフォルダスキャン → フォント/サイズ/ガイド統計収集 → プリセットJSON管理。5タブ構成（作品情報/フォント種類/サイズ統計/ガイド線/ルビ）、カスタムセット、手動フォント追加、カテゴリ自動判定、纏め（グループ化）機能。

**関連**: `components/scanPsd/`（ScanPsdPanel, ScanPsdContent, ScanPsdEditView, ScanPsdModeSelector, JsonFileBrowser, tabs/*）、`views/ScanPsdView.tsx`、`hooks/useScanPsdProcessor.ts`, `useFontResolver.ts`、`store/scanPsdStore.ts`、`types/scanPsd.ts`, `fontBook.ts`、`src-tauri/scripts/scan_psd.jsx`, `scan_psd_core.jsx`。
