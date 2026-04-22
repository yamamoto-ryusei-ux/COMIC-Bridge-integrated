# diff-viewer (差分ビューアー)

原稿 A / 原稿 B の差分をピクセル比較・ヒートマップ表示する機能。KENBAN から React/Zustand ネイティブに完全移植（v3.5.0）。[unified-viewer](../unified-viewer/README.md) のサブタブ「差分モード」として表示される。

> 全体像: [../../../docs/architecture.md](../../../docs/architecture.md) / [../../../docs/feature-map.md](../../../docs/feature-map.md) / [../../../docs/data-flow.md](../../../docs/data-flow.md)

## 画面

| View | 役割 |
|---|---|
| [DiffViewerView.tsx](./DiffViewerView.tsx) | 統合ビューアータブ内のサブタブ。`externalPathA` / `externalPathB` props 経由で [viewStore](../../store/viewStore.ts) の `kenbanPathA/B` と連動 |

## このフィーチャーの所有物

| 種別 | ファイル | 責務 |
|---|---|---|
| Store | [diffStore.ts](./diffStore.ts) | folders / files / compareMode / pairing / previewMap / diffResults |

## グローバル依存

- **ストア**: [viewStore](../../store/viewStore.ts) (R/W, `kenbanPathA/B` 双方向同期) / [settingsStore](../../store/settingsStore.ts) (R)

## Rust コマンド (kenban.rs)

| 用途 | コマンド |
|---|---|
| ファイル取得 | `kenban_list_files_in_folder`, `kenban_parse_psd` |
| PDF | `kenban_render_pdf_page`, `kenban_get_pdf_page_count` |
| 差分計算 | `compute_diff_simple`, `check_diff_simple`, `compute_diff_heatmap`, `check_diff_heatmap`, `compute_pdf_diff` |
| 画像 | `decode_and_resize_image`, `preload_images`, `clear_image_cache` |
| PS 起動 | `kenban_open_file_in_photoshop` |

## 比較モード

| compareMode | 対応 |
|---|---|
| `tiff-tiff` | TIFF 同士 |
| `psd-psd` | PSD 同士 |
| `pdf-pdf` | PDF 同士 |
| `psd-tiff` | PSD ↔ TIFF（順序問わず双方向対応） |

`computeCompareMode()` で自動判定。`isValidPairCombination()` で compareMode に合わない組合せは A 単独表示・B 側は赤エラーカード。

## 表示モード

| mode | 内容 |
|---|---|
| A | 原稿 A のみ |
| B | 原稿 B のみ |
| 差分 | ピクセル差分のヒートマップ・マーカー表示 |

## ペアリング

ファイル順 / 名前順の 2 方式。

## オプション

- 差分のみ表示
- マーカー表示
- しきい値調整

## プレビューキャッシュ

`previewMap` (filePath → URL) で全ファイルを並行プレビュー取得 → 差分計算前から表示可能。

## A/B 共有・読み込みガード (v3.8.1 — CLAUDE.md §30)

```tsx
useEffect(() => {
  // パス登録は常時（片方だけでも即反映）
  if (externalPathA !== undefined) store.setFolder("A", externalPathA ?? null);
  if (externalPathB !== undefined) store.setFolder("B", externalPathB ?? null);
  // 実ファイル読み込みは両方揃った時のみ
  if (externalPathA && externalPathB) {
    store.loadFolderSide("A", externalPathA);
    store.loadFolderSide("B", externalPathB);
  }
}, [externalPathA, externalPathB]);
```

**TopNav の自動遷移は削除済み**。ユーザーの明示操作で切り替え。

## 全画面モード (v3.7.2)

- サイドバー・ツールバー・ステータスバーすべて非表示、画像のみ表示
- OS レベルフルスクリーン（タイトルバーも非表示）
- Escape で解除
- 背景色: `#1a1a1e`（黒）統一

## キーボード

- ↑↓ ペア/ページ移動
- Space 表示モード切替
- Ctrl+/- ズーム
- P 現在のファイルを Photoshop 起動

## 設計上のポイント

1. **自動差分計算**: ペア選択時に自動で Rust 側 `compute_diff_simple` / `compute_diff_heatmap` を呼出（失敗してもプレビューは残る）
2. **タブ移動時の自動セットアップ**: 差分タブを開いた瞬間に `kenbanPathA/B` から filesA/B を自動読み込み
3. **PDF ページ番号**: Rust 側は 0-indexed、フロント側は 1-indexed → `pdfPage - 1` で変換

## 関連機能

- [unified-viewer](../unified-viewer/README.md) — 本 feature を内包
- [parallel-viewer](../parallel-viewer/README.md) — A/B 共有の兄弟機能
