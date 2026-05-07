// ===========================================================
// CB-Recycle Bridge: プラグインパネル自動展開スクリプト v6
//
// COMIC-Bridge から Photoshop 起動時に呼び出される。
//
// v6 の改善点:
//   - 動的プロービングで Photoshop 起動完了を検出
//   - 最大 90 秒の起動待機（30 秒以上の起動にも対応）
//   - 試行回数を拡張（最大 10 回 × 3 秒間隔）
// ===========================================================

#target photoshop

(function() {
    var jobId = (typeof __CB_RECYCLE_JOB_ID !== "undefined") ? __CB_RECYCLE_JOB_ID : "";
    $.writeln("[CB-Recycle] Start. Job: " + jobId);

    var WORKSPACE_NAME = "CB_Recycle";

    var originalDialogMode = app.displayDialogs;
    app.displayDialogs = DialogModes.NO;

    // ----------------------------------------
    // Phase 1: Photoshop 起動完了を動的に検出
    // ----------------------------------------
    $.writeln("[CB-Recycle] Phase 1: Photoshop 起動完了待機...");
    var maxProbeSeconds = 90;
    var probeStart = (new Date()).getTime();
    var ready = false;
    for (var probe = 0; probe < maxProbeSeconds; probe++) {
        try {
            if (app.fonts.length > 0) {
                var elapsed = ((new Date()).getTime() - probeStart) / 1000;
                $.writeln("[CB-Recycle]   ✓ 起動完了 (" + Math.round(elapsed) + "秒)");
                ready = true;
                break;
            }
        } catch (e) {}
        $.sleep(1000);
    }
    if (!ready) {
        $.writeln("[CB-Recycle]   ⚠ Phase 1 タイムアウト");
    }

    // ----------------------------------------
    // Phase 2: UXP 読込待機
    // ----------------------------------------
    $.sleep(2000);

    // ----------------------------------------
    // Phase 3: ワークスペース切替（最優先）
    // ----------------------------------------
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

    var ALL_CANDIDATES = [
        "リサイくるん (CB連携)",
        "リサイくるん",
        "リサイくるん 実行 (CB)",
        "cbRecycleExecute",
        "mainPanel",
        "com.risaikurun.plugin",
        "com.risaikurun.plugin.mainPanel",
        "com.risaikurun.plugin.cbRecycleExecute"
    ];

    function tryRunMenu(label) {
        try {
            var menuId = stringIDToTypeID(label);
            if (!menuId) return false;
            app.runMenuItem(menuId);
            return true;
        } catch (e) { return false; }
    }
    function trySelectMenuItem(label) {
        try {
            var ref2 = new ActionReference();
            ref2.putName(stringIDToTypeID("menuItemType"), label);
            var desc2 = new ActionDescriptor();
            desc2.putReference(charIDToTypeID("null"), ref2);
            executeAction(charIDToTypeID("slct"), desc2, DialogModes.NO);
            return true;
        } catch (e) { return false; }
    }

    // ----------------------------------------
    // Phase 4: パネル展開ループ（短縮: 5回）
    // ----------------------------------------
    $.writeln("[CB-Recycle] Phase 3-4: パネル展開試行ループ");
    var maxAttempts = 5;
    for (var attempt = 1; attempt <= maxAttempts; attempt++) {
        var wsOk = tryWorkspaceSwitch();
        for (var i = 0; i < ALL_CANDIDATES.length; i++) {
            tryRunMenu(ALL_CANDIDATES[i]);
            trySelectMenuItem(ALL_CANDIDATES[i]);
        }
        $.writeln("[CB-Recycle]   attempt " + attempt + "/" + maxAttempts + " ws=" + (wsOk ? "✓" : "✗"));
        if (attempt < maxAttempts) $.sleep(3000);
    }

    // ----------------------------------------
    // Phase 5: PowerShell UIA フォールバック
    // ----------------------------------------
    $.writeln("[CB-Recycle] Phase 5: PowerShell UIA fallback");
    try {
        var psPath = $.getenv("APPDATA") + "/comic-bridge/open_recycle_panel.ps1";
        var psFile = new File(psPath);
        if (psFile.exists) {
            var cmd = 'start /B powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + psPath + '"';
            app.system(cmd);
            $.writeln("[CB-Recycle]   ✓ PowerShell UIA 起動コマンド送信");
        } else {
            $.writeln("[CB-Recycle]   ⚠ PowerShell スクリプト未配置: " + psPath);
        }
    } catch (psErr) {
        $.writeln("[CB-Recycle]   ✗ PowerShell 起動失敗: " + psErr.message);
    }

    app.displayDialogs = originalDialogMode;
    $.writeln("[CB-Recycle] End");
})();
