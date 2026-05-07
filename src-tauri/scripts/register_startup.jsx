// ===========================================================
// CB-Recycle Startup Registration Script
//
// Photoshop の Script Events Manager (app.notifiers) を使って
// cb_recycle_startup.jsx を "Start Application" イベントに登録する。
//
// これにより、以降 Photoshop が起動するたびに自動で
// cb_recycle_startup.jsx が実行され、プラグインが起動する。
//
// 引数:
//   __CB_STARTUP_SCRIPT_PATH : 登録するスクリプトの絶対パス
//   __CB_STARTUP_ACTION       : "register" または "unregister"
//   __CB_RECYCLE_RESULT_PATH  : 結果書き出し先
// ===========================================================

#target photoshop

(function() {
    var scriptPath = (typeof __CB_STARTUP_SCRIPT_PATH !== "undefined") ? __CB_STARTUP_SCRIPT_PATH : "";
    var actionMode = (typeof __CB_STARTUP_ACTION !== "undefined") ? __CB_STARTUP_ACTION : "register";
    var resultPath = (typeof __CB_RECYCLE_RESULT_PATH !== "undefined") ? __CB_RECYCLE_RESULT_PATH : "";

    var result = {
        action: actionMode,
        scriptPath: scriptPath,
        success: false,
        notifiersBefore: 0,
        notifiersAfter: 0,
        errors: []
    };

    var originalDialogMode = app.displayDialogs;
    app.displayDialogs = DialogModes.NO;

    function log(m) { $.writeln("[CB-Register] " + m); }

    log("Action: " + actionMode);
    log("Script path: " + scriptPath);

    // Script Events Manager を有効化（必須）
    try {
        app.notifiersEnabled = true;
        log("notifiersEnabled = true");
    } catch (e) {
        result.errors.push("notifiersEnabled set failed: " + e.message);
    }

    // 既存の startApplication 通知を全て削除（重複防止）
    try {
        result.notifiersBefore = app.notifiers.length;
        log("既存 notifier 数: " + result.notifiersBefore);

        var startAppId = stringIDToTypeID("startApplication");
        // 後ろから削除（インデックスずれ防止）
        for (var i = app.notifiers.length - 1; i >= 0; i--) {
            try {
                var n = app.notifiers[i];
                if (n.event === startAppId || n.eventClass === startAppId) {
                    n.remove();
                    log("既存 startApplication 通知を削除");
                }
            } catch (delErr) {
                // 個別削除失敗は無視
            }
        }
    } catch (e) {
        result.errors.push("既存通知削除失敗: " + e.message);
    }

    // ----------------------------------------
    // register モード: 新規登録
    // ----------------------------------------
    if (actionMode === "register") {
        try {
            var scriptFile = new File(scriptPath);
            if (!scriptFile.exists) {
                result.errors.push("スクリプトファイルが存在しません: " + scriptPath);
            } else {
                app.notifiers.add(stringIDToTypeID("startApplication"), scriptFile);
                result.success = true;
                log("startApplication 通知を登録: " + scriptPath);
            }
        } catch (e) {
            result.errors.push("登録失敗: " + e.message);
            log("登録失敗: " + e.message);
        }
    } else if (actionMode === "unregister") {
        // 削除のみ（既に上で削除済み）
        result.success = true;
        log("startApplication 通知を解除");
    }

    result.notifiersAfter = app.notifiers.length;
    log("処理後 notifier 数: " + result.notifiersAfter);

    app.displayDialogs = originalDialogMode;

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
                log("結果書出: " + resFile.fsName);
            }
        } catch (resErr) {
            log("結果書出失敗: " + resErr.message);
        }
    }
})();
