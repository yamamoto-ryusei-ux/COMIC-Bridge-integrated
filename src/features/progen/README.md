# progen (ProGen / プロンプト生成ツール)

Gemini 等に渡すプロンプトを生成・校正結果を構造化保存する機能。元ツール `progen-xml-templates.js` / `progen-xml-gen.js` 等を TypeScript に完全移植（React + Zustand + Tailwind、iframe 廃止）。

> 全体像: [../../../docs/architecture.md](../../../docs/architecture.md) / [../../../docs/feature-map.md](../../../docs/feature-map.md) / [../../../docs/data-flow.md](../../../docs/data-flow.md)

## 画面

| View | 役割 |
|---|---|
| [ProgenView.tsx](./ProgenView.tsx) | `AppView = "progen"` のルート。画面ルーター (`progenStore.screen`) |

### 画面切替 (`progenStore.screen`)

| screen | 役割 |
|---|---|
| `landing` | 起動直後 |
| `extraction` | ルール編集 (ProgenRuleView)。校正用 popup も本画面に表示 |
| `formatting` | 整形プロンプト |
| `admin` | パスワード付き管理画面 (ProgenAdminView) |
| `comicpot` | COMIC-POT エディタ |
| `resultViewer` | 校正結果ビューア |
| ~~`proofreading`~~ | v3.6.4 で廃止。extraction の popup に統合 |

## このフィーチャーの所有物

| 種別 | ファイル | 責務 |
|---|---|---|
| Store | [progenStore.ts](./progenStore.ts) | 40+ プロパティ（ルール管理、マスタールール、JSON ルール適用、`toolMode`, `screen`, `resultSaveMode`） |
| Hook | [useProgenTauri.ts](./useProgenTauri.ts) | 26 個の `progen_*` コマンドの invoke ラッパー |
| Hook | [useProgenJson.ts](./useProgenJson.ts) | JSON 読書 / CSV 解析 / カテゴリグループ化 |
| Hook | [useComicPotState.ts](./useComicPotState.ts) | COMIC-POT エディタ専用 useReducer ステート |
| Lib | [progenPrompts.ts](./progenPrompts.ts) | プロンプト生成（抽出/整形/正誤/提案）。旧 JS 版と**バイト単位で一致** |
| Lib | [progenConfig.ts](./progenConfig.ts) | 共有ドライブ同期ローダー + 埋め込みフォールバック |
| Types | [progen.ts](./progen.ts) | `SymbolRule`, `ProofRule`, `ProgenOptions`, `NumberRuleState`, `EditCategory`, `ProgenScreen` 等 |
| Components | [components/](./components/) | ProgenRuleView, ProgenProofreadingView, ProgenJsonBrowser, ProgenResultViewer, ProgenCalibrationSave, ProgenAdminView, comicpot/ |

## グローバル依存

- **ストア**: [viewStore](../../store/viewStore.ts) (R, `progenMode`) / [settingsStore](../../store/settingsStore.ts) (R)
- **他 feature ストア (読取)**: [unifiedViewerStore](../unified-viewer/unifiedViewerStore.ts) — 参照テキスト取得 / 結果保存先 / [scanPsdStore](../scan-psd/scanPsdStore.ts) — 作品情報 JSON

## Rust コマンド (progen.rs — 26 コマンド)

| カテゴリ | コマンド |
|---|---|
| フォルダ / JSON | `progen_get_json_folder_path`, `progen_list_directory`, `progen_read_json_file`, `progen_write_json_file` |
| マスタールール | `progen_read_master_rule`, `progen_write_master_rule`, `progen_create_master_label`, `progen_get_master_label_list` |
| TXT | `progen_create_txt_work_folder`, `progen_get_txt_folder_path`, `progen_list_txt_directory`, `progen_read_txt_file`, `progen_write_text_file`, `progen_read_dropped_txt_files`, `progen_show_save_text_dialog` |
| 校正データ | `progen_save_calibration_data` |
| 出力 | `progen_print_to_pdf` (Edge 経由) |
| 画像 | `progen_list_image_files`, `progen_list_image_files_from_paths`, `progen_load_image_preview`, `progen_show_open_image_folder_dialog` |
| ダイアログ | `progen_show_save_json_dialog`, `progen_open_and_read_json_dialog` |
| ハンドオフ | `progen_launch_comic_bridge`, `progen_get_comicpot_handoff` |
| 共有ドライブ | `fetch_progen_config` (commands.rs) |

## 3 モード

| モード | プロンプト生成関数 | 内容 |
|---|---|---|
| **抽出** | `generateExtractionPrompt` | PDF only / 3 ステップ (Text Extraction → Proofreading → Self-Check + final_output) |
| **整形** | `generateFormattingPrompt` | TXT only |
| **正誤チェック** | `generateSimpleCheckPrompt` | フル版 7-8 項目 (誤字/脱字/人名ルビ/単位/伏字/人物名/熟字訓 + 常用外漢字) + 統一表記ルール反映確認 |
| **提案チェック** | `generateVariationCheckPrompt` | 10 項目 (文字種/送り仮名/外来語/数字/略称/異体字/文体/固有名詞/専門用語/未成年表現) |

共通: NG ワードリスト (26 語)、`escapeHtml`（旧版完全互換: `'`→`&#039;`、falsy 判定）、`numberSubRules` / `categories` 定数も旧版互換。

## ツールメニュー連携 (v3.6.4)

TopNav ツール → ProGen 3 モードから直接アクセス:
- `progenStore.toolMode` で現在のツールモード管理 (`"extraction"` / `"formatting"` / `"proofreading"` / `null`)
- TopNav click 時に toolMode + screen を同期的に設定（race condition 回避）
- WF フラグ (`folderSetup_progenMode` / `progen_wfCheckMode`) を明示的にクリア
- extraction screen に popup を表示:
  - `toolMode === "extraction"` → 🟠 抽出プロンプトボタン
  - `toolMode === "formatting"` → 🔵 整形ボタン（テキスト有無チェック）
  - `toolMode === "proofreading"` → 🟢 正誤 + 🟠 提案 の 2 ボタン並列

## 外部設定同期 (CLAUDE.md §28 — ⚠ 試運転中)

配置先:
```
G:\共有ドライブ\CLLENN\...\Comic Bridge_統合版\Pro-Gen\
├── version.json
└── config.json
```

フロー:
1. アプリ起動時に App.tsx が `initProgenConfig()` 非同期呼出
2. ローカルキャッシュ (`%APPDATA%\comic-bridge\progen-cache\`) を即時反映
3. `fetch_progen_config` で SemVer 比較 → 新しければキャッシュ上書き → 再読込

フォールバック階層:
1. リモート同期済みキャッシュ
2. 既存ローカルキャッシュ
3. 埋め込み既定値 (`progenConfig.ts:DEFAULT_*`)

テンプレート: [docs/progen-template/](../../../docs/progen-template/)

## 結果保存モーダル (ResultSaveModal)

- 校正データ保存。`parseCheckText()` で CSV / Markdown テーブル両対応 → `{ checks: { simple, variation }, volume, savedAt }` 形式で構造化
- ファイル名: `{N}巻.json` (v3.6.2 で timestamp 廃止)
- 保存後に `unifiedViewerStore.checkData` へ自動読み込み
- 作品情報 JSON 未登録時はジャンル/レーベル/タイトルのインラインフォーム表示、`performPresetJsonSave()` → 校正 JSON 保存の順序厳守

## 設計上のポイント

1. **バイト単位で旧版互換**: 旧 JS 版と生成 XML がバイト単位で一致するよう TypeScript 移植
2. **`escapeHtml` の仕様**: `'` → `&#039;`、falsy 判定（旧版完全互換）
3. **Proxy 経由の動的参照**: `ngWordList` / `numberSubRules` / `categories` を Proxy でラップし、共有ドライブ由来の値を既存コード変更なしで反映
4. **JSON 自動反映**: TopNav の作品情報 JSON / `loadPresetJson` / `currentJsonFilePath` 変更時に proofRules を `progenStore.applyJsonRules` で自動適用
5. **ProgenProofreadingView は厳重隔離** (v3.6.4): ファイルは残すがどこからもレンダリングされない。将来削除予定

## 関連機能

- [unified-viewer](../unified-viewer/README.md) — 校正 JSON の閲覧・テキストタブ連動
- [scan-psd](../scan-psd/README.md) — 作品情報 JSON 共有
- [_deprecated](../_deprecated/README.md) — ProgenProofreadingView (隔離中)
