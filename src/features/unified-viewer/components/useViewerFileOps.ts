/**
 * 統合ビューアー ファイル操作カスタムフック
 * openFolder, openTextFile, handleJsonFileSelect, handleSave, handleSaveAs
 */
import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as dialogOpen, save as dialogSave } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import {
  useUnifiedViewerStore,
  type ViewerFile,
  type FontPresetEntry,
} from "../unifiedViewerStore";
import type { ProofreadingCheckItem } from "../../../types/typesettingCheck";
import { isImageFile, isPsdFile, parseComicPotText, serializeText } from "./utils";
import type { CacheEntry } from "./utils";

interface UseViewerFileOpsOptions {
  expandPdf: (raw: ViewerFile[]) => Promise<ViewerFile[]>;
  parseChunks: (content: string) => void;
  cache: React.MutableRefObject<Map<string, CacheEntry>>;
  setZoom: (z: number) => void;
  jsonBrowserMode: "preset" | "check" | null;
  setJsonBrowserMode: (mode: "preset" | "check" | null) => void;
}

export function useViewerFileOps({
  expandPdf,
  parseChunks,
  cache,
  setZoom,
  jsonBrowserMode,
  setJsonBrowserMode,
}: UseViewerFileOpsOptions) {
  const store = useUnifiedViewerStore();

  const openFolder = useCallback(async () => {
    const folderPath = await dialogOpen({ directory: true, multiple: false });
    if (!folderPath) return;
    try {
      const fileList = await invoke<string[]>("list_folder_files", {
        folderPath,
        recursive: false,
      });
      const raw: ViewerFile[] = fileList
        .filter((p) => isImageFile(p.substring(p.lastIndexOf("\\") + 1)))
        .map((p) => ({
          name: p.substring(p.lastIndexOf("\\") + 1),
          path: p,
          sourceType: isPsdFile(p) ? "psd" as const : p.toLowerCase().endsWith(".pdf") ? "pdf" as const : "image" as const,
        }));
      const expanded = await expandPdf(raw);
      store.setFiles(expanded);
      cache.current.clear();
      setZoom(0);
      store.setLeftTab("files");
    } catch { /* ignore */ }
  }, [expandPdf]);

  const openTextFile = useCallback(async () => {
    const path = await dialogOpen({
      filters: [{ name: "テキスト", extensions: ["txt"] }],
      multiple: false,
    });
    if (!path) return;
    try {
      const bytes = await readFile(path as string);
      const content = new TextDecoder("utf-8").decode(bytes);
      store.setTextContent(content);
      store.setTextFilePath(path as string);
      const { header, pages } = parseComicPotText(content);
      store.setTextHeader(header);
      store.setTextPages(pages);
      store.setIsDirty(false);
      parseChunks(content);
      store.setRightTab("text");
    } catch { /* ignore */ }
  }, [parseChunks]);

  const handleJsonFileSelect = useCallback(async (filePath: string) => {
    try {
      const content = await invoke<string>("read_text_file", { filePath });
      const data = JSON.parse(content);

      if (jsonBrowserMode === "check") {
        const allItems: ProofreadingCheckItem[] = [];
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
        const correctnessItems = allItems.filter((i) => i.checkKind === "correctness");
        const proposalItems = allItems.filter((i) => i.checkKind === "proposal");
        store.setCheckData({
          title: data.work || "",
          fileName: filePath.substring(filePath.lastIndexOf("\\") + 1),
          filePath,
          allItems,
          correctnessItems,
          proposalItems,
        });
        store.setRightTab("proofread");
        store.setCheckTabMode(correctnessItems.length > 0 ? "correctness" : "proposal");
      } else {
        const presets: FontPresetEntry[] = [];
        const presetsObj = data?.presetData?.presets ?? data?.presets ?? data?.presetSets ?? data;
        if (typeof presetsObj === "object" && presetsObj !== null) {
          if (Array.isArray(presetsObj)) {
            for (const p of presetsObj)
              if (p?.font || p?.postScriptName)
                presets.push({
                  font: p.font || p.postScriptName,
                  name: p.name || p.displayName || p.font || "",
                  subName: p.subName || p.category || "",
                });
          } else {
            for (const [, arr] of Object.entries(presetsObj)) {
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
        }
        if (presets.length > 0) {
          store.setFontPresets(presets);
          store.setPresetJsonPath(filePath);
        }
      }
    } catch { /* ignore */ }
    setJsonBrowserMode(null);
  }, [jsonBrowserMode, setJsonBrowserMode]);

  const handleSave = useCallback(async () => {
    if (!store.textFilePath || !store.textContent) return;
    try {
      await invoke("write_text_file", { filePath: store.textFilePath, content: store.textContent });
      store.setIsDirty(false);
    } catch { /* ignore */ }
  }, [store.textFilePath, store.textContent]);

  const handleSaveAs = useCallback(async () => {
    const path = await dialogSave({
      filters: [{ name: "テキスト", extensions: ["txt"] }],
    });
    if (!path) return;
    const content = serializeText(store.textHeader, store.textPages, store.fontPresets);
    try {
      await invoke("write_text_file", { filePath: path, content });
      store.setTextFilePath(path);
      store.setTextContent(content);
      store.setIsDirty(false);
    } catch { /* ignore */ }
  }, [store.textHeader, store.textPages, store.fontPresets]);

  return { openFolder, openTextFile, handleJsonFileSelect, handleSave, handleSaveAs };
}
