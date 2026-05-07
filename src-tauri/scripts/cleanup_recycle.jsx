// ===========================================================
// CB-Recycle Cleanup Script
//
// 使い方:
//   Photoshop で File > Scripts > Browse... → このファイルを選択
//
// 機能:
//   1. 登録済みの startApplication 通知を全削除
//   2. ワークスペース「CB_Recycle」「リサイくるん用」を削除
//   3. 結果をアラート表示
//
// 用途:
//   トラブルシューティング、クリーンインストール前のリセット
// ===========================================================

#target photoshop

(function() {
    var report = [];
    report.push("=== CB-Recycle クリーンアップ ===");

    var originalDialogMode = app.displayDialogs;
    app.displayDialogs = DialogModes.NO;

    // ----------------------------------------
    // 1. notifiers クリア
    // ----------------------------------------
    var notifierCount = 0;
    try {
        notifierCount = app.notifiers.length;
        report.push("登録通知数（処理前）: " + notifierCount);

        if (notifierCount > 0) {
            // 全削除（cb-recycle 関連かどうか判別困難なため、すべて削除）
            // ※ Script Events Manager で他のスクリプトを登録している場合も削除されます
            app.notifiers.removeAll();
            report.push("✓ 全通知を削除しました");
        } else {
            report.push("通知は登録されていませんでした");
        }
    } catch (e) {
        report.push("✗ 通知削除エラー: " + e.message);
    }

    // ----------------------------------------
    // 2. ワークスペース削除
    // ----------------------------------------
    var workspaceNames = ["CB_Recycle", "リサイくるん用"];
    for (var i = 0; i < workspaceNames.length; i++) {
        try {
            var ref = new ActionReference();
            ref.putName(stringIDToTypeID("workspace"), workspaceNames[i]);
            var desc = new ActionDescriptor();
            desc.putReference(charIDToTypeID("null"), ref);
            executeAction(charIDToTypeID("Dlt "), desc, DialogModes.NO);
            report.push("✓ ワークスペース削除: " + workspaceNames[i]);
        } catch (e) {
            report.push("- ワークスペース「" + workspaceNames[i] + "」は存在しないか削除失敗");
        }
    }

    // ----------------------------------------
    // 3. notifiersEnabled を無効化（任意）
    // ----------------------------------------
    try {
        if (app.notifiersEnabled) {
            // 残しておいてもいいが、リセットするなら false に
            // app.notifiersEnabled = false;
            report.push("notifiersEnabled: " + app.notifiersEnabled);
        }
    } catch (e) {}

    app.displayDialogs = originalDialogMode;

    report.push("");
    report.push("クリーンアップ完了。");
    report.push("Photoshop を再起動してから COMIC-Bridge アプリで");
    report.push("「① ワークスペース保存」と「② 起動時自動展開を登録」を");
    report.push("再度実行してください。");

    var msg = report.join("\n");
    $.writeln(msg);
    alert(msg);
})();
