# shared (機能横断コードの受け皿)

複数 feature から参照される横断コードを集約する予定のディレクトリ。`@shared/*` alias で参照する。

> 全体像: [../../docs/architecture.md](../../docs/architecture.md) / [../../docs/feature-map.md](../../docs/feature-map.md)

## ⚠️ 現状 (Phase 4 完了時点)

**このディレクトリはまだスキャフォールドのみ**。実体は以下の従来パスに残っており、段階的に `@shared/*` 配下へ移動していく方針。

| 予定 | 現状の実体 | 移動予定時期 |
|---|---|---|
| `shared/components/ui/` | [src/components/ui/](../components/ui/) | Phase 5 |
| `shared/components/layout/` | [src/components/layout/](../components/layout/) | Phase 5 |
| `shared/components/file-browser/` | [src/components/file-browser/](../components/file-browser/) | Phase 5 |
| `shared/components/common/` | [src/components/common/](../components/common/) + [src/components/ErrorBoundary.tsx](../components/ErrorBoundary.tsx) | Phase 5 |
| `shared/hooks/` | [src/hooks/](../hooks/) | Phase 5 |
| `shared/stores/` | [src/store/](../store/) | Phase 5（慎重に） |
| `shared/lib/` | [src/lib/](../lib/) + [src/kenban-utils/](../kenban-utils/) | Phase 5〜6 |
| `shared/types/` | [src/types/](../types/) | Phase 5 |

## 移動対象の目安

### components/

| 配置予定 | 内容 |
|---|---|
| `components/ui/` | [Badge](../components/ui/Badge.tsx), [GlowCard](../components/ui/GlowCard.tsx), [Modal](../components/ui/Modal.tsx), [PopButton](../components/ui/PopButton.tsx), [ProgressBar](../components/ui/ProgressBar.tsx), [SpeechBubble](../components/ui/SpeechBubble.tsx), [Tooltip](../components/ui/Tooltip.tsx) |
| `components/layout/` | [AppLayout](../components/layout/AppLayout.tsx), [TopNav](../components/layout/TopNav.tsx), [GlobalAddressBar](../components/layout/GlobalAddressBar.tsx), [ViewRouter](../components/layout/ViewRouter.tsx), [WorkflowBar](../components/layout/WorkflowBar.tsx), [SettingsPanel](../components/layout/SettingsPanel.tsx) |
| `components/file-browser/` | [FileBrowser](../components/file-browser/FileBrowser.tsx), [FileList](../components/file-browser/FileList.tsx), [DropZone](../components/file-browser/DropZone.tsx) |
| `components/common/` | [FileContextMenu](../components/common/FileContextMenu.tsx), [CompactFileList](../components/common/CompactFileList.tsx), [DetailSlidePanel](../components/common/DetailSlidePanel.tsx), [TextExtractButton](../components/common/TextExtractButton.tsx), [ErrorBoundary](../components/ErrorBoundary.tsx) |
| `components/metadata/` | [MetadataPanel](../components/metadata/MetadataPanel.tsx), [LayerTree](../components/metadata/LayerTree.tsx) |
| `components/preview/` | [PreviewGrid](../components/preview/PreviewGrid.tsx), [PreviewList](../components/preview/PreviewList.tsx), [ThumbnailCard](../components/preview/ThumbnailCard.tsx) |
| `components/guide-editor/` | [GuideEditorModal](../components/guide-editor/GuideEditorModal.tsx), [GuideCanvas](../components/guide-editor/GuideCanvas.tsx), [CanvasRuler](../components/guide-editor/CanvasRuler.tsx), [GuideList](../components/guide-editor/GuideList.tsx) |

### hooks/

全 [src/hooks/](../hooks/) 配下（15 個）— useAppUpdater, useCanvasSizeCheck, useFileWatcher, useFontResolver, useGlobalDragDrop, useHandoff, useHighResPreview, useOpenFolder, useOpenInPhotoshop, usePageNumberCheck, usePhotoshopConverter, usePreparePsd, usePsdLoader, useSpecConverter, useTextExtract

### stores/

[src/store/](../store/) のグローバルストア 6 個（+ index.ts バレルエクスポート）:
- [psdStore](../store/psdStore.ts) — ファイル一覧・選択
- [specStore](../store/specStore.ts) — 仕様・チェック結果（localStorage）
- [guideStore](../store/guideStore.ts) — ガイド線 + Undo 履歴
- [viewStore](../store/viewStore.ts) — activeView / progenMode / kenbanPathA/B
- [settingsStore](../store/settingsStore.ts) — アプリ設定（localStorage）
- [workflowStore](../store/workflowStore.ts) — WF 状態・WORKFLOWS 定数

### lib/

- [naturalSort](../lib/naturalSort.ts) — 自然順ソート
- [paperSize](../lib/paperSize.ts) — 用紙サイズ判定
- [textUtils](../lib/textUtils.ts) — テキスト処理
- [layerMatcher](../lib/layerMatcher.ts) — レイヤーマッチング・リスク分類
- [layerTreeOps](../lib/layerTreeOps.ts) — レイヤーツリー操作
- [agPsdScanner](../lib/agPsdScanner.ts) — ag-psd スキャナー
- [psd/parser](../lib/psd/parser.ts) — ag-psd ラッパー
- [psdLoaderRegistry](../lib/psdLoaderRegistry.ts) — グローバル loader レジストリ
- [linkGroupCheck](../lib/linkGroupCheck.ts) — リンクグループ検証（tiff プリフライト用）

### types/

[src/types/](../types/) の共有型:
- [index.ts](../types/index.ts) — `PsdFile`, `PsdMetadata`, `LayerNode`, `TextInfo`, `Specification`, `SpecRule`, `SpecCheckResult`, `IMAGE_EXTENSIONS` 等
- [fontBook.ts](../types/fontBook.ts) — `FontBookEntry`, `FontBookData`, `FontBookParams`
- [replace.ts](../types/replace.ts) — `ReplaceSettings`, `PairingJob` 等
- [tiff.ts](../types/tiff.ts) — `TiffSettings`, `TiffCropBounds`, `TiffCropPreset` 等
- [scanPsd.ts](../types/scanPsd.ts) — `ScanData`, `PresetJsonData`, `GENRE_LABELS` 等
- [typesettingCheck.ts](../types/typesettingCheck.ts) — `ProofreadingCheckData` （unified-viewer 使用中、`_deprecated` 参照）

## import 規約

1. **feature 間の直接参照は禁止**
   `@features/compose/...` を `@features/tiff/...` から import しない
2. **共有が必要なコードは `@shared/*` へ昇格させる**
   現在は `src/components/` / `src/hooks/` / `src/lib/` / `src/store/` / `src/types/` から import してよい（shared 未完のため）
3. **`_deprecated` への依存は禁止**
   新規コードは `@features/_deprecated/*` を参照しない

## 移動時の判断基準

あるコードを shared に昇格させるかどうか:

| 条件 | 判断 |
|---|---|
| 2 つ以上の feature が参照している | shared 昇格 |
| 1 feature だけが参照、他 feature から参照の予定なし | feature 内部に留める |
| グローバル状態（psdStore 等） | shared 昇格（必須） |
| feature 固有の state | feature 内部に留める |
| UI プリミティブ（Badge, Tooltip 等） | shared 昇格 |
| 機能に密結合のパネル・ダイアログ | feature 内部に留める |

## Phase 5 以降の移動ルール

1. **1 コミット = 1 カテゴリ単位**（components/ui/ を丸ごと等）
2. **git mv でリネーム検出を確実に**
3. **import パス書き換えは search/replace で一括**（手動編集で漏れないように）
4. **`.prettierrc` / CRLF/LF の扱い**に注意（git rename 判定に影響）
5. **循環依存チェック**: shared から feature への参照を禁止する
