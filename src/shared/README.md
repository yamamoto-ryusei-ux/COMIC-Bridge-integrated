# shared

複数feature から参照される横断コード。

- `components/ui/` — Badge, GlowCard, Modal, PopButton, ProgressBar, SpeechBubble, Tooltip
- `components/layout/` — AppLayout, TopNav, GlobalAddressBar, ViewRouter, WorkflowBar, SettingsPanel
- `components/file-browser/` — FileBrowser, FileList, DropZone
- `components/common/` — FileContextMenu, CompactFileList, DetailSlidePanel, TextExtractButton, ErrorBoundary
- `hooks/` — useAppUpdater, useGlobalDragDrop, useHandoff, useFileWatcher, useOpenFolder, useOpenInPhotoshop, usePsdLoader, useTextExtract, useFontResolver 等
- `stores/` — viewStore, settingsStore, workflowStore, fontBookStore 等（機能横断ストア）
- `lib/` — naturalSort, paperSize, textUtils, agPsdScanner, layerTreeOps, layerMatcher, psd/parser, psdLoaderRegistry
- `types/` — index.ts（PsdFile, LayerNode 等のコア型）

**import 規約**: feature間の直接参照は禁止。共有コードはここに集約し、`@shared/*` alias で参照する。
