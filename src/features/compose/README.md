# compose (合成)

2 つの PSD ファイル（原稿 A / 原稿 B）を 1 つの合成ファイルに統合する機能（Photoshop JSX 経由）。5 要素（テキストフォルダ / 背景 / #背景# / 白消し / 棒消し）を A / B / 除外で独立にルーティング可能。

> 全体像: [../../../docs/architecture.md](../../../docs/architecture.md) / [../../../docs/feature-map.md](../../../docs/feature-map.md) / [../../../docs/data-flow.md](../../../docs/data-flow.md)

## 画面

| View | 役割 |
|---|---|
| [ComposeView.tsx](./ComposeView.tsx) | `AppView = "compose"` のルート。2 カラム: ComposePanel \| ComposeDropZone |

## このフィーチャーの所有物

| 種別 | ファイル | 責務 |
|---|---|---|
| Store | [composeStore.ts](./composeStore.ts) | `folders`, `composeSettings` (elements / restSource / skipResize / roundFontSize), `pairingJobs`, `scannedFileGroups`, `excludedPairIndices`, `manualPairs`, `phase` / `progress` / `results` |
| Hook | [useComposeProcessor.ts](./useComposeProcessor.ts) | スキャン & ペアリング → Photoshop 実行 |
| Components | [components/](./components/) | ComposePanel, ComposeDropZone, ComposePairingModal, ComposePairingAutoTab, ComposePairingManualTab, ComposePairingOutputSettings, ComposeToast |

## グローバル依存

- **ストア**: [psdStore](../../store/psdStore.ts) (R) / [viewStore](../../store/viewStore.ts) (R, kenbanPathA/B) / [settingsStore](../../store/settingsStore.ts) (R)
- **Lib**: [layerMatcher.ts](../../lib/layerMatcher.ts) — ペアリング判定を replace と共有

## Rust コマンド

| 用途 | コマンド |
|---|---|
| 合成実行 | `run_photoshop_replace` (compose 設定モードで起動) |
| ファイル | `list_folder_files`, `detect_psd_folders` |

## Photoshop JSX

| JSX | ヘルパー関数 |
|---|---|
| [replace_layers.jsx](../../../src-tauri/scripts/replace_layers.jsx) | `composeCopyElement()`, `composeRemoveElement()` |

## 要素ルーティング

- 5 要素: **テキストフォルダ / 背景 / #背景#(除外) / 白消し(除外) / 棒消し(除外)**
- 各要素の source は A / B / 除外から選択
- `restSource` で指定した側が **baseDoc** (保存対象)、もう片方が **otherDoc** (コピー元)
- 要素の `source` と `baseLabel` (A/B) を **文字列比較** でルーティング（ExtendScript の Document オブジェクト比較は不安定なため）

## 出力先

- 単独起動: `Desktop/Script_Output/合成ファイル_出力/{timestamp}/`
- 差替えタブ内 compose: `Desktop/Script_Output/差替えファイル_出力/{timestamp}/`

## 設計上のポイント

1. **ペアリング UI を replace と共有**: [replace/components/](../replace/components/) の `PairingAutoTab` / `PairingManualTab` のロジックを流用（本 feature では Compose 接頭辞で別コンポーネント化）
2. **サブフォルダ対応**: ソースファイルをサブフォルダに整理してから合成可能
3. **スキャン結果の保持**: `scannedFileGroups` に折りたたみ式で全件保持、`excludedPairIndices` でユーザー除外を表現
4. **baseDoc の決定タイミング**: ユーザーが明示的に指定（どちらを残すか）。save 対象はこちらに集約

## 関連機能

- [replace](../replace/README.md) — ペアリング UI の兄弟機能
- [tiff](../tiff/README.md) — 合成後のファイルを TIFF 化へ
