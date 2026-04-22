# split (見開き分割)

見開き PSD を中央で左右に分割（`_R` / `_L` サフィックス）、または不均等分割・連番化する機能（Photoshop JSX 経由）。PDF / JPG / PNG / TIFF / BMP / GIF / EPS も受付可能（Photoshop が開ける全形式）。

> 全体像: [../../../docs/architecture.md](../../../docs/architecture.md) / [../../../docs/feature-map.md](../../../docs/feature-map.md) / [../../../docs/data-flow.md](../../../docs/data-flow.md)

## 画面

| View | 役割 |
|---|---|
| [SplitView.tsx](./SplitView.tsx) | `AppView = "split"` のルート。SplitPanel + SplitPreview + SplitResultDialog |

## このフィーチャーの所有物

| 種別 | ファイル | 責務 |
|---|---|---|
| Store | [splitStore.ts](./splitStore.ts) | `settings` / `selectionHistory` / `selectionFuture` (Undo/Redo)。`startDragSelection()` でドラッグ中の履歴スパム防止 |
| Hook | [useSplitProcessor.ts](./useSplitProcessor.ts) | invoke + 結果処理 |
| Components | [components/](./components/) | SplitPanel, SplitPreview, SplitResultDialog |

## グローバル依存

- **ストア**: [psdStore](../../store/psdStore.ts) (R/W) / [viewStore](../../store/viewStore.ts) (R) / [settingsStore](../../store/settingsStore.ts) (R)
- **フック**: [useHighResPreview](../../hooks/useHighResPreview.ts) — プレビュー & 定規操作用

## Rust コマンド

| 用途 | コマンド |
|---|---|
| 分割実行 | `run_photoshop_split` (タイムアウト 5 分) |
| PDF | `get_pdf_info`, `get_pdf_preview`, `get_pdf_thumbnail` |
| ファイル | `list_folder_files` |

## Photoshop JSX

| JSX | 用途 |
|---|---|
| [split_psd.jsx](../../../src-tauri/scripts/split_psd.jsx) | 見開き分割 / 連番リネーム / JPG 変換（品質は 0-12 スケールに変換） |

## 分割モード

| モード | 説明 |
|---|---|
| 均等分割 | 中央で左右 2 等分 |
| 不均等分割 | ノド（綴じ）側に余白を追加して均等化（`outerMargin` 設定） |
| 分割なし | フォーマット変換のみ |

## 自動検出ロジック

- **単ページ自動検出**: 先頭/末尾ファイルが標準幅の 70% 未満なら分割スキップ
- **1 ファイル目の右側が白紙** (`firstPageBlank`): チェックで白紙右ページを破棄し、左ページから `_001` で開始（連番モード時のみ表示）
- **最終ファイルの左側が白紙** (`lastPageBlank`): 最終ファイルの左ページを破棄し、右ページで連番終了（連番モード時のみ表示）

## PDF 対応

- PDF ドロップ時にページ単位で展開表示
- プレビュー/サムネイル: `pdfium-render`
- 分割処理: Photoshop `PDFOpenOptions` で **600dpi** オープン

## SplitPreview の操作

- 定規ドラッグで垂直ガイド操作
- ズーム / パン
- Undo / Redo（`selectionHistory` / `selectionFuture`）
- ドラッグ開始時のみ `pushHistory`（ドラッグ中の連続イベントで履歴を汚さない）

## 実行ボタン

「選択のみ (N)」「全て実行 (N)」の 2 ボタンで対象を明示。

## 設計上のポイント

1. **マルチフォーマット**: PSD / PSB 以外に JPG / PNG / TIFF / PDF / BMP / GIF / EPS も受付
2. **出力形式**: PSD / JPG（品質 0-100%、JSX 側で 0-12 に変換）
3. **オプション**: 非表示レイヤー削除、はみ出しテキスト除去

## 関連機能

- [rename](../rename/README.md) — 連番リネーム単体機能
