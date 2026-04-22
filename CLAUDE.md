# COMIC-Bridge (manga-psd-manager)

漫画入稿データ（PSD）の確認・調整を行うデスクトップアプリケーション

## ⚠️ 重要な注意事項

**このプロジェクトフォルダ（`C:\Users\yamamoto-ryusei\Documents\6_スクリプト\アプリデータ\COMIC-Bridge_統合版\`）以外のファイルやフォルダを閲覧・参照しないこと。**
外部のファイルパスへのアクセスは、ユーザーが明示的に指定した場合（デバッグ用PSDファイルの読み取り等）に限る。

## 📐 設計ドキュメント索引

本 CLAUDE.md は機能仕様の詳細カタログ。全体像を俯瞰したい場合は以下を先に:

- **[docs/architecture.md](docs/architecture.md)** — レイヤー構成全体図（React / Tauri IPC / Rust / Photoshop JSX）。102 Rust コマンドの分類、起動シーケンス、import 規約とパスエイリアス
- **[docs/feature-map.md](docs/feature-map.md)** — 21 機能 × 画面 × ストア × フック × Rust × JSX の横断対応表。グローバルストア × feature の依存マトリクス
- **[docs/data-flow.md](docs/data-flow.md)** — 代表シナリオのシーケンス図（仕様チェック / TIFF 化 / ガイド適用 / ProGen / 差分ビューアー / スキャン PSD / ワークフロー横断 / データ格納先マップ）
- **[KENBAN統合手順書.md](KENBAN統合手順書.md)** — KENBAN 機能統合時の作業手順

各 feature 単位の詳細は feature 内の README を参照:
[compose](src/features/compose/README.md) / [diff-viewer](src/features/diff-viewer/README.md) / [layer-control](src/features/layer-control/README.md) / [parallel-viewer](src/features/parallel-viewer/README.md) / [progen](src/features/progen/README.md) / [rename](src/features/rename/README.md) / [replace](src/features/replace/README.md) / [scan-psd](src/features/scan-psd/README.md) / [spec-check](src/features/spec-check/README.md) / [split](src/features/split/README.md) / [tiff](src/features/tiff/README.md) / [unified-viewer](src/features/unified-viewer/README.md) / [_deprecated](src/features/_deprecated/README.md) / [shared (移行予定)](src/shared/README.md)

## 概要

漫画制作者や編集者が入稿前にPSDファイルの仕様をチェックし、必要に応じてPhotoshopと連携して一括修正できるツール。統合ビューアー（テキスト照合・写植確認・校正JSON・DTPビューアー・差分モード・分割ビューアー）とProGen（テキスト抽出・校正プロンプト生成ツール）を内蔵。全機能React/Tailwind/Zustandネイティブ実装。

## 技術スタック

- **フレームワーク**: Tauri 2.0
- **フロントエンド**: React 18 + TypeScript + Vite
- **スタイリング**: Tailwind CSS
- **状態管理**: Zustand
- **PSD処理**: ag-psd（読み取り専用）、Photoshop ExtendScript（変換・書き込み）
- **PDF処理**: pdfium-render（プレビュー/サムネイル）、Photoshop PDFOpenOptions（分割処理）
- **バックエンド**: Rust
- **統合ビューアー**: pdfjs-dist, pdf-lib, jspdf, lucide-react（LCS diff等のユーティリティは`kenban-utils/textExtract.ts`で共有）
- **差分ビューアー / 分割ビューアー**: React/Zustandネイティブ（v3.5.0でKENBANから完全移植済み）
- **ProGenタブ**: React（Zustand + Tailwind、本体と統合済み）

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
- **サブタブ構成**: 「レイヤー制御」「リネーム」の2タブ。リネームタブはRenameViewをそのまま内蔵
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
- `src/features/scan-psd/useScanPsdProcessor.ts` — スキャン実行、JSON/scandata保存・読込、ガイド自動選択
- `src/features/scan-psd/scanPsdStore.ts` — Zustandストア（persist未使用）
- `src/types/scanPsd.ts` — ScanData, PresetJsonData, ScanGuideSet, ScanWorkInfo, FontPreset等の型定義
- `src/features/scan-psd/components/ScanPsdContent.tsx` — 右パネル（モード選択、スキャンUI、サマリー、ファイルブラウザ）
- `src/features/scan-psd/components/ScanPsdPanel.tsx` — 左パネル（5タブ + 保存ボタン）
- `src/features/scan-psd/components/JsonFileBrowser.tsx` — basePath以下のJSON専用ファイルブラウザ
- `src/features/scan-psd/components/tabs/` — 各タブコンポーネント
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
- **コンポーネント**: `TypesettingConfirmPanel.tsx`（`src/features/_deprecated/typesetting/confirm/` — 隔離中）
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
- **設定オプション**: レイヤー順序（下→上 / 上→下）、非表示レイヤー含むかどうか、**フォルダごとに分けて作成**（v3.7.1: 複数フォルダ時のみ表示、ONで各フォルダ名.txtに分割保存）
- **ルビレイヤー自動除外**: レイヤー名が`文字（ふりがな）`パターンに一致する場合スキップ
- **出力先**: `Desktop/Script_Output/テキスト抽出/{フォルダ名}.txt`（重複時はタイムスタンプ付き）
- **保存後にエクスプローラーで出力フォルダを自動表示 + 統合ビューアーのテキストタブに自動読み込み**
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

### 20. 差分ビューアー / 分割ビューアー（v3.5.0でKENBANから完全移植、v3.6.0で大幅改善）
- **配置**: 統合ビューアータブ内のサブタブ（差分モード / 分割ビューアー）
- **差分ビューアー** (`src/features/diff-viewer/DiffViewerView.tsx` + `src/features/diff-viewer/diffStore.ts`)
  - **比較モード**: tiff-tiff / psd-psd / pdf-pdf / psd-tiff（PSD/TIFFは順序問わず双方向対応）
  - **表示モード**: 原稿A / 原稿B / 差分（ピクセル差分のヒートマップ・マーカー表示）
  - **ペアリング**: ファイル順 / 名前順
  - **オプション**: 差分のみ表示、マーカー表示、しきい値調整
  - **プレビューキャッシュ**: `previewMap` (filePath→URL) で全ファイルを並行プレビュー取得 → 差分計算前から表示
  - **自動差分計算**: ペア選択時に自動で Rust側 `compute_diff_simple`/`compute_diff_heatmap` を呼び出し（失敗してもプレビューは残る）
  - **不適切な組み合わせ判定**: `isValidPairCombination()` で compareMode に合わない場合は差分計算をスキップし、A単独表示。B側は赤いエラーカード表示
  - **タブ移動時の自動セットアップ**: 差分タブを開いた瞬間に `kenbanPathA/B` から filesA/B を自動読み込み + `computeCompareMode()` で compareMode 自動判定。**v3.7.2: A/B両方揃っている場合のみ読み込み実行**
  - **全画面（v3.7.2）**: サイドバー・ツールバー・ステータスバーすべて非表示、画像のみ表示。OSレベルフルスクリーン（タイトルバーも非表示）。Escapeで解除
  - **背景色（v3.7.2）**: 画像エリアを `#1a1a1e`（黒）に統一
- **分割ビューアー** (`src/features/parallel-viewer/ParallelViewerView.tsx` + `src/features/parallel-viewer/parallelStore.ts`)
  - **2パネル並列表示**: 左右独立にフォルダ/ファイル管理
  - **同期/独立モード**: 同期=両パネル同時ページング、独立=アクティブパネルのみ
  - **対応形式**: PSD/PSB/TIFF/JPG/PNG/BMP/PDF
  - **PDF全ページ自動展開**: PDF読み込み時に `kenban_get_pdf_page_count` で全ページを個別エントリ化（1ページずつページ送り可能）
  - **全画面（v3.7.2）**: ヘッダー非表示、画像エリアのみ表示。OSレベルフルスクリーン。Escapeで解除
  - **A/B必須（v3.7.2）**: 両パスが揃っている場合のみファイル読み込み実行
  - **背景色（v3.7.2）**: 画像エリアを `#1a1a1e`（黒）に統一
- **キーボード**: ↑↓ペア/ページ移動、Space表示モード切替、Ctrl+/-ズーム、S同期切替（分割）
- **TopNav A/B との双方向同期**: ビューアー内でフォルダ/ファイル選択 → `viewStore.kenbanPathA/B` に書き戻し、TopNavから変更 → ビューアー再読み込み（最新優先）
- **PDF ページ番号**: Rust側は0-indexed、フロント側は1-indexed → `pdfPage - 1` で変換
- **Rust連携**: `kenban_*` 21コマンドはそのまま流用（変更なし）

### 21. ProGen（React統合済み、v3.6.0で旧プロンプト完全互換移植）
- **3モード**: 抽出プロンプト / 整形プロンプト / 校正プロンプト — ドットメニューから直接モード選択可能
- **React完全移植済み**: iframe/バニラJS廃止、Zustand + Tailwind CSSで本体と統合
- **画面ルーター**: `progenStore.screen` で画面を切替（landing/extraction/formatting/admin/comicpot/resultViewer）
  - **注意**: v3.6.4で `proofreading` screen は廃止。校正モードも extraction screen（ProgenRuleView）を使用し、popup で正誤/提案ボタンを表示
- **ProgenView**: `viewStore.progenMode` → `progenStore.screen` 自動マッピング + ラベル自動読み込み
- **ツールメニュー連携（v3.6.4）**: TopNav ツール → ProGen の3モードから直接アクセス可能
  - `progenStore.toolMode` で現在のツールモード管理（"extraction" / "formatting" / "proofreading" / null）
  - TopNav click 時に toolMode + screen を同期的に設定（race condition 回避）
  - WFフラグ（`folderSetup_progenMode` / `progen_wfCheckMode`）を明示的にクリア
  - `extraction` screen に popup（下部固定）を表示:
    - `toolMode === "extraction"` → 🟠 抽出プロンプトボタン
    - `toolMode === "formatting"` → テキストなしならエラー、あれば 🔵 整形ボタン
    - `toolMode === "proofreading"` → テキストなしならエラー、あれば 🟢正誤 + 🟠提案 の2ボタン並列
- **新規作成のレーベル選択（v3.6.4）**: GENRE_LABELS（scanPsd.ts）による 2段階ドロップダウン（ジャンル → レーベル）。既存JSON読み込み時は従来の単一ドロップダウン
- **主要コンポーネント**:
  - `ProgenRuleView` — ルール編集（サイドバー7カテゴリ+Gemini連携4種+結果貼付2種）。**v3.7.1: listMode prop**でカード表示（ツール経由）/テーブル一覧表示（スキャナー経由）を切替。カードモード: 追加フォームはカード最後尾にインライン3項目入力。テーブルモード: コンパクト行表示+最下部に3項目インライン追加フォーム。**校正用テキスト複数選択**: 現在のテキスト（常時自動）+参照（エクスプローラー複数選択）+フォルダ（UIブラウザ、チェックボックス付き複数選択）。**結果貼付ボタン**: テキスト保存/JSON保存を追加。**parseCheckText改善**: 正誤/提案の自動判定（ヘッダー＋カテゴリ名ベース）
  - ~~`ProgenProofreadingView`~~ — **v3.6.4で厳重隔離**（ファイルは残すが、どこからもレンダリングされない）。校正は ProgenRuleView の popup で処理
  - `ProgenJsonBrowser` — GドライブJSONフォルダツリー（検索・読込・保存・新規作成）
  - `ProgenResultViewer` — 校正結果表示（3タブ+ピックアップ+CSV貼り付け）
  - `ProgenCalibrationSave` — 校正データ保存（TXTフォルダ選択→巻数入力）
  - `ResultSaveModal`（ProgenView内） — 校正結果保存モーダル。`parseCheckText()`でCSV・Markdownテーブル両対応→`{ checks: { simple, variation }, volume, savedAt }`形式で構造化保存。巻数入力付き、ファイル名`{N}巻.json`（v3.6.2でtimestamp廃止）。保存後にunifiedViewerStore.checkDataへ自動読み込み。**テキスト保存時のdesktopDir()末尾スラッシュ正規化済み（v3.6.4）**。**v3.6.6: テキスト保存後に COMIC-POT パース → unifiedViewerStore に textHeader/textPages も自動セット**（テキストタブで即座にページ別表示が可能）。**ファイル名フォーマット `{title}_YYYYMMDD_HHMMSS.txt`**（時刻まで含む）+ **同名ファイル存在時は `_2`, `_3`… の連番付与で重複回避**
  - `ComicPotEditor` — COMIC-POTテキスト編集（チャンク表示+D&D+ルビ+形式変換）
  - `ProgenAdminView` — パスワード付き管理画面（レーベルCRUD+ルール編集）
- **JSON 自動反映**: TopNav の作品情報JSON / `loadPresetJson` / `currentJsonFilePath` 変更時に proofRules を `progenStore.applyJsonRules` で自動適用 (basic/recommended/auxiliary/difficult/number/pronoun/character + symbol + options)
- **プロンプト生成 (`progenPrompts.ts`)**:
  - 旧 progen-xml-templates.js / progen-xml-gen.js / progen-check-simple.js / progen-check-variation.js を **TypeScript に完全移植** (生成XMLバイト単位で旧版と一致)
  - **抽出プロンプト** (`generateExtractionPrompt`): PDF only モード相当、3ステップ構成 (Text Extraction → Proofreading → Self-Check + final_output)
  - **整形プロンプト** (`generateFormattingPrompt`): TXT only モード相当
  - **正誤チェック** (`generateSimpleCheckPrompt`): フル版 7-8項目 (誤字/脱字/人名ルビ/単位/伏字/人物名/熟字訓 + 常用外漢字) + 統一表記ルール反映確認
  - **提案チェック** (`generateVariationCheckPrompt`): 10項目 (文字種/送り仮名/外来語/数字/略称/異体字/文体/固有名詞/専門用語/未成年表現)
  - **共通**: NGワードリスト (26語)、`escapeHtml` (旧版完全互換: `'`→`&#039;`、falsy判定)、`numberSubRules` / `categories` 定数も旧版互換
- **ScanPsdEditView統合**: 各機能をモーダルとして起動可能（ルール一覧/校正チェック/JSONブラウザ/結果ビューア/COMIC-POTエディタ）
- 全コマンドは `progen_` プレフィックス付き（Rust側変更なし）

### 22. 右クリックコンテキストメニュー
- **FileContextMenu.tsx**: SpecCheckViewの中央コンテンツエリアで右クリック → フローティングメニュー表示
- **PSDメニュー構成**:
  - Psで開く(P) / MojiQで開く(M)（PDF限定） / ファイルの場所を開く
  - txtファイル: セリフテキストとして読み込み / プレビュー中テキスト読み込み
  - カット / コピー / 複製（`duplicate_files` Rustコマンド） / 削除
  - PDF作成（Tachimi起動） / TIFF作成（ビュー遷移） / テキスト抽出
  - 編集 ▶ / リネーム ▶（このファイルをリネーム / バッチ / yyyymmdd形式） / A/B比較 ▶（A/Bにセット）
  - 読み込み ▶
- **フォルダ/非PSDメニュー**: フォルダを開く / Ps一括 / PDF作成 / A/B比較 / リネーム ▶（名前変更 / yyyymmdd形式） / カット / コピー / 複製（フォルダはcopy_folder） / 削除 / 読み込み
- **ファイル操作Undo（Ctrl+Z）**: 最大10操作。削除/カットはbackup_to_temp→restore_from_backup。複製は逆削除。リネームはbatch_rename_filesで逆変換（一括リネームも1操作）
- **サブメニュー位置補正**: onMouseEnter + requestAnimationFrameで上下左右clamp。state管理+300ms遅延クローズで安定したサブメニュー操作
- **グローバルPromptダイアログ**: `showPromptDialog()`（window.promptはTauri WebView2で動作しないため代替）。AppLayout内のGlobalPromptDialogで描画
- **リネーム処理**: Rust側`fs::rename`失敗時に`fs::copy`+`fs::remove_file`フォールバック（Windowsファイルロック対応）。invoke前にcache無効化
- **MojiQ自動検索**: `find_mojiq_path()` で7箇所+PATHから自動探索（全ユーザー対応）

### 23. ワークフローナビゲーション（v3.6.5 大幅刷新）
- **WorkflowBar.tsx**: TopNavのCBロゴ右横に「WF」ボタン。クリックで4ワークフローから選択
- **workflowStore.ts（v3.6.5新設）**: zustandストアで `activeWorkflow` / `currentStep` を一元管理
  - アクション: `startWorkflow` / `abortWorkflow` / `nextStep` / `prevStep` / `jumpToStep`
  - `WORKFLOWS` 定数もストア側に定義（複数コンポーネントから参照可能）
- **1ステップ=1工程（v3.6.5変更）**: 旧版の「開始/終了」2分割（`expandSteps`関数）を廃止。シンプルに1ステップ=1工程の構造に
- **4ワークフロー**:
  - **写植入稿**: 読み込み→仕様修正→ProGen整形→校正→テキスト修正→ZIP
  - **初校確認**: WF選択時にデータ読み込みオーバーレイ（PSD/画像PDF/テキスト/JSON/カラーモード選択、ZIP解凍対応）→読み込み（specCheck確認）→ビューアー確認（テキスト照合チェック→自動テキスト抽出→提案チェックまでスキップ）→提案チェックプロンプト→Tachimi見開きPDF→ZIP外部校正（ZIP作成後に自動WF完了確認）
  - **校正確認**: 校正確認→赤字修正→MojiQ→編集確認
  - **白消しTIFF**: 差し替え→差分検知→TIFF化→差分検知→TIFF格納
- **自動ナビゲーション**: 各ステップに`nav`（AppView）と`progenMode`を設定。ステップ進行時に自動画面遷移
- **ZIP リリースステップ**: `copyDestFolder`の親フォルダ（1_入稿レベル）を`requestPrep_autoFolder` localStorage経由でRequestPrepViewに自動セット
- **テキストチェックステップ**: copyDestFolder内のPDF/画像を自動検出してpsdStoreに読み込み。テキストタブを右端に自動配置、他タブ非表示
- **中断確認ダイアログ**: 中断ボタン押下時にstate管理のモーダルで「中止しますか？」を表示（window.confirm非使用）
- **進行確認ダイアログ（confirmOnNext, v3.7.3→v3.7.4）**: ステップ進行時にチェック確認。`specCheck`=NG/注意→警告/全合格→OK。`textSave`=未保存→保存ボタン/保存済→OK。`wfComplete`=WF終了確認（はい/いいえ）。`textDiffThenExtract`=テキスト照合不一致→警告/一致→自動テキスト抽出+提案チェックまでスキップ
- **初校確認WFオーバーレイ（v3.7.4）**: WF選択時にデータ読み込みオーバーレイ出現。PSD（フォルダ/ファイル/ZIP→2_写植に自動解凍+PSDフォルダ検出）→検A、画像PDF（フォルダ/ファイル）→検B、テキスト→読み取り、作品情報JSON/校正JSON→読み取りボタン、カラーモード必須。ZIP先選択→画像/PDF後選択で自動解凍対応
- **ZIP作成後WF自動完了（v3.7.4）**: RequestPrepViewでZIP作成成功後、WF進行中なら完了確認ポップアップ表示
- **extract_zip Rustコマンド（v3.7.4）**: ZIPファイルを指定ディレクトリに解凍
- **viewerTabSetup**: ステップ定義にタブ位置自動設定を追加（`{ text: "far-right", files: null, ... }`）
- **requestPrepMode**: ステップ定義にRequestPrepの初期モードを追加（"external"で外部校正タブに自動切替 + JSON workInfoからジャンル・レーベル自動セット）

### 23-b. WF表示（v3.6.5 全面リデザイン）
**WFアクティブ時は TopNav と アドレスバーを塗りつぶして全工程ナビゲーションUIに変更:**

**TopNav行（WorkflowBar フルバー）**:
- **ワークフロー名ピル**: グラデーション塗りつぶし（accent → accent-secondary）
- **戻るボタン**: 前のステップへ移動（最初のステップでdisabled）
- **進める/完了ボタン**: 次のステップへ移動。**最終ステップでは「完了」に変化し、緑色でWFを終了**
- **中断ボタン**: 赤色のX印、クリックでWF強制終了
- **全工程横並び（スクロール可）**: 各ステップを `flex items-center gap-1 overflow-x-auto` で横並び表示
  - アクティブステップ: アクセント色 + ring-2 リング強調
  - 完了済ステップ: success 色（緑）
  - 未着手ステップ: bg-tertiary + border
  - **全ステップクリックで自由にジャンプ可能**（`jumpToStep`）
- **非表示になる要素**: ツールメニュー / 設定 / リセット / NavBarButtons

**アドレスバー行（WorkflowDescriptionBar）**:
- WFアクティブ時は `GlobalAddressBar` を完全置換
- 構成: `[N/M] | ステップ名 | ステップ説明 | プログレスバー N%`
- **v3.6.6: 背景を `bg-bg-secondary`（純白の不透明）に変更**（旧: 半透明グラデーションだったため、AppLayout 全画面の `bg-tone` ドットパターンが透けて見えていた問題を解消）
- ディスパッチャパターン: `GlobalAddressBar` が wfActive で `WorkflowDescriptionBar` / `NormalAddressBar` を返す（hooks順序を保証）

**WF中も表示継続（v3.6.5）**:
- **TopNavDataButtons** (テキスト/作品情報JSON/校正JSON/A/B統合): WF中も読み込み操作を継続できるように表示維持
- ファイル数 / OK/NG / バージョン表示も継続

**WfDataPickerButton（v3.6.5）**: WF中のみ `テキスト・作品情報JSON・校正JSON` の3ボタンを **1つの「データ」ボタン + ホバードロップダウン** に統合
- A/Bピッカーと同じUXパターン（300ms遅延ホバー + 詳細パネル）
- メインボタン表示: `データ N/3`（N=読み込み済み件数、0件ならシンプル表示）
- ホバードロップダウン内の各項目:
  - タイトル（絵文字+カテゴリ名、色分け: 緑/紫/琥珀）
  - 状態表示（✓ 読み込み済み / 未読み込み）
  - クリアボタン
  - 読み込みボタン
- WF未起動時は従来の3つの個別 SmallBtn を表示

### 24. フォルダセットアップツール
- **FolderSetupView**: ツールメニューから起動。原稿フォルダを作業フォルダにコピー＋フォルダ構造を自動作成
- **3ステップUI**: コピー元（貼付/参照）→ 新作/続話選択 → コピー先選択 → 実行
- **ナンバリング自動検出**: フォルダ名から数字を抽出して番号フォルダを作成（手動修正可能）
- **テンプレート設定2種類**: アドレス指定（フォルダコピー）/ フォルダ構造（クリック取得、localStorage保存）
- **デフォルト構造**: 新作9フォルダ / 続話6フォルダ（アドレス未指定）。**DEFAULT_COPY_DEST = "1_入稿"**（v3.7.0で変更）
- **作品情報JSON**: 新規作成時はGENRE_LABELS（scanPsd.ts）による2段階ドロップダウン（ジャンル→レーベル）で選択。既存JSON選択は`JsonFileBrowser`モーダル（TopNavの作品情報ボタンと同じUI、scanPsdStore.jsonFolderPathをベースにしたツリー表示）
- **モード自動連動**: 新作選択時は`jsonMode="new"`、続話選択時は`jsonMode="select"`を自動セット（続話は前巻JSONの再利用が多いため）
- **create_directory / copy_folder Rustコマンド**: .keepファイル不使用
- **コピー完了後オーバーレイ（v3.7.3）**: 完了トースト（5秒自動消去）+ ファイル確認モーダル（PSD/PDF・画像/テキスト検出結果、追加コピーのステージング方式、カラーモード選択→specStore共有、作品情報JSON選択/新規、ProGenモード案内）

### 24b. 依頼準備ツール
- **RequestPrepView**: ツールメニューから起動。ファイル/フォルダをまとめてZIP圧縮
- **3モード**: 原稿入稿（テキスト/見本/原稿チェック）/ 外部校正（PDF/テキスト/統一表記表/NGワード）/ 白棒消し（PSD）
- **外部校正モード**: ジャンル→レーベル2段階ドロップダウン選択（GENRE_LABELS使用）、Gドライブから統一表記表を自動検索、NGワード表はデフォルト設定
- **内容自動検出**: サブフォルダ最奥まで再帰スキャン、TXT/PSD/画像/PDF種別を自動判定
- **ZIP名自動生成**: `yyyymmdd_ジャンル_タイトル_巻` — 作品情報JSON(`presetData.workInfo.genre/title`)参照、巻数はフォルダ名から検出（JSONのvolumeは無視）
- **JSON workInfo自動読み込み**: プリセットJSON読み込み時に`presetData.workInfo`からgenre/label/title/authorをscanPsdStoreにセット（volumeはセットしない）
- **WF自動読み込み**: `requestPrep_autoFolder` localStorage flag経由でFolderSetupのコピー先親フォルダを自動セット
- **Ingest/Whiteoutモード保存先**: Desktop内にzipName名サブフォルダを作成してZIP保存。`desktopDir()`の末尾スラッシュ正規化で正しいパス結合
- **ZIP内テキスト差し替え**: 元データは触らず一時フォルダにコピー → `findTxtRecursive`（`kenban_list_files_in_folder`+`list_folder_contents`再帰）でTXT検出 → unifiedViewerStoreの現在テキストで置換 → ZIP化 → 一時フォルダ削除
- **テキスト読み込み時のCOMIC-POTパース**: TopNav/FileContextMenu/SpecCheckViewの全テキスト読み込み箇所で`parseComicPotText()`を呼び、`textPages`/`textHeader`をstoreにセット。UnifiedViewer内のuseEffectで`textContent`変更時に`parseChunks`を自動実行
- **ProGen React移植（Phase 0-6完了、iframe廃止）**:
  - `src/features/progen/progen.ts` — 全型定義+定数（旧 `src/types/progen.ts`）
  - `src/features/progen/progenStore.ts` — Zustandストア（40+プロパティ）
  - `src/features/progen/useProgenTauri.ts` — 26個のprogen_*コマンドのinvokeラッパー
  - `src/features/progen/useProgenJson.ts` — JSON読み書き+CSV解析+カテゴリグループ化
  - `src/features/progen/useComicPotState.ts` — COMIC-POTエディタ専用useReducerステート
  - `src/features/progen/components/ProgenRuleView.tsx` — ルール編集（6カテゴリ+Gemini+保存ボタン+Ctrl+S対応）
  - `src/features/progen/components/ProgenProofreadingView.tsx` — 校正チェック（v3.6.4 で隔離済み、どこからもレンダリングされない）
  - `src/features/progen/components/ProgenJsonBrowser.tsx` — GドライブJSONブラウザ
  - `src/features/progen/components/ProgenResultViewer.tsx` — 校正結果ビューア（3タブ）
  - `src/features/progen/components/ProgenCalibrationSave.tsx` — 校正データ保存
  - `src/features/progen/components/ProgenAdminView.tsx` — パスワード付き管理画面
  - `src/features/progen/components/comicpot/ComicPotEditor.tsx` — COMIC-POTテキストエディタ
  - `src/features/progen/components/comicpot/ComicPotChunkList.tsx` — チャンク表示+D&D
  - `src/features/progen/ProgenView.tsx` — React画面ルーター（6画面切替）
  - ScanPsdEditViewで各機能をモーダルとして起動可能
- **スキャナーJSON編集のTopNav連携**: ScanPsdModeSelectorで「JSON編集」選択時、TopNavで読み込み済みの作品情報JSON（`unifiedViewerStore.presetJsonPath`）があれば`loadPresetJson`で自動読み込み
- **create_zip Rustコマンド**: zip crate使用、フォルダ再帰対応、デスクトップに保存

### 25. 設定画面
- **SettingsPanel**: TopNavのツールメニュー横に歯車アイコン
- **一般タブ**: 文字サイズ(小/中/大) / アクセントカラー(8色、今後対応予定) / ダークモード / フォルダ階層デフォルト位置
- **ナビ/ツール配置タブ**: ナビバーとツールメニューに表示するボタンをチェックボックスで選択。チェック済みアイテムはドラッグで並べ替え可能（グリップハンドル＋番号表示）。未チェックは下部にグレー表示。「決定」ボタンで反映
- **永続化**: localStorageに保存

### 26. ファイルプロパティパネル
- **FilePropertiesPanel**: 右プレビューパネル下部に折りたたみ可能なプロパティ表示
- **表示項目**: ファイル名 / ドキュメント種類 / 作成日 / 修正日 / ファイルサイズ / 寸法(px/inch/cm) / 用紙サイズ / 解像度 / ビット数 / カラーモード / αチャンネル / ガイド / トンボ / レイヤー数 / チェック結果

### 30. 差分/分割ビューアー A/B 共有・ペア読み込みガード（v3.8.1 以降）

**要件**:
- TopNav・差分ビューアー・分割ビューアー 全てで **A/B のフォルダ/ファイル選択を共有**
- **A/B 両方が揃った時のみ** 実ファイル読み込みを実行（片方だけの状態では読み込まない）
- A/B 登録時の**ビューアー自動遷移は行わない**（ユーザーの明示操作で切り替え）

**実装**:

1. **TopNav の自動遷移を削除** ([TopNav.tsx](src/components/layout/TopNav.tsx))
   - WF中データピッカー、通常時A/Bピッカーのフォルダ/ファイル選択ボタン 5箇所から `setActiveView("unifiedViewer")` を全削除

2. **外部パス同期 = 登録と読み込みを分離** ([DiffViewerView.tsx:46-62](src/features/diff-viewer/DiffViewerView.tsx#L46), [ParallelViewerView.tsx:30-46](src/features/parallel-viewer/ParallelViewerView.tsx#L30))
   ```tsx
   useEffect(() => {
     // パス登録は常時（片方だけでも即反映）
     if (externalPathA !== undefined) store.setFolder("A", externalPathA ?? null);
     if (externalPathB !== undefined) store.setFolder("B", externalPathB ?? null);
     // 実ファイル読み込みは両方揃った時のみ
     if (externalPathA && externalPathB) {
       store.loadFolderSide("A", externalPathA);
       store.loadFolderSide("B", externalPathB);
     }
   }, [externalPathA, externalPathB]);
   ```

3. **ビューアー内選択も同パターン**: `handleSelectFolder` / `handleSelectFile` で
   - `viewStore.setKenbanPathA/B`（共有維持）
   - ローカル store の `setFolder`/`setFolderA/B`（登録事実を即反映）
   - `loadFolderSide` は `nextA && nextB` の時のみ

4. **待機状態の視覚表示** ([ParallelViewerView.tsx:244-254](src/features/parallel-viewer/ParallelViewerView.tsx#L244))
   パネル上部ツールバーに、`panel.folder` が登録済みだが `files` 未ロードの場合:
   ```
   📂 フォルダ名  待機中
   ```
   を黄色バッジで表示。hover tooltip「もう片方のフォルダ登録待ち」。

**動作**:
| TopNav A | TopNav B | ビューアー表示 | 読み込み |
|----|----|----|----|
| `/foo` | 未設定 | A: `📂foo 待機中` / B: `未選択` | なし |
| 未設定 | `/bar` | A: `未選択` / B: `📂bar 待機中` | なし |
| `/foo` | `/bar` | 両方に画像表示 | **両方一括実行** |

### 29. v3.8.1 改修 — ダークモード画像反転問題の修正

**問題**: ダークモード有効時、UIだけでなく**ビューアー表示画像も色反転**していた。

**原因**:
- 従来実装 ([AppLayout.tsx](src/components/layout/AppLayout.tsx)) で `<html>` に `filter: invert(0.92) hue-rotate(180deg)` を適用
- 打ち消し用に `querySelectorAll("img, video, canvas, iframe")` でその時点の要素に `filter: invert(1) hue-rotate(180deg)` を設定
- **問題2つ**:
  1. `invert(0.92)` と `invert(1)` の数値不一致 → 完全相殺されず色がわずかにズレる
  2. `querySelectorAll` はワンショット → 後から動的ロードされた画像（ビューアー画像等）は対象外

**修正** ([globals.css:542-593](src/styles/globals.css#L542), [AppLayout.tsx:34-54](src/components/layout/AppLayout.tsx#L34)):
- JS側: インライン `filter` 設定を廃止。`<html>` に `dark-mode-invert` クラスを付けるだけに変更
- CSS側: 数学的に完全一致する `invert(1) hue-rotate(180deg)` を2段階で適用
  ```css
  html.dark-mode-invert { filter: invert(1) hue-rotate(180deg); background: white; }
  html.dark-mode-invert img,
  html.dark-mode-invert video,
  html.dark-mode-invert canvas,
  html.dark-mode-invert iframe,
  html.dark-mode-invert [data-no-invert],
  html.dark-mode-invert picture,
  html.dark-mode-invert svg image {
    filter: invert(1) hue-rotate(180deg);
  }
  ```
- **ビューアー背景 (`#1a1a1e`) は暗転後も黒を維持**: pre-inverted 値 `#e5e5e1` を上書きして html レベルの invert で相殺
  ```css
  html.dark-mode-invert .bg-\[\#1a1a1e\] {
    background-color: #e5e5e1 !important;
  }
  ```

**効果**:
- `invert(1) × invert(1) = identity`、`hue-rotate(180°) × hue-rotate(180°) = 360° = 0°` で数学的に恒等変換
- CSS セレクタによる適用なので、動的追加された画像・PDF.js canvas・後から挿入される img にも**自動適用**
- `data-no-invert` 属性を付けた任意の要素は反転対象から除外可能（将来拡張用）
- 切替時のチラツキを抑える `transition: filter 0.15s`

### 28. ProGen 外部設定同期（⚠ **試運転中 — 未検証**）

> **⚠ 重要: この機能は試運転段階です。**
> 実運用での動作確認はまだ行われていません。共有ドライブへのアクセス挙動・同期タイミング・キャッシュ整合性などは後日の実地検証が必要です。
> 不具合が見つかった場合は フォールバック（埋め込み既定値）で動作は継続する設計ですが、**この機能に依存した運用変更は動作確認完了まで控えてください**。

**目的**: ProGen のプロンプト生成で使う一部データ（NGワード・数字ルール・カテゴリ名）をアプリ再ビルド無しで共有ドライブから更新できるようにする。

**配置先（共有ドライブ）**:
```
G:\共有ドライブ\CLLENN\編集部フォルダ\編集企画部\編集企画_C班(AT業務推進)\DTP制作部\Comic Bridge_統合版\Pro-Gen\
├── version.json       ← バージョン管理（SemVer）
└── config.json        ← NGワード / 数字ルール / カテゴリ
```

**フロー**:
1. アプリ起動時に [App.tsx](src/App.tsx) が `initProgenConfig()` を非同期呼出
2. まずローカルキャッシュ (`%APPDATA%\comic-bridge\progen-cache\`) を読込 → 即時反映
3. 続いて Rust コマンド `fetch_progen_config` で共有ドライブの `version.json` を確認
4. SemVer 比較で新しければ `config.json` をキャッシュに上書き → 再読込

**主要ファイル**:
- [src/features/progen/progenConfig.ts](src/features/progen/progenConfig.ts) — ローダー + 埋め込みフォールバック
- [src-tauri/src/commands.rs](src-tauri/src/commands.rs) — `fetch_progen_config` / `read_progen_cached_file` コマンド
- [src/features/progen/progenPrompts.ts](src/features/progen/progenPrompts.ts) — `Proxy` 経由で `ngWordList`/`numberSubRules`/`categories` を動的参照化（既存コード変更最小）
- [docs/progen-template/](docs/progen-template/) — 共有ドライブ配置用の初期テンプレート + 運用README

**フォールバック階層**（信頼性確保）:
1. リモート同期済みキャッシュ
2. 既存ローカルキャッシュ
3. 埋め込み既定値（ビルド時点のもの、[progenConfig.ts:DEFAULT_*](src/features/progen/progenConfig.ts)）

**共有ドライブ切断時・JSON破損時も本体動作は継続**。フィールド単位でフォールバック。

**更新手順（運用後）**:
1. 共有ドライブの `config.json` を編集（NGワード追加・カテゴリ表示名変更など）
2. `version.json` の `version` をインクリメント（例: `1.0.0` → `1.0.1`）
3. 保存するだけ — 次回アプリ起動時に全ユーザー環境へ自動反映

**変更してはいけない要素**:
- `categories` のキー名（`basic`/`recommended` 等、コードから参照されている）
- `numberSubRules` のオプション配列順序（既存の保存済みJSONデータとインデックスで紐づくため、並び替え・削除は既存データ破壊のリスクあり、**末尾追加のみ推奨**）

**動作確認待ちの項目**:
- [ ] 初回セットアップで G:\ にテンプレートを配置 → 起動 → キャッシュ作成確認
- [ ] `config.json` の内容変更 + `version.json` インクリメント → 再起動 → 新内容反映確認
- [ ] 共有ドライブ切断環境での起動 → キャッシュフォールバック動作確認
- [ ] JSON壊れ・部分欠損時のフィールド別フォールバック確認
- [ ] 実際のプロンプト生成結果に反映されるかの確認（ProGen 実行 → 生成XML内でNGワードが期待通りに扱われるか）

### 27. v3.8.0 新機能・改修

**モノクロ2階調（Bitmap）PSD対応** ([commands.rs:2154-2290](src-tauri/src/commands.rs#L2154))
- `load_psd_composite` に depth=1 / color_mode=0 (Bitmap) を追加
- `unpack_bitmap_to_grayscale()` / `decode_rle_bitmap()` を新設（PackBits展開+MSBアンパック）
- 従来 psd crate フォールバックで失敗していた2階調PSDが高速パスで処理される
- 画像エリアの拡大表示が2階調で破綻する問題を解消

**統合ビューアー リロードボタン強化** ([commands.rs:122-152](src-tauri/src/commands.rs#L122))
- `invalidate_file_cache` がメモリキャッシュだけでなく、ディスク上の JPEG キャッシュ (`manga_psd_preview_*.jpg` / `manga_pdf_preview_*.jpg`) も削除するように拡張
- これによりビューアー右上のリロードボタンで完全再生成されるようになった（古い画像が残る問題を解消）

**TIFF化 2大プリフライトチェック**（Photoshop ベース）
- **メトリクスカーニング検出**: `tiff_convert.jsx` の `detectMetricsKerningLayers()` / `hasMetricsKerning()`。ActionManager で `textKey > textStyleRange > textStyle > autoKern` を走査し `metricsKern` を検出 → `TiffResultDialog` に警告表示
- **リンクグループ フォントサイズ検証**: `detectLinkGroupFontSizeIssues()`。各テキストレイヤーの `linkedLayerIDs` を直接読み、Union-Find でグループ構築 → 「同一サイズ」または「きっかり1:2」以外を通知（誤差ゼロ 0.001pt のみ許容）
- 結果は `TiffConvertResult.metrics_kerning_layers` / `link_group_issues` として Rust → フロントに連携、`TiffResultDialog` で詳細展開可能

**レイヤー構造 診断バー（LayerDiagnosticsBar）**
- **設置場所**: SpecLayerGrid（仕様チェック：レイヤー構造タブ）と LayerPreviewPanel 両方
- **未インストールフォント**: あり/なし バッジ + クリックで展開（フォント名一覧） + 「🔍 共有フォルダから探す」ボタン
- **共有フォルダ検索**: `FontBrowserDialog`（写植関連から再利用）をモーダル表示。パンくずナビ + 検索 + チェックボックス複数選択 + 一括インストール + 自動フォント再解決
- **検索フォルダアドレスは UI 非表示**: `FONT_SEARCH_BASE_PATH` 定数で内部保持のみ
- **白フチサイズ数値バッジ**: `{size}px ×{count}` 形式（ag-psd の `layer.effects.stroke[]` から抽出）
- **カーニング値（トラッキング）バッジ**: `+25 ×N` / `-50 ×N` 形式（textInfo.tracking から、0以外のみ）。メトリクスは読み込み時点では判定不能のため除外

**parser.ts 白フチ・リンクグループ抽出強化** ([parser.ts:218-232, 323-341](src/lib/psd/parser.ts))
- LayerNode に `linkGroup?` / `linkGroupEnabled?` を追加（ag-psd の同名プロパティから抽出）
- TextInfo に `strokeSize?` を追加（`layer.effects.stroke[]` の最初の enabled エントリから `size` を取得、UnitsValue/number 両対応）

**統合ビューアー / SpecLayerGrid テキスト行バッジ**
- 各テキストレイヤー行に 白フチ / カーニング値 バッジを直接表示
- 統合ビューアー写植仕様タブ ([UnifiedViewer.tsx:1421-1441](src/features/unified-viewer/components/UnifiedViewer.tsx#L1421)) と SpecLayerGrid カード ([SpecLayerGrid.tsx:196-218](src/features/spec-check/components/SpecLayerGrid.tsx#L196)) の両方
- 既存の「非シャープ」「メトリクス」バッジと並列表示

**使用フォント一覧を 写植仕様タブに統合** ([UnifiedViewer.tsx:1323-1372](src/features/unified-viewer/components/UnifiedViewer.tsx#L1323))
- テキストタブの単一ファイル版フォント一覧を削除
- 写植仕様タブに 全ファイル版 `allFilesFontMap` ベースの一覧を配置（N種/全Nファイル、ファイル数バッジ、クリックで対象ページ巡回）

**ProGen 結果保存モーダル 刷新** ([ProgenView.tsx ResultSaveModal](src/features/progen/ProgenView.tsx#L89))
- JSONモードで 2カラム貼り付け（正誤 + 提案 同時入力、各欄緑/橙の色分け）
- 各欄個別パース → `checkKind` を「正誤=correctness」「提案=proposal」で強制設定
- **作品情報JSON未登録時のガード**: `currentJsonFilePath` が空 or `label/title` 未設定なら、モーダル内に ジャンル/レーベル/タイトル インラインフォームを表示
- 保存時は まず `performPresetJsonSave()` で作品情報JSON新規作成 → 次に校正JSON保存（順序厳守）
- 保存先プレビュー2行表示（作品情報JSON + 校正JSON）、完了メッセージも新規作成時は「作品情報JSONを新規作成し、校正JSONを保存しました」

**Scan PSD 作品情報 Notion ページ** ([scanPsd.ts:16, WorkInfoTab.tsx, WorkflowBar.tsx](src/types/scanPsd.ts#L16))
- `ScanWorkInfo.notionPage?` フィールド追加、WorkInfoTab にインライン入力＋「開く」ボタン
- **WF完了時**: WorkflowBar + RequestPrepView の「はい」ボタンで `open_url_in_browser` 経由で自動起動
- **URL オープン 3段フォールバック** ([commands.rs:open_url_in_browser](src-tauri/src/commands.rs)): ① open crate (ShellExecute) ② rundll32 url.dll,FileProtocolHandler ③ powershell Start-Process。URL 内 `&` による cmd escape 問題を回避

**差分/分割ビューアー Photoshop起動**
- 分割ビューアー各パネルに「Ps」ボタン + Pキーショートカット ([ParallelViewerView.tsx:226](src/features/parallel-viewer/ParallelViewerView.tsx#L226))
- 差分ビューアーも Pキーショートカット追加（既存Psボタンに加え）([DiffViewerView.tsx:145](src/features/diff-viewer/DiffViewerView.tsx#L145))

**レイヤー制御タブ 復元** ([settingsStore.ts:15](src/store/settingsStore.ts#L15))
- ALL_NAV_BUTTONS に `{ id: "layerControl", label: "レイヤー制御" }` 追加
- デフォルトツールメニューに追加、既存ユーザーへのマイグレーション関数 `migrateToolMenu` で自動追加
- TopNav 両ハンドラに `layerControl → setActiveView("layers")` 分岐

**初校確認WF 改修** ([workflowStore.ts:50](src/store/workflowStore.ts#L50))
- 「レイヤー構造確認」ステップを追加（初校データ読み込み → レイヤー構造確認 → ビューアーで確認・修正）
- WFステップ進行時に `resolve_font_names` で未インストールフォント検知 → 警告ダイアログ（ステップごとに1回のみ）
- ProofLoadOverlay: 「→検A」「→検B」表記削除、画像必須を解除（任意化）

**FolderSetup 画像/PDFブロック解除** ([FolderSetupView.tsx:1029](src/components/views/FolderSetupView.tsx#L1029))
- 画像/PDFがない場合も進行可能（警告バナーのみ表示）
- `canProceed = selectedSpecId && fileCheck.hasPsd` （PDF/画像要件を撤廃）

**ホーム フォルダ階層 傾き半減** ([SpecCheckView.tsx:1905,1924](src/features/spec-check/SpecCheckView.tsx#L1905))
- 親階層 & サブフォルダの `paddingLeft` を `i * 12px` → `i * 6px` に変更
- 深い階層での水平オフセットが半減、傾きが緩やかに

### 22. 統合ビューアータブ（UnifiedViewerView）
- **3サブタブ構成**: 統合ビューアー / 差分モード / 分割ビューアー
- **統合ビューアー（UnifiedViewer）**: 2カラムレイアウト（左パネル廃止）
  - **タブバー**: 右寄せで全タブボタンを表示 + ◀▶配置移動ボタン。クリックで表示/非表示トグル。◀▶で選択中タブの配置位置を移動（左端↔左サブ↔右サブ↔右端、中央ビューアーはスキップ）
  - **5スロットパネルシステム（v3.7.0）**: 左端 / 左サブ / [中央ビューアー+ページリスト] / 右サブ / 右端。各パネルはタブ固有の適切な幅（`TAB_WIDTHS`）で表示。WFステップで`viewerTabSetup`によりタブ配置を自動制御可能
  - **タブ入れ替え記憶（displacedTabs）**: タブ移動時に押し出されたタブを記憶。移動元が空いたら自動復帰（既に別位置に移動済みなら復帰しない）
  - **共通タブ**: ファイル / レイヤー / 写植仕様 / テキスト / 校正JSON / テキスト照合 — 任意のパネル位置に自由に割当可能（`renderTabContent`共通関数）
  - **レイヤータブ（v3.7.0）**: FullLayerTree（metadata/LayerTree.tsx）使用。レイヤークリックで画像ビューアー上にSVG矩形ハイライト（対象レイヤー位置表示）。ファイル切替時にハイライト自動リセット
  - **写植仕様タブ（v3.7.1）**: フォントプリセット表示を削除。**スクショキャプチャ機能追加**: フォント選択中に「スクショ」ボタン表示→キャプチャモードON→ビューアー上でドラッグ範囲選択→暗転マスク+破線枠表示→マウスアップでCrop→JPEG→フォント帳に自動保存（crossOrigin対応でtainted canvas回避）
  - **ページリスト**: 中央ビューアー左端に幅32pxの縦ページ番号リスト。クリックでページ移動。現在ページはアクセントカラーで強調
  - **中央**: 画像ビューアー（ズーム/パン対応、PDF.js描画、PSD/画像はRust `get_high_res_preview`）。**リロードボタン（v3.7.0）**: 画像エリア右上に常時表示、クリックでキャッシュクリア+再読み込み（画像表示失敗時の復旧用）
    - ナビバー: ◀▶ページ送り / ズーム / 単ページ化ボタン / メタデータ（DPI/カラーモード/用紙サイズ）
    - **単ページ化（見開き分割）**: [単ページ化]トグル + [1P単独/1Pも見開き/1P除外]選択 + [左→右/右→左]読み順切替
    - `logicalPage`カウンターで全ファイル×前後をフラットに管理。`resolveLogicalPage(lp)`で(fileIdx, side)を同期計算
    - 単ページ化時の画像半分表示: ラッパーdiv `overflow:hidden` + `width:50%` + img `width:200%` で縦横比維持
    - ◀▶で`logicalPage ± 1`するだけで前半分→後半分→次ファイル前半分と自動進行
    - PDFキャッシュキー: `f.pdfPage`を含める（`${path}#p${page}`）で同一PDF別ページを区別
  - **右パネル**: 同上の共通タブ
  - **テキストタブ（v3.7.3）**: 編集モード廃止、**ダブルクリックインライン編集に統一**（SortableBlockItemのテキスト部分をダブルクリック→textarea展開、Ctrl+Enter確定/Escキャンセル）。ツールバー: +追加ボタン（現在ページにブロック追加）+ +フォントボタン + 選択中は✕解除/削除//。DnDブロックリオーダー（ドラッグハンドル+位置番号右端表示）。フォント割当ドロップダウン。ページヘッダー「+」ブロック追加（各ページ末尾）。ページ番号クリックで常にビューアーが該当ページに移動（pageSync不問）。handleSave: serializeTextで再構築して保存。Ctrl+S対応
  - **テキスト照合タブ**: KENBAN版LCS文字レベルdiff移植。PSDレイヤー↔テキストブロックのリンクマッピング。差異ありのみ2カラム、一致はPSD/テキスト切替で1カラム。漫画読み順ソート。`normalizeTextForComparison` + `computeLineSetDiff` + `buildUnifiedDiff`。ファイル一覧に✓/⚠アイコン。`//`先頭ブロックは「テキスト削除確認」として黄色警告表示（照合対象から除外、差異としてカウントしない）。textPagesが空の場合はtextContent全体をフォールバック比較
  - **校正JSONタブ**: 正誤/提案/全て切替、カテゴリフィルタ、ページ連動
  - **キーボード**: ←→ページ送り、Ctrl±ズーム、Ctrl+0フィット、Ctrl+S保存、Pキーで現在のファイルをPhotoshop起動
  - **右クリック**: FileContextMenu（viewerMode: カット/コピー/複製/削除/読み込みを非表示）
  - **ページ連動**: `navigateToTextPage`関数で単ページ化モード対応。logicalPageを走査してテキストページ番号に対応するページを特定
  - **psdStore同期**: メイン画面のファイルを`doSync`でビューアーストアに自動反映。タブ切替時にキャッシュクリア+`loadImageRef`で画像再読み込み。PDF情報（`isPdf`/`pdfPath`/`pdfPage`）も正しくマッピング（0-indexed→1-indexed変換）
- **差分モード**: KenbanApp（defaultAppMode="diff-check", externalPathA/B props）
- **分割ビューアー**: KenbanApp（defaultAppMode="parallel-view", externalPathA/B props）
- **全画面表示**: PSD/画像はCSS object-containで自動リサイズ（再取得不要）。PDFはisFullscreen依存のuseEffectでcanvas再描画
- 条件レンダリング: タブ切替で毎回マウント/アンマウント（検A/B propsを確実に反映）
- **検A/検B連携**: TopNavの検A/Bで選択したフォルダパスをexternalPathA/B propsで渡し、KenbanApp内でuseEffectで自動読み込み（filesA/B + parallelFilesA/B 両方にセット）。PDF/PSD/TIFF自動判定
- **隔離中**: 検版（KenbanView）とレイヤー分離確認（LayerSeparationPanel）はドットメニュー/ビューモードから除外、コンポーネントのマウント無効化（統合完了後に削除予定）

## UI構成

### レイアウト
- **TopNav** (h-14): WF（左端）| ツールメニュー（ホバー表示、300ms遅延クローズ）+ 設定 | リセットボタン（確認ダイアログ付き、テキスト/JSON/検A・Bも全クリア）| ナビバー（左寄せ）| flex-1 | テキスト/作品情報/校正JSON/差分分割/A・B統合ボタン（右寄せ、300ms遅延クローズ、**v3.7.1: ホバーで読込中フォルダ名/ファイル名/タイトルをツールチップ表示**）| ファイル数+OK/NG | バージョン。全画面時は非表示
- **GlobalAddressBar**: 戻る/進む/上/フォルダ参照/再読み込み | アドレスバー/×クリア。全画面時は非表示
- **ツールメニュー**: ホバーで自動表示。全タブ + ProGen3モード
- **A/B統合ボタン**: ホバーでA（青）/B（橙）の選択ドロップダウン。フォルダ/ファイル選択、パス表示、クリア。`validateAndSetABPath`で検証（ファイルなし/テキストのみは静かにスキップ、複数拡張子混在はconfirm）。差替え/合成のDropZoneはマウント時にkenbanPathA/Bを自動参照
- **D&D時A自動セット**: Aが未セットの場合のみ検証付きで自動セット。巻数はJSONのvolumeを無視しフォルダ名から検出
- **ViewRouter + viewStore**: タブベースのビュー切替管理。AppView型:
  ```typescript
  export type AppView =
    | "specCheck" | "layers" | "split" | "replace" | "compose"
    | "rename" | "tiff" | "scanPsd" | "typesetting"
    | "progen" | "unifiedViewer";
  ```
  progen と unifiedViewer は状態保持型マウント（display切替）。typesettingは隔離中（マウント無効化）
- **AppLayout**: TopNav + GlobalAddressBar + ViewRouter構成。グローバルD&Dリスナー（useGlobalDragDrop）。全画面時はTopNav/GlobalAddressBar非表示
- **D&Dオーバーレイ**: ファイルをドラッグ中にホーム画面を暗くし「ドラッグして読み込み」を表示（Tauri `onDragDropEvent` enter/leave監視）
- **DropZone（空状態）**: ファイル未読み込み時、中央エリアをクリックするとフォルダ選択ダイアログを表示。D&Dも対応
- **右クリックコンテキストメニュー**: FileContextMenu — ファイル操作/編集/読み込みの階層メニュー

### ビュー
- **LayerControlView**: レイヤー制御パネル + LayerPreviewPanel（レイヤー構造タブ + ビューアータブ）。**サブタブ構成**: 「レイヤー制御」「リネーム」の2タブ。リネームタブはRenameViewをそのまま内蔵
- **SpecCheckView**: ホーム画面。エクスプローラー風ファイルブラウザ + 仕様チェック
  - アドレスバー（GlobalAddressBar）でフォルダ移動。D&Dも対応（フォルダ単品D&D→そのフォルダの中身を直接表示）
  - 中央エリア上部: ビューモード切替バー + 仕様バー（仕様選択/統計/サイズ/ソート/PSD/PDFフィルタ/ドットメニュー）
  - viewMode切替: サムネイル（PreviewGrid）、リスト（PsdFileListView）、レイヤー構造（SpecLayerGrid）
  - SpecLayerGrid: 写植仕様（テキストレイヤーフォント/サイズ情報）+ レイヤーツリーを統合表示。「写植仕様のみ」チェック。上部に全ファイル合計サマリー（使用フォント出現数/サイズ統計/AA判定）
  - LayerTree: ゼブラストライプ背景（白/#f0f8f0交互、useEffect+DOM操作でStrictMode対応）、階層区切り線。テキストレイヤーにフォント名/サイズ/シャープ以外エラー表示
  - フォントサイズ: ag-psdのfontSizeにtransform[3](Yスケール)×72/DPIを掛けてPhotoshop表示ポイント値に変換。Rust側も同様
  - シャープ判定: `includes("sharp")` or `"ansh"`で小文字マッチ（ag-psd/Rust両対応）。シャープは非表示、シャープ以外のみ赤エラー
  - メトリクスカーニング: PSDバイナリからの正確な検出は不可（/AutoKerning trueがメトリクス/0を区別できない）。Rust側は無効化済み
  - リスト表示: 列順＝結果/ファイル名(拡張子非表示)/種類バッジ/カラー(白黒表記)/サイズ/DPI/Bit/テキスト(あり/なし)/ガイド(あり/なし)。NG行は赤背景、Caution行は黄色背景
  - 仕様選択: 単一ボタンクリックで仕様を順に切り替え（ループ）
  - キーボード操作: 左右キーで前後ファイル移動、上下キーでグリッド行移動（列数自動計算）
  - 右プレビューパネル: プレビューのみ（アクションタブ廃止）。画像表示＋プロパティ＋テキスト情報
  - ファイルプロパティ: プレビュータブ時のみ表示。寸法(cm)+用紙サイズ併記、作成日/インチ表示なし
  - フォルダ階層ツリー: 常時表示（ファイル未選択時はデスクトップパスを表示）。クリックで上位フォルダに移動。サブフォルダも表示（list_subfolders）。ドライブレター修正対応。ファイル名ヘッダーはフォルダ階層の下に配置。ダブルクリックでリネーム可能
  - フォルダ/テキスト/JSONの選択: 左クリックで水色ハイライト選択。右クリックでコンテキストメニュー（A/B比較/リネーム/カット/コピー/複製/削除対応）。PSD選択時は非PSD選択をクリア、逆も同様
  - サムネイル選択: 水色の太枠（12px box-shadow）で表示。チェックマーク廃止。サムネイル間余白3倍化。リスト表示も水色（bg-sky-100）
  - 選択ファイル自動スクロール: サムネイル（PreviewGrid useEffect + scrollIntoView）/ リスト（PsdFileListView useEffect + data-file-id）
  - リスト表示複数選択: Shift+クリックで範囲選択（selectRange）、Ctrl+クリックで個別トグル
  - 折りたたみトグル: 全セクション（MetadataPanel/GuideSectionPanel/FolderBreadcrumbTree）のシェブロンアイコンを右側に配置
  - 左サイドバー構成: 原稿仕様（ガイド線+カラーモード/ビット深度/αチャンネル/キャンバスサイズ/トンボ）+ レイヤー（LayerSectionPanel、デフォルト閉じ）
  - リロード: psdStoreのrefreshCounter + triggerRefresh()でfolderContents強制更新。contentLockedに依存しない
  - PSDなしフォルダ: D&D読み込み時にPSDがなければcontentLockしない
  - ビューアー連動: 拡大表示中のファイル→ビューアー切替時に同じファイルを自動表示
  - 中央コンテンツロック: 仕様バーにロックボタン。ロック中はアドレス変更でファイルリスト更新しない。D&D時は自動ロック
  - メイン画面でtxt/jsonクリック: txtは右プレビューに表示、jsonは校正JSON/作品情報として自動判定して読み込み
  - MetadataPanel: 各セクション折りたたみ可能。テキストのみ表示チェック
  - PSDフィルタ / PDF表示切替（ページごと/ファイル単位）/ ソート（名前/サイズ/DPI/チェック結果）
  - **フローティングボタン（v3.7.0）**: PDF化（filteredFiles対応）/ 簡易スキャン（SpecScanJsonDialog、フィルタ対象のみ、JSON保存後にフォントプリセット自動読込）/ テキスト抽出（filteredFiles対応、抽出後textPages自動パース）
  - 対応ファイル表示: PSD/PSB/JPG/PNG/TIFF/BMP/GIF/PDF/EPS + TXT/JSON + フォルダのみ（それ以外は非表示）
  - PDF表示: `FilePreviewImage`でpdfPageIndex/pdfSourcePathを`useHighResPreview`に渡し、`get_pdf_preview`（PDFium）でレンダリング
- **TypsettingView**: 写植関連（隔離中 — ViewRouterでマウント無効化、ドットメニューから除外。削除予定）
- **ReplaceView**: レイヤー差替え
- **ComposeView**: 合成（2カラム: ComposePanel | ComposeDropZone）。Replace機能と類似のペアリングUI
- **SplitView**: 見開き分割
- **RenameView**: リネーム（レイヤーリネーム / ファイルリネーム）
- **TiffView**: TIFF化（3カラム: TiffSettingsPanel | TiffFileList | Center(プレビュー/一覧/ビューアータブ切替)）。TiffFileListヘッダーとTiffBatchQueueヘッダーにサブフォルダチェックを配置
- **ScanPsdView**: Scan PSD（2カラム: ScanPsdPanel(5タブ) | ScanPsdContent(モード選択/スキャン/サマリー)）。JSON編集時に未登録フォントアラート表示。フォント帳を独立セクションとして追加（モーダル表示）
- **(KenbanView 削除済み)** — v3.5.0で差分・分割ビューアーをReactネイティブ移植完了
- **ProgenView**: React画面ルーター。progenStore.screenで6画面切替。viewStore.progenModeから自動初期化。状態保持型マウント（display切替）
- **UnifiedViewerView**: 統合ビューアー + 差分モード + 分割ビューアーの3タブ。統合ビューアーは3カラム（全タブ共通パネル）。unifiedViewerStore独立管理。psdStoreとdoSync+loadImageRefで自動同期。PDF表示はpdf.jsで描画（isPdf/pdfPath/pdfPageを正しくマッピング）

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

**Phase 0-4 リファクタリング (2026-04 完了) 以降、機能ごとの垂直スライスに再編成済み。** feature 間の直接参照は禁止、共有コードは `@shared/*` に集約する方針（Phase 5 で実施予定、現状は `src/components/` `src/hooks/` `src/lib/` `src/store/` `src/types/` に残置）。

```
src/
├── main.tsx                # Reactエントリポイント（StrictMode + AppLayout）
├── App.tsx                 # ルートコンポーネント（initProgenConfig 起動）
│
├── features/               # 機能ごとの垂直スライス（各feature内に View / Store / Hook / Components を同梱）
│   ├── spec-check/         # ホーム画面・仕様チェック・Photoshop変換
│   │   ├── SpecCheckView.tsx           # AppView="specCheck" のルート
│   │   ├── useSpecChecker.ts           # 仕様チェック（自動実行・結果キャッシュ）
│   │   ├── components/                 # SpecCheckerPanel, SpecCardList, SpecLayerGrid, SpecTextGrid, SpecCheckTable, FixGuidePanel, SpecSelectionModal, ConversionToast, CaptureOverlay, FontBrowserDialog, SpecScanJsonDialog, SpecViewerPanel, GuideSectionPanel
│   │   └── README.md
│   ├── layer-control/      # レイヤー制御（5モード: hide/show/custom/organize/layerMove）
│   │   ├── LayerControlView.tsx
│   │   ├── layerStore.ts
│   │   ├── useLayerControl.ts
│   │   ├── components/                 # LayerControlPanel, LayerPreviewPanel, LayerControlResultDialog
│   │   └── README.md
│   ├── replace/            # レイヤー差替え（Photoshop JSX）
│   │   ├── ReplaceView.tsx
│   │   ├── replaceStore.ts
│   │   ├── useReplaceProcessor.ts
│   │   ├── components/                 # ReplacePanel, ReplaceDropZone, ReplacePairingModal, PairingAutoTab, PairingManualTab, PairingOutputSettings, ReplaceToast
│   │   └── README.md
│   ├── compose/            # 合成（原稿A/Bを5要素ルーティングで統合）
│   │   ├── ComposeView.tsx
│   │   ├── composeStore.ts
│   │   ├── useComposeProcessor.ts
│   │   ├── components/                 # ComposePanel, ComposeDropZone, ComposePairingModal, ComposePairingAutoTab, ComposePairingManualTab, ComposePairingOutputSettings, ComposeToast
│   │   └── README.md
│   ├── split/              # 見開き分割
│   │   ├── SplitView.tsx
│   │   ├── splitStore.ts
│   │   ├── useSplitProcessor.ts
│   │   ├── components/                 # SplitPanel, SplitPreview, SplitResultDialog
│   │   └── README.md
│   ├── rename/             # リネーム（レイヤー / ファイル 2モード）
│   │   ├── RenameView.tsx
│   │   ├── renameStore.ts
│   │   ├── useRenameProcessor.ts
│   │   ├── rename.ts                   # 型定義（旧 types/rename.ts から移動）
│   │   ├── components/                 # LayerRenamePanel, FileRenamePanel, RenamePreview, RenameResultDialog
│   │   └── README.md
│   ├── tiff/               # TIFF化（TIPPY v2.92準拠パイプライン）
│   │   ├── TiffView.tsx
│   │   ├── tiffStore.ts
│   │   ├── useTiffProcessor.ts
│   │   ├── useCropEditorKeyboard.ts    # Tachimi互換キー操作
│   │   ├── components/                 # TiffSettingsPanel, TiffFileList, TiffBatchQueue, TiffCropEditor, TiffCropSidePanel, TiffViewerPanel, TiffPageRulesEditor, TiffPartialBlurModal, TiffResultDialog, TiffCanvasMismatchDialog, TiffAutoScanDialog
│   │   └── README.md
│   ├── scan-psd/           # Scan PSD（フォントプリセット管理、je-nsonman移植）
│   │   ├── ScanPsdView.tsx
│   │   ├── FontBookView.tsx            # フォント帳ビュー
│   │   ├── scanPsdStore.ts
│   │   ├── fontBookStore.ts
│   │   ├── useScanPsdProcessor.ts
│   │   ├── components/                 # ScanPsdPanel, ScanPsdContent, ScanPsdEditView, ScanPsdModeSelector, JsonFileBrowser, ProgenJsonBrowser, tabs/*
│   │   └── README.md
│   ├── progen/             # ProGen（プロンプト生成ツール、React完全移植）
│   │   ├── ProgenView.tsx              # 画面ルーター（landing/extraction/formatting/admin/comicpot/resultViewer）
│   │   ├── progenStore.ts              # 40+プロパティ、ルール管理、JSONルール適用
│   │   ├── progen.ts                   # 型定義（旧 types/progen.ts から移動）
│   │   ├── progenConfig.ts             # 共有ドライブ同期ローダー + 埋め込みフォールバック
│   │   ├── progenPrompts.ts            # XMLプロンプト生成（旧版バイト単位互換）
│   │   ├── useProgenTauri.ts           # 26コマンドinvokeラッパー
│   │   ├── useProgenJson.ts            # JSON読書/CSV解析/カテゴリグループ化
│   │   ├── useComicPotState.ts         # COMIC-POT専用useReducer
│   │   ├── components/                 # ProgenRuleView, ProgenProofreadingView (隔離), ProgenJsonBrowser, ProgenResultViewer, ProgenCalibrationSave, ProgenAdminView, comicpot/(ComicPotEditor, ComicPotChunkList)
│   │   └── README.md
│   ├── unified-viewer/     # 統合ビューアー（5スロットパネル）
│   │   ├── UnifiedViewerView.tsx       # AppView="unifiedViewer" のルート、3サブタブ
│   │   ├── unifiedViewerStore.ts
│   │   ├── components/                 # UnifiedViewer, UnifiedSubComponents, utils.ts, useViewerFileOps.ts, ProgenImageViewer
│   │   └── README.md
│   ├── diff-viewer/        # 差分ビューアー（KENBAN移植、unified-viewer のサブタブ）
│   │   ├── DiffViewerView.tsx
│   │   ├── diffStore.ts
│   │   └── README.md
│   ├── parallel-viewer/    # 分割ビューアー（KENBAN移植、unified-viewer のサブタブ）
│   │   ├── ParallelViewerView.tsx
│   │   ├── parallelStore.ts
│   │   └── README.md
│   └── _deprecated/        # 隔離中（マウント無効化、削除予定）
│       ├── typesetting/    # typesetting-check, typesetting-confirm
│       ├── layer-separation/
│       └── README.md
│
├── shared/                 # ⚠ Phase 5 移動予定のスキャフォールド（現状は空ディレクトリのみ）
│   ├── components/         # (予定) ui/ layout/ file-browser/ common/
│   ├── hooks/              # (予定)
│   ├── stores/             # (予定)
│   ├── lib/                # (予定)
│   ├── types/              # (予定)
│   └── README.md           # 現状と移動計画
│
├── components/             # ⚠ Phase 5 で shared/ へ移動予定（現役の共通コンポーネント）
│   ├── ErrorBoundary.tsx
│   ├── common/             # FileContextMenu, DetailSlidePanel, CompactFileList, TextExtractButton
│   ├── file-browser/       # FileBrowser, FileList, DropZone
│   ├── layout/             # AppLayout, TopNav, GlobalAddressBar, ViewRouter, WorkflowBar, SettingsPanel
│   ├── metadata/           # MetadataPanel, LayerTree
│   ├── preview/            # PreviewGrid, PreviewList, ThumbnailCard
│   ├── guide-editor/       # GuideEditorModal, GuideCanvas, CanvasRuler, GuideList
│   ├── views/              # FolderSetupView, RequestPrepView, ViewerView（ツール系・ワークフロー系）
│   └── ui/                 # Badge, GlowCard, Modal, PopButton, ProgressBar, SpeechBubble, Tooltip（+ index.ts）
│
├── hooks/                  # ⚠ Phase 5 で shared/hooks/ へ移動予定（機能横断フック）
│   ├── useAppUpdater.ts          # アプリ更新管理（Tauri Updater）
│   ├── useCanvasSizeCheck.ts     # キャンバスサイズ検証（多数派/外れ値）
│   ├── useFileWatcher.ts         # ファイル変更監視
│   ├── useFontResolver.ts        # フォント名解決・未インストール検出
│   ├── useGlobalDragDrop.ts      # グローバルD&Dリスナー
│   ├── useHandoff.ts             # 外部ツール連携
│   ├── useHighResPreview.ts      # 高解像度プレビュー（3層キャッシュ）
│   ├── useOpenFolder.ts          # エクスプローラー表示 + Fキー
│   ├── useOpenInPhotoshop.ts     # Photoshop起動 + Pキー
│   ├── usePageNumberCheck.ts     # ページ番号欠番検出
│   ├── usePhotoshopConverter.ts  # Photoshop経由仕様変換
│   ├── usePreparePsd.ts          # PSD準備（仕様修正+ガイド統合）
│   ├── usePsdLoader.ts           # PSD読込・自然順ソート・PDF展開
│   ├── useSpecConverter.ts       # 直接仕様変換（ag-psd+Rust、PS不要）
│   └── useTextExtract.ts         # テキスト抽出（COMIC-POT互換）
│
├── lib/                    # ⚠ Phase 5 で shared/lib/ へ移動予定（共有ユーティリティ）
│   ├── psd/parser.ts            # ag-psdラッパー・メタデータ抽出
│   ├── agPsdScanner.ts          # ag-psdスキャナー
│   ├── layerMatcher.ts          # レイヤーマッチング・リスク分類
│   ├── layerTreeOps.ts          # レイヤーツリー操作
│   ├── linkGroupCheck.ts        # リンクグループ検証（TIFFプリフライト用）
│   ├── psdLoaderRegistry.ts     # グローバルloaderレジストリ（React外から呼ぶ用）
│   ├── naturalSort.ts           # 自然順ソート
│   ├── paperSize.ts             # 用紙サイズ判定
│   └── textUtils.ts             # テキスト処理
│
├── store/                  # ⚠ Phase 5 で shared/stores/ へ移動予定（グローバルストア6個）
│   ├── index.ts                 # バレルエクスポート
│   ├── psdStore.ts              # ファイル一覧・選択状態（source of truth）
│   ├── specStore.ts             # 仕様・チェック結果・conversionSettings（localStorage永続化）
│   ├── guideStore.ts            # ガイド線 + Undo/Redo履歴
│   ├── viewStore.ts             # activeView (AppView) / progenMode / kenbanPathA/B
│   ├── settingsStore.ts         # 文字サイズ/ダークモード/ナビ配置（localStorage永続化）
│   └── workflowStore.ts         # WF状態 + WORKFLOWS定数（4ワークフロー）
│
├── types/                  # ⚠ Phase 5 で shared/types/ へ移動予定
│   ├── index.ts                 # PsdFile, PsdMetadata, LayerNode, TextInfo, Specification, SpecRule, SpecCheckResult, IMAGE_EXTENSIONS等
│   ├── fontBook.ts              # FontBookEntry, FontBookData, FontBookParams
│   ├── replace.ts               # ReplaceSettings, PairingJob, FolderSelection, BatchFolder等
│   ├── tiff.ts                  # TiffSettings, TiffCropBounds, TiffCropPreset, TiffScandataFile等
│   ├── scanPsd.ts               # ScanData, PresetJsonData, GENRE_LABELS, FONT_SUB_NAME_MAP等
│   └── typesettingCheck.ts      # ProofreadingCheckData, CheckItem, CheckKind（_deprecated + unified-viewer 参照）
│
├── kenban-utils/           # ⚠ 将来 shared/lib/text-diff/ へ統合予定（unified-viewer のテキスト照合で使用中）
│   ├── textExtract.ts           # LCS文字レベル diff・テキスト抽出
│   ├── memoParser.ts            # COMIC-POT等のメモ解析
│   └── kenbanTypes.ts           # ExtractedTextLayer, DiffPart等
│
└── styles/
    └── globals.css              # Tailwindベース + ダークモード反転CSS（v3.8.1）

public/
├── pdfjs-wasm/             # PDF.js WASM
└── (progen/ 削除済み — React統合完了)

docs/
├── architecture.md         # レイヤー構成全体図（React/Tauri/Rust/PS JSX、Mermaid）
├── feature-map.md          # 21機能 × 画面 × ストア対応表
├── data-flow.md            # 代表シナリオのシーケンス図
└── progen-template/        # 共有ドライブ配置用の初期テンプレート + 運用README

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
    ├── watcher.rs         # ファイル変更監視（外部ファイル変更検出）
    ├── kenban.rs          # KENBANバックエンド（21コマンド）
    └── progen.rs          # ProGenバックエンド（26コマンド）
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

## Rustコマンド一覧（commands.rs — 55コマンド、kenban.rs — 21コマンド、progen.rs — 26コマンド、合計102コマンド）

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
| `batch_rename_files` | `entries, output_directory?, mode` | `Vec<BatchRenameResult>` | 一括ファイルリネーム（rename失敗時copy+deleteフォールバック） |
| `backup_to_temp` | `source_path` | `String` | ファイル/フォルダを一時バックアップ（Undo用） |
| `restore_from_backup` | `backup_path, original_path` | `()` | バックアップから復元（Undo用） |
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

## KENBAN統合 (kenban.rs — 21コマンド)

| コマンド | 用途 |
|---------|------|
| `kenban_parse_psd` | PSD解析→JPEG変換 |
| `kenban_list_files_in_folder` | フォルダ内ファイル一覧（自然順） |
| `kenban_render_pdf_page` | PDFページレンダリング |
| `kenban_get_pdf_page_count` | PDFページ数取得 |
| `kenban_open_file_in_photoshop` | Photoshopで開く |
| `kenban_save_screenshot` | スクリーンショット保存 |
| `kenban_read_text_file` | テキストファイル読込 |
| `kenban_write_text_file` | テキストファイル書込 |
| `kenban_cleanup_preview_cache` | プレビューキャッシュ削除 |
| `kenban_open_file_with_default_app` | デフォルトアプリで開く |
| `kenban_get_cli_args` | CLI引数取得 |
| `compute_diff_simple` | シンプル差分計算 |
| `check_diff_simple` | 差分有無チェック |
| `compute_diff_heatmap` | ヒートマップ差分計算 |
| `check_diff_heatmap` | ヒートマップ差分チェック |
| `decode_and_resize_image` | 画像デコード＆リサイズ |
| `preload_images` | 画像プリロード |
| `clear_image_cache` | 画像キャッシュクリア |
| `compute_pdf_diff` | PDF差分計算 |
| `open_folder` | フォルダを開く |
| `open_pdf_in_mojiq` | MojiQでPDF開く |

## ProGen統合 (progen.rs — 26コマンド)

全コマンドに `progen_` プレフィックス付き:

| コマンド | 用途 |
|---------|------|
| `progen_get_json_folder_path` | JSONフォルダパス取得 |
| `progen_list_directory` | フォルダ一覧 |
| `progen_read_json_file` | JSON読込 |
| `progen_write_json_file` | JSON書込 |
| `progen_read_master_rule` | マスタールール読込 |
| `progen_write_master_rule` | マスタールール書込 |
| `progen_create_master_label` | レーベル作成 |
| `progen_get_master_label_list` | レーベル一覧 |
| `progen_create_txt_work_folder` | テキストフォルダ作成 |
| `progen_get_txt_folder_path` | TXTフォルダパス |
| `progen_list_txt_directory` | TXTフォルダ一覧 |
| `progen_read_txt_file` | TXT読込 |
| `progen_write_text_file` | TXT書込 |
| `progen_read_dropped_txt_files` | D&D TXT読込 |
| `progen_show_save_text_dialog` | TXT保存ダイアログ |
| `progen_save_calibration_data` | 校正データ保存 |
| `progen_print_to_pdf` | PDF出力（Edge経由） |
| `progen_list_image_files` | 画像ファイル一覧 |
| `progen_list_image_files_from_paths` | パスから画像一覧 |
| `progen_load_image_preview` | 画像プレビュー生成 |
| `progen_show_open_image_folder_dialog` | フォルダ選択ダイアログ |
| `progen_show_save_json_dialog` | JSON保存ダイアログ |
| `progen_open_and_read_json_dialog` | JSON読込ダイアログ |
| `progen_launch_comic_bridge` | COMIC-Bridge起動 |
| `progen_get_comicpot_handoff` | COMIC-POTハンドオフ |

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

## UIテーマ: Editorial Precision (v3.6.3〜)

**コンセプト**: 編集部の静謐さ（Notion的な温中性グレー）× Figma的な骨格（直線的な精密ツール感）のハイブリッド。プロ編集者が1日8時間作業しても疲れない「引き算のデザイン」。

### 設計原則
1. **Subtract, don't add** — 色・装飾を極力削る
2. **Color = Meaning, not decoration** — 色は意味（成功/警告/エラー）にのみ使う
3. **Single Accent Discipline** — メインアクセントは Indigo 1色に集約

### カラーパレット
```javascript
// 背景（クリームホワイト維持 + 温中性tertiary）
bg-primary:   "#fbfaf7"  // クリームホワイト（メイン背景）
bg-secondary: "#ffffff"  // 純白（パネル・モーダル）
bg-tertiary:  "#ebeae5"  // 温中性薄グレー（カード・非アクティブ）
bg-elevated:  "#ffffff"  // 浮き上がり要素

// テキスト（AAA/AAA/AA 準拠）
text-primary:   "#1a1a24"  // 主要 (17.8:1 AAA)
text-secondary: "#4a4a5a"  // 副次 (9.6:1 AAA)
text-muted:     "#6b6b7a"  // 控えめ (5.5:1 AA)

// アクセント（単一Indigo原則、徹底引き算）
accent:           "#4f46e5"  // Indigo (6.3:1) 主要操作
accent-hover:     "#4338ca"  // Deep Indigo (8.2:1)
accent-secondary: "#a16207"  // Amber (5.9:1) 編集朱入れ（使用最小限）
accent-tertiary:  "#0e7490"  // Teal (6.1:1) 情報リンク
accent-warm:      "#b45309"  // Burnt Orange (5.4:1) 注意喚起

// ステータス（印刷インク調、全AA）
success: "#15803d"  // 緑 (5.5:1)
warning: "#a16207"  // オレンジブラウン (5.9:1)
error:   "#b91c1c"  // 赤 (6.4:1)

// 漫画装飾カラー: 事実上廃止（ほぼ無彩色、globals.cssで強制上書き）
manga-pink: "#f5ecec", manga-mint: "#eaf0eb",
manga-lavender: "#ecebf0", manga-peach: "#f2ede4",
manga-sky: "#e8ecf0", manga-yellow: "#f3f0e4"

// ボーダー（温中性）
border:       "#d9d7d0"  // 明確な区切り
border-light: "#e9e7e0"  // 薄い区切り
```

### フォント（v3.6.3〜 刷新）
- **UI本文**: Inter + Noto Sans JP + Yu Gothic UI fallback
- **見出し**: IBM Plex Sans JP + Noto Sans JP fallback（Zen Maru Gothic廃止）
- **コード**: JetBrains Mono + IBM Plex Mono + Consolas fallback
- **index.html**: Google Fonts経由ロード（Inter/IBM Plex Sans JP/JetBrains Mono）
- **ベース**: 15px / line-height 1.65 / font-weight 450 / letter-spacing 0.003em
- **feature-settings**: "palt", "calt"（日本語プロポーショナル + 合字）

### Type Scale（Tailwind fontSize、最小12px保証）
```javascript
'xs':   ['12px', { lineHeight: '1.55', letterSpacing: '0.005em'  }]
'sm':   ['13px', { lineHeight: '1.6',  letterSpacing: '0.003em'  }]
'base': ['14px', { lineHeight: '1.65'                            }]
'md':   ['15px', { lineHeight: '1.6'                             }]
'lg':   ['17px', { lineHeight: '1.55', letterSpacing: '-0.005em' }]
'xl':   ['19px', { lineHeight: '1.5',  letterSpacing: '-0.01em'  }]
'2xl':  ['22px', { lineHeight: '1.45', letterSpacing: '-0.015em' }]
'3xl':  ['28px', { lineHeight: '1.35', letterSpacing: '-0.02em'  }]
'4xl':  ['34px', { lineHeight: '1.3',  letterSpacing: '-0.025em' }]
```

### フォントサイズ強制引き上げ（globals.css）
`text-[Npx]`アービトラリ値クラスを最小12pxに上書き:
```css
.text-\[8px\], .text-\[9px\]  { font-size: 12px !important; line-height: 1.55 !important; }
.text-\[10px\]                { font-size: 12.5px !important; line-height: 1.55 !important; }
.text-\[11px\], .text-\[12px\] { font-size: 13px !important; line-height: 1.6 !important; }
```
- レイアウト・構造は一切変更せず、フォントサイズ・行間・文字色のみ調整
- `button, a, label, [role="button"]` の最低 font-weight を 500 に強制

### 【防衛策】レイアウト破綻防止（globals.css）
フォント拡大に伴う flex item の溢れを防ぐ:
```css
.flex > *, .inline-flex > * { min-width: 0; }
td, th { overflow: hidden; text-overflow: ellipsis; }
```

### 【機能カラー化】metadata バッジの色剥奪（globals.css）
装飾色を完全に廃止し、色は意味（semantic）のみに使用:
```css
[class*="bg-manga-"]   { background-color: #ebeae5 !important; /* bg-tertiary */ }
[class*="text-manga-"] { color: #4a4a5a !important;            /* text-secondary */ }
```
- 原稿仕様パネル等の「8bit」「350 dpi」「RGB」バッジは自動的にニュートラル化
- 結果として「本当の警告色（赤/緑/橙）」が画面で際立つ

### バッジ体系（4種固定）
| 種別 | 背景 | テキスト | 用途 |
|------|------|---------|------|
| Success | `bg-success/12` | `text-success` | OK・完了・合格 |
| Error | `bg-error/12` | `text-error` | NG・エラー |
| Warning | `bg-warning/12` | `text-warning` | 注意・確認要 |
| Neutral | `bg-bg-tertiary` | `text-text-secondary` + `border-border-light` | **その他全て**（DPI/カラーモード/サイズ/フォント名等） |

### TopNav 左タブの視認性（globals.css）
```css
nav button.text-text-secondary { color: #1a1a24 !important; }
nav button.text-text-secondary:hover { color: #4f46e5 !important; }
nav button.text-text-secondary:focus::after { /* 下線演出 */ }
```
- 背景・枠線は付与せず、色のみ濃色化してミニマルなフラットデザインを維持
- `:focus::after` で選択中のタブに下線を表示（擬似アクティブ状態）

### デザイン要素
- **角丸**: xl=12px / 2xl=16px / 3xl=20px（中間値、ソフト感維持）
- **影**: ドロップシャドウ維持（`soft`/`card`/`elevated`、rgba(26,26,36)ベース）
- **グロー**: 3色変種（`glow-pink`/`glow-purple`/`glow-mint`）全てIndigo系に統一
- **グラデーション**: 同系色のみ（Indigo→Deep Indigo等、pink/purple系は廃止）
- **スクロールバー**: 10px幅、温中性グレー（#c4bfb3 → #a8a396）
- **フォーカスリング**: 2px solid #4f46e5
- **選択色**: 半透明Indigo（rgba(79,70,229,0.2)）
- **プレビュー背景**: SpecCheckViewの右パネルプレビュー（`FilePreviewImage`）は`bg-bg-primary`に統一（従来の`#1a1a1e`黒背景を廃止、ファイル未選択時・表示時ともにクリーム背景）

## 主要依存関係

### フロントエンド
- React 18.3.1、Zustand 5.0.0、ag-psd 30.1.0
- Tailwind CSS 3.4.15、Vite 5.4.0、TypeScript
- @tauri-apps/api 2.0.0
- Tauriプラグイン: dialog, fs, process, updater
- diff 8.0.3（KENBAN text diff）
- jspdf 4.0.0（KENBAN PDF generation）
- lucide-react 0.562.0（KENBAN icons）
- pdf-lib 1.17.1（KENBAN PDF manipulation）
- pdfjs-dist 5.4.530（KENBAN PDF rendering）
- utif 3.1.0（KENBAN TIFF decoding）

### Rust
- tauri 2.0、tokio（非同期ランタイム）、serde（シリアライズ）
- pdfium-render（PDF処理）、fontdb + ttf-parser（フォント解決）
- image（画像処理）
- base64 0.22, open 5, dirs 5, natord 1.0（KENBAN/ProGen用）

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
- **リリースページ**: `https://github.com/yamamoto-ryusei-ux/COMIC-Bridge-integrated/releases/tag/v2.x.x`
- **CI**: `tauri-apps/tauri-action@v0.5`を使用（`updaterJsonPreferNsis: true`, `includeUpdaterJson: true`でlatest.json自動生成）

### 重要: アプリ識別子とproductName
- **identifier**: `com.comic-bridge-integrated.app`（通常版`com.comic-bridge.app`と異なる。同一identifierだとWindowsレジストリで同一アプリ扱いになりショートカットが上書きされる）
- **productName**: `COMIC-Bridge-Integrated`（ASCII文字のみ。日本語を含めるとリリースアセットファイル名が化けてlatest.jsonのURLと不一致になる）
- **ウィンドウタイトル**: `COMIC-Bridge 統合版`（app.windows[0].titleで設定、日本語OK）
- **これらの値を変更する場合**: identifier変更→別アプリとして認識（旧版と共存/上書き問題）。productName変更→インストール先フォルダが変わり自動更新が別アプリに向く
- **⚠ 既知の問題: 通常版COMIC-Bridgeとのショートカット競合**: 統合版をインストールすると通常版（Ina986/COMIC-Bridge）のデスクトップショートカットが上書きされる場合がある。identifier・productNameを分離済みだが、Tauri NSISインストーラーのデフォルト動作で完全に回避できていない。hooks.nshではショートカットに一切触れない方針。通常版のショートカットが消えた場合は通常版のインストーラーを再実行して復元する必要がある

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
| 全画面切替 | ボタン | ビューアー/差分/分割タブ（Esc で解除、OSフルスクリーン連動） |

## CSP（Content Security Policy）

- `worker-src blob:` — KENBAN Web Worker用
- `script-src 'unsafe-eval' blob:` — pdfjs-dist等のワーカー実行用
- `frame-src 'self'` — ProGen iframe埋め込み用

## 統合アーキテクチャ（KENBAN・ProGen）

### KENBAN統合方式
- React統合: KenbanApp.tsx をKenbanView.tsx でラップ
- **スタイル隔離**: `kenban-scope` CSSクラスで全スタイルをスコープ化（Tailwind v4→v3変換対応）。KENBANのCSS（kenban.css, kenbanApp.css）はkenban-scopeクラス内でのみ有効
- **状態保持型マウント**: ViewRouterでdisplay切替（`display: none`/`block`）によりコンポーネントをアンマウントせず状態を保持。kenban / progen / unifiedViewer の3ビューが対象
- Rust側: kenban.rs に21コマンドを集約。rayon並列処理で画像差分を高速計算

### ProGen統合方式
- **React統合**: iframe廃止、Zustand + Tailwindで本体と完全統合
- **Tauriコマンド**: `useProgenTauri.ts` が `@tauri-apps/api/core` invoke経由。全コマンドは `progen_` プレフィックス付き
- **状態管理**: `progenStore.ts`（Zustand）で全ProGen状態を一元管理。COMIC-POTエディタのみ`useComicPotState`（useReducer）でローカル管理
- **画面ルーター**: `ProgenView.tsx` で `progenStore.screen` に基づき6画面を切替
- **状態保持型マウント**: KENBANと同様にdisplay切替で状態保持
- Rust側: progen.rs に26コマンドを集約（変更なし）
