/* =========================================
   ランディング画面
   ========================================= */

import { state } from './progen-state.js';
// レーベルボタンをクリックして直接開始
async function startWithLabelDirect(label) {
    // メインのセレクタにも反映
    document.getElementById('labelSelector').value = label;

    // ランディング画面を非表示にしてメイン画面を表示
    hideLandingScreen();

    // データを読み込んで初期化
    await changeLabel();
    renderSymbolTable();
}

// ドロップダウンから選択して開始
async function startWithSelectedLabel() {
    const selector = document.getElementById('landingLabelSelect');
    const label = selector ? selector.value : 'default';
    await startWithLabelDirect(label);
}

// ランディング画面用: 校正プロンプトのTXT読み込み
// COMIC-Bridge統合版: ランディングのテキスト読み込みは親から自動取得
function loadLandingProofreadingTxt(input) {
    syncLandingProofreadingFromBridge();
    renderLandingProofreadingFileList();
}

function syncLandingProofreadingFromBridge() {
    try {
        var bridge = window.parent && window.parent.__COMIC_BRIDGE__;
        if (!bridge) return;
        var content = bridge.getTextContent();
        var fileName = bridge.getTextFileName() || 'text.txt';
        if (content) {
            state.landingProofreadingFiles = [{ name: fileName, content: content, size: new Blob([content]).size }];
            state.landingProofreadingContent = content;
        } else {
            state.landingProofreadingFiles = [];
            state.landingProofreadingContent = '';
        }
    } catch (e) { /* cross-origin */ }
}

function renderLandingProofreadingFileList() {
    var statusEl = document.getElementById('landingProofreadingStatus');
    var clearBtn = document.getElementById('landingProofreadingClearBtn');
    var listEl = document.getElementById('landingProofreadingFileList');
    if (clearBtn) clearBtn.style.display = 'none'; // 不要

    if (state.landingProofreadingFiles.length > 0) {
        if (statusEl) { statusEl.textContent = '✓ ' + state.landingProofreadingFiles[0].name; statusEl.style.color = '#27ae60'; }
        if (listEl) listEl.innerHTML = '';
    } else {
        if (statusEl) { statusEl.textContent = 'テキスト未読込'; statusEl.style.color = '#888'; }
        if (listEl) listEl.innerHTML = '';
    }
}

function clearLandingProofreadingFiles() {
    state.landingProofreadingFiles = [];
    state.landingProofreadingContent = '';
    renderLandingProofreadingFileList();
}

// ランディング画面から詳細チェックを開始
function startLandingVariationCheck() {
    if (!state.landingProofreadingContent) {
        showToast('セリフTXTファイルを読み込んでください', 'warning');
        return;
    }

    const prompt = generateVariationCheckPromptWithText(state.landingProofreadingContent);
    navigator.clipboard.writeText(prompt).then(() => {
        window.open('https://gemini.google.com/app', '_blank');
    });
}

// ランディング画面から簡易チェックを開始
function startLandingSimpleCheck() {
    if (!state.landingProofreadingContent) {
        showToast('セリフTXTファイルを読み込んでください', 'warning');
        return;
    }

    const prompt = generateSimpleCheckPromptWithText(state.landingProofreadingContent);
    navigator.clipboard.writeText(prompt).then(() => {
        window.open('https://gemini.google.com/app', '_blank');
    });
}

// ========== 画面遷移アニメーション ヘルパー ==========

// アニメーション付き画面遷移
function transitionPages(fromEl, toEl, outClass = 'page-transition-out', inClass = 'page-transition') {
    return new Promise(resolve => {
        // 退出アニメーション
        fromEl.classList.add(outClass);

        setTimeout(() => {
            fromEl.style.display = 'none';
            fromEl.classList.remove(outClass);

            // 入場アニメーション
            toEl.style.display = 'flex';
            toEl.classList.add(inClass);

            setTimeout(() => {
                toEl.classList.remove(inClass);
                resolve();
            }, 350);
        }, 200);
    });
}

// ランディング画面を非表示（アニメーション付き）
function hideLandingScreen() {
    const landing = document.getElementById('landingScreen');
    const main = document.getElementById('mainWrapper');

    transitionPages(landing, main, 'page-transition-out-zoom', 'page-transition-zoom-in');

    // データ種類に応じてセリフTXT読込ボタンの表示を更新
    const dataType = document.getElementById('dataTypeSelector').value;
    const txtUploadGroup = document.getElementById('txtUploadGroup');
    if (txtUploadGroup) {
        txtUploadGroup.style.display = (dataType === 'pdf_only') ? 'none' : '';
    }
}

// ホーム画面（ランディング画面）に戻る（アニメーション付き）
function goToHome() {
    const landing = document.getElementById('landingScreen');
    const main = document.getElementById('mainWrapper');

    // ランディング画面のレーベル選択をリセット
    resetLandingLabelSelector();

    transitionPages(main, landing, 'page-transition-out-down', 'page-transition-up');
}

// 抽出プロンプトを開始
async function startExtraction() {
    const select = document.getElementById('landingLabelSelect');
    const selectedValue = select.value;

    // メイン画面のラベルセレクターを同期
    document.getElementById('labelSelector').value = selectedValue;

    // レーベル表示テキストを更新
    const textEl = document.getElementById('labelSelectorText');
    if (textEl) {
        textEl.textContent = selectedValue;
        textEl.classList.remove('unselected');
    }

    // 添付ファイルトグル・Geminiボタンのロックを解除
    if (typeof enableDataTypeToggle === 'function') enableDataTypeToggle();
    const geminiBtn = document.getElementById('extractionGeminiBtn');
    if (geminiBtn) geminiBtn.removeAttribute('disabled');

    // ルールをロード（外部JSONから）
    await loadMasterRule(selectedValue);

    // 画面表示を更新（編集モードで初期表示）
    state.currentViewMode = 'edit';
    state.currentEditCategory = 'symbol';
    renderTable();
    showEditMode();
    generateXML();

    // メイン画面へ
    hideLandingScreen();
}

// 整形プロンプトを開始（抽出と同じだがTXTのみプリセット）
async function startFormatting() {
    const select = document.getElementById('landingLabelSelect');
    const selectedValue = select.value;

    // メイン画面のラベルセレクターを同期
    document.getElementById('labelSelector').value = selectedValue;

    // レーベル表示テキストを更新
    const textEl = document.getElementById('labelSelectorText');
    if (textEl) {
        textEl.textContent = selectedValue;
        textEl.classList.remove('unselected');
    }

    // 添付ファイルトグル・Geminiボタンのロックを解除
    if (typeof enableDataTypeToggle === 'function') enableDataTypeToggle();
    const geminiBtn = document.getElementById('extractionGeminiBtn');
    if (geminiBtn) geminiBtn.removeAttribute('disabled');

    // ルールをロード（外部JSONから）
    await loadMasterRule(selectedValue);

    // 画面表示を更新（編集モードで初期表示）
    state.currentViewMode = 'edit';
    state.currentEditCategory = 'symbol';
    renderTable();
    showEditMode();
    generateXML();

    // メイン画面へ
    hideLandingScreen();

    // 添付ファイルを「TXTのみ」に設定 & モードスイッチャーを整形に切り替え
    selectDataType('txt_only');
    updateModeSwitcherButtons('formattingModeBtn');
}

// 校正プロンプトを開始
async function startProofreading() {
    const select = document.getElementById('landingLabelSelect');
    const selectedValue = select.value;

    // 校正ページのレーベルドロップダウンを同期
    const proofreadingLabelSelect = document.getElementById('proofreadingLabelSelect');
    if (proofreadingLabelSelect) {
        proofreadingLabelSelect.value = selectedValue;
    }

    // レーベル表示テキストを更新
    const textEl = document.getElementById('proofreadingLabelSelectorText');
    if (textEl) {
        textEl.textContent = selectedValue;
        textEl.classList.remove('unselected');
    }

    // 選択されたレーベルのルールを読み込む（外部JSONから）
    await loadLabelRulesForProofreading(selectedValue);

    // ランディングから来たことを記録
    state.proofreadingReturnTo = 'landing';

    // 校正ページへ遷移（デフォルトは簡易チェック）
    state.currentProofreadingMode = 'simple';
    showProofreadingPage();

    // 簡易チェックオプションを表示
    const optionSection = document.getElementById('simpleCheckOptions');
    if (optionSection) {
        optionSection.classList.add('visible');
    }

    // モードボタンのアクティブ状態を更新
    document.querySelectorAll('.proofreading-mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === 'simple');
    });

    // チェック項目表示を更新
    updateProofreadingCheckItems();

    // ファイルリストとプロンプトを更新
    renderProofreadingFileList();
    updateProofreadingPrompt();
}

// 初期化（ランディング画面を表示した状態で開始）
function init() {
    // ランディング画面が表示されている状態で開始
    // 何もしない（レーベル選択またはJSON読み込み後に初期化される）
}

// 表示モード切り替え（編集モード ⇔ 一覧表示）
function toggleViewMode() {
    if (state.currentViewMode === 'edit') {
        state.currentViewMode = 'list';
        showListMode();
    } else {
        state.currentViewMode = 'edit';
        showEditMode();
    }
}

// 編集モードを表示
function showEditMode() {
    const tableMode = document.getElementById('tableModeContainer');
    const editMode = document.getElementById('editModeContainer');
    const viewToggle = document.getElementById('viewToggleBtn');
    const searchBar = document.getElementById('editSearchBar');

    if (tableMode && tableMode.classList.contains('active')) {
        tableMode.classList.add('content-fade-out');
        setTimeout(() => {
            tableMode.classList.remove('content-fade-out');
            tableMode.classList.remove('active');
            if (editMode) {
                editMode.classList.add('active');
                editMode.classList.add('content-fade-in');
                setTimeout(() => editMode.classList.remove('content-fade-in'), 200);
            }
            if (viewToggle) viewToggle.innerHTML = '<span class="svg-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg></span> 一覧表示';
            if (searchBar) searchBar.style.display = '';
            renderEditCardMode();
        }, 150);
    } else {
        if (editMode) editMode.classList.add('active');
        if (viewToggle) viewToggle.innerHTML = '<span class="svg-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg></span> 一覧表示';
        if (searchBar) searchBar.style.display = '';
        renderEditCardMode();
    }
}

// 一覧表示モードを表示
function showListMode() {
    const editMode = document.getElementById('editModeContainer');
    const tableMode = document.getElementById('tableModeContainer');
    const viewToggle = document.getElementById('viewToggleBtn');
    const searchBar = document.getElementById('editSearchBar');

    if (editMode && editMode.classList.contains('active')) {
        editMode.classList.add('content-fade-out');
        setTimeout(() => {
            editMode.classList.remove('content-fade-out');
            editMode.classList.remove('active');
            if (tableMode) {
                tableMode.classList.add('active');
                tableMode.classList.add('content-fade-in');
                setTimeout(() => tableMode.classList.remove('content-fade-in'), 200);
            }
            if (viewToggle) viewToggle.innerHTML = '<span class="svg-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></span> 編集に戻る';
            if (searchBar) searchBar.style.display = 'none';
            renderTableMode();
        }, 150);
    } else {
        if (tableMode) tableMode.classList.add('active');
        if (viewToggle) viewToggle.innerHTML = '<span class="svg-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></span> 編集に戻る';
        if (searchBar) searchBar.style.display = 'none';
        renderTableMode();
    }
}

// 現在の表示モードに応じて再描画
function refreshCurrentView() {
    if (state.currentViewMode === 'edit') {
        renderEditCardMode();
    } else {
        renderTableMode();
    }
}

// 表モードの描画（カテゴリ横並び）
function renderTableMode() {
    const grid = document.getElementById('categoryGrid');
    grid.innerHTML = '';

    // カラム1: 基本的に表記変更されるもの
    renderColumn1(grid);

    // カラム2: 表記が推奨されるもの + 人称 + 人物名
    renderColumn2(grid);

    // カラム3: その他表記ルール + 追加項目
    renderColumn3(grid);
}

// カラム1: 基本的に表記変更されるもの
function renderColumn1(grid) {
    const basicRules = state.currentProofRules.filter(r => r.category === 'basic');
    const recommendedRules = state.currentProofRules.filter(r => r.category === 'recommended');
    const allRules = [...basicRules, ...recommendedRules];
    const activeCount = allRules.filter(r => r.active).length;
    const totalCount = allRules.length;

    const box = document.createElement('div');
    box.className = 'category-box';

    let contentHtml = `
        <div class="category-header basic">
            <span><span class="svg-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></span> 表記変更</span>
            <span class="count">${activeCount}/${totalCount}</span>
        </div>
        <div class="category-content" style="overflow-y: auto;">
    `;

    contentHtml += `
        <table class="category-table excel-style" data-category="notation">
            <tbody></tbody>
        </table>
    `;

    contentHtml += `</div>`;
    box.innerHTML = contentHtml;

    // テーブルにデータ追加
    const tbody = box.querySelector('table[data-category="notation"] tbody');
    if (tbody) {
        allRules.forEach((rule) => {
            const originalIndex = state.currentProofRules.indexOf(rule);
            const tr = document.createElement('tr');
            tr.style.cursor = 'pointer';
            if (!rule.active) tr.classList.add('inactive');
            tr.innerHTML = `
                <td class="col-on"><input type="checkbox" ${rule.active ? 'checked' : ''} onclick="event.stopPropagation(); toggleRule(${originalIndex})"></td>
                <td class="col-src">${escapeHtml(rule.src)}</td>
                <td class="col-arrow">→</td>
                <td class="col-dst">${escapeHtml(rule.dst)}</td>
            `;
            tr.addEventListener('click', (e) => {
                if (e.target.type === 'checkbox') return;
                state.currentEditCategory = 'notation';
                state.currentViewMode = 'edit';
                showEditMode();
            });
            tbody.appendChild(tr);
        });
    }

    grid.appendChild(box);
}

// カラム2: 表記が推奨されるもの + 人称 + 人物名 + 補助動詞
function renderColumn2(grid) {
    const box = document.createElement('div');
    box.className = 'category-box';

    // 3カテゴリを1つのカードにまとめる
    const categoriesToShow = ['auxiliary', 'pronoun', 'character'];
    const categoryNames = {
        auxiliary: '<span class="svg-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg></span> 補助動詞',
        pronoun: '<span class="svg-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span> 人称',
        character: '<span class="svg-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg></span> 人物名（ルビ用）'
    };

    let contentHtml = `<div class="category-header recommended"><span><span class="svg-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></span> 補助動詞・人称・人物名</span></div>`;
    contentHtml += `<div class="category-content" style="overflow-y: auto;">`;

    categoriesToShow.forEach(catKey => {
        const rulesInCat = state.currentProofRules.filter(r => r.category === catKey);
        if (rulesInCat.length === 0) return;

        const activeCount = rulesInCat.filter(r => r.active).length;
        const totalCount = rulesInCat.length;
        const countLabel = catKey === 'auxiliary' ? '' : ` <span style="color:#888;">(${activeCount}/${totalCount})</span>`;

        contentHtml += `
            <div class="sub-category-header" style="background:var(--surface-dim); padding:6px 10px; font-size:0.75em; font-weight:bold; color:var(--text-secondary); border-bottom:1px solid var(--border);">
                ${categoryNames[catKey]}${countLabel}
            </div>
            <table class="category-table excel-style" data-category="${catKey}">
                <tbody></tbody>
            </table>
        `;
    });

    contentHtml += `</div>`;
    box.innerHTML = contentHtml;

    // 各テーブルにデータを追加
    categoriesToShow.forEach(catKey => {
        const rulesInCat = state.currentProofRules.filter(r => r.category === catKey);

        // 補助動詞は一括チェックボックス + 具体例表示のみ
        if (catKey === 'auxiliary') {
            const auxContainer = box.querySelector(`table[data-category="auxiliary"]`);
            if (!auxContainer) return;
            const isActive = rulesInCat.some(r => r.active);
            const wrapper = document.createElement('div');
            wrapper.style.padding = '8px 10px';
            wrapper.innerHTML = `
                <label style="display:flex; align-items:center; gap:6px; cursor:pointer; font-size:0.85em; margin-bottom:6px;">
                    <input type="checkbox" ${isActive ? 'checked' : ''}
                           onchange="toggleAuxiliaryAll(this.checked)">
                    <span>補助動詞はひらく</span>
                </label>
                <div style="font-size:0.7em; color:#999; padding-left:22px;">
                    ${rulesInCat.map(r => `${escapeHtml(r.src)} → ${escapeHtml(r.dst)}`).join('、')}
                </div>
            `;
            auxContainer.parentNode.replaceChild(wrapper, auxContainer);
            return;
        }

        const tbody = box.querySelector(`table[data-category="${catKey}"] tbody`);
        if (!tbody) return;

        rulesInCat.forEach((rule) => {
            const originalIndex = state.currentProofRules.indexOf(rule);
            const tr = document.createElement('tr');
            tr.style.cursor = 'pointer';
            if (!rule.active) tr.classList.add('inactive');
            tr.innerHTML = `
                <td class="col-on"><input type="checkbox" ${rule.active ? 'checked' : ''} onclick="event.stopPropagation(); toggleRule(${originalIndex})"></td>
                <td class="col-src">${escapeHtml(rule.src)}</td>
                <td class="col-arrow">→</td>
                <td class="col-dst">${escapeHtml(rule.dst)}</td>
            `;
            // クリックでそのカテゴリの編集モードに遷移
            tr.addEventListener('click', (e) => {
                if (e.target.type === 'checkbox') return;
                state.currentEditCategory = catKey;
                state.currentViewMode = 'edit';
                showEditMode();
            });
            tbody.appendChild(tr);
        });
    });

    grid.appendChild(box);
}

// カラム3: その他表記ルール + 難読漢字
function renderColumn3(grid) {
    const difficultRules = state.currentProofRules.filter(r => r.category === 'difficult');
    // デフォルトルールはひらく固定、ユーザー追加分はモード依存
    difficultRules.forEach(r => {
        if (!r.userAdded) { r.mode = 'open'; r.active = true; }
        else if (!r.mode) { r.mode = 'open'; }
    });

    const box = document.createElement('div');
    box.className = 'category-box';

    let html = `
        <div class="category-header options">
            <span><span class="svg-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></span> その他 表記ルール</span>
        </div>
        <div class="category-content" style="overflow-y: auto;">
            <div class="category-options" style="border-bottom: 1px solid #ddd;">
                <div class="option-row">
                    <label>
                        <input type="checkbox" ${state.optionNgWordMasking ? 'checked' : ''} onchange="toggleOption('ngWordMasking', this.checked)">
                        <span>伏字対応</span>
                    </label>
                </div>
                <div class="option-row">
                    <label>
                        <input type="checkbox" ${state.optionPunctuationToSpace ? 'checked' : ''} onchange="toggleOption('punctuationToSpace', this.checked)">
                        <span>句読点を半角スペースに</span>
                    </label>
                </div>
            </div>`;
                /* 見直しチェック項目は常時ONのため非表示（コード保持）
                <div class="option-row" style="border-top: 1px solid #ddd; margin-top: 4px; padding-top: 6px;">
                    <label style="font-weight: bold; color: #666; font-size: 0.75em;">
                        <span>見直しチェック</span>
                    </label>
                </div>
                <div class="option-row">
                    <label>
                        <input type="checkbox" ${state.optionTypoCheck ? 'checked' : ''} onchange="toggleOption('typoCheck', this.checked)">
                        <span>誤字チェック</span>
                    </label>
                </div>
                <div class="option-row">
                    <label>
                        <input type="checkbox" ${state.optionMissingCharCheck ? 'checked' : ''} onchange="toggleOption('missingCharCheck', this.checked)">
                        <span>脱字チェック</span>
                    </label>
                </div>
                <div class="option-row">
                    <label>
                        <input type="checkbox" ${state.optionNameRubyCheck ? 'checked' : ''} onchange="toggleOption('nameRubyCheck', this.checked)">
                        <span>人名ルビふり確認</span>
                    </label>
                </div>
                */

    // 数字ルールサマリー
    html += `
        <div class="sub-category-header" style="background:var(--copper); padding:6px 10px; font-size:0.75em; font-weight:bold; color:white;">
            🔢 数字
        </div>
        <div class="number-summary" onclick="state.currentEditCategory='number'; state.currentViewMode='edit'; showEditMode();">
            <div><span class="number-summary-label">基本:</span>${numberBaseOptions[state.numberRuleBase] || numberBaseOptions[0]}</div>
            ${state.numberSubRulesEnabled ? `<div><span class="number-summary-label">人数:</span>${numberSubRules.personCount.options[state.numberRulePersonCount]}</div>
            <div><span class="number-summary-label">戸数:</span>${numberSubRules.thingCount.options[state.numberRuleThingCount]}</div>
            <div><span class="number-summary-label">月:</span>${numberSubRules.month.options[state.numberRuleMonth]}</div>` : `<div style="color:#999; font-size:0.85em;">サブルール指定なし</div>`}
        </div>`;

    // 難読漢字テーブル（常に表示）
    if (difficultRules.length > 0) {
        html += `
            <div class="sub-category-header" style="background:var(--plum); padding:6px 10px; font-size:0.75em; font-weight:bold; color:white;">
                🔤 難読漢字（すべてひらく）
            </div>
            <table class="category-table excel-style" data-category="difficult">
                <tbody></tbody>
            </table>`;
    }

    html += `</div>`;
    box.innerHTML = html;

    // 難読漢字テーブルにデータを追加
    const diffTbody = box.querySelector('table[data-category="difficult"] tbody');
    if (diffTbody) {
        difficultRules.forEach((rule) => {
            const tr = document.createElement('tr');
            tr.style.cursor = 'pointer';
            if (rule.userAdded && rule.mode === 'none') tr.classList.add('inactive');

            if (rule.userAdded) {
                let statusBadge;
                if (rule.mode === 'open') {
                    statusBadge = '<span class="diff-status-badge open">ひらく</span>';
                } else if (rule.mode === 'ruby') {
                    statusBadge = '<span class="diff-status-badge ruby">ルビ</span>';
                } else {
                    statusBadge = '<span class="diff-status-badge none">なし</span>';
                }
                tr.innerHTML = `
                    <td class="col-status">${statusBadge}</td>
                    <td class="col-src">${escapeHtml(rule.src)}</td>
                    <td class="col-arrow">→</td>
                    <td class="col-dst">${escapeHtml(rule.dst)}</td>
                `;
            } else {
                tr.innerHTML = `
                    <td class="col-status"><span class="diff-status-badge open">ひらく</span></td>
                    <td class="col-src">${escapeHtml(rule.src)}</td>
                    <td class="col-arrow">→</td>
                    <td class="col-dst">${escapeHtml(rule.dst)}</td>
                `;
            }
            tr.addEventListener('click', () => {
                state.currentEditCategory = 'difficult';
                state.currentViewMode = 'edit';
                showEditMode();
            });
            diffTbody.appendChild(tr);
        });
    }

    grid.appendChild(box);
}

// その他表記ルールカードを描画
function renderOptionsCard(grid) {
    const auxiliaryRules = state.currentProofRules.filter(r => r.category === 'auxiliary');
    const isAuxiliaryActive = auxiliaryRules.some(r => r.active);

    const box = document.createElement('div');
    box.className = 'category-box';
    box.innerHTML = `
        <div class="category-header options">
            <span>⚙️ その他 表記ルール</span>
        </div>
        <div class="category-options">
            <div class="option-row">
                <label>
                    <input type="checkbox" ${isAuxiliaryActive ? 'checked' : ''} onchange="toggleCategoryAll('auxiliary', this.checked)">
                    <span>補助動詞をひらく</span>
                </label>
            </div>
            <div class="option-row">
                <label>
                    <input type="checkbox" ${state.optionNgWordMasking ? 'checked' : ''} onchange="toggleOption('ngWordMasking', this.checked)">
                    <span>伏字対応</span>
                </label>
            </div>
            <div class="option-row">
                <label>
                    <input type="checkbox" ${state.optionPunctuationToSpace ? 'checked' : ''} onchange="toggleOption('punctuationToSpace', this.checked)">
                    <span>句読点を半角スペースに</span>
                </label>
            </div>
        </div>
    `;
    /* 見直しチェック項目は常時ONのため非表示（コード保持）
            <div class="option-row" style="border-top: 2px solid #ddd; margin-top: 8px; padding-top: 12px;">
                <label style="font-weight: bold; color: #666; font-size: 0.85em;">
                    <span>見直しチェック</span>
                </label>
            </div>
            <div class="option-row">
                <label>
                    <input type="checkbox" ${state.optionTypoCheck ? 'checked' : ''} onchange="toggleOption('typoCheck', this.checked)">
                    <span>誤字チェック</span>
                </label>
            </div>
            <div class="option-row">
                <label>
                    <input type="checkbox" ${state.optionMissingCharCheck ? 'checked' : ''} onchange="toggleOption('missingCharCheck', this.checked)">
                    <span>脱字チェック</span>
                </label>
            </div>
            <div class="option-row">
                <label>
                    <input type="checkbox" ${state.optionNameRubyCheck ? 'checked' : ''} onchange="toggleOption('nameRubyCheck', this.checked)">
                    <span>人名ルビふり確認</span>
                </label>
            </div>
    */
    grid.appendChild(box);
}

// 難読漢字を一括で「ひらく」に設定
function toggleDifficultOpen(checked) {
    state.currentProofRules.forEach(rule => {
        if (rule.category === 'difficult') {
            rule.mode = checked ? 'open' : 'none';
            rule.active = checked; // 互換性のため
        }
    });
    renderTable();
    refreshCurrentView();
    generateXML();
}

// 難読漢字を一括で「ルビ」に設定
function toggleDifficultRuby(checked) {
    state.currentProofRules.forEach(rule => {
        if (rule.category === 'difficult') {
            rule.mode = checked ? 'ruby' : 'none';
            rule.active = false; // ルビの場合はactiveはfalse
        }
    });
    renderTable();
    refreshCurrentView();
    generateXML();
}

// オプションのトグル
function toggleOption(option, value) {
    if (option === 'ngWordMasking') {
        state.optionNgWordMasking = value;
    } else if (option === 'punctuationToSpace') {
        state.optionPunctuationToSpace = value;
    } else if (option === 'typoCheck') {
        state.optionTypoCheck = value;
    } else if (option === 'missingCharCheck') {
        state.optionMissingCharCheck = value;
    } else if (option === 'nameRubyCheck') {
        state.optionNameRubyCheck = value;
    } else if (option === 'nonJoyoCheck') {
        state.optionNonJoyoCheck = value;
    }
    generateXML();
}

// カテゴリ内の全ルールを一括ON/OFF
function toggleCategoryAll(category, active) {
    state.currentProofRules.forEach(rule => {
        if (rule.category === category) {
            rule.active = active;
        }
    });
    renderTable();
    refreshCurrentView();
    generateXML();
}


// ===== モード切替（ヘッダーのモードスイッチャー用） =====

function updateModeSwitcherButtons(activeId) {
    const ids = ['extractionModeBtn', 'formattingModeBtn', 'proofreadingModeBtn'];
    ids.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.classList.toggle('active', id === activeId);
    });
}

function switchToExtractionMode() {
    updateModeSwitcherButtons('extractionModeBtn');
    // 添付ファイル設定をデフォルト（PDFのみ）に切り替え
    selectDataType('pdf_only');
}

function switchToFormattingMode() {
    updateModeSwitcherButtons('formattingModeBtn');
    selectDataType('txt_only');
}

function switchToFormattingModeFromProofreading() {
    // 校正ページから抽出ページに遷移してから整形モードに切り替える
    goToExtractionFromProofreading();
    setTimeout(() => {
        switchToFormattingMode();
    }, 250);
}

// ES Module exports
export { startWithLabelDirect, startWithSelectedLabel, loadLandingProofreadingTxt, renderLandingProofreadingFileList, clearLandingProofreadingFiles, startLandingVariationCheck, startLandingSimpleCheck, transitionPages, hideLandingScreen, goToHome, startExtraction, startFormatting, startProofreading, init, toggleViewMode, showEditMode, showListMode, refreshCurrentView, renderTableMode, renderColumn1, renderColumn2, renderColumn3, renderOptionsCard, toggleDifficultOpen, toggleDifficultRuby, toggleOption, toggleCategoryAll, switchToExtractionMode, switchToFormattingMode, switchToFormattingModeFromProofreading };

// Expose to window for inline HTML handlers
Object.assign(window, { startWithLabelDirect, startWithSelectedLabel, loadLandingProofreadingTxt, renderLandingProofreadingFileList, clearLandingProofreadingFiles, startLandingVariationCheck, startLandingSimpleCheck, transitionPages, hideLandingScreen, goToHome, startExtraction, startFormatting, startProofreading, init, toggleViewMode, showEditMode, showListMode, refreshCurrentView, renderTableMode, renderColumn1, renderColumn2, renderColumn3, renderOptionsCard, toggleDifficultOpen, toggleDifficultRuby, toggleOption, toggleCategoryAll, switchToExtractionMode, switchToFormattingMode, switchToFormattingModeFromProofreading });
