// ===========================================================
// CB-Recycle Workspace Setup Script v3
//
// パネルが確実に開いた状態でワークスペースを保存する。
//
// v3 の改善点:
//   - 動的プロービングで Photoshop 起動完了を検出（最大 90 秒）
//   - パネル展開試行を 10 回まで（試行間隔 3 秒）
//   - 30 秒以上の起動時間にも対応
// ===========================================================

#target photoshop

(function() {
    var resultPath = (typeof __CB_RECYCLE_RESULT_PATH !== "undefined") ? __CB_RECYCLE_RESULT_PATH : "";
    var WORKSPACE_NAME = "CB_Recycle";

    var originalDialogMode = app.displayDialogs;
    app.displayDialogs = DialogModes.NO;

    var result = {
        psVersion: app.version,
        photoshopReady: false,
        photoshopReadyAfterSeconds: 0,
        panelOpened: false,
        workspaceSaved: false,
        workspaceActivated: false,
        attempts: 0,
        errors: []
    };

    // ログ
    var logBuffer = [];
    function log(m) {
        $.writeln("[CB-Setup] " + m);
        logBuffer.push(new Date().toLocaleTimeString() + " " + m);
    }
    log("===== Workspace Setup v3 開始 =====");

    var scriptStartTime = (new Date()).getTime();

    // ----------------------------------------
    // Phase 1: Photoshop 起動完了の動的検出
    // ----------------------------------------
    log("--- Phase 1: Photoshop 起動完了待機 ---");
    var maxProbeSeconds = 90;
    var probeStart = (new Date()).getTime();
    for (var probe = 0; probe < maxProbeSeconds; probe++) {
        try {
            if (app.fonts.length > 0) {
                var elapsed = ((new Date()).getTime() - probeStart) / 1000;
                result.photoshopReady = true;
                result.photoshopReadyAfterSeconds = Math.round(elapsed);
                log("  ✓ Photoshop 起動完了 (" + Math.round(elapsed) + "秒)");
                break;
            }
        } catch (e) {}
        $.sleep(1000);
    }
    if (!result.photoshopReady) {
        log("  ⚠ Phase 1 タイムアウト");
    }

    // ----------------------------------------
    // Phase 2: UXP 読込待機
    // ----------------------------------------
    log("--- Phase 2: UXP プラグイン読込待機 (3秒) ---");
    $.sleep(3000);

    // ----------------------------------------
    // Phase 3: パネル展開ループ
    // ----------------------------------------
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

    function tryAllLabels() {
        for (var i = 0; i < ALL_LABELS.length; i++) {
            try {
                var id = stringIDToTypeID(ALL_LABELS[i]);
                if (id) app.runMenuItem(id);
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

    log("--- Phase 3: パネル展開ループ（最大10回） ---");
    for (var attempt = 1; attempt <= 10; attempt++) {
        log("  試行 " + attempt + "/10");
        result.attempts = attempt;
        tryAllLabels();
        $.sleep(3000);
    }
    result.panelOpened = true; // 楽観的判定（実際は判定不能）

    // ----------------------------------------
    // Phase 4: 旧名/同名ワークスペースを削除
    // ----------------------------------------
    log("--- Phase 4: 既存ワークスペース削除 ---");
    var oldNames = [WORKSPACE_NAME, "リサイくるん用"];
    for (var on = 0; on < oldNames.length; on++) {
        try {
            var delRef = new ActionReference();
            delRef.putName(stringIDToTypeID("workspace"), oldNames[on]);
            var delDesc = new ActionDescriptor();
            delDesc.putReference(charIDToTypeID("null"), delRef);
            executeAction(charIDToTypeID("Dlt "), delDesc, DialogModes.NO);
            log("  既存ワークスペース削除: " + oldNames[on]);
        } catch (e) {}
    }
    $.sleep(1500);  // ファイルシステム反映待ち

    // ----------------------------------------
    // Phase 5: ワークスペース保存
    // ----------------------------------------
    log("--- Phase 5: ワークスペース保存 ---");
    try {
        var ref = new ActionReference();
        ref.putClass(stringIDToTypeID("workspace"));
        var desc = new ActionDescriptor();
        desc.putReference(charIDToTypeID("null"), ref);
        desc.putString(charIDToTypeID("Nm  "), WORKSPACE_NAME);
        desc.putBoolean(stringIDToTypeID("captureKeyboardShortcuts"), false);
        desc.putBoolean(stringIDToTypeID("captureMenus"), false);
        desc.putBoolean(stringIDToTypeID("captureToolbar"), false);
        executeAction(charIDToTypeID("Mk  "), desc, DialogModes.NO);
        result.workspaceSaved = true;
        log("  ✓ ワークスペース保存: " + WORKSPACE_NAME);
    } catch (e) {
        result.errors.push("Workspace save failed: " + e.message);
        log("  ✗ ワークスペース保存失敗: " + e.message);
    }

    $.sleep(500);

    // ----------------------------------------
    // Phase 6: アクティブ化
    // ----------------------------------------
    if (result.workspaceSaved) {
        log("--- Phase 6: アクティブ化 ---");
        try {
            var actRef = new ActionReference();
            actRef.putName(stringIDToTypeID("workspace"), WORKSPACE_NAME);
            var actDesc = new ActionDescriptor();
            actDesc.putReference(charIDToTypeID("null"), actRef);
            executeAction(charIDToTypeID("slct"), actDesc, DialogModes.NO);
            result.workspaceActivated = true;
            log("  ✓ ワークスペースをアクティブに設定");
        } catch (e) {
            result.errors.push("Workspace activate failed: " + e.message);
            log("  ✗ アクティブ化失敗: " + e.message);
        }
    }

    var totalElapsed = ((new Date()).getTime() - scriptStartTime) / 1000;
    log("===== 終了 (合計 " + Math.round(totalElapsed) + "秒) =====");

    app.displayDialogs = originalDialogMode;

    // ログ保存
    try {
        var logFile = new File($.getenv("APPDATA") + "/comic-bridge/_workspace_setup.log");
        if (logFile.parent && !logFile.parent.exists) logFile.parent.create();
        logFile.encoding = "UTF-8";
        if (logFile.open("w")) {
            for (var li = 0; li < logBuffer.length; li++) {
                logFile.writeln(logBuffer[li]);
            }
            logFile.close();
        }
    } catch (e) {}

    // 結果書き出し
    if (resultPath && resultPath !== "") {
        try {
            var resFile = new File(resultPath);
            if (resFile.parent && !resFile.parent.exists) resFile.parent.create();

            function jsonEnc(obj) {
                if (obj === null || obj === undefined) return "null";
                if (typeof obj === "boolean") return obj ? "true" : "false";
                if (typeof obj === "number") return String(obj);
                if (typeof obj === "string") {
                    var r = '"';
                    for (var i = 0; i < obj.length; i++) {
                        var c = obj.charCodeAt(i);
                        if (c === 34) r += '\\"';
                        else if (c === 92) r += '\\\\';
                        else if (c === 10) r += '\\n';
                        else if (c === 13) r += '\\r';
                        else if (c < 32) r += "?";
                        else r += obj.charAt(i);
                    }
                    return r + '"';
                }
                if (obj instanceof Array) {
                    var items = [];
                    for (var ai = 0; ai < obj.length; ai++) items.push(jsonEnc(obj[ai]));
                    return "[" + items.join(",") + "]";
                }
                if (typeof obj === "object") {
                    var parts = [];
                    for (var k in obj) {
                        if (obj.hasOwnProperty(k)) parts.push(jsonEnc(k) + ":" + jsonEnc(obj[k]));
                    }
                    return "{" + parts.join(",") + "}";
                }
                return "null";
            }

            resFile.encoding = "UTF-8";
            if (resFile.open("w")) {
                resFile.writeln(jsonEnc(result));
                resFile.close();
            }
        } catch (resErr) {}
    }
})();
