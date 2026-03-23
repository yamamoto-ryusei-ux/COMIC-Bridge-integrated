import { useState, useCallback } from "react";
import { usePsdStore } from "../../store/psdStore";
import { invoke } from "@tauri-apps/api/core";
import { desktopDir } from "@tauri-apps/api/path";
import type { LayerNode, PsdFile } from "../../types";

/**
 * テキスト抽出フローティングボタン
 * PSDファイルのテキストレイヤーからテキストを抽出し、COMIC-POT互換フォーマットで保存する
 */
export function TextExtractButton({ compact = false }: { compact?: boolean }) {
  const files = usePsdStore((s) => s.files);
  const [isExtracting, setIsExtracting] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [sortMode, setSortMode] = useState<"bottomToTop" | "topToBottom">("bottomToTop");
  const [includeHidden, setIncludeHidden] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
    filePath?: string;
  } | null>(null);

  const psdFiles = files.filter((f) => f.metadata?.layerTree?.length);

  const handleExtract = useCallback(async () => {
    if (psdFiles.length === 0) return;
    setIsExtracting(true);
    setResult(null);
    setShowOptions(false);

    try {
      const output = generateText(psdFiles, sortMode, includeHidden);

      // フォルダ名を取得（最初のファイルの親フォルダ）
      const firstPath = psdFiles[0].filePath.replace(/\//g, "\\");
      const parts = firstPath.split("\\");
      const folderName = parts[parts.length - 2] || "extracted";

      // 出力先: Desktop/Script_Output/テキスト抽出/
      const desktop = await desktopDir();
      const outputDir = `${desktop}\\Script_Output\\テキスト抽出`;

      // フォルダ作成
      await invoke("list_folder_contents", { folderPath: outputDir }).catch(async () => {
        // フォルダが存在しない場合は作成（親→子の順）
        const scriptOutput = `${desktop}\\Script_Output`;
        await invoke("write_text_file", {
          filePath: `${scriptOutput}\\.keep`,
          content: "",
        }).catch(() => {});
        await invoke("write_text_file", {
          filePath: `${outputDir}\\.keep`,
          content: "",
        }).catch(() => {});
      });

      // ファイル名（重複回避）
      const baseName = `${folderName}`;
      let fileName = `${baseName}.txt`;
      const exists = await invoke<boolean>("path_exists", { path: `${outputDir}\\${fileName}` });
      if (exists) {
        const now = new Date();
        const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
        fileName = `${baseName}_${ts}.txt`;
      }

      const filePath = `${outputDir}\\${fileName}`;
      await invoke("write_text_file", { filePath, content: output });

      setResult({
        success: true,
        message: `${fileName} に保存しました`,
        filePath,
      });

      // 出力フォルダを開く
      await invoke("open_folder_in_explorer", { folderPath: outputDir }).catch(() => {});
    } catch (err) {
      setResult({
        success: false,
        message: `エラー: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setIsExtracting(false);
    }
  }, [psdFiles, sortMode, includeHidden]);

  if (psdFiles.length === 0) return null;

  return (
    <>
      <div className="relative">
        {/* オプションポップオーバー */}
        {showOptions && (
          <div
            className="absolute bottom-full right-0 mb-3 w-72 bg-white rounded-xl shadow-elevated border border-border p-4 space-y-3"
            style={{ animation: "toast-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)" }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-medium text-text-primary">テキスト抽出設定</p>

            {/* ソート順 */}
            <div className="space-y-1.5">
              <label className="text-xs text-text-muted">レイヤー順序</label>
              <div className="flex rounded-lg border border-border overflow-hidden">
                <button
                  className={`flex-1 px-3 py-1.5 text-xs font-medium transition-colors ${
                    sortMode === "bottomToTop"
                      ? "bg-accent/10 text-accent border-r border-border"
                      : "text-text-secondary hover:bg-bg-tertiary border-r border-border"
                  }`}
                  onClick={() => setSortMode("bottomToTop")}
                >
                  下→上
                </button>
                <button
                  className={`flex-1 px-3 py-1.5 text-xs font-medium transition-colors ${
                    sortMode === "topToBottom"
                      ? "bg-accent/10 text-accent"
                      : "text-text-secondary hover:bg-bg-tertiary"
                  }`}
                  onClick={() => setSortMode("topToBottom")}
                >
                  上→下
                </button>
              </div>
            </div>

            {/* 非表示レイヤー */}
            <label className="flex items-center gap-2 cursor-pointer">
              <div
                role="checkbox"
                aria-checked={includeHidden}
                tabIndex={0}
                className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                  includeHidden ? "bg-accent border-accent" : "border-border hover:border-accent/50"
                }`}
                onClick={() => setIncludeHidden(!includeHidden)}
                onKeyDown={(e) => {
                  if (e.key === " " || e.key === "Enter") setIncludeHidden(!includeHidden);
                }}
              >
                {includeHidden && (
                  <svg
                    className="w-3 h-3 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={3}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
              <span className="text-xs text-text-secondary">非表示レイヤーも含める</span>
            </label>

            {/* 実行ボタン */}
            <button
              className="w-full px-4 py-2 text-sm font-bold rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors active:scale-[0.97]"
              onClick={handleExtract}
            >
              抽出を実行
            </button>
          </div>
        )}

        {/* メインボタン */}
        <button
          className={`${compact ? "h-11 min-w-[150px] px-5 text-sm" : "h-16 min-w-[220px] px-8 text-lg"} font-bold rounded-2xl shadow-2xl transition-all duration-200 flex items-center justify-center gap-2 whitespace-nowrap bg-bg-secondary border-2 border-[#7c5cff]/40 text-[#7c5cff] hover:bg-bg-elevated hover:border-[#7c5cff]/60 hover:shadow-[0_4px_16px_rgba(124,92,255,0.25)] active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed`}
          onClick={() => {
            setResult(null);
            setShowOptions(!showOptions);
          }}
          disabled={isExtracting}
          title="テキストレイヤーの内容を抽出してテキストファイルに保存"
        >
          {isExtracting ? (
            <>
              <div
                className={`${compact ? "w-4 h-4" : "w-5 h-5"} rounded-full border-2 border-[#7c5cff]/30 border-t-[#7c5cff] animate-spin`}
              />
              <span className={compact ? "text-xs" : "text-base"}>抽出中...</span>
            </>
          ) : (
            <>
              <svg
                className={compact ? "w-4 h-4" : "w-5 h-5"}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 3v5a1 1 0 001 1h5" />
              </svg>
              テキスト抽出
              <span
                className={`${compact ? "px-1.5 py-0.5 text-xs" : "px-2 py-1 text-sm"} rounded-lg bg-[#7c5cff]/10 text-[#7c5cff] font-bold`}
              >
                {psdFiles.length}
              </span>
            </>
          )}
        </button>
      </div>

      {/* 結果トースト */}
      {result && (
        <div
          className={`px-4 py-2 rounded-xl border text-xs max-w-xs ${
            result.success
              ? "bg-success/10 border-success/30 text-success"
              : "bg-error/10 border-error/30 text-error"
          }`}
          style={{ animation: "toast-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)" }}
        >
          {result.message}
          {result.success && result.filePath && (
            <button
              onClick={async () => {
                try {
                  await invoke("launch_progen", { handoffTextPath: result.filePath });
                } catch (err) {
                  console.error("ProGen launch failed:", err);
                }
              }}
              className="ml-2 px-2 py-0.5 rounded bg-accent-secondary/20 text-accent-secondary hover:bg-accent-secondary/30 transition-colors font-medium"
            >
              ProGenへ
            </button>
          )}
          <button onClick={() => setResult(null)} className="ml-2 underline">
            閉じる
          </button>
        </div>
      )}
    </>
  );
}

// ===== ヘルパー関数 =====

/**
 * テキストレイヤーを再帰的に収集する
 * ag-psdのlayerTreeはtop-to-bottom順で格納されている
 */
function collectTextLayers(
  layers: LayerNode[],
  includeHidden: boolean,
): { text: string; name: string; visible: boolean }[] {
  const result: { text: string; name: string; visible: boolean }[] = [];

  for (const layer of layers) {
    if (layer.type === "text" && layer.textInfo?.text) {
      const content = layer.textInfo.text.trim();
      if (content.length > 0) {
        if (includeHidden || layer.visible) {
          // ルビレイヤーを除外: 名前が「文字（ふりがな）」パターン
          if (!/^.+（.+）$/.test(layer.name)) {
            result.push({
              text: content,
              name: layer.name,
              visible: layer.visible,
            });
          }
        }
      }
    }

    // グループの子レイヤーを再帰処理
    if (layer.children?.length) {
      result.push(...collectTextLayers(layer.children, includeHidden));
    }
  }

  return result;
}

/**
 * COMIC-POT互換フォーマットでテキストを生成
 */
function generateText(
  files: PsdFile[],
  sortMode: "bottomToTop" | "topToBottom",
  includeHidden: boolean,
): string {
  const lines: string[] = [];

  // ヘッダー
  lines.push(`[COMIC-POT:${sortMode}]`);
  lines.push("[01巻]");

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const pageNum = i + 1;
    lines.push(`<<${pageNum}Page>>`);

    if (!file.metadata?.layerTree) {
      lines.push("");
      continue;
    }

    // ag-psdのlayerTreeはtop-to-bottom順
    // bottomToTopの場合はreverseして下から上へ
    let textLayers = collectTextLayers(file.metadata.layerTree, includeHidden);
    if (sortMode === "bottomToTop") {
      textLayers.reverse();
    }

    if (textLayers.length === 0) {
      lines.push("");
      continue;
    }

    for (const entry of textLayers) {
      lines.push(entry.text);
      lines.push("");
    }
  }

  return lines.join("\n");
}
