import { useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { usePsdStore } from "../../store/psdStore";
import { useViewStore, type AppView } from "../../store/viewStore";
import { useUnifiedViewerStore } from "../../store/unifiedViewerStore";
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
              if (item.onClick) item.onClick();
              onClose();
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

  // Position submenu to the right, flip left if no space
  useEffect(() => {
    if (!ref.current || !subRef.current) return;
    const parentRect = ref.current.getBoundingClientRect();
    const sub = subRef.current;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Horizontal
    if (parentRect.right + sub.offsetWidth > vw) {
      sub.style.left = "auto";
      sub.style.right = "100%";
    } else {
      sub.style.left = "100%";
      sub.style.right = "auto";
    }
    // Vertical clamp
    const subRect = sub.getBoundingClientRect();
    if (subRect.bottom > vh) {
      sub.style.top = `${vh - subRect.bottom - 4}px`;
    }
  }, []);

  return (
    <div ref={ref} className="relative group/sub">
      <div
        className={`w-full flex items-center gap-2 px-3 py-1.5 text-[11px] rounded-md transition-colors ${
          item.disabled
            ? "text-text-muted/40 cursor-default"
            : "text-text-primary hover:bg-accent/8 hover:text-accent cursor-pointer"
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
        className="absolute top-0 left-full hidden group-hover/sub:block z-50 min-w-[180px] bg-white rounded-xl shadow-elevated border border-border/60 p-1.5"
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

  // Position clamp
  useEffect(() => {
    if (!menuRef.current) return;
    const el = menuRef.current;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (rect.right > vw) el.style.left = `${vw - rect.width - 8}px`;
    if (rect.bottom > vh) el.style.top = `${vh - rect.height - 8}px`;
  }, []);

  const hasPdf = targetFiles.some((f) => f.fileName.toLowerCase().endsWith(".pdf") || f.pdfSourcePath);
  const singleFile = targetFiles.length === 1 ? targetFiles[0] : null;

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

    // Get workInfo from scanPsdStore
    const workInfo = useScanPsdStore.getState().workInfo;
    const now = new Date();
    const yyyymmdd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    const genre = workInfo.genre || "ジャンル";
    const title = workInfo.title || "タイトル";
    const volume = workInfo.volume ? String(workInfo.volume) : "巻";

    const entries = targetFiles.map((f, i) => {
      const ext = f.fileName.substring(f.fileName.lastIndexOf("."));
      const num = String(i + 1).padStart(3, "0");
      const newName = `${yyyymmdd}_${genre}_${title}_${volume}_${num}${ext}`;
      return {
        source_path: f.filePath,
        new_name: newName,
      };
    });

    try {
      await invoke("batch_rename_files", {
        entries,
        outputDirectory: null,
        mode: "overwrite",
      });
      // Reload
      const currentFolder = usePsdStore.getState().currentFolderPath;
      if (currentFolder) await loadFolder(currentFolder);
    } catch (e) {
      console.error("Rename failed:", e);
    }
  }, [targetFiles, loadFolder]);

  const handleRenameSingle = useCallback(async () => {
    if (!singleFile) return;
    const newName = window.prompt("新しいファイル名", singleFile.fileName);
    if (!newName || newName === singleFile.fileName) return;

    try {
      await invoke("batch_rename_files", {
        entries: [{ source_path: singleFile.filePath, new_name: newName }],
        outputDirectory: null,
        mode: "overwrite",
      });
      const currentFolder = usePsdStore.getState().currentFolderPath;
      if (currentFolder) await loadFolder(currentFolder);
    } catch (e) {
      console.error("Rename failed:", e);
    }
  }, [singleFile, loadFolder]);

  // ── Menu structure ──

  const menuItems: MenuItem[] = [
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
          disabled: !singleFile,
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

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[9999] min-w-[200px] max-w-[280px] bg-white rounded-xl shadow-elevated border border-border/60 p-1.5 select-none"
      style={{ left: x, top: y }}
    >
      <SubMenu items={menuItems} onClose={onClose} />
    </div>,
    document.body,
  );
}
