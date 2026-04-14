import { useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { usePsdStore } from "../../store/psdStore";
import { useScanPsdStore } from "../../store/scanPsdStore";
import { useProgenStore } from "../../store/progenStore";
import { usePsdLoader } from "../../hooks/usePsdLoader";
import { GENRE_LABELS } from "../../types/scanPsd";
import { useUnifiedViewerStore } from "../../store/unifiedViewerStore";
import { JsonFileBrowser } from "../scanPsd/JsonFileBrowser";

const DEFAULT_COPY_DEST = "1_原稿";

function loadSetting(key: string, fallback: string): string {
  try { return localStorage.getItem(`folderSetup_${key}`) || fallback; } catch { return fallback; }
}
function saveSetting(key: string, value: string) {
  try { localStorage.setItem(`folderSetup_${key}`, value); } catch { /* ignore */ }
}
function loadStructure(key: string): string[] {
  try {
    const raw = localStorage.getItem(`folderSetup_struct_${key}`);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return [];
}
function saveStructure(key: string, folders: string[]) {
  try { localStorage.setItem(`folderSetup_struct_${key}`, JSON.stringify(folders)); } catch { /* ignore */ }
}

// デフォルト構造
const DEFAULT_NEW = ["1_原稿","2_写植","3_写植校了","4_TIFF","5_校正","6_白消しPSD","7_次回予告","8_あらすじ","9_表紙"];
const DEFAULT_SEQUEL = ["1_原稿","2_写植","3_写植校了","4_TIFF","5_校正","6_白消しPSD"];

export function FolderSetupView() {
  const [sourcePath, setSourcePath] = useState("");
  const [mode, setMode] = useState<"new" | "sequel">("new");
  const [destBase, setDestBase] = useState("");
  const [extractedNumber, setExtractedNumber] = useState("");
  const [status, setStatus] = useState<{ type: "idle" | "success" | "error"; message: string }>({ type: "idle", message: "" });
  const [processing, setProcessing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const { loadFolder } = usePsdLoader();

  // 作品情報JSON
  const [jsonMode, setJsonMode] = useState<"none" | "select" | "new">("none");
  const [selectedJsonPath, setSelectedJsonPath] = useState("");
  const [newJsonGenre, setNewJsonGenre] = useState("");
  const [newJsonLabel, setNewJsonLabel] = useState("");
  const [newJsonTitle, setNewJsonTitle] = useState("");
  const [showJsonBrowser, setShowJsonBrowser] = useState(false);
  const jsonFolderPath = useScanPsdStore((s) => s.jsonFolderPath);

  // コピー完了後のファイル確認結果
  const [fileCheck, setFileCheck] = useState<{
    hasPsd: boolean;
    hasPdfOrImage: boolean;
    hasText: boolean;
    psdCount: number;
    pdfImageCount: number;
    textCount: number;
    checkedFolder: string;
  } | null>(null);

  // 設定
  const [newTemplatePath, setNewTemplatePath] = useState(loadSetting("newTemplatePath", ""));
  const [sequelTemplatePath, setSequelTemplatePath] = useState(loadSetting("sequelTemplatePath", ""));
  const [newStructure, setNewStructure] = useState<string[]>(() => {
    const saved = loadStructure("new");
    return saved.length > 0 ? saved : DEFAULT_NEW;
  });
  const [sequelStructure, setSequelStructure] = useState<string[]>(() => {
    const saved = loadStructure("sequel");
    return saved.length > 0 ? saved : DEFAULT_SEQUEL;
  });
  const [copyDest, setCopyDest] = useState(loadSetting("copyDest", DEFAULT_COPY_DEST));

  // D&Dでフォルダ構造を取得
  const handleDropStructure = useCallback(async (type: "new" | "sequel", folderPath: string) => {
    try {
      const contents = await invoke<{ folders: string[]; json_files: string[] }>("list_folder_contents", { folderPath });
      const folders = contents.folders.sort();
      if (folders.length === 0) { alert("サブフォルダが見つかりませんでした"); return; }
      if (type === "new") {
        setNewStructure(folders);
        saveStructure("new", folders);
      } else {
        setSequelStructure(folders);
        saveStructure("sequel", folders);
      }
    } catch (e) {
      alert("フォルダ構造の取得に失敗しました: " + String(e));
    }
  }, []);

  // アドレスペースト時にフォルダ名から数字を抽出
  const handleSourceChange = useCallback((val: string) => {
    setSourcePath(val.trim());
    const folderName = val.trim().replace(/\\/g, "/").split("/").pop() || "";
    const match = folderName.match(/(\d+)/);
    setExtractedNumber(match ? match[1] : "");
    setStatus({ type: "idle", message: "" });
  }, []);

  const handlePaste = useCallback(async () => {
    try { const text = await navigator.clipboard.readText(); if (text) handleSourceChange(text); } catch { /* ignore */ }
  }, [handleSourceChange]);

  const handleBrowseSource = useCallback(async () => {
    const path = await dialogOpen({ directory: true, multiple: false, title: "コピー元フォルダを選択" });
    if (path) handleSourceChange(path as string);
  }, [handleSourceChange]);

  const handleBrowseDest = useCallback(async () => {
    const path = await dialogOpen({ directory: true, multiple: false, title: "コピー先ベースフォルダを選択" });
    if (path) setDestBase(path as string);
  }, []);

  // 実行
  const handleExecute = useCallback(async () => {
    if (!sourcePath || !destBase) { setStatus({ type: "error", message: "コピー元とコピー先を指定してください" }); return; }
    const number = extractedNumber || "0";
    const structure = mode === "new" ? newStructure : sequelStructure;
    const templatePath = mode === "new" ? newTemplatePath : sequelTemplatePath;

    setProcessing(true);
    setStatus({ type: "idle", message: "処理中..." });

    try {
      const numberFolder = `${destBase}\\${number}`;

      if (templatePath) {
        // テンプレートフォルダからコピー
        await invoke<number>("copy_folder", { source: templatePath, destination: numberFolder });
      } else {
        // 保存済み構造からフォルダ作成（.keepファイルは作成しない）
        for (const folder of structure) {
          await invoke("create_directory", { path: `${numberFolder}\\${folder}` });
        }
      }

      // ソースフォルダをフォルダ名ごと指定サブフォルダにコピー
      const sourceFolderName = sourcePath.replace(/\\/g, "/").split("/").pop() || "";
      const copyDestFolder = `${numberFolder}\\${copyDest}\\${sourceFolderName}`;
      const copiedCount = await invoke<number>("copy_folder", { source: sourcePath, destination: copyDestFolder });

      // ── 番号フォルダ全体をスキャン（kenban_list_files_in_folder で全拡張子取得）──
      // ※ list_folder_files は PSD/TIFF しか返さないため、kenban_list_files_in_folder を使用
      const normalizedNumberFolder = numberFolder.replace(/\//g, "\\");
      let scanResult = { hasPsd: false, hasPdfOrImage: false, hasText: false, psdCount: 0, pdfImageCount: 0, textCount: 0 };
      const textFilePaths: string[] = [];
      let psdFolderPath = "";
      let scanError = "";

      // 全対象拡張子で一括検索
      const ALL_SCAN_EXTS = ["psd", "psb", "pdf", "jpg", "jpeg", "png", "bmp", "tif", "tiff", "txt"];

      // copyDestFolder 内を検索（ソースがコピーされた場所）
      const scanFolders = [copyDestFolder, normalizedNumberFolder];
      for (const scanTarget of scanFolders) {
        try {
          const foundFiles = await invoke<string[]>("kenban_list_files_in_folder", {
            path: scanTarget,
            extensions: ALL_SCAN_EXTS,
          });
          if (foundFiles && foundFiles.length > 0) {
            for (const f of foundFiles) {
              const dotIdx = f.lastIndexOf(".");
              if (dotIdx < 0) continue;
              const ext = f.substring(dotIdx + 1).toLowerCase();
              if (ext === "psd" || ext === "psb") {
                scanResult.psdCount++;
                if (!psdFolderPath) {
                  const sep = Math.max(f.lastIndexOf("\\"), f.lastIndexOf("/"));
                  if (sep >= 0) psdFolderPath = f.substring(0, sep);
                }
              }
              if (["pdf", "jpg", "jpeg", "png", "bmp", "tif", "tiff"].includes(ext)) scanResult.pdfImageCount++;
              if (ext === "txt") { scanResult.textCount++; textFilePaths.push(f); }
            }
            scanResult.hasPsd = scanResult.psdCount > 0;
            scanResult.hasPdfOrImage = scanResult.pdfImageCount > 0;
            scanResult.hasText = scanResult.textCount > 0;
            if (scanResult.hasPsd) break; // PSDが見つかったフォルダで確定
          }
        } catch (e) {
          console.error(`Scan error (${scanTarget}):`, e);
          scanError = String(e);
        }
      }
      setFileCheck({ ...scanResult, checkedFolder: psdFolderPath || copyDestFolder });

      // ── テキストファイルがあれば自動読み込み（整形プロンプト用）──
      if (textFilePaths.length > 0) {
        try {
          let combinedText = "";
          for (const tp of textFilePaths) {
            const content = await invoke<string>("read_text_file", { filePath: tp });
            if (content) {
              if (combinedText) combinedText += "\n\n";
              combinedText += content;
            }
          }
          if (combinedText) {
            const viewerStore = useUnifiedViewerStore.getState();
            viewerStore.setTextContent(combinedText);
            viewerStore.setTextFilePath(textFilePaths[0]);
          }
        } catch (e) {
          console.error("Text file read error:", e);
        }
      }

      // ── ステータスメッセージ（警告含む）──
      const warnings: string[] = [];
      if (!scanResult.hasPsd) warnings.push("PSDなし");
      if (!scanResult.hasPdfOrImage) warnings.push("PDF/画像なし");
      if (scanError) warnings.push(`スキャンエラー: ${scanError}`);
      const warnMsg = warnings.length > 0 ? `  ⚠ ${warnings.join("、")}` : "";
      setStatus({ type: "success", message: `完了: ${copiedCount}ファイルをコピー（検出: PSD ${scanResult.psdCount}, PDF/画像 ${scanResult.pdfImageCount}, テキスト ${scanResult.textCount}）${warnMsg}` });

      // ── テキスト有無で ProGen モードフラグを保存 ──
      // hasText=true → 整形 (formatting), hasText=false → 抽出 (extraction)
      try {
        localStorage.setItem("folderSetup_progenMode", scanResult.hasText ? "formatting" : "extraction");
        localStorage.setItem("folderSetup_copyDestFolder", copyDestFolder);
        localStorage.setItem("folderSetup_numberFolder", numberFolder);
      } catch { /* ignore */ }

      // ── PSD フォルダを specCheck に自動読み込み ──
      if (psdFolderPath && scanResult.hasPsd) {
        try {
          usePsdStore.getState().setCurrentFolderPath(psdFolderPath);
          usePsdStore.getState().setContentLocked(true);
          await loadFolder(psdFolderPath);
        } catch (e) {
          console.error("PSD auto-load error:", e);
        }
      }

      // ── 作品情報JSON処理 ──
      if (jsonMode === "select" && selectedJsonPath) {
        // 既存JSONを読み込み → ProGenルール適用
        try {
          const content = await invoke<string>("read_text_file", { filePath: selectedJsonPath });
          const data = JSON.parse(content);
          const scanStore = useScanPsdStore.getState();
          scanStore.setCurrentJsonFilePath(selectedJsonPath);
          // workInfo読み込み
          const wi = data?.presetData?.workInfo ?? data?.workInfo;
          if (wi) {
            scanStore.setWorkInfo({ ...scanStore.workInfo, ...(wi.genre ? { genre: wi.genre } : {}), ...(wi.label ? { label: wi.label } : {}), ...(wi.title ? { title: wi.title } : {}), ...(wi.author ? { author: wi.author } : {}) });
          }
          // ProGenルール適用
          const ps = useProgenStore.getState();
          ps.setCurrentLoadedJson(data);
          ps.setCurrentJsonPath(selectedJsonPath);
          if (data?.proofRules) ps.applyJsonRules(data);
          else if (data?.presetData?.proofRules) ps.applyJsonRules(data.presetData);
          else if (wi?.label) await ps.loadMasterRule(wi.label);
        } catch (e) { console.error("JSON load error:", e); }
      } else if (jsonMode === "new" && newJsonLabel && newJsonTitle) {
        // 新規JSON作成
        const safeLabel = newJsonLabel.replace(/[\\/:*?"<>|]/g, "_");
        const safeTitle = newJsonTitle.replace(/[\\/:*?"<>|]/g, "_");
        const jsonBasePath = "G:/共有ドライブ/CLLENN/編集部フォルダ/編集企画部/編集企画_C班(AT業務推進)/DTP制作部/JSONフォルダ";
        const jsonDir = `${jsonBasePath}/${safeLabel}`;
        const jsonFilePath = `${jsonDir}/${safeTitle}.json`;
        // テキストログフォルダに校正チェックデータ格納先を作成
        const textLogBase = "G:/共有ドライブ/CLLENN/編集部フォルダ/編集企画部/写植・校正用テキストログ";
        const calibrationDir = `${textLogBase}/${safeLabel}/${safeTitle}/校正チェックデータ`;
        try {
          await invoke("create_directory", { path: jsonDir });
          await invoke("create_directory", { path: calibrationDir });
          // 新規JSON生成
          const newJson = {
            presetData: { presets: {}, fontSizeStats: {}, guides: [], workInfo: { label: newJsonLabel, title: newJsonTitle } },
            proofRules: { proof: [], symbol: [], options: {} },
          };
          await invoke("write_text_file", { filePath: jsonFilePath, content: JSON.stringify(newJson, null, 2) });
          // ストアに反映
          const scanStore = useScanPsdStore.getState();
          scanStore.setCurrentJsonFilePath(jsonFilePath);
          scanStore.setWorkInfo({ ...scanStore.workInfo, label: newJsonLabel, title: newJsonTitle });
          const ps = useProgenStore.getState();
          ps.setCurrentLoadedJson(newJson);
          ps.setCurrentJsonPath(jsonFilePath);
          await ps.loadMasterRule(newJsonLabel);
        } catch (e) { console.error("New JSON create error:", e); }
      }

      await invoke("open_folder_in_explorer", { folderPath: numberFolder }).catch(() => {});
    } catch (e) {
      setStatus({ type: "error", message: `エラー: ${String(e)}` });
    }
    setProcessing(false);
  }, [sourcePath, destBase, extractedNumber, mode, newStructure, sequelStructure, newTemplatePath, sequelTemplatePath, copyDest, loadFolder, jsonMode, selectedJsonPath, newJsonGenre, newJsonLabel, newJsonTitle]);

  const saveAllSettings = () => {
    saveSetting("newTemplatePath", newTemplatePath);
    saveSetting("sequelTemplatePath", sequelTemplatePath);
    saveSetting("copyDest", copyDest);
    saveStructure("new", newStructure);
    saveStructure("sequel", sequelStructure);
    setShowSettings(false);
  };



  return (
    <div className="h-full flex flex-col bg-bg-primary overflow-auto">
      <div className="max-w-[600px] mx-auto w-full p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-text-primary">フォルダセットアップ</h1>
            <p className="text-xs text-text-muted mt-1">原稿フォルダを作業フォルダにコピー＋フォルダ構造を作成</p>
          </div>
          <button onClick={() => setShowSettings(!showSettings)}
            className="px-3 py-1.5 text-[10px] rounded-lg bg-bg-tertiary hover:bg-bg-elevated text-text-secondary border border-border/50 transition-colors">
            {showSettings ? "閉じる" : "設定"}
          </button>
        </div>

        {/* 設定パネル */}
        {showSettings && (
          <div className="p-4 rounded-xl bg-bg-secondary border border-border space-y-4">
            <h3 className="text-xs font-bold text-text-primary">テンプレート設定</h3>

            {/* 新作 */}
            <div className="space-y-2">
              <label className="text-[10px] font-medium text-text-primary">新作</label>
              <div>
                <label className="text-[9px] text-text-muted block mb-1">テンプレートフォルダ（空ならフォルダ構造を使用）</label>
                <input type="text" value={newTemplatePath} onChange={(e) => setNewTemplatePath(e.target.value)}
                  className="w-full text-[10px] px-2 py-1.5 bg-bg-primary border border-border/50 rounded text-text-primary outline-none font-mono" placeholder="未指定（フォルダ構造を使用）" />
              </div>
              <div>
                <label className="text-[9px] text-text-muted block mb-1">フォルダ構造（クリックでフォルダから取得）</label>
                <div
                  className="p-2 bg-bg-primary border border-dashed border-border rounded cursor-pointer hover:border-accent/40 hover:bg-accent/5 transition-colors"
                  onClick={async () => {
                    const path = await dialogOpen({ directory: true, multiple: false, title: "新作用: フォルダ構造を取得" });
                    if (path) handleDropStructure("new", path as string);
                  }}
                >
                  {newStructure.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {newStructure.map((f) => (
                        <span key={f} className="px-1.5 py-0.5 text-[9px] bg-accent/10 text-accent rounded">{f}</span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[9px] text-text-muted text-center py-2">クリックしてフォルダ構造を取得</p>
                  )}
                </div>
              </div>
            </div>

            {/* 続話 */}
            <div className="space-y-2">
              <label className="text-[10px] font-medium text-text-primary">続話</label>
              <div>
                <label className="text-[9px] text-text-muted block mb-1">テンプレートフォルダ（空ならフォルダ構造を使用）</label>
                <input type="text" value={sequelTemplatePath} onChange={(e) => setSequelTemplatePath(e.target.value)}
                  className="w-full text-[10px] px-2 py-1.5 bg-bg-primary border border-border/50 rounded text-text-primary outline-none font-mono" placeholder="未指定（フォルダ構造を使用）" />
              </div>
              <div>
                <label className="text-[9px] text-text-muted block mb-1">フォルダ構造（クリックでフォルダから取得）</label>
                <div
                  className="p-2 bg-bg-primary border border-dashed border-border rounded cursor-pointer hover:border-accent-secondary/40 hover:bg-accent-secondary/5 transition-colors"
                  onClick={async () => {
                    const path = await dialogOpen({ directory: true, multiple: false, title: "続話用: フォルダ構造を取得" });
                    if (path) handleDropStructure("sequel", path as string);
                  }}
                >
                  {sequelStructure.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {sequelStructure.map((f) => (
                        <span key={f} className="px-1.5 py-0.5 text-[9px] bg-accent-secondary/10 text-accent-secondary rounded">{f}</span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[9px] text-text-muted text-center py-2">クリックしてフォルダ構造を取得</p>
                  )}
                </div>
              </div>
            </div>

            {/* コピー先サブフォルダ */}
            <div>
              <label className="text-[9px] text-text-muted block mb-1">コピー先サブフォルダ名</label>
              <input type="text" value={copyDest} onChange={(e) => setCopyDest(e.target.value)}
                className="w-full text-[10px] px-2 py-1.5 bg-bg-primary border border-border/50 rounded text-text-primary outline-none font-mono" placeholder="例: 1_原稿" />
            </div>

            <button onClick={saveAllSettings}
              className="px-4 py-1.5 text-xs font-medium rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors">
              設定を保存
            </button>
          </div>
        )}

        {/* Step 1: コピー元 */}
        <div className="p-4 rounded-xl bg-bg-secondary border border-border space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-accent/15 text-accent text-xs font-bold flex items-center justify-center">1</span>
            <span className="text-xs font-medium text-text-primary">コピー元フォルダ</span>
          </div>
          <div className="flex gap-2">
            <input type="text" value={sourcePath} onChange={(e) => handleSourceChange(e.target.value)}
              className="flex-1 text-[10px] px-2 py-1.5 bg-bg-primary border border-border/50 rounded text-text-primary outline-none font-mono" placeholder="フォルダパスを貼り付け..." />
            <button onClick={handlePaste} className="px-2 py-1.5 text-[10px] bg-bg-tertiary border border-border/50 rounded hover:bg-bg-elevated text-text-secondary">貼付</button>
            <button onClick={handleBrowseSource} className="px-2 py-1.5 text-[10px] bg-bg-tertiary border border-border/50 rounded hover:bg-bg-elevated text-text-secondary">参照</button>
          </div>
          {extractedNumber && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-text-muted">検出番号:</span>
              <span className="px-2 py-0.5 rounded bg-accent/10 text-accent font-bold">{extractedNumber}</span>
              <input type="text" value={extractedNumber} onChange={(e) => setExtractedNumber(e.target.value)}
                className="w-16 text-[10px] px-2 py-0.5 border border-border/50 rounded text-text-primary outline-none text-center" title="番号を手動修正" />
            </div>
          )}
        </div>

        {/* Step 2: 新作/続話 */}
        <div className="p-4 rounded-xl bg-bg-secondary border border-border space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-accent/15 text-accent text-xs font-bold flex items-center justify-center">2</span>
            <span className="text-xs font-medium text-text-primary">フォルダ種別</span>
          </div>
          <div className="flex gap-2">
            <button onClick={() => { setMode("new"); setJsonMode("new"); }}
              className={`flex-1 py-2.5 rounded-lg text-xs font-medium transition-all ${mode === "new" ? "bg-accent/15 text-accent border border-accent/30" : "bg-bg-tertiary text-text-secondary border border-border/50 hover:bg-bg-elevated"}`}>
              新作<div className="text-[9px] text-text-muted mt-0.5">{newStructure.length}フォルダ</div>
            </button>
            <button onClick={() => { setMode("sequel"); setJsonMode("select"); }}
              className={`flex-1 py-2.5 rounded-lg text-xs font-medium transition-all ${mode === "sequel" ? "bg-accent-secondary/15 text-accent-secondary border border-accent-secondary/30" : "bg-bg-tertiary text-text-secondary border border-border/50 hover:bg-bg-elevated"}`}>
              続話<div className="text-[9px] text-text-muted mt-0.5">{sequelStructure.length}フォルダ</div>
            </button>
          </div>
        </div>

        {/* 作品情報JSON */}
        <div className="p-4 rounded-xl bg-bg-secondary border border-border space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-purple-500/15 text-purple-500 text-xs font-bold flex items-center justify-center">J</span>
            <span className="text-xs font-medium text-text-primary">作品情報JSON</span>
            <span className="text-[9px] text-text-muted">（ProGen校正ルール連携）</span>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setJsonMode("new")}
              className={`flex-1 py-2 rounded-lg text-[10px] font-medium transition-all ${jsonMode === "new" ? "bg-accent/15 text-accent border border-accent/30" : "bg-bg-tertiary text-text-secondary border border-border/50 hover:bg-bg-elevated"}`}>
              新規作成
            </button>
            <button onClick={() => setJsonMode("select")}
              className={`flex-1 py-2 rounded-lg text-[10px] font-medium transition-all ${jsonMode === "select" ? "bg-purple-500/15 text-purple-500 border border-purple-500/30" : "bg-bg-tertiary text-text-secondary border border-border/50 hover:bg-bg-elevated"}`}>
              既存JSONを選択
            </button>
          </div>

          {jsonMode === "select" && (
            <div className="space-y-1.5">
              <button
                onClick={() => setShowJsonBrowser(true)}
                className="w-full px-3 py-2 text-[10px] bg-purple-500/10 hover:bg-purple-500/20 text-purple-500 border border-purple-500/30 rounded-lg transition-colors"
              >
                {selectedJsonPath ? `✓ ${selectedJsonPath.split(/[/\\]/).pop()}` : "作品情報JSONを選択..."}
              </button>
              {selectedJsonPath && (
                <div className="text-[9px] text-text-muted font-mono truncate">{selectedJsonPath}</div>
              )}
            </div>
          )}

          {jsonMode === "new" && (
            <div className="space-y-1.5">
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-[9px] text-text-muted block mb-0.5">ジャンル</label>
                  <select value={newJsonGenre} onChange={(e) => {
                    setNewJsonGenre(e.target.value);
                    const labels = GENRE_LABELS[e.target.value];
                    setNewJsonLabel(labels?.[0] || "");
                  }}
                    className="w-full text-[10px] px-2 py-1.5 bg-bg-primary border border-border/50 rounded text-text-primary outline-none">
                    <option value="">選択...</option>
                    {Object.keys(GENRE_LABELS).map((g) => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-[9px] text-text-muted block mb-0.5">レーベル</label>
                  <select value={newJsonLabel} onChange={(e) => setNewJsonLabel(e.target.value)}
                    className="w-full text-[10px] px-2 py-1.5 bg-bg-primary border border-border/50 rounded text-text-primary outline-none"
                    disabled={!newJsonGenre}>
                    <option value="">選択...</option>
                    {(GENRE_LABELS[newJsonGenre] || []).map((l) => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-[9px] text-text-muted block mb-0.5">タイトル</label>
                  <input type="text" value={newJsonTitle} onChange={(e) => setNewJsonTitle(e.target.value)}
                    className="w-full text-[10px] px-2 py-1.5 bg-bg-primary border border-border/50 rounded text-text-primary outline-none" placeholder="作品名" />
                </div>
              </div>
              {newJsonLabel && newJsonTitle && (
                <div className="text-[9px] text-text-muted font-mono">
                  保存先: JSONフォルダ/{newJsonLabel}/{newJsonTitle}.json
                </div>
              )}
            </div>
          )}
        </div>

        {/* Step 3: コピー先 */}
        <div className="p-4 rounded-xl bg-bg-secondary border border-border space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-accent/15 text-accent text-xs font-bold flex items-center justify-center">3</span>
            <span className="text-xs font-medium text-text-primary">コピー先ベースフォルダ</span>
          </div>
          <div className="flex gap-2">
            <input type="text" value={destBase} onChange={(e) => setDestBase(e.target.value)}
              className="flex-1 text-[10px] px-2 py-1.5 bg-bg-primary border border-border/50 rounded text-text-primary outline-none font-mono" placeholder="コピー先フォルダを選択..." />
            <button onClick={handleBrowseDest} className="px-2 py-1.5 text-[10px] bg-bg-tertiary border border-border/50 rounded hover:bg-bg-elevated text-text-secondary">参照</button>
          </div>
          {destBase && extractedNumber && (
            <div className="text-[10px] text-text-muted font-mono">
              作成先: {destBase}\{extractedNumber}\<span className="text-accent">{copyDest}</span>\{sourcePath.replace(/\\/g, "/").split("/").pop() || ""}
            </div>
          )}
        </div>

        {/* 実行 */}
        <button onClick={handleExecute} disabled={processing || !sourcePath || !destBase}
          className="w-full py-3 rounded-xl text-sm font-bold transition-all bg-accent text-white hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]">
          {processing ? "処理中..." : "フォルダ作成＋コピー実行"}
        </button>

        {status.message && (
          <div className={`p-3 rounded-xl text-xs ${status.type === "success" ? "bg-success/10 text-success border border-success/20" : status.type === "error" ? "bg-error/10 text-error border border-error/20" : "bg-bg-tertiary text-text-muted"}`}>
            {status.message}
          </div>
        )}

        {/* ── ファイル確認結果 ── */}
        {fileCheck && (
          <div className="bg-bg-secondary border border-border rounded-xl p-4 space-y-3">
            <div className="text-[11px] font-medium text-text-primary">📋 コピー先のファイル確認</div>
            <div className="grid grid-cols-3 gap-3">
              {/* PSD */}
              <div className={`p-3 rounded-lg border text-center ${fileCheck.hasPsd ? "bg-success/5 border-success/20" : "bg-error/5 border-error/20"}`}>
                <div className={`text-lg ${fileCheck.hasPsd ? "text-success" : "text-error"}`}>{fileCheck.hasPsd ? "✓" : "✕"}</div>
                <div className="text-[10px] font-medium text-text-primary mt-1">PSD</div>
                <div className="text-[9px] text-text-muted">{fileCheck.psdCount}件</div>
              </div>
              {/* PDF/画像 */}
              <div className={`p-3 rounded-lg border text-center ${fileCheck.hasPdfOrImage ? "bg-success/5 border-success/20" : "bg-error/5 border-error/20"}`}>
                <div className={`text-lg ${fileCheck.hasPdfOrImage ? "text-success" : "text-error"}`}>{fileCheck.hasPdfOrImage ? "✓" : "✕"}</div>
                <div className="text-[10px] font-medium text-text-primary mt-1">PDF / 画像</div>
                <div className="text-[9px] text-text-muted">{fileCheck.pdfImageCount}件</div>
              </div>
              {/* テキスト */}
              <div className={`p-3 rounded-lg border text-center ${fileCheck.hasText ? "bg-blue-500/5 border-blue-500/20" : "bg-bg-tertiary border-border/50"}`}>
                <div className={`text-lg ${fileCheck.hasText ? "text-blue-500" : "text-text-muted"}`}>{fileCheck.hasText ? "✓" : "—"}</div>
                <div className="text-[10px] font-medium text-text-primary mt-1">テキスト</div>
                <div className="text-[9px] text-text-muted">{fileCheck.textCount}件</div>
              </div>
            </div>

            {/* 警告 */}
            {(!fileCheck.hasPsd || !fileCheck.hasPdfOrImage) && (
              <div className="p-2.5 bg-warning/10 border border-warning/20 rounded-lg">
                <div className="text-[10px] text-warning font-medium">⚠ 注意</div>
                <div className="text-[10px] text-warning/80 mt-0.5">
                  {!fileCheck.hasPsd && <div>PSDファイルが見つかりません。写植データが不足している可能性があります。</div>}
                  {!fileCheck.hasPdfOrImage && <div>PDFまたは画像ファイルが見つかりません。原稿データが不足している可能性があります。</div>}
                </div>
              </div>
            )}

            {/* ProGenモード案内 */}
            <div className="p-2.5 bg-accent/5 border border-accent/15 rounded-lg">
              <div className="text-[10px] text-accent font-medium">
                {fileCheck.hasText
                  ? "📝 テキストあり → ProGen「整形プロンプト」モードで処理"
                  : "🔍 テキストなし → ProGen「抽出プロンプト」モードで処理"}
              </div>
              <div className="text-[9px] text-text-muted mt-0.5">
                {fileCheck.hasText
                  ? "テキストファイルが見つかったため、統一表記ルールを適用して整形します。"
                  : "テキストファイルがないため、PDF/画像からセリフを抽出します。"}
              </div>
            </div>

            {/* WFの次工程ボタンで遷移するため、個別ボタンは不要 */}
          </div>
        )}
      </div>

      {/* 作品情報JSON ブラウザモーダル */}
      {showJsonBrowser && createPortal(
        <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/40" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowJsonBrowser(false); }}>
          <div className="bg-bg-secondary rounded-xl shadow-2xl w-[500px] max-h-[70vh] flex flex-col overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2 border-b border-border">
              <h3 className="text-sm font-medium">作品情報JSONを選択</h3>
              <button onClick={() => setShowJsonBrowser(false)} className="text-text-muted hover:text-text-primary">✕</button>
            </div>
            <div className="flex-1 overflow-auto">
              {jsonFolderPath ? (
                <JsonFileBrowser
                  basePath={jsonFolderPath}
                  onSelect={(filePath) => { setSelectedJsonPath(filePath); setShowJsonBrowser(false); }}
                  onCancel={() => setShowJsonBrowser(false)}
                  mode="open"
                />
              ) : (
                <div className="p-4 text-center text-text-muted text-xs">
                  JSONフォルダパスが設定されていません。Scan PSDから設定してください。
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
