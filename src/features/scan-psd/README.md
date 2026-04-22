# scan-psd (Scan PSD / フォントプリセット管理)

PSD フォルダをスキャンしてフォント・サイズ・ガイド線・ルビ等のメタデータを収集し、プリセット JSON として管理する機能。元スクリプト `je-nsonman_ver2.86.jsx`（約 11,000 行）から React に移植。

> 全体像: [../../../docs/architecture.md](../../../docs/architecture.md) / [../../../docs/feature-map.md](../../../docs/feature-map.md) / [../../../docs/data-flow.md](../../../docs/data-flow.md)

## 画面

| View | 役割 |
|---|---|
| [ScanPsdView.tsx](./ScanPsdView.tsx) | `AppView = "scanPsd"` のルート。2 カラム: ScanPsdPanel (5 タブ) \| ScanPsdContent |
| [FontBookView.tsx](./FontBookView.tsx) | フォント帳ビュー（画像添付: ファイル選択/D&D、v3.7.1 復元） |

## このフィーチャーの所有物

| 種別 | ファイル | 責務 |
|---|---|---|
| Store | [scanPsdStore.ts](./scanPsdStore.ts) | `mode`, `scanData`, `presetSets`, `workInfo`, ガイド選択/除外, パス設定（localStorage 永続化はパスのみ） |
| Store | [fontBookStore.ts](./fontBookStore.ts) | フォント帳 (`entries`, `fontBookDir`, `isLoaded`) |
| Hook | [useScanPsdProcessor.ts](./useScanPsdProcessor.ts) | スキャン実行 / JSON/scandata 保存・読込 / ガイド自動選択 / フォント自動登録 |
| Components | [components/](./components/) | ScanPsdPanel, ScanPsdContent, ScanPsdEditView, ScanPsdModeSelector, JsonFileBrowser, ProgenJsonBrowser, tabs/ |
| Tabs | [components/tabs/](./components/tabs/) | WorkInfoTab, FontTypesTab, FontSizesTab, GuideLinesTab, TextRubyTab |

## グローバル依存

- **ストア**: [psdStore](../../store/psdStore.ts) (R) / [specStore](../../store/specStore.ts) (R) / [guideStore](../../store/guideStore.ts) (R) / [viewStore](../../store/viewStore.ts) (R) / [workflowStore](../../store/workflowStore.ts) (R)
- **フック**: [useFontResolver](../../hooks/useFontResolver.ts)
- **型**: [types/scanPsd.ts](../../types/scanPsd.ts) — `ScanData`, `PresetJsonData`, `ScanGuideSet`, `ScanWorkInfo`, `FontPreset`, `GENRE_LABELS`, `FONT_SUB_NAME_MAP` / [types/fontBook.ts](../../types/fontBook.ts)

## Rust コマンド

| 用途 | コマンド |
|---|---|
| PSD スキャン | `run_photoshop_scan_psd`, `poll_scan_psd_progress` |
| フォント | `resolve_font_names`, `search_font_names`, `list_font_folder_contents`, `search_font_files`, `install_font_from_path` |
| JSON | `read_text_file`, `write_text_file`, `search_json_folders` |

## Photoshop JSX

| JSX | 用途 |
|---|---|
| [scan_psd.jsx](../../../src-tauri/scripts/scan_psd.jsx) | レガシー・元スクリプト全機能 |
| [scan_psd_core.jsx](../../../src-tauri/scripts/scan_psd_core.jsx) | コア処理のみ・UI 無し（本体から起動する用） |

## 5 タブ構成

| タブ | 内容 |
|---|---|
| **作品情報** (WorkInfoTab) | ジャンル/レーベル/著者/タイトル/Notion ページ 等 |
| **フォント種類** (FontTypesTab) | プリセットセット管理・カスタムセット作成・手動追加・フィルタ・ソート・纏め(グループ化) |
| **サイズ統計** (FontSizesTab) | フォントサイズ統計 |
| **ガイド線** (GuideLinesTab) | ガイドセット選択/除外 |
| **テキスト/ルビ** (TextRubyTab) | ルビ抽出 |

## データ分離設計

| ファイル | 置き場所 | 内容 |
|---|---|---|
| **プリセット JSON** | `{jsonFolderPath}/{label}/{title}.json` | 選択ガイドのみ、プリセット、作品情報 |
| **scandata** | `{saveDataBasePath}/{label}/{title}_scandata.json` | 全ガイドセット、選択・除外状態、フォント統計等の完全データ |
| **テキストログ** | `{textLogFolderPath}/` | ルビリスト等（`performExportTextLog`） |

JSON 読み込み時: リンク scandata を自動検索。見つからなければ JSON 内 `guideSets` からフォールバック構築。

## ガイド自動選択（元スクリプト準拠）

- `isValidTachikiriGuideSet()` — ドキュメント中心 ±1px のガイドを除外、上下左右各 1 本以上で有効判定
- `autoSelectGuideSet()` — 有効タチキリ優先 → 使用回数降順 → インデックス 0 を自動選択

## 保存ルール

- ファイル名: `{title}.json` / `{title}_scandata.json`
- 保存先: `{basePath}/{label}/`
- レーベル・タイトル未入力時: `{basePath}/_仮保存/temp.json` に仮保存 → 入力後に正式保存 & 仮データ削除
- スキャン完了後にフォント自動登録 (`autoRegisterDetectedFonts()`) → 自動保存 (`performPresetJsonSave()`)

## 元スクリプト互換

- **エクスポート変換**: `convertSizeStatsForExport()` / `convertStrokeSizesForExport()` / `convertPresetsForExport()` — je-nsonman 形式に整形
- **インポート変換**: `loadPresetJson` のフォールバックで安全に変換、欠落フィールドはオプショナルチェーン (`?.`) ガード

## エラーバウンダリ

`ErrorBoundary` コンポーネント（`src/components/ErrorBoundary.tsx`）を `ViewRouter` に適用。レンダリングエラー時に再試行ボタン表示。

## 設計上のポイント

1. **カスタムセット作成**: 「+」ボタンでフォントピッカー付きセット作成。既存セット（デフォルト・手動追加）や未登録フォントから選択
2. **纏め（グループ化）機能**: フォントファミリーを自動検出、`extractGroupKey()` でファミリーキー抽出（ＤＦＰ→ＤＦ正規化等）
3. **カテゴリ自動判定**: `getAutoSubName()` で PostScript 名からセリフ/モノローグ/ナレーション等を自動付与（`FONT_SUB_NAME_MAP`）
4. **カテゴリ手入力**: `<input>` + `<datalist>` で自由入力も可能
5. **インストール状態表示**: `useFontResolver` でフォントのインストール有無を色分け表示

## 関連機能

- [progen](../progen/README.md) — 作品情報 JSON / 校正 JSON を共有
- [tiff](../tiff/README.md) — クロップ JSON ライブラリ (CLLENN 互換) の元データ
- [spec-check](../spec-check/README.md) — レイヤー構造確認・SpecScanJsonDialog から起動
