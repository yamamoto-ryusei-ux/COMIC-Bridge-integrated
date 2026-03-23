# COMIC-Bridge (manga-psd-manager)

漫画入稿データ（PSD）の確認・調整を行うデスクトップアプリケーション

## 概要

漫画制作者や編集者が入稿前にPSDファイルの仕様をチェックし、必要に応じてPhotoshopと連携して一括修正できるツール。

## 技術スタック

- **フレームワーク**: Tauri 2.0
- **フロントエンド**: React 18 + TypeScript + Vite
- **スタイリング**: Tailwind CSS
- **状態管理**: Zustand
- **PSD処理**: ag-psd（読み取り専用）、Photoshop ExtendScript（変換・書き込み）
- **PDF処理**: pdfium-render（プレビュー/サムネイル）、Photoshop PDFOpenOptions（分割処理）
- **バックエンド**: Rust

## 設計思想

**「検出はアプリ、修正はPhotoshop」**

- PSDメタデータの読み込み・チェックはag-psdで高速に実行
- 実際の画像変換（DPIリサンプリング、カラーモード変換等）はPhotoshop JSXスクリプトで実行
- **ag-psd の writePsd() はPSDバイナリを破壊する** → PSD書き込みは必ずPhotoshop JSX経由
- Photoshopの高品質な画像処理エンジンを活用

## 主要機能

### 1. PSD読み込み・プレビュー
- ドラッグ&ドロップでファイル/フォルダ読み込み（グローバルD&D: AppLayout常時リスナー、全対応形式を受付）
- 自然順ソート: ファイル名の数字部分を数値比較（"1巻 (2)" < "1巻 (10)"）
- 埋め込みサムネイル表示（高速）
- メタデータ抽出（サイズ、DPI、カラーモード、ビット深度、レイヤー構造、αチャンネル等）
- レイヤーツリー表示: 種別アイコン（グループ/テキスト/調整/スマートオブジェクト/シェイプ/レイヤー）
- マスク情報表示: クリッピングマスク(`clip`バッジ)、レイヤーマスク、ベクトルマスク

### 2. 自動仕様チェック
- ファイル読み込み後に仕様選択モーダルを表示
- モノクロ/カラー選択で即座にチェック開始
- 「次回から自動選択」で前回の仕様を記憶
- チェック結果をサムネイルとToolbarに表示（OK/NG件数）
- NGファイルはホバーで理由を表示

**チェック項目:**
- カラーモード（RGB / Grayscale）
- 解像度（350dpi / 600dpi）
- ビット深度（8bit / 16bit）
- αチャンネルの有無

**仕様チェックロジック:**
- 複数の仕様定義（モノクロ原稿、カラー原稿等）
- ファイルがいずれか1つの仕様に完全合格すればOK

### 3. NG時の修正ガイド
- NGファイル選択時にDetailPanelで修正ガイドを表示
- 問題点（現在値 → 必要値）を明示
- Photoshopでの修正方法を説明
- 「この1件を変換」「NGすべて変換」ボタン
- サムネイル複数選択（Ctrl+Click / Shift+Click）で選択中のNGファイルのみ変換可能
- サムネ領域外クリックで複数選択を解除（`data-preview-grid`/`data-sidebar`/`data-detail-panel`属性で判定、サイドバー・詳細パネル内クリックは除外）

### 4. Photoshop連携変換
- NGファイルを一括で仕様に合わせて変換
- 変換処理:
  - DPI変更（BICUBICリサンプリング）
  - カラーモード変換
  - ビット深度変換
  - αチャンネル削除
- 変換完了後にConversionToastで結果通知（成功:チェックマーク / エラー:シェイク）
- 処理完了後にアプリウィンドウを前面に復帰（`window.set_focus()`）
- 変換後に仕様チェックを自動再実行（`usePsdStore.getState().files`で最新状態を取得）

### 5. ガイド線管理
- 高解像度プレビュー: 3層キャッシュ（メモリ→ディスク→フル生成）で高速化
  - 決定論的ファイル名: `{name}_{modified_secs}_{maxSize}.jpg`
  - JPEG品質92（トンボの細線保持）
- Photoshop風Canvas定規（グラデーション、ズーム対応目盛り）
- 定規からドラッグでガイド作成
- ガイドクリックで選択 → ドラッグで移動 → 矢印キーで微調整（+Shift 10px）
- ガイド線は常に1px表示（選択時は色とグローで区別）
- `moveGuide`アクション: ドラッグ中は履歴を積まず、開始時に1回だけpushHistory
- Undo/Redo対応（Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z）
- ズーム/パン操作（Ctrl+/-/0、Space+ドラッグ）
- プリセット（B5同人誌、A4商業誌等）
- 複数ファイルへの一括適用（Photoshop JSX経由、`apply_guides.jsx`）
- 適用完了後に結果サマリー表示（成功/エラー件数）
- 処理完了後にアプリウィンドウを前面に復帰（`window.set_focus()`）

### 6. レイヤー制御（Photoshop JSX経由）
- **5つのアクションモード**: hide（非表示）/ show（復元）/ custom（カスタム）/ organize（フォルダ格納）/ layerMove（レイヤー整理）
- レイヤー表示/非表示の一括切り替え（`hide_layers.jsx`）
- 条件指定: テキストレイヤー、テキストフォルダ、レイヤー名、フォルダ名、カスタム条件
- 部分一致/完全一致、大文字小文字の区別オプション
- 非表示→表示（復元）モード: `doc.info.caption`にメタデータ保存、親グループの可視性も自動復元
- **organizeモード（フォルダ格納）**: 指定名のグループ（デフォルト: "#原稿#"）にレイヤーを再グルーピング（`organize_layers.jsx`）。`organizeTargetName`でグループ名指定、`organizeIncludeSpecial`で特殊レイヤー（白消し・棒消し等）も含めるか選択。`run_photoshop_layer_organize` Rustコマンド経由
- **layerMoveモード（レイヤー整理）**: 条件ベースでレイヤーを指定グループに移動（`move_layers.jsx`）。4条件のAND判定: テキストレイヤー / サブグループ最上位 / サブグループ最下位 / レイヤー名一致（部分一致/完全一致）。検索範囲: ドキュメント全体 or 特定グループ内。移動先グループが存在しない場合は新規作成オプション。`run_photoshop_layer_move` Rustコマンド経由
- **customモード（カスタム操作）**: 右プレビューでレイヤーの目アイコンをクリックして個別に表示/非表示設定、レイヤー移動操作を登録。`custom_operations.jsx`で一括適用。`run_photoshop_custom_operations` Rustコマンド経由。Undo対応（`_customOpsHistory`スタック）
- **非表示テキストレイヤー削除**: hide/customモードで使用可能。非表示のテキストレイヤーをすべて削除（不可逆操作）。hideモードは`hide_layers.jsx`内で処理、customモードは`custom_operations.jsx`内の`deleteHiddenTextLayers()`で処理
- 選択ファイルのみ / 全ファイル処理対応
- **保存先選択**: 上書き保存 or 別フォルダに保存（`Desktop/Script_Output/レイヤー制御/{元フォルダ名}/`）。layerStoreの`saveMode`で管理、Rust側で出力先算出→JSXの`saveFolder`パラメータで`saveAs`先を切替
- **詳細レポートダイアログ**: 処理完了後に中央モーダル（createPortal）でファイル別ツリー表示。親フォルダ∈情報付きでグループ/レイヤーの階層関係を表示（F/G/T/L種別バッジ）
- JSX側: `changedNames`に`"テキスト「name」∈「parent」"`形式で親フォルダ情報を記録。フロント側`extractMatchedItems()`→`buildTree()`でツリー構築
- **ビューアーモード**: LayerPreviewPanel内タブ切替（レイヤー構造/ビューアー）。全ファイルを対象に高解像度プレビュー表示（useHighResPreview maxSize=2000）。矢印キー/マウスホイール/矢印ボタンでページ送り（端でクランプ、循環なし）。P/Fショートカットはキャプチャフェーズでインターセプトしてビューアーの現在ファイルに対応
- **ビューアー高速化**: フロントエンドURLキャッシュ（30エントリ、`urlCache` Map）でキャッシュヒット時は即座に表示。隣接ファイル（±1）の`prefetchPreview()`でプリフェッチ。ロード中は前の画像をopacity-40で維持（ちらつき防止）。サムネイルフォールバック（高解像度未取得時にopacity-60で即表示）。ローディングスピナーは右上に小型表示

### 7. レイヤー差替え（Photoshop JSX経由）
- **テキスト差替え**: 植字データ → 画像データへテキストレイヤー/特定名グループを差替え
- **画像差替え**: 画像データ → 植字データへ背景レイヤー/特定名レイヤー/特定名グループを差替え
- **同時処理（バッチモード）**: 白消し・棒消しフォルダを自動検出して一括差替え
- ペアリング: ファイル順/数字キー/リンク文字（手動・自動検出）。セグメント型ピルボタンで方式切替
- 中央エリアにD&Dドロップゾーン（Tauri物理座標→CSS座標のDPR補正付き）
- **ドロップゾーン中央インジケータ**: 準備完了バッジ + モード連動方向矢印（text=→、image/batch=←）。divベースの円形矢印（Tailwindクラスで描画、SVG inline strokeにはCSS変数が効かないためcurrentColorパターンを使用）
- バッチモード: 親フォルダ⇔個別指定の排他制御、サブフォルダ自動検出
- ファイル数カウント（再帰対応）、0件時の警告表示
- **設定の再配置**: 全般設定セクションを廃止。フォントサイズを丸める→テキストモード内（デフォルトOFF）、サイズ変更を行わない→画像モード内、サブフォルダ対応→フォルダ選択セクション内に配置。バッチモードは両設定を表示
- **ペアリング確認ダイアログ**: 自動ペアリング/手動マッチのタブ切替（ReplacePairingModal）
  - **自動タブ（PairingAutoTab）**: チェックボックス付きペアテーブル、行ごとの鉛筆アイコン（編集）/×ボタン（解除）、ヘッダーに「編集」「解除」明記。未マッチファイル折りたたみセクション（クリックでペア作成）。モード切替時はopacity transitionでスムーズ遷移。マッチキーバッジ（ファイル順=#N、数字キー=pN、リンク文字=キー文字）。マッチ進捗バー（分母は左列=差し替え元ファイル数）
  - **手動タブ（PairingManualTab）**: 2カラムファイルリスト + クリック/ドラッグでペア作成
  - **出力設定（PairingOutputSettings）**: 折りたたみ式。出力フォルダ名入力 + 保存ファイル名トグル + 出力パスプレビュー
- **カスタム出力フォルダ名**: ダイアログ内出力設定で任意のサブフォルダ名を指定可能（空欄ならタイムスタンプで自動生成）
- **詳細マッチレポート**: 処理完了後に結果テーブルの各行にマッチしたレイヤー/グループ名をインラインタグバッジで表示（resultMatchMap）
- **完了トースト通知**: モーダル閉じ後にも成功/エラー結果をReplaceToastで表示、出力フォルダを開くボタン付き
- Photoshop JSX経由で差替え実行（`replace_layers.jsx`）

### 8. 見開き分割（Photoshop JSX経由）
- **均等分割**: 中央で左右に分割（`_R`/`_L`サフィックス）
- **不均等分割**: ノド（綴じ）側に余白を追加して均等化（`outerMargin`設定）
- **分割なし**: フォーマット変換のみ
- 単ページ自動検出: 先頭/末尾ファイルが標準幅の70%未満なら分割スキップ
- ページ番号: `_R/_L` または連番 `_001, _002...`
- **1ファイル目の右側が白紙**: `firstPageBlank`チェックで白紙右ページを破棄し、左ページから`_001`で開始（連番モード時のみ表示）
- **最終ファイルの左側が白紙**: `lastPageBlank`チェックで最終ファイルの左ページを破棄し、右ページで連番を終了（連番モード時のみ表示）
- オプション: 非表示レイヤー削除、はみ出しテキスト除去
- 出力形式: PSD / JPG（品質0-100%、JSX側は0-12スケールに変換）
- **マルチフォーマット対応**: PSD/PSB以外にJPG, PNG, TIFF, PDF, BMP, GIF, EPSも読み込み可（Photoshopが開ける全形式）
- **PDF対応**: PDFドロップ時にページ単位で展開表示。プレビュー/サムネイルは`pdfium-render`でレンダリング。分割処理はPhotoshop `PDFOpenOptions`で600dpiオープン
- **実行ボタン分離**: 「選択のみ (N)」「全て実行 (N)」の2ボタンで対象を明示
- **SplitPreview**: 定規ドラッグで垂直ガイド操作、ズーム/パン、Undo/Redo対応
- **splitStore**: `selectionHistory`/`selectionFuture`でUndo/Redo。`startDragSelection()`でドラッグ中は履歴スパム防止
- Photoshop JSX経由で全ファイル一括処理（`split_psd.jsx`、タイムアウト5分）

### 9. TIFF化（Photoshop JSX経由）
- **TIPPY v2.92の処理パイプライン準拠**: PSD→TIFF一括変換（テキスト整理・カラーモード変換・ぼかし・クロップ・リサイズ・リネーム）
- **処理順序**: unlock → テキストグループ検索 → 上に移動 → 背景SO化 → テキストSO化 → 両方ラスタライズ → カラーモード変換 → テキスト再SO化 → 非表示 → ぼかし(背景のみ) → 表示 → getByName最終マージ → crop → resize → save
- **ExtendScript注意**: レイヤー比較は`.id`（プロキシオブジェクトの`===`は不可）、選択は`putIdentifier`+`makeVisible:false`、crop引数は`UnitValue`配列
- **出力フォルダ重複回避**: `TIF_Output`フォルダが既存の場合`TIF_Output (1)`, `(2)`...で連番生成（Rust側でJSON内outputPathも書き換え）
- **ビジュアルクロップエディタ**: useHighResPreviewベースのプレビュー上にドラッグ可能なクロップ矩形をオーバーレイ。640:909アスペクト比ロック、8ハンドルリサイズ、暗転マスク、三分割グリッド、リアルタイム寸法表示、比率検証（±1%）。手入力フィールド(L/T/R/B)は廃止済み — 比率OK/サイズ表示/PSDから自動設定のみ表示
- **個別クロップ編集**: ファイル別クロップ編集モード中は`savedGlobalBoundsRef`でグローバル範囲を退避。OK/キャンセルボタン押下時にグローバル範囲を復元（個別編集がグローバル設定を上書きしない）
- **個別クロップ優先表示**: TiffViewerPanel（ビューアータブ）・TiffCropEditor（プレビュータブ）ともに、参照ファイルに個別クロップ設定があればグローバル設定より優先して表示。fileOverridesのキーはPsdFileの`.id`（`.fileId`ではない）。TiffCropEditorでは個別範囲をアンバー色ソリッド枠（読み取り専用）でメイン表示し、グローバル範囲をピンク破線＋ハンドルでグローバル編集可能な状態を維持
- **バッチキュー＆個別上書き**: 全ファイルの処理予定を可視化。ファイル毎にカラーモード・ぼかし半径・スキップをインライン上書き。リネームプレビュータブで出力名確認・重複検出
- **カラーモード**: モノクロ/カラー/変更なし/個別選択（ページ範囲ルール最大3件 + デフォルトモード）
- **ガウスぼかし**: モノクロ時のみ適用、半径指定(px)。部分ぼかし（最大5ページ、ページ別半径）
- **部分ぼかしのページマッチング**: `buildSettingsJson`内で`allPsdFiles`（psdStore全ファイル）から`globalFileIndex`を取得し、選択ファイルのみ処理時もグローバルページ番号で`partialBlurEntries`をマッチ。ファイル別ぼかしモーダルは既存overrideがない場合に空リストで開始（グローバル設定にフォールバックしない）
- **クロップ範囲**: 640:909比率。JSONから読込/保存（CLLENN互換: ジャンル→レーベル→タイトル階層）。キャンバスサイズ不一致ダイアログ（4択: ラベル再選択/手動選択/そのまま/スキップ）。PSDガイドから自動設定ボタンはクロップ有効/無効に関わらず常時表示
- **リサイズ**: 1280x1818（DPI: モノクロ=600, カラー=350）
- **テキスト整理**: #text#, text, 写植, セリフ, テキスト, 台詞 グループを検索・統合→スマートオブジェクト化
- **リネーム**: 連番/ページ数計算/リネームなし。開始番号・ゼロ埋め桁数指定
- **出力**: TIFF(LZW)/PSD、中間PSD保存、画像レイヤー統合オプション
- **PSB対応**: PSBファイルのTIFF変換サポート
- Photoshop JSX経由で実行（`tiff_convert.jsx`）
- **設定パネル**: 折りたたみ式セクション構成（処理状態表示スピナー+プログレスバー付き）
  - **出力形式**: TIFF/JPG切替
  - **カラーモード・ぼかし**: カラーモード選択、ガウスぼかし設定、ルール編集
  - **クロップ・リサイズ**: クロップ設定（比率OK/サイズ/PSD自動設定）＋リサイズ・解像度を統合
  - **リネーム・出力先**: リネーム設定＋出力先ディレクトリ＋中間PSD保存＋テキスト整理を統合
  - ※サブフォルダも含めるチェックはTiffFileList（中央ファイルリスト）ヘッダーとTiffBatchQueueヘッダーに配置
- **設定永続化**: localStorageに保存（ただし`crop.bounds`はファイル依存のため永続化しない）
- **JSON範囲ライブラリ**: TiffCropRangeLibrary（読込/保存/新規作成の3タブ）、GENRE_LABELS定数でジャンル→レーベルマッピング
- **Tachimi互換JSON構造**: TiffCropPreset型（units: "px", size, documentSize, savedAt）。新規登録時に現在の選択範囲をプリセットとして保存。4スペースインデント
- **Tachimi互換キーボード操作**: ガイド移動1px/Shift+10px、範囲移動10px/Shift+1px（逆）。矢印キーUndo最適化（連続押し中は1回だけ履歴保存）。Delete/Backspaceでガイド・選択範囲削除
- **ガイド交点クロップ作成**: トンボにガイドを引き、交点からクロップ範囲をドラッグ作成。クロップ範囲がない時はガイドクリックでクロップ開始。クロップ範囲がある時は未選択ガイドをpointer-events:noneにして矩形操作を優先

### 10. リネーム（レイヤーリネーム / ファイルリネーム）
- **サブモード切替**: 「ファイルリネーム」「レイヤーリネーム」のタブ切替
- **モードA: レイヤーリネーム（Photoshop JSX経由）**
  - 最下位/背景レイヤーを指定名に変更
  - レイヤー/グループ名の検索→置換（複数ルール対応、完全一致/部分一致/正規表現）
  - ファイルを連番で別名保存（ベース名+セパレータ+ゼロ埋め）
  - 出力先フォルダ選択
  - ライブプレビュー（psdStoreのlayerTreeデータで変更前→変更後を表示）
  - Photoshop JSX経由で実行（`rename_psd.jsx`）
- **モードB: ファイルリネーム（Rust直接処理、Photoshop不要）**
  - 対応形式: PSD, PSB, TIFF, JPG, PNG, BMP, GIF, PDF, EPS
  - 連番リネーム: ベース名+セパレータ+ゼロ埋め連番。デフォルト: 開始番号=3, 桁数=4, セパレータ=空文字
  - 文字列置換: 検索→置換（部分一致/正規表現）
  - プレフィックス/サフィックス追加
  - フォルダ追加ボタンで複数フォルダ対応（フォルダ名ヘッダー付き表示）
  - ドラッグ並替え: ファイル順序変更→連番割り当てに反映
  - チェックボックスで一部だけリネーム対象に選択
  - ダブルクリックで個別ファイル名編集
  - 出力方式: 「Script_Outputにコピー」 or 「元の場所で上書きリネーム」
  - プレビュー: 変更前→変更後を一覧表示
  - invoke `batch_rename_files` でRust直接fs::copy/fs::rename
- **fileEntries→psdStore自動同期**: ファイルリネームに追加されたPSD/PSBを自動的にpsdStoreへ同期（レイヤーリネーム用のレイヤーツリー取得）
- **RenameResultDialog**: 処理完了ダイアログ（成功/失敗一覧 + 出力フォルダを開くボタン）

### 11. 合成（Compose / Photoshop JSX経由）
- **概要**: 2つのPSDファイル（原稿A / 原稿B）を1つの合成ファイルに統合
- **5つのデフォルト要素**: テキストフォルダ(A)、背景(B)、#背景#(除外)、白消し(除外)、棒消し(除外) — 各要素をどちらのソースから取るか(A/B/除外)選択可能
- **要素ルーティング**: restSourceで指定した側がbaseDoc（保存対象）、もう片方がotherDoc（コピー元）。要素のsourceとbaseLabel(A/B)を**文字列比較**してルーティング（ExtendScriptのDocumentオブジェクト比較は不安定なため）
- **ペアリング**: ファイル順/数字キー/リンク文字（手動・自動検出）の4方式。Replaceと同じペアリングUIを流用
- **出力先**: `Desktop/Script_Output/合成ファイル_出力/{timestamp}/` または差替えタブ内合成は `差替えファイル_出力/{timestamp}/`
- **サブフォルダ対応**: ソースファイルをサブフォルダに整理してから合成可能
- **コンポーネント**: ComposeView, ComposePanel, ComposeDropZone, ComposePairingModal（Auto/Manualタブ）, ComposePairingOutputSettings, ComposeToast
- **ストア**: `composeStore.ts` — folders, composeSettings(elements/restSource/skipResize/roundFontSize), pairingJobs, scannedFileGroups, excludedPairIndices, manualPairs, phase/progress/results管理
- **フック**: `useComposeProcessor.ts` — スキャン＆ペアリング、Photoshop実行
- Photoshop JSX経由で合成実行（`replace_layers.jsx`のcompose設定で処理）。合成ヘルパー: `composeCopyElement()`, `composeRemoveElement()`

### 12. Scan PSD（フォントプリセット管理）
- **元スクリプト**: `je-nsonman_ver2.86.jsx`（約11,000行）からの移植
- **概要**: PSDフォルダをスキャンしてフォント・サイズ・ガイド等のメタデータを収集し、プリセットJSONとして管理
- **モード**: 新規作成（スキャン→保存）/ JSON編集（既存JSONの読み込み・編集）
- **5タブ構成**: 作品情報(WorkInfoTab) / フォント種類(FontTypesTab) / サイズ統計(FontSizesTab) / ガイド線(GuideLinesTab) / ルビ(TextRubyTab)

**FontTypesTab（フォント種類タブ）:**
- **プリセットセット管理**: 複数のプリセットセット（「デフォルト」「手動追加」等）を切替・追加・削除・リネーム
- **カスタムセット作成**: 「+」ボタンでフォントピッカー付きセット作成。既存セット（デフォルト・手動追加等）や未登録フォントから選択してセットを構成
- **手動フォント追加**: フォント検索フォームで部分一致検索（PostScript名・表示名対応）。`search_font_names` Rustコマンドで検索→1件なら自動入力、複数件ならドロップダウンから選択、0件ならエラー表示。追加フォントは「手動追加」セットに登録
- **フィルタ機能**: トグルチップで絞り込み。カテゴリあり/なし（排他）、インストール済み/未インストール（排他）。異なるペア間はAND
- **ソート機能**: ドロップダウンで切替。デフォルト（カテゴリ順+未インストール最下位）/ 名前順 / カテゴリ順 / 出現数順 / インストール順
- **纏め（グループ化）機能**: フォントファミリーを自動検出し、同ファミリーの重複フォントを統合。`extractGroupKey()` で表示名からファミリーキーを抽出（ＤＦＰ→ＤＦ正規化、バージョン識別子除去等）。使用回数最多のフォントを「メイン」として残し、他を除去。プレビュー→確認→実行のUIフロー
- **未登録フォント**: scanData.fontsに存在するがpresetSetsに未登録のフォントを「未登録フォント」セクションに表示。個別追加 / 一括追加ボタン
- **カテゴリ自動判定**: `getAutoSubName()` でPostScript名からセリフ/モノローグ/ナレーション等のカテゴリを自動付与（`FONT_SUB_NAME_MAP` 定義）
- **カテゴリ手入力対応**: インライン編集・手動フォント追加の両フォームで、既存カテゴリの選択に加えて自由入力も可能（`<input>` + `<datalist>` 方式）
- **インストール状態表示**: `useFontResolver` でフォントのインストール有無を色分け表示

**データ分離設計:**
- **プリセットJSON** (`{jsonFolderPath}/{label}/{title}.json`): 選択されたガイドのみ (`guides`)、プリセット、作品情報。`guideSets`/`excludedGuideIndices` は含めない。`rubyList`/`selectionRanges` は含めない（別途テキストログに出力）
- **scandata** (`{saveDataBasePath}/{label}/{title}_scandata.json`): 全ガイドセット、選択・除外状態 (`selectedGuideSetIndex`, `excludedGuideIndices`)、フォント統計等の完全データ。`editedRubyList` は含めない（ルビデータは別途テキストログに出力）
- **テキストログ** (`{textLogFolderPath}/`): ルビリスト等のテキストデータを出力（`performExportTextLog`）
- **JSON読み込み時**: リンクscandataを自動検索 (`{saveDataBasePath}/{label}/{title}_scandata.json`)。見つからない場合はJSON内の `guideSets` からフォールバックscanDataを構築

**ガイド自動選択（元スクリプト準拠）:**
- `isValidTachikiriGuideSet()`: ドキュメント中心±1pxのガイドを除外、上下左右各1本以上で有効判定
- `autoSelectGuideSet()`: 有効タチキリ優先 → 使用回数降順でソート → インデックス0を自動選択

**保存ルール:**
- ファイル名: `{title}.json` / `{title}_scandata.json`
- 保存先: `{basePath}/{label}/`
- レーベル・タイトル未入力時: `{basePath}/_仮保存/temp.json` に仮保存 → 入力後に正式保存＆仮データ削除
- スキャン完了後にフォント自動登録 (`autoRegisterDetectedFonts()`) → 自動保存 (`performPresetJsonSave()`)
- `autoRegisterDetectedFonts()`: `scanData.fonts` から全プリセットセット未登録のフォントを検出し、現在のセットに `getAutoSubName()` でカテゴリ名付きで自動追加（je-nsonman準拠）
- スキャン開始にはレーベル・タイトルの事前入力が必須

**元スクリプトJSON互換（エクスポート）:**
- `convertSizeStatsForExport()`: 内部形式（`mostFrequent: {size,count}`, `sizes: [{size,count}]`）→ je-nsonman形式（`mostFrequent: number`, `sizes: number[]`, `top10Sizes: [{size,count}]`）に変換
- `convertStrokeSizesForExport()`: 内部の `count` フィールドを除去、`size` + `fontSizes` のみ出力
- `convertPresetsForExport()`: 空の `subName` を省略、`description` に「使用回数:」を含む場合は省略
- `saveLocation`: `workInfo.label` をエクスポートデータに追加

**元スクリプトJSON互換（インポート）:**
- `loadPresetJson` のフォールバックで安全に変換
- `scannedFolders`, `textLayersByDoc`, `fonts` 等のアプリ専用フィールドが欠落する可能性 → 全タブでオプショナルチェーン (`?.`) ガード済み

**エラーバウンダリ:**
- `ErrorBoundary` コンポーネントを `ViewRouter` に適用
- レンダリングエラー時に真っ白画面ではなくエラーメッセージ＋再試行ボタンを表示

**主要ファイル:**
- `src/hooks/useScanPsdProcessor.ts` — スキャン実行、JSON/scandata保存・読込、ガイド自動選択
- `src/store/scanPsdStore.ts` — Zustandストア（persist未使用）
- `src/types/scanPsd.ts` — ScanData, PresetJsonData, ScanGuideSet, ScanWorkInfo, FontPreset等の型定義
- `src/components/scanPsd/ScanPsdContent.tsx` — 右パネル（モード選択、スキャンUI、サマリー、ファイルブラウザ）
- `src/components/scanPsd/ScanPsdPanel.tsx` — 左パネル（5タブ + 保存ボタン）
- `src/components/scanPsd/JsonFileBrowser.tsx` — basePath以下のJSON専用ファイルブラウザ
- `src/components/scanPsd/tabs/` — 各タブコンポーネント
- `src/components/ErrorBoundary.tsx` — React エラーバウンダリ

**ストアの主要状態:**
- `mode`: "new" | "edit" | null
- `scanData`: ScanData | null — スキャン結果または読み込んだデータ
- `presetSets`: Record<string, FontPreset[]> — フォントプリセットセット
- `workInfo`: ScanWorkInfo — 作品情報（genre, label, title, author等）
- `selectedGuideIndex`, `excludedGuideIndices` — ガイド選択・除外状態
- `currentJsonFilePath`, `currentScandataFilePath` — 現在開いているファイルパス
- `tempJsonFilePath`, `tempScandataFilePath`, `pendingTitleLabel` — 仮保存管理
- `jsonFolderPath`, `saveDataBasePath`, `textLogFolderPath` — 基本パス（localStorage永続化）

### 13. PSD準備（Prepare PSD / 統合処理）
- **概要**: 仕様修正（DPI/カラーモード/ビット深度）+ ガイド適用を1回のPhotoshopパスで統合実行
- **3つの実行パス**: (1) 統合処理（spec fix + guides）、(2) spec fixのみ、(3) guidesのみ
- **フック**: `usePreparePsd.ts` — NGファイル検出 + ガイド存在確認で対象を自動決定
- **スクリプト**: `prepare_psd.jsx` — 仕様変換とガイド適用を一括処理
- 処理後にメタデータ再読み込み＋仕様チェック自動再実行

### 14. 直接仕様変換（ag-psd + Rust、Photoshop不要）
- **概要**: Photoshopを起動せずにPSDメタデータ変更＋画像処理を実行（高速）
- **フック**: `useSpecConverter.ts`
- **2段階処理**: (1) ag-psdでメタデータ編集（DPI, colorMode, bitDepth, 非表示レイヤー削除）、(2) Rustで画像リサンプル/カラーモード変換
- **Rustコマンド**: `resample_image`（DPIリサンプリング、BICUBICフィルタ）、`convert_color_mode`（カラーモード変換）
- Photoshop版（`usePhotoshopConverter.ts`）とは別のアプローチ — メタデータのみの変更に最適

### 15. アプリ更新管理
- **フック**: `useAppUpdater.ts` — Tauri Updaterプラグイン使用
- **自動チェック**: アプリ起動2秒後にバックグラウンドで更新確認
- **フェーズ**: idle → checking → available → downloading → ready → relaunch
- 更新検出時にプロンプト表示、ダウンロード＆インストール後に1.5秒後自動再起動
- エラーハンドリング: エラー状態表示＋dismissボタン

### 16. 写植チェック（校正チェック）
- **概要**: MojiQ等が出力する校正チェックJSONを読み込み、校正指摘を一覧表示
- **データ構造**: `ProofreadingCheckData`（MojiQ JSON構造準拠）。`checks.variation` / `checks.simple` の2グループ。各項目に `checkKind`（correctness=正誤 / proposal=提案）
- **タブモード**: 正誤のみ / 提案のみ / 両方 の3モード切替。データ読み込み時に自動選択
- **カテゴリ表示**: `CheckCategoryGroup` でカテゴリ別にグループ化・折りたたみ表示。カテゴリ番号に対応した色パレット（10色）
- **検索**: デバウンス付きテキスト検索（excerpt, content, category, page）
- **ビューアー連動**: `TypesettingViewerPanel` でPSDプレビューと校正指摘を並列表示。ページクリックでビューアーのページに遷移（`navigateToPage`）
- **JSONブラウザ**: `JsonFileBrowser` を再利用してJSONフォルダからファイル選択
- **コンポーネント**: TypesettingCheckView, TypesettingCheckPanel, TypesettingViewerPanel, CheckCategoryGroup
- **ストア**: `typesettingCheckStore.ts` — checkData, checkTabMode, searchQuery, jsonBasePath, showJsonBrowser, navigateToPage

### 17. 写植確認（TypesettingConfirmPanel）
- **概要**: comicpotテキストデータにフォント指定を付与して保存する機能。フォント帳（プリセットJSON）を読み込み、テキストブロックにフォントを割り当て
- **コンポーネント**: `TypesettingConfirmPanel.tsx`（`src/components/typesetting-confirm/`）
- **テキスト解析**: `parseComicPotText()` でページ区切り `<<NPage>>` とブロック（空行区切り）を解析
- **テキスト保存**: `serializeText()` でフォント指定タグ付きテキストに変換
- **フォント指定書式**: `[font:PostScriptName(表示名(カテゴリ))]` — subNameなし時は `[font:PostScriptName(表示名)]`
- **sanitize処理**: フォント名・カテゴリ名から括弧文字（半角`()`・全角`（）`・角括弧`[]`）を除去して書式破壊を防止
- **validateFontTag**: 出力前に括弧バランスを検証。不正な場合はPostScript名のみにフォールバック（再発防止）
- **フォントプリセット読み込み**: Scan PSDのJSONフォルダからフォントプリセットJSONを選択・読み込み（`handleSelectFontJson`）
- **PDF見開き分割モード**: 見開きPDFのページ割り当て（none/coverSpread/skipCover/allSpread）
- **ビューアー連動**: 高解像度プレビュー + ページ遷移 + クロップ表示
- **ブロック操作**: 選択（Ctrl/Shift複数対応）、フォント割り当て、追加、並べ替え（D&D）、移動マーカー

### 18. テキスト抽出（Photoshop不要）
- **概要**: PSDファイルのテキストレイヤーからテキストを抽出し、COMIC-POT互換フォーマットで保存
- **データソース**: ag-psdで読み込み済みの`layerTree`から`textInfo.text`を取得（Photoshop不要）
- **出力フォーマット**: COMIC-POT互換テキスト
  - ヘッダー: `[COMIC-POT:bottomToTop]` または `[COMIC-POT:topToBottom]`
  - 巻ヘッダー: `[01巻]`
  - ページ区切り: `<<NPage>>`
  - テキスト内容 + 空行区切り
- **設定オプション**: レイヤー順序（下→上 / 上→下）、非表示レイヤー含むかどうか
- **ルビレイヤー自動除外**: レイヤー名が`文字（ふりがな）`パターンに一致する場合スキップ
- **出力先**: `Desktop/Script_Output/テキスト抽出/{フォルダ名}.txt`（重複時はタイムスタンプ付き）
- **保存後にエクスプローラーで出力フォルダを自動表示**
- **コンポーネント**: `TextExtractButton.tsx`（フローティングボタン+ポップオーバー設定+抽出ロジック）
- **配置ビュー**: 完成原稿チェック（右下、常時表示）、レイヤー制御（右下）、写植関連（写植仕様タブ・写植調整タブの右下）

### 19. ユーティリティ機能

**キャンバスサイズチェック** (`useCanvasSizeCheck.ts`):
- 全読み込みファイルのキャンバス寸法を分析、多数派サイズを検出
- 異なるサイズのファイルを`outlierFileIds`として検出
- 返却: `majoritySize`, `majorityWidth/Height`, `outlierFileIds`, `sizeGroups`

**ページ番号チェック** (`usePageNumberCheck.ts`):
- ファイル名から最後の連続数字を抽出（例: "タイトル_003.psd" → 3）
- 連番の欠番を検出（`missingNumbers`, `hasGaps`）
- ページ範囲 `[min, max]` を返却

**KENBAN差分ツール連携** (`launch_kenban_diff` Rustコマンド):
- 外部アプリ `KENBAN.exe`（`%LOCALAPPDATA%/KENBAN/KENBAN.exe`）を起動
- 2つのフォルダパスとモード（"tiff" / "psd"）を指定してビジュアル比較
- `KENBAN.exe --diff {mode} {folder_a} {folder_b}` で非同期起動

**フォルダ検出** (`detect_psd_folders` Rustコマンド):
- 指定フォルダ内のPSDファイルを含むサブフォルダを検出

## UI構成

### レイアウト
- **TopNav**: 上部ナビゲーション。タブでビュー切替（完成原稿チェック/レイヤー制御/写植関連/差替え/合成/TIFF化/スキャナー/見開き分割/リネーム）
- **ViewRouter + viewStore**: タブベースのビュー切替管理（AppView: specCheck | layers | typesetting | split | replace | compose | rename | tiff | scanPsd）
- **AppLayout**: TopNav + フルワイドビュー構成（旧3カラムサイドバーは廃止済み）、グローバルD&Dリスナー（useGlobalDragDrop）。`handleMouseDown`で領域外クリック時に選択解除（モーダルは`onMouseDown stopPropagation`で保護が必要）

### ビュー
- **FileView**: ファイル一覧・サムネイル・メタデータ表示
- **LayerControlView**: レイヤー制御パネル + LayerPreviewPanel（レイヤー構造タブ + ビューアータブ）
- **SpecCheckView**: 仕様チェック（3カラム: CompactFileList | MetadataPanel | サムネイル/レイヤー構造/写植仕様タブ切替）
  - viewMode切替: サムネイル（PreviewGrid）、レイヤー構造（SpecLayerGrid）、写植仕様（SpecTextGrid）
  - SpecTextGrid: 使用フォントサマリー（種類数・レイヤー数）、サイズ統計（頻度順・基本ポイント数）、ファイル別テキストレイヤー一覧。フォント切替（デフォルト/プレビュー）、ソート切替（昇順/降順）
  - SpecLayerGrid: 全ファイルのレイヤー構造をグリッド表示
- **TypsettingView**: 写植関連（写植チェック・写植確認を統合）。MojiQ校正JSONの読み込み・カテゴリ別表示・ページ遷移連動
- **ViewerView**: 独立ビューアー（SpecViewerPanelを再利用）。画像+サイドバー（写植仕様/レイヤー構造タブ）。OS全画面（Tauri setFullscreen）、スプラッシュトランジション、矢印キー/ホイールナビ、P/Fショートカット
- **ReplaceView**: レイヤー差替え
- **ComposeView**: 合成（2カラム: ComposePanel | ComposeDropZone）。Replace機能と類似のペアリングUI
- **SplitView**: 見開き分割
- **RenameView**: リネーム（レイヤーリネーム / ファイルリネーム）
- **TiffView**: TIFF化（3カラム: TiffSettingsPanel | TiffFileList | Center(プレビュー/一覧/ビューアータブ切替)）。TiffFileListヘッダーとTiffBatchQueueヘッダーにサブフォルダチェックを配置
- **ScanPsdView**: Scan PSD（2カラム: ScanPsdPanel(5タブ) | ScanPsdContent(モード選択/スキャン/サマリー)）

### レイヤーツリー (LayerPreviewPanel)
- **タブ切替**: 「レイヤー構造」（デフォルト）/ 「ビューアー」のセグメントボタン
- **レイヤー構造モード**:
  - 表示順: ag-psdのbottom-to-topを`.reverse()`でPhotoshop表示順（上がforeground）に変換
  - マルチカラムグリッド: 最大3列、4ファイル以上は次の行へ。CSS Gridで同一行の高さを揃え
  - サイドバー連動: selectedFileIdsがあればそのファイルのみ、なければ全ファイル表示
  - ローカル複数選択: クリックで単一選択、Shift+クリックで複数選択。チェック済みファイルはPhotoshop Blue (#31A8FF)でハイライト
  - Pキー: チェック済みファイルをPhotoshopで一括起動（単一ファイル時はそのまま起動）
  - モード連動: actionMode (hide/show) に応じて willChange / 済 / 要確認 をバッジ表示
  - リスク分類: layerMatcher.ts で safe/warning/none を判定。ラスターレイヤーの誤非表示をwarning表示
- **ビューアーモード**:
  - 全ファイル対象の高解像度プレビュー（useHighResPreview, maxSize=2000）
  - ナビゲーション: 矢印キー/マウスホイール/矢印ボタン（端でクランプ、循環なし）
  - サイドバー選択変更時にビューアー位置を同期
  - P/Fショートカット: キャプチャフェーズ(`addEventListener(..., true)`)で現在表示中ファイルに対応（グローバルハンドラーより優先）
- **select-none**: テキスト選択防止（全インタラクティブリストコンテナに適用）

### UIフロー
```
1. ファイル読み込み（D&D or フォルダ選択）
         ↓
2. 仕様選択モーダル表示
   - 自動選択有効 & 前回選択あり → 自動でチェック開始
   - そうでなければモーダル表示
         ↓
3. モノクロ/カラー選択 → 自動チェック実行
         ↓
4. OK/NG結果をサムネイル・Toolbarに表示
         ↓
5. NGファイル選択 → 修正ガイド表示
         ↓
6. 「変換」ボタン → Photoshopで一括修正
```

## ディレクトリ構造

```
src/
├── main.tsx               # Reactエントリポイント（StrictMode + AppLayout）
├── App.tsx                # ルートコンポーネント
├── components/
│   ├── common/            # 共通コンポーネント
│   │   ├── CompactFileList.tsx    # コンパクトファイル一覧
│   │   ├── DetailSlidePanel.tsx   # スライドイン詳細パネル
│   │   └── TextExtractButton.tsx  # テキスト抽出フローティングボタン（COMIC-POT互換出力）
│   ├── file-browser/      # ファイル選択・ドロップゾーン
│   │   ├── DropZone.tsx          # UI表示のみ（D&DリスナーはuseGlobalDragDrop）
│   │   ├── FileBrowser.tsx       # フォルダ/ファイル選択ハンドラー
│   │   └── FileList.tsx          # ファイルリスト表示（選択/マルチセレクト）
│   ├── layout/            # レイアウトコンポーネント
│   │   ├── AppLayout.tsx         # メインレイアウト（TopNav + ビュー）
│   │   ├── TopNav.tsx            # 上部ナビゲーション（タブ切替）
│   │   └── ViewRouter.tsx        # ビュー切替ルーター
│   ├── views/             # ビューコンポーネント
│   │   ├── FileView.tsx          # ファイル一覧ビュー
│   │   ├── FontBookView.tsx      # フォント帳ビュー
│   │   ├── LayerControlView.tsx  # レイヤー制御ビュー
│   │   ├── SpecCheckView.tsx     # 仕様チェックビュー（サムネイル/レイヤー/写植タブ切替）
│   │   ├── TypsettingView.tsx    # 写植関連ビュー（写植チェック・確認を統合）
│   │   ├── ViewerView.tsx        # ビューアービュー（SpecViewerPanel再利用）
│   │   ├── ReplaceView.tsx       # レイヤー差替えビュー
│   │   ├── ComposeView.tsx      # 合成ビュー（ComposePanel + ComposeDropZone）
│   │   ├── SplitView.tsx         # 見開き分割ビュー
│   │   ├── RenameView.tsx        # リネームビュー（fileEntries→psdStore自動同期）
│   │   ├── TiffView.tsx          # TIFF化ビュー（3カラム: FileList|Center|Settings）
│   │   └── ScanPsdView.tsx      # Scan PSDビュー（ScanPsdPanel + ScanPsdContent）
│   ├── metadata/          # メタデータ表示
│   │   ├── MetadataPanel.tsx
│   │   └── LayerTree.tsx
│   ├── preview/           # プレビュー
│   │   ├── PreviewGrid.tsx
│   │   ├── PreviewList.tsx        # リスト形式プレビュー（サムネイル+メタデータ）
│   │   └── ThumbnailCard.tsx
│   ├── spec-checker/      # 仕様チェック
│   │   ├── CaptureOverlay.tsx    # キャプチャオーバーレイ
│   │   ├── ConversionToast.tsx
│   │   ├── FixGuidePanel.tsx
│   │   ├── FontBrowserDialog.tsx # フォントブラウザダイアログ
│   │   ├── GuideSectionPanel.tsx
│   │   ├── LayerSeparationPanel.tsx # レイヤー分離パネル
│   │   ├── SpecCardList.tsx     # チェック結果カードリスト（マルチセレクト対応）
│   │   ├── SpecCheckTable.tsx    # 仕様チェック結果テーブル
│   │   ├── SpecCheckerPanel.tsx
│   │   ├── SpecLayerGrid.tsx     # レイヤー構造グリッド（全ファイル一覧）
│   │   ├── SpecScanJsonDialog.tsx # スキャンJSONダイアログ
│   │   ├── SpecSelectionModal.tsx
│   │   ├── SpecTextGrid.tsx      # 写植仕様グリッド（フォント/サイズ統計 + テキストレイヤー一覧）
│   │   └── SpecViewerPanel.tsx   # ビューアーパネル（画像+サイドバー、全画面対応）
│   ├── guide-editor/      # ガイド線編集
│   │   ├── GuideEditorModal.tsx
│   │   ├── GuideCanvas.tsx
│   │   ├── CanvasRuler.tsx
│   │   └── GuideList.tsx          # ガイド一覧（位置編集/削除）
│   ├── layer-control/     # レイヤー制御
│   │   ├── LayerControlPanel.tsx        # 条件指定UIと実行ボタン
│   │   ├── LayerPreviewPanel.tsx        # レイヤーツリープレビュー（グリッド・選択・Ps連携）
│   │   └── LayerControlResultDialog.tsx # 処理結果レポートダイアログ
│   ├── replace/           # レイヤー差替え
│   │   ├── ReplacePanel.tsx
│   │   ├── ReplaceDropZone.tsx
│   │   ├── ReplacePairingModal.tsx      # ペアリング確認ダイアログ（タブ切替シェル）
│   │   ├── PairingAutoTab.tsx           # 自動ペアリングタブ（チェック/編集/解除付きテーブル）
│   │   ├── PairingManualTab.tsx         # 手動マッチタブ（2カラム+クリック/ドラッグ）
│   │   ├── PairingOutputSettings.tsx    # 出力設定（保存ファイル名・フォルダ名）
│   │   └── ReplaceToast.tsx
│   ├── compose/           # 合成
│   │   ├── ComposePanel.tsx             # 合成設定パネル（要素選択・ペアリング方式）
│   │   ├── ComposeDropZone.tsx          # Source A/B ドロップゾーン
│   │   ├── ComposePairingModal.tsx      # ペアリング確認ダイアログ（タブ切替シェル）
│   │   ├── ComposePairingAutoTab.tsx    # 自動ペアリングタブ
│   │   ├── ComposePairingManualTab.tsx  # 手動マッチタブ
│   │   ├── ComposePairingOutputSettings.tsx # 出力設定
│   │   └── ComposeToast.tsx             # 合成完了トースト通知
│   ├── split/             # 見開き分割
│   │   ├── SplitPanel.tsx
│   │   ├── SplitPreview.tsx       # 定規ドラッグ・ガイド操作・ズーム/パン
│   │   └── SplitResultDialog.tsx  # 分割処理結果ダイアログ
│   ├── rename/            # リネーム
│   │   ├── LayerRenamePanel.tsx   # レイヤーリネーム設定UI
│   │   ├── FileRenamePanel.tsx    # ファイルリネーム設定UI
│   │   ├── RenamePreview.tsx      # プレビュー表示（両モード共通）
│   │   └── RenameResultDialog.tsx # 処理結果ダイアログ
│   ├── tiff/              # TIFF化
│   │   ├── TiffAutoScanDialog.tsx       # 自動スキャンダイアログ
│   │   ├── TiffBatchQueue.tsx           # バッチキュー＋個別上書き＋リネームプレビュー＋サブフォルダチェック
│   │   ├── TiffCanvasMismatchDialog.tsx # キャンバスサイズ不一致ダイアログ
│   │   ├── TiffCropEditor.tsx           # ビジュアルクロップエディタ（ドラッグ矩形・savedGlobalBoundsRefで個別編集後グローバル復元）
│   │   ├── TiffCropSidePanel.tsx        # クロップ設定サイドパネル（比率OK/サイズ/PSD自動設定のみ表示、手入力廃止）
│   │   ├── TiffFileList.tsx             # 中央ファイルリスト（スキップ切替・個別設定・サブフォルダチェック）
│   │   ├── TiffPageRulesEditor.tsx      # ページ別カラー設定
│   │   ├── TiffPartialBlurModal.tsx     # 部分ぼかし設定モーダル（ファイル別モード時は空リスト開始）
│   │   ├── TiffResultDialog.tsx         # 処理結果ダイアログ
│   │   ├── TiffSettingsPanel.tsx        # 左パネル設定UI（折りたたみセクション: 出力形式/カラーぼかし/クロップ・リサイズ/リネーム・出力先）
│   │   └── TiffViewerPanel.tsx          # TIFF化ビューアーパネル（プレビュー表示）
│   ├── scanPsd/           # Scan PSD（フォントプリセット管理）
│   │   ├── ScanPsdPanel.tsx          # 左パネル（5タブ + 保存ボタン）
│   │   ├── ScanPsdContent.tsx        # 右パネル（モード選択/スキャンUI/サマリー/ファイルブラウザ）
│   │   ├── ScanPsdEditView.tsx       # JSON編集ビュー
│   │   ├── ScanPsdModeSelector.tsx   # モード選択カード（新規/編集）
│   │   ├── JsonFileBrowser.tsx       # basePath以下のJSON専用ファイルブラウザ
│   │   └── tabs/
│   │       ├── WorkInfoTab.tsx       # タブ0: 作品情報（ジャンル/レーベル/著者/タイトル等）
│   │       ├── FontTypesTab.tsx      # タブ1: フォント種類（プリセットセット管理）
│   │       ├── FontSizesTab.tsx      # タブ2: フォントサイズ統計
│   │       ├── GuideLinesTab.tsx     # タブ3: ガイド線（選択/除外）
│   │       └── TextRubyTab.tsx       # タブ4: テキスト/ルビ
│   ├── typesetting-confirm/ # 写植確認
│   │   └── TypesettingConfirmPanel.tsx  # フォント指定・テキスト保存・ビューアー連動
│   ├── ErrorBoundary.tsx  # Reactエラーバウンダリ（ViewRouterに適用）
│   └── ui/                # 共通UIコンポーネント
│       ├── index.ts              # バレルエクスポート
│       ├── Badge.tsx             # ステータスバッジ（rgb/grayscale/success/error/warning/pink/purple/mint）
│       ├── GlowCard.tsx          # グロー効果カード（hover時、selected/glowColor指定可）
│       ├── Modal.tsx             # モーダルダイアログ
│       ├── PopButton.tsx         # ポップオーバーボタン
│       ├── ProgressBar.tsx       # プログレスバー（success/warning/animated）
│       ├── SpeechBubble.tsx      # 吹き出し（success/warning/error/info、尾位置指定）
│       └── Tooltip.tsx           # ホバーツールチップ（top/bottom/left/right、遅延指定）
├── hooks/
│   ├── useAppUpdater.ts          # アプリ更新管理（Tauri Updaterプラグイン）
│   ├── useCanvasSizeCheck.ts     # キャンバスサイズ検証（多数派検出・外れ値フラグ）
│   ├── useComposeProcessor.ts    # 合成処理（スキャン＆ペアリング・PS実行）
│   ├── useCropEditorKeyboard.ts  # クロップエディタキーボード操作（Tachimi互換）
│   ├── useFileWatcher.ts         # ファイル変更監視（外部変更検出）
│   ├── useFontResolver.ts        # フォント名解決（PostScript名→表示名・色マッピング・未インストール検出）
│   ├── useGlobalDragDrop.ts      # グローバルD&Dリスナー（AppLayoutで常時有効）
│   ├── useHandoff.ts             # ハンドオフ機能（外部ツール連携）
│   ├── useHighResPreview.ts      # 高解像度プレビュー（3層キャッシュ）
│   ├── useLayerControl.ts        # レイヤー制御（hide/show/custom/organize/layerMove）
│   ├── useOpenFolder.ts          # エクスプローラー表示（openFolderForFile / revealFiles）+ Fキーショートカット
│   ├── useOpenInPhotoshop.ts     # Photoshopファイル起動（ユーティリティ + Pキーショートカット）
│   ├── usePageNumberCheck.ts     # ページ番号検出（ファイル名から連番抽出・欠番検出）
│   ├── usePhotoshopConverter.ts  # Photoshop経由仕様変換（DPI/カラー/ビット深度）
│   ├── usePreparePsd.ts          # PSD準備（仕様修正+ガイド適用の統合処理）
│   ├── usePsdLoader.ts           # PSD読み込み・自然順ソート・PDF展開
│   ├── useRenameProcessor.ts     # リネーム処理（ファイル/レイヤー）
│   ├── useReplaceProcessor.ts    # レイヤー差替え処理
│   ├── useScanPsdProcessor.ts    # Scan PSD処理（スキャン・JSON保存/読込・ガイド自動選択）
│   ├── useSpecChecker.ts         # 仕様チェック（自動実行・結果キャッシュ）
│   ├── useSpecConverter.ts       # 直接仕様変換（ag-psd+Rust、Photoshop不要）
│   ├── useSplitProcessor.ts      # 見開き分割処理
│   └── useTiffProcessor.ts       # TIFF化処理（設定マージ・invoke・結果処理）
├── lib/
│   ├── psd/
│   │   └── parser.ts            # ag-psdラッパー、メタデータ抽出
│   ├── agPsdScanner.ts          # ag-psdスキャナー（PSDメタデータ一括収集）
│   ├── layerMatcher.ts          # レイヤーマッチング・リスク分類（共有ロジック）+ 差替え対象マッチング
│   ├── layerTreeOps.ts          # レイヤーツリー操作ユーティリティ
│   ├── naturalSort.ts           # 自然順ソート（数字部分を数値比較）
│   └── textUtils.ts             # テキスト処理ユーティリティ
├── store/
│   ├── index.ts           # バレルエクスポート（psdStore, guideStore, specStore）
│   ├── psdStore.ts        # ファイル一覧・選択状態（files, selectedFileIds, activeFileId, viewMode）
│   ├── specStore.ts       # 仕様・チェック結果（specifications, checkResults, autoCheckEnabled）。localStorage永続化
│   ├── guideStore.ts      # ガイド線状態（guides, history/future, selectedGuideIndex）
│   ├── layerStore.ts      # レイヤー制御: actionMode(hide/show/custom/organize/layerMove), saveMode, selectedConditions, customConditions, organizeTargetName, layerMove条件, deleteHiddenText, customVisibilityOps/customMoveOps（カスタム操作Map）
│   ├── viewStore.ts       # ビュー切替状態（activeView: AppView）
│   ├── fontBookStore.ts   # フォント帳（entries, fontBookDir, isLoaded）
│   ├── splitStore.ts      # 分割設定（settings, selectionHistory/Future）
│   ├── replaceStore.ts    # 差替え設定（folders, batchFolders, settings, pairingJobs, manualPairs, excludedPairIndices）
│   ├── composeStore.ts    # 合成設定（folders, settings, pairingJobs, scannedFileGroups, manualPairs）
│   ├── renameStore.ts     # リネーム設定（subMode, layerSettings, fileSettings, fileEntries）
│   ├── tiffStore.ts       # TIFF化設定・状態（settings, fileOverrides, cropPresets, cropGuides, phase, results）。localStorage永続化（crop.bounds除く）
│   ├── scanPsdStore.ts    # Scan PSD（mode, scanData, presetSets, workInfo, guide選択/除外, パス設定）。パスのみlocalStorage永続化
│   └── typesettingCheckStore.ts  # 写植チェック（checkData, checkTabMode, searchQuery, navigateToPage）
├── styles/
│   └── globals.css
└── types/
    ├── index.ts           # PsdFile, PsdMetadata, LayerNode, TextInfo, Specification, SpecRule, SpecCheckResult, IMAGE_EXTENSIONS等
    ├── fontBook.ts        # FontBookEntry, FontBookData, FontBookParams
    ├── replace.ts         # ReplaceSettings, PairingJob, FolderSelection, BatchFolder等
    ├── rename.ts          # RenameSubMode, RenameRule, FileRenameEntry等
    ├── tiff.ts            # TiffSettings, TiffCropBounds, TiffCropPreset, TiffScandataFile等
    ├── scanPsd.ts         # ScanData, PresetJsonData, ScanGuideSet, ScanWorkInfo, FontPreset, GENRE_LABELS, FONT_SUB_NAME_MAP等
    └── typesettingCheck.ts # ProofreadingCheckData, CheckItem, CheckKind等

src-tauri/
├── scripts/
│   ├── apply_guides.jsx       # ガイド線適用
│   ├── convert_psd.jsx        # 仕様変換（DPI/カラーモード/ビット深度/αチャンネル削除）
│   ├── custom_operations.jsx  # カスタム操作（個別表示/非表示・移動・非表示テキスト削除）
│   ├── hide_layers.jsx        # レイヤー表示/非表示
│   ├── lock_layers.jsx        # レイヤーロック/アンロック
│   ├── merge_layers.jsx       # レイヤー結合
│   ├── move_layers.jsx        # レイヤー整理（条件ベースのレイヤー移動）
│   ├── organize_layers.jsx    # フォルダ格納（グループ再構成）
│   ├── prepare_psd.jsx        # PSD準備（仕様修正+ガイド適用の統合処理）
│   ├── rename_psd.jsx         # レイヤーリネーム
│   ├── replace_layers.jsx     # レイヤー差替え＋合成処理
│   ├── scan_psd.jsx           # PSDスキャン（レガシー、元スクリプト全機能）
│   ├── scan_psd_core.jsx      # PSDスキャン（コア処理のみ、UI無し）
│   ├── split_psd.jsx          # 見開き分割
│   └── tiff_convert.jsx       # TIFF化（テキスト整理・カラー変換・ぼかし・クロップ・リサイズ）
├── resources/
│   └── pdfium/
│       └── pdfium.dll         # PDFiumバイナリ（.gitignore管理、別途DL）
├── Cargo.toml             # Rust依存関係（pdfium-render, fontdb, tokio, serde等）
├── tauri.conf.json        # Tauri設定（ウィンドウ、プラグイン、セキュリティ）
├── build.rs               # ビルドスクリプト
└── src/
    ├── main.rs            # Tauriエントリポイント
    ├── lib.rs             # コマンド登録（invoke_handler）
    ├── commands.rs        # 全Tauriコマンド
    ├── pdf.rs             # PDFレンダリング内部ヘルパー（pdfium-render）
    ├── psd_metadata.rs    # PSDメタデータ抽出ユーティリティ
    └── watcher.rs         # ファイル変更監視（外部ファイル変更検出）
```

## 重要な型定義

```typescript
// 対応ファイル形式 (types/index.ts)
const IMAGE_EXTENSIONS = [".psd", ".psb", ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".pdf", ".gif", ".eps"];
const PSD_EXTENSIONS = [".psd", ".psb"];  // ag-psdでパース可能なもの
// isSupportedFile(fileName) / isPsdFile(fileName) / isPdfFile(fileName) ヘルパー関数あり

// PsdFile PDF関連フィールド（PDFページ展開時に設定）
interface PsdFile {
  // ... 既存フィールド ...
  sourceType?: "psd" | "image" | "pdf";  // ファイル種別
  pdfSourcePath?: string;                // PDF元ファイルパス
  pdfPageIndex?: number;                 // 0-based ページ番号
}

// PSDメタデータ
interface PsdMetadata {
  width: number;
  height: number;
  dpi: number;
  colorMode: ColorMode;
  bitsPerChannel: number;
  hasGuides: boolean;
  guides: Guide[];
  layerCount: number;
  layerTree: LayerNode[];
  hasAlphaChannels: boolean;
  alphaChannelCount: number;
  alphaChannelNames: string[];
}

// レイヤーノード
interface LayerNode {
  id: string;
  name: string;
  type: "layer" | "group" | "text" | "adjustment" | "smartObject" | "shape";
  visible: boolean;
  opacity: number;
  blendMode: string;
  hasMask?: boolean;        // レイヤーマスク（ag-psd: mask/realMask）
  hasVectorMask?: boolean;  // ベクトルマスク（ag-psd: vectorMask）
  clipping?: boolean;       // クリッピングマスク（ag-psd: clipping）
  textInfo?: TextInfo;      // テキストレイヤーのフォント・サイズ情報
  children?: LayerNode[];
}

// テキスト情報（parser.tsで抽出、ag-psd text.style/styleRunsから）
interface TextInfo {
  text: string;
  fonts: string[];       // PostScript名（例: "KozMinPr6N-Regular"）
  fontSizes: number[];   // ポイント数（DPI正規化済み: fontSize * 72/dpi）
}

// 仕様定義
interface Specification {
  id: string;
  name: string;
  enabled: boolean;
  rules: SpecRule[];
}

// チェックルール
interface SpecRule {
  type: "colorMode" | "dpi" | "bitsPerChannel" | "hasAlphaChannels" | ...;
  operator: "equals" | "greaterThan" | "lessThan" | ...;
  value: string | number | boolean;
  message: string;
}

// チェック結果
interface SpecCheckResult {
  fileId: string;
  passed: boolean;
  results: { rule: SpecRule; passed: boolean; actualValue: any }[];
  matchedSpec?: string;
}
```

## 自動チェックの実装ポイント

- **仕様チェックはSpecCheckViewでのみ実行**: `useSpecChecker()`は`SpecCheckView`内で呼び出す（`AppLayout`からは除外）。他タブでは自動チェックが走らない

```typescript
// useSpecChecker.ts
// 重要: files.lengthではなくfilesWithMetadataCountを監視する
// PSD読み込みは非同期でメタデータが後から追加されるため
const filesWithMetadataCount = files.filter((f) => f.metadata).length;

useEffect(() => {
  const specChanged = activeSpecId !== prevActiveSpecIdRef.current;
  const metadataAdded = filesWithMetadataCount > prevFilesWithMetadataRef.current;

  if (activeSpecId && filesWithMetadataCount > 0 && (specChanged || metadataAdded)) {
    checkAllFiles(enabledSpecs);
  }
}, [activeSpecId, filesWithMetadataCount, ...]);
```

## Photoshop JSX連携の注意点

1. **設定ファイルの受け渡し**: `Folder.temp` にJSONファイルを配置
2. **UTF-8 BOM**: 日本語パス対応のため `0xEF, 0xBB, 0xBF` を先頭に付与
3. **パス変換**: Windows `\\` → `/` に変換（JSX互換性）
4. **JSON処理**: ExtendScriptにはネイティブJSONがないため自作パーサーを使用
5. **DPIリサンプリング**: `ResampleMethod.BICUBIC` で実際のピクセル処理
6. **結果パスの正規化**: JSXからの結果パスは `/` 区切り → フロントでの比較時に `\` へ正規化が必要（各processorフックで`.replace(/\//g, "\\")`）
7. **ウィンドウ前面化**: 処理完了後に `window.set_focus()` でアプリを前面に復帰（全Photoshop連携コマンド）
8. **Zustandのstale closure回避**: `useCallback`内で最新のstoreデータが必要な場合は`usePsdStore.getState().files`を使用（`files`をdepsに入れると古い値が参照される）
9. **Tauri D&D座標のDPR補正**: `onDragDropEvent`は物理ピクセル座標を返すが`getBoundingClientRect()`はCSS座標。`pos.x / window.devicePixelRatio`で補正が必要（Windows 150%スケーリング等）
10. **`<button>`は`<label>`のlabelable要素**: `<button>`を`<label>`内に配置するとクリック時に二重トグルが発生する。カスタムCheckBoxには`<div role="checkbox">`を使用
11. **JSX詳細レポート（差替え）**: `result.changes`に`"  → レイヤー「name」"`/`"  → グループ「name」"`/`"  → テキストフォルダ「name」"`形式で個別マッチを記録。フロント側`extractMatchedNames()`で正規表現パース
12. **JSX詳細レポート（レイヤー制御）**: `changedNames`に`"テキスト「name」∈「parent」"`形式で親フォルダ情報付きで記録。フロント側`extractMatchedItems()`→`buildTree()`でツリー構築。親フォルダが結果に含まれない場合はコンテキストとして`グループ`ノード（G）を自動生成
13. **Photoshopスクリプト実行パターン**: 基本は「直接パス + `.output()` + ポーリング」。ただし`split_psd`と`tiff_convert`は処理時間が長いため「temp copy + `.spawn()` + ポーリング」を使用（`.output()`はPS実行中ブロックするため）
14. **非PSDファイルの読み込み**: `isPsdFile()`で判定し、PSD以外は`stat()`でファイルサイズのみ取得。ag-psdパースはスキップ。Photoshopが開ける前提でファイル一覧に表示
15. **ExtendScript `File.name` のURI符号化**: `File.name`は非ASCII文字をURIエンコードして返す（例: `校正_堀川` → `%E6%A0%A1%E6%AD%A3_%E5%A0%80%E5%B7%9D`）。`decodeURI(file.name)`で正しいファイル名を取得すること
16. **PDF分割処理**: JSX側で`pdfPageIndex >= 0`の場合、`PDFOpenOptions`（`page`, `resolution: 600`, `mode: OpenDocumentMode.RGB`）でページ指定オープン。`fileInfos`は`{ path, pdfPageIndex }`形式で渡す（`pdfPageIndex: -1`は通常ファイル）
17. **ExtendScript Document比較**: `sourceDoc === targetDoc` は異なるDocumentオブジェクトでも`true`を返すことがある。**Documentオブジェクトの`===`比較は使わず、文字列ラベル（"A"/"B"）で比較すること**（合成モードの要素ルーティングで発生したバグ）

## フォント名解決（Rust側）

`resolve_font_names` コマンド: PostScript名からシステムフォントの表示名・スタイル名を解決
- `fontdb::Database` でシステムフォントをロード（`OnceLock`でキャッシュ）
- 日本語名優先（`Language::Japanese_Japan`）
- サブファミリー名: `ttf_parser` で OpenType name table から ID 17 (Typographic Subfamily) → ID 2 (Subfamily) の優先順で抽出。日本語ロケール (0x0411) > 英語 (0x0409) > その他
- フロント: `useFontResolver` フックが `invoke("resolve_font_names")` で一括解決。フォント色パレット割当、未インストール検出も管理

`search_font_names` コマンド: フォント名で部分一致検索（手動フォント追加用）
- PostScript名・表示名の両方を対象にcase-insensitive部分一致
- 最大30件まで返却（`FontNameSearchResult`: `postscript_name`, `display_name`, `style_name`）
- FontTypesTabの手動フォント追加フォームから使用

## 高速PSD読み込み（Rust側）

tachimi_standaloneから移植した高速PSD読み込み機能:

1. **直接Image Data読み込み**: レイヤー解析をスキップして合成画像のみ取得
2. **RLE/PackBits圧縮デコード**: PSD独自の圧縮形式を直接デコード
3. **PSDキャッシュ**: `OnceLock<Mutex<HashMap>>` で最大10エントリをキャッシュ
4. **非同期処理**: `tokio::task::spawn_blocking` でUIフリーズ防止
5. **高速リサイズ**: `FilterType::CatmullRom`（Lanczos3より高速）
6. **asset://プロトコル**: `convertFileSrc()` でファイルパスをURLに変換

```rust
// commands.rs - 高速PSD読み込みの流れ
load_psd_fast(path)
  → load_psd_composite(path)  // 直接Image Dataセクション読み込み
  → 失敗時: psd crateにフォールバック
```

## PDFレンダリング（Rust側）

pdfium-renderによるPDFプレビュー/サムネイル生成:

1. **PDFium DLL**: `src-tauri/resources/pdfium/pdfium.dll`から遅延ロード（`OnceLock<Pdfium>`でシングルトン管理）
2. **DLL探索順**: リソースディレクトリ → `CARGO_MANIFEST_DIR/resources/` → システムPATH
3. **Tauriコマンド**: `get_pdf_info`（ページ数・寸法）、`get_pdf_preview`（高解像度）、`get_pdf_thumbnail`（Base64サムネイル）
4. **ページ展開**: PDFドロップ時に`get_pdf_info`で全ページ情報取得 → `psdStore.replaceFile()`で1ファイルを複数ページエントリーに置換
5. **キャッシュ**: ディスクキャッシュ `manga_pdf_preview_{name}_{mtime}_{page}_{size}.jpg`（既存PSDキャッシュと同一パターン）
6. **pdfium-render API注意**: ページインデックスは`u16`型（`PdfPageIndex`）、`PdfPoints`は`.value: f32`、`as_image()`は`DynamicImage`を直接返す

## Rustコマンド一覧（commands.rs — 55コマンド）

### Photoshop連携
| コマンド | 引数 | 戻り値 | 用途 |
|---------|------|--------|------|
| `check_photoshop_installed` | — | `serde_json::Value` | Photoshopインストール確認 |
| `run_photoshop_conversion` | `settings: PhotoshopConversionSettings` | `Vec<PhotoshopResult>` | 仕様変換（DPI/カラー/ビット/α） |
| `run_photoshop_guide_apply` | `file_paths, guides` | `Vec<PhotoshopResult>` | ガイド線適用 |
| `run_photoshop_prepare` | `settings: PrepareSettings` | `Vec<PhotoshopResult>` | PSD準備（統合処理） |
| `run_photoshop_layer_visibility` | `file_paths, conditions, mode, save_mode` | `Vec<PhotoshopResult>` | レイヤー表示/非表示 |
| `run_photoshop_layer_organize` | `file_paths, target_group_name, include_special, save_mode` | `Vec<PhotoshopResult>` | フォルダ格納 |
| `run_photoshop_layer_move` | `file_paths, target_group_name, create_if_missing, search_scope, conditions, save_mode` | `Vec<PhotoshopResult>` | レイヤー整理（条件ベース移動） |
| `run_photoshop_layer_lock` | `file_paths, ...` | `Vec<PhotoshopResult>` | レイヤーロック/アンロック |
| `run_photoshop_merge_layers` | `file_paths, ...` | `Vec<PhotoshopResult>` | レイヤー結合 |
| `run_photoshop_custom_operations` | `file_paths, file_ops, save_mode, delete_hidden_text?` | `Vec<PhotoshopResult>` | カスタム操作（個別表示/非表示・移動・テキスト削除） |
| `run_photoshop_split` | 多数パラメータ（mode, format, quality, selection等） | `SplitResponse` | 見開き分割 |
| `run_photoshop_replace` | `jobs: ReplaceJobSettings` | `Vec<PhotoshopResult>` | レイヤー差替え/合成 |
| `run_photoshop_rename` | `settings: RenameJobSettings` | `Vec<PhotoshopResult>` | レイヤーリネーム |
| `run_photoshop_tiff_convert` | `settings_json, output_dir` | `TiffConvertResponse` | TIFF化 |
| `run_photoshop_scan_psd` | `settings_json` | `String` | PSDスキャン |
| `poll_scan_psd_progress` | — | `Option<String>` | スキャン進捗ポーリング（同期） |
| `open_file_in_photoshop` | `file_path` | `()` | ファイルをPSで開く |

### 画像処理（Photoshop不要）
| コマンド | 引数 | 戻り値 | 用途 |
|---------|------|--------|------|
| `resample_image` | `file_path, output_path?, options: ResampleOptions` | `ProcessResult` | DPIリサンプリング |
| `batch_resample_images` | `file_paths, output_dir?, options` | `BatchProcessResult` | 一括リサンプリング |
| `convert_color_mode` | `file_path, output_path?, target_mode` | `ProcessResult` | カラーモード変換 |
| `get_image_info` | `file_path` | `serde_json::Value` | 画像メタデータ取得 |
| `parse_psd_metadata_batch` | `file_paths` | `Vec<PsdParseResult>` | PSDメタデータ一括解析 |

### プレビュー・キャッシュ
| コマンド | 引数 | 戻り値 | 用途 |
|---------|------|--------|------|
| `get_high_res_preview` | `file_path, max_size` | `HighResPreviewResult` | 高解像度プレビュー生成 |
| `clear_psd_cache` | — | `()` | PSDキャッシュクリア |
| `cleanup_preview_files` | — | `u32` | プレビューファイル削除（件数返却） |
| `invalidate_file_cache` | `file_path` | `()` | 特定ファイルのキャッシュ無効化 |

### PDF
| コマンド | 引数 | 戻り値 | 用途 |
|---------|------|--------|------|
| `get_pdf_info` | `file_path` | `PdfInfoResult` | PDFページ情報 |
| `get_pdf_preview` | `file_path, page_index, max_size` | `HighResPreviewResult` | PDFページプレビュー |
| `get_pdf_thumbnail` | `file_path, page_index, max_size` | `String`(Base64) | PDFサムネイル |

### ファイル操作
| コマンド | 引数 | 戻り値 | 用途 |
|---------|------|--------|------|
| `read_text_file` | `file_path` | `String` | テキストファイル読込 |
| `write_text_file` | `file_path, content` | `()` | テキストファイル書込 |
| `write_binary_file` | `file_path, data` | `()` | バイナリファイル書込 |
| `delete_file` | `file_path` | `()` | ファイル削除 |
| `path_exists` | `path` | `bool` | パス存在確認 |
| `list_folder_contents` | `folder_path` | `FolderContents` | フォルダ内容一覧（ファイル+サブフォルダ） |
| `list_folder_files` | `folder_path, recursive` | `Vec<String>` | ファイル一覧（再帰対応） |
| `list_all_files` | `folder_path` | `Vec<String>` | 全ファイル一覧 |
| `list_subfolders` | `folder_path` | `Vec<String>` | サブフォルダ一覧 |
| `batch_rename_files` | `entries, output_directory?, mode` | `Vec<BatchRenameResult>` | 一括ファイルリネーム |
| `detect_psd_folders` | `folder_path` | `serde_json::Value` | PSD含有フォルダ検出 |
| `search_json_folders` | `base_path, query` | `Vec<JsonFolderResult>` | JSONフォルダ検索 |

### ファイル監視
| コマンド | 引数 | 戻り値 | 用途 |
|---------|------|--------|------|
| `start_file_watcher` | `app_handle, file_paths` | `()` | ファイル変更監視開始 |
| `stop_file_watcher` | — | `()` | ファイル変更監視停止 |

### フォント
| コマンド | 引数 | 戻り値 | 用途 |
|---------|------|--------|------|
| `resolve_font_names` | `postscript_names` | `HashMap<String, FontResolveInfo>` | フォント名解決（完全一致、同期） |
| `search_font_names` | `query, max_results?` | `Vec<FontNameSearchResult>` | フォント名部分一致検索（手動追加用） |
| `list_font_folder_contents` | `folder_path, no_cache?` | `Vec<FontFileEntry>` | フォントフォルダ内容一覧 |
| `search_font_files` | `base_path, query` | `Vec<FontFileEntry>` | フォントファイル検索 |
| `install_font_from_path` | `font_path` | `String` | フォントインストール |

### ユーティリティ
| コマンド | 引数 | 戻り値 | 用途 |
|---------|------|--------|------|
| `open_folder_in_explorer` | `folder_path` | `()` | エクスプローラーでフォルダを開く |
| `reveal_files_in_explorer` | `file_paths` | `()` | エクスプローラーでファイルを選択表示 |
| `open_with_default_app` | `file_path` | `()` | デフォルトアプリで開く |
| `launch_kenban_diff` | `folder_a, folder_b, mode?` | `()` | KENBAN差分ツール起動 |
| `launch_tachimi` | `file_paths` | `()` | Tachimiツール起動 |
| `launch_progen` | `handoff_text_path?` | `()` | ProGenツール起動 |
| `check_handoff` | — | `Option<HandoffData>` | ハンドオフデータ確認 |

## デフォルト仕様

### モノクロ原稿
- カラーモード: Grayscale
- 解像度: 600dpi
- ビット深度: 8bit
- αチャンネル: なし

### カラー原稿
- カラーモード: RGB
- 解像度: 350dpi
- ビット深度: 8bit
- αチャンネル: なし

## UIテーマ（ライトテーマ）

明るくポップな漫画風UIを採用:

### カラーパレット
```javascript
// 背景
bg-primary: "#faf8f5"    // クリームホワイト（メイン背景）
bg-secondary: "#ffffff"  // 純白（パネル）
bg-tertiary: "#f5f3f0"   // 柔らかいグレー（カード）

// テキスト
text-primary: "#2d2d3a"  // ダークパープル
text-secondary: "#5a5a6e"
text-muted: "#9090a0"

// アクセント
accent: "#ff5a8a"        // ビビッドピンク
accent-secondary: "#7c5cff" // パープル
accent-tertiary: "#00c9a7"  // ミントグリーン

// ステータス
success: "#22c55e"       // 鮮やかな緑
error: "#ef4444"         // 鮮やかな赤
warning: "#f59e0b"       // オレンジ
```

### フォント
- **UI本文**: `--font-ui` = Noto Sans JP
- **見出し**: `--font-display` = Zen Maru Gothic

### デザイン要素
- 角丸の大きいカード・ボタン（rounded-xl, rounded-2xl）
- ソフトシャドウ（shadow-soft, shadow-card）
- グラデーション（gradient-pop: #ff6b9d → #7c5cff）
- グロー効果（shadow-glow-pink, shadow-glow-error）
- スクロールバー: ピンク→パープルのグラデーションサム
- フォーカスリング: 2px solid #ff6b9d
- 選択色: 半透明ピンク背景

## 主要依存関係

### フロントエンド
- React 18.3.1、Zustand 5.0.0、ag-psd 30.1.0
- Tailwind CSS 3.4.15、Vite 5.4.0、TypeScript
- @tauri-apps/api 2.0.0
- Tauriプラグイン: dialog, fs, process, updater

### Rust
- tauri 2.0、tokio（非同期ランタイム）、serde（シリアライズ）
- pdfium-render（PDF処理）、fontdb + ttf-parser（フォント解決）
- image（画像処理）

## 開発コマンド

```bash
# 開発サーバー起動
npm run tauri dev
# または
start-dev.bat

# ビルド
npm run tauri build
# または
build.bat

# フロントエンドのみ
npm run dev

# コード整形（Prettier）
npm run format
```

## リリース手順

新バージョンをリリースする際の手順:

### 1. バージョン番号を更新（3ファイル）
```bash
# 以下の3ファイルのバージョンを更新する
package.json           → "version": "x.x.x"
src-tauri/tauri.conf.json → "version": "x.x.x"
src-tauri/Cargo.toml      → version = "x.x.x"
```

### 2. コミット・プッシュ
```bash
git add -A
git commit -m "v1.x.x: 変更内容の要約"
git push origin main
```

### 3. タグを作成・プッシュ（CIトリガー）
```bash
git tag v1.x.x
git push origin v1.x.x
```

タグのpushにより `.github/workflows/release.yml` が自動実行され、以下が生成・アップロードされる:
- `Comic-Bridge_x.x.x_x64-setup.exe` — NSISインストーラー
- `Comic-Bridge_x.x.x_x64-setup.exe.sig` — Tauri Updater署名ファイル
- `latest.json` — 自動アップデート用メタデータ

### 4. CI完了確認
```bash
gh run list --limit 3          # ワークフロー一覧
gh run watch <run_id>          # リアルタイム進捗
gh release view v1.x.x --json assets -q '.assets[].name'  # アセット確認
```

### 注意事項
- **署名キー**: `TAURI_SIGNING_PRIVATE_KEY` と `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` はGitHub Secretsに設定済み（ローカルビルドでは不要）
- **ビルド時間**: CI完了まで約14〜16分
- **タグの再作成**: タグが既にリモートにある場合は `git push origin :refs/tags/v1.x.x` で削除してから再作成
- **リリースページ**: `https://github.com/Ina986/COMIC-Bridge/releases/tag/v1.x.x`

### 重要: 作業フォルダとgit操作について
- **作業フォルダに直接gitをセットアップすること**。別フォルダにクローンしてファイルをコピーする方法は禁止（変更漏れ・新規ファイルの見落とし・コミット履歴の不整合が発生する）
- ZIPから展開したフォルダで `.git` がない場合: `git init` → `git remote add origin <URL>` → `git fetch origin main` → `git reset origin/main`（作業ツリーを保持したままリモート履歴に接続）
- **`gh release create` だけではCIはトリガーされない**。必ず `git tag` + `git push origin <tag>` でタグをpushすること（CIは `on: push: tags: 'v*'` で発火する）
- **ローカルではTauriのリリースビルドはできない**（署名キーがGitHub Secretsにのみ存在）。ビルド・署名・アップロードは全てCI任せ

### 重要: コード同期時の `.github/` ディレクトリ
- タグやZIPからコードを同期する際は、**`.github/workflows/release.yml` も必ず同期すること**
- CIワークフローには **PDFiumダウンロードステップが必須**（`pdfium.dll`は`.gitignore`管理のためリポジトリに含まれない）
- このステップが欠落するとCIビルドが `resource path resources\pdfium\pdfium.dll doesn't exist` で失敗する
- 同期時のチェックリスト: `src/`, `src-tauri/`, ルートconfig, **`.github/`**

## localStorage永続化

```typescript
// specStore.ts（手動localStorage）
autoCheckEnabled: boolean     // 自動チェック有効/無効 — キー: "autoCheckEnabled"
lastSelectedSpecId: string    // 前回選択した仕様ID — キー: "lastSelectedSpecId"

// tiffStore.ts（手動localStorage）
settings: TiffSettings        // TIFF変換設定（crop.bounds除く）— キー: "tiff_lastSettings"
cropPresets: TiffCropPreset[]  // 保存済みクロップ範囲 — キー: "tiff_cropPresets"

// scanPsdStore.ts（手動localStorage）
jsonFolderPath: string         // JSONフォルダパス
saveDataBasePath: string       // scandata保存先パス
textLogFolderPath: string      // テキストログフォルダパス
```

## ガイドエディタのショートカット

| 操作 | キー |
|------|------|
| 元に戻す | Ctrl + Z |
| やり直す | Ctrl + Y / Ctrl + Shift + Z |
| ズームイン | Ctrl + (+/=) |
| ズームアウト | Ctrl + (-) |
| ズームリセット | Ctrl + 0 |
| パン | Space + ドラッグ |
| ガイド削除 | Delete / Backspace |

- 水平定規からドラッグ → 水平ガイド（Y軸位置）
- 垂直定規からドラッグ → 垂直ガイド（X軸位置）
- ガイドクリックで選択 → 選択中はハイライト表示
- Undo/Redo: 最大20ステップの履歴管理（guideStore）

## クロップエディタのショートカット（Tachimi互換）

| 操作 | キー |
|------|------|
| 元に戻す | Ctrl + Z |
| やり直す | Ctrl + Y / Ctrl + Shift + Z |
| ズームイン | Ctrl + (+/=) |
| ズームアウト | Ctrl + (-) |
| ズームリセット | Ctrl + 0 |
| パン | Space + ドラッグ |
| ガイド削除 | Delete / Backspace（ガイド選択時） |
| 選択範囲削除 | Delete / Backspace（範囲のみ時） |
| ガイド移動 | 矢印キー 1px / Shift+矢印 10px |
| 選択範囲移動 | 矢印キー 10px / Shift+矢印 1px |
| 選択解除 | Escape |

## グローバルショートカット

| 操作 | キー | ビュー |
|------|------|--------|
| 全選択 | Ctrl+A | 全タブ（INPUT/TEXTAREA/SELECT内は除外） |
| Photoshopで開く | P | レイヤー制御・仕様チェック・ビューアー（表示中ファイル） |
| フォルダを開く | F | 全タブ（ビューアーモードでは表示中ファイル） |
| 前のページ | ←/↑ | レイヤー制御ビューアー・ビューアータブ |
| 次のページ | →/↓ | レイヤー制御ビューアー・ビューアータブ |
| ページ送り | マウスホイール | レイヤー制御ビューアー・ビューアータブ |
| 全画面切替 | ボタン | ビューアータブ（Esc で解除） |
