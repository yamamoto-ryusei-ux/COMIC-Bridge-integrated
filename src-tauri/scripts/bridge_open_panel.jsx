// ===========================================================
// CB-Recycle Bridge: リサイくるんパネル自動展開スクリプト
//
// COMIC-Bridge から Photoshop 起動時に呼び出される JSX。
// 多段フォールバックで UXP パネルを開く:
//   1. アクション再生 (.atn 同梱時)
//   2. メニュー直叩き（複数候補を試行）
//   3. メニューツリー走査による検出
//   4. ユーザー誘導アラート
//
// 呼び出し側で以下の変数を事前定義する想定（recycle.rs の helper script 参照）:
//   __CB_RECYCLE_JOB_ID    ... 起動対象のジョブID（情報用）
//   __CB_RECYCLE_ATN_PATH  ... 同梱 .atn ファイルの絶対パス（"" の場合スキップ）
// ===========================================================

#target photoshop

(function() {
    var jobId = (typeof __CB_RECYCLE_JOB_ID !== "undefined") ? __CB_RECYCLE_JOB_ID : "";
    var atnPath = (typeof __CB_RECYCLE_ATN_PATH !== "undefined") ? __CB_RECYCLE_ATN_PATH : "";

    $.writeln("[CB-Recycle] Launch helper start. JobID: " + jobId);

    // パネルラベル候補（manifest.json の entrypoints[].label.default + 旧版互換）
    var PANEL_LABEL_CANDIDATES = [
        "リサイくるん (CB連携)",  // 新版（v1.1.0+）
        "リサイくるん"             // 旧版互換
    ];

    var PLUGIN_ID_CANDIDATES = [
        "com.risaikurun.plugin",
        "mainPanel"
    ];

    // ----------------------------------------
    // 戦術1: 同梱アクションを再生
    // ----------------------------------------
    function tryAction() {
        if (!atnPath || atnPath === "") {
            $.writeln("[CB-Recycle] No .atn path provided, skipping action approach");
            return false;
        }
        try {
            var atnFile = new File(atnPath);
            if (!atnFile.exists) {
                $.writeln("[CB-Recycle] .atn not found: " + atnPath);
                return false;
            }
            app.load(atnFile);
            $.writeln("[CB-Recycle] .atn loaded: " + atnPath);
            app.doAction("Open Panel", "CB-Recycle");
            $.writeln("[CB-Recycle] Action played successfully");
            return true;
        } catch (e) {
            $.writeln("[CB-Recycle] Action approach failed: " + e.message);
            return false;
        }
    }

    // ----------------------------------------
    // 戦術2: stringIDToTypeID + runMenuItem
    // ----------------------------------------
    function tryDirectMenuId() {
        var allCandidates = PANEL_LABEL_CANDIDATES.concat(PLUGIN_ID_CANDIDATES);
        for (var i = 0; i < allCandidates.length; i++) {
            var label = allCandidates[i];
            try {
                var menuId = stringIDToTypeID(label);
                if (menuId === 0) continue;
                app.runMenuItem(menuId);
                $.writeln("[CB-Recycle] Menu opened via stringID: " + label);
                return true;
            } catch (e) {
                $.writeln("[CB-Recycle]   stringID '" + label + "' failed: " + e.message);
            }
        }
        return false;
    }

    // ----------------------------------------
    // 戦術3: select menu item アクションマネージャー経由
    // ----------------------------------------
    function trySelectMenuItem() {
        for (var i = 0; i < PANEL_LABEL_CANDIDATES.length; i++) {
            var label = PANEL_LABEL_CANDIDATES[i];
            try {
                var ref = new ActionReference();
                ref.putName(stringIDToTypeID("menuItemType"), label);
                var desc = new ActionDescriptor();
                desc.putReference(charIDToTypeID("null"), ref);
                executeAction(charIDToTypeID("slct"), desc, DialogModes.NO);
                $.writeln("[CB-Recycle] Panel opened via select menuItemType: " + label);
                return true;
            } catch (e) {
                $.writeln("[CB-Recycle]   select '" + label + "' failed: " + e.message);
            }
        }
        return false;
    }

    // ----------------------------------------
    // 戦術4: app.menus（DOM API、利用可能な場合のみ）
    // ----------------------------------------
    function tryMenuTreeWalk() {
        try {
            // app.menus は古いExtendScript APIで利用不可な場合あり
            if (typeof app.menus === "undefined") {
                $.writeln("[CB-Recycle] app.menus not available");
                return false;
            }
            // ウィンドウメニュー → エクステンション → 各パネル
            var windowMenu = null;
            for (var mi = 0; mi < app.menus.length; mi++) {
                var m = app.menus[mi];
                if (m.name === "ウィンドウ" || m.name === "Window") {
                    windowMenu = m;
                    break;
                }
            }
            if (!windowMenu) return false;

            // 再帰検索
            function findItem(items, candidates) {
                for (var i = 0; i < items.length; i++) {
                    var item = items[i];
                    for (var c = 0; c < candidates.length; c++) {
                        if (item.name === candidates[c]) return item;
                    }
                    if (item.menuItems) {
                        var sub = findItem(item.menuItems, candidates);
                        if (sub) return sub;
                    }
                }
                return null;
            }

            var found = findItem(windowMenu.menuItems, PANEL_LABEL_CANDIDATES);
            if (found) {
                found.invoke();
                $.writeln("[CB-Recycle] Panel opened via menu tree walk: " + found.name);
                return true;
            }
        } catch (e) {
            $.writeln("[CB-Recycle] Menu tree walk failed: " + e.message);
        }
        return false;
    }

    // ----------------------------------------
    // 多段フォールバック実行
    // ----------------------------------------
    var opened = false;
    var tactics = [
        ["action",         tryAction],
        ["directMenuId",   tryDirectMenuId],
        ["selectMenuItem", trySelectMenuItem],
        ["menuTreeWalk",   tryMenuTreeWalk]
    ];

    for (var t = 0; t < tactics.length; t++) {
        var name = tactics[t][0];
        var fn = tactics[t][1];
        $.writeln("[CB-Recycle] Trying tactic: " + name);
        if (fn()) {
            opened = true;
            $.writeln("[CB-Recycle] SUCCESS via: " + name);
            break;
        }
    }

    if (!opened) {
        try {
            alert(
                "リサイくるんパネルを自動で開けませんでした。\n\n" +
                "「ウィンドウ > エクステンション > リサイくるん (CB連携)」から\n" +
                "手動で開いてください。\n\n" +
                "・プラグインが正しくインストールされているか確認\n" +
                "・一度開けば次回からはワークスペースが記憶されます"
            );
        } catch (alertErr) {}
    }

    $.writeln("[CB-Recycle] Launch helper end. Opened: " + opened);
})();
