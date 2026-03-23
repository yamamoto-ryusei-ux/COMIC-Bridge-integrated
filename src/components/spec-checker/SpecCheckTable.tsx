import { usePsdStore } from "../../store/psdStore";
import { useSpecStore } from "../../store/specStore";
import type { PsdFile, SpecCheckResult } from "../../types";

export function SpecCheckTable() {
  const files = usePsdStore((state) => state.files);
  const selectedFileIds = usePsdStore((state) => state.selectedFileIds);
  const activeFileId = usePsdStore((state) => state.activeFileId);
  const selectFile = usePsdStore((state) => state.selectFile);
  const selectRange = usePsdStore((state) => state.selectRange);
  const checkResults = useSpecStore((state) => state.checkResults);

  const handleClick = (fileId: string, e: React.MouseEvent) => {
    if (e.shiftKey) {
      selectRange(fileId);
    } else if (e.ctrlKey || e.metaKey) {
      selectFile(fileId, true);
    } else {
      selectFile(fileId);
    }
  };

  return (
    <div className="h-full overflow-auto select-none">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-bg-secondary border-b border-border px-3 py-2 grid grid-cols-[32px_36px_1fr_100px_80px_80px_60px_60px_70px] gap-3 text-xs font-medium text-text-muted">
        <div />
        <div />
        <div>ファイル名</div>
        <div>カラーモード</div>
        <div>DPI</div>
        <div>ビット深度</div>
        <div>Alpha</div>
        <div>ガイド</div>
        <div>判定</div>
      </div>

      {/* Rows */}
      {files.map((file) => (
        <SpecCheckRow
          key={file.id}
          file={file}
          checkResult={checkResults.get(file.id)}
          isSelected={selectedFileIds.includes(file.id)}
          isActive={activeFileId === file.id}
          onClick={handleClick}
        />
      ))}

      {files.length === 0 && (
        <div className="flex items-center justify-center h-48 text-text-muted text-sm">
          ファイルを読み込んでください
        </div>
      )}
    </div>
  );
}

function SpecCheckRow({
  file,
  checkResult,
  isSelected,
  isActive,
  onClick,
}: {
  file: PsdFile;
  checkResult?: SpecCheckResult;
  isSelected: boolean;
  isActive: boolean;
  onClick: (fileId: string, e: React.MouseEvent) => void;
}) {
  const failedRules = checkResult?.results.filter((r) => !r.passed) || [];
  const isColorModeNG = failedRules.some((r) => r.rule.type === "colorMode");
  const isDpiNG = failedRules.some((r) => r.rule.type === "dpi");
  const isBitsNG = failedRules.some((r) => r.rule.type === "bitsPerChannel");
  const isAlphaNG = failedRules.some((r) => r.rule.type === "hasAlphaChannels");
  const hasError = checkResult && !checkResult.passed;

  return (
    <div
      className={`
        grid grid-cols-[32px_36px_1fr_100px_80px_80px_60px_60px_70px] gap-3 items-center
        px-3 py-1.5 cursor-pointer transition-colors border-b border-border/30
        ${
          isActive
            ? "bg-accent/15"
            : isSelected
              ? "bg-accent/8"
              : "hover:bg-bg-tertiary/50 even:bg-bg-tertiary/20"
        }
        ${hasError ? "border-l-2 border-l-error" : ""}
      `}
      onClick={(e) => onClick(file.id, e)}
    >
      {/* Checkbox */}
      <div className="flex items-center justify-center">
        <div
          className={`w-4 h-4 rounded flex items-center justify-center transition-all
            ${
              isSelected
                ? "bg-gradient-to-br from-accent to-accent-secondary"
                : "border-2 border-text-muted/30"
            }
          `}
        >
          {isSelected && (
            <svg
              className="w-2.5 h-2.5 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={3}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
      </div>

      {/* Thumbnail */}
      <div className="w-9 h-12 bg-bg-tertiary rounded overflow-hidden flex items-center justify-center flex-shrink-0">
        {file.thumbnailUrl ? (
          <img
            src={file.thumbnailUrl}
            alt={file.fileName}
            className="max-w-full max-h-full object-contain"
          />
        ) : file.thumbnailStatus === "loading" ? (
          <div className="w-3 h-3 border border-accent border-t-transparent rounded-full animate-spin" />
        ) : (
          <div className="text-text-muted text-[8px]">-</div>
        )}
      </div>

      {/* File Name */}
      <div className="text-xs text-text-primary truncate font-medium" title={file.fileName}>
        {file.fileName}
      </div>

      {/* Color Mode */}
      <CellValue
        value={file.metadata?.colorMode}
        isNG={isColorModeNG}
        failedRule={failedRules.find((r) => r.rule.type === "colorMode")}
      />

      {/* DPI */}
      <CellValue
        value={file.metadata?.dpi}
        isNG={isDpiNG}
        failedRule={failedRules.find((r) => r.rule.type === "dpi")}
      />

      {/* Bit Depth */}
      <CellValue
        value={file.metadata ? `${file.metadata.bitsPerChannel}bit` : undefined}
        isNG={isBitsNG}
        failedRule={failedRules.find((r) => r.rule.type === "bitsPerChannel")}
      />

      {/* Alpha */}
      <CellValue
        value={
          file.metadata
            ? file.metadata.hasAlphaChannels
              ? `あり(${file.metadata.alphaChannelCount})`
              : "なし"
            : undefined
        }
        isNG={isAlphaNG}
        failedRule={failedRules.find((r) => r.rule.type === "hasAlphaChannels")}
      />

      {/* Guide */}
      <div className="text-xs">
        {file.metadata ? (
          file.metadata.hasGuides ? (
            <span className="text-guide-v">
              <svg className="w-3.5 h-3.5 inline-block" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
            </span>
          ) : (
            <span className="text-text-muted">なし</span>
          )
        ) : (
          <span className="text-text-muted">-</span>
        )}
      </div>

      {/* Status */}
      <div>
        {checkResult ? (
          checkResult.passed ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-success bg-success/10 px-2 py-0.5 rounded-full">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
              OK
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-error bg-error/10 px-2 py-0.5 rounded-full">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
              NG
            </span>
          )
        ) : (
          <span className="text-[10px] text-text-muted">-</span>
        )}
      </div>
    </div>
  );
}

function CellValue({
  value,
  isNG,
  failedRule,
}: {
  value?: string | number;
  isNG: boolean;
  failedRule?: { rule: { message: string; value: string | number | boolean | number[] } };
}) {
  if (value === undefined) {
    return <div className="text-xs text-text-muted">-</div>;
  }

  if (isNG && failedRule) {
    const expected =
      typeof failedRule.rule.value === "boolean"
        ? failedRule.rule.value
          ? "あり"
          : "なし"
        : String(failedRule.rule.value);
    return (
      <div
        className="text-xs font-medium text-error bg-error/10 px-1.5 py-0.5 rounded flex items-center gap-0.5"
        title={failedRule.rule.message}
      >
        <span className="truncate">{String(value)}</span>
        <svg
          className="w-2.5 h-2.5 text-text-muted flex-shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
        </svg>
        <span className="text-success truncate">{expected}</span>
      </div>
    );
  }

  return <div className="text-xs text-text-secondary">{String(value)}</div>;
}
