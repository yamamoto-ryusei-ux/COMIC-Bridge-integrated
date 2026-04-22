# _deprecated (隔離中 / 削除予定)

削除前の動作確認・互換性保証のために残置しているコード。ViewRouter でマウント無効化済み、または使用箇所を限定して残している。**新しい依存を追加しない**こと。

> 全体像: [../../../docs/architecture.md](../../../docs/architecture.md) / [../../../docs/feature-map.md](../../../docs/feature-map.md)

## 対象

### 1. typesetting-check (写植チェック)

- 配置: `./typesetting/check/`, `./typesetting/TypsettingView.tsx`, `./typesetting/typesettingCheckStore.ts`
- 代替: [unified-viewer](../unified-viewer/README.md) の「校正 JSON」タブ
- 型定義 [types/typesettingCheck.ts](../../types/typesettingCheck.ts) は unified-viewer からも使用されるため `src/types/` に残置
- App.tsx 経由で CLI proofreading JSON 取り込み時に本 store を更新するが、ViewRouter が typesetting view を無効化しているため画面には出ない

### 2. typesetting-confirm (写植確認)

- 配置: `./typesetting/confirm/TypesettingConfirmPanel.tsx`
- 代替: unified-viewer のテキストタブ + フォント割当 UI
- 機能: comicpot テキストデータにフォント指定を付与して保存する機能。フォント帳（プリセット JSON）を読み込み、テキストブロックにフォントを割り当て
- フォント指定書式: `[font:PostScriptName(表示名(カテゴリ))]` — subName なし時は `[font:PostScriptName(表示名)]`
- sanitize / validateFontTag で書式破壊防止

### 3. layer-separation (レイヤー分離)

- 配置: `./layer-separation/LayerSeparationPanel.tsx`
- 状態: ドットメニューから除外済み、未使用

### 4. kenban-utils (KENBAN 由来ユーティリティ)

- 実体: [src/kenban-utils/](../../kenban-utils/) (`textExtract.ts`, `memoParser.ts`, `kenbanTypes.ts`)
- 使用中: unified-viewer の「テキスト照合」タブで LCS 文字レベル diff を利用
- 将来計画: `@shared/lib/text-diff/` へ統合予定

## 削除方針

1. **削除前の前提条件**
   - 依存している機能（unified-viewer のテキスト照合等）の代替実装を先に完了
   - 型定義（`typesettingCheck.ts`）の参照を整理
   - 関連する Zustand ストアの store 削除計画

2. **削除の優先度**
   | 項目 | 優先度 | 理由 |
   |---|---|---|
   | layer-separation | 高 | 完全に未使用 |
   | typesetting-confirm | 中 | 代替実装は完了、削除可能 |
   | typesetting-check | 中 | 型定義のみ要整理 |
   | kenban-utils | 低 | 現役で使用中、移転先 (`@shared/lib/text-diff/`) 構築後に移動 |

3. **現状維持のルール**
   - このフォルダ内のコードは **機能変更しない**
   - 他 feature からは参照しない（`@features/_deprecated/*` の import を禁止）
   - 削除時は 1 項目ずつ、動作確認を挟みながら段階的に

## 関連ドキュメント

- [../../../CLAUDE.md](../../../CLAUDE.md) §16, §17 — typesetting-check / typesetting-confirm の詳細機能仕様
- [../unified-viewer/README.md](../unified-viewer/README.md) — 代替実装
