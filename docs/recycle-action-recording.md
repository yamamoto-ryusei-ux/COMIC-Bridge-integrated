# リサイくるん セットアップガイド（v1.2.0 — コマンド駆動版）

COMIC-Bridge から Photoshop の UXP プラグインを実行する仕組み。

**v1.2.0 で大幅刷新**: アクション録画・ポーリング・パネル自動展開はすべて廃止。プラグインの **command エントリポイント** を直接呼び出す方式に変更。

---

## v1.2.0 の動作モデル

### 全体像
```
[アプリ:実行ボタン]
   ↓ jobs/{jobId}.job.json を書き出し
[アプリ → Photoshop 起動]
   ↓ -r bridge_invoke_command.jsx を引数で渡す
[Photoshop が JSX 実行]
   ↓ app.runMenuItem(stringIDToTypeID("リサイくるん 実行 (CB)"))
[UXP プラグインの command ハンドラが起動]
   ↓ entrypoints.setup({ commands: { cbRecycleExecute: ... }})
[runPendingJob() が呼ばれる]
   ↓ jobs/最新.job.json を読み込み
[processAllFiles() で一括処理]
   ↓ result.json を書き出し
[アプリが result.json を読み取り]
   ↓ UI に結果表示
```

### 廃止された要素
- ❌ `.atn` アクションファイル（不要）
- ❌ アクション録画手順（不要）
- ❌ プラグインのジョブポーリング（不要）
- ❌ パネル自動展開（不要、コマンドが直接呼べるため）
- ❌ セットアップマーカー / バナー（不要）

### 必要なもの
- ✅ Photoshop 2022以降がインストール済み
- ✅ リサイくるんプラグイン v1.2.0 が Photoshop に登録済み

それだけ。

---

## セットアップ手順

### 1. プラグインのインストール（初回のみ）

**v1.1.0 以前を入れている場合は先にアンインストール**してください。コマンドエントリポイントが追加されているため再インストールが必要です。

#### CCX パッケージから
```
1. C:\Users\yamamoto-ryusei\Documents\6_スクリプト\プラグインデータ\
   リサイクるん_プラグイン化試作 - コピー (3)\
   をフォルダごと ZIP 圧縮

2. 拡張子を .zip → .ccx に変更

3. .ccx をダブルクリック → Adobe インストーラーが起動

4. 「インストール」をクリック → 完了
```

#### 確認
Photoshop を起動して以下を確認：
- **ウィンドウ > エクステンション > リサイくるん (CB連携)** がある（パネル）
- **プラグイン > リサイくるん (CB連携) > リサイくるん 実行 (CB)** がある（コマンド）

両方が表示されていれば OK。

### 2. アプリで使う

それだけです。COMIC-Bridge のリサイくるんビューで「実行」ボタンを押せば自動的に動作します。

---

## 動作確認スクリプト

うまく動かない場合：

1. Photoshop を起動
2. **ファイル > スクリプト > 参照…**
3. 以下を実行:
   ```
   COMIC-Bridge_統合版/src-tauri/scripts/test_recycle_panel.jsx
   ```
4. ダイアログで結果を確認

このスクリプトは複数の方式で「リサイくるん」を呼び出そうとして、どれが動作するかレポートします。

### 期待される結果
```
[1] stringIDToTypeID + runMenuItem:
  ✓ 'リサイくるん 実行 (CB)' → ID:xxxx 成功 ← v1.2.0 の正規ルート
  または
  ✓ 'リサイくるん (CB連携)' → ID:xxxx 成功  ← パネル展開フォールバック
```

---

## トラブルシューティング

### 実行ボタンを押しても何も起きない

1. **アプリのコンソールログを確認**: `Ctrl+Shift+I` → Console
2. `[recycle] Photoshop:` のログを確認
   - 想定外のパス・"not found" → Photoshop が見つからない（[recycle.rs](../src-tauri/src/recycle.rs) の `find_photoshop_path()` を確認）

### Photoshop は起動するがコマンドが見つからない

`bridge_invoke_command.jsx` のフォールバック動作：
1. コマンド `リサイくるん 実行 (CB)` を試す
2. なければ `cbRecycleExecute`（command id）を試す
3. なければ `com.risaikurun.plugin.cbRecycleExecute` を試す
4. 全て失敗 → パネル `リサイくるん (CB連携)` を開く（旧版プラグイン互換）
5. 全て失敗 → ユーザー誘導アラート

3 まで到達した場合 = **プラグインが古い** か **インストールに失敗**。CCX 再インストールを推奨。

### ジョブを送信しても結果が返らない（タイムアウト）

考えられる原因：
1. プラグインのコマンドハンドラ内でエラーが発生（パネルを開いてログを確認）
2. `processAllFiles` 実行中にフリーズ（フォント不在ダイアログ等）
3. `result.json` の書き込みに失敗

**対処**: パネルを開いてログを見る。プラグインのログには `[bridge]` プレフィックスが付く。

### 「コマンドが見つかりません」アラートが出る

= プラグインに command エントリポイントが登録されていない（v1.1.0 以前）

**対処**: v1.2.0 にプラグインを更新。または以下を確認：
- `manifest.json` の `entrypoints` に `{ "type": "command", "id": "cbRecycleExecute", ... }` がある
- Photoshop の **プラグイン** メニュー配下に「リサイくるん 実行 (CB)」が表示される

---

## 旧版（v1.1.0）との違い

| | v1.1.0 | v1.2.0 |
|---|---|---|
| **プラグイン起動** | パネル展開必須 | パネル不要 |
| **ジョブ検知** | 500ms 間隔のポーリング | コマンド呼出 |
| **アクション (`.atn`)** | フォールバック用 | 不要 |
| **CPU 負荷（待機時）** | 常時ポーリング | ゼロ |
| **応答速度** | 最大 500ms 遅延 | 即時 |
| **セットアップ** | 初回マーカー記録必要 | 不要 |
| **manifest** | `entrypoints[panel]` | `entrypoints[panel, command]` |

旧版マーカーは `%APPDATA%\comic-bridge\recycle-setup.json` に残るが、v1.2.0 では参照されない（情報として残置）。

---

## 開発者向け: 内部仕様

### 主要ファイル

#### アプリ側
- [src-tauri/src/recycle.rs](../src-tauri/src/recycle.rs) — Rust コマンド群
  - `launch_photoshop_with_recycle` — `bridge_invoke_command.jsx` を Photoshop で起動
  - `write_recycle_job` — ジョブJSON書出
  - `read_recycle_result` — 結果JSON読込
  - `cleanup_recycle_job` — 関連ファイル全削除
- [src-tauri/scripts/bridge_invoke_command.jsx](../src-tauri/scripts/bridge_invoke_command.jsx) — Photoshop 起動時に実行される JSX
- [src/features/recycle/useRecycleJob.ts](../src/features/recycle/useRecycleJob.ts) — ジョブ送信＋結果待ちフック

#### プラグイン側
- `index.js` — `entrypoints.setup({ commands: { cbRecycleExecute: ... }})` で登録
- `manifest.json` — `entrypoints` に `command` 追加

### コマンドラベルの解決

`stringIDToTypeID(label)` で UXP コマンドの menuID が取得できる。ラベル文字列は `manifest.json` の `entrypoints[].label.default` がそのまま使われる。

```javascript
// bridge_invoke_command.jsx
var menuId = stringIDToTypeID("リサイくるん 実行 (CB)");
app.runMenuItem(menuId); // コマンドハンドラ起動
```

### コマンドハンドラの実装

```javascript
// index.js
const { entrypoints } = require("uxp");

entrypoints.setup({
    commands: {
        cbRecycleExecute: async () => {
            await runPendingJob(); // jobs ディレクトリの最新を処理
        }
    },
    panels: { /* パネル定義 */ }
});
```

### 旧コマンドの扱い

Rust 側の `run_recycle_setup` / `get_recycle_setup_status` は残しているが、UI からは呼ばれない。互換性のため・将来の診断用途のため温存。
