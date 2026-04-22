# diff-viewer

差分ビューアー（v3.5.0 KENBANから完全移植）。原稿A/Bを tiff-tiff / psd-psd / pdf-pdf / psd-tiff で比較。A/B双方が揃った時のみ読み込み（v3.8.1）。A/B統合（TopNav）と双方向同期。

**関連**: `components/diff-viewer/DiffViewerView.tsx`、`store/diffStore.ts`、Rust: `kenban_*` コマンド（`compute_diff_simple`, `compute_diff_heatmap`, `decode_and_resize_image` 等）。
