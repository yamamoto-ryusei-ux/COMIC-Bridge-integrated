/* =========================================
   校正専用ページ
   ========================================= */
import { state } from './progen-state.js';
// [moved to state] proofreadingFiles
// [moved to state] proofreadingContent
// [moved to state] currentProofreadingMode
// [moved to state] proofreadingDetectedNonJoyoWords
// [moved to state] proofreadingSelectedNonJoyoIndexes

// 校正ページを表示
function showProofreadingPage() {
    const landing = document.getElementById('landingScreen');
    const main = document.getElementById('mainWrapper');
    const proofreading = document.getElementById('proofreadingPage');

    // 現在表示中の画面を判定
    const fromEl = landing.style.display !== 'none' ? landing : main;

    // アニメーション付き遷移
    fromEl.classList.add('page-transition-out-zoom');
    setTimeout(() => {
        landing.style.display = 'none';
        main.style.display = 'none';
        fromEl.classList.remove('page-transition-out-zoom');

        proofreading.style.display = 'flex';
        proofreading.classList.add('page-transition-zoom-in');
        setTimeout(() => {
            proofreading.classList.remove('page-transition-zoom-in');
        }, 350);
    }, 250);

    // 初期表示更新
    updateProofreadingCheckItems();
}

// ランディング画面から校正ページへ遷移
function goToProofreadingPage(mode) {
    // ランディング画面で読み込んだファイルがあれば校正ページに引き継ぐ
    if (state.landingProofreadingFiles && state.landingProofreadingFiles.length > 0) {
        state.proofreadingFiles = [...state.landingProofreadingFiles];
        state.proofreadingContent = state.landingProofreadingContent;
    }

    // モードを設定
    state.currentProofreadingMode = mode || 'simple';

    // 校正ページを表示
    showProofreadingPage();

    // モードボタンのアクティブ状態を更新
    document.querySelectorAll('.proofreading-mode-btn').forEach(btn => {
        if (btn.dataset.mode === state.currentProofreadingMode) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // ファイルリストとプロンプトを更新
    renderProofreadingFileList();
    updateProofreadingPrompt();

    // 常用外漢字を検出してグローバル変数に保存＆ポップアップ表示
    if (state.proofreadingFiles.length > 0) {
        const detectedLines = detectNonJoyoLinesWithPageInfo(state.proofreadingFiles);
        state.proofreadingDetectedNonJoyoWords = detectedLines;
        showNonJoyoResultPopup(detectedLines, true);
    } else {
        state.proofreadingDetectedNonJoyoWords = [];
    }
}

// どこから校正ページに来たかを記録
// [moved to state] proofreadingReturnTo

// ホーム（ランディング画面）へ戻る - 校正ページから
function goToHomeFromProofreading() {
    const proofreading = document.getElementById('proofreadingPage');
    const landing = document.getElementById('landingScreen');
    const main = document.getElementById('mainWrapper');

    // アニメーション付き遷移
    proofreading.classList.add('page-transition-out-down');
    setTimeout(() => {
        proofreading.style.display = 'none';
        proofreading.classList.remove('page-transition-out-down');
        main.style.display = 'none';

        landing.style.display = 'flex';
        landing.classList.add('page-transition-up');
        setTimeout(() => {
            landing.classList.remove('page-transition-up');
        }, 350);
    }, 200);

    // 校正ページの状態をリセット
    clearProofreadingFiles();
    state.proofreadingReturnTo = 'landing';

    // ランディング画面のレーベル選択をリセット
    resetLandingLabelSelector();
}

// 校正ページから抽出プロンプトページへ遷移
async function goToExtractionFromProofreading() {
    const proofreading = document.getElementById('proofreadingPage');
    const main = document.getElementById('mainWrapper');
    const landing = document.getElementById('landingScreen');

    // アニメーション付き遷移（上にフェードアウト）
    proofreading.classList.add('page-transition-out');
    setTimeout(() => {
        proofreading.style.display = 'none';
        proofreading.classList.remove('page-transition-out');
        landing.style.display = 'none';

        main.style.display = 'flex';
        main.classList.add('page-transition-up');
        setTimeout(() => {
            main.classList.remove('page-transition-up');
        }, 350);
        updateHeaderSaveButtons();
    }, 200);

    // 校正ページのレーベル選択をメイン画面に反映
    const proofreadingLabelSelect = document.getElementById('proofreadingLabelSelect');
    const mainLabelSelect = document.getElementById('labelSelector');
    if (proofreadingLabelSelect && mainLabelSelect) {
        mainLabelSelect.value = proofreadingLabelSelect.value;
        await changeLabel(); // メイン画面のルールも更新
    }

    // 校正ページのTXTファイルを抽出ページに引き継ぐ
    if (state.proofreadingFiles && state.proofreadingFiles.length > 0) {
        state.manuscriptTxtFiles = [...state.proofreadingFiles];
        updateTxtUploadStatus();
    }

    // 校正ページの状態をリセット
    clearProofreadingFiles();
    state.proofreadingReturnTo = 'landing';
}

// 校正ページでレーベルを変更
async function changeProofreadingLabel() {
    const select = document.getElementById('proofreadingLabelSelect');
    const selectedValue = select.value;

    // ルールデータを読み込み（外部JSONから）
    await loadLabelRulesForProofreading(selectedValue);

    // ボタンテキスト更新
    const textEl = document.getElementById('proofreadingLabelSelectorText');
    if (textEl) textEl.textContent = selectedValue;

    // プロンプトを再生成
    updateProofreadingPrompt();
}

// 校正ページ用にレーベルのルールを読み込む
async function loadLabelRulesForProofreading(labelValue) {
    // 外部マスターJSONからルールを取得
    await loadMasterRule(labelValue);
}

// メイン画面から校正ページへ遷移
function goToProofreadingPageFromMain(mode) {
    state.proofreadingReturnTo = 'main';

    // モードを設定
    state.currentProofreadingMode = mode || 'simple';

    // 抽出ページのレーベル状態を校正ページに引き継ぐ
    const selectorGroup = document.getElementById('labelSelectorGroup');
    const displayGroup = document.getElementById('labelDisplayGroup');
    const displayText = document.getElementById('labelDisplayText');

    const proofSelectorGroup = document.getElementById('proofreadingLabelSelectorGroup');
    const proofDisplayGroup = document.getElementById('proofreadingLabelDisplayGroup');
    const proofDisplayText = document.getElementById('proofreadingLabelDisplayText');

    if (displayGroup && displayGroup.style.display !== 'none') {
        // 抽出ページが表示専用の場合：校正ページも表示専用
        if (proofSelectorGroup) proofSelectorGroup.style.display = 'none';
        if (proofDisplayGroup) proofDisplayGroup.style.display = 'flex';
        if (proofDisplayText && displayText) proofDisplayText.textContent = displayText.textContent;
    } else {
        // 抽出ページがボタン選択の場合：校正ページもボタン選択
        if (proofSelectorGroup) proofSelectorGroup.style.display = 'flex';
        if (proofDisplayGroup) proofDisplayGroup.style.display = 'none';
        const labelSelector = document.getElementById('labelSelector');
        const proofreadingLabelSelect = document.getElementById('proofreadingLabelSelect');
        const proofreadingLabelText = document.getElementById('proofreadingLabelSelectorText');
        if (proofreadingLabelSelect && labelSelector) {
            proofreadingLabelSelect.value = labelSelector.value;
        }
        if (proofreadingLabelText && labelSelector) {
            proofreadingLabelText.textContent = labelSelector.value || '選択してください';
        }
    }

    // 抽出ページのTXTファイルを校正ページに引き継ぐ
    if (state.manuscriptTxtFiles && state.manuscriptTxtFiles.length > 0) {
        state.proofreadingFiles = [...state.manuscriptTxtFiles];
        state.proofreadingContent = state.manuscriptTxtFiles.map(f => f.content).join('\n\n');
    }

    // アニメーション付き遷移
    const main = document.getElementById('mainWrapper');
    const proofreading = document.getElementById('proofreadingPage');
    const landing = document.getElementById('landingScreen');

    main.classList.add('page-transition-out');
    setTimeout(() => {
        landing.style.display = 'none';
        main.style.display = 'none';
        main.classList.remove('page-transition-out');

        proofreading.style.display = 'flex';
        proofreading.classList.add('page-transition-up');
        setTimeout(() => {
            proofreading.classList.remove('page-transition-up');
        }, 350);
    }, 200);

    // 簡易チェックオプションの表示
    const optionSection = document.getElementById('simpleCheckOptions');
    if (optionSection) {
        if (state.currentProofreadingMode === 'simple') {
            optionSection.classList.add('visible');
        } else {
            optionSection.classList.remove('visible');
        }
    }

    // モードボタンのアクティブ状態を更新
    document.querySelectorAll('.proofreading-mode-btn').forEach(btn => {
        if (btn.dataset.mode === state.currentProofreadingMode) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // チェック項目表示を更新
    updateProofreadingCheckItems();

    // チェックボックスラベルを更新（JSON状態に応じて）
    updateProofreadingOptionsLabel();

    // ファイルリストとプロンプトを更新
    renderProofreadingFileList();
    updateProofreadingPrompt();

    // 常用外漢字を検出してグローバル変数に保存＆ポップアップ表示
    if (state.proofreadingFiles.length > 0) {
        const detectedLines = detectNonJoyoLinesWithPageInfo(state.proofreadingFiles);
        state.proofreadingDetectedNonJoyoWords = detectedLines;
        showNonJoyoResultPopup(detectedLines, true);
    } else {
        state.proofreadingDetectedNonJoyoWords = [];
    }
}

// 校正モード切り替え
function switchProofreadingMode(mode) {
    state.currentProofreadingMode = mode;

    // モードボタンのアクティブ状態を更新
    document.querySelectorAll('.proofreading-mode-btn').forEach(btn => {
        if (btn.dataset.mode === mode) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // 簡易チェックオプションの表示/非表示を切り替え
    const optionSection = document.getElementById('simpleCheckOptions');
    if (optionSection) {
        if (mode === 'simple') {
            optionSection.classList.add('visible');
        } else {
            optionSection.classList.remove('visible');
        }
    }

    // チェック項目表示を更新
    updateProofreadingCheckItems();

    // プロンプトを再生成
    updateProofreadingPrompt();
}

// 校正用ファイル読み込み — COMIC-Bridge統合版: 親アプリのテキストを直接使用
function loadProofreadingFiles(input) {
    // COMIC-Bridge統合版: ファイル入力を無視し、親から同期
    syncProofreadingFromComicBridge();
}

// COMIC-Bridgeの親ウィンドウからテキストを取得して校正用stateに反映 + 常用外漢字検出
function syncProofreadingFromComicBridge() {
    var changed = false;
    try {
        var bridge = window.parent && window.parent.__COMIC_BRIDGE__;
        if (!bridge) return;
        var content = bridge.getTextContent();
        var fileName = bridge.getTextFileName() || 'text.txt';
        if (content) {
            // 同一内容なら更新しない
            if (state.proofreadingFiles.length === 1
                && state.proofreadingFiles[0].content === content
                && state.proofreadingFiles[0].name === fileName) {
                // 内容同一でも初回は常用外漢字検出を行う
                if (state.proofreadingDetectedNonJoyoWords && state.proofreadingDetectedNonJoyoWords.length >= 0
                    && state._proofNonJoyoRan) return;
            }
            state.proofreadingFiles = [{
                name: fileName,
                content: content,
                size: new Blob([content]).size
            }];
            state.proofreadingContent = content;
            changed = true;
        } else {
            if (state.proofreadingFiles.length === 0) return;
            state.proofreadingFiles = [];
            state.proofreadingContent = '';
            state.proofreadingDetectedNonJoyoWords = [];
            changed = true;
        }
    } catch (e) { /* cross-origin */ }
    renderProofreadingFileList();
    updateProofreadingPrompt();

    // 常用外漢字検出
    if (state.proofreadingFiles.length > 0) {
        try {
            var detected = detectNonJoyoLinesWithPageInfo(state.proofreadingFiles);
            state.proofreadingDetectedNonJoyoWords = detected;
            state._proofNonJoyoRan = true;
            showNonJoyoResultPopup(detected, true);
        } catch (e) { /* ignore */ }
    }
}

// 校正用ファイルリスト描画
function renderProofreadingFileList() {
    const statusEl = document.getElementById('proofreadingFileStatus');
    const manageBtn = document.getElementById('proofreadingManageBtn');
    if (manageBtn) manageBtn.style.display = 'none';

    if (state.proofreadingFiles.length === 0) {
        if (statusEl) { statusEl.textContent = 'テキスト未読込'; statusEl.style.color = ''; }
        return;
    }
    if (statusEl) {
        statusEl.textContent = '✓ ' + state.proofreadingFiles[0].name;
        statusEl.style.color = '#27ae60';
    }
}

// 校正用ファイル個別削除
function removeProofreadingFile(index) {
    state.proofreadingFiles.splice(index, 1);
    state.proofreadingContent = state.proofreadingFiles.map(f => f.content).join('\n\n--- 次のファイル ---\n\n');
    renderProofreadingFileList();
    updateProofreadingPrompt();
}

// 校正用ファイル全クリア
function clearProofreadingFiles() {
    state.proofreadingFiles = [];
    state.proofreadingContent = '';
    renderProofreadingFileList();
    updateProofreadingPrompt();
}

// 校正用TXT管理モーダルを開く
function openProofreadingTxtManageModal() {
    renderProofreadingTxtFileList();
    document.getElementById('proofreadingTxtManageModal').style.display = 'flex';
}

// 校正用TXT管理モーダルを閉じる
function closeProofreadingTxtManageModal() {
    document.getElementById('proofreadingTxtManageModal').style.display = 'none';
}

// 校正用TXTファイルリスト描画（モーダル内）
function renderProofreadingTxtFileList() {
    const listEl = document.getElementById('proofreadingTxtFileList');
    const totalInfoEl = document.getElementById('proofreadingTxtTotalInfo');

    if (state.proofreadingFiles.length === 0) {
        listEl.innerHTML = '<p style="color:#999; text-align:center; padding:15px;">読み込まれたファイルはありません</p>';
        if (totalInfoEl) totalInfoEl.textContent = '';
        return;
    }

    let totalSize = 0;
    listEl.innerHTML = state.proofreadingFiles.map((file, index) => {
        const sizeKB = (file.size / 1024).toFixed(1);
        totalSize += file.size;
        return `
            <div class="txt-file-item">
                <div class="txt-file-info">
                    <span class="txt-file-icon">📄</span>
                    <span class="txt-file-name">${file.name}</span>
                    <span class="txt-file-size">${sizeKB}KB</span>
                </div>
                <button class="txt-file-remove" onclick="removeProofreadingTxtFile(${index})">削除</button>
            </div>
        `;
    }).join('');

    if (totalInfoEl) {
        const totalKB = (totalSize / 1024).toFixed(1);
        totalInfoEl.textContent = `${state.proofreadingFiles.length}ファイル / 合計 ${totalKB}KB`;
    }
}

// 校正用TXTファイルを追加（モーダルから）
function addProofreadingTxt(input) {
    const files = Array.from(input.files);
    if (files.length === 0) return;

    let loadedCount = 0;
    const fileInfos = [];

    files.forEach((file, index) => {
        const reader = new FileReader();
        reader.onload = function(e) {
            fileInfos[index] = {
                name: file.name,
                content: e.target.result,
                size: file.size
            };
            loadedCount++;

            if (loadedCount === files.length) {
                state.proofreadingFiles = state.proofreadingFiles.concat(fileInfos);
                state.proofreadingContent = state.proofreadingFiles.map(f => f.content).join('\n\n--- 次のファイル ---\n\n');
                renderProofreadingFileList();
                renderProofreadingTxtFileList();
                // 常用外漢字を検出してグローバル変数に保存＆ポップアップ表示
                const detectedLines = detectNonJoyoLinesWithPageInfo(state.proofreadingFiles);
                state.proofreadingDetectedNonJoyoWords = detectedLines;
                showNonJoyoResultPopup(detectedLines, true);
                updateProofreadingPrompt();
            }
        };
        reader.readAsText(file);
    });

    input.value = '';
}

// 校正用TXTファイル個別削除（モーダルから）
function removeProofreadingTxtFile(index) {
    if (index >= 0 && index < state.proofreadingFiles.length) {
        state.proofreadingFiles.splice(index, 1);
        state.proofreadingContent = state.proofreadingFiles.map(f => f.content).join('\n\n--- 次のファイル ---\n\n');
        renderProofreadingFileList();
        renderProofreadingTxtFileList();
        updateProofreadingPrompt();
    }
}

// 校正用TXTファイル全クリア（モーダルから）
function clearAllProofreadingTxt() {
    if (state.proofreadingFiles.length === 0) return;
    if (!confirm('すべてのセリフTXTファイルをクリアしますか？')) return;

    state.proofreadingFiles = [];
    state.proofreadingContent = '';
    renderProofreadingFileList();
    renderProofreadingTxtFileList();
    updateProofreadingPrompt();
}

// プロンプト更新
function updateProofreadingPrompt() {

    const outputEl = document.getElementById('proofreadingOutput');
    const copyBtn = document.getElementById('proofreadingCopyBtn');
    const geminiBtn = document.getElementById('proofreadingGeminiBtn');

    if (state.proofreadingFiles.length === 0) {
        outputEl.value = '';
        copyBtn.disabled = true;
        geminiBtn.disabled = true;
        return;
    }

    // モードに応じてプロンプトを生成
    let prompt;
    if (state.currentProofreadingMode === 'simple') {
        // 正誤チェックは常に統一表記ルール反映確認を含む
        prompt = generateSimpleCheckWithRulesPromptWithText(state.proofreadingContent);
    } else {
        prompt = generateVariationCheckPromptWithText(state.proofreadingContent);
    }

    outputEl.value = prompt;
    copyBtn.disabled = false;
    geminiBtn.disabled = false;
}

// チェック項目表示更新
function updateProofreadingCheckItems() {
    const container = document.getElementById('proofreadingCheckItems');

    if (state.currentProofreadingMode === 'simple') {
        // 正誤チェックは常に統一表記ルール確認を含む
        let html = `
            <div class="proofreading-check-header">
                <span class="proofreading-check-icon"><span class="svg-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></span></span>
                <h4>正誤チェック項目（7項目 + ルール確認）</h4>
            </div>
            <div class="proofreading-check-list">
                <div class="proofreading-check-item simple">
                    <span class="svg-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></span> 誤字・脱字 - 変換ミス、タイプミス、文字抜け
                </div>
                <div class="proofreading-check-item simple">
                    <span class="svg-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span> 人名ルビ - 初出の人名にルビ確認
                </div>
                <div class="proofreading-check-item simple">
                    <span class="svg-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg></span> 常用外漢字 - ルビ付け要否の確認
                </div>
                <div class="proofreading-check-item simple">
                    <span class="svg-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></span> 熟字訓 - 特殊な読みを持つ熟語のルビ確認
                </div>
                <div class="proofreading-check-item simple">
                    <span class="svg-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg></span> 単位の誤り - 文脈に合わない単位
                </div>
                <div class="proofreading-check-item simple">
                    <span class="svg-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span> 伏字チェック - NGワードが伏字化されているか
                </div>
                <div class="proofreading-check-item simple">
                    <span class="svg-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg></span> 人物名チェック - 登録名との誤記・揺れ
                </div>
                <div class="proofreading-check-divider"></div>
                <div class="proofreading-check-item rules">
                    <span class="svg-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg></span> 統一表記ルール反映確認
                </div>
            </div>`;
        container.innerHTML = html;
    } else {
        container.innerHTML = `
            <div class="proofreading-check-header">
                <span class="proofreading-check-icon"><span class="svg-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></span></span>
                <h4>提案チェック項目（10項目）</h4>
            </div>
            <div class="proofreading-check-list">
                <div class="proofreading-check-item variation">
                    <span class="svg-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg></span> 漢字/ひらがな統一
                </div>
                <div class="proofreading-check-item variation">
                    <span class="svg-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 14l-3-3h-7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v10z"/><path d="M14 15v2a1 1 0 0 1-1 1H6l-3 3V11a1 1 0 0 1 1-1h2"/></svg></span> カタカナ表記
                </div>
                <div class="proofreading-check-item variation">
                    <span class="svg-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="21" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="21" y1="18" x2="3" y2="18"/></svg></span> 送り仮名の違い
                </div>
                <div class="proofreading-check-item variation">
                    <span class="svg-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg></span> 長音記号の有無
                </div>
                <div class="proofreading-check-item variation">
                    <span class="svg-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/></svg></span> 中黒の有無
                </div>
                <div class="proofreading-check-item variation">
                    <span class="svg-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="9" x2="19" y2="9"/><line x1="5" y1="15" x2="19" y2="15"/></svg></span> イコールの有無
                </div>
                <div class="proofreading-check-item variation">
                    <span class="svg-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></span> 巻またぎ表記
                </div>
                <div class="proofreading-check-item variation">
                    <span class="svg-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg></span> 固有名詞・商標
                </div>
                <div class="proofreading-check-item variation">
                    <span class="svg-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><rect x="3" y="8" width="7" height="13" rx="1"/><rect x="14" y="8" width="7" height="13" rx="1"/></svg></span> 専門用語・事実の正確性
                </div>
                <div class="proofreading-check-item variation">
                    <span class="svg-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg></span> 未成年表現チェック
                </div>
            </div>
        `;
    }
}

// チェックボックスラベルを更新（JSON読み込み状態に応じて）- 現在は未使用
function updateProofreadingOptionsLabel() {
    // 正誤チェックは常に統一表記ルールを含むため、この関数は不要
    return;

    if (!label || !desc) return;

    if (state.currentLoadedJson) {
        // JSONが読み込まれている場合
        label.textContent = '表記ルールの反映確認を含める';
        desc.textContent = 'JSONに登録された表記ルール・記号ルールが正しく適用されているかを確認します';
    } else {
        // JSONが読み込まれていない場合（従来通り）
        label.textContent = '統一表記ルールの反映確認を含める';
        desc.textContent = '選択中のレーベルの表記ルール・記号ルールが正しく適用されているかを確認します';
    }
}

// プロンプトをコピー
function copyProofreadingPrompt() {
    const outputEl = document.getElementById('proofreadingOutput');
    const prompt = outputEl.value;

    if (!prompt) return;

    navigator.clipboard.writeText(prompt).then(() => {
        const copyBtn = document.getElementById('proofreadingCopyBtn');
        const originalText = copyBtn.innerHTML;
        copyBtn.innerHTML = '✓ コピーしました';
        copyBtn.style.background = 'var(--sage)';

        setTimeout(() => {
            copyBtn.innerHTML = originalText;
            copyBtn.style.background = '';
        }, 2000);
    });
}

// コピーしてGeminiで開く（校正ページ用）
function copyAndOpenGeminiForProofreading() {
    const outputEl = document.getElementById('proofreadingOutput');
    const prompt = outputEl.value;

    if (!prompt) return;

    navigator.clipboard.writeText(prompt).then(() => {
        window.open('https://gemini.google.com/app', '_blank');

        const geminiBtn = document.getElementById('proofreadingGeminiBtn');
        const originalText = geminiBtn.innerHTML;
        geminiBtn.innerHTML = '✓ コピー&開きました';

        setTimeout(() => {
            geminiBtn.innerHTML = originalText;
        }, 2000);
    });
}

// 折りたたみフォーム
function toggleAddForm() {
    const body = document.getElementById('addFormBody');
    const toggle = document.getElementById('addFormToggle');
    body.classList.toggle('active');
    toggle.textContent = body.classList.contains('active') ? '▲' : '▼';
}

function toggleSymbolForm() {
    const body = document.getElementById('symbolFormBody');
    const toggle = document.getElementById('symbolFormToggle');
    body.classList.toggle('active');
    toggle.textContent = body.classList.contains('active') ? '▲' : '▼';
}

// モーダル外クリックで閉じる
document.addEventListener('click', function(e) {
    if (e.target.id === 'previewModal') {
        closePreviewModal();
    }
    if (e.target.id === 'jsonFolderBrowserModal') {
        closeJsonFolderBrowser();
    }
    if (e.target.id === 'labelSelectModal') {
        closeLabelSelectModal();
    }
});


// ES Module exports
export { showProofreadingPage, goToProofreadingPage, goToHomeFromProofreading, goToExtractionFromProofreading, changeProofreadingLabel, loadLabelRulesForProofreading, goToProofreadingPageFromMain, switchProofreadingMode, loadProofreadingFiles, renderProofreadingFileList, removeProofreadingFile, clearProofreadingFiles, openProofreadingTxtManageModal, closeProofreadingTxtManageModal, renderProofreadingTxtFileList, addProofreadingTxt, removeProofreadingTxtFile, clearAllProofreadingTxt, updateProofreadingPrompt, updateProofreadingCheckItems, updateProofreadingOptionsLabel, copyProofreadingPrompt, copyAndOpenGeminiForProofreading, toggleAddForm, toggleSymbolForm };

// Expose to window for inline HTML handlers
Object.assign(window, { showProofreadingPage, goToProofreadingPage, goToHomeFromProofreading, goToExtractionFromProofreading, changeProofreadingLabel, loadLabelRulesForProofreading, goToProofreadingPageFromMain, switchProofreadingMode, loadProofreadingFiles, syncProofreadingFromComicBridge, renderProofreadingFileList, removeProofreadingFile, clearProofreadingFiles, openProofreadingTxtManageModal, closeProofreadingTxtManageModal, renderProofreadingTxtFileList, addProofreadingTxt, removeProofreadingTxtFile, clearAllProofreadingTxt, updateProofreadingPrompt, updateProofreadingCheckItems, updateProofreadingOptionsLabel, copyProofreadingPrompt, copyAndOpenGeminiForProofreading, toggleAddForm, toggleSymbolForm });
