# _deprecated

隔離中/削除予定のツール群。ViewRouter でマウント無効化済み、または使用箇所を限定して残置しているコード。新しい依存を追加せず、削除前の動作確認用に保持。

## 対象

- **typesetting-check**: 写植チェック（校正JSON閲覧）。現在は統合ビューアーの「校正JSON」タブで代替。`./typesetting/check/`, `./typesetting/TypsettingView.tsx`, `./typesetting/typesettingCheckStore.ts`。型定義 `types/typesettingCheck.ts` は unified-viewer からも使用されるため `src/types/` に残置（App.tsx 経由で CLI proofreading JSON 取り込み時にこの store を更新するが、ViewRouter が typesetting view を無効化しているため画面には出ない）
- **typesetting-confirm**: 写植確認（フォント指定付きテキスト保存）。現在は統合ビューアーのテキストタブ＋フォント割当UIで代替。`./typesetting/confirm/TypesettingConfirmPanel.tsx`
- **layer-separation**: レイヤー分離（ドットメニューから除外済み）。`./layer-separation/LayerSeparationPanel.tsx`
- **kenban-utils**: KENBAN由来の共有ユーティリティ（`textExtract.ts`, `memoParser.ts`, `kenbanTypes.ts`）。統合ビューアーのテキスト照合で使用中。将来的に `@shared/lib/text-diff/` へ統合予定

**注意**: このフォルダ内のコードは機能変更せず、削除可否の判断まで現状維持。将来削除する場合は、依存している機能（統合ビューアーのテキスト照合等）の代替実装を先に完了させること。
