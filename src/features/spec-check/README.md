# spec-check (ホーム画面・仕様チェック)

アプリのホーム画面。PSD/PDF/画像の読み込み・サムネイル/リスト/レイヤー構造の 3 ビュー切替・仕様チェック（カラーモード / DPI / ビット深度 / αチャンネル）・NG ファイルの Photoshop 一括変換を担う。

> 全体像: [../../../docs/architecture.md](../../../docs/architecture.md) / [../../../docs/feature-map.md](../../../docs/feature-map.md) / [../../../docs/data-flow.md](../../../docs/data-flow.md)

## 画面

| View | 役割 |
|---|---|
| [SpecCheckView.tsx](./SpecCheckView.tsx) | `AppView = "specCheck"` のルート。アドレスバー・仕様バー・ビュー切替・右プレビュー・フォルダ階層ツリーを組み立てる。 |

## このフィーチャーの所有物

| 種別 | ファイル | 責務 |
|---|---|---|
| Hook | [useSpecChecker.ts](./useSpecChecker.ts) | 仕様チェック実行 (`checkAllFiles`) / 結果キャッシュ |
| Components | [components/](./components/) | SpecCheckerPanel, SpecCardList, SpecLayerGrid, SpecTextGrid, SpecCheckTable, FixGuidePanel, SpecSelectionModal, ConversionToast, CaptureOverlay, FontBrowserDialog, SpecScanJsonDialog, SpecViewerPanel, GuideSectionPanel |

## グローバル依存

- **ストア**: [psdStore](../../store/psdStore.ts) (R/W) / [specStore](../../store/specStore.ts) (R/W) / [guideStore](../../store/guideStore.ts) (R/W) / [viewStore](../../store/viewStore.ts) (R) / [settingsStore](../../store/settingsStore.ts) (R) / [workflowStore](../../store/workflowStore.ts) (R)
- **フック**: [usePhotoshopConverter](../../hooks/usePhotoshopConverter.ts) / [usePreparePsd](../../hooks/usePreparePsd.ts) / [useSpecConverter](../../hooks/useSpecConverter.ts) / [useCanvasSizeCheck](../../hooks/useCanvasSizeCheck.ts) / [usePageNumberCheck](../../hooks/usePageNumberCheck.ts) / [useHighResPreview](../../hooks/useHighResPreview.ts) / [useFontResolver](../../hooks/useFontResolver.ts)
- **共通 UI**: `components/preview/` (PreviewGrid, PreviewList, ThumbnailCard), `components/metadata/` (MetadataPanel, LayerTree), `components/guide-editor/` (GuideEditorModal 他), `components/common/` (DetailSlidePanel, FileContextMenu, TextExtractButton)
- **Lib**: [parser.ts](../../lib/psd/parser.ts), [layerMatcher.ts](../../lib/layerMatcher.ts), [paperSize.ts](../../lib/paperSize.ts), [naturalSort.ts](../../lib/naturalSort.ts)

## Rust コマンド

| 用途 | コマンド |
|---|---|
| メタデータ解析 | `parse_psd_metadata_batch`, `get_image_info` |
| プレビュー | `get_high_res_preview`, `get_pdf_preview`, `invalidate_file_cache` |
| Photoshop 変換 | `run_photoshop_conversion`, `run_photoshop_prepare`, `run_photoshop_guide_apply` |
| 画像処理（PS 不要） | `resample_image`, `convert_color_mode`, `batch_resample_images` |
| フォント | `resolve_font_names`, `install_font_from_path` |
| ファイル | `list_folder_contents`, `list_subfolders`, `detect_psd_folders` |

## Photoshop JSX

| JSX | 用途 |
|---|---|
| [convert_psd.jsx](../../../src-tauri/scripts/convert_psd.jsx) | DPI / カラーモード / ビット深度 / α 削除 |
| [prepare_psd.jsx](../../../src-tauri/scripts/prepare_psd.jsx) | 仕様修正 + ガイド適用を 1 パスで |
| [apply_guides.jsx](../../../src-tauri/scripts/apply_guides.jsx) | ガイド線のみ適用 |

## 永続化

- `specStore` は `specifications` / `autoCheckEnabled` / `conversionSettings` を localStorage に保存。
- `psdStore` / `guideStore` は永続化なし（起動のたびに初期化）。

## 設計上のポイント

1. **ag-psd の `writePsd()` は使わない**: 書き込みは必ず Photoshop JSX 経由（バイナリ破壊防止）。
2. **変換後は `parse_psd_metadata_batch` で再読み込み**: メモリ上の metadata は捨て、ディスクから確実に最新化 → その後 `checkAllFiles` を再実行。
3. **DetailSlidePanel の import パス**: FixGuidePanel / GuideSectionPanel は本 feature の `components/` に存在。外部から参照される唯一の例外ケース。
4. **ホーム画面の責務が広い**: サムネ/リスト/レイヤー構造の 3 ビュー、フォルダ階層ツリー、フォントブラウザ、スキャン JSON ダイアログ、キャプチャオーバーレイ等を全てここに集約。リファクタ時は他 feature への切り出しより、本 feature 内での components/ サブツリー分割を優先。

## 関連機能

- [unified-viewer](../unified-viewer/README.md) — 拡大表示・校正 JSON・テキスト照合
- [layer-control](../layer-control/README.md) — レイヤー単位の PS 操作
- [tiff](../tiff/README.md) — TIFF 化（変換後に遷移するケースあり）
