# UXP プラグイン 自動起動 完全ガイド

Photoshop の UXP プラグインを **完全自動でパネル展開** させる手法のリファレンス。

リサイくるん（CB連携版）連携で確立し、動作確認済みの構成。

---

## 目次

1. [背景：UXP の制約](#1-背景uxp-の制約)
2. [採用した4段階アプローチ](#2-採用した4段階アプローチ)
3. [各レイヤーの実装詳細](#3-各レイヤーの実装詳細)
4. [動作シーケンス](#4-動作シーケンス完全版)
5. [セットアップ手順（ユーザー向け）](#5-セットアップ手順ユーザー向け)
6. [ファイル一覧](#6-ファイル一覧)
7. [踏んだ罠と回避策](#7-踏んだ罠と回避策)
8. [他のプラグインへの流用方法](#8-他のプラグインへの流用方法)
9. [診断とトラブルシューティング](#9-診断とトラブルシューティング)

---

## 1. 背景：UXP の制約

### Adobe の仕様
UXP プラグインは **遅延読込（lazy-load）** 設計：

```
Photoshop 起動
  ↓
UXP プラグインは「登録のみ」状態
  - メニュー項目は表示される
  - ロードはされていない
  ↓
ユーザーが手動でメニューをクリック
  ↓
初めて UXP プラグインがロード
```

これにより以下が困難：
- ❌ JSX `app.runMenuItem` で確実に開く
- ❌ Action Manager `select menuItemType` で確実に開く
- ❌ `entrypoints.activatePanel`（UXP 内部からしか呼べない）

### 突破口：Photoshop COM Automation
**`New-Object -ComObject Photoshop.Application`** は Photoshop に同期的に接続し、**完全初期化完了を保証**します。

これと **UI Automation API** を組み合わせることで、UXP の lazy load を実質的に回避できます。

---

## 2. 採用した4段階アプローチ

```
┌─────────────────────────────────────────────────┐
│ Layer 1: Photoshop Script Events Manager         │
│   起動時に startApplication 通知                 │
│   → cb_recycle_startup.jsx 自動実行              │
├─────────────────────────────────────────────────┤
│ Layer 2: JSX 内で動的プロービング                │
│   app.fonts.length で Photoshop 起動完了検知     │
│   → ワークスペース切替試行                       │
│   → runMenuItem 試行                             │
├─────────────────────────────────────────────────┤
│ Layer 3: PowerShell 起動（JSX から起動）         │
│   app.system() で powershell.exe をバックグラウンド│
│   → open_recycle_panel.ps1 実行                  │
├─────────────────────────────────────────────────┤
│ Layer 4: PowerShell COM + UIA + SendKeys（最強）│
│   New-Object -ComObject Photoshop.Application    │
│   → COM 経由で JSX 15 回多段実行                  │
│   → UIA でメニューツリー操作（フォールバック）     │
│   → SendKeys でキーボード入力（最終手段）         │
└─────────────────────────────────────────────────┘
```

各レイヤーが互いを補完し、**最終的に COM Automation がほぼ確実にパネルを開きます**。

---

## 3. 各レイヤーの実装詳細

### Layer 1: Script Events Manager 登録

`register_startup.jsx` で `app.notifiers.add()` を実行：

```javascript
app.notifiersEnabled = true;
app.notifiers.add(
    stringIDToTypeID("startApplication"),
    new File("%APPDATA%/comic-bridge/cb_recycle_startup.jsx")
);
```

これにより Photoshop 起動時に `cb_recycle_startup.jsx` が自動実行されます。

### Layer 2: 動的プロービング JSX

`cb_recycle_startup.jsx`：

```javascript
// Photoshop 起動完了を動的検出（最大 90 秒）
for (var probe = 0; probe < 90; probe++) {
    try {
        if (app.fonts.length > 0) break;  // 起動完了
    } catch (e) {}
    $.sleep(1000);
}

// UXP 読込待機
$.sleep(5000);

// ワークスペース切替（成功率高い）
try {
    var ref = new ActionReference();
    ref.putName(stringIDToTypeID("workspace"), "CB_Recycle");
    var desc = new ActionDescriptor();
    desc.putReference(charIDToTypeID("null"), ref);
    executeAction(charIDToTypeID("slct"), desc, DialogModes.NO);
} catch (e) {}

// 直接 menuItem も試行
for (var i = 0; i < 8; i++) {
    var labels = ["リサイくるん (CB連携)", "リサイくるん", ...];
    try { app.runMenuItem(stringIDToTypeID(labels[i])); } catch(e) {}
}
```

### Layer 3: PowerShell 起動

JSX から `app.system()` で PowerShell をバックグラウンド起動：

```javascript
var psPath = $.getenv("APPDATA") + "/comic-bridge/open_recycle_panel.ps1";
var cmd = 'start /B powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + psPath + '"';
app.system(cmd);
```

### Layer 4: PowerShell COM Automation （**核心部分**）

`open_recycle_panel.ps1` の核心：

```powershell
# Step 1: Photoshop に COM 接続（完全初期化を保証）
$ps = New-Object -ComObject Photoshop.Application
$ps.Visible = $true
$ps.BringToFront()
Start-Sleep -Seconds 3

# Step 2: JSX を多段実行（UXP lazy load を緩和）
$jsxScript = @'
(function() {
    var labels = ["リサイくるん (CB連携)", "リサイくるん", ...];
    // ワークスペース切替
    try {
        var ref = new ActionReference();
        ref.putName(stringIDToTypeID("workspace"), "CB_Recycle");
        var desc = new ActionDescriptor();
        desc.putReference(charIDToTypeID("null"), ref);
        executeAction(charIDToTypeID("slct"), desc, DialogModes.NO);
    } catch(e) {}
    // runMenuItem + select menuItemType を全候補で実行
    for (var i = 0; i < labels.length; i++) {
        try { app.runMenuItem(stringIDToTypeID(labels[i])); } catch(e) {}
        try {
            var ref2 = new ActionReference();
            ref2.putName(stringIDToTypeID("menuItemType"), labels[i]);
            var desc2 = new ActionDescriptor();
            desc2.putReference(charIDToTypeID("null"), ref2);
            executeAction(charIDToTypeID("slct"), desc2, DialogModes.NO);
        } catch(e) {}
    }
})();
'@

# 15 回連続実行（2 秒間隔）
for ($i = 1; $i -le 15; $i++) {
    $ps.DoJavaScript($jsxScript, $null, 2)  # 2 = NeverShowDebugger
    Start-Sleep -Seconds 2
}

# Step 3: UI Automation フォールバック
# メニューバー → ウィンドウ → エクステンション → 該当パネル を Invoke
```

**なぜこれが効くのか**：

1. `New-Object -ComObject Photoshop.Application` が Photoshop の COM サーバーを呼び出し、**「JSX を受け付けられる状態」になるまで同期的に待機**
2. UXP プラグインが未ロードでも、COM を通じた `DoJavaScript` 呼び出しが**繰り返し実行**されることで、Photoshop が UXP をロードするタイミングを捕まえる
3. ロードされた瞬間に `runMenuItem` が成功 → パネル展開

---

## 4. 動作シーケンス（完全版）

```
[ユーザー] Photoshop を起動（または COMIC-Bridge から実行）
       ↓
[Photoshop] 起動処理開始
       ↓
[Photoshop] startApplication イベント発火
       ↓
[ScriptEvents] cb_recycle_startup.jsx を自動実行
       ↓
[JSX Phase 1] app.fonts.length で起動完了を動的待機（最大90秒）
       ↓
[JSX Phase 2] $.sleep(5000) で UXP 読込待機
       ↓
[JSX Phase 3] ワークスペース切替 + runMenuItem 多段試行
       ↓
[JSX Phase 4] PowerShell バックグラウンド起動
              app.system("start /B powershell.exe ... open_recycle_panel.ps1")
       ↓
[PowerShell Layer 4] 別プロセスで実行開始
       ├─ COM 接続: New-Object -ComObject Photoshop.Application
       ├─ Photoshop を前面化
       ├─ DoJavaScript で JSX を 15 回多段実行
       └─ UIA でメニュー直接操作（COM 失敗時）
       ↓
[Photoshop] UXP プラグインがロード
       ↓
[UXP Plugin] entrypoints.setup() の panels.create が発火
       ↓
[UXP Plugin] startPanelPolling() でジョブ監視開始
       ↓
[完了] パネルが画面に表示され、ジョブを処理可能
```

実測時間：**通常 30 秒〜90 秒**（Photoshop 起動時間に依存）

---

## 5. セットアップ手順（ユーザー向け）

### 初回 1 回だけ必要

#### Step 1: 既存設定をクリーンアップ
Photoshop で **ファイル > スクリプト > 参照…** から `cleanup_recycle.jsx` を実行。

#### Step 2: プラグインを手動で開く（重要・1 回だけ）
**ウィンドウ > エクステンション > リサイくるん (CB連携)** を手動でクリック。

UXP の仕様により、初回は手動ロードが必要です。

#### Step 3: アプリで設定を保存
1. COMIC-Bridge → リサイくるん画面
2. **「ワークスペース保存」** ボタン
3. **「起動時自動展開を登録」** ボタン

これで以下が完了：
- ワークスペース「CB_Recycle」が作成
- `app.notifiers` に startApplication 通知が登録
- `cb_recycle_startup.jsx` が `%APPDATA%\comic-bridge\` に配置
- `open_recycle_panel.ps1` が `%APPDATA%\comic-bridge\` に配置

### 以降の Photoshop 起動

何もしなくても、Photoshop 起動 → 30〜90 秒 → パネル自動展開。

### 動かなくなった場合の最終手段

アプリの **「🔧 PowerShell COMでパネルを強制起動」** ボタンを押す。
Photoshop が起動済みなら数秒で展開。

---

## 6. ファイル一覧

### アプリ側（Tauri/Rust + React）

| ファイル | 役割 |
|---|---|
| `src-tauri/src/recycle.rs` | Rust コマンド群（write_recycle_job, setup_recycle_workspace, setup_recycle_startup, force_open_recycle_panel など） |
| `src-tauri/scripts/cb_recycle_startup.jsx` | Photoshop 起動時実行スクリプト（Layer 1-3） |
| `src-tauri/scripts/bridge_invoke_command.jsx` | アプリの「実行」ボタン経由の起動スクリプト |
| **`src-tauri/scripts/open_recycle_panel.ps1`** | **PowerShell COM Automation スクリプト（Layer 4・核心）** |
| `src-tauri/scripts/setup_workspace.jsx` | ワークスペース「CB_Recycle」を作成 |
| `src-tauri/scripts/register_startup.jsx` | Script Events Manager 通知登録/解除 |
| `src-tauri/scripts/cleanup_recycle.jsx` | 全リセット |
| `src-tauri/scripts/test_recycle_panel.jsx` | 診断用 |
| `src/features/recycle/RecycleView.tsx` | UI（セットアップボタン群） |
| `src/features/recycle/useRecycleJob.ts` | ジョブ送信＋結果ポーリング |
| `src/features/recycle/recycleStore.ts` | Zustand 状態管理 |

### プラグイン側（UXP）

| ファイル | 役割 |
|---|---|
| `manifest.json` | UXP 定義（panel + command の 2 エントリ） |
| `index.html` | パネル UI（最小限） |
| `index.js` | ジョブポーリング＋processAllFiles＋自動更新 |
| `styles.css` | スタイル |

### 永続配置場所

| パス | 内容 |
|---|---|
| `%APPDATA%\comic-bridge\cb_recycle_startup.jsx` | Photoshop が startApplication で参照 |
| `%APPDATA%\comic-bridge\open_recycle_panel.ps1` | JSX/UI から呼び出される PowerShell |
| `%APPDATA%\comic-bridge\_startup.log` | JSX 動作ログ |
| `%APPDATA%\comic-bridge\_uia_open.log` | PowerShell 動作ログ |
| `%APPDATA%\comic-bridge\recycle-jobs\` | ジョブファイル通信ディレクトリ |

---

## 7. 踏んだ罠と回避策

| 罠 | 原因 | 回避策 |
|---|---|---|
| 「Unknown escape sequence (\プ)」 | `$.evalFile` に日本語パスを渡した | JSX 内容を直接埋め込み + UTF-8 BOM |
| 「ワークスペース ファイルが使用中」 | 日本語ワークスペース名で file lock | ASCII 名「CB_Recycle」のみ使用 |
| 「ジョブフォルダが存在しません」 | `Folder.create()` は再帰作成しない | 親フォルダから順次作成 |
| 「処理中のまま」 | プラグインが job.json を見つけられない | 「ジョブを今すぐチェック」ボタン + 詳細ログ |
| 「Photoshop 起動時に開かない」（初期版） | UXP 遅延読込 + 固定 5 秒待機不足 | 動的プロービング（最大 90 秒）+ COM Automation |
| 「不明メニュー項目が現在使用できません」 | UXP 未ロード時 runMenuItem | `app.displayDialogs = NO` で抑制 |
| `runMenuItem` が静かに失敗 | UXP 仕様 | **PowerShell COM Automation** で強制ロード |
| 30 秒以上の起動時間でタイムアウト | 固定 sleep | 動的プロービング |

---

## 8. 他のプラグインへの流用方法

### 置換キーワード一覧

| 旧 | 新（例） |
|---|---|
| `comic-bridge` | `your-app-name` |
| `recycle` | `your-feature-name` |
| `CB_Recycle` | `YourPanel`（ASCII 必須） |
| `リサイくるん (CB連携)` | `あなたのプラグイン` |
| `com.risaikurun.plugin` | `com.example.plugin` |
| `cbRecycleExecute` | `yourCommandId` |
| `mainPanel` | `yourPanelId` |

### コピー元 → コピー先 の対応

```
src-tauri/scripts/cb_recycle_startup.jsx
  → src-tauri/scripts/your_plugin_startup.jsx
  
src-tauri/scripts/open_recycle_panel.ps1
  → src-tauri/scripts/open_your_panel.ps1
  
src-tauri/scripts/setup_workspace.jsx
  → src-tauri/scripts/setup_your_workspace.jsx

src-tauri/scripts/register_startup.jsx
  → そのまま流用可能（パスのみ可変）

src-tauri/scripts/cleanup_recycle.jsx
  → src-tauri/scripts/cleanup_your.jsx

src-tauri/src/recycle.rs
  → src-tauri/src/your_feature.rs

src/features/recycle/
  → src/features/your_feature/
```

### 各スクリプト内の置換項目

#### `your_plugin_startup.jsx`
```javascript
var WORKSPACE_NAME = "YourPanel";  // ← 変更
var ALL_LABELS = [
    "あなたのプラグインのラベル",  // ← 変更
    // ...
];
```

#### `open_your_panel.ps1`
```powershell
$jsxScript = @'
var labels = [
    "あなたのプラグインのラベル",  // ← 変更
    // ...
];
'@
$workspaceCandidates = @("ウィンドウ(W)", "Window(W)", ...)  // 変更不要
$panelCandidates = @("あなたのプラグイン")  // ← 変更
```

#### `your_feature.rs`
```rust
// recycle → your_feature にリネーム
// jobs ディレクトリ名: "recycle-jobs" → "your-feature-jobs"
// ワークスペース名: "CB_Recycle" → "YourPanel"
```

### 流用時のチェックリスト

- [ ] manifest.json の `id`, `name`, `version`, `entrypoints[].id`, `entrypoints[].label.default` を変更
- [ ] entrypoint は `panel` + `command` の 2 つを定義
- [ ] ワークスペース名は ASCII のみ
- [ ] ジョブディレクトリ名を `your-feature-jobs` に
- [ ] Rust commands のプレフィックスを変更
- [ ] React feature フォルダ作成（store/hooks/components）
- [ ] viewStore に AppView 追加
- [ ] settingsStore の ALL_NAV_BUTTONS に登録
- [ ] tauri.conf.json の resources に scripts 追加
- [ ] PowerShell スクリプトの permanent path を変更（`%APPDATA%\your-app\`）
- [ ] UTF-8 BOM、forward slash、シングルクォート JSON のパターン遵守

---

## 9. 診断とトラブルシューティング

### 動作ログの確認

#### `%APPDATA%\comic-bridge\_startup.log`
JSX (Layer 1-3) の動作記録：
```
2026/04/28 12:34:56  ===== CB-Recycle Startup v4 開始 =====
2026/04/28 12:35:25    ✓ Photoshop 起動完了 (29秒)
2026/04/28 12:35:30    試行 1/5: ws=✓
```

#### `%APPDATA%\comic-bridge\_uia_open.log`
PowerShell (Layer 4) の動作記録：
```
2026/04/28 13:00:00  ===== Panel Opener v2 開始 =====
2026/04/28 13:00:01    ✓ COM 接続成功
2026/04/28 13:00:36      試行 15/15 : OK
2026/04/28 13:00:36  ===== 終了。success=True =====
```

### よくある問題

| ログのパターン | 意味 | 対処 |
|---|---|---|
| `✓ COM 接続成功` ＋ パネル開く | 正常 | なし |
| `✗ COM Automation 失敗` | COM サーバー未登録 | Photoshop 再インストール、UAC 確認 |
| `ws=✗` が連続 | ワークスペース未保存 | 「ワークスペース保存」を再実行 |
| Photoshop プロセス未検出 | Photoshop 未起動 | Photoshop 起動後に「強制起動」 |
| メニューバー未検出 | UIA でメニュー認識失敗 | Photoshop UI が標準的でない（COM のみ動作） |

### 緊急回避：手動で開く

1. Photoshop > **ウィンドウ > エクステンション > リサイくるん (CB連携)**
2. これで一度開けば、現在のセッションで使える
3. 次回からは自動展開が動くはず

---

## 10. まとめ

### この方法の特徴

✅ **完全自動**：手動操作は初回セットアップ時の 1 回のみ  
✅ **堅牢**：4 段階のフォールバック  
✅ **診断可能**：詳細ログで問題箇所を特定  
✅ **再利用可能**：他のプラグインへの流用テンプレート  
✅ **Adobe 標準機能の組み合わせ**：第三者ツール不要

### 制約

⚠ **Windows 専用**：PowerShell COM Automation は Windows のみ  
⚠ **Photoshop COM 必須**：Photoshop インストールで自動有効化されるが、まれに再登録が必要な場合あり  
⚠ **初回手動操作必須**：UXP の仕様上、避けられない  
⚠ **Photoshop バージョン依存**：Photoshop 2022（v23）以降を想定

### 設計思想

> 「**Adobe の制約に逆らうのではなく、Adobe が用意した複数の API を組み合わせて確実性を担保する**」

UXP・ExtendScript・COM Automation・UI Automation はそれぞれ単独では限界があるが、**段階的に組み合わせる**ことで、UXP プラグインの自動起動という「公式には未サポート」な機能を実現できる。

---

## 参考実装

| 役割 | 実装場所 |
|---|---|
| Rust コマンド | [src-tauri/src/recycle.rs](../src-tauri/src/recycle.rs) |
| 起動 JSX | [src-tauri/scripts/cb_recycle_startup.jsx](../src-tauri/scripts/cb_recycle_startup.jsx) |
| PowerShell COM | [src-tauri/scripts/open_recycle_panel.ps1](../src-tauri/scripts/open_recycle_panel.ps1) |
| ワークスペース設定 | [src-tauri/scripts/setup_workspace.jsx](../src-tauri/scripts/setup_workspace.jsx) |
| 通知登録 | [src-tauri/scripts/register_startup.jsx](../src-tauri/scripts/register_startup.jsx) |
| クリーンアップ | [src-tauri/scripts/cleanup_recycle.jsx](../src-tauri/scripts/cleanup_recycle.jsx) |
| React UI | [src/features/recycle/RecycleView.tsx](../src/features/recycle/RecycleView.tsx) |
| プラグイン | `C:\Users\yamamoto-ryusei\Documents\6_スクリプト\プラグインデータ\リサイクるん_プラグイン化試作 - コピー (3)\` |

新しい連携を作る際は、このドキュメントの **§8 流用方法**を参照しつつ、上記ファイルを置換キーワードに従ってコピーするのが最速です。
