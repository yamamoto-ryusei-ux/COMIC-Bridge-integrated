// ===========================================================
// CB-Recycle Photoshop Startup Script v4
//
// Photoshop の Script Events Manager で "Start Application" イベントに
// 登録される。Photoshop 起動時に自動実行され、リサイくるんパネルを開く。
//
// v4 の改善点:
//   - 固定 5 秒待機を廃止 → 動的プロービングで Photoshop 起動完了を検出
//   - app.fonts.length を 1 秒間隔で監視（最大 90 秒）
//   - 起動完了後に UXP プラグイン読込を 5 秒待つ
//   - パネル展開試行を 10 回まで（試行間隔 3 秒）
//   - 30 秒以上の起動時間にも対応
//
// 動作ログ: %APPDATA%\comic-bridge\_startup.log
// ===========================================================

#target photoshop

(function() {
    var WORKSPACE_NAME = "CB_Recycle";

    var originalDialogMode = app.displayDialogs;
    app.displayDialogs = DialogModes.NO;

    // ----------------------------------------
    // 起動ログ
    // ----------------------------------------
    var logPath = "";
    function writeStartupLog(msg) {
        try {
            if (!logPath) {
                var appDataPath = $.getenv("APPDATA");
                if (!appDataPath) return;
                var dir = appDataPath + "/comic-bridge";
                var folder = new Folder(dir);
                if (!folder.exists) folder.create();
                logPath = dir + "/_startup.log";
            }
            var f = new File(logPath);
            f.encoding = "UTF-8";
            if (f.open("a")) {
                f.writeln(new Date().toLocaleString() + "  " + msg);
                f.close();
            }
        } catch(e) {}
    }
    function log(m) {
        $.writeln("[CB-Startup] " + m);
        writeStartupLog(m);
    }

    // ログローテーション（100KB 超なら削除）
    try {
        var lf = new File($.getenv("APPDATA") + "/comic-bridge/_startup.log");
        if (lf.exists && lf.length > 100000) {
            lf.remove();
        }
    } catch(e) {}

    log("===== CB-Recycle Startup v4 開始 =====");
    log("Photoshop バージョン: " + app.version);
    log("ワークスペース名: " + WORKSPACE_NAME);

    var scriptStartTime = (new Date()).getTime();

    // ----------------------------------------
    // Phase 1: Photoshop 本体の起動完了を動的に検出
    //
    // app.fonts.length が成功するまで 1 秒間隔でポーリング。
    // 起動が遅い環境（30秒以上）でも自動的に対応。
    // ----------------------------------------
    log("--- Phase 1: Photoshop 起動完了待機 ---");
    var maxProbeSeconds = 90;
    var probeStarted = (new Date()).getTime();
    var photoshopReady = false;

    for (var probe = 0; probe < maxProbeSeconds; probe++) {
        try {
            // app.fonts は Photoshop の重要なシステムなので、これが読めれば本体準備完了
            var fontCount = app.fonts.length;
            if (fontCount > 0) {
                var elapsed = ((new Date()).getTime() - probeStarted) / 1000;
                log("  ✓ Photoshop 起動完了 (" + Math.round(elapsed) + "秒, fonts=" + fontCount + ")");
                photoshopReady = true;
                break;
            }
        } catch (e) {
            // まだ準備できていない
        }
        $.sleep(1000);
    }

    if (!photoshopReady) {
        log("  ⚠ Phase 1 タイムアウト (" + maxProbeSeconds + "秒経過しても起動完了せず)");
        log("  ※ それでも続行を試みます");
    }

    // ----------------------------------------
    // Phase 2: UXP プラグイン読込待機
    //
    // Photoshop 本体が起動しても UXP プラグインの登録は遅れることがある。
    // 追加 5 秒待つ。
    // ----------------------------------------
    log("--- Phase 2: UXP プラグイン読込待機 (5秒) ---");
    $.sleep(5000);

    // ----------------------------------------
    // Phase 3: パネル展開（戦略1: ワークスペース切替 + 戦略2: 直接展開）
    //
    // 最大 10 回まで試行。3 秒間隔で計 30 秒のリトライウィンドウ。
    // ----------------------------------------
    log("--- Phase 3: パネル展開試行 ---");

    function tryWorkspaceSwitch() {
        try {
            var ref = new ActionReference();
            ref.putName(stringIDToTypeID("workspace"), WORKSPACE_NAME);
            var desc = new ActionDescriptor();
            desc.putReference(charIDToTypeID("null"), ref);
            executeAction(charIDToTypeID("slct"), desc, DialogModes.NO);
            return true;
        } catch (e) {
            return false;
        }
    }

    var ALL_LABELS = [
        "リサイくるん (CB連携)",
        "リサイくるん",
        "リサイくるん 実行 (CB)",
        "cbRecycleExecute",
        "mainPanel",
        "com.risaikurun.plugin",
        "com.risaikurun.plugin.mainPanel",
        "com.risaikurun.plugin.cbRecycleExecute"
    ];

    function tryDirectOpen() {
        for (var i = 0; i < ALL_LABELS.length; i++) {
            try {
                app.runMenuItem(stringIDToTypeID(ALL_LABELS[i]));
            } catch (e) {}
            try {
                var ref = new ActionReference();
                ref.putName(stringIDToTypeID("menuItemType"), ALL_LABELS[i]);
                var desc = new ActionDescriptor();
                desc.putReference(charIDToTypeID("null"), ref);
                executeAction(charIDToTypeID("slct"), desc, DialogModes.NO);
            } catch (e) {}
        }
    }

    var maxAttempts = 5;
    var wsSuccessAtLeastOnce = false;
    for (var attempt = 1; attempt <= maxAttempts; attempt++) {
        var wsResult = tryWorkspaceSwitch();
        if (wsResult) wsSuccessAtLeastOnce = true;
        tryDirectOpen();

        log("  試行 " + attempt + "/" + maxAttempts + ": ws=" + (wsResult ? "✓" : "✗"));

        if (attempt < maxAttempts) {
            $.sleep(3000);
        }
    }

    // ----------------------------------------
    // Phase 4: PowerShell UIA フォールバック
    //
    // JSX の試行が成功したかどうか確実には判定できないため、
    // 確実性を上げるために PowerShell + UI Automation で
    // 最終的にメニュー操作を実行する。
    // ----------------------------------------
    log("--- Phase 4: PowerShell UIA フォールバック ---");
    try {
        // PowerShell スクリプトのパスを推定
        // 1. アプリのリソース内（インストール時）
        // 2. 開発時の絶対パス
        var psScriptPath = $.getenv("APPDATA") + "/comic-bridge/open_recycle_panel.ps1";
        var psFile = new File(psScriptPath);
        if (!psFile.exists) {
            log("  PowerShell スクリプト未配置: " + psScriptPath);
            log("  → アプリで「PowerShellスクリプト配置」を実行してください");
        } else {
            log("  PowerShell スクリプト実行: " + psScriptPath);
            // 非同期で起動（Photoshop をブロックしない）
            // start /B でバックグラウンド起動
            var cmd = 'start /B powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + psScriptPath + '"';
            app.system(cmd);
            log("  ✓ PowerShell 起動コマンド送信");
        }
    } catch (psErr) {
        log("  ✗ PowerShell フォールバック失敗: " + psErr.message);
    }

    app.displayDialogs = originalDialogMode;

    var totalElapsed = ((new Date()).getTime() - scriptStartTime) / 1000;
    log("===== 終了 (合計 " + Math.round(totalElapsed) + " 秒) =====");
    log("ワークスペース切替: " + (wsSuccessAtLeastOnce ? "1回以上成功" : "全試行失敗"));
})();
