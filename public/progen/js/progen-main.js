// progen-main.js
// ES Module エントリーポイント - 全モジュールを読み込む

// グローバル通知ダイアログ（<dialog> 要素ベース）
function showToast(message, type) {
    const dialog = document.getElementById('globalAlertDialog');
    const icon = document.getElementById('globalAlertIcon');
    const msg = document.getElementById('globalAlertMsg');
    if (!dialog) return Promise.resolve();

    const t = type || 'success';
    const icons = {
        success: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--sage)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
        error:   '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--warm-red)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
        warning: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#b47628" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
    };
    const bgColors = { success: '#edf7f1', error: '#fceeed', warning: '#fdf6ec' };
    icon.innerHTML = icons[t] || icons.success;
    icon.style.background = bgColors[t] || bgColors.success;
    msg.textContent = message;

    if (dialog.open) dialog.close();
    dialog.showModal();

    return new Promise(resolve => {
        dialog.addEventListener('close', resolve, { once: true });
    });
}
window.showToast = showToast;

import './progen-state.js';
import './progen-xml-templates.js';
import './progen-data.js';
import './progen-landing.js';
import './progen-extraction.js';
import './progen-xml-gen.js';
import './progen-check-simple.js';
import './progen-check-variation.js';
import './progen-proofreading.js';
import './progen-json-browser.js';
import './progen-admin.js';
import './progen-note-txt.js';
import './progen-result-viewer.js';
import './progen-comicpot.js';
import './progen-viewer.js';

// 全モジュール読み込み後に起動時の初期化を実行
window.init();
window.initJsonFolderBrowser();
window.initCalibrationFolderBrowser();

// ドロップゾーンの初期化（COMIC-Bridge統合版: テキストD&Dは親アプリで管理）
const proofreadingTxtDropZone = document.getElementById('proofreadingTxtDropZone');
if (proofreadingTxtDropZone) window.setupDropZone(proofreadingTxtDropZone, window.addProofreadingTxt);

// ═══ COMIC-Bridge統合: localStorageポーリングでコマンド受信 ═══
// processLoadedJsonは使わない（内部タイマーでstate上書きされるため）
// JSONからルールを直接抽出してstateに設定する
(function () {
    var lastTs = 0;
    var s = window.state; // progen-state.js のグローバルstate

    // --- テキスト注入 ---
    function injectText(cmd) {
        if (!cmd.textContent || !s) return;
        var fo = { name: cmd.textFileName || 'text.txt', content: cmd.textContent, size: cmd.textContent.length };
        s.manuscriptTxtFiles = [fo];
        s.txtGuideDismissed = true;
        s.proofreadingFiles = [fo];
        s.proofreadingContent = cmd.textContent;
        s.landingProofreadingFiles = [fo];
        s.landingProofreadingContent = cmd.textContent;
    }

    // --- レーベルUI設定 ---
    function setLabel(name) {
        if (!name) return;
        // 抽出/整形ページ
        var sg = document.getElementById('labelSelectorGroup');
        var dg = document.getElementById('labelDisplayGroup');
        var dt = document.getElementById('labelDisplayText');
        if (sg) sg.style.display = 'none';
        if (dg) dg.style.display = 'flex';
        if (dt) dt.textContent = name;
        // 校正ページ
        var pt = document.getElementById('proofreadingLabelSelectorText');
        if (pt) { pt.textContent = name; pt.classList.remove('unselected'); }
        var ps = document.getElementById('proofreadingLabelSelect');
        if (ps) {
            var opts = ps.querySelectorAll('option');
            for (var i = 0; i < opts.length; i++) {
                if (opts[i].value === name || opts[i].textContent === name) {
                    ps.value = opts[i].value;
                    if (window.loadLabelRulesForProofreading) window.loadLabelRulesForProofreading(opts[i].value);
                    break;
                }
            }
        }
    }

    // --- JSONからルールを直接stateに設定（processLoadedJsonを使わない） ---
    function applyJsonRules(jsonData) {
        if (!jsonData || !s) return;
        var isNew = jsonData.presetData !== undefined;
        var pd = isNew ? jsonData.presetData : jsonData;
        var pr = jsonData.proofRules || (isNew ? null : jsonData);

        // currentLoadedJson / currentJsonPath
        s.currentLoadedJson = isNew ? jsonData : { proofRules: pr || { proof: [], symbol: [], options: {} }, presetData: pd };

        // 表記ルール
        if (pr && pr.proof && Array.isArray(pr.proof) && pr.proof.length > 0) {
            s.currentProofRules = pr.proof;
            s.currentProofRules.forEach(function(r) {
                if (!r.category) r.category = 'basic';
                if (r.category === 'character' && r.addRuby === undefined) r.addRuby = true;
            });
        }
        // 記号ルール
        if (pr && pr.symbol && Array.isArray(pr.symbol)) {
            s.symbolRules = pr.symbol;
        }
        // オプション
        if (pr && pr.options) {
            var o = pr.options;
            if (o.ngWordMasking !== undefined) s.optionNgWordMasking = o.ngWordMasking;
            if (o.punctuationToSpace !== undefined) s.optionPunctuationToSpace = o.punctuationToSpace;
            if (o.difficultRuby !== undefined) s.optionDifficultRuby = o.difficultRuby;
            if (o.typoCheck !== undefined) s.optionTypoCheck = o.typoCheck;
            if (o.missingCharCheck !== undefined) s.optionMissingCharCheck = o.missingCharCheck;
            if (o.nameRubyCheck !== undefined) s.optionNameRubyCheck = o.nameRubyCheck;
            if (o.nonJoyoCheck !== undefined) s.optionNonJoyoCheck = o.nonJoyoCheck;
            if (o.numberRuleBase !== undefined) s.numberRuleBase = o.numberRuleBase;
            if (o.numberRulePersonCount !== undefined) s.numberRulePersonCount = o.numberRulePersonCount;
            if (o.numberRuleThingCount !== undefined) s.numberRuleThingCount = o.numberRuleThingCount;
            if (o.numberRuleMonth !== undefined) s.numberRuleMonth = o.numberRuleMonth;
            if (o.numberSubRulesEnabled !== undefined) s.numberSubRulesEnabled = o.numberSubRulesEnabled;
        }
        // レーベル名
        var label = (pd && pd.workInfo && pd.workInfo.label) || '';
        if (label) setLabel(label);
    }

    // --- モード画面表示 ---
    function showMode(mode) {
        var landing = document.getElementById('landingScreen');
        var main = document.getElementById('mainWrapper');
        var proofreading = document.getElementById('proofreadingPage');

        if (landing) landing.style.display = 'none';
        if (main) main.style.display = 'none';
        if (proofreading) proofreading.style.display = 'none';

        if (mode === 'proofreading') {
            if (proofreading) proofreading.style.display = 'flex';
            s.currentProofreadingMode = 'simple';
            s.proofreadingReturnTo = 'landing';
            document.querySelectorAll('.proofreading-mode-btn').forEach(function(b) {
                b.classList.toggle('active', b.dataset.mode === 'simple');
            });
            if (window.updateProofreadingCheckItems) window.updateProofreadingCheckItems();
            if (window.updateProofreadingOptionsLabel) window.updateProofreadingOptionsLabel();
            if (window.renderProofreadingFileList) window.renderProofreadingFileList();
            if (window.updateProofreadingPrompt) window.updateProofreadingPrompt();
            // 常用外漢字
            if (s.proofreadingFiles.length > 0 && window.detectNonJoyoLinesWithPageInfo && window.showNonJoyoResultPopup) {
                var d = window.detectNonJoyoLinesWithPageInfo(s.proofreadingFiles);
                s.proofreadingDetectedNonJoyoWords = d;
                window.showNonJoyoResultPopup(d, true);
            }
        } else {
            if (main) main.style.display = 'flex';
            s.currentViewMode = 'edit';
            if (mode === 'formatting' && window.selectDataType) window.selectDataType('txt_only');
            if (window.updateTxtUploadStatus) window.updateTxtUploadStatus();
            if (window.renderTable) window.renderTable();
            if (window.showEditMode) window.showEditMode();
            if (window.renderSymbolTable) window.renderSymbolTable();
            if (window.generateXML) window.generateXML();
        }
        // Gemini有効化
        var gb = document.getElementById('extractionGeminiBtn');
        if (gb) gb.removeAttribute('disabled');
        if (window.enableDataTypeToggle) window.enableDataTypeToggle();
        // JSON表示
        var ji = document.getElementById('loadedJsonIndicator');
        if (ji) ji.style.display = s.currentJsonPath ? 'flex' : 'none';
        var sb = document.getElementById('saveToJsonBtn');
        if (sb) sb.style.display = s.currentJsonPath ? 'inline-block' : 'none';
    }

    // --- メイン処理 ---
    function processCommand(cmd) {
        if (!cmd || !cmd.mode || !s) return;
        console.log('[ProGen] Command:', cmd.mode, { text: !!cmd.textContent, json: !!cmd.jsonPath, label: cmd.labelName });

        // 1) テキスト注入
        injectText(cmd);

        // 2) レーベル設定
        setLabel(cmd.labelName);

        // 3) JSON読み込み（processLoadedJsonを使わず、直接stateに設定）
        if (cmd.jsonPath && window.electronAPI && window.electronAPI.readJsonFile) {
            s.currentJsonPath = cmd.jsonPath;
            window.electronAPI.readJsonFile(cmd.jsonPath).then(function (result) {
                try {
                    if (result && result.success !== false) {
                        applyJsonRules(result);
                    }
                } catch (e) { console.warn('[ProGen] JSON apply error:', e); }
                // テキスト再注入（applyJsonRulesが何かを上書きした場合の保険）
                injectText(cmd);
                // 4) 画面表示
                showMode(cmd.mode);
            }).catch(function (e) {
                console.warn('[ProGen] JSON read error:', e);
                showMode(cmd.mode);
            });
        } else {
            // JSONなし → 直接画面表示
            showMode(cmd.mode);
        }
    }

    // --- 500msポーリング ---
    setInterval(function () {
        try {
            var raw = localStorage.getItem('cb_progen_cmd');
            if (!raw) return;
            var cmd = JSON.parse(raw);
            if (!cmd || !cmd.ts || cmd.ts <= lastTs) return;
            lastTs = cmd.ts;
            localStorage.removeItem('cb_progen_cmd');
            processCommand(cmd);
        } catch (e) { /* ignore */ }
    }, 500);

    // --- 初回チェック ---
    try {
        var raw = localStorage.getItem('cb_progen_cmd');
        if (raw) {
            var cmd = JSON.parse(raw);
            if (cmd && cmd.ts) {
                lastTs = cmd.ts;
                localStorage.removeItem('cb_progen_cmd');
                processCommand(cmd);
            }
        }
    } catch (e) { /* ignore */ }
})();
