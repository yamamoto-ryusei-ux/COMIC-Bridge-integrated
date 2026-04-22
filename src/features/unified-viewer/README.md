# unified-viewer (統合ビューアー)

5 スロットパネルシステムで PSD / PDF / 画像 / テキスト / 校正 JSON / テキスト照合を自由配置できる閲覧ビュー。ユーザーが任意タブを好きなパネル位置（左端 / 左サブ / 中央ビューアー / 右サブ / 右端）に移動可能。

> 全体像: [../../../docs/architecture.md](../../../docs/architecture.md) / [../../../docs/feature-map.md](../../../docs/feature-map.md) / [../../../docs/data-flow.md](../../../docs/data-flow.md)

## 画面

| View | 役割 |
|---|---|
| [UnifiedViewerView.tsx](./UnifiedViewerView.tsx) | `AppView = "unifiedViewer"` のルート。3 サブタブ（統合ビューアー / 差分モード / 分割ビューアー）。`display` 切替による**状態保持型マウント** |

差分モード / 分割ビューアーは [diff-viewer](../diff-viewer/README.md) / [parallel-viewer](../parallel-viewer/README.md) を内包。

## このフィーチャーの所有物

| 種別 | ファイル | 責務 |
|---|---|---|
| Store | [unifiedViewerStore.ts](./unifiedViewerStore.ts) | 独立ファイル管理 / テキスト / 校正 JSON / フォントプリセット / PanelTab + 4 ポジションパネル配置 / `displacedTabs` (タブ入替え記憶) |
| Components | [components/UnifiedViewer.tsx](./components/UnifiedViewer.tsx) | メインコンポーネント（`renderTabContent`） |
| Components | [components/UnifiedSubComponents.tsx](./components/UnifiedSubComponents.tsx) | ToolBtn, PanelTabBtn, LayerTreeView, SortableBlockItem, UnifiedDiffDisplay, CheckJsonBrowser |
| Components | [components/ProgenImageViewer.tsx](./components/ProgenImageViewer.tsx) | ProGen 画像ビューアー（COMIC-POT スタイル） |
| Utils | [components/utils.ts](./components/utils.ts) | COMIC-POT パーサー / ページ番号計算 / ファイル判定 |
| Hook | [components/useViewerFileOps.ts](./components/useViewerFileOps.ts) | `openFolder`, `openTextFile`, `handleJsonFileSelect`, `handleSave`, `handleSaveAs` |

## グローバル依存

- **ストア**: [psdStore](../../store/psdStore.ts) (R, `doSync` で同期) / [specStore](../../store/specStore.ts) (R) / [viewStore](../../store/viewStore.ts) (R) / [settingsStore](../../store/settingsStore.ts) (R) / [workflowStore](../../store/workflowStore.ts) (R)
- **フック**: [useHighResPreview](../../hooks/useHighResPreview.ts) / [useOpenInPhotoshop](../../hooks/useOpenInPhotoshop.ts) / [useTextExtract](../../hooks/useTextExtract.ts)
- **Lib**: [kenban-utils/textExtract.ts](../../kenban-utils/textExtract.ts) — LCS 文字レベル diff, テキスト照合 / [kenban-utils/memoParser.ts](../../kenban-utils/memoParser.ts) — COMIC-POT メモ解析

## Rust コマンド

| 用途 | コマンド |
|---|---|
| プレビュー | `get_high_res_preview`, `get_pdf_preview`, `invalidate_file_cache` |
| PDF | `get_pdf_info`, `get_pdf_thumbnail` |
| ファイル | `read_text_file`, `write_text_file` |

## 5 スロットパネル (v3.7.0)

左端 / 左サブ / **中央（ビューアー + ページリスト）** / 右サブ / 右端。

- 各パネルは `TAB_WIDTHS` 定数でタブごとの適切な幅
- タブバー ◀▶ ボタンで選択中タブの配置位置を移動
- **タブ入れ替え記憶 (`displacedTabs`)**: 移動時に押し出されたタブを記憶、移動元が空いたら自動復帰

## 共通タブ

| タブ | 内容 |
|---|---|
| ファイル | ファイル一覧 |
| レイヤー (v3.7.0) | `FullLayerTree` 使用。レイヤークリックで画像ビューアー上に SVG 矩形ハイライト |
| 写植仕様 (v3.7.1) | フォント統計・テキストレイヤー一覧・スクショキャプチャ機能 |
| テキスト (v3.7.3) | **ダブルクリックインライン編集に統一**（編集モード廃止）。+追加/+フォント/解除/削除/D&D 並替え |
| 校正 JSON | 正誤/提案/全て切替・カテゴリフィルタ・ページ連動 |
| テキスト照合 | KENBAN 版 LCS 文字レベル diff。差異ありのみ 2 カラム・一致は切替で 1 カラム。漫画読み順ソート |

## 中央ビューアー

- 画像: PSD/画像は Rust `get_high_res_preview`、PDF は PDF.js 描画
- ナビバー: ◀▶ ページ送り / ズーム / 単ページ化 / メタデータ (DPI/カラー/用紙)
- **単ページ化（見開き分割表示）**: [単ページ化] トグル + [1P 単独/1P も見開き/1P 除外] + [左→右/右→左] 読み順切替
  - `logicalPage` カウンターで全ファイル × 前後をフラットに管理
  - `resolveLogicalPage(lp)` で (fileIdx, side) を同期計算
  - 半分表示: ラッパー div `overflow:hidden + width:50%` + img `width:200%`
- **リロードボタン** (v3.7.0): 画像エリア右上常時表示、クリックで `invalidate_file_cache` → 再読み込み
- **PDF キャッシュキー**: `${path}#p${page}` で同一 PDF 別ページ区別

## キーボード

| キー | 動作 |
|---|---|
| ←→ | ページ送り |
| Ctrl+/- | ズーム |
| Ctrl+0 | フィット |
| Ctrl+S | 保存 |
| P | 現在のファイルを Photoshop 起動 |
| ダブルクリック | テキストブロックをインライン編集 |
| Ctrl+Enter | 編集確定 |
| Esc | 編集キャンセル |

## テキスト照合タブの挙動

- `normalizeTextForComparison` + `computeLineSetDiff` + `buildUnifiedDiff`
- PSD レイヤー ↔ テキストブロックのリンクマッピング
- `//` 先頭ブロックは「テキスト削除確認」として黄色警告表示（差異としてカウントしない）
- textPages が空なら textContent 全体をフォールバック比較

## 設計上のポイント

1. **psdStore 同期**: `doSync` 関数で psdStore のファイルをビューアーストアに自動反映。タブ切替時にキャッシュクリア + `loadImageRef` で再読み込み
2. **PDF 情報のマッピング**: `isPdf` / `pdfPath` / `pdfPage` を正しく渡す（0-indexed → 1-indexed 変換）
3. **状態保持型マウント**: タブ切替でアンマウントしないので読み込み状態を保持（display 切替）
4. **WorkflowBar 連携**: `viewerTabSetup` でステップごとにタブ配置を自動制御可能 (`{ text: "far-right", files: null, ... }`)
5. **ページ連動**: `navigateToTextPage` 関数で単ページ化モード対応、logicalPage を走査してテキストページ番号に対応するページを特定

## 関連機能

- [diff-viewer](../diff-viewer/README.md) — サブタブとして内包
- [parallel-viewer](../parallel-viewer/README.md) — サブタブとして内包
- [progen](../progen/README.md) — 校正結果を `unifiedViewerStore.checkData` に書き込み
- [spec-check](../spec-check/README.md) — 拡大表示時の連動（同じファイルを自動表示）
