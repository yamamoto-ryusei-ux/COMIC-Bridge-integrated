import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { usePsdStore } from "../../store/psdStore";
import { useViewStore, validateAndSetABPath, showPromptDialog, type AppView } from "../../store/viewStore";
import { useUnifiedViewerStore } from "../../store/unifiedViewerStore";
import { parseComicPotText } from "../unified-viewer/utils";
import { useScanPsdStore } from "../../store/scanPsdStore";
import { usePsdLoader } from "../../hooks/usePsdLoader";
import { useTextExtract } from "../../hooks/useTextExtract";
import type { PsdFile } from "../../types";

// ═══════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════

interface FileContextMenuProps {
  x: number;
  y: number;
  files: PsdFile[];       // right-clicked / selected files
  allFiles: PsdFile[];    // all loaded files
  onClose: () => void;
  onLaunchTachimi?: () => void;
  /** ビューアーモード: カット/コピー/複製/削除/読み込みを非表示 */
  viewerMode?: boolean;
  /** 右プレビューに表示中のテキストファイル情報 */
  previewText?: { name: string; path: string; content: string } | null;
  /** 選択中の非PSDアイテム（"folder:名前" or "file:名前"） */
  selectedNonPsdItem?: string | null;
  /** 現在のフォルダパス */
  currentFolderPath?: string | null;
}

interface MenuItem {
  label: string;
  shortcut?: string;
  icon?: string;
  disabled?: boolean;
  onClick?: () => void;
  children?: MenuItem[];
  separator?: boolean;
}

// ═══════════════════════════════════════════════════
// SubMenu component (recursive)
// ═══════════════════════════════════════════════════

function SubMenu({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  return (
    <>
      {items.map((item, i) => {
        if (item.separator) {
          return <div key={`sep-${i}`} className="border-t border-border/40 my-1" />;
        }
        if (item.children) {
          return <SubMenuItem key={item.label} item={item} onClose={onClose} />;
        }
        return (
          <button
            key={item.label}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-left transition-colors rounded-md ${
              item.disabled
                ? "text-text-muted/40 cursor-default"
                : "text-text-primary hover:bg-accent/8 hover:text-accent"
            }`}
            disabled={item.disabled}
            onClick={() => {
              onClose();
              if (item.onClick) item.onClick();
            }}
          >
            {item.icon && <span className="w-4 text-center text-xs flex-shrink-0">{item.icon}</span>}
            <span className="flex-1">{item.label}</span>
            {item.shortcut && (
              <span className="text-[9px] text-text-muted/50 ml-2">{item.shortcut}</span>
            )}
          </button>
        );
      })}
    </>
  );
}

function SubMenuItem({ item, onClose }: { item: MenuItem; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const [showSub, setShowSub] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleEnter = useCallback(() => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    setShowSub(true);
    // 位置clamp
    requestAnimationFrame(() => {
      if (!ref.current || !subRef.current) return;
      const sub = subRef.current;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      sub.style.left = "100%"; sub.style.right = "auto"; sub.style.top = "0px";
      const r1 = sub.getBoundingClientRect();
      if (r1.right > vw) { sub.style.left = "auto"; sub.style.right = "100%"; }
      const r2 = sub.getBoundingClientRect();
      if (r2.bottom > vh) sub.style.top = `${vh - r2.bottom - 8}px`;
      const r3 = sub.getBoundingClientRect();
      if (r3.top < 0) sub.style.top = `${-r3.top + 8}px`;
    });
  }, []);

  const handleLeave = useCallback(() => {
    closeTimer.current = setTimeout(() => setShowSub(false), 300);
  }, []);

  return (
    <div ref={ref} className="relative" onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
      <div
        className={`w-full flex items-center gap-2 px-3 py-1.5 text-[11px] rounded-md transition-colors ${
          item.disabled
            ? "text-text-muted/40 cursor-default"
            : showSub ? "bg-accent/8 text-accent" : "text-text-primary hover:bg-accent/8 hover:text-accent cursor-pointer"
        }`}
      >
        {item.icon && <span className="w-4 text-center text-xs flex-shrink-0">{item.icon}</span>}
        <span className="flex-1">{item.label}</span>
        <svg className="w-3 h-3 text-text-muted/50 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>
      {/* Sub-menu */}
      <div
        ref={subRef}
        className={`absolute top-0 left-full z-50 min-w-[180px] bg-white rounded-xl shadow-elevated border border-border/60 p-1.5 ${showSub ? "block" : "hidden"}`}
        style={{ marginLeft: "2px" }}
      >
        <SubMenu items={item.children!} onClose={onClose} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// Main Context Menu
// ═══════════════════════════════════════════════════

export function FileContextMenu({
  x,
  y,
  files: targetFiles,
  allFiles,
  onClose,
  onLaunchTachimi,
  viewerMode,
  previewText,
  selectedNonPsdItem,
  currentFolderPath,
}: FileContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const { loadFolder } = usePsdLoader();
  const textExtract = useTextExtract();

  // Close on outside click / Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handleClick, true);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handleClick, true);
    };
  }, [onClose]);

  // Position clamp — 初回レンダリング後 + DOM変化時にも再計算
  useEffect(() => {
    const clamp = () => {
      if (!menuRef.current) return;
      const el = menuRef.current;
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (rect.right > vw) el.style.left = `${Math.max(8, vw - rect.width - 8)}px`;
      if (rect.bottom > vh) el.style.top = `${Math.max(8, vh - rect.height - 8)}px`;
      if (rect.left < 0) el.style.left = "8px";
      if (rect.top < 0) el.style.top = "8px";
    };
    // 初回 + rAFで確実にレイアウト確定後に実行
    clamp();
    requestAnimationFrame(clamp);
  }, [x, y]);

  const hasPdf = targetFiles.some((f) => f.fileName.toLowerCase().endsWith(".pdf") || f.pdfSourcePath);
  const singleFile = targetFiles.length === 1 ? targetFiles[0] : null;
  const isSingleTxt = singleFile?.fileName.toLowerCase().endsWith(".txt");

  // 選択中のフォルダ/ファイルのフルパス
  const selectedFolderName = selectedNonPsdItem?.startsWith("folder:") ? selectedNonPsdItem.slice(7) : null;
  const selectedFileName = selectedNonPsdItem?.startsWith("file:") ? selectedNonPsdItem.slice(5) : null;
  const selectedItemPath = selectedFolderName && currentFolderPath
    ? `${currentFolderPath}\\${selectedFolderName}`
    : selectedFileName && currentFolderPath
      ? `${currentFolderPath}\\${selectedFileName}`
      : null;
  const hasNonPsdSelection = !!selectedItemPath;

  // ── Actions ──

  const openInPhotoshop = useCallback(async () => {
    for (const f of targetFiles) {
      await invoke("open_file_in_photoshop", { filePath: f.filePath }).catch(() => {});
    }
  }, [targetFiles]);

  const openInMojiQ = useCallback(async () => {
    for (const f of targetFiles) {
      const pdfPath = f.pdfSourcePath || f.filePath;
      if (pdfPath.toLowerCase().endsWith(".pdf")) {
        await invoke("open_pdf_in_mojiq", { pdfPath, page: f.pdfPageIndex != null ? f.pdfPageIndex + 1 : null }).catch(() => {});
      }
    }
  }, [targetFiles]);

  const openFileLocation = useCallback(async () => {
    const paths = targetFiles.map((f) => f.filePath);
    await invoke("reveal_files_in_explorer", { filePaths: paths }).catch(() => {});
  }, [targetFiles]);

  const cutFiles = useCallback(async () => {
    const paths = targetFiles.map((f) => f.filePath).join("\n");
    await navigator.clipboard.writeText(paths).catch(() => {});
    // Remove from store
    const store = usePsdStore.getState();
    for (const f of targetFiles) {
      store.removeFile(f.id);
    }
  }, [targetFiles]);

  const copyFiles = useCallback(async () => {
    const paths = targetFiles.map((f) => f.filePath).join("\n");
    await navigator.clipboard.writeText(paths).catch(() => {});
  }, [targetFiles]);

  const duplicateFiles = useCallback(async () => {
    const paths = targetFiles.map((f) => f.filePath);
    try {
      const results = await invoke<string[]>("duplicate_files", { filePaths: paths });
      // Reload folder to pick up new files
      const currentFolder = usePsdStore.getState().currentFolderPath;
      if (currentFolder) {
        await loadFolder(currentFolder);
      }
      console.log("Duplicated:", results);
    } catch (e) {
      console.error("Duplicate failed:", e);
    }
  }, [targetFiles, loadFolder]);

  const deleteFiles = useCallback(() => {
    const store = usePsdStore.getState();
    for (const f of targetFiles) {
      store.removeFile(f.id);
    }
  }, [targetFiles]);

  const navigateTo = useCallback((view: AppView) => {
    useViewStore.getState().setActiveView(view);
  }, []);

  const handleTextExtract = useCallback(async () => {
    await textExtract.handleExtract();
  }, [textExtract]);

  const handleLoadFolder = useCallback(async () => {
    const path = await dialogOpen({ directory: true, multiple: false });
    if (path) {
      await loadFolder(path as string);
    }
  }, [loadFolder]);

  const handleLoadText = useCallback(async () => {
    const path = await dialogOpen({ filters: [{ name: "テキスト", extensions: ["txt"] }], multiple: false });
    if (!path) return;
    try {
      const bytes = await readFile(path as string);
      const content = new TextDecoder("utf-8").decode(bytes);
      const viewerStore = useUnifiedViewerStore.getState();
      viewerStore.setTextContent(content);
      viewerStore.setTextFilePath(path as string);
    } catch { /* ignore */ }
  }, []);

  /** 右クリック対象のtxtファイルを直接テキストとして読み込み */
  const handleLoadThisText = useCallback(async () => {
    if (!singleFile?.filePath) return;
    try {
      const content = await invoke<string>("read_text_file", { filePath: singleFile.filePath });
      const viewerStore = useUnifiedViewerStore.getState();
      viewerStore.setTextContent(content);
      viewerStore.setTextFilePath(singleFile.filePath);
      viewerStore.setIsDirty(false);
      const { header, pages } = parseComicPotText(content);
      viewerStore.setTextHeader(header);
      viewerStore.setTextPages(pages);
    } catch { /* ignore */ }
  }, [singleFile]);

  /** プレビュー中のテキストをセリフテキストとして読み込み */
  const handleLoadPreviewText = useCallback(() => {
    if (!previewText) return;
    const vs = useUnifiedViewerStore.getState();
    vs.setTextContent(previewText.content);
    vs.setTextFilePath(previewText.path);
    vs.setIsDirty(false);
    const { header, pages } = parseComicPotText(previewText.content);
    vs.setTextHeader(header);
    vs.setTextPages(pages);
  }, [previewText]);

  // ── フォルダ/ファイル選択時のアクション ──

  const openSelectedItemLocation = useCallback(async () => {
    if (!selectedItemPath) return;
    if (selectedFolderName) {
      await invoke("open_folder_in_explorer", { folderPath: selectedItemPath }).catch(() => {});
    } else {
      await invoke("reveal_files_in_explorer", { filePaths: [selectedItemPath] }).catch(() => {});
    }
  }, [selectedItemPath, selectedFolderName]);

  const copySelectedItemPath = useCallback(async () => {
    if (!selectedItemPath) return;
    await navigator.clipboard.writeText(selectedItemPath).catch(() => {});
  }, [selectedItemPath]);

  /** フォルダ内のPSDファイ��をPhotoshopで開く */
  const openFolderPsdsInPhotoshop = useCallback(async () => {
    if (!selectedItemPath) return;
    try {
      const fileList = await invoke<string[]>("list_folder_files", { folderPath: selectedItemPath, recursive: false });
      const psdExts = [".psd", ".psb"];
      const psds = fileList.filter((f) => psdExts.some((e) => f.toLowerCase().endsWith(e)));
      for (const p of psds) await invoke("open_file_in_photoshop", { filePath: p }).catch(() => {});
    } catch { /* ignore */ }
  }, [selectedItemPath]);

  /** フォルダ内のPSDファイルを読み込んでPDF作成(Tachimi)起動 */
  const launchTachimiForFolder = useCallback(async () => {
    if (!selectedItemPath) return;
    try {
      // フォルダ内ファイル一覧を取得してPSD/画像のみ抽出
      const fileList = await invoke<string[]>("list_folder_files", { folderPath: selectedItemPath, recursive: false });
      const supportedExts = [".psd", ".psb", ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".gif", ".pdf", ".eps"];
      const targets = fileList.filter((f) => supportedExts.some((e) => f.toLowerCase().endsWith(e)));
      if (targets.length === 0) { alert("フォルダ内に対応ファイルがありません"); return; }
      // フォルダを読み込んでTachimi起動
      await loadFolder(selectedItemPath);
      if (onLaunchTachimi) onLaunchTachimi();
    } catch { /* ignore */ }
  }, [selectedItemPath, loadFolder, onLaunchTachimi]);

  const handleLoadCheckJson = useCallback(async () => {
    const path = await dialogOpen({
      filters: [{ name: "JSON", extensions: ["json"] }],
      multiple: false,
    });
    if (!path) return;
    try {
      const content = await invoke<string>("read_text_file", { filePath: path as string });
      const data = JSON.parse(content);
      const allItems: { picked: boolean; category: string; page: string; excerpt: string; content: string; checkKind: "correctness" | "proposal" }[] = [];
      const parse = (src: any, fallbackKind: "correctness" | "proposal") => {
        const arr = Array.isArray(src) ? src : Array.isArray(src?.items) ? src.items : null;
        if (!arr) return;
        for (const item of arr)
          allItems.push({
            picked: false,
            category: item.category || "",
            page: item.page || "",
            excerpt: item.excerpt || "",
            content: item.content || item.text || "",
            checkKind: item.checkKind || fallbackKind,
          });
      };
      if (data.checks) {
        parse(data.checks.simple, "correctness");
        parse(data.checks.variation, "proposal");
      } else if (Array.isArray(data)) {
        parse(data, "correctness");
      }
      const viewerStore = useUnifiedViewerStore.getState();
      viewerStore.setCheckData({
        title: data.work || "",
        fileName: (path as string).substring((path as string).lastIndexOf("\\") + 1),
        filePath: path as string,
        allItems,
        correctnessItems: allItems.filter((i) => i.checkKind === "correctness"),
        proposalItems: allItems.filter((i) => i.checkKind === "proposal"),
      });
    } catch { /* ignore */ }
  }, []);

  const handleLoadPresetJson = useCallback(async () => {
    const path = await dialogOpen({
      filters: [{ name: "JSON", extensions: ["json"] }],
      multiple: false,
    });
    if (!path) return;
    try {
      const content = await invoke<string>("read_text_file", { filePath: path as string });
      const data = JSON.parse(content);
      const presets: { font: string; name: string; subName: string }[] = [];
      const presetsObj = data?.presetData?.presets ?? data?.presets ?? data?.presetSets ?? data;
      if (typeof presetsObj === "object" && presetsObj !== null) {
        const entries = Array.isArray(presetsObj) ? [["", presetsObj]] : Object.entries(presetsObj);
        for (const [, arr] of entries) {
          if (!Array.isArray(arr)) continue;
          for (const p of arr as any[])
            if (p?.font || p?.postScriptName)
              presets.push({
                font: p.font || p.postScriptName,
                name: p.name || p.displayName || "",
                subName: p.subName || "",
              });
        }
      }
      if (presets.length > 0) {
        const viewerStore = useUnifiedViewerStore.getState();
        viewerStore.setFontPresets(presets);
        viewerStore.setPresetJsonPath(path as string);
      }
    } catch { /* ignore */ }
  }, []);

  const handleRenameYYYYMMDD = useCallback(async () => {
    if (targetFiles.length === 0) return;

    const workInfo = useScanPsdStore.getState().workInfo;
    const now = new Date();
    const yyyymmdd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    const genre = workInfo.genre || "ジャンル";
    const title = workInfo.title || "タイトル";
    // フォルダ名から巻数を検出
    const folderName = usePsdStore.getState().currentFolderPath?.split("\\").pop() || "";
    const volMatch = folderName.match(/(\d+)/);
    const volume = volMatch ? volMatch[1] : "巻";

    const entries = targetFiles.map((f, i) => {
      const ext = f.fileName.substring(f.fileName.lastIndexOf("."));
      const num = String(i + 1).padStart(3, "0");
      const newName = `${yyyymmdd}_${genre}_${title}_${volume}_${num}${ext}`;
      return { sourcePath: f.filePath, newName: newName };
    });

    try {
      await invoke("batch_rename_files", { entries, outputDirectory: null, mode: "overwrite" });
      const undoEntries = entries.map((e) => {
        const dir = e.sourcePath.substring(0, e.sourcePath.lastIndexOf("\\"));
        return { oldPath: e.sourcePath, newPath: `${dir}\\${e.newName}` };
      });
      usePsdStore.getState().pushFileOpsUndo({ type: "rename", entries: undoEntries });
    } catch (e) {
      console.error("Rename failed:", e);
    }
    try {
      const currentFolder = usePsdStore.getState().currentFolderPath;
      if (currentFolder) await loadFolder(currentFolder);
      usePsdStore.getState().triggerRefresh();
    } catch {
    }
  }, [targetFiles, loadFolder]);

  const handleRenameSingle = useCallback(async () => {
    const file = singleFile || targetFiles[0];
    if (!file) return;
    const newName = await showPromptDialog("新しいファイル名", file.fileName);
    if (!newName || newName === file.fileName) return;
    const dir = file.filePath.substring(0, file.filePath.lastIndexOf("\\"));
    const currentFolder = usePsdStore.getState().currentFolderPath;
    try {
      // キャッシュ無効化（ファイルハンドル解放）
      await invoke("invalidate_file_cache", { filePath: file.filePath }).catch(() => {});
      await invoke("clear_psd_cache").catch(() => {});
      // リネーム実行
      const results = await invoke<{ success: boolean; error?: string }[]>("batch_rename_files", {
        entries: [{ sourcePath: file.filePath, newName: newName }],
        outputDirectory: null,
        mode: "overwrite",
      });
      if (results[0]?.success) {
        usePsdStore.getState().pushFileOpsUndo({
          type: "rename",
          entries: [{ oldPath: file.filePath, newPath: `${dir}\\${newName}` }],
        });
      } else {
        console.error("Rename failed:", results[0]?.error);
      }
    } catch (e) {
      console.error("Rename invoke failed:", e);
    }
    // 再読み込み
    if (currentFolder) {
      try { await loadFolder(currentFolder); } catch { /* ignore */ }
    }
    usePsdStore.getState().triggerRefresh();
  }, [singleFile, targetFiles, loadFolder]);

  // ── Menu structure ──

  // フォルダ/非PSDファイル選択時のメニュー（PSD未選択時）
  const nonPsdMenuItems: MenuItem[] = hasNonPsdSelection && targetFiles.length === 0 ? [
    ...(selectedFolderName ? [
      {
        label: "フォルダを開く",
        icon: "📂",
        onClick: openSelectedItemLocation,
      },
      {
        label: "フォルダ内をPsで開く",
        icon: "🎨",
        onClick: openFolderPsdsInPhotoshop,
      },
      {
        label: "PDF作成（フォルダ内）",
        icon: "📑",
        onClick: launchTachimiForFolder,
      },
      { separator: true, label: "sep-ab-folder" },
      {
        label: "A/B比較",
        icon: "🔍",
        children: [
          { label: "Aにセット", icon: "🅰️", onClick: () => { if (selectedItemPath) validateAndSetABPath("A", selectedItemPath); } },
          { label: "Bにセット", icon: "🅱️", onClick: () => { if (selectedItemPath) validateAndSetABPath("B", selectedItemPath); } },
        ],
      },
    ] : [
      {
        label: "ファイルの場所を開く",
        icon: "📂",
        onClick: openSelectedItemLocation,
      },
    ]),
    // プレビュー中のテキストを読み込み
    ...(previewText ? [{
      label: `「${previewText.name}」をテキストとして読み込み`,
      icon: "📝",
      onClick: handleLoadPreviewText,
    }] : []),
    { separator: true, label: "sep-np1" },
    {
      label: "カット",
      icon: "✂️",
      onClick: async () => {
        if (!selectedItemPath) return;
        await navigator.clipboard.writeText(selectedItemPath).catch(() => {});
        try {
          const backupPath = await invoke<string>("backup_to_temp", { sourcePath: selectedItemPath });
          await invoke("delete_file", { filePath: selectedItemPath });
          usePsdStore.getState().pushFileOpsUndo({ type: "cut", backupPath, originalPath: selectedItemPath });
        } catch { /* ignore */ }
        const folder = usePsdStore.getState().currentFolderPath;
        if (folder) await loadFolder(folder);
        usePsdStore.getState().triggerRefresh();
      },
    },
    {
      label: "コピー",
      icon: "📋",
      onClick: copySelectedItemPath,
    },
    {
      label: "複製",
      icon: "📄",
      onClick: async () => {
        if (!selectedItemPath) return;
        let createdPath = "";
        try {
          if (selectedFolderName) {
            const parent = selectedItemPath.substring(0, selectedItemPath.lastIndexOf("\\"));
            let destName = `${selectedFolderName}_copy`;
            let dest = `${parent}\\${destName}`;
            let counter = 2;
            while (await invoke<boolean>("path_exists", { path: dest })) {
              destName = `${selectedFolderName}_copy${counter}`;
              dest = `${parent}\\${destName}`;
              counter++;
            }
            await invoke("copy_folder", { source: selectedItemPath, destination: dest });
            createdPath = dest;
          } else {
            const results = await invoke<string[]>("duplicate_files", { filePaths: [selectedItemPath] });
            if (results.length > 0 && !results[0].startsWith("Error")) createdPath = results[0];
          }
          if (createdPath) {
            usePsdStore.getState().pushFileOpsUndo({ type: "duplicate", backupPath: "", originalPath: createdPath });
          }
        } catch { /* ignore */ }
        const folder = usePsdStore.getState().currentFolderPath;
        if (folder) await loadFolder(folder);
        usePsdStore.getState().triggerRefresh();
      },
    },
    {
      label: "削除",
      icon: "🗑️",
      onClick: async () => {
        if (!selectedItemPath) return;
        if (!window.confirm(`「${selectedFolderName || selectedFileName}」を削除しますか？`)) return;
        try {
          const backupPath = await invoke<string>("backup_to_temp", { sourcePath: selectedItemPath });
          await invoke("delete_file", { filePath: selectedItemPath });
          usePsdStore.getState().pushFileOpsUndo({ type: "delete", backupPath, originalPath: selectedItemPath });
        } catch { /* ignore */ }
        const folder = usePsdStore.getState().currentFolderPath;
        if (folder) await loadFolder(folder);
        usePsdStore.getState().triggerRefresh();
      },
    },
    {
      label: "リネーム",
      icon: "✏️",
      children: [
        {
          label: "名前を変更",
          icon: "📝",
          onClick: async () => {
            if (!selectedItemPath) return;
            const name = selectedFolderName || selectedFileName || "";
            const newName = await showPromptDialog("新しい名前", name);
            if (!newName || newName === name) return;
            const dir = selectedItemPath.substring(0, selectedItemPath.lastIndexOf("\\"));
            try {
              await invoke("invalidate_file_cache", { filePath: selectedItemPath }).catch(() => {});
              await invoke("batch_rename_files", {
                entries: [{ sourcePath: selectedItemPath, newName: newName }],
                outputDirectory: null,
                mode: "overwrite",
              });
              usePsdStore.getState().pushFileOpsUndo({
                type: "rename",
                entries: [{ oldPath: selectedItemPath, newPath: `${dir}\\${newName}` }],
              });
            } catch { /* ignore */ }
            const folder = usePsdStore.getState().currentFolderPath;
            if (folder) await loadFolder(folder);
            usePsdStore.getState().triggerRefresh();
          },
        },
        {
          label: "yyyymmdd_ジャンル_タイトル_巻",
          icon: "📅",
          onClick: async () => {
            if (!selectedItemPath) return;
            const name = selectedFolderName || selectedFileName || "";
            // 依頼準備と同じロジックでZIP名を生成
            const scanWork = useScanPsdStore.getState().workInfo;
            const scanJson = useScanPsdStore.getState().currentJsonFilePath;
            const presetJson = useUnifiedViewerStore.getState().presetJsonPath;
            const now = new Date();
            const yyyymmdd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
            const genre = scanWork.genre || "";
            let title = scanWork.title || "";
            if (!title) {
              const jp = scanJson || presetJson || "";
              if (jp) title = (jp.replace(/\\/g, "/").split("/").pop() || "").replace(/\.json$/i, "");
            }
            // フォルダ名から巻数を抽出（常にフォルダ名優先）
            const volMatch = name.match(/(\d+)/);
            const vol = volMatch ? volMatch[1] : "1";
            const suggested = genre || title
              ? `${yyyymmdd}_${genre || "ジャンル"}_${title || "タイトル"}_${vol}巻`
              : `${yyyymmdd}_${name}`;
            const newName = await showPromptDialog("新しい名前", suggested);
            if (!newName || newName === name) return;
            const dir = selectedItemPath.substring(0, selectedItemPath.lastIndexOf("\\"));
            try {
              await invoke("invalidate_file_cache", { filePath: selectedItemPath }).catch(() => {});
              await invoke("batch_rename_files", {
                entries: [{ sourcePath: selectedItemPath, newName: newName }],
                outputDirectory: null,
                mode: "overwrite",
              });
              usePsdStore.getState().pushFileOpsUndo({
                type: "rename",
                entries: [{ oldPath: selectedItemPath, newPath: `${dir}\\${newName}` }],
              });
            } catch { /* ignore */ }
            const folder = usePsdStore.getState().currentFolderPath;
            if (folder) await loadFolder(folder);
            usePsdStore.getState().triggerRefresh();
          },
        },
      ],
    },
    { separator: true, label: "sep-np2" },
    {
      label: "読み込み",
      icon: "📥",
      children: [
        { label: "別の作品を読み込み", icon: "📂", onClick: handleLoadFolder },
        { label: "セリフテキスト読み込み", icon: "📄", onClick: handleLoadText },
        { label: "校正JSON読み込み", icon: "📊", onClick: handleLoadCheckJson },
        { label: "作品JSON読み込み", icon: "📋", onClick: handleLoadPresetJson },
      ],
    },
  ] : [];

  const menuItems: MenuItem[] = nonPsdMenuItems.length > 0 ? nonPsdMenuItems : [
    {
      label: "Psで開く",
      shortcut: "P",
      icon: "🎨",
      onClick: openInPhotoshop,
      disabled: targetFiles.length === 0,
    },
    {
      label: "MojiQで開く",
      shortcut: "M",
      icon: "📖",
      onClick: openInMojiQ,
      disabled: !hasPdf,
    },
    {
      label: "ファイルの場所を開く",
      icon: "📂",
      onClick: openFileLocation,
      disabled: targetFiles.length === 0,
    },
    // txtファイル: セリフテキストとして読み込み
    ...(isSingleTxt ? [{
      label: "セリフテキストとして読み込み",
      icon: "📝",
      onClick: handleLoadThisText,
    }] : []),
    // プレビュー中のテキストを読み込み
    ...(!isSingleTxt && previewText ? [{
      label: `「${previewText.name}」をテキストとして読み込み`,
      icon: "📝",
      onClick: handleLoadPreviewText,
    }] : []),
    { separator: true, label: "sep1" },
    {
      label: "カット",
      icon: "✂️",
      onClick: cutFiles,
      disabled: targetFiles.length === 0,
    },
    {
      label: "コピー",
      icon: "📋",
      onClick: copyFiles,
      disabled: targetFiles.length === 0,
    },
    {
      label: "複製",
      icon: "📄",
      onClick: duplicateFiles,
      disabled: targetFiles.length === 0,
    },
    {
      label: "削除",
      icon: "🗑️",
      onClick: deleteFiles,
      disabled: targetFiles.length === 0,
    },
    { separator: true, label: "sep2" },
    {
      label: "PDF作成",
      icon: "📑",
      onClick: onLaunchTachimi,
      disabled: allFiles.length === 0,
    },
    {
      label: "TIFF作成",
      icon: "🖼️",
      onClick: () => navigateTo("tiff"),
    },
    {
      label: "テキスト抽出",
      icon: "📝",
      onClick: handleTextExtract,
      disabled: textExtract.psdFiles.length === 0,
    },
    {
      label: "編集",
      icon: "🔧",
      children: [
        { label: "差し替え", icon: "🔄", onClick: () => navigateTo("replace") },
        { label: "見開き分割", icon: "📐", onClick: () => navigateTo("split") },
        { label: "レイヤー制御", icon: "📚", onClick: () => navigateTo("layers") },
      ],
    },
    {
      label: "リネーム",
      icon: "✏️",
      children: [
        {
          label: "このファイルをリネーム",
          icon: "📝",
          onClick: handleRenameSingle,
          disabled: targetFiles.length === 0,
        },
        { label: "バッチでリネーム", icon: "📋", onClick: () => navigateTo("rename") },
        {
          label: "yyyymmdd_ジャンル_タイトル_巻",
          icon: "📅",
          onClick: handleRenameYYYYMMDD,
          disabled: targetFiles.length === 0,
        },
      ],
    },
    {
      label: "圧縮",
      icon: "📦",
      onClick: () => navigateTo("requestPrep" as any),
    },
    {
      label: "A/B比較",
      icon: "🔍",
      children: [
        { label: "Aにセット", icon: "🅰️", onClick: () => {
          const path = singleFile?.filePath ? (singleFile.filePath.substring(0, singleFile.filePath.lastIndexOf("\\"))) : usePsdStore.getState().currentFolderPath;
          if (path) validateAndSetABPath("A", path);
        }},
        { label: "Bにセット", icon: "🅱️", onClick: () => {
          const path = singleFile?.filePath ? (singleFile.filePath.substring(0, singleFile.filePath.lastIndexOf("\\"))) : usePsdStore.getState().currentFolderPath;
          if (path) validateAndSetABPath("B", path);
        }},
      ],
    },
    { separator: true, label: "sep3" },
    {
      label: "読み込み",
      icon: "📥",
      children: [
        { label: "別の作品を読み込み", icon: "📂", onClick: handleLoadFolder },
        { label: "セリフテキスト読み込み", icon: "📄", onClick: handleLoadText },
        { label: "校正JSON読み込み", icon: "📊", onClick: handleLoadCheckJson },
        { label: "作品JSON読み込み", icon: "📋", onClick: handleLoadPresetJson },
      ],
    },
  ];

  // ビューアーモード: カット/コピー/複製/削除/読み込みを除外
  const filteredMenuItems = viewerMode
    ? menuItems.filter((item) => {
        if (item.separator) return true;
        const hidden = ["カット", "コピー", "複製", "削除", "読み込み"];
        return !hidden.includes(item.label);
      }).filter((item, i, arr) => {
        // 連続するセパレータや先頭/末尾のセパレータを除去
        if (item.separator && (i === 0 || i === arr.length - 1)) return false;
        if (item.separator && arr[i - 1]?.separator) return false;
        return true;
      })
    : menuItems;

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[9999] min-w-[200px] max-w-[280px] bg-white rounded-xl shadow-elevated border border-border/60 p-1.5 select-none"
      style={{ left: x, top: y }}
    >
      <SubMenu items={filteredMenuItems} onClose={onClose} />
    </div>,
    document.body,
  );
}
