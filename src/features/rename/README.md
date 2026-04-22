# rename (リネーム)

2 モード構成のリネーム機能。レイヤーリネーム（Photoshop JSX 経由）とファイルリネーム（Rust 直接処理、PS 不要）をタブ切替で提供。

> 全体像: [../../../docs/architecture.md](../../../docs/architecture.md) / [../../../docs/feature-map.md](../../../docs/feature-map.md) / [../../../docs/data-flow.md](../../../docs/data-flow.md)

## 画面

| View | 役割 |
|---|---|
| [RenameView.tsx](./RenameView.tsx) | `AppView = "rename"` のルート。レイヤー/ファイルサブタブ切替 |

## このフィーチャーの所有物

| 種別 | ファイル | 責務 |
|---|---|---|
| Store | [renameStore.ts](./renameStore.ts) | `subMode` / `layerSettings` / `fileSettings` / `fileEntries` |
| Hook | [useRenameProcessor.ts](./useRenameProcessor.ts) | 両モードの実行ロジック |
| Types | [rename.ts](./rename.ts) | `RenameSubMode`, `RenameRule`, `FileRenameEntry` 等 |
| Components | [components/](./components/) | LayerRenamePanel, FileRenamePanel, RenamePreview, RenameResultDialog |

## グローバル依存

- **ストア**: [psdStore](../../store/psdStore.ts) (R/W) — fileEntries → psdStore 自動同期
- **フック**: [usePageNumberCheck](../../hooks/usePageNumberCheck.ts)

## Rust コマンド

| 用途 | コマンド |
|---|---|
| ファイルリネーム | `batch_rename_files` (fs::rename 失敗時に fs::copy + fs::remove_file フォールバック) |
| レイヤーリネーム | `run_photoshop_rename` |
| Undo 用 | `backup_to_temp` / `restore_from_backup` |

## Photoshop JSX

| JSX | 用途 |
|---|---|
| [rename_psd.jsx](../../../src-tauri/scripts/rename_psd.jsx) | レイヤー名変更・検索/置換・連番別名保存 |

## モード A: レイヤーリネーム (Photoshop JSX 経由)

- 最下位/背景レイヤーを指定名に変更
- レイヤー/グループ名の検索→置換（複数ルール、完全一致/部分一致/正規表現）
- ファイルを連番で別名保存（ベース名 + セパレータ + ゼロ埋め）
- 出力先フォルダ選択
- ライブプレビュー（psdStore の layerTree データで変更前→変更後を表示）

## モード B: ファイルリネーム (Rust 直接処理)

| 項目 | 仕様 |
|---|---|
| 対応形式 | PSD, PSB, TIFF, JPG, PNG, BMP, GIF, PDF, EPS |
| 連番 | ベース名 + セパレータ + ゼロ埋め連番（デフォルト: 開始番号=3, 桁数=4, セパレータ=空文字） |
| 置換 | 検索→置換（部分一致/正規表現） |
| Prefix/Suffix | 任意指定 |
| 複数フォルダ | フォルダ追加ボタン（フォルダ名ヘッダー付き表示） |
| 並替え | ドラッグで順序変更 → 連番割当に反映 |
| 部分選択 | チェックボックスで対象のみ |
| 個別編集 | ダブルクリックで個別ファイル名編集 |
| 出力 | 「Script_Output にコピー」 or 「元の場所で上書きリネーム」 |

## fileEntries → psdStore 自動同期

ファイルリネームに追加された PSD/PSB は自動的に psdStore へ同期（レイヤーリネーム用のレイヤーツリー取得が必要なため）。

## 設計上のポイント

1. **ファイルリネームは Rust 直接**: fs::copy + fs::remove_file フォールバックで Windows ファイルロックに耐性
2. **Undo (Ctrl+Z) 対応**: 最大 10 操作。バッチリネームも 1 操作として扱う
3. **RenameResultDialog**: 処理完了時に成功/失敗一覧と出力フォルダを開くボタンを表示
4. **layer-control との統合**: LayerControlView のリネームサブタブは本 feature の `RenameView` をそのまま内蔵

## 関連機能

- [layer-control](../layer-control/README.md) — 本 feature の RenameView を内蔵
- [split](../split/README.md) — 分割時の連番リネーム（別経路）
