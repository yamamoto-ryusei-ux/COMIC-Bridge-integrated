// tauri-bridge.js
// Electron の preload.js (window.electronAPI) を Tauri の invoke で再現するブリッジ層
// COMIC-Bridge統合版: 全コマンドに progen_ プレフィックスを付与
// iframe内でも動作するように window.__TAURI__ のフォールバックを実装

(function () {
    // iframe内の場合はparent/topの__TAURI__にフォールバック
    function findTauri() {
        if (window.__TAURI__) return window.__TAURI__;
        try { if (window.parent && window.parent.__TAURI__) return window.parent.__TAURI__; } catch (e) { /* cross-origin */ }
        try { if (window.top && window.top.__TAURI__) return window.top.__TAURI__; } catch (e) { /* cross-origin */ }
        return null;
    }
    const TAURI = findTauri();
    if (!TAURI) {
        console.error('[ProGen] Tauri API not available');
        return;
    }

    const { invoke, convertFileSrc } = TAURI.core;
    const { listen } = TAURI.event;

    // asset://プロトコルでローカルファイルをimgのsrcに使える
    window.convertFileSrc = convertFileSrc;

    window.electronAPI = {
        // Electron環境フラグ（互換性のため true を維持）
        isElectron: true,

        // プラットフォーム情報
        platform: 'win32',

        // JSONフォルダのベースパスを取得
        getJsonFolderPath: () => invoke('progen_get_json_folder_path'),

        // フォルダ内の一覧を取得
        listDirectory: (dirPath) => invoke('progen_list_directory', { dirPath: dirPath || null }),

        // JSONファイルを読み込み
        readJsonFile: (filePath) => invoke('progen_read_json_file', { filePath }),

        // JSONファイルを書き込み
        writeJsonFile: (filePath, data) => invoke('progen_write_json_file', { filePath, data }),

        // マスタールールJSONを読み込み
        readMasterRule: (labelValue) => invoke('progen_read_master_rule', { labelValue }),

        // マスタールールJSONをGドライブに書き込み
        writeMasterRule: (labelValue, data) => invoke('progen_write_master_rule', { labelValue, data }),

        // 新規レーベルを作成
        createMasterLabel: (labelKey, displayName) => invoke('progen_create_master_label', { labelKey, displayName }),

        // マスタールールのレーベル一覧を取得
        getMasterLabelList: () => invoke('progen_get_master_label_list'),

        // 校正テキストログ側に作品フォルダを作成
        createTxtWorkFolder: (label, work) => invoke('progen_create_txt_work_folder', { label, work }),

        // TXTフォルダのベースパスを取得
        getTxtFolderPath: () => invoke('progen_get_txt_folder_path'),

        // TXTフォルダ内の一覧を取得
        listTxtDirectory: (dirPath) => invoke('progen_list_txt_directory', { dirPath: dirPath || null }),

        // TXTファイルを読み込み
        readTxtFile: (filePath) => invoke('progen_read_txt_file', { filePath }),

        // テキストファイルを指定パスに保存
        writeTextFile: (filePath, content) => invoke('progen_write_text_file', { filePath, content }),

        // テキストファイル保存ダイアログを表示
        showSaveTextDialog: (defaultName) => invoke('progen_show_save_text_dialog', { defaultName: defaultName || null }),

        // 仕様書PDF出力
        printToPDF: (htmlContent) => invoke('progen_print_to_pdf', { htmlContent }),

        // 校正チェックデータを保存
        saveCalibrationData: (params) => invoke('progen_save_calibration_data', { params }),

        // COMIC-Bridgeを起動（統合版ではself=既に同一アプリ内）
        launchComicBridge: (jsonFilePath) => invoke('progen_launch_comic_bridge', { jsonFilePath }),

        // COMIC-POTハンドオフ受信（push通知）
        onComicPotHandoff: (callback) => {
            listen('comicpot-handoff', (event) => callback(event.payload));
        },

        // COMIC-POTハンドオフデータを要求（pull型）
        getComicPotHandoff: () => invoke('progen_get_comicpot_handoff'),

        // 画像ビューアー
        showOpenImageFolderDialog: () => invoke('progen_show_open_image_folder_dialog'),
        listImageFiles: (dirPath) => invoke('progen_list_image_files', { dirPath }),
        listImageFilesFromPaths: (paths) => invoke('progen_list_image_files_from_paths', { paths }),
        loadImagePreview: (filePath, maxSize) => invoke('progen_load_image_preview', { filePath, maxSize: maxSize || 1600 }),

        // D&Dで落とされたTXTファイルをパスから読み込み
        readDroppedTxtFiles: (paths) => invoke('progen_read_dropped_txt_files', { paths }),

        // 校正結果JSONファイルを開いて読む
        openAndReadJsonDialog: () => invoke('progen_open_and_read_json_dialog'),
        // 校正結果JSONファイル保存ダイアログ
        showSaveJsonDialog: (defaultName) => invoke('progen_show_save_json_dialog', { defaultName: defaultName || null }),
    };

    // ===== グローバル Tauri D&D イベントリスナー =====
    const _dragDropHandlers = [];

    window._registerDragDropHandler = function (handler) {
        _dragDropHandlers.push(handler);
    };

    // Tauri 2 の onDragDropEvent API を使用
    try {
        const { getCurrentWindow } = TAURI.window;
        const currentWindow = getCurrentWindow();

        currentWindow.onDragDropEvent((event) => {
            const payload = event.payload;

            if (payload.type === 'enter' || payload.type === 'over') {
                document.dispatchEvent(new CustomEvent('tauri-drag-enter'));
            } else if (payload.type === 'leave') {
                document.dispatchEvent(new CustomEvent('tauri-drag-leave'));
            } else if (payload.type === 'drop') {
                document.dispatchEvent(new CustomEvent('tauri-drag-leave'));
                const paths = payload.paths || [];
                if (paths.length === 0) return;
                for (const handler of _dragDropHandlers) {
                    if (handler(paths)) return;
                }
            }
        });
    } catch (e) {
        console.warn('[ProGen] D&D event setup failed (iframe context):', e.message);
    }

    // ===== COMIC-Bridge 統合版: 親windowブリッジ直接参照 =====

    function getBridge() {
        try {
            // 同一オリジン: window.parent から直接参照
            if (window.parent && window.parent !== window && window.parent.__COMIC_BRIDGE__) {
                return window.parent.__COMIC_BRIDGE__;
            }
            // フォールバック: window.top
            if (window.top && window.top !== window && window.top.__COMIC_BRIDGE__) {
                return window.top.__COMIC_BRIDGE__;
            }
            // iframe外で実行されている場合: 自分自身
            if (window.__COMIC_BRIDGE__) {
                return window.__COMIC_BRIDGE__;
            }
        } catch (e) { /* cross-origin */ }
        return null;
    }

    // state/JSON情報からレーベル名を取得してUIに設定
    function autoSelectLabel() {
        // 1) state.currentLoadedJson からレーベル名を取得（processLoadedJson後に確実に設定されている）
        var labelName = '';
        if (window.state && window.state.currentLoadedJson) {
            var pd = window.state.currentLoadedJson.presetData || window.state.currentLoadedJson;
            labelName = (pd.workInfo && pd.workInfo.label) || '';
        }
        // 2) フォールバック: 親ブリッジから取得
        if (!labelName) {
            var b = getBridge();
            if (b && b.getLabelName) labelName = b.getLabelName();
        }
        if (!labelName) return;

        console.log('[ProGen] Auto-select label:', labelName);

        // メイン画面: 表示専用テキスト
        var displayGroup = document.getElementById('labelDisplayGroup');
        var displayText = document.getElementById('labelDisplayText');
        var selectorGroup = document.getElementById('labelSelectorGroup');
        if (displayGroup && displayText) {
            if (selectorGroup) selectorGroup.style.display = 'none';
            displayGroup.style.display = 'flex';
            displayText.textContent = labelName;
        }

        // 校正ページ: セレクタのoption一致 or テキスト表示
        var proofSelector = document.getElementById('proofreadingLabelSelect');
        var proofSelectorText = document.getElementById('proofreadingLabelSelectorText');
        if (proofSelector) {
            var matched = false;
            var pOptions = proofSelector.querySelectorAll ? proofSelector.querySelectorAll('option') : [];
            for (var j = 0; j < pOptions.length; j++) {
                if (pOptions[j].value === labelName || pOptions[j].textContent === labelName) {
                    proofSelector.value = pOptions[j].value;
                    if (proofSelectorText) {
                        proofSelectorText.textContent = pOptions[j].textContent || labelName;
                        proofSelectorText.classList.remove('unselected');
                    }
                    if (window.loadLabelRulesForProofreading) window.loadLabelRulesForProofreading(pOptions[j].value);
                    matched = true;
                    break;
                }
            }
            if (!matched && proofSelectorText) {
                proofSelectorText.textContent = labelName;
                proofSelectorText.classList.remove('unselected');
            }
        }
    }

    // 強制画面遷移
    function forceNavigateToMode(mode) {
        var landing = document.getElementById('landingScreen');
        var main = document.getElementById('mainWrapper');
        var proofreading = document.getElementById('proofreadingPage');

        if (landing) landing.style.display = 'none';
        if (main) main.style.display = 'none';
        if (proofreading) proofreading.style.display = 'none';

        // レーベル自動認識（即時 + 遅延の両方で試行）
        autoSelectLabel();
        setTimeout(autoSelectLabel, 400);

        if (mode === 'proofreading') {
            if (proofreading) proofreading.style.display = 'flex';
            if (window.state) {
                window.state.currentProofreadingMode = 'simple';
                window.state.proofreadingReturnTo = 'landing';
            }
            document.querySelectorAll('.proofreading-mode-btn').forEach(function(btn) {
                btn.classList.toggle('active', btn.dataset.mode === 'simple');
            });

            // 校正用テキストを同期
            if (window.syncProofreadingFromComicBridge) window.syncProofreadingFromComicBridge();

            if (window.updateProofreadingCheckItems) window.updateProofreadingCheckItems();
            if (window.updateProofreadingOptionsLabel) window.updateProofreadingOptionsLabel();

            // テキスト同期 + 常用外漢字検出（DOM安定後）
            // syncProofreadingFromComicBridge 内で検出+ポップアップも実行される
            setTimeout(function () {
                try {
                    // _proofNonJoyoRanをリセットして検出を強制
                    if (window.state) window.state._proofNonJoyoRan = false;
                    if (window.syncProofreadingFromComicBridge) window.syncProofreadingFromComicBridge();
                } catch (e) {
                    console.warn('[ProGen] Proofreading sync error:', e);
                }
            }, 500);
        } else {
            if (main) main.style.display = 'flex';
            if (window.state) window.state.currentViewMode = 'edit';
            if (mode === 'formatting' && window.selectDataType) window.selectDataType('txt_only');

            // 抽出/整形用テキストを同期
            if (window.syncTextFromComicBridge) window.syncTextFromComicBridge();

            if (window.renderTable) window.renderTable();
            if (window.showEditMode) window.showEditMode();
            if (window.renderSymbolTable) window.renderSymbolTable();
            if (window.generateXML) window.generateXML();
        }
    }

    // モード遷移処理（親からの呼び出し用コールバック）
    function handleModeFromBridge() {
        var b = getBridge();
        if (!b) return;
        var mode = b.consumeMode();
        if (!mode) return;

        console.log('[ProGen] COMIC-Bridge mode:', mode);

        // 作品情報を反映
        var workInfo = b.getWorkInfo();
        if (workInfo && window.state) window.state._comicBridgeWorkInfo = workInfo;

        // 新規作成
        if (!b.hasWorkJson()) {
            var landing = document.getElementById('landingScreen');
            if (landing) landing.style.display = 'none';
            var main = document.getElementById('mainWrapper');
            if (main) main.style.display = 'none';
            if (window.handleLandingNewCreation) window.handleLandingNewCreation(mode);
            return;
        }

        // JSON読み込み → 遷移
        var jsonPath = b.getJsonPath();
        if (jsonPath && window.electronAPI && window.electronAPI.readJsonFile) {
            window.electronAPI.readJsonFile(jsonPath).then(function (result) {
                if (result && result.success !== false && window.processLoadedJson) {
                    var fileName = jsonPath.split('\\').pop() || jsonPath.split('/').pop() || '';
                    window.processLoadedJson(result, fileName).then(function () {
                        forceNavigateToMode(mode);
                    });
                } else {
                    forceNavigateToMode(mode);
                }
            }).catch(function () {
                forceNavigateToMode(mode);
            });
        } else {
            forceNavigateToMode(mode);
        }
    }

    // ブリッジ取得関数をグローバルに公開（他モジュールから利用可能）
    window._getBridge = getBridge;

    // 親ウィンドウから呼ばれるコールバックを公開
    window.__comicBridgeOnModeReady = handleModeFromBridge;
    window.__comicBridgeOnTextChange = function () {
        // 抽出/整形モードのテキスト同期
        if (window.syncTextFromComicBridge) window.syncTextFromComicBridge();
        if (window.generateXML) window.generateXML();
        // 校正モードのテキスト同期 + 常用外漢字再検出
        if (window.state) window.state._proofNonJoyoRan = false;
        if (window.syncProofreadingFromComicBridge) window.syncProofreadingFromComicBridge();
    };

    // 外部リンクをデフォルトブラウザで開く
    const originalOpen = window.open;
    window.open = function (url, target, features) {
        if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
            // opener プラグインの代わりに shell open を使用
            try {
                if (TAURI.opener && TAURI.opener.openUrl) {
                    TAURI.opener.openUrl(url);
                } else {
                    // フォールバック: 親ウィンドウのopenerを試す
                    invoke('open_with_default_app', { filePath: url }).catch(() => {
                        originalOpen.call(window, url, target, features);
                    });
                }
            } catch (e) {
                originalOpen.call(window, url, target, features);
            }
            return null;
        }
        return originalOpen.call(window, url, target, features);
    };
})();
