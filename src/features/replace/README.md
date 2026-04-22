# replace (レイヤー差替え)

植字データ ⇄ 画像データのテキストレイヤー/特定名グループ差替え（Photoshop JSX 経由）。バッチモードで白消し・棒消しフォルダを自動検出して一括差替え可能。

> 全体像: [../../../docs/architecture.md](../../../docs/architecture.md) / [../../../docs/feature-map.md](../../../docs/feature-map.md) / [../../../docs/data-flow.md](../../../docs/data-flow.md)

## 画面

| View | 役割 |
|---|---|
| [ReplaceView.tsx](./ReplaceView.tsx) | `AppView = "replace"` のルート。ReplacePanel + ReplaceDropZone + ReplacePairingModal + ReplaceToast |

## このフィーチャーの所有物

| 種別 | ファイル | 責務 |
|---|---|---|
| Store | [replaceStore.ts](./replaceStore.ts) | `folders` / `batchFolders` / `settings` / `pairingJobs` / `manualPairs` / `excludedPairIndices` |
| Hook | [useReplaceProcessor.ts](./useReplaceProcessor.ts) | スキャン & ペアリング / Photoshop 実行 |
| Components | [components/](./components/) | ReplacePanel, ReplaceDropZone, ReplacePairingModal, PairingAutoTab, PairingManualTab, PairingOutputSettings, ReplaceToast |

## グローバル依存

- **ストア**: [psdStore](../../store/psdStore.ts) (R) / [viewStore](../../store/viewStore.ts) (R, kenbanPathA/B 連携) / [settingsStore](../../store/settingsStore.ts) (R)
- **Lib**: [layerMatcher.ts](../../lib/layerMatcher.ts) — 差替え対象マッチング
- **型**: [types/replace.ts](../../types/replace.ts) — `ReplaceSettings`, `PairingJob`, `FolderSelection`, `BatchFolder` 等

## Rust コマンド

| 用途 | コマンド |
|---|---|
| 差替え実行 | `run_photoshop_replace` |
| ファイル | `list_folder_files` (recursive), `list_subfolders`, `detect_psd_folders` |

## Photoshop JSX

| JSX | 用途 |
|---|---|
| [replace_layers.jsx](../../../src-tauri/scripts/replace_layers.jsx) | レイヤー差替え（compose 設定にも対応） |

## 出力先

- 通常モード: `Desktop/Script_Output/差替えファイル_出力/{timestamp}/` または `{カスタム名}/`
- 差替えタブ内 compose: `差替えファイル_出力/{timestamp}/`

## ペアリング 4 方式

| 方式 | 説明 | マッチキー表示 |
|---|---|---|
| ファイル順 | インデックスでペアリング | `#N` |
| 数字キー | ファイル名の数字部分で照合 | `pN` |
| リンク文字 | 共通文字を自動検出（手動指定も可） | キー文字 |
| 手動マッチ | 2 カラムクリック/ドラッグで任意ペア作成 | — |

## モーダル構成

- **ReplacePairingModal**: PairingAutoTab / PairingManualTab のタブ切替シェル
  - **PairingAutoTab**: チェックボックス付きペアテーブル、行ごとの編集 (鉛筆) / 解除 (×)、未マッチ折りたたみ、マッチ進捗バー
  - **PairingManualTab**: 2 カラム + クリック/ドラッグ
  - **PairingOutputSettings**: 出力フォルダ名・保存ファイル名トグル・出力パスプレビュー

## 設計上のポイント

1. **バッチモード**: 親フォルダ ⇔ 個別指定の排他制御、サブフォルダ自動検出。親フォルダ選択時は内部のサブフォルダを全対象化
2. **ドロップゾーン中央インジケータ**: 準備完了バッジ + モード連動方向矢印（text=→、image/batch=←）
3. **設定の再配置**: 全般設定セクション廃止、各モードに散らして配置（丸める=テキストモード、サイズ変更なし=画像モード、サブフォルダ=フォルダ選択）
4. **詳細マッチレポート**: 処理完了後に結果テーブルの各行にマッチしたレイヤー/グループ名をインラインタグバッジで表示（`resultMatchMap`）
5. **完了トースト**: モーダル閉じ後も ReplaceToast で結果表示、出力フォルダを開くボタン付き

## 関連機能

- [compose](../compose/README.md) — ペアリング UI を本 feature から流用
- [layer-control](../layer-control/README.md) — 差替え前後のレイヤー構造調整
