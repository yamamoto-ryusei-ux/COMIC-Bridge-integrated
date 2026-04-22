# parallel-viewer (分割ビューアー)

原稿 A / 原稿 B を 2 パネル並列で閲覧する機能。同期/独立モード切替、PDF 全ページ自動展開対応。KENBAN から React/Zustand ネイティブに完全移植（v3.5.0）。[unified-viewer](../unified-viewer/README.md) のサブタブ「分割ビューアー」として表示される。

> 全体像: [../../../docs/architecture.md](../../../docs/architecture.md) / [../../../docs/feature-map.md](../../../docs/feature-map.md) / [../../../docs/data-flow.md](../../../docs/data-flow.md)

## 画面

| View | 役割 |
|---|---|
| [ParallelViewerView.tsx](./ParallelViewerView.tsx) | 統合ビューアータブ内のサブタブ。`externalPathA` / `externalPathB` props 経由で [viewStore](../../store/viewStore.ts) の `kenbanPathA/B` と連動 |

## このフィーチャーの所有物

| 種別 | ファイル | 責務 |
|---|---|---|
| Store | [parallelStore.ts](./parallelStore.ts) | 2 パネル独立状態 (folder / files / pageIndex) / 同期モード / PDF 展開結果 |

## グローバル依存

- **ストア**: [viewStore](../../store/viewStore.ts) (R/W, `kenbanPathA/B`) / [settingsStore](../../store/settingsStore.ts) (R)

## Rust コマンド (kenban.rs)

| 用途 | コマンド |
|---|---|
| ファイル取得 | `kenban_list_files_in_folder`, `kenban_parse_psd` |
| PDF | `kenban_render_pdf_page`, `kenban_get_pdf_page_count` |
| 画像 | `decode_and_resize_image`, `preload_images` |
| PS 起動 | `kenban_open_file_in_photoshop` |

## 対応形式

PSD / PSB / TIFF / JPG / PNG / BMP / PDF

## 同期/独立モード

| モード | 動作 |
|---|---|
| 同期 | 両パネル同時ページング |
| 独立 | アクティブパネルのみページング |

ショートカット: `S` で切替。

## PDF 全ページ自動展開

PDF 読み込み時に `kenban_get_pdf_page_count` で全ページを取得し、個別エントリ化。1 ページずつページ送り可能。

## A/B 共有・読み込みガード (v3.8.1 — CLAUDE.md §30)

- パス登録は常時（片方だけでも即反映）
- 実ファイル読み込みは両方揃った時のみ (`loadFolderSide`)

```tsx
useEffect(() => {
  if (externalPathA !== undefined) store.setFolderA(externalPathA ?? null);
  if (externalPathB !== undefined) store.setFolderB(externalPathB ?? null);
  if (externalPathA && externalPathB) {
    store.loadFolderSide("A", externalPathA);
    store.loadFolderSide("B", externalPathB);
  }
}, [externalPathA, externalPathB]);
```

## 待機状態の視覚表示

パネル上部ツールバーに、`panel.folder` は登録済みだが `files` 未ロードの場合:
```
📂 フォルダ名  待機中
```
を黄色バッジで表示。hover tooltip「もう片方のフォルダ登録待ち」。

## 全画面モード (v3.7.2)

- ヘッダー非表示、画像エリアのみ表示
- OS レベルフルスクリーン
- Escape で解除
- 背景色: `#1a1a1e`（黒）統一

## 各パネル機能 (v3.8.0)

- **Ps ボタン** + `P` キーショートカット — 現在表示中ファイルを Photoshop で開く

## キーボード

- ↑↓ ページ移動
- S 同期/独立切替
- Ctrl+/- ズーム
- P 現在のファイルを Photoshop 起動

## TopNav A/B との双方向同期

ビューアー内でフォルダ/ファイル選択 → `viewStore.kenbanPathA/B` に書き戻し、TopNav から変更 → ビューアー再読み込み（最新優先）。

## 関連機能

- [unified-viewer](../unified-viewer/README.md) — 本 feature を内包
- [diff-viewer](../diff-viewer/README.md) — A/B 共有の兄弟機能
