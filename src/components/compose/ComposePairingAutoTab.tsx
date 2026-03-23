import { useState, useMemo, useCallback } from "react";
import { useComposeStore } from "../../store/composeStore";
import type { PairingMode } from "../../types/replace";

interface Props {
  isReversed: boolean;
  onRescan: () => Promise<void>;
}

function getFileName(fullPath: string) {
  return fullPath.split(/[\\/]/).pop() || "";
}

function getBaseName(fullPath: string) {
  const name = fullPath.split(/[\\/]/).pop() || "";
  return name.replace(/\.(psd|psb|tif|tiff|jpg|jpeg|png|bmp|gif|eps|pdf)$/i, "");
}

function getPageNumber(fileName: string): number | null {
  const decoded = decodeURIComponent(fileName);
  const patterns = [
    /_p(\d+)/i,
    /page(?:[ _-])?(\d+)/i,
    /(?:^|[._-])(\d+)\.[a-z0-9]+$/i,
    /^(\d+)(?:[._-])/i,
    /(?:[._-])(\d+)(?=[._a-zA-Z-])/i,
    /(\d+)/,
  ];
  for (const pattern of patterns) {
    const match = decoded.match(pattern);
    if (match?.[1]) return parseInt(match[1], 10);
  }
  return null;
}

function getMatchKeyInfo(
  sourceName: string,
  targetName: string,
  pairIndex: number,
  mode: PairingMode,
  linkChar: string,
): { label: string; className: string } {
  switch (mode) {
    case "fileOrder":
      return { label: `#${pairIndex + 1}`, className: "text-text-muted/70 bg-white/5" };
    case "numericKey": {
      const srcNum = getPageNumber(sourceName);
      const tgtNum = getPageNumber(targetName);
      const isMatch = srcNum !== null && tgtNum !== null && srcNum === tgtNum;
      return {
        label: srcNum !== null ? `p${srcNum}` : "?",
        className: isMatch ? "text-accent bg-accent/10" : "text-warning bg-warning/10",
      };
    }
    case "linkCharManual":
    case "linkCharAuto": {
      if (linkChar) {
        const base = getBaseName(sourceName);
        const idx = base.indexOf(linkChar);
        const key = idx >= 0 ? base.substring(0, idx) : base;
        const display = key.length > 8 ? key.substring(0, 6) + "…" : key;
        return { label: display || linkChar, className: "text-success bg-success/10" };
      }
      return { label: "—", className: "text-text-muted bg-white/5" };
    }
  }
}

const PAIRING_MODES: { value: PairingMode; label: string; short: string }[] = [
  { value: "fileOrder", label: "ファイル順", short: "ファイル順" },
  { value: "numericKey", label: "数字キー", short: "数字" },
  { value: "linkCharManual", label: "リンク文字 (手動)", short: "リンク手動" },
  { value: "linkCharAuto", label: "リンク文字 (自動)", short: "リンク自動" },
];

export function ComposePairingAutoTab({ isReversed, onRescan }: Props) {
  const pairingJobs = useComposeStore((s) => s.pairingJobs);
  const excludedPairIndices = useComposeStore((s) => s.excludedPairIndices);
  const toggleExcludedPair = useComposeStore((s) => s.toggleExcludedPair);
  const scannedFileGroups = useComposeStore((s) => s.scannedFileGroups);
  const updatePairFile = useComposeStore((s) => s.updatePairFile);
  const addAutoPair = useComposeStore((s) => s.addAutoPair);
  const removeAutoPair = useComposeStore((s) => s.removeAutoPair);
  const pairingSettings = useComposeStore((s) => s.pairingSettings);
  const setPairingMode = useComposeStore((s) => s.setPairingMode);
  const setLinkCharacter = useComposeStore((s) => s.setLinkCharacter);
  const detectedLinkChar = useComposeStore((s) => s.detectedLinkChar);

  const [isRescanning, setIsRescanning] = useState(false);
  const [showUnmatched, setShowUnmatched] = useState(false);
  const [selectedUnmatched, setSelectedUnmatched] = useState<{
    side: "left" | "right";
    path: string;
  } | null>(null);
  const [editingPairIndex, setEditingPairIndex] = useState<number | null>(null);

  const totalPairsCount = pairingJobs.reduce((acc, job) => acc + job.pairs.length, 0);

  const allChecked = excludedPairIndices.size === 0;
  const noneChecked = excludedPairIndices.size === totalPairsCount;

  const handleToggleAll = () => {
    if (allChecked) {
      for (const job of pairingJobs) {
        for (const pair of job.pairs) {
          if (!excludedPairIndices.has(pair.pairIndex)) {
            toggleExcludedPair(pair.pairIndex);
          }
        }
      }
    } else {
      for (const job of pairingJobs) {
        for (const pair of job.pairs) {
          if (excludedPairIndices.has(pair.pairIndex)) {
            toggleExcludedPair(pair.pairIndex);
          }
        }
      }
    }
  };

  const allLeftFiles = useMemo(() => {
    if (isReversed) {
      return scannedFileGroups.flatMap((g) => g.targetFiles);
    }
    return scannedFileGroups.flatMap((g) => g.sourceFiles);
  }, [scannedFileGroups, isReversed]);

  const allRightFiles = useMemo(() => {
    if (isReversed) {
      return scannedFileGroups.flatMap((g) => g.sourceFiles);
    }
    return scannedFileGroups.flatMap((g) => g.targetFiles);
  }, [scannedFileGroups, isReversed]);

  const leftFilePairMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const job of pairingJobs) {
      for (const p of job.pairs) {
        const leftFile = isReversed ? p.targetFile : p.sourceFile;
        const rightName = isReversed ? p.sourceName : p.targetName;
        map.set(leftFile, rightName);
      }
    }
    return map;
  }, [pairingJobs, isReversed]);

  const rightFilePairMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const job of pairingJobs) {
      for (const p of job.pairs) {
        const rightFile = isReversed ? p.sourceFile : p.targetFile;
        const leftName = isReversed ? p.targetName : p.sourceName;
        map.set(rightFile, leftName);
      }
    }
    return map;
  }, [pairingJobs, isReversed]);

  const { unmatchedSource, unmatchedTarget } = useMemo(() => {
    const allPairedSource = new Set(pairingJobs.flatMap((j) => j.pairs.map((p) => p.sourceFile)));
    const allPairedTarget = new Set(pairingJobs.flatMap((j) => j.pairs.map((p) => p.targetFile)));
    const allSource = scannedFileGroups.flatMap((g) => g.sourceFiles);
    const allTarget = scannedFileGroups.flatMap((g) => g.targetFiles);

    return {
      unmatchedSource: allSource.filter((f) => !allPairedSource.has(f)),
      unmatchedTarget: allTarget.filter((f) => !allPairedTarget.has(f)),
    };
  }, [pairingJobs, scannedFileGroups]);

  const hasUnmatched = unmatchedSource.length > 0 || unmatchedTarget.length > 0;

  const unmatchedLeft = isReversed ? unmatchedTarget : unmatchedSource;
  const unmatchedRight = isReversed ? unmatchedSource : unmatchedTarget;

  const handleUnmatchedClick = useCallback(
    (side: "left" | "right", path: string) => {
      if (!selectedUnmatched) {
        setSelectedUnmatched({ side, path });
        return;
      }
      if (selectedUnmatched.side === side) {
        if (selectedUnmatched.path === path) {
          setSelectedUnmatched(null);
        } else {
          setSelectedUnmatched({ side, path });
        }
        return;
      }
      const leftPath = side === "left" ? path : selectedUnmatched.path;
      const rightPath = side === "right" ? path : selectedUnmatched.path;
      const sourceFile = isReversed ? rightPath : leftPath;
      const targetFile = isReversed ? leftPath : rightPath;
      addAutoPair(sourceFile, targetFile);
      setSelectedUnmatched(null);
    },
    [selectedUnmatched, isReversed, addAutoPair],
  );

  const handleFileChange = useCallback(
    (pairIndex: number, colSide: "left" | "right", newFile: string) => {
      const storeSide: "source" | "target" =
        colSide === "left" ? (isReversed ? "target" : "source") : isReversed ? "source" : "target";
      updatePairFile(pairIndex, storeSide, newFile, getFileName(newFile));
    },
    [isReversed, updatePairFile],
  );

  const renderFileCell = (
    pairIndex: number,
    colSide: "left" | "right",
    currentFile: string,
    currentName: string,
  ) => {
    const isEditing = editingPairIndex === pairIndex;
    const allFiles = colSide === "left" ? allLeftFiles : allRightFiles;
    const pairMap = colSide === "left" ? leftFilePairMap : rightFilePairMap;

    if (isEditing) {
      return (
        <td className="px-1.5 py-1">
          <select
            value={currentFile}
            onChange={(e) => handleFileChange(pairIndex, colSide, e.target.value)}
            className="w-full bg-bg-elevated border border-accent/30 rounded-lg px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent"
          >
            {allFiles.map((f) => {
              const pairedWith = pairMap.get(f);
              const isCurrent = f === currentFile;
              const isUnmatched = !pairedWith;
              const label = getFileName(f);
              return (
                <option key={f} value={f}>
                  {label}
                  {isCurrent ? " (現在)" : isUnmatched ? " *" : ` (↔ ${pairedWith})`}
                </option>
              );
            })}
          </select>
        </td>
      );
    }

    return (
      <td className="px-3 py-2 text-xs">
        <span className="text-text-primary truncate block max-w-[200px]" title={currentName}>
          {currentName}
        </span>
      </td>
    );
  };

  const handlePairingModeChange = useCallback(
    async (mode: PairingMode) => {
      setPairingMode(mode);
      setIsRescanning(true);
      try {
        await onRescan();
      } finally {
        setIsRescanning(false);
      }
    },
    [setPairingMode, onRescan],
  );

  const handleLinkCharChange = useCallback(
    async (char: string) => {
      setLinkCharacter(char);
      if (pairingSettings.mode === "linkCharManual" && char.length > 0) {
        setIsRescanning(true);
        try {
          await onRescan();
        } finally {
          setIsRescanning(false);
        }
      }
    },
    [setLinkCharacter, pairingSettings.mode, onRescan],
  );

  return (
    <div className="space-y-3">
      {/* Pairing Mode Selector */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="flex bg-bg-elevated rounded-lg p-0.5 border border-white/5 flex-1">
            {PAIRING_MODES.map((mode) => (
              <button
                key={mode.value}
                onClick={() => handlePairingModeChange(mode.value)}
                disabled={isRescanning}
                className={`flex-1 px-2 py-1.5 text-[11px] rounded-md transition-all whitespace-nowrap disabled:opacity-50 ${
                  pairingSettings.mode === mode.value
                    ? "bg-accent/20 text-accent font-medium shadow-sm border border-accent/25"
                    : "text-text-muted hover:text-text-secondary hover:bg-white/3 border border-transparent"
                }`}
              >
                {mode.short}
              </button>
            ))}
          </div>
          {isRescanning && (
            <div className="w-4 h-4 rounded-full border-2 border-accent/30 border-t-accent animate-spin flex-shrink-0" />
          )}
        </div>

        {pairingSettings.mode === "linkCharManual" && (
          <div className="flex items-center gap-2 pl-1">
            <label className="text-[10px] text-text-muted">リンク文字:</label>
            <input
              type="text"
              value={pairingSettings.linkCharacter}
              onChange={(e) => handleLinkCharChange(e.target.value)}
              placeholder="例: ★"
              className="w-24 bg-bg-elevated border border-white/10 rounded-lg px-2.5 py-1 text-xs text-text-primary focus:border-accent focus:outline-none"
            />
          </div>
        )}
      </div>

      {/* Match Summary Bar */}
      {allLeftFiles.length > 0 && (
        <div className="flex items-center gap-3 px-1">
          <div className="flex-1 bg-bg-elevated rounded-full h-1.5 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                totalPairsCount >= allLeftFiles.length
                  ? "bg-success"
                  : totalPairsCount > allLeftFiles.length * 0.5
                    ? "bg-accent"
                    : "bg-warning"
              }`}
              style={{ width: `${Math.min((totalPairsCount / allLeftFiles.length) * 100, 100)}%` }}
            />
          </div>
          <span
            className={`text-[10px] whitespace-nowrap ${
              totalPairsCount < allLeftFiles.length ? "text-warning" : "text-text-muted"
            }`}
          >
            {totalPairsCount}/{allLeftFiles.length} マッチ済み
          </span>
        </div>
      )}

      {/* Pair Table */}
      <div
        className={`border border-border rounded-xl overflow-hidden transition-opacity duration-200 ${isRescanning ? "opacity-50 pointer-events-none" : ""}`}
      >
        {isRescanning && (
          <div className="flex items-center justify-center py-2 bg-bg-tertiary/50 border-b border-border/50">
            <div className="w-3.5 h-3.5 rounded-full border-2 border-accent/30 border-t-accent animate-spin mr-2" />
            <span className="text-[10px] text-text-muted">再スキャン中...</span>
          </div>
        )}
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-bg-tertiary">
              <th className="px-2 py-2 text-center w-8">
                <input
                  type="checkbox"
                  checked={allChecked}
                  ref={(el) => {
                    if (el) el.indeterminate = !allChecked && !noneChecked;
                  }}
                  onChange={handleToggleAll}
                  className="w-3.5 h-3.5 rounded border-white/20 accent-accent"
                />
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium text-text-muted w-10">#</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-text-muted">
                {isReversed ? "原稿B" : "原稿A"}
              </th>
              <th className="px-3 py-2 text-center text-xs font-medium text-text-muted w-8">
                &nbsp;
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium text-text-muted">
                {isReversed ? "原稿A" : "原稿B"}
              </th>
              <th className="px-2 py-2 text-center text-[10px] font-medium text-text-muted w-10">
                編集
              </th>
              <th className="px-2 py-2 text-center text-[10px] font-medium text-text-muted w-10">
                解除
              </th>
            </tr>
          </thead>
          <tbody>
            {pairingJobs.map((job, jobIdx) => (
              <>
                {pairingJobs.length > 1 && (
                  <tr key={`job-${jobIdx}`}>
                    <td
                      colSpan={7}
                      className="px-3 py-1.5 bg-accent/5 text-[10px] font-medium text-accent"
                    >
                      {job.description}
                    </td>
                  </tr>
                )}
                {job.pairs.map((pair) => {
                  const isExcluded = excludedPairIndices.has(pair.pairIndex);
                  const leftFile = isReversed ? pair.targetFile : pair.sourceFile;
                  const leftName = isReversed ? pair.targetName : pair.sourceName;
                  const rightFile = isReversed ? pair.sourceFile : pair.targetFile;
                  const rightName = isReversed ? pair.sourceName : pair.targetName;

                  const matchKey = getMatchKeyInfo(
                    pair.sourceName,
                    pair.targetName,
                    pair.pairIndex,
                    pairingSettings.mode,
                    pairingSettings.mode === "linkCharManual"
                      ? pairingSettings.linkCharacter
                      : detectedLinkChar || "",
                  );

                  return (
                    <tr
                      key={pair.pairIndex}
                      className={`border-t border-border/50 hover:bg-bg-tertiary/50 transition-opacity ${
                        isExcluded ? "opacity-40" : ""
                      }`}
                    >
                      <td className="px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={!isExcluded}
                          onChange={() => toggleExcludedPair(pair.pairIndex)}
                          className="w-3.5 h-3.5 rounded border-white/20 accent-accent"
                        />
                      </td>
                      <td className="px-3 py-2 text-xs text-text-muted">{pair.pairIndex + 1}</td>
                      {renderFileCell(pair.pairIndex, "left", leftFile, leftName)}
                      <td className="px-1 py-2 text-center">
                        <div className="flex flex-col items-center gap-0.5">
                          <svg
                            className="w-3 h-3 text-text-muted"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M13 7l5 5m0 0l-5 5m5-5H6"
                            />
                          </svg>
                          <span
                            className={`text-[8px] leading-none px-1 py-0.5 rounded ${matchKey.className}`}
                            title={`マッチキー: ${matchKey.label}`}
                          >
                            {matchKey.label}
                          </span>
                        </div>
                      </td>
                      {renderFileCell(pair.pairIndex, "right", rightFile, rightName)}
                      <td className="px-1 py-2 text-center">
                        <button
                          onClick={() =>
                            setEditingPairIndex(
                              editingPairIndex === pair.pairIndex ? null : pair.pairIndex,
                            )
                          }
                          className={`p-1 rounded transition-colors ${
                            editingPairIndex === pair.pairIndex
                              ? "text-accent bg-accent/15"
                              : "text-text-muted/50 hover:text-accent hover:bg-accent/10"
                          }`}
                          title="ペアを編集"
                        >
                          <svg
                            className="w-3.5 h-3.5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z"
                            />
                          </svg>
                        </button>
                      </td>
                      <td className="px-1 py-2 text-center">
                        <button
                          onClick={() => removeAutoPair(pair.pairIndex)}
                          className="p-1 rounded text-text-muted/40 hover:text-error hover:bg-error/10 transition-colors"
                          title="ペアリング解除"
                        >
                          <svg
                            className="w-3.5 h-3.5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2.5}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M6 18L18 6M6 6l12 12"
                            />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {/* Unmatched Files */}
      {hasUnmatched && (
        <div className="rounded-xl border border-border overflow-hidden">
          <button
            onClick={() => {
              setShowUnmatched(!showUnmatched);
              if (showUnmatched) setSelectedUnmatched(null);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-muted hover:text-text-secondary transition-colors"
          >
            <svg
              className={`w-3 h-3 transition-transform ${showUnmatched ? "rotate-90" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            <span>
              未マッチ ({isReversed ? "原稿B" : "原稿A"} {unmatchedLeft.length},{" "}
              {isReversed ? "原稿A" : "原稿B"} {unmatchedRight.length})
            </span>
          </button>

          {showUnmatched && (
            <div className="px-3 pb-3 space-y-2">
              {selectedUnmatched && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-accent/10 rounded-lg border border-accent/20">
                  <svg
                    className="w-3 h-3 text-accent flex-shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M13 7l5 5m0 0l-5 5m5-5H6"
                    />
                  </svg>
                  <span className="text-[10px] text-accent">
                    「{getFileName(selectedUnmatched.path)}」を選択中 —{" "}
                    {selectedUnmatched.side === "left" ? "右" : "左"}列をクリックしてペア作成
                  </span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[10px] text-text-muted font-medium mb-1 px-1">
                    {isReversed ? "原稿B" : "原稿A"} ({unmatchedLeft.length})
                  </div>
                  <div className="border border-border/50 rounded-lg overflow-hidden">
                    <div className="max-h-[150px] overflow-y-auto p-1 space-y-0.5">
                      {unmatchedLeft.length > 0 ? (
                        unmatchedLeft.map((path) => {
                          const isSelected =
                            selectedUnmatched?.side === "left" && selectedUnmatched?.path === path;
                          return (
                            <div
                              key={path}
                              onClick={() => handleUnmatchedClick("left", path)}
                              className={`
                                px-2 py-1 text-[11px] rounded cursor-pointer transition-all select-none truncate
                                ${
                                  isSelected
                                    ? "ring-1 ring-accent bg-accent/10 text-accent"
                                    : "text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
                                }
                              `}
                              title={getFileName(path)}
                            >
                              {getFileName(path)}
                            </div>
                          );
                        })
                      ) : (
                        <div className="text-[10px] text-text-muted text-center py-3">なし</div>
                      )}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="text-[10px] text-text-muted font-medium mb-1 px-1">
                    {isReversed ? "原稿A" : "原稿B"} ({unmatchedRight.length})
                  </div>
                  <div className="border border-border/50 rounded-lg overflow-hidden">
                    <div className="max-h-[150px] overflow-y-auto p-1 space-y-0.5">
                      {unmatchedRight.length > 0 ? (
                        unmatchedRight.map((path) => {
                          const isSelected =
                            selectedUnmatched?.side === "right" && selectedUnmatched?.path === path;
                          return (
                            <div
                              key={path}
                              onClick={() => handleUnmatchedClick("right", path)}
                              className={`
                                px-2 py-1 text-[11px] rounded cursor-pointer transition-all select-none truncate
                                ${
                                  isSelected
                                    ? "ring-1 ring-accent bg-accent/10 text-accent"
                                    : "text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
                                }
                              `}
                              title={getFileName(path)}
                            >
                              {getFileName(path)}
                            </div>
                          );
                        })
                      ) : (
                        <div className="text-[10px] text-text-muted text-center py-3">なし</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
