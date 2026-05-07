# Tauri アプリ ⇔ UXP プラグイン 連携テンプレート

COMIC-Bridge × リサイくるん の連携実装で確立した、再利用可能なアーキテクチャの完全ガイド。

他のアプリ/プラグイン連携を作る際は、このドキュメントの置換キーワード一覧（§8）に従ってコピー&改名すれば導入可能。

> **🚀 自動起動について**: Photoshop 起動時にプラグインを完全自動展開させる詳細手法は [docs/uxp-auto-launch-guide.md](uxp-auto-launch-guide.md) を参照（4段階フォールバック実装）

---

## 目次

1. [全体像](#1-全体像)
2. [通信プロトコル](#2-通信プロトコルファイルベース)
3. [アプリ側構成](#3-アプリ側の構成-tauri-rust--react)
4. [プラグイン側構成](#4-プラグイン側の構成-uxp)
5. [自動起動の仕組み](#5-自動起動の仕組み2-段階)
6. [自動更新の仕組み](#6-自動更新の仕組み)
7. [エラーハンドリングと診断](#7-エラーハンドリングと診断)
8. [再利用テンプレート](#8-再利用テンプレート他のアプリプラグイン用)
9. [踏んだ罠と回避策](#9-重要な踏んだ罠と回避策)
10. [起動シーケンス完全版](#10-起動シーケンス完全版参考)
11. [動作確認用ツール](#11-動作確認用ツール一覧)
12. [拡張ポイント](#12-拡張ポイント)
13. [ライセンス・運用注意](#13-ライセンス運用注意)

---

## 1. 全体像

**設計思想：「UI＝アプリ／実行＝プラグイン」**

複雑な PSD 操作はプラグイン（Photoshop 内）に任せ、データ収集・設定 UI・進捗監視は Tauri/React アプリで行う。**ファイルベースの非同期メッセージング**で疎結合に連携。

```
┌─────────────────────────────┐         ┌──────────────────────────────┐
│ Tauri/React アプリ           │         │ Photoshop + UXP プラグイン    │
│ (COMIC-Bridge)              │         │ (リサイくるん)                │
│                             │         │                              │
│ ・UI（フォルダ選択・設定）   │         │ ・ジョブ受信ポーリング        │
│ ・ag-psd によるスキャン      │         │ ・PSD バッチ処理              │
│ ・ジョブ送信                 │ ──────> │ ・スタイル保持書き戻し         │
│ ・結果監視                   │ <────── │ ・結果書き出し                │
└─────────────────────────────┘         └──────────────────────────────┘
            │                                          │
            └────── %APPDATA%\<app>\<jobs>\ ──────────┘
                    （ファイル経由メッセージ）
```

---

## 2. 通信プロトコル（ファイルベース）

### ディレクトリ
```
%APPDATA%\<app-name>\<feature>-jobs\
```
本ケース：`%APPDATA%\comic-bridge\recycle-jobs\`

### ファイル種別

| ファイル名 | 書き手 | 読み手 | 用途 |
|---|---|---|---|
| `{jobId}.job.json` | アプリ | プラグイン | ジョブ依頼（設定＋データ） |
| `{jobId}.status.json` | プラグイン | アプリ | 進捗（任意） |
| `{jobId}.result.json` | プラグイン | アプリ | 完了通知 |
| `{jobId}.cancel` | アプリ | プラグイン | 中断要求（空ファイル） |

### `jobId` 形式
```
YYYYMMDD-HHMMSS-{6桁hex}
```
例: `20260428-153045-a1b2c3`

### ジョブ JSON 構造（テンプレート）
```jsonc
{
  "jobId": "...",
  "schemaVersion": 1,
  "createdAt": "ISO8601",
  "scanResult": { /* アプリ側で収集した参照データ */ },
  "settings": { /* UI で決定した設定 */ },
  "perFileOverrides": [ /* 個別ファイル上書き */ ],
  "saveMode": "separate|overwrite",
  "outputPath": null
}
```

### 結果 JSON 構造（テンプレート）
```jsonc
{
  "jobId": "...",
  "completedAt": "ISO8601",
  "status": "success|partial|error|cancelled",
  "filesProcessed": 0,
  "filesErrors": 0,
  "elapsedMs": 0,
  "error": "（エラー時）"
}
```

---

## 3. アプリ側の構成（Tauri/Rust + React）

### Rust コマンド（`<feature>.rs` に集約）

| コマンド | 役割 |
|---|---|
| `write_<feature>_job(job_json)` → `jobId` | ジョブを書き出し |
| `read_<feature>_status(jobId)` → `Option<String>` | 進捗 JSON 読込 |
| `read_<feature>_result(jobId)` → `Option<String>` | 結果 JSON 読込 |
| `cancel_<feature>_job(jobId)` | 中断要求書き出し |
| `cleanup_<feature>_job(jobId)` | 関連ファイル全削除 |
| `launch_photoshop_with_<feature>(jobId)` | Photoshop 起動＋JSX実行 |
| `setup_<feature>_workspace()` | ワークスペース「<NAME>」を作成 |
| `setup_<feature>_startup(enable)` | Script Events Manager 通知登録/解除 |

### 重要な実装パターン

#### A. UTF-8 BOM 必須（日本語パス対応）
```rust
let mut helper_file = fs::File::create(&helper_path)?;
helper_file.write_all(&[0xEF, 0xBB, 0xBF])?;  // BOM
helper_file.write_all(content.as_bytes())?;
```

#### B. JSX 内容を直接埋め込み（`$.evalFile` 回避）
日本語パスを `$.evalFile()` に渡すと「Unknown escape sequence」エラー発生：
```rust
// NG: 日本語パスを ExtendScript に渡す
format!("$.evalFile(\"{}\")", japanese_path)

// OK: JSX 内容を直接埋め込む
format!("var __VAR = \"{}\";\n{}\n", var, fs::read_to_string(&jsx_path)?)
```

#### C. Photoshop パス自動探索
```rust
fn find_photoshop_path() -> Option<String> {
    let candidates = vec![
        r"C:\Program Files\Adobe\Adobe Photoshop 2026\Photoshop.exe",
        r"C:\Program Files\Adobe\Adobe Photoshop 2025\Photoshop.exe",
        // ... バージョン降順
    ];
    candidates.into_iter().find(|p| Path::new(p).exists()).map(String::from)
}
```

### React 側

#### Store（Zustand）
- `phase: "idle" | "submitting" | "running" | "completed" | "error"`
- ジョブ送信 → ポーリング → 結果反映

#### フック
- `use<Feature>Scanner.ts` — ag-psd でフォルダスキャン
- `use<Feature>Job.ts` — ジョブ送信＋ 700ms 間隔の結果ポーリング

```typescript
async function submitJob() {
  const jobId = await invoke("write_<feature>_job", { jobJson: JSON.stringify(job) });
  await invoke("launch_photoshop_with_<feature>", { jobId });
  // 結果ポーリングは useEffect で自動開始
}
```

---

## 4. プラグイン側の構成（UXP）

### manifest.json — 2つのエントリポイント
```jsonc
{
  "manifestVersion": 5,
  "id": "com.example.plugin",
  "version": "1.x.x",
  "entrypoints": [
    { "type": "panel", "id": "mainPanel", "label": { "default": "プラグイン名" } },
    { "type": "command", "id": "execute", "label": { "default": "プラグイン名 実行" } }
  ]
}
```

### index.js — 主要セクション

```javascript
const CURRENT_VERSION = "1.x.x";
const AUTO_UPDATE_MODE = "notify-only";  // "full" | "notify-only" | "off"

// === ファイル I/O（ExtendScript ベース）===
async function getJobsDirPath() { ... }     // 階層的にフォルダ作成
async function listPendingJobs() { ... }    // ジョブ一覧
async function readJobFile(name) { ... }    // ジョブ読込
async function writeResult(jobId, obj) { ... }  // 結果書出

// === ポーリング ===
function startPanelPolling() { ... }        // パネル開時に開始
function pollOnce(verbose) { ... }
async function manualForceCheck() { ... }   // 手動チェックボタン用

// === ジョブハンドラ ===
async function runPendingJob() { ... }
async function handleJob(jobId, fileName) { ... }

// === コア処理（バッチ実行）===
async function processAllFiles(...) { ... } // 大きな executeAsModal

// === 自動更新（モード対応）===
async function checkForUpdates(showMsg) { ... }
function showUpdateNotificationCompact(r) { ... }  // notify-only モード

// === エントリポイント登録 ===
entrypoints.setup({
    commands: { execute: () => runPendingJob() },
    panels: {
        mainPanel: {
            create() { startPanelPolling() },
            show() { startPanelPolling() },
            hide() { stopPanelPolling() }
        }
    }
});

// === 初期化 ===
document.addEventListener("DOMContentLoaded", () => {
    // UI バインド
    // 起動時アップデートチェック
    // 安全策で startPanelPolling()
});
```

### 重要な実装パターン

#### A. シングルクォート文字列で JSON を埋め込む（5C 問題回避）
```javascript
const jsonStr = JSON.stringify(data)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");

const script = `(function(){
    f.writeln('${jsonStr}');  // ← シングルクォート（実証済みパターン）
})();`;
```

#### B. パスは forward slash 統一
```javascript
const path = dir.replace(/\\/g, "/") + "/" + fileName;
```

#### C. UTF-8 ファイル I/O
```javascript
f.encoding = "UTF-8";
f.open("w");
f.writeln(content);
f.close();
```

#### D. 階層フォルダ作成（ExtendScript の制約）
```javascript
// Folder.create() は親フォルダが無いと失敗するため、階層的に
var parent = new Folder(parentDir);
if (!parent.exists) parent.create();
var child = new Folder(parent.fsName + "/child");
if (!child.exists) child.create();
```

---

## 5. 自動起動の仕組み（2 段階）

### Step 1: ワークスペース保存
`setup_workspace.jsx` が以下を実行：
1. パネル展開（runMenuItem 多段試行）
2. ワークスペース「`<ASCII_NAME>`」を `Mk` action で作成
3. `slct` action でアクティブ化

**重要：ワークスペース名は ASCII のみ**（日本語は file lock 問題）

### Step 2: Script Events Manager 登録
`register_startup.jsx` が `app.notifiers.add()` で登録：

```javascript
app.notifiersEnabled = true;
app.notifiers.add(stringIDToTypeID("startApplication"), new File(scriptPath));
```

### 起動時実行スクリプト (`<plugin>_startup.jsx`)
Photoshop 起動時に Adobe が自動実行：

```javascript
$.sleep(5000);  // Photoshop 完全初期化を待つ

// 戦略1: ワークスペース切替（最優先）
try {
    var ref = new ActionReference();
    ref.putName(stringIDToTypeID("workspace"), "WORKSPACE_NAME");
    var desc = new ActionDescriptor();
    desc.putReference(charIDToTypeID("null"), ref);
    executeAction(charIDToTypeID("slct"), desc, DialogModes.NO);
} catch(e) {
    // 戦略2: runMenuItem 直接展開
    app.runMenuItem(stringIDToTypeID("パネル名"));
}
```

**永続パス：** `%APPDATA%\<app>\<plugin>_startup.jsx`（Adobe が記憶）

---

## 6. 自動更新の仕組み

### 3つのモード
```javascript
// "full"        : チェック + ダイアログ + 実行可能
// "notify-only" : チェック + 控えめ表示。実行はブロック
// "off"         : チェックなし
const AUTO_UPDATE_MODE = "notify-only";
```

### 動作
1. 起動時に共有ドライブの `version.json` を取得
2. SemVer 比較
3. 個別ファイル差分チェック
4. モードに応じて通知（モーダル／控えめ／なし）
5. `performUpdate()` でファイルコピー＋`.ccx` インストーラー起動

### 実行ガード（notify-only）
```javascript
async function performUpdate() {
    if (AUTO_UPDATE_MODE === "notify-only") {
        return; // 実行ブロック
    }
    // ... 実際の更新処理
}
```

---

## 7. エラーハンドリングと診断

### 進捗ログ（プログレスファイル）
PSD 処理中の細かな進捗を JSX 内で逐次書き出し：
```javascript
function writeProgressLog(message) {
    var logFile = new File(Folder.appData.fsName + "/<app>/<jobs>/_progress.log");
    logFile.encoding = "UTF-8";
    if (logFile.open("a")) {
        logFile.writeln(new Date().toLocaleTimeString() + " " + message);
        logFile.close();
    }
}
```

### 診断ボタン（パネル UI）
- 「ジョブを今すぐチェック」: 即時 `pollOnce(verbose)` 実行
- 出力例：
  ```
  監視先: C:/Users/.../comic-bridge/recycle-jobs
  ジョブ検索結果: 1件
  発見ジョブ: 20260428-...job.json
  ```

### クリーンアップスクリプト
`cleanup_<feature>.jsx`：
1. `app.notifiers.removeAll()` — 通知全削除
2. ワークスペース削除（Dlt action）
3. 結果アラート表示

---

## 8. 再利用テンプレート（他のアプリ/プラグイン用）

### ファイル一覧
他の連携を作る際は以下を**コピー＆置換**：

| アプリ側 | ファイル |
|---|---|
| Rust commands | `<feature>.rs`（`recycle.rs` をベース） |
| React store | `<feature>Store.ts` |
| React hooks | `use<Feature>Job.ts`, `use<Feature>Scanner.ts` |
| React view | `<Feature>View.tsx` |
| JSX helpers | `bridge_invoke_command.jsx`, `setup_workspace.jsx`, `register_startup.jsx`, `<feature>_startup.jsx`, `cleanup_<feature>.jsx` |

| プラグイン側 | ファイル |
|---|---|
| manifest | `manifest.json` |
| HTML | `index.html` |
| Logic | `index.js` |
| Style | `styles.css` |

### 置換キーワード
```
{APP_NAME}        : "comic-bridge"
{FEATURE_NAME}    : "recycle"
{WORKSPACE_NAME}  : "CB_Recycle"  ← ASCII 必須
{PANEL_LABEL}     : "リサイくるん (CB連携)"  ← 日本語OK
{COMMAND_LABEL}   : "リサイくるん 実行 (CB)"
{PLUGIN_ID}       : "com.example.plugin"
{ENTRYPOINT_ID}   : "mainPanel"
{COMMAND_ID}      : "execute"
{UPDATE_SOURCE}   : "G:\\..."  ← 共有ドライブパス
```

### 流用時のチェックリスト
- [ ] manifest.json の id, name, version を変更
- [ ] entrypoint.id（panel + command）を 2 つ定義
- [ ] ワークスペース名は ASCII のみ
- [ ] ジョブディレクトリ名を `<feature>-jobs` に
- [ ] Rust commands 全 8 個を実装
- [ ] React feature フォルダ作成（store/hooks/components）
- [ ] viewStore に AppView の値を追加
- [ ] settingsStore の ALL_NAV_BUTTONS に登録
- [ ] tauri.conf.json の resources に scripts 追加
- [ ] UTF-8 BOM、forward slash、シングルクォート JSON のパターン遵守

---

## 9. 重要な「踏んだ罠」と回避策

| 問題 | 原因 | 回避策 |
|---|---|---|
| 「Unknown escape sequence (\プ)」 | 日本語パス + `$.evalFile` | JSX 内容を直接埋め込み + UTF-8 BOM |
| 「ワークスペース ファイルが使用中」 | 日本語ワークスペース名で file lock | ASCII 名のみ使用 |
| 「ジョブフォルダが存在しません」 | `Folder.create()` は再帰作成しない | 親フォルダから順次作成 |
| 「処理中のまま」 | プラグインが job.json を見つけられない | 「手動チェック」ボタン + 詳細ログ |
| 「Photoshop 起動時に開かない」 | UXP プラグインの遅延読込 | Script Events Manager + 5 秒待機 |
| 「不明メニュー項目が現在使用できません」 | UXP プラグイン未ロード時 runMenuItem | `app.displayDialogs = NO` で抑制 |
| 5 個以上のジョブが残留 | 中断/失敗時の `.cancel` 残留 | クリーンアップスクリプト |

---

## 10. 起動シーケンス（完全版・参考）

```
[アプリ:実行ボタン]
       ↓
[Rust] write_<feature>_job → ジョブJSON書出
       ↓
[Rust] launch_photoshop_with_<feature>
       ├─ bridge_invoke_command.jsx の内容を読込
       ├─ ジョブIDを変数として埋込
       ├─ UTF-8 BOM付きヘルパーを %TEMP% に書出
       └─ Photoshop.exe -r helper.jsx で起動
       ↓
[Photoshop 起動 or 既存]
       ↓
[Photoshop] startApplication notifier 発火
       ↓
[<feature>_startup.jsx] 自動実行
       ├─ $.sleep(5000) で初期化待ち
       ├─ ワークスペース切替 (slct)
       └─ 失敗時は runMenuItem 多段試行
       ↓
[UXP] パネル展開 → プラグインロード
       ↓
[Plugin] entrypoints.setup({ panels.create }) 発火
       ├─ startPanelPolling() 開始
       ├─ DOMContentLoaded → UI 初期化
       └─ 200ms 後に即時ポーリング1回
       ↓
[Plugin] listPendingJobs → ジョブJSON 検出
       ↓
[Plugin] handleJob → readJobFile → buildOptions
       ↓
[Plugin] processAllFiles → executeAsModal
       ├─ 全 PSD を順次 open → 処理 → save → close
       ├─ 進捗を _progress.log に書出
       └─ 結果を `DONE|N|E|S|...` 形式で返却
       ↓
[Plugin] writeResult → result.json 書出
       ↓
[アプリ] read_<feature>_result でポーリング検知
       ↓
[React] phase = "completed" → UI 更新
       ↓
[アプリ] cleanup_<feature>_job で関連ファイル削除
```

---

## 11. 動作確認用ツール一覧

| ツール | 用途 | 配置 |
|---|---|---|
| `test_<feature>_panel.jsx` | パネル展開方式の診断 | scripts/ |
| `cleanup_<feature>.jsx` | 全リセット | scripts/ |
| 「ジョブを今すぐチェック」ボタン | 手動ポーリング | プラグインパネル |
| `_progress.log` ファイル | 処理経過の詳細 | `%APPDATA%\<app>\<jobs>\` |
| プラグインパネルのログ表示 | リアルタイム動作確認 | パネル下部 |

---

## 12. 拡張ポイント

将来の拡張時のヒント：

| 拡張 | 方針 |
|---|---|
| 双方向通信を増やす | ジョブJSONに `responseRequired` フィールド追加 |
| 複数同時ジョブ | ファイル名に jobId 含めて並列処理（要排他制御） |
| 進捗詳細表示 | プラグインで `status.json` を 1 ファイル毎に書出 |
| ジョブキュー | ディレクトリ内の全 `.job.json` を順次処理 |
| 別 OS 対応 | パス区切り、APPDATA → `~/.config` 等の対応 |

---

## 13. ライセンス・運用注意

- **共有ドライブ依存**：自動更新ソースが G:\ にあるため、ネットワーク切断時はチェック失敗（フォールバック動作必要）
- **Photoshop バージョン**：UXP は Photoshop 2022（v23）以降
- **manifest 変更時**：CCX 再インストール必須（hot reload は UXP Developer Tool 経由のみ）
- **ワークスペース命名**：ASCII 限定。既存ワークスペースを上書きする可能性あり

---

## 参考実装

このテンプレートに完全準拠した実装は以下：

| 役割 | 実装場所 |
|---|---|
| Rust commands | [src-tauri/src/recycle.rs](../src-tauri/src/recycle.rs) |
| React feature | [src/features/recycle/](../src/features/recycle/) |
| JSX scripts | [src-tauri/scripts/](../src-tauri/scripts/) — `bridge_invoke_command.jsx`, `setup_workspace.jsx`, `register_startup.jsx`, `cb_recycle_startup.jsx`, `cleanup_recycle.jsx`, `test_recycle_panel.jsx` |
| プラグイン | `C:\Users\yamamoto-ryusei\Documents\6_スクリプト\プラグインデータ\リサイクるん_プラグイン化試作 - コピー (3)\` |

新しい連携を作る際は、これらのファイルをコピー＆置換キーワード（§8）に従って改名するのが最速です。
