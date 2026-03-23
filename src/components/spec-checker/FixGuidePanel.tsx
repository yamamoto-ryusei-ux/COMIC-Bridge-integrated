import type { SpecCheckResult } from "../../types";
import { usePsdStore } from "../../store/psdStore";
import { useSpecStore } from "../../store/specStore";
import { useGuideStore } from "../../store/guideStore";
import { usePhotoshopConverter } from "../../hooks/usePhotoshopConverter";
import { usePreparePsd } from "../../hooks/usePreparePsd";
import { PopButton } from "../ui/PopButton";

interface FixGuidePanelProps {
  checkResult: SpecCheckResult;
}

// ルールタイプの日本語表示
const ruleTypeLabels: Record<string, string> = {
  colorMode: "カラーモード",
  dpi: "解像度",
  bitsPerChannel: "ビット深度",
  hasAlphaChannels: "αチャンネル",
  hasGuides: "ガイド",
};

// 修正方法の説明
const fixDescriptions: Record<string, string> = {
  colorMode: "カラーモードを変換します",
  dpi: "解像度を変更します（BICUBIC）",
  bitsPerChannel: "ビット深度を変換します",
  hasAlphaChannels: "αチャンネルを削除します",
};

export function FixGuidePanel({ checkResult }: FixGuidePanelProps) {
  const files = usePsdStore((state) => state.files);
  const selectedFileIds = usePsdStore((state) => state.selectedFileIds);
  const checkResults = useSpecStore((state) => state.checkResults);
  const isConverting = useSpecStore((state) => state.isConverting);
  const guides = useGuideStore((state) => state.guides);
  const { isPhotoshopInstalled } = usePhotoshopConverter();
  const { isProcessing, prepareFiles } = usePreparePsd();

  // 失敗したルールを取得
  const failedRules = checkResult.results.filter((r) => !r.passed);

  // 全NGファイル数を計算
  const ngFileCount = Array.from(checkResults.values()).filter((r) => !r.passed).length;

  // 選択中のNGファイル数を計算
  const selectedNgCount = selectedFileIds.filter((id) => {
    const result = checkResults.get(id);
    return result && !result.passed;
  }).length;

  // ガイドなしファイルの有無
  const hasNoGuideFiles = files.some((f) => f.metadata && !f.metadata.hasGuides);
  const willApplyGuides = hasNoGuideFiles && guides.length > 0;

  // 選択中のファイルのみ変換
  const handleConvertSelected = async () => {
    await prepareFiles({
      fixSpec: true,
      applyGuides: willApplyGuides,
      fileIds: selectedFileIds,
    });
  };

  // 全NGファイル変換
  const handleConvertAll = async () => {
    await prepareFiles({
      fixSpec: true,
      applyGuides: willApplyGuides,
    });
  };

  if (failedRules.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* NG表示ヘッダー */}
      <div className="flex items-center gap-2 text-error">
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
            clipRule="evenodd"
          />
        </svg>
        <span className="font-medium">仕様チェック: NG</span>
      </div>

      {/* 問題点 */}
      <div className="bg-error/10 rounded-xl p-4 border border-error/20">
        <h4 className="text-sm font-medium text-error mb-3 flex items-center gap-2">
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          問題点
        </h4>
        <div className="space-y-2">
          {failedRules.map((r, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span className="text-text-secondary">
                {ruleTypeLabels[r.rule.type] || r.rule.type}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-error font-medium">{formatValue(r.actualValue)}</span>
                <svg
                  className="w-4 h-4 text-text-muted"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
                <span className="text-success font-medium">{formatValue(r.rule.value)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 修正方法 */}
      <div className="bg-accent-tertiary/10 rounded-xl p-4 border border-accent-tertiary/20">
        <h4 className="text-sm font-medium text-accent-tertiary mb-3 flex items-center gap-2">
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
            />
          </svg>
          修正方法
        </h4>
        <p className="text-sm text-text-secondary mb-3">Photoshopで以下の処理を行います:</p>
        <ul className="space-y-1.5">
          {failedRules.map((r, i) => (
            <li key={i} className="flex items-center gap-2 text-sm text-text-muted">
              <svg
                className="w-3 h-3 text-accent-tertiary flex-shrink-0"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
              {fixDescriptions[r.rule.type] || `${ruleTypeLabels[r.rule.type]}を修正`}
            </li>
          ))}
        </ul>
      </div>

      {/* アクションボタン */}
      <div className="space-y-2">
        {!isPhotoshopInstalled && (
          <div className="text-xs text-warning bg-warning/10 rounded-lg p-3 mb-2">
            Photoshopがインストールされていないか、パスが見つかりません
          </div>
        )}
        {willApplyGuides && (
          <div className="text-xs bg-guide-v/10 border border-guide-v/20 rounded-lg px-3 py-2 text-guide-v">
            ガイドなしファイルにガイドも同時適用
          </div>
        )}
        <PopButton
          variant="primary"
          className="w-full"
          onClick={handleConvertSelected}
          disabled={!isPhotoshopInstalled || isConverting || isProcessing || selectedNgCount === 0}
          loading={isConverting || isProcessing}
        >
          {selectedNgCount <= 1 ? "この1件を変換" : `選択中の${selectedNgCount}件を変換`}
        </PopButton>
        {ngFileCount > 1 && (
          <PopButton
            variant="secondary"
            className="w-full"
            onClick={handleConvertAll}
            disabled={!isPhotoshopInstalled || isConverting || isProcessing}
            loading={isConverting || isProcessing}
          >
            NGすべて変換 ({ngFileCount}件)
          </PopButton>
        )}
      </div>

      {/* 仕様情報 */}
      {checkResult.matchedSpec && (
        <div className="text-xs text-text-muted text-center pt-2 border-t border-border">
          チェック仕様: {checkResult.matchedSpec}
        </div>
      )}
    </div>
  );
}

// 値のフォーマット
function formatValue(value: string | number | boolean | number[]): string {
  if (typeof value === "boolean") {
    return value ? "あり" : "なし";
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.join("-");
  }
  return value;
}
