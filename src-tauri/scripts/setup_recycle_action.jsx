// ===========================================================
// CB-Recycle セットアップスクリプト（ベストエフォート）
//
// アプリ初回起動時に Photoshop で自動実行される。
// 目的: CB-Recycle.atn を生成して同梱できるようにする。
//
// 制限: JSX ではアクションへの「ステップ追加」が公式にできないため、
// 完全な .atn 自動生成は不可能。可能な範囲で：
//   1. アクションセット "CB-Recycle" を作成
//   2. 空のアクション "Open Panel" を作成
//   3. アクションセットを .atn として保存
//   4. パネルが開けることを確認
//
// 結果は __CB_RECYCLE_RESULT_PATH に書き出される。
//
// 呼び出し側で以下の変数を定義:
//   __CB_RECYCLE_ATN_OUTPUT_PATH ... .atn の保存先
//   __CB_RECYCLE_RESULT_PATH     ... 結果JSON書き出し先
// ===========================================================

#target photoshop

(function() {
    var atnPath = (typeof __CB_RECYCLE_ATN_OUTPUT_PATH !== "undefined") ? __CB_RECYCLE_ATN_OUTPUT_PATH : "";
    var resultPath = (typeof __CB_RECYCLE_RESULT_PATH !== "undefined") ? __CB_RECYCLE_RESULT_PATH : "";

    var result = {
        setCreated: false,
        actionCreated: false,
        atnSaved: false,
        panelOpened: false,
        atnPath: atnPath,
        errors: []
    };

    function log(msg) { $.writeln("[CB-Recycle Setup] " + msg); }

    log("Setup start. ATN output: " + atnPath);

    // ----------------------------------------
    // ステップ1: アクションセット "CB-Recycle" を作成
    // 既存があれば削除してから作成（重複回避）
    // ----------------------------------------
    try {
        // 既存削除（あれば）
        try {
            var delRef = new ActionReference();
            delRef.putName(stringIDToTypeID("actionSet"), "CB-Recycle");
            var delDesc = new ActionDescriptor();
            delDesc.putReference(charIDToTypeID("null"), delRef);
            executeAction(charIDToTypeID("Dlt "), delDesc, DialogModes.NO);
            log("Existing CB-Recycle set deleted");
        } catch (delErr) {
            // 存在しなければエラー → 無視
        }

        // 新規作成
        var setRef = new ActionReference();
        setRef.putClass(stringIDToTypeID("actionSet"));
        var setDesc = new ActionDescriptor();
        setDesc.putReference(charIDToTypeID("null"), setRef);
        setDesc.putString(charIDToTypeID("Nm  "), "CB-Recycle");
        executeAction(charIDToTypeID("Mk  "), setDesc, DialogModes.NO);
        result.setCreated = true;
        log("Action set 'CB-Recycle' created");
    } catch (e) {
        result.errors.push("Set creation: " + e.message);
        log("Set creation FAILED: " + e.message);
    }

    // ----------------------------------------
    // ステップ2: アクション "Open Panel" を作成
    // ----------------------------------------
    if (result.setCreated) {
        try {
            var actionRef = new ActionReference();
            actionRef.putClass(stringIDToTypeID("action"));
            var actionDesc = new ActionDescriptor();
            actionDesc.putReference(charIDToTypeID("null"), actionRef);
            actionDesc.putString(charIDToTypeID("Nm  "), "Open Panel");

            var parentRef = new ActionReference();
            parentRef.putName(stringIDToTypeID("actionSet"), "CB-Recycle");
            actionDesc.putReference(stringIDToTypeID("at"), parentRef);

            executeAction(charIDToTypeID("Mk  "), actionDesc, DialogModes.NO);
            result.actionCreated = true;
            log("Action 'Open Panel' created");
        } catch (e) {
            result.errors.push("Action creation: " + e.message);
            log("Action creation FAILED: " + e.message);
        }
    }

    // ----------------------------------------
    // ステップ3: アクションセットを .atn として保存
    // ----------------------------------------
    if (result.setCreated && atnPath && atnPath !== "") {
        try {
            // 親フォルダがなければ作成
            var atnFile = new File(atnPath);
            var parentFolder = atnFile.parent;
            if (parentFolder && !parentFolder.exists) {
                parentFolder.create();
                log("Parent folder created: " + parentFolder.fsName);
            }

            // 保存
            var saveDesc = new ActionDescriptor();
            var saveRef = new ActionReference();
            saveRef.putName(stringIDToTypeID("actionSet"), "CB-Recycle");
            saveDesc.putReference(charIDToTypeID("null"), saveRef);
            saveDesc.putPath(charIDToTypeID("To  "), atnFile);
            executeAction(charIDToTypeID("save"), saveDesc, DialogModes.NO);

            // 検証
            if (atnFile.exists) {
                result.atnSaved = true;
                log(".atn saved: " + atnFile.fsName);
            } else {
                log(".atn save returned but file not found: " + atnFile.fsName);
            }
        } catch (e) {
            result.errors.push("ATN save: " + e.message);
            log("ATN save FAILED: " + e.message);
        }
    }

    // ----------------------------------------
    // ステップ4: パネルを開く動作確認
    // （ここで開けば、以降ワークスペースに記憶される）
    // ----------------------------------------
    var PANEL_LABEL_CANDIDATES = [
        "リサイくるん (CB連携)",
        "リサイくるん"
    ];

    for (var pi = 0; pi < PANEL_LABEL_CANDIDATES.length; pi++) {
        try {
            var menuId = stringIDToTypeID(PANEL_LABEL_CANDIDATES[pi]);
            if (menuId === 0) continue;
            app.runMenuItem(menuId);
            result.panelOpened = true;
            log("Panel opened: " + PANEL_LABEL_CANDIDATES[pi]);
            break;
        } catch (panelErr) {
            log("  Panel candidate '" + PANEL_LABEL_CANDIDATES[pi] + "' failed: " + panelErr.message);
        }
    }

    if (!result.panelOpened) {
        result.errors.push("Panel did not open with any known label");
    }

    // ----------------------------------------
    // 結果書き出し（COMIC-Bridge が読み取る）
    // ----------------------------------------
    if (resultPath && resultPath !== "") {
        try {
            var resFile = new File(resultPath);
            var resFolder = resFile.parent;
            if (resFolder && !resFolder.exists) resFolder.create();

            // 簡易JSONエンコード
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
                resFile.write(jsonEnc(result));
                resFile.close();
                log("Result written: " + resFile.fsName);
            }
        } catch (resErr) {
            log("Result write FAILED: " + resErr.message);
        }
    }

    log("Setup end. Set:" + result.setCreated + " Action:" + result.actionCreated +
        " ATN:" + result.atnSaved + " Panel:" + result.panelOpened);
})();
