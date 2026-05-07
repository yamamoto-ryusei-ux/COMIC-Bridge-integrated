# Recycle (リサイくるん連携)

COMIC-Bridge から Photoshop の UXP プラグイン「リサイくるん (CB連携版)」へジョブを送信して、テキストレイヤーの一括処理を実行する機能。

> **🔄 再利用テンプレート**: この feature の実装パターンは [docs/plugin-app-integration-template.md](../../../docs/plugin-app-integration-template.md) に汎用化されています。他のアプリ/プラグイン連携を作る際はこちらを参照してください。
>
> **🚀 自動起動詳細**: Photoshop 起動時の完全自動展開手法（PowerShell COM Automation など）は [docs/uxp-auto-launch-guide.md](../../../docs/uxp-auto-launch-guide.md) を参照。

## 設計

**「UI = アプリ / 実行 = UXP プラグイン」** の役割分担：

- アプリ側（このフォルダ）：フォルダ選択・スキャン・設定UI・ジョブ送信・結果表示
- プラグイン側（[リサイクるん_プラグイン化試作 - コピー (3)/](../../../../../プラグインデータ/リサイクるん_プラグイン化試作%20-%20コピー%20(3)/)）：ジョブJSON受信 → Photoshopで一括処理 → 結果書出

通信プロトコル詳細: 上記プラグインフォルダ内の `JOB_SCHEMA.md`。

## 起動フロー

1. ユーザーが「実行」ボタンを押す
2. アプリがジョブJSONを `%APPDATA%/comic-bridge/recycle-jobs/{jobId}.job.json` に書出
3. アプリが Photoshop を `bridge_open_panel.jsx` 付きで起動
4. JSXが同梱の `.atn` アクションを再生 → 「ウィンドウ > エクステンション > リサイくるん (CB連携)」が開く
5. プラグインが jobs ディレクトリをポーリング → 新ジョブを検知 → 実行
6. アプリは 700ms 間隔で `{jobId}.status.json` / `{jobId}.result.json` を監視
7. 結果取得後にアプリ UI に反映

## ファイル構成

```
src/features/recycle/
  RecycleView.tsx              ... トップビュー（フォルダ選択 + 2カラム + 実行ボタン）
  recycleTypes.ts              ... ジョブJSON型定義（プラグインの JOB_SCHEMA.md 準拠）
  recycleStore.ts              ... Zustand ストア
  useRecycleScanner.ts         ... ag-psd でのフォルダスキャン
  useRecycleJob.ts             ... ジョブ送信＋結果ポーリング
  components/
    RecycleSettingsPanel.tsx   ... 3タブ設定UI（最適化/整形/その他）
    RecycleScanList.tsx        ... スキャン結果リスト（フィルタ付き）
    RecycleStatusCard.tsx      ... 実行ステータスバッジ
```

## Rust コマンド

[src-tauri/src/recycle.rs](../../../src-tauri/src/recycle.rs) に集約：

- `write_recycle_job(job_json) -> jobId` ... ジョブJSONを書き出してIDを返す
- `read_recycle_status(jobId) -> Option<String>` ... 進捗JSON読込
- `read_recycle_result(jobId) -> Option<String>` ... 結果JSON読込
- `cancel_recycle_job(jobId)` ... 中断要求（空ファイル作成）
- `cleanup_recycle_job(jobId)` ... 関連ファイル全削除
- `cleanup_old_recycle_jobs(max_age_secs)` ... 古いジョブファイル一掃
- `launch_photoshop_with_recycle(jobId)` ... Ps起動 + bridge_open_panel.jsx
- `is_photoshop_running() -> bool` ... Psプロセス検出

## 段階開発の状況

- [x] **Phase 1**: プラグイン側ジョブ受信エンジン
- [x] **Phase 2**: アプリ側 Rust コマンド + 雛形UI
- [ ] **Phase 3**: ag-psd 詳細スキャン拡張（白フチ・色・boundingBox）
- [ ] **Phase 4**: 設定UIの完全再現
- [ ] **Phase 5**: 個別変更予約UIの実装
- [ ] **Phase 6**: 一気通貫実行テスト
- [ ] **Phase 7**: JSONプリセット読込（共有ドライブ）
- [ ] **Phase 8**: 仕上げ・テスト

## 初回セットアップ（運用者用）

`.atn` アクションファイルの作成手順は [docs/recycle-action-recording.md](../../../docs/recycle-action-recording.md) を参照。
