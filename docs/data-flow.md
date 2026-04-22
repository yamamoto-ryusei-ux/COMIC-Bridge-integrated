# データフロー

COMIC-Bridge 統合版 における代表的なユーザーシナリオのデータフロー。「何を操作するとどの層で何が起きるか」を順序立てて可視化する。

> 索引: [architecture.md](architecture.md) — レイヤー構成 / [feature-map.md](feature-map.md) — 機能対応表。

---

## 0. 共通: ファイル読み込み → 仕様チェック → NG 修正（ホーム画面の基本フロー）

```mermaid
sequenceDiagram
    autonumber
    actor U as ユーザー
    participant DZ as DropZone / TopNav
    participant PL as usePsdLoader
    participant PS as psdStore
    participant SC as useSpecChecker
    participant SS as specStore
    participant R as Rust
    participant AG as ag-psd
    participant MODAL as SpecSelectionModal
    participant PSAPP as Photoshop
    participant JSX as convert_psd.jsx / prepare_psd.jsx

    U->>DZ: フォルダ D&amp;D
    DZ->>PL: loadFolder(path)
    PL->>R: parse_psd_metadata_batch(filePaths)
    R->>AG: PSD header read
    AG-->>R: metadata
    R-->>PL: Vec&lt;PsdParseResult&gt;
    PL->>PS: addFiles(results)

    PS-->>MODAL: autoCheckEnabled ? 自動 : モーダル表示
    U->>MODAL: モノクロ/カラー選択
    MODAL->>SS: setCurrentSpec
    SS->>SC: checkAllFiles(specifications)
    SC->>PS: files から metadata 取得
    SC->>SS: checkResults 書き込み

    Note over U,SS: NG ファイル選択 → DetailSlidePanel で FixGuidePanel 表示

    U->>U: 「この1件を変換」クリック
    U->>JSX: usePhotoshopConverter or usePreparePsd
    JSX->>R: run_photoshop_conversion (or _prepare)
    R->>PSAPP: spawn PS + JSX
    PSAPP->>PSAPP: DPI/ColorMode/BitDepth 変換
    PSAPP-->>R: Vec&lt;PhotoshopResult&gt;
    R-->>JSX: 結果
    JSX->>R: parse_psd_metadata_batch(変換後)
    R-->>PS: updateFile で metadata 差替え
    SC->>SC: checkAllFiles を自動再実行
    SS-->>U: OK/NG 再表示
```

### 関連コード

- [usePsdLoader.ts](../src/hooks/usePsdLoader.ts) — 読み込み・自然順ソート・PDF 展開
- [useSpecChecker.ts](../src/features/spec-check/useSpecChecker.ts) — 仕様チェック（自動実行）
- [usePhotoshopConverter.ts](../src/hooks/usePhotoshopConverter.ts) — NG 変換
- [usePreparePsd.ts](../src/hooks/usePreparePsd.ts) — 統合処理（仕様修正 + ガイド適用を 1 回の PS パスで）
- [convert_psd.jsx](../src-tauri/scripts/convert_psd.jsx) / [prepare_psd.jsx](../src-tauri/scripts/prepare_psd.jsx)

### 重要な設計判断

- **ag-psd の `writePsd()` は使わない**: バイナリ破壊のリスクがあるため、書き込みは必ず Photoshop JSX 経由。
- **変換後は parse_psd_metadata_batch で再読み込み**: メモリ上の metadata を破棄し、ディスクから確実に最新を反映。
- **仕様チェックは自動再実行**: 100ms sleep 後に `checkAllFiles(specifications)` を呼ぶことで store 更新が確実に伝播。

---

## 1. レイヤー差替え（Replace）

```mermaid
sequenceDiagram
    autonumber
    actor U as ユーザー
    participant RV as ReplaceView
    participant RS as replaceStore
    participant URP as useReplaceProcessor
    participant R as Rust
    participant PSAPP as Photoshop
    participant JSX as replace_layers.jsx

    U->>RV: 差替え元 A / 差替え先 B をドロップ
    RV->>RS: setFolderA / setFolderB
    RS->>URP: scanAndPair()
    URP->>R: list_folder_files(A, B, recursive)
    R-->>URP: ファイル一覧
    URP->>URP: pairing アルゴリズム<br/>(file順/数字キー/リンク文字)
    URP->>RS: pairingJobs / excludedPairIndices 書き込み

    U->>RV: ペアリング確認モーダルで調整 (Auto/Manual)
    U->>RV: 「差替え実行」クリック
    RV->>URP: runReplace()
    URP->>R: run_photoshop_replace(jobs)
    R->>PSAPP: spawn PS + replace_layers.jsx
    PSAPP->>PSAPP: レイヤー照合 + 差替え
    PSAPP-->>R: PhotoshopResult[]
    R-->>URP: 結果
    URP->>RS: results / resultMatchMap
    RS-->>RV: ReplaceToast + マッチレポート表示
```

### 関連コード
[ReplaceView.tsx](../src/features/replace/ReplaceView.tsx) / [replaceStore.ts](../src/features/replace/replaceStore.ts) / [useReplaceProcessor.ts](../src/features/replace/useReplaceProcessor.ts) / [replace_layers.jsx](../src-tauri/scripts/replace_layers.jsx)

### ポイント
- **ペアリング方式 4 種**: ファイル順 / 数字キー / リンク文字（自動検出）/ 手動マッチ
- **バッチモード**: 親フォルダ配下のサブフォルダを一括スキャンし、白消し・棒消しフォルダを自動検出
- **出力先**: `Desktop/Script_Output/差替えファイル_出力/{timestamp}/` (またはカスタム名)

---

## 2. TIFF 化（tiff）

```mermaid
sequenceDiagram
    autonumber
    actor U as ユーザー
    participant TV as TiffView
    participant TS as tiffStore
    participant UT as useTiffProcessor
    participant UC as useCanvasSizeCheck
    participant R as Rust
    participant PSAPP as Photoshop
    participant JSX as tiff_convert.jsx

    U->>TV: PSD フォルダ読み込み
    TV->>TS: setFiles
    TS->>UC: useCanvasSizeCheck で多数派/外れ値検出

    U->>TV: クロップ矩形をドラッグ編集 / JSON 範囲ライブラリから読込
    TV->>TS: cropBounds / fileOverrides
    U->>TV: カラーモード・ぼかし・リサイズ・リネーム設定
    U->>TV: 「選択のみ」or「全て実行」

    TV->>UT: runTiff(selection)
    UT->>UT: buildSettingsJson()<br/>partialBlurEntries はグローバル index でマッチ
    UT->>R: run_photoshop_tiff_convert(settings_json, output_dir)
    R->>R: TIF_Output 重複回避 (TIF_Output (1), (2))
    R->>PSAPP: spawn PS + tiff_convert.jsx
    Note over PSAPP: unlock → text 検索 → SO化<br/>→ラスタライズ → カラー変換 → ぼかし<br/>→ crop → resize → save
    PSAPP-->>R: TiffConvertResponse<br/>(成功/失敗 + metrics_kerning / link_group_issues)
    R-->>UT: 結果
    UT->>TS: phase=done / results
    TS-->>TV: TiffResultDialog (警告: metricsKern / linkGroup)
```

### 関連コード
[TiffView.tsx](../src/features/tiff/TiffView.tsx) / [tiffStore.ts](../src/features/tiff/tiffStore.ts) / [useTiffProcessor.ts](../src/features/tiff/useTiffProcessor.ts) / [tiff_convert.jsx](../src-tauri/scripts/tiff_convert.jsx)

### ポイント
- **2 大プリフライト**: メトリクスカーニング検出 + リンクグループフォントサイズ検証（CLAUDE.md §27）
- **個別クロップ優先表示**: `fileOverrides[file.id].crop` が存在すればグローバル設定に優先
- **部分ぼかしのページマッチング**: 選択ファイルのみ処理でも `allPsdFiles` からグローバルページ番号を算出
- **出力形式**: TIFF (LZW) / JPG 選択可

---

## 3. ガイド線編集 → 一括適用

```mermaid
sequenceDiagram
    autonumber
    actor U as ユーザー
    participant GE as GuideEditorModal
    participant GS as guideStore
    participant HR as useHighResPreview
    participant R as Rust
    participant PSAPP as Photoshop
    participant JSX as apply_guides.jsx

    U->>GE: モーダル起動
    GE->>HR: get_high_res_preview(activeFile, maxSize)
    HR->>R: get_high_res_preview
    R->>R: 3層キャッシュ (memory→disk→full)<br/>決定論的ファイル名 {name}_{modified_secs}_{maxSize}.jpg
    R-->>HR: JPEG URL
    HR-->>GE: 高解像度プレビュー描画

    U->>GE: 定規からドラッグでガイド作成
    GE->>GS: addGuide (push history)
    U->>GE: ガイドドラッグで移動
    GE->>GS: moveGuide<br/>(ドラッグ中は履歴積まず、開始時1回 pushHistory)
    U->>GE: Ctrl+Z
    GE->>GS: undo (history → future)

    U->>GE: 「全ファイルに適用」
    GE->>R: run_photoshop_guide_apply(file_paths, guides)
    R->>PSAPP: spawn PS + apply_guides.jsx
    PSAPP->>PSAPP: 各 PSD にガイド挿入・保存
    PSAPP-->>R: PhotoshopResult[]
    R-->>GE: 結果サマリー (成功/エラー件数)
```

### 関連コード
[GuideEditorModal.tsx](../src/components/guide-editor/GuideEditorModal.tsx) / [guideStore.ts](../src/store/guideStore.ts) / [apply_guides.jsx](../src-tauri/scripts/apply_guides.jsx) / [useHighResPreview.ts](../src/hooks/useHighResPreview.ts)

### ポイント
- **3 層キャッシュ**: メモリ Map → ディスク JPEG → 未生成なら Rust でフル生成
- **Undo の粒度**: ドラッグ開始時のみ 1 回 `pushHistory`。ドラッグ中の連続イベントで履歴を汚さない
- **ショートカット**: ↑↓←→ 1px / +Shift 10px / Ctrl+Z/Y/Shift+Z

---

## 4. ProGen プロンプト生成（校正モード）

```mermaid
sequenceDiagram
    autonumber
    actor U as ユーザー
    participant TN as TopNav ツール → ProGen 校正
    participant VS as viewStore / progenStore
    participant PV as ProgenView
    participant PR as ProgenRuleView
    participant UV as unifiedViewerStore<br/>(現在のテキスト参照)
    participant PP as progenPrompts.ts
    participant CB as Clipboard / Gemini連携

    U->>TN: ツール → ProGen校正
    TN->>VS: setActiveView("progen") + progenMode="proofreading" + progenStore.toolMode
    VS->>PV: screen = "extraction" + popup 表示
    PV->>PR: listMode = "table" (ツール経由)
    PR->>UV: 参照テキスト取得 (現在 + 参照 + フォルダ)
    U->>PR: 🟢正誤ボタン クリック
    PR->>PP: generateSimpleCheckPrompt(text, rules, categories)
    PP->>PP: NGワード / numberSubRules / categories 定数<br/>(共有ドライブ config.json で更新可能)
    PP-->>PR: XML プロンプト
    PR->>CB: クリップボードコピー or Gemini 送信

    Note over U: Gemini 側で結果 CSV/Markdown 生成

    U->>PR: 結果貼付 (CSV/Markdown)
    PR->>PR: parseCheckText() で自動判定<br/>(正誤=correctness, 提案=proposal)
    PR->>PV: ResultSaveModal 起動
    U->>PV: 巻数入力 + 保存
    PV->>R: progen_save_calibration_data / progen_write_json_file
    R-->>UV: unifiedViewerStore.checkData 自動読み込み
```

### 関連コード
[ProgenView.tsx](../src/features/progen/ProgenView.tsx) / [progenStore.ts](../src/features/progen/progenStore.ts) / [progenPrompts.ts](../src/features/progen/progenPrompts.ts) / [progenConfig.ts](../src/features/progen/progenConfig.ts) / [useProgenTauri.ts](../src/features/progen/useProgenTauri.ts)

### ポイント
- **Proxy 経由の動的参照**: `ngWordList` / `numberSubRules` / `categories` を Proxy でラップし、共有ドライブから取得した値を既存コード変更なしで反映
- **フォールバック 3 段**: リモート同期済みキャッシュ → 既存ローカルキャッシュ → 埋め込み既定値
- **保存後の自動読み込み**: `unifiedViewerStore.checkData` にセットされ、校正 JSON タブで即座に閲覧可能

---

## 5. 差分ビューアー（A/B 両方揃った時のみ読み込み）

```mermaid
sequenceDiagram
    autonumber
    actor U as ユーザー
    participant TN as TopNav A/B ピッカー
    participant VS as viewStore.kenbanPathA/B
    participant DV as DiffViewerView
    participant DS as diffStore
    participant R as Rust (kenban.rs)

    U->>TN: A を選択
    TN->>VS: setKenbanPathA(folder)
    VS->>DV: props 経由で externalPathA 更新
    DV->>DS: setFolder("A", externalPathA)
    Note over DV: 片方のみ → 読み込みしない<br/>「📂foo 待機中」バッジ

    U->>TN: B を選択
    TN->>VS: setKenbanPathB(folder)
    VS->>DV: externalPathA + externalPathB 揃う
    DV->>DS: loadFolderSide("A") + loadFolderSide("B")
    DS->>R: kenban_list_files_in_folder(A) + (B)
    R-->>DS: filesA + filesB
    DS->>DS: computeCompareMode()<br/>(tiff-tiff / psd-psd / pdf-pdf / psd-tiff)
    DS->>DS: ペアリング (ファイル順/名前順)
    U->>DV: ペア選択
    DV->>R: compute_diff_simple or compute_diff_heatmap or compute_pdf_diff
    R-->>DV: 差分画像 (ヒートマップ/マーカー)
    DV->>DV: 3 モード切替 (A/B/Diff) でレンダリング
```

### 関連コード
[DiffViewerView.tsx](../src/features/diff-viewer/DiffViewerView.tsx) / [diffStore.ts](../src/features/diff-viewer/diffStore.ts) / [TopNav.tsx](../src/components/layout/TopNav.tsx)

### ポイント（CLAUDE.md §30）
- **登録と読み込みを分離**: `setFolder` は片方でも即反映、`loadFolderSide` は両方揃った時のみ
- **TopNav の自動遷移は削除**: A/B 登録後にユーザーの明示操作でビューアーへ移動
- **不適切な組合せ判定**: `isValidPairCombination()` で compareMode に合わない場合は A 単独表示

---

## 6. スキャン PSD → プリセット JSON 保存（フォント帳連携）

```mermaid
sequenceDiagram
    autonumber
    actor U as ユーザー
    participant SV as ScanPsdView
    participant SS as scanPsdStore
    participant USP as useScanPsdProcessor
    participant R as Rust
    participant PSAPP as Photoshop
    participant JSX as scan_psd_core.jsx
    participant DISK as ディスク<br/>{basePath}/{label}/{title}_scandata.json<br/>{jsonFolderPath}/{label}/{title}.json

    U->>SV: レーベル / タイトル入力 (必須)
    U->>SV: スキャン開始
    SV->>USP: runScan()
    USP->>R: run_photoshop_scan_psd(settings_json)
    R->>PSAPP: spawn PS + scan_psd_core.jsx
    PSAPP->>PSAPP: 全 PSD スキャン<br/>(フォント/サイズ/ガイド/ルビ抽出)
    loop 進捗ポーリング
        USP->>R: poll_scan_psd_progress()
        R-->>USP: 進捗 JSON
        USP->>SS: setProgress
    end
    PSAPP-->>R: 完了
    R-->>USP: scanData
    USP->>SS: setScanData(raw)

    USP->>USP: autoSelectGuideSet()<br/>isValidTachikiriGuideSet で有効判定<br/>+ 使用回数降順ソート
    USP->>SS: selectedGuideIndex = 0
    USP->>USP: autoRegisterDetectedFonts()<br/>getAutoSubName() でカテゴリ自動付与
    USP->>SS: presetSets 更新

    U->>SV: 各タブで調整<br/>(FontTypes / FontSizes / GuideLines / TextRuby / WorkInfo)
    U->>SV: 保存
    SV->>USP: performPresetJsonSave()
    USP->>R: write_text_file (プリセット JSON)
    USP->>R: write_text_file (scandata JSON)
    USP->>DISK: 2 ファイル書き出し
    USP->>R: write_text_file (テキストログ)
    DISK-->>USP: OK
```

### 関連コード
[ScanPsdView.tsx](../src/features/scan-psd/ScanPsdView.tsx) / [scanPsdStore.ts](../src/features/scan-psd/scanPsdStore.ts) / [useScanPsdProcessor.ts](../src/features/scan-psd/useScanPsdProcessor.ts) / [scan_psd_core.jsx](../src-tauri/scripts/scan_psd_core.jsx)

### ポイント
- **3 ファイル分離**: プリセット JSON (軽量・人間編集用) / scandata (完全データ・アプリ編集用) / テキストログ (ルビ等)
- **自動選択ロジック**: 有効タチキリガイドセット優先 → 使用回数降順 → index 0
- **ガード**: レーベル/タイトル未入力でのスキャン禁止、未入力時は `{basePath}/_仮保存/temp.json` に退避

---

## 7. ワークフロー（写植入稿）横断フロー

```mermaid
sequenceDiagram
    autonumber
    actor U as ユーザー
    participant WF as WorkflowBar
    participant WS as workflowStore
    participant VS as viewStore
    participant SC as spec-check
    participant PG as progen
    participant UV as unified-viewer
    participant RQ as RequestPrepView

    U->>WF: WF 選択 → 写植入稿
    WF->>WS: startWorkflow("shokuji-nyuukou")
    WS->>VS: setActiveView(step[0].nav)
    WF->>SC: 読み込みステップ

    U->>WF: 次へ → 仕様修正
    WS->>VS: setActiveView("specCheck")
    Note over SC: confirmOnNext で NG 件数確認

    U->>WF: 次へ → ProGen 整形
    WS->>VS: setActiveView("progen") + progenMode="formatting"
    U->>PG: プロンプト生成・Gemini 実行・結果保存

    U->>WF: 次へ → 校正
    WS->>VS: progenMode="proofreading"
    U->>PG: 正誤/提案チェック

    U->>WF: 次へ → テキスト修正
    WS->>VS: setActiveView("unifiedViewer")<br/>+ viewerTabSetup でテキストタブ右端
    U->>UV: ダブルクリックインライン編集
    Note over UV: confirmOnNext: textSave 未保存なら警告

    U->>WF: 次へ → ZIP
    WS->>WS: requestPrep_autoFolder localStorage に copyDestFolder 親フォルダを書き込み
    WS->>VS: ツール起動 → RequestPrepView
    RQ->>RQ: localStorage から自動セット
    U->>RQ: ZIP 作成
    RQ-->>WF: 成功 → 完了確認ポップアップ
    U->>WF: はい → abortWorkflow()
    WF->>WS: 完了
```

### 関連コード
[workflowStore.ts](../src/store/workflowStore.ts) / [WorkflowBar.tsx](../src/components/layout/WorkflowBar.tsx) / [RequestPrepView.tsx](../src/components/views/RequestPrepView.tsx)

### ポイント
- **自動ナビゲーション**: ステップ定義の `nav` / `progenMode` / `viewerTabSetup` で画面遷移
- **進行確認ダイアログ**: 各ステップに `confirmOnNext` (specCheck / textSave / wfComplete / textDiffThenExtract) を定義
- **localStorage バケツリレー**: `requestPrep_autoFolder` / `folderSetup_progenMode` / `progen_wfCheckMode` 等で feature 間の状態を引き渡し

---

## 8. データ格納先マップ

どこに何が保存されるか一覧。

```mermaid
flowchart TB
    subgraph LS["localStorage (永続化)"]
        LS1[specStore<br/>specifications / autoCheckEnabled / conversionSettings]
        LS2[settingsStore<br/>文字サイズ / ダークモード / ナビ配置]
        LS3[tiffStore<br/>settings (crop.bounds を除く)]
        LS4[scanPsdStore<br/>jsonFolderPath / saveDataBasePath / textLogFolderPath]
        LS5["WorkflowBar 連携<br/>requestPrep_autoFolder<br/>folderSetup_progenMode<br/>progen_wfCheckMode"]
    end

    subgraph APP["%APPDATA%/comic-bridge/"]
        APP1[progen-cache/<br/>共有ドライブ config の同期キャッシュ]
        APP2[preview cache/<br/>manga_psd_preview_*.jpg<br/>manga_pdf_preview_*.jpg]
    end

    subgraph TMP["%TEMP%/"]
        TMP1[comic-bridge-backup/<br/>ファイル操作 Undo 用]
    end

    subgraph DESK["Desktop/Script_Output/"]
        D1[差替えファイル_出力/{timestamp}/]
        D2[合成ファイル_出力/{timestamp}/]
        D3[分割ファイル_出力/...]
        D4[TIF_Output/ or TIF_Output (N)/]
        D5[レイヤー制御/{元フォルダ名}/]
        D6[テキスト抽出/{フォルダ名}.txt]
        D7[ZIP 出力先]
    end

    subgraph G["G:\共有ドライブ"]
        G1[Pro-Gen/<br/>version.json + config.json]
        G2[作品情報プリセット JSON<br/>{jsonFolderPath}/{label}/{title}.json]
        G3[scandata<br/>{saveDataBasePath}/{label}/{title}_scandata.json]
        G4[テキストログ<br/>{textLogFolderPath}/]
        G5[統一表記表 / NGワード表<br/>(RequestPrepView が参照)]
    end

    subgraph MEM["メモリ (Zustand — 永続化なし)"]
        M1[psdStore — ファイル一覧/選択]
        M2[guideStore — ガイド状態+Undo 履歴]
        M3[viewStore — activeView / kenbanPathA/B]
        M4[workflowStore — 進行状態]
        M5[progenStore / replaceStore / composeStore<br/>splitStore / renameStore / layerStore<br/>diffStore / parallelStore / unifiedViewerStore]
    end
```

---

## 関連ドキュメント

- [architecture.md](architecture.md) — レイヤー構成全体図
- [feature-map.md](feature-map.md) — 21機能 × 画面 × ストア対応表
- [../CLAUDE.md](../CLAUDE.md) — 機能仕様・Rust コマンド・UI 詳細
- [../KENBAN統合手順書.md](../KENBAN統合手順書.md) — KENBAN 機能統合時の手順
