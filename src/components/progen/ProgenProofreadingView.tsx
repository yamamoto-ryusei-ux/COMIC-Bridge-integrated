/**
 * ProGen 校正画面（Phase 2）
 * 正誤チェック / 提案チェック のプロンプト生成 + Gemini連携
 */
import { useState, useCallback } from "react";
import { useProgenStore } from "../../store/progenStore";
import { useUnifiedViewerStore } from "../../store/unifiedViewerStore";
import { generateSimpleCheckPrompt, generateVariationCheckPrompt } from "../../lib/progenPrompts";
import { openExternalUrl } from "../../hooks/useProgenTauri";
import type { ProofreadingMode } from "../../types/progen";

// 正誤チェック項目
const SIMPLE_CHECK_ITEMS = [
  { id: 1, name: "誤字", desc: "漢字の変換ミスや単純なタイプミス", icon: "✏️" },
  { id: 2, name: "脱字", desc: "必要な文字が抜けている箇所", icon: "🔍" },
  { id: 3, name: "人名ルビ", desc: "漢字表記の人物名の初出箇所", icon: "🏷️" },
];

// 提案チェック項目
const VARIATION_CHECK_ITEMS = [
  { id: 1, name: "漢字/ひらがな統一", desc: "同一語の表記混在", icon: "字" },
  { id: 2, name: "送り仮名のゆれ", desc: "送り仮名の不統一", icon: "仮" },
  { id: 3, name: "外来語・長音符", desc: "外来語表記のゆれ", icon: "ア" },
  { id: 4, name: "数字・漢数字", desc: "数字表記の混在", icon: "#" },
  { id: 5, name: "略称・別表現", desc: "同一概念の異なる表現", icon: "≈" },
  { id: 6, name: "異体字", desc: "異体字の混在", icon: "異" },
  { id: 7, name: "文体の統一", desc: "文体の不統一", icon: "文" },
  { id: 8, name: "固有名詞・商標", desc: "実在する企業名等の正確性", icon: "™" },
  { id: 9, name: "専門用語・事実", desc: "法律・医療用語等の正確性", icon: "📚" },
  { id: 10, name: "未成年表現", desc: "未成年＋問題描写の組み合わせ", icon: "⚠️" },
];

export function ProgenProofreadingView() {
  const { currentProofreadingMode, setCurrentProofreadingMode } = useProgenStore();
  const textContent = useUnifiedViewerStore((s) => s.textContent);
  const textFilePath = useUnifiedViewerStore((s) => s.textFilePath);
  const [copied, setCopied] = useState<string | null>(null);
  const [generatedPrompt, setGeneratedPrompt] = useState<string | null>(null);

  const fileName = textFilePath?.split("\\").pop()?.split("/").pop() || "";
  const hasText = textContent.length > 0;
  const charCount = textContent.length;

  const showCopied = (msg: string) => { setCopied(msg); setTimeout(() => setCopied(null), 2500); };

  // プロンプト生成
  const handleGenerate = useCallback(() => {
    if (!hasText) return;
    const prompt = currentProofreadingMode === "simple"
      ? generateSimpleCheckPrompt(textContent)
      : generateVariationCheckPrompt(textContent);
    setGeneratedPrompt(prompt);
  }, [hasText, currentProofreadingMode, textContent]);

  // コピー → Gemini
  const handleCopyAndOpen = useCallback(async () => {
    if (!hasText) return;
    const prompt = currentProofreadingMode === "simple"
      ? generateSimpleCheckPrompt(textContent)
      : generateVariationCheckPrompt(textContent);
    setGeneratedPrompt(prompt);
    await navigator.clipboard.writeText(prompt).catch(() => {});
    showCopied(currentProofreadingMode === "simple" ? "正誤チェック" : "提案チェック");
    await openExternalUrl("https://gemini.google.com/app");
  }, [hasText, currentProofreadingMode, textContent]);

  // コピーのみ
  const handleCopyOnly = useCallback(async () => {
    if (!generatedPrompt) return;
    await navigator.clipboard.writeText(generatedPrompt).catch(() => {});
    showCopied("プロンプト");
  }, [generatedPrompt]);

  const items = currentProofreadingMode === "simple" ? SIMPLE_CHECK_ITEMS : VARIATION_CHECK_ITEMS;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ヘッダー: モード切替 */}
      <div className="flex-shrink-0 px-4 py-2 border-b border-border bg-bg-secondary flex items-center gap-3">
        <span className="text-xs font-bold text-text-primary">校正チェック</span>
        <div className="flex bg-bg-tertiary rounded-lg p-0.5">
          {(["simple", "variation"] as ProofreadingMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => { setCurrentProofreadingMode(mode); setGeneratedPrompt(null); }}
              className={`px-3 py-1 text-[10px] rounded-md transition-colors ${
                currentProofreadingMode === mode
                  ? mode === "simple" ? "bg-emerald-500 text-white font-medium" : "bg-orange-500 text-white font-medium"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              {mode === "simple" ? "正誤チェック" : "提案チェック"}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {copied && <span className="text-[9px] text-success font-medium">{copied} コピー済</span>}
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* 左: チェック項目 + テキスト情報 */}
        <div className="w-[280px] flex-shrink-0 border-r border-border/50 flex flex-col bg-bg-tertiary/20 overflow-y-auto">
          {/* テキスト情報 */}
          <div className="p-3 border-b border-border/30">
            <div className="text-[10px] text-text-muted mb-1">対象テキスト</div>
            {hasText ? (
              <div className="space-y-1">
                {fileName && <div className="text-[10px] text-text-primary truncate">{fileName}</div>}
                <div className="text-[9px] text-text-muted">{charCount.toLocaleString()} 文字</div>
                <div className="bg-bg-primary rounded p-2 max-h-[100px] overflow-auto">
                  <pre className="text-[8px] font-mono text-text-secondary whitespace-pre-wrap">{textContent.substring(0, 500)}{textContent.length > 500 ? "..." : ""}</pre>
                </div>
              </div>
            ) : (
              <div className="text-[10px] text-warning">テキストが読み込まれていません。TopNavの「テキスト」ボタンから読み込んでください。</div>
            )}
          </div>

          {/* チェック項目一覧 */}
          <div className="p-3">
            <div className="text-[10px] font-medium text-text-muted mb-2">
              チェック項目（{items.length}項目 × 5パス）
            </div>
            <div className="space-y-1">
              {items.map((item) => (
                <div key={item.id} className="flex items-start gap-2 px-2 py-1.5 bg-bg-tertiary/50 rounded text-[10px]">
                  <span className="text-sm flex-shrink-0">{item.icon}</span>
                  <div>
                    <div className="text-text-primary font-medium">{item.id}. {item.name}</div>
                    <div className="text-[9px] text-text-muted">{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* アクションボタン */}
          <div className="p-3 border-t border-border/30 mt-auto space-y-2">
            <button
              onClick={handleCopyAndOpen}
              disabled={!hasText}
              className={`w-full px-3 py-2.5 text-[11px] font-medium text-white rounded-lg transition-colors disabled:opacity-30 ${
                currentProofreadingMode === "simple"
                  ? "bg-emerald-500 hover:bg-emerald-600"
                  : "bg-orange-500 hover:bg-orange-600"
              }`}
            >
              プロンプトをコピーして Gemini を開く
            </button>
            <button
              onClick={handleGenerate}
              disabled={!hasText}
              className="w-full px-3 py-1.5 text-[10px] text-text-secondary bg-bg-tertiary rounded-lg hover:bg-bg-elevated transition-colors disabled:opacity-30"
            >
              プロンプトをプレビュー
            </button>
          </div>
        </div>

        {/* 右: プロンプトプレビュー */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {generatedPrompt ? (
            <>
              <div className="flex-shrink-0 px-3 py-1.5 border-b border-border/30 flex items-center gap-2">
                <span className="text-[10px] text-text-muted">生成されたプロンプト</span>
                <div className="flex-1" />
                <button onClick={handleCopyOnly} className="px-2 py-0.5 text-[9px] bg-bg-tertiary hover:bg-accent/10 hover:text-accent rounded transition-colors">コピー</button>
                <button onClick={() => openExternalUrl("https://gemini.google.com/app")} className="px-2 py-0.5 text-[9px] text-blue-500 hover:bg-blue-50 rounded transition-colors">Gemini</button>
              </div>
              <div className="flex-1 overflow-auto p-3">
                <pre className="text-[9px] font-mono text-text-secondary whitespace-pre-wrap leading-relaxed">{generatedPrompt}</pre>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-text-muted text-xs">
              {hasText
                ? "「プロンプトをプレビュー」または「コピーしてGeminiを開く」を押してください"
                : "テキストを読み込んでからチェックを実行してください"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
