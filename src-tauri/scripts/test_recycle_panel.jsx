// ===========================================================
// CB-Recycle 動作確認スクリプト（手動診断用）
//
// 使い方:
//   1. Photoshop で「ファイル > スクリプト > 参照...」
//   2. このファイルを選択して実行
//   3. 表示されるダイアログで結果を確認
//
// 何を診断するか:
//   - リサイくるん UXP プラグインがインストール済みか
//   - パネルを自動で開く各方式が動作するか
//   - どの方式が成功したか
// ===========================================================

#target photoshop

(function() {
    var PANEL_LABEL_CANDIDATES = [
        "リサイくるん (CB連携)",
        "リサイくるん"
    ];
    var PLUGIN_ID_CANDIDATES = [
        "com.risaikurun.plugin",
        "mainPanel"
    ];

    var report = [];
    report.push("=== CB-Recycle 診断 ===");
    report.push("Photoshop version: " + app.version);
    report.push("");

    // 1. stringIDToTypeID 各候補
    report.push("[1] stringIDToTypeID + runMenuItem:");
    var directSuccess = false;
    var allCandidates = PANEL_LABEL_CANDIDATES.concat(PLUGIN_ID_CANDIDATES);
    for (var i = 0; i < allCandidates.length; i++) {
        var label = allCandidates[i];
        try {
            var mid = stringIDToTypeID(label);
            if (mid === 0) {
                report.push("  ✗ '" + label + "' → ID:0 (未登録)");
                continue;
            }
            app.runMenuItem(mid);
            report.push("  ✓ '" + label + "' → ID:" + mid + " 成功");
            directSuccess = true;
            break;
        } catch (e) {
            report.push("  ✗ '" + label + "' → " + e.message);
        }
    }

    // 2. select menuItemType
    report.push("");
    report.push("[2] select menuItemType:");
    if (!directSuccess) {
        for (var i = 0; i < PANEL_LABEL_CANDIDATES.length; i++) {
            var label = PANEL_LABEL_CANDIDATES[i];
            try {
                var ref = new ActionReference();
                ref.putName(stringIDToTypeID("menuItemType"), label);
                var desc = new ActionDescriptor();
                desc.putReference(charIDToTypeID("null"), ref);
                executeAction(charIDToTypeID("slct"), desc, DialogModes.NO);
                report.push("  ✓ '" + label + "' 成功");
                directSuccess = true;
                break;
            } catch (e) {
                report.push("  ✗ '" + label + "' → " + e.message);
            }
        }
    } else {
        report.push("  (前段で成功したためスキップ)");
    }

    // 3. app.menus 走査
    report.push("");
    report.push("[3] app.menus 走査:");
    try {
        if (typeof app.menus === "undefined") {
            report.push("  ✗ app.menus API 利用不可");
        } else {
            var windowMenu = null;
            for (var mi = 0; mi < app.menus.length; mi++) {
                if (app.menus[mi].name === "ウィンドウ" || app.menus[mi].name === "Window") {
                    windowMenu = app.menus[mi];
                    break;
                }
            }
            if (windowMenu) {
                report.push("  ウィンドウメニュー検出: " + windowMenu.name);
                // 配下のメニュー項目を列挙（最大2階層）
                function dump(items, depth) {
                    var indent = "    ";
                    for (var d = 0; d < depth; d++) indent += "  ";
                    for (var i = 0; i < items.length && i < 50; i++) {
                        var it = items[i];
                        report.push(indent + "- " + it.name);
                        if (it.menuItems && depth < 2) dump(it.menuItems, depth + 1);
                    }
                }
                dump(windowMenu.menuItems, 0);
            } else {
                report.push("  ✗ ウィンドウメニュー未検出");
            }
        }
    } catch (e) {
        report.push("  ✗ エラー: " + e.message);
    }

    // 4. 結果サマリ
    report.push("");
    report.push("=== 結果 ===");
    if (directSuccess) {
        report.push("✓ パネル展開に成功しました");
        report.push("  → COMIC-Bridge から自動起動できます");
    } else {
        report.push("✗ パネルを自動展開できませんでした");
        report.push("  → プラグインが正しくインストールされているか確認してください");
        report.push("  → manifest.json の label.default を確認: 「リサイくるん (CB連携)」");
    }

    var msg = report.join("\n");
    $.writeln(msg);
    alert(msg);
})();
