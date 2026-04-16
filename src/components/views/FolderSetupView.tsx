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

const DEFAULT_COPY_DEST = "1_入稿";

// ═══ 組み込みデフォルトフォルダ構造 ═══
// 外部テンプレートパスに依存せず、コード内に直接定義した階層構造。
// 新作モード: {destBase}\{title}\ 配下にtitle階層フォルダ + {destBase}\{title}\{volume}\ 配下にvolume階層フォルダ
// 続話モード: {destBase}\{volume}\ 配下にvolume階層フォルダのみ
// 注: create_dir_all が中間ディレクトリを自動作成するので、リーフのみ記載すれば中間フォルダも生成される

/** 新作モード: タイトル階層（{destBase}\{title}\）に作成するフォルダ */
const NEW_TITLE_LEVEL_FOLDERS = ["#BS依頼用"];

/** 新作モード: 巻数階層（{destBase}\{title}\{volume}\）に作成するフォルダ */
const NEW_VOLUME_LEVEL_FOLDERS = [
  "1_入稿",
  "2_写植",
  "3_校正",
  "4_白消し素材",
  "5_校了・TIFF/TIFF",
  "5_校了・TIFF/校了PSD",
  "5_校了・TIFF/表紙・サンプル",
  "6_BS/1_初校戻し",
  "6_BS/2_再校戻し",
  "6_BS/3_三校戻し",
];

/** 続話モード: 巻数階層（{destBase}\{volume}\）に作成するフォルダ */
const SEQUEL_VOLUME_LEVEL_FOLDERS = [
  "1_入稿",
  "2_写植",
  "3_校正",
  "4_白消し素材",
  "5_校了・TIFF/TIFF",
  "5_校了・TIFF/校了PSD",
  "6_BS/1_初校戻し",
  "6_BS/2_再校戻し",
  "6_BS/3_三校戻し",
];

// localStorage migration: 旧テンプレートパスを全て削除（V5）
// コード内定義の組み込み構造を使用するため、外部パス設定は不要
const TEMPLATE_MIGRATION_KEY = "folderSetup_templateMigrationV5";
(function migrateTemplateDefaults() {
  try {
    if (typeof window === "undefined") return;
    if (localStorage.getItem(TEMPLATE_MIGRATION_KEY) === "done") return;
    // V5: 外部テンプレートパス依存を廃止
    localStorage.removeItem("folderSetup_newTemplatePath");
    localStorage.removeItem("folderSetup_sequelTemplatePath");
    localStorage.removeItem("folderSetup_struct_new");
    localStorage.removeItem("folderSetup_struct_sequel");
    localStorage.setItem(TEMPLATE_MIGRATION_KEY, "done");
  } catch { /* ignore */ }
})();

function loadSetting(key: string, fallback: string): string {
  try { return localStorage.getItem(`folderSetup_${key}`) || fallback; } catch { return fallback; }
}
function saveSetting(key: string, value: string) {
  try { localStorage.setItem(`folderSetup_${key}`, value); } catch { /* ignore */ }
}
// loadStructure/saveStructure は廃止（組み込み構造を使用するため）

// デフォルト構造
// 旧デフォルト（DEFAULT_NEW / DEFAULT_SEQUEL）は廃止。
// 組み込み構造 NEW_TITLE_LEVEL_FOLDERS / NEW_VOLUME_LEVEL_FOLDERS / SEQUEL_VOLUME_LEVEL_FOLDERS を使用。

interface AdditionalItem {
  path: string;
  name: string;
  isFolder: boolean;
}

export function FolderSetupView() {
  const [sourcePath, setSourcePath] = useState("");
  // ソース種別: 単一メイン(default) or 複数メイン
  const [sourceMode, setSourceMode] = useState<"single" | "multiple">("single");
  // 単一モード: 追加のサブフォルダ/ファイル
  const [additionalItems, setAdditionalItems] = useState<AdditionalItem[]>([]);
  // 複数モード: 複数のメインフォルダ
  const [multipleSources, setMultipleSources] = useState<string[]>([]);
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
  // 新作時のタイトル入力（newJsonTitleと同期、新作モード時の番号フォルダ名として使用）
  const [newWorkTitle, setNewWorkTitle] = useState("");
  const [copyDest, setCopyDest] = useState(loadSetting("copyDest", DEFAULT_COPY_DEST));
  // 注: newTemplatePath / sequelTemplatePath / newStructure / sequelStructure は廃止。
  // 組み込み構造 NEW_TITLE_LEVEL_FOLDERS / NEW_VOLUME_LEVEL_FOLDERS / SEQUEL_VOLUME_LEVEL_FOLDERS を直接使用。

  // フォルダパス変更: フォルダ名から数字を自動抽出 + 新作/続話を自動判定
  // - 抽出された数字が "1" or "01" → 新作 + JSON新規作成
  // - それ以外（"2", "10", "11" など） → 続話 + JSON既存選択
  // - 数字が抽出できない → モードは変更しない
  // ※ "10" や "11" は「1」ではないため新作にならない
  const handleSourceChange = useCallback((val: string) => {
    const trimmed = val.trim();
    setSourcePath(trimmed);
    // フォルダ名から数字を抽出
    const folderName = trimmed.replace(/\\/g, "/").split("/").pop() || "";
    const match = folderName.match(/(\d+)/);
    if (match) {
      const num = match[1];
      setExtractedNumber(num);
      // 新作判定: "1" または "01" のみ（"10", "11" などは除外）
      if (num === "1" || num === "01") {
        setMode("new");
        setJsonMode("new");
      } else {
        setMode("sequel");
        setJsonMode("select");
      }
    }
    setStatus({ type: "idle", message: "" });
  }, []);

  // 追加アイテム: フォルダ追加
  const handleAddAdditionalFolder = useCallback(async () => {
    const p = await dialogOpen({ directory: true, multiple: false, title: "追加フォルダを選択" });
    if (!p) return;
    const path = p as string;
    const name = path.replace(/\\/g, "/").split("/").pop() || "";
    setAdditionalItems((prev) => [...prev, { path, name, isFolder: true }]);
  }, []);

  // 追加アイテム: ファイル追加
  const handleAddAdditionalFile = useCallback(async () => {
    const p = await dialogOpen({ directory: false, multiple: true, title: "追加ファイルを選択" });
    if (!p) return;
    const paths = Array.isArray(p) ? p : [p];
    const newItems = paths.map((pp) => {
      const path = pp as string;
      const name = path.replace(/\\/g, "/").split("/").pop() || "";
      return { path, name, isFolder: false };
    });
    setAdditionalItems((prev) => [...prev, ...newItems]);
  }, []);

  const handleRemoveAdditional = useCallback((idx: number) => {
    setAdditionalItems((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  // 複数モード: メインフォルダ追加
  const handleAddMultipleSource = useCallback(async () => {
    const p = await dialogOpen({ directory: true, multiple: true, title: "メインフォルダを選択（複数可）" });
    if (!p) return;
    const paths = Array.isArray(p) ? p : [p];
    setMultipleSources((prev) => [...prev, ...paths.map((pp) => pp as string)]);
  }, []);

  const handleRemoveMultipleSource = useCallback((idx: number) => {
    setMultipleSources((prev) => prev.filter((_, i) => i !== idx));
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
    // 入力チェック（モードごと）
    if (sourceMode === "single") {
      if (!sourcePath || !destBase) { setStatus({ type: "error", message: "コピー元とコピー先を指定してください" }); return; }
      if (mode === "new" && !newWorkTitle.trim()) {
        setStatus({ type: "error", message: "新作の場合はタイトルを入力してください" });
        return;
      }
    } else {
      if (multipleSources.length === 0 || !destBase) { setStatus({ type: "error", message: "コピー元(複数)とコピー先を指定してください" }); return; }
    }
    setProcessing(true);
    setStatus({ type: "idle", message: "処理中..." });

    // 複数モード用: 処理すべきソースのリストを作成
    // 単一モード: [{ source: sourcePath, number: (新作時はタイトル or 続話時はextractedNumber) }]
    // 複数モード: 各ソースフォルダをそれぞれ処理、番号フォルダ名はフォルダ名を使用
    type Job = { source: string; numberFolder: string };
    const jobs: Job[] = [];
    const safeTitle = newWorkTitle.trim().replace(/[\\/:*?"<>|]/g, "_");
    if (sourceMode === "single") {
      if (mode === "new") {
        // 新作: {destBase}\{title}\{巻数} の階層を作成
        // 巻数はコピー元フォルダ名から自動抽出（extractedNumber）、空なら "1" をデフォルト
        const volume = extractedNumber || "1";
        jobs.push({ source: sourcePath, numberFolder: `${destBase}\\${safeTitle}\\${volume}` });
      } else {
        // 続話: {destBase}\{巻数}
        jobs.push({ source: sourcePath, numberFolder: `${destBase}\\${extractedNumber || "0"}` });
      }
    } else {
      for (const src of multipleSources) {
        const baseName = src.replace(/\\/g, "/").split("/").pop() || "folder";
        jobs.push({ source: src, numberFolder: `${destBase}\\${baseName}` });
      }
    }

    // 最初のジョブから取得される値（スキャン・PSD自動読み込み用）
    let firstNumberFolder = "";
    let firstCopyDestFolder = "";
    let totalCopied = 0;

    try {
      for (let ji = 0; ji < jobs.length; ji++) {
        const job = jobs[ji];
        const { source, numberFolder } = job;
        if (ji === 0) firstNumberFolder = numberFolder;

        // フォルダ階層の構築（組み込み構造を使用、外部テンプレートパス依存なし）
        if (sourceMode === "single" && mode === "new") {
          // 新作: タイトル階層 + 巻数階層 に分けて作成
          const titleFolder = `${destBase}\\${safeTitle}`;
          for (const f of NEW_TITLE_LEVEL_FOLDERS) {
            await invoke("create_directory", { path: `${titleFolder}\\${f}` });
          }
          for (const f of NEW_VOLUME_LEVEL_FOLDERS) {
            await invoke("create_directory", { path: `${numberFolder}\\${f}` });
          }
        } else if (sourceMode === "single" && mode === "sequel") {
          // 続話: 巻数階層のみ
          for (const f of SEQUEL_VOLUME_LEVEL_FOLDERS) {
            await invoke("create_directory", { path: `${numberFolder}\\${f}` });
          }
        } else {
          // 複数モード: 各フォルダに新作/続話の該当階層を作成
          // 複数モードでは単一ジョブとしてタイトル名が無いため、続話階層（巻数レベルのみ）を使用
          const folders = mode === "new" ? NEW_VOLUME_LEVEL_FOLDERS : SEQUEL_VOLUME_LEVEL_FOLDERS;
          for (const f of folders) {
            await invoke("create_directory", { path: `${numberFolder}\\${f}` });
          }
        }

        // ソースフォルダをフォルダ名ごと指定サブフォルダにコピー
        const sourceFolderName = source.replace(/\\/g, "/").split("/").pop() || "";
        const copyDestFolder = `${numberFolder}\\${copyDest}\\${sourceFolderName}`;
        const copiedCount = await invoke<number>("copy_folder", { source, destination: copyDestFolder });
        totalCopied += copiedCount;
        if (ji === 0) firstCopyDestFolder = copyDestFolder;

        // 単一モード時: 追加アイテムを copyDestFolder の親（同じレベル）にコピー
        if (sourceMode === "single" && additionalItems.length > 0) {
          const itemsParent = `${numberFolder}\\${copyDest}`;
          for (const item of additionalItems) {
            const itemDest = `${itemsParent}\\${item.name}`;
            try {
              if (item.isFolder) {
                const n = await invoke<number>("copy_folder", { source: item.path, destination: itemDest });
                totalCopied += n;
              } else {
                // 単一ファイルコピー（Rust側の copy_file コマンドで対応）
                await invoke("copy_file", { source: item.path, destination: itemDest });
                totalCopied += 1;
              }
            } catch (e) {
              console.error("追加アイテムコピー失敗:", item.path, e);
            }
          }
        }
      }

      // 以降は最初のジョブを基準にスキャン・自動読み込み
      const numberFolder = firstNumberFolder;
      const copyDestFolder = firstCopyDestFolder;
      const copiedCount = totalCopied;

      // ── 番号フォルダ全体を**再帰スキャン**（全階層のサブフォルダまでチェック）──
      // list_files_by_extension_recursive で全階層のファイルをフルパスで取得
      const normalizedNumberFolder = numberFolder.replace(/\//g, "\\");
      let scanResult = { hasPsd: false, hasPdfOrImage: false, hasText: false, psdCount: 0, pdfImageCount: 0, textCount: 0 };
      const textFilePaths: string[] = [];
      let psdFolderPath = "";
      let scanError = "";

      // 全対象拡張子で再帰検索
      const ALL_SCAN_EXTS = ["psd", "psb", "pdf", "jpg", "jpeg", "png", "bmp", "tif", "tiff", "txt"];

      // copyDestFolder 内を再帰検索（ソースがコピーされた場所、サブフォルダ全階層）
      const scanFolders = [copyDestFolder, normalizedNumberFolder];
      for (const scanTarget of scanFolders) {
        try {
          const foundFiles = await invoke<string[]>("list_files_by_extension_recursive", {
            folderPath: scanTarget,
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
                  // PSDの親フォルダパスを記録（最初に見つかったPSDの所属フォルダ）
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
          // unifiedViewerStore にも反映（TopNav「作品情報」ボタンが読み込み済みと表示される）
          const viewerStore = useUnifiedViewerStore.getState();
          viewerStore.setPresetJsonPath(selectedJsonPath);
          const presets = data?.presetData?.presets;
          if (presets && typeof presets === "object") {
            // presets を配列化（既存JSON browser と同じ処理）
            const presetArr: any[] = [];
            for (const [font, list] of Object.entries(presets)) {
              if (Array.isArray(list)) {
                for (const p of list as any[]) {
                  presetArr.push({ font, name: p?.name || "", subName: p?.subName || "", ...p });
                }
              }
            }
            viewerStore.setFontPresets(presetArr);
          }
          // ProGenルール適用
          const ps = useProgenStore.getState();
          ps.setCurrentLoadedJson(data);
          ps.setCurrentJsonPath(selectedJsonPath);
          if (data?.proofRules) ps.applyJsonRules(data);
          else if (data?.presetData?.proofRules) ps.applyJsonRules(data.presetData);
          else if (wi?.label) await ps.loadMasterRule(wi.label);
        } catch (e) { console.error("JSON load error:", e); }
      } else if (jsonMode === "new" && newJsonLabel && (newJsonTitle || newWorkTitle)) {
        // 新規JSON作成
        // 新作モードで newWorkTitle が入力されていれば、それを優先してタイトルに使用
        const effectiveTitle = newJsonTitle.trim() || newWorkTitle.trim();
        const safeLabel = newJsonLabel.replace(/[\\/:*?"<>|]/g, "_");
        const safeTitle = effectiveTitle.replace(/[\\/:*?"<>|]/g, "_");
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
            presetData: { presets: {}, fontSizeStats: {}, guides: [], workInfo: { genre: newJsonGenre, label: newJsonLabel, title: effectiveTitle } },
            proofRules: { proof: [], symbol: [], options: {} },
          };
          await invoke("write_text_file", { filePath: jsonFilePath, content: JSON.stringify(newJson, null, 2) });
          // ストアに反映
          const scanStore = useScanPsdStore.getState();
          scanStore.setCurrentJsonFilePath(jsonFilePath);
          scanStore.setWorkInfo({
            ...scanStore.workInfo,
            ...(newJsonGenre ? { genre: newJsonGenre } : {}),
            label: newJsonLabel,
            title: effectiveTitle,
          });
          // unifiedViewerStore にも反映（TopNav「作品情報」ボタンが読み込み済みと表示される）
          const viewerStore = useUnifiedViewerStore.getState();
          viewerStore.setPresetJsonPath(jsonFilePath);
          viewerStore.setFontPresets([]); // 新規は空
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
  }, [sourcePath, destBase, extractedNumber, mode, copyDest, loadFolder, jsonMode, selectedJsonPath, newJsonGenre, newJsonLabel, newJsonTitle, sourceMode, multipleSources, additionalItems, newWorkTitle]);

  const saveAllSettings = () => {
    saveSetting("copyDest", copyDest);
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
            <h3 className="text-xs font-bold text-text-primary">設定</h3>

            {/* 組み込み構造の説明 */}
            <div className="p-3 bg-bg-tertiary rounded-lg space-y-2">
              <div className="text-[10px] font-medium text-text-primary">組み込みフォルダ階層（固定）</div>
              <div className="text-[9px] text-text-muted leading-relaxed">
                外部テンプレートフォルダへの依存を廃止し、コード内の定義を使用します。
                新作時はタイトル階層と巻数階層を、続話時は巻数階層のみを作成します。
              </div>

              <div className="pt-2 border-t border-border/30">
                <div className="text-[9px] font-bold text-accent mb-1">新作 — タイトル階層</div>
                <div className="flex flex-wrap gap-1 mb-2">
                  {NEW_TITLE_LEVEL_FOLDERS.map((f) => (
                    <span key={f} className="px-1.5 py-0.5 text-[9px] bg-accent/10 text-accent rounded">{f}</span>
                  ))}
                </div>
                <div className="text-[9px] font-bold text-accent mb-1">新作 — 巻数階層</div>
                <div className="flex flex-wrap gap-1">
                  {NEW_VOLUME_LEVEL_FOLDERS.map((f) => (
                    <span key={f} className="px-1.5 py-0.5 text-[9px] bg-accent/10 text-accent rounded">{f}</span>
                  ))}
                </div>
              </div>

              <div className="pt-2 border-t border-border/30">
                <div className="text-[9px] font-bold text-accent-secondary mb-1">続話 — 巻数階層</div>
                <div className="flex flex-wrap gap-1">
                  {SEQUEL_VOLUME_LEVEL_FOLDERS.map((f) => (
                    <span key={f} className="px-1.5 py-0.5 text-[9px] bg-accent-secondary/10 text-accent-secondary rounded">{f}</span>
                  ))}
                </div>
              </div>
            </div>

            {/* コピー先サブフォルダ */}
            <div>
              <label className="text-[9px] text-text-muted block mb-1">コピー先サブフォルダ名（1_入稿 の子階層に配置）</label>
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
            <span className="text-xs font-medium text-text-primary">コピー元</span>
            {/* ソース種別切替 */}
            <div className="ml-auto flex bg-bg-tertiary rounded-lg p-0.5">
              <button
                onClick={() => setSourceMode("single")}
                className={`px-2 py-0.5 text-[10px] rounded-md transition-colors ${sourceMode === "single" ? "bg-accent text-white font-medium" : "text-text-muted hover:text-text-primary"}`}
              >
                単一メイン
              </button>
              <button
                onClick={() => setSourceMode("multiple")}
                className={`px-2 py-0.5 text-[10px] rounded-md transition-colors ${sourceMode === "multiple" ? "bg-accent-secondary text-white font-medium" : "text-text-muted hover:text-text-primary"}`}
              >
                複数メイン
              </button>
            </div>
          </div>

          {sourceMode === "single" ? (
            <>
              {/* 単一モード: メインフォルダ */}
              <div className="flex gap-2">
                <input type="text" value={sourcePath} onChange={(e) => handleSourceChange(e.target.value)}
                  className="flex-1 text-[10px] px-2 py-1.5 bg-bg-primary border border-border/50 rounded text-text-primary outline-none font-mono" placeholder="フォルダパスを貼り付け..." />
                <button onClick={handlePaste} className="px-2 py-1.5 text-[10px] bg-bg-tertiary border border-border/50 rounded hover:bg-bg-elevated text-text-secondary">貼付</button>
                <button onClick={handleBrowseSource} className="px-2 py-1.5 text-[10px] bg-bg-tertiary border border-border/50 rounded hover:bg-bg-elevated text-text-secondary">参照</button>
              </div>
              {/* 巻数入力（新作・続話 両モードで表示、フォルダ名から自動抽出） */}
              <div className="flex items-center gap-2 text-[10px]">
                <span className="text-text-muted">巻数:</span>
                <input type="text" value={extractedNumber} onChange={(e) => setExtractedNumber(e.target.value)}
                  className="w-20 px-2 py-0.5 border border-border/50 rounded text-text-primary outline-none text-center" placeholder={mode === "new" ? "1" : "1"} />
                <span className="text-text-muted/60 text-[9px]">※ コピー元フォルダ名から自動抽出（手動修正可）</span>
              </div>
              {/* 追加アイテムセクション */}
              <div className="pt-2 mt-2 border-t border-border/30 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-text-muted font-medium">追加アイテム（任意）</span>
                  <span className="text-[9px] text-text-muted/60">メインフォルダと同じ階層にコピー</span>
                  <div className="ml-auto flex gap-1">
                    <button onClick={handleAddAdditionalFolder} className="px-2 py-0.5 text-[9px] bg-accent/10 hover:bg-accent/20 text-accent border border-accent/20 rounded transition-colors">+ フォルダ</button>
                    <button onClick={handleAddAdditionalFile} className="px-2 py-0.5 text-[9px] bg-accent-secondary/10 hover:bg-accent-secondary/20 text-accent-secondary border border-accent-secondary/20 rounded transition-colors">+ ファイル</button>
                  </div>
                </div>
                {additionalItems.length > 0 && (
                  <div className="space-y-0.5 max-h-24 overflow-y-auto">
                    {additionalItems.map((item, i) => (
                      <div key={i} className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[9px] bg-bg-tertiary">
                        <span className="text-[10px]">{item.isFolder ? "📁" : "📄"}</span>
                        <span className="text-text-primary truncate flex-1">{item.name}</span>
                        <span className="text-text-muted/60 truncate max-w-[200px] text-[8px]">{item.path}</span>
                        <button onClick={() => handleRemoveAdditional(i)} className="w-3.5 h-3.5 flex items-center justify-center text-text-muted/40 hover:text-error rounded">
                          <svg className="w-2 h-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              {/* 複数モード: 複数メインフォルダリスト */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-text-muted">メインフォルダ ({multipleSources.length}件)</span>
                <span className="text-[9px] text-text-muted/60">各フォルダに同じ階層構造を作成</span>
                <button onClick={handleAddMultipleSource} className="ml-auto px-2 py-0.5 text-[9px] bg-accent-secondary/10 hover:bg-accent-secondary/20 text-accent-secondary border border-accent-secondary/20 rounded transition-colors">+ フォルダ追加</button>
              </div>
              {multipleSources.length > 0 ? (
                <div className="space-y-0.5 max-h-32 overflow-y-auto">
                  {multipleSources.map((src, i) => {
                    const baseName = src.replace(/\\/g, "/").split("/").pop() || "";
                    return (
                      <div key={i} className="flex items-center gap-1.5 px-2 py-1 rounded text-[9px] bg-bg-tertiary">
                        <span className="text-[10px]">📁</span>
                        <span className="text-text-primary font-medium truncate">{baseName}</span>
                        <span className="text-text-muted/60 truncate max-w-[260px] text-[8px]">{src}</span>
                        <button onClick={() => handleRemoveMultipleSource(i)} className="ml-auto w-3.5 h-3.5 flex items-center justify-center text-text-muted/40 hover:text-error rounded">
                          <svg className="w-2 h-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-[9px] text-text-muted/60 italic">「+ フォルダ追加」で複数のメインフォルダを指定</div>
              )}
            </>
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
              新作<div className="text-[9px] text-text-muted mt-0.5">タイトル+巻数階層</div>
            </button>
            <button onClick={() => { setMode("sequel"); setJsonMode("select"); }}
              className={`flex-1 py-2.5 rounded-lg text-xs font-medium transition-all ${mode === "sequel" ? "bg-accent-secondary/15 text-accent-secondary border border-accent-secondary/30" : "bg-bg-tertiary text-text-secondary border border-border/50 hover:bg-bg-elevated"}`}>
              続話<div className="text-[9px] text-text-muted mt-0.5">巻数階層のみ</div>
            </button>
          </div>
          {/* 新作時: タイトル入力（フォルダ名 + JSON新規作成時のタイトル兼用） */}
          {mode === "new" && sourceMode === "single" && (
            <div className="space-y-1 pt-2 border-t border-border/30">
              <label className="text-[10px] text-text-muted font-medium block">作品タイトル <span className="text-error">*</span></label>
              <input
                type="text"
                value={newWorkTitle}
                onChange={(e) => {
                  setNewWorkTitle(e.target.value);
                  // JSON新規作成時のタイトルフィールドも同期
                  setNewJsonTitle(e.target.value);
                }}
                placeholder="作品のタイトルを入力..."
                className="w-full text-[11px] px-2 py-1.5 bg-bg-primary border border-border/50 rounded text-text-primary outline-none font-medium focus:border-accent/50"
              />
              <div className="text-[9px] text-text-muted/70">
                → フォルダ構成: <span className="font-mono text-text-secondary">{destBase || "{コピー先}"}\{newWorkTitle || "（未入力）"}\{extractedNumber || "1"}\...</span>
              </div>
            </div>
          )}
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
          {destBase && (
            <div className="text-[10px] text-text-muted font-mono space-y-0.5">
              {sourceMode === "single" && mode === "new" && (
                <div>
                  作成先: {destBase}\<span className="text-accent">{newWorkTitle || "（タイトル）"}</span>\{extractedNumber || "1"}\<span className="text-accent">{copyDest}</span>\{sourcePath.replace(/\\/g, "/").split("/").pop() || ""}
                </div>
              )}
              {sourceMode === "single" && mode === "sequel" && extractedNumber && (
                <div>
                  作成先: {destBase}\<span className="text-accent">{extractedNumber}</span>\<span className="text-accent">{copyDest}</span>\{sourcePath.replace(/\\/g, "/").split("/").pop() || ""}
                </div>
              )}
              {sourceMode === "multiple" && multipleSources.length > 0 && (
                <div>
                  <div>作成先（{multipleSources.length}件、各フォルダ毎に作成）:</div>
                  {multipleSources.slice(0, 3).map((src, i) => {
                    const baseName = src.replace(/\\/g, "/").split("/").pop() || "";
                    return (
                      <div key={i} className="truncate">
                        ・{destBase}\<span className="text-accent-secondary">{baseName}</span>\<span className="text-accent">{copyDest}</span>\{baseName}
                      </div>
                    );
                  })}
                  {multipleSources.length > 3 && <div className="text-text-muted/50">...他 {multipleSources.length - 3}件</div>}
                </div>
              )}
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
