# tiff (TIFF 化)

TIPPY v2.92 準拠の処理パイプラインで PSD → TIFF/JPG に一括変換する機能。テキスト整理・カラーモード変換・ガウスぼかし・クロップ・リサイズ・リネーム・2 大プリフライトチェックを単一 PS パスで実行。

> 全体像: [../../../docs/architecture.md](../../../docs/architecture.md) / [../../../docs/feature-map.md](../../../docs/feature-map.md) / [../../../docs/data-flow.md](../../../docs/data-flow.md)

## 画面

| View | 役割 |
|---|---|
| [TiffView.tsx](./TiffView.tsx) | `AppView = "tiff"` のルート。3 カラム構成 (TiffSettingsPanel \| TiffFileList \| Center)。 |

## このフィーチャーの所有物

| 種別 | ファイル | 責務 |
|---|---|---|
| Store | [tiffStore.ts](./tiffStore.ts) | `settings` / `fileOverrides` / `cropPresets` / `cropGuides` / `phase` / `results`。localStorage 永続化（ただし `crop.bounds` はファイル依存のため除外） |
| Hook | [useTiffProcessor.ts](./useTiffProcessor.ts) | `buildSettingsJson` → invoke → 結果マージ |
| Hook | [useCropEditorKeyboard.ts](./useCropEditorKeyboard.ts) | Tachimi 互換キー操作（ガイド 1px / Shift+10px / 範囲は逆） |
| Components | [components/](./components/) | TiffSettingsPanel, TiffFileList, TiffBatchQueue, TiffCropEditor, TiffCropSidePanel, TiffViewerPanel, TiffPageRulesEditor, TiffPartialBlurModal, TiffResultDialog, TiffCanvasMismatchDialog, TiffAutoScanDialog |

## グローバル依存

- **ストア**: [psdStore](../../store/psdStore.ts) (R) / [specStore](../../store/specStore.ts) (R) / [guideStore](../../store/guideStore.ts) (R) / [viewStore](../../store/viewStore.ts) (R) / [workflowStore](../../store/workflowStore.ts) (R)
- **フック**: [useCanvasSizeCheck](../../hooks/useCanvasSizeCheck.ts) / [useHighResPreview](../../hooks/useHighResPreview.ts)
- **型**: [types/tiff.ts](../../types/tiff.ts) — `TiffSettings`, `TiffCropBounds`, `TiffCropPreset`, `TiffScandataFile` 等

## Rust コマンド

| 用途 | コマンド |
|---|---|
| TIFF 変換 | `run_photoshop_tiff_convert` |
| ファイル | `list_folder_files`, `list_subfolders` |

## Photoshop JSX

| JSX | 処理順序 |
|---|---|
| [tiff_convert.jsx](../../../src-tauri/scripts/tiff_convert.jsx) | unlock → テキストグループ検索・上移動 → 背景 SO 化 → テキスト SO 化 → ラスタライズ → カラー変換 → テキスト再 SO 化 → 非表示 → ぼかし → 表示 → getByName 最終マージ → crop → resize → save |

## 出力先

`Desktop/Script_Output/TIF_Output/` または重複時は `TIF_Output (1)`, `(2)`... で連番生成（Rust 側で JSON 内 outputPath も書き換え）。

## 2 大プリフライト（CLAUDE.md §27）

1. **メトリクスカーニング検出** — `detectMetricsKerningLayers()` / `hasMetricsKerning()`。ActionManager で `textKey > textStyleRange > textStyle > autoKern` を走査し `metricsKern` を検出
2. **リンクグループフォントサイズ検証** — `detectLinkGroupFontSizeIssues()`。各テキストレイヤーの `linkedLayerIDs` を Union-Find でグループ化 → 「同一サイズ」または「きっかり 1:2」以外を通知

結果は `TiffConvertResult.metrics_kerning_layers` / `link_group_issues` として Rust → フロントに連携、`TiffResultDialog` で展開表示。

## 設計上のポイント

1. **ExtendScript 注意**: レイヤー比較は `.id`（プロキシオブジェクトの `===` は不可）。選択は `putIdentifier + makeVisible:false`。crop 引数は `UnitValue` 配列
2. **個別クロップ vs グローバル**: `fileOverrides[file.id].crop` が存在すれば優先。個別編集中は `savedGlobalBoundsRef` でグローバル範囲を退避し、OK/キャンセルで復元
3. **部分ぼかしのページマッチング**: 選択ファイルのみ処理でも、`allPsdFiles`（psdStore 全ファイル）から `globalFileIndex` を取得してグローバルページ番号でマッチ
4. **Tachimi 互換 JSON**: `TiffCropPreset` 型、4 スペースインデント、GENRE_LABELS 定数でジャンル→レーベルマッピング
5. **設定の永続化除外**: `crop.bounds` はファイル依存なので localStorage 永続化から除外（他設定は保持）

## 関連機能

- [spec-check](../spec-check/README.md) — TIFF 化前の仕様チェック
- [scan-psd](../scan-psd/README.md) — クロップ範囲 JSON ライブラリ（CLLENN 互換）の元データ
