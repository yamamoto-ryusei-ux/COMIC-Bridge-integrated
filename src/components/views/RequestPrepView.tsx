import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { desktopDir } from "@tauri-apps/api/path";
import { useScanPsdStore } from "../../features/scan-psd/scanPsdStore";
import { useUnifiedViewerStore } from "../../store/unifiedViewerStore";
import { GENRE_LABELS } from "../../types/scanPsd";

type RequestMode = "ingest" | "proof" | "whiteout";

const NG_WORD_LIST_BASE = "G:\\共有ドライブ\\CLLENN\\編集部フォルダ\\編集企画部\\編集企画_C班(AT業務推進)\\ナレッジ企画\\統一表記、NGワードリスト";
const NG_WORD_FILE = "G:\\共有ドライブ\\CLLENN\\編集部フォルダ\\編集企画部\\編集企画_C班(AT業務推進)\\ナレッジ企画\\統一表記、NGワードリスト\\NGワード_CLLENN（20241024現在）.xlsx";

interface AddedItem {
  path: string;
  name: string;
  isFolder: boolean;
  detected: { hasTxt: boolean; hasPsd: boolean; hasImage: boolean; hasPdf: boolean };
}

async function detectContentsDeep(path: string, isFolder: boolean): Promise<AddedItem["detected"]> {
  const result = { hasTxt: false, hasPsd: false, hasImage: false, hasPdf: false };
  if (!isFolder) {
    const ext = path.substring(path.lastIndexOf(".") + 1).toLowerCase();
    if (ext === "txt") result.hasTxt = true;
    else if (ext === "psd" || ext === "psb") result.hasPsd = true;
    else if (ext === "pdf") result.hasPdf = true;
    else if (["jpg", "jpeg", "png", "tif", "tiff", "bmp", "gif"].includes(ext)) result.hasImage = true;
    return result;
  }
  async function scan(dir: string) {
    try {
      const files = await invoke<string[]>("list_all_files", { folderPath: dir });
      for (const f of files) {
        if (f === ".keep") continue;
        const ext = f.substring(f.lastIndexOf(".") + 1).toLowerCase();
        if (ext === "txt") result.hasTxt = true;
        else if (ext === "psd" || ext === "psb") result.hasPsd = true;
        else if (ext === "pdf") result.hasPdf = true;
        else if (["jpg", "jpeg", "png", "tif", "tiff", "bmp", "gif"].includes(ext)) result.hasImage = true;
      }
      const contents = await invoke<{ folders: string[]; json_files: string[] }>("list_folder_contents", { folderPath: dir });
      for (const sub of contents.folders) await scan(`${dir}\\${sub}`);
    } catch { /* ignore */ }
  }
  await scan(path);
  return result;
}

function extractNumber(path: string): string {
  const name = path.replace(/\\/g, "/").split("/").pop() || "";
  const match = name.match(/(\d+)/);
  return match ? match[1] : "";
}

export function RequestPrepView() {
  const [mode, setMode] = useState<RequestMode>("ingest");
  // 原稿入稿/白棒消し用
  const [items, setItems] = useState<AddedItem[]>([]);
  // 外部校正用
  const [proofPdf, setProofPdf] = useState("");
  const [proofTxt, setProofTxt] = useState("");
  const [proofGenre, setProofGenre] = useState("");
  const [proofLabel, setProofLabel] = useState("");
  const [proofNotationFile, setProofNotationFile] = useState("");
  const [proofNgFile] = useState(NG_WORD_FILE);
  const [labelFiles, setLabelFiles] = useState<string[]>([]);

  const [zipName, setZipName] = useState("");
  const [status, setStatus] = useState<{ type: "idle" | "success" | "error"; msg: string }>({ type: "idle", msg: "" });
  const [processing, setProcessing] = useState(false);
  const [showWfComplete, setShowWfComplete] = useState(false);

  const scanWorkInfo = useScanPsdStore((s) => s.workInfo);
  const scanJsonPath = useScanPsdStore((s) => s.currentJsonFilePath);
  const presetJsonPath = useUnifiedViewerStore((s) => s.presetJsonPath);

  // 統合チェック
  const hasText = items.some((i) => i.detected.hasTxt);
  const hasSample = items.some((i) => i.detected.hasImage || i.detected.hasPdf);
  const hasManuscript = items.some((i) => i.detected.hasPsd);
  const psdItem = items.find((i) => i.detected.hasPsd);
  const detectedVolume = psdItem ? extractNumber(psdItem.path) : "";

  // ZIP名自動生成
  useEffect(() => {
    const today = new Date();
    const yyyymmdd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
    const genre = scanWorkInfo.genre || "";
    let title = scanWorkInfo.title || "";
    if (!title) {
      const jp = scanJsonPath || presetJsonPath || "";
      if (jp) title = (jp.replace(/\\/g, "/").split("/").pop() || "").replace(/\.json$/i, "");
    }
    const vol = detectedVolume || "1";
    if (genre || title) setZipName(`${yyyymmdd}_${genre || "ジャンル"}_${title || "タイトル"}_${vol}巻`);
    else setZipName(`${yyyymmdd}_依頼データ`);
  }, [scanWorkInfo, scanJsonPath, presetJsonPath, detectedVolume, items]);

  // レーベル選択時: 統一表記ファイルを自動検索
  useEffect(() => {
    if (!proofLabel) return;
    (async () => {
      try {
        const files = await invoke<string[]>("list_all_files", { folderPath: NG_WORD_LIST_BASE });
        const matched = files.filter((f) => f.toLowerCase().includes(proofLabel.toLowerCase()));
        setLabelFiles(matched);
        const notation = matched.find((f) => !f.includes("NGワード") && (f.endsWith(".xlsx") || f.endsWith(".xls")));
        if (notation) setProofNotationFile(`${NG_WORD_LIST_BASE}\\${notation}`);
      } catch { /* ignore */ }
    })();
  }, [proofLabel]);

  // ジャンル/レーベル初期値（JSONから）
  useEffect(() => {
    if (scanWorkInfo.genre && !proofGenre) setProofGenre(scanWorkInfo.genre);
    if (scanWorkInfo.label && !proofLabel) setProofLabel(scanWorkInfo.label);
  }, [scanWorkInfo.genre, scanWorkInfo.label]);

  // WFからの自動フォルダ読み込み + モード・ジャンル・レーベル自動設定
  useEffect(() => {
    try {
      const autoFolder = localStorage.getItem("requestPrep_autoFolder");
      if (autoFolder) {
        localStorage.removeItem("requestPrep_autoFolder");
        (async () => {
          const detected = await detectContentsDeep(autoFolder, true);
          const name = autoFolder.replace(/\\/g, "/").split("/").pop() || "";
          setItems([{ path: autoFolder, name, isFolder: true, detected }]);
        })();
      }
      const autoMode = localStorage.getItem("requestPrep_autoMode");
      if (autoMode) {
        localStorage.removeItem("requestPrep_autoMode");
        if (autoMode === "external") setMode("proof");
        else if (autoMode === "whiteout") setMode("whiteout");
      }
      const autoGenre = localStorage.getItem("requestPrep_autoGenre");
      if (autoGenre) { setProofGenre(autoGenre); localStorage.removeItem("requestPrep_autoGenre"); }
      const autoLabel = localStorage.getItem("requestPrep_autoLabel");
      if (autoLabel) { setProofLabel(autoLabel); localStorage.removeItem("requestPrep_autoLabel"); }
      const autoTitle = localStorage.getItem("requestPrep_autoTitle");
      if (autoTitle) { localStorage.removeItem("requestPrep_autoTitle"); }
    } catch { /* ignore */ }
  }, []);

  // フォルダ追加
  const handleAddFolder = useCallback(async () => {
    const folder = await dialogOpen({ directory: true, multiple: false, title: "フォルダを選択" });
    if (!folder) return;
    const detected = await detectContentsDeep(folder as string, true);
    const name = (folder as string).replace(/\\/g, "/").split("/").pop() || "";
    setItems((prev) => [...prev, { path: folder as string, name, isFolder: true, detected }]);
  }, []);

  const handleAddFile = useCallback(async () => {
    const file = await dialogOpen({ directory: false, multiple: true, title: "ファイルを選択",
      filters: [{ name: "対応ファイル", extensions: ["pdf", "psd", "txt", "jpg", "jpeg", "png", "tif", "tiff"] }] });
    if (!file) return;
    const paths = Array.isArray(file) ? file : [file];
    for (const p of paths) {
      const detected = await detectContentsDeep(p as string, false);
      const name = (p as string).replace(/\\/g, "/").split("/").pop() || "";
      setItems((prev) => [...prev, { path: p as string, name, isFolder: false, detected }]);
    }
  }, []);

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text?.trim()) return;
      const path = text.trim();
      const isFolder = !/\.\w{1,5}$/.test(path);
      const detected = await detectContentsDeep(path, isFolder);
      const name = path.replace(/\\/g, "/").split("/").pop() || "";
      setItems((prev) => [...prev, { path, name, isFolder, detected }]);
    } catch { /* ignore */ }
  }, []);

  const handleRemove = useCallback((idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx)), []);

  // 外部校正用のファイル選択
  const selectFile = async (setter: (v: string) => void, title: string, exts?: string[]) => {
    const file = await dialogOpen({ directory: false, multiple: false, title, filters: exts ? [{ name: "ファイル", extensions: exts }] : undefined });
    if (file) setter(file as string);
  };

  // ZIP実行
  const handleExecute = useCallback(async () => {
    let sourcePaths: string[] = [];
    if (mode === "proof") {
      if (proofPdf) sourcePaths.push(proofPdf);
      if (proofTxt) sourcePaths.push(proofTxt);
      if (proofNotationFile) sourcePaths.push(proofNotationFile);
      if (proofNgFile) sourcePaths.push(proofNgFile);
    } else {
      sourcePaths = items.map((i) => i.path);
    }
    if (sourcePaths.length === 0) { setStatus({ type: "error", msg: "ファイルを追加してください" }); return; }
    if (!zipName) { setStatus({ type: "error", msg: "ZIP名を入力してください" }); return; }
    setProcessing(true);
    setStatus({ type: "idle", msg: "ZIP作成中..." });
    let tempFolderToCleanup: string | null = null;
    try {
      const desktop = (await desktopDir()).replace(/[\\/]$/, "") + "\\";
      let outputDir = desktop;
      // 原稿入稿・白棒消しモードはzipName名のサブフォルダ内に保存
      if (mode === "ingest" || mode === "whiteout") {
        const safeFolder = zipName.replace(/[\\/:*?"<>|]/g, "_");
        outputDir = `${desktop}${safeFolder}\\`;
        await invoke("create_directory", { path: outputDir }).catch(() => {});
      }

      // テキスト置換/追加: 読み込み済みテキストがある場合
      // 元データは触らず、一時コピーしてテキストを差し替え(or 追加)してからZIP化
      const viewerState = useUnifiedViewerStore.getState();
      const viewerText = viewerState.textContent;
      const viewerTextPath = viewerState.textFilePath;
      // ビューアーのファイル名（例: foo.txt）。無い場合は "text.txt" をデフォルトに
      const viewerTextFileName = viewerTextPath
        ? (viewerTextPath.replace(/\\/g, "/").split("/").pop() || "text.txt")
        : "text.txt";
      const needTextHandling = mode !== "proof" && !!viewerText;
      if (needTextHandling) {
        const tempDir = `${desktop}__temp_zip_${Date.now()}`;
        tempFolderToCleanup = tempDir;
        await invoke("create_directory", { path: tempDir });
        const newSourcePaths: string[] = [];
        for (const item of items) {
          const destPath = `${tempDir}\\${item.name}`;
          if (item.isFolder) {
            await invoke<number>("copy_folder", { source: item.path, destination: destPath });
            // フォルダ内のTXTファイルを全階層再帰的に削除（Rust側で一括処理）
            // 注意: 一時コピーに対してのみ削除するため、元ファイルは無変更
            const deletedCount = await invoke<number>("delete_files_by_extension_recursive", {
              folderPath: destPath,
              extensions: ["txt"],
            }).catch((e) => {
              console.error("[delete_files_by_extension_recursive] failed:", e);
              return 0;
            });
            console.log(`[RequestPrep] 削除したTXTファイル数: ${deletedCount} in ${destPath}`);
            // ビューアーのテキストを新規ファイルとして追加
            // 配置先: item 直下（例: 1_原稿/{viewerTextFileName}.txt）
            await invoke("write_text_file", {
              filePath: `${destPath}\\${viewerTextFileName}`,
              content: viewerText,
            });
          } else {
            // 個別ファイル: TXT は ZIP に含めずスキップ、それ以外はコピー
            const ext = item.path.substring(item.path.lastIndexOf(".") + 1).toLowerCase();
            if (ext === "txt") {
              // 既存TXT は ZIP から除外（スキップ）
              continue;
            }
            await invoke<number>("copy_folder", { source: item.path, destination: destPath });
          }
          newSourcePaths.push(destPath);
        }
        // ビューアーテキストを単独ファイルとして一時フォルダに配置（個別ファイルモード時）
        if (items.every((i) => !i.isFolder)) {
          const txtPath = `${tempDir}\\${viewerTextFileName}`;
          await invoke("write_text_file", { filePath: txtPath, content: viewerText });
          newSourcePaths.push(txtPath);
        }
        sourcePaths = newSourcePaths;
      }

      const zipPath = await invoke<string>("create_zip", { outputDir, zipName, sourcePaths });
      setStatus({ type: "success", msg: `作成完了: ${zipPath}` });
      await invoke("open_folder_in_explorer", { folderPath: outputDir }).catch(() => {});
      // WF進行中なら完了確認ポップアップ
      const { useWorkflowStore } = await import("../../store/workflowStore");
      if (useWorkflowStore.getState().activeWorkflow) {
        setShowWfComplete(true);
      }
    } catch (e) { setStatus({ type: "error", msg: `エラー: ${String(e)}` }); }
    // 一時フォルダのクリーンアップ
    if (tempFolderToCleanup) {
      try { await invoke("delete_file", { filePath: tempFolderToCleanup }); } catch { /* ignore */ }
    }
    setProcessing(false);
  }, [items, zipName, mode, proofPdf, proofTxt, proofNotationFile, proofNgFile]);

  // チェック
  const ingestChecks = [hasText, hasSample, hasManuscript];
  const ingestLabels = ["テキスト", "見本（画像/PDF）", "原稿（PSD）"];
  const proofOk = !!(proofPdf && proofNotationFile);
  const whiteoutOk = hasManuscript;

  return (
    <div className="h-full flex flex-col bg-bg-primary overflow-auto">
      <div className="max-w-[600px] mx-auto w-full p-6 space-y-4">
        <div>
          <h1 className="text-lg font-bold text-text-primary">依頼準備</h1>
          <p className="text-xs text-text-muted mt-1">ファイル/フォルダをまとめてZIPに圧縮</p>
        </div>

        {/* モード選択 */}
        <div className="flex gap-2">
          {([
            { id: "ingest" as const, label: "原稿入稿" },
            { id: "proof" as const, label: "外部校正" },
            { id: "whiteout" as const, label: "白棒消し" },
          ]).map((m) => (
            <button key={m.id} onClick={() => setMode(m.id)}
              className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${mode === m.id ? "bg-accent/15 text-accent border border-accent/30" : "bg-bg-tertiary text-text-secondary border border-border/50 hover:bg-bg-elevated"}`}>
              {m.label}
            </button>
          ))}
        </div>

        {/* ═══ 外部校正モード ═══ */}
        {mode === "proof" && (
          <div className="space-y-3">
            {/* PDF */}
            <div className="p-3 rounded-xl bg-bg-secondary border border-border space-y-1">
              <span className="text-[10px] font-medium text-text-primary">見開きPDF</span>
              <div className="flex gap-1.5">
                <input type="text" value={proofPdf} onChange={(e) => setProofPdf(e.target.value)}
                  className="flex-1 text-[10px] px-2 py-1.5 bg-bg-primary border border-border/50 rounded text-text-primary outline-none font-mono" placeholder="PDFファイル" />
                <button onClick={() => selectFile(setProofPdf, "PDF選択", ["pdf"])} className="px-2 py-1 text-[9px] bg-bg-tertiary border border-border/50 rounded hover:bg-bg-elevated text-text-secondary">参照</button>
              </div>
            </div>
            {/* テキスト */}
            <div className="p-3 rounded-xl bg-bg-secondary border border-border space-y-1">
              <span className="text-[10px] font-medium text-text-primary">セリフテキスト</span>
              <div className="flex gap-1.5">
                <input type="text" value={proofTxt} onChange={(e) => setProofTxt(e.target.value)}
                  className="flex-1 text-[10px] px-2 py-1.5 bg-bg-primary border border-border/50 rounded text-text-primary outline-none font-mono" placeholder="テキストファイル" />
                <button onClick={() => selectFile(setProofTxt, "テキスト選択", ["txt"])} className="px-2 py-1 text-[9px] bg-bg-tertiary border border-border/50 rounded hover:bg-bg-elevated text-text-secondary">参照</button>
              </div>
            </div>
            {/* ジャンル → レーベル → 統一表記 */}
            <div className="p-3 rounded-xl bg-bg-secondary border border-border space-y-2">
              <span className="text-[10px] font-medium text-text-primary">ジャンル / レーベル → 統一表記表</span>
              <div className="flex gap-2">
                <select value={proofGenre} onChange={(e) => { setProofGenre(e.target.value); setProofLabel(""); }}
                  className="flex-1 text-[10px] px-2 py-1.5 bg-bg-primary border border-border/50 rounded text-text-primary outline-none">
                  <option value="">ジャンル選択</option>
                  {Object.keys(GENRE_LABELS).map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
                <select value={proofLabel} onChange={(e) => setProofLabel(e.target.value)}
                  className="flex-1 text-[10px] px-2 py-1.5 bg-bg-primary border border-border/50 rounded text-text-primary outline-none"
                  disabled={!proofGenre}>
                  <option value="">レーベル選択</option>
                  {(GENRE_LABELS[proofGenre] || []).map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              {proofNotationFile && (
                <div className="text-[9px] text-success font-mono truncate">✓ {proofNotationFile.split("\\").pop()}</div>
              )}
              {labelFiles.length > 0 && !proofNotationFile && (
                <div className="text-[9px] text-warning">検索結果: {labelFiles.join(", ")}</div>
              )}
            </div>
            {/* NGワード */}
            <div className="p-3 rounded-xl bg-bg-secondary border border-border space-y-1">
              <span className="text-[10px] font-medium text-text-primary">NGワード表</span>
              <div className="text-[9px] text-text-muted font-mono truncate">{proofNgFile.split("\\").pop()}</div>
            </div>
            {/* チェック */}
            <div className={`p-3 rounded-xl border ${proofOk ? "bg-success/5 border-success/20" : "bg-warning/5 border-warning/20"}`}>
              <div className="flex gap-2 flex-wrap">
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${proofPdf ? "bg-success/15 text-success" : "bg-error/15 text-error"}`}>{proofPdf ? "✓" : "✗"} PDF</span>
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${proofTxt ? "bg-success/15 text-success" : "bg-error/15 text-error"}`}>{proofTxt ? "✓" : "✗"} テキスト</span>
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${proofNotationFile ? "bg-success/15 text-success" : "bg-error/15 text-error"}`}>{proofNotationFile ? "✓" : "✗"} 統一表記表</span>
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${proofNgFile ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>{proofNgFile ? "✓" : "—"} NGワード</span>
              </div>
            </div>
          </div>
        )}

        {/* ═══ 原稿入稿 / 白棒消し ═══ */}
        {mode !== "proof" && (
          <>
            <div className="flex gap-2">
              <button onClick={handleAddFolder} className="flex-1 py-2 rounded-lg text-xs font-medium bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors">+ フォルダ追加</button>
              <button onClick={handleAddFile} className="px-4 py-2 rounded-lg text-xs bg-bg-tertiary border border-border/50 hover:bg-bg-elevated text-text-secondary">+ PDF/ファイル</button>
              <button onClick={handlePaste} className="px-4 py-2 rounded-lg text-xs bg-bg-tertiary border border-border/50 hover:bg-bg-elevated text-text-secondary">貼付</button>
            </div>
            {items.length > 0 && (
              <div className="space-y-1.5">
                {items.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2 p-2 rounded-lg bg-bg-secondary border border-border">
                    <span className="text-xs">{item.isFolder ? "📁" : "📄"}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] font-medium text-text-primary truncate">{item.name}</div>
                      <div className="text-[9px] text-text-muted font-mono truncate">{item.path}</div>
                    </div>
                    <div className="flex gap-0.5 flex-shrink-0">
                      {item.detected.hasTxt && <span className="px-1 py-0.5 rounded text-[8px] bg-accent-tertiary/15 text-accent-tertiary">TXT</span>}
                      {item.detected.hasPsd && <span className="px-1 py-0.5 rounded text-[8px] bg-accent-secondary/15 text-accent-secondary">PSD</span>}
                      {item.detected.hasImage && <span className="px-1 py-0.5 rounded text-[8px] bg-accent/15 text-accent">画像</span>}
                      {item.detected.hasPdf && <span className="px-1 py-0.5 rounded text-[8px] bg-error/15 text-error">PDF</span>}
                    </div>
                    <button onClick={() => handleRemove(idx)} className="w-5 h-5 flex items-center justify-center rounded text-text-muted/40 hover:text-error hover:bg-error/10 transition-colors flex-shrink-0">
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
            {/* チェック */}
            {items.length > 0 && mode === "ingest" && (
              <div className={`p-3 rounded-xl border ${ingestChecks.every(Boolean) ? "bg-success/5 border-success/20" : "bg-warning/5 border-warning/20"}`}>
                <div className="flex gap-2 flex-wrap">
                  {ingestLabels.map((label, i) => (
                    <span key={label} className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${ingestChecks[i] ? "bg-success/15 text-success" : "bg-error/15 text-error"}`}>{ingestChecks[i] ? "✓" : "✗"} {label}</span>
                  ))}
                </div>
                {ingestLabels.filter((_, i) => !ingestChecks[i]).length > 0 && (
                  <div className="text-[9px] text-warning mt-1">⚠ 不足: {ingestLabels.filter((_, i) => !ingestChecks[i]).join("、")}</div>
                )}
              </div>
            )}
            {items.length > 0 && mode === "whiteout" && (
              <div className={`p-3 rounded-xl border ${whiteoutOk ? "bg-success/5 border-success/20" : "bg-warning/5 border-warning/20"}`}>
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${hasManuscript ? "bg-success/15 text-success" : "bg-error/15 text-error"}`}>{hasManuscript ? "✓" : "✗"} 原稿（PSD）</span>
              </div>
            )}
          </>
        )}

        {/* ZIP名 */}
        <div className="p-3 rounded-xl bg-bg-secondary border border-border space-y-1.5">
          <span className="text-[10px] font-medium text-text-primary">ZIP名</span>
          <input type="text" value={zipName} onChange={(e) => setZipName(e.target.value)}
            className="w-full text-[10px] px-2 py-1.5 bg-bg-primary border border-border/50 rounded text-text-primary outline-none font-mono" />
          {(scanWorkInfo.genre || scanWorkInfo.title) && <div className="text-[9px] text-text-muted">JSON: {scanWorkInfo.genre} / {scanWorkInfo.title}</div>}
          {detectedVolume && <div className="text-[9px] text-accent">巻数検出: {detectedVolume}</div>}
          <div className="text-[9px] text-text-muted font-mono">→ {zipName}.zip</div>
        </div>

        <button onClick={handleExecute} disabled={processing}
          className="w-full py-3 rounded-xl text-sm font-bold bg-accent text-white hover:bg-accent/90 disabled:opacity-40 active:scale-[0.98] transition-all">
          {processing ? "ZIP作成中..." : "ZIPに圧縮"}
        </button>

        {status.msg && (
          <div className={`p-3 rounded-xl text-xs ${status.type === "success" ? "bg-success/10 text-success border border-success/20" : status.type === "error" ? "bg-error/10 text-error border border-error/20" : "bg-bg-tertiary text-text-muted"}`}>
            {status.msg}
          </div>
        )}
      </div>

      {/* WF完了確認ダイアログ */}
      {showWfComplete && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40">
          <div className="bg-bg-secondary border border-border rounded-2xl p-5 shadow-xl w-[300px] space-y-3" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-medium text-text-primary text-center">完了</p>
            <p className="text-xs text-text-secondary text-center">ワークフローを終了しますか？</p>
            <div className="flex gap-2">
              <button onClick={() => setShowWfComplete(false)} className="flex-1 px-3 py-2 text-xs font-medium text-text-secondary bg-bg-tertiary rounded-lg hover:bg-bg-elevated transition-colors">いいえ</button>
              <button onClick={async () => {
                setShowWfComplete(false);
                // Notionページが設定されていればデフォルトブラウザで開く
                const raw = useScanPsdStore.getState().workInfo.notionPage?.trim() || "";
                if (raw) {
                  try {
                    await invoke("open_url_in_browser", { url: raw });
                  } catch (e) {
                    console.error("Failed to open Notion URL:", e);
                    alert(`Notionページをブラウザで開けませんでした:\n${raw}\n\n${e}`);
                  }
                }
                const { useWorkflowStore } = await import("../../store/workflowStore");
                useWorkflowStore.getState().abortWorkflow();
              }} className="flex-1 px-3 py-2 text-xs font-medium text-white bg-success rounded-lg hover:bg-success/90 transition-colors">はい</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
