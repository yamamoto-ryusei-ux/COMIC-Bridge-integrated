import { usePsdStore } from "../../store/psdStore";
import { useSpecStore } from "../../store/specStore";
import type { PsdFile, SpecCheckResult } from "../../types";

export function SpecCardList() {
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
    <div className="h-full overflow-auto p-2 space-y-1 select-none">
      {files.map((file) => (
        <SpecCard
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

function SpecCard({
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
  const hasError = checkResult && !checkResult.passed;
  const meta = file.metadata;

  // NG判定マップ
  const ngMap = {
    colorMode: failedRules.find((r) => r.rule.type === "colorMode"),
    dpi: failedRules.find((r) => r.rule.type === "dpi"),
    bits: failedRules.find((r) => r.rule.type === "bitsPerChannel"),
    alpha: failedRules.find((r) => r.rule.type === "hasAlphaChannels"),
  };

  return (
    <div
      className={`
        flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer
        transition-all duration-150 border
        ${
          isActive
            ? "bg-accent/12 border-accent/30"
            : isSelected
              ? "bg-accent/6 border-accent/15"
              : hasError
                ? "bg-bg-secondary border-error/20 hover:bg-bg-tertiary/60"
                : "bg-bg-secondary border-transparent hover:bg-bg-tertiary/60"
        }
      `}
      onClick={(e) => onClick(file.id, e)}
    >
      {/* Checkbox */}
      <div className="flex-shrink-0">
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
      <div className="w-10 h-14 bg-bg-tertiary rounded overflow-hidden flex items-center justify-center flex-shrink-0">
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
      <div className="min-w-0 w-40 flex-shrink-0">
        <div className="text-xs font-medium text-text-primary truncate" title={file.fileName}>
          {file.fileName}
        </div>
        {file.fileSize > 0 && (
          <div className="text-[10px] text-text-muted mt-0.5">
            {file.fileSize < 1024 * 1024
              ? `${(file.fileSize / 1024).toFixed(0)} KB`
              : `${(file.fileSize / (1024 * 1024)).toFixed(1)} MB`}
          </div>
        )}
      </div>

      {/* Spec Chips */}
      {meta ? (
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          {/* Color Mode */}
          <SpecChip value={meta.colorMode} failed={ngMap.colorMode} />

          {/* DPI */}
          <SpecChip value={`${meta.dpi}dpi`} failed={ngMap.dpi} />

          {/* Bit Depth */}
          <SpecChip value={`${meta.bitsPerChannel}bit`} failed={ngMap.bits} />

          {/* Alpha */}
          {(meta.hasAlphaChannels || ngMap.alpha) && (
            <SpecChip
              value={meta.hasAlphaChannels ? `α${meta.alphaChannelCount}` : "αなし"}
              failed={ngMap.alpha}
            />
          )}

          {/* Separator */}
          <div className="w-px h-4 bg-border flex-shrink-0 mx-0.5" />

          {/* Guide Status */}
          {meta.hasGuides ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-guide-v flex-shrink-0">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
              {meta.guides.length}本
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] text-warning flex-shrink-0">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
              なし
            </span>
          )}
        </div>
      ) : (
        <div className="flex-1 text-[11px] text-text-muted">
          {file.thumbnailStatus === "loading" ? "読み込み中..." : "-"}
        </div>
      )}

      {/* Status Badge */}
      <div className="flex-shrink-0">
        {checkResult ? (
          checkResult.passed ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-success bg-success/10 px-2.5 py-1 rounded-full">
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
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-error bg-error/10 px-2.5 py-1 rounded-full">
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
          <span className="text-[10px] text-text-muted px-2">-</span>
        )}
      </div>
    </div>
  );
}

/** 仕様値チップ: NGなら actual→expected を赤背景で表示 */
function SpecChip({
  value,
  failed,
}: {
  value: string;
  failed?: { rule: { value: string | number | boolean | number[] } };
}) {
  if (failed) {
    const expected =
      typeof failed.rule.value === "boolean"
        ? failed.rule.value
          ? "あり"
          : "なし"
        : String(failed.rule.value);
    return (
      <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-error bg-error/10 px-1.5 py-0.5 rounded flex-shrink-0">
        <span className="truncate max-w-[4rem]">{value}</span>
        <svg
          className="w-2.5 h-2.5 text-text-muted flex-shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
        </svg>
        <span className="text-success truncate max-w-[4rem]">{expected}</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center text-[11px] text-text-secondary bg-bg-tertiary px-1.5 py-0.5 rounded flex-shrink-0">
      {value}
    </span>
  );
}
