# layer-control (レイヤー制御)

Photoshop JSX 経由で全ファイルのレイヤーを一括操作する機能。5 アクションモード（hide / show / custom / organize / layerMove）と 2 サブタブ（レイヤー制御 / リネーム）構成。

> 全体像: [../../../docs/architecture.md](../../../docs/architecture.md) / [../../../docs/feature-map.md](../../../docs/feature-map.md) / [../../../docs/data-flow.md](../../../docs/data-flow.md)

## 画面

| View | 役割 |
|---|---|
| [LayerControlView.tsx](./LayerControlView.tsx) | `AppView = "layers"` のルート。LayerControlPanel + LayerPreviewPanel。リネームタブは [rename/RenameView.tsx](../rename/RenameView.tsx) を内蔵 |

## このフィーチャーの所有物

| 種別 | ファイル | 責務 |
|---|---|---|
| Store | [layerStore.ts](./layerStore.ts) | `actionMode`, `saveMode`, `selectedConditions`, `customConditions`, `organizeTargetName`, `organizeIncludeSpecial`, layerMove 条件, `deleteHiddenText`, `customVisibilityOps` / `customMoveOps` (Map), `_customOpsHistory` (Undo) |
| Hook | [useLayerControl.ts](./useLayerControl.ts) | 5 モードの呼び分け + 結果マージ |
| Components | [components/](./components/) | LayerControlPanel, LayerPreviewPanel, LayerControlResultDialog |

## グローバル依存

- **ストア**: [psdStore](../../store/psdStore.ts) (R/W) / [specStore](../../store/specStore.ts) (R) / [viewStore](../../store/viewStore.ts) (R)
- **フック**: [useHighResPreview](../../hooks/useHighResPreview.ts) (ビューアーモード) / [useOpenInPhotoshop](../../hooks/useOpenInPhotoshop.ts)
- **Lib**: [layerMatcher.ts](../../lib/layerMatcher.ts) — safe/warning/none リスク分類
- **型**: [types/index.ts](../../types/index.ts) — `LayerNode` 等

## Rust コマンド

| 用途 | コマンド |
|---|---|
| hide/show | `run_photoshop_layer_visibility` |
| organize | `run_photoshop_layer_organize` |
| layerMove | `run_photoshop_layer_move` |
| custom | `run_photoshop_custom_operations` |
| lock/unlock | `run_photoshop_layer_lock` |
| merge | `run_photoshop_merge_layers` |

## Photoshop JSX

| JSX | モード |
|---|---|
| [hide_layers.jsx](../../../src-tauri/scripts/hide_layers.jsx) | hide / show (非表示テキスト削除含む) |
| [organize_layers.jsx](../../../src-tauri/scripts/organize_layers.jsx) | organize |
| [move_layers.jsx](../../../src-tauri/scripts/move_layers.jsx) | layerMove |
| [custom_operations.jsx](../../../src-tauri/scripts/custom_operations.jsx) | custom |
| [lock_layers.jsx](../../../src-tauri/scripts/lock_layers.jsx) | lock / unlock |
| [merge_layers.jsx](../../../src-tauri/scripts/merge_layers.jsx) | merge |

## 5 アクションモード

| モード | 説明 |
|---|---|
| **hide** | 条件に一致するレイヤーを非表示化（テキスト/テキストフォルダ/レイヤー名/フォルダ名/カスタム条件） |
| **show** | 非表示→表示復元。`doc.info.caption` にメタデータ保存、親グループの可視性も自動復元 |
| **custom** | 右プレビューで個別に目アイコン操作 + レイヤー移動。`customVisibilityOps` / `customMoveOps` に記録、`_customOpsHistory` で Undo |
| **organize** | 指定名のグループ（デフォルト: "#原稿#"）にレイヤーを再グルーピング。`organizeIncludeSpecial` で特殊レイヤー（白消し・棒消し）を含めるか |
| **layerMove** | 条件ベースでレイヤーを指定グループに移動。4 条件 AND (テキスト / サブグループ最上位 / サブグループ最下位 / レイヤー名一致)。検索範囲: ドキュメント全体 or 特定グループ |

## 保存先選択

- **上書き保存** or **別フォルダに保存** (`Desktop/Script_Output/レイヤー制御/{元フォルダ名}/`)
- `layerStore.saveMode` で管理、Rust 側で出力先算出 → JSX の `saveFolder` パラメータで `saveAs` 先切替

## 詳細レポートダイアログ

処理完了後、中央モーダル (`createPortal`) でファイル別ツリー表示:
- JSX 側が `changedNames` に `"テキスト「name」∈「parent」"` 形式で親フォルダ情報を記録
- フロント側 `extractMatchedItems()` → `buildTree()` でツリー構築
- F/G/T/L 種別バッジで階層表示

## LayerPreviewPanel (ビューアーモード)

- 全ファイル対象の高解像度プレビュー（`useHighResPreview` maxSize=2000）
- 矢印キー / マウスホイール / 矢印ボタンでページ送り
- P/F ショートカット: キャプチャフェーズ (`addEventListener(..., true)`) で現在表示中ファイルに対応（グローバルハンドラーより優先）
- URL キャッシュ（30 エントリ）+ 隣接ファイル prefetch + サムネイルフォールバックでちらつき防止

## 非表示テキストレイヤー削除

- hide / custom モードで使用可能（不可逆操作）
- hide: `hide_layers.jsx` 内で処理
- custom: `custom_operations.jsx` 内の `deleteHiddenTextLayers()` で処理

## 関連機能

- [rename](../rename/README.md) — 本 feature のサブタブとして内蔵
- [spec-check](../spec-check/README.md) — レイヤー制御前のレイヤー構造確認
