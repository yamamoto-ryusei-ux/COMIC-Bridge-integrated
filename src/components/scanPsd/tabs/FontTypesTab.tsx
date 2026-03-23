import { useState, useEffect, useMemo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useScanPsdStore } from "../../../store/scanPsdStore";
import { getAutoSubName, FONT_SUB_NAME_MAP, SUB_NAME_PALETTE } from "../../../types/scanPsd";
import type { FontPreset } from "../../../types/scanPsd";
import { MISSING_FONT_COLOR } from "../../../hooks/useFontResolver";
import type { FontResolveInfo } from "../../../hooks/useFontResolver";
import { FontBrowserDialog } from "../../spec-checker/FontBrowserDialog";

const FONT_SHARE_PATH = "\\\\haku\\CLLENN\\■アシスタント\\★フォント\\★全フォント";

// --- 定数 ---
const SUB_NAME_ORDER: Record<string, number> = {};
const UNIQUE_SUB_NAMES: string[] = [];
FONT_SUB_NAME_MAP.forEach((entry, i) => {
  if (!(entry.subName in SUB_NAME_ORDER)) {
    SUB_NAME_ORDER[entry.subName] = i;
    UNIQUE_SUB_NAMES.push(entry.subName);
  }
});

// SUB_NAME_PALETTE is imported from scanPsd.ts

function getSubNameStyle(subName: string): React.CSSProperties {
  const p = SUB_NAME_PALETTE[subName];
  if (p) return { color: p.color, backgroundColor: p.bg, borderColor: p.border };
  return { color: "#5a5a6e", backgroundColor: "#f0f0f5", borderColor: "#dcdce5" };
}

// --- 纏めグループキー抽出（表示名ベース） ---
function extractGroupKey(displayName: string): string {
  let key = displayName;
  // プロポーショナルP接頭辞の正規化: ＤＦＰ/ＤＦｐ → ＤＦ
  key = key.replace(/^(ＤＦ)[Ｐｐ]/u, "$1");
  // HGS/HGP → HG (プロポーショナル/スペーシング版)
  key = key.replace(/^HG[SP]/u, "HG");
  // A P-OTF → A-OTF (プロポーショナル版)
  key = key.replace(/^A\s+P-OTF/, "A-OTF");
  // フォント名末尾のＲ/R (Revised版) を除去: 「ＤＦ平成明朝体Ｒ」→「ＤＦ平成明朝体」
  key = key.replace(/([\u3000-\u9FFF\uFF00-\uFF9F])[ＲR](?=\s)/u, "$1");
  // バージョン識別子を除去（長いパターンから順に）
  key = key.replace(/\s+Pro-\d+/g, "");
  key = key.replace(/\s+Pr\d+N?/g, "");
  key = key.replace(/\s+Pro(?=\s|$)/g, "");
  key = key.replace(/\s+Std(?=\s|$)/g, "");
  // 空白正規化
  key = key.replace(/\s+/g, " ").trim();
  return key;
}

// --- ソート種別 ---
type SortMode = "default" | "name" | "category" | "count" | "install";
type FilterCategory = "all" | "has" | "none";
type FilterInstall = "all" | "installed" | "missing";

function filteredAndSortedPresets(
  presets: FontPreset[],
  filterCat: FilterCategory,
  filterInst: FilterInstall,
  sort: SortMode,
  isMissing: (font: string) => boolean,
  fontChecked: boolean,
  fontCountMap: Map<string, number>,
) {
  let items = presets.map((preset, originalIndex) => ({ preset, originalIndex }));

  if (filterCat === "has") {
    items = items.filter(({ preset }) => !!preset.subName);
  } else if (filterCat === "none") {
    items = items.filter(({ preset }) => !preset.subName);
  }
  if (filterInst === "installed") {
    items = items.filter(({ preset }) => fontChecked && !isMissing(preset.font));
  } else if (filterInst === "missing") {
    items = items.filter(({ preset }) => fontChecked && isMissing(preset.font));
  }

  switch (sort) {
    case "default":
      items.sort((a, b) => {
        const aMissing = fontChecked && isMissing(a.preset.font);
        const bMissing = fontChecked && isMissing(b.preset.font);
        if (aMissing !== bMissing) return aMissing ? 1 : -1;
        const aHas = a.preset.subName && a.preset.subName in SUB_NAME_ORDER;
        const bHas = b.preset.subName && b.preset.subName in SUB_NAME_ORDER;
        if (aHas && bHas)
          return SUB_NAME_ORDER[a.preset.subName] - SUB_NAME_ORDER[b.preset.subName];
        if (aHas) return -1;
        if (bHas) return 1;
        return 0;
      });
      break;
    case "name":
      items.sort((a, b) => a.preset.name.localeCompare(b.preset.name, "ja"));
      break;
    case "category":
      items.sort((a, b) => {
        const aHas = a.preset.subName && a.preset.subName in SUB_NAME_ORDER;
        const bHas = b.preset.subName && b.preset.subName in SUB_NAME_ORDER;
        if (aHas && bHas)
          return SUB_NAME_ORDER[a.preset.subName] - SUB_NAME_ORDER[b.preset.subName];
        if (aHas) return -1;
        if (bHas) return 1;
        return 0;
      });
      break;
    case "count":
      items.sort((a, b) => {
        const aCount = fontCountMap.get(a.preset.font) ?? -1;
        const bCount = fontCountMap.get(b.preset.font) ?? -1;
        return bCount - aCount;
      });
      break;
    case "install":
      items.sort((a, b) => {
        const aVal = fontChecked ? (isMissing(a.preset.font) ? 1 : 0) : 2;
        const bVal = fontChecked ? (isMissing(b.preset.font) ? 1 : 0) : 2;
        return aVal - bVal;
      });
      break;
  }
  return items;
}

// --- 纏めグループ型 ---
interface GroupEntry {
  preset: FontPreset;
  presetIndex: number;
  count: number;
}
interface EditableGroup {
  family: string;
  entries: GroupEntry[];
  mainIdx: number; // entries配列内のインデックス
  skip: boolean;
  keepIndices: Set<number>; // entries配列内の「除外しない」インデックス
}

// --- コンポーネント ---
export function FontTypesTab() {
  const scanData = useScanPsdStore((s) => s.scanData);
  const presetSets = useScanPsdStore((s) => s.presetSets);
  const currentSetName = useScanPsdStore((s) => s.currentSetName);
  const setCurrentSetName = useScanPsdStore((s) => s.setCurrentSetName);
  const addPresetSet = useScanPsdStore((s) => s.addPresetSet);
  const removePresetSet = useScanPsdStore((s) => s.removePresetSet);
  const renamePresetSet = useScanPsdStore((s) => s.renamePresetSet);
  const addFontToPreset = useScanPsdStore((s) => s.addFontToPreset);
  const removeFontFromPreset = useScanPsdStore((s) => s.removeFontFromPreset);
  const updateFontInPreset = useScanPsdStore((s) => s.updateFontInPreset);
  const [editMode, setEditMode] = useState<"none" | "rename">("none");
  const [inputValue, setInputValue] = useState("");
  const [editingPresetIndex, setEditingPresetIndex] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ name: "", subName: "" });

  // --- フィルタ・ソート ---
  const [filterCategory, setFilterCategory] = useState<FilterCategory>("all");
  const [filterInstall, setFilterInstall] = useState<FilterInstall>("all");
  const [sortMode, setSortMode] = useState<SortMode>("default");

  // --- 纏め ---
  const [showGroupPreview, setShowGroupPreview] = useState(false);
  const [editableGroups, setEditableGroups] = useState<EditableGroup[]>([]);
  // 手動纏め
  const [manualSelectMode, setManualSelectMode] = useState(false);
  const [manualSelected, setManualSelected] = useState<Set<number>>(new Set());

  // --- 手動フォント追加 ---
  const [showManualFontAdd, setShowManualFontAdd] = useState(false);
  const [manualFont, setManualFont] = useState({ psName: "", displayName: "", subName: "" });
  const [manualFontResolving, setManualFontResolving] = useState(false);
  const [fontSearchQuery, setFontSearchQuery] = useState("");
  const [fontSearchResults, setFontSearchResults] = useState<
    { postscript_name: string; display_name: string; style_name: string }[]
  >([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [fontSearchNotFound, setFontSearchNotFound] = useState(false);

  // --- セット作成フォントピッカー ---
  const [showFontPicker, setShowFontPicker] = useState(false);
  const [newSetName, setNewSetName] = useState("");
  const [pickerSelected, setPickerSelected] = useState<Set<string>>(new Set());
  const [pickerCollapsed, setPickerCollapsed] = useState<Record<string, boolean>>({});

  const currentPresets = presetSets[currentSetName] || [];
  const setNames = Object.keys(presetSets);

  const registeredFonts = new Set(Object.values(presetSets).flatMap((ps) => ps.map((p) => p.font)));
  const unregisteredFonts = scanData?.fonts
    ? scanData.fonts.filter((f) => !registeredFonts.has(f.name))
    : [];

  const fontCountMap = useMemo(() => {
    const map = new Map<string, number>();
    if (scanData?.fonts) {
      for (const f of scanData.fonts) map.set(f.name, f.count);
    }
    return map;
  }, [scanData]);

  // --- フォントインストール状態チェック ---
  const allPresetFontNames = useMemo(() => {
    const names = new Set<string>();
    for (const presets of Object.values(presetSets)) {
      for (const p of presets) {
        if (p.font) names.add(p.font);
      }
    }
    return [...names];
  }, [presetSets]);

  const [fontResolveMap, setFontResolveMap] = useState<Record<string, FontResolveInfo>>({});
  const [fontChecked, setFontChecked] = useState(false);
  const [showFontBrowser, setShowFontBrowser] = useState(false);

  const resolveFonts = useCallback(() => {
    if (allPresetFontNames.length === 0) {
      setFontChecked(false);
      return;
    }
    setFontChecked(false);
    invoke<Record<string, FontResolveInfo>>("resolve_font_names", {
      postscriptNames: allPresetFontNames,
    })
      .then((result) => {
        setFontResolveMap(result);
        setFontChecked(true);
      })
      .catch(console.error);
  }, [allPresetFontNames]);

  useEffect(() => {
    resolveFonts();
  }, [resolveFonts]);

  const isFontMissing = (psName: string) => fontChecked && !(psName in fontResolveMap);
  const missingFontNames = useMemo(
    () => (fontChecked ? allPresetFontNames.filter((n) => !(n in fontResolveMap)) : []),
    [fontChecked, allPresetFontNames, fontResolveMap],
  );

  // --- 自動纏めプレビュー初期化 ---
  const initAutoGroups = useCallback(() => {
    const familyGroups = new Map<string, GroupEntry[]>();
    for (let i = 0; i < currentPresets.length; i++) {
      const p = currentPresets[i];
      const family = extractGroupKey(p.name);
      if (!familyGroups.has(family)) familyGroups.set(family, []);
      const count = fontCountMap.get(p.font) ?? 0;
      familyGroups.get(family)!.push({ preset: p, presetIndex: i, count });
    }
    const groups: EditableGroup[] = [];
    for (const [family, entries] of familyGroups) {
      if (entries.length < 2) continue;
      const sorted = [...entries].sort((a, b) => b.count - a.count);
      groups.push({ family, entries: sorted, mainIdx: 0, skip: false, keepIndices: new Set() });
    }
    setEditableGroups(groups);
  }, [currentPresets, fontCountMap]);

  const handleOpenGroupPreview = () => {
    if (!showGroupPreview) {
      initAutoGroups();
      setManualSelectMode(false);
      setManualSelected(new Set());
    }
    setShowGroupPreview(!showGroupPreview);
  };

  // --- 纏めプレビュー操作 ---
  const toggleGroupSkip = (gIdx: number) => {
    setEditableGroups((prev) => prev.map((g, i) => (i === gIdx ? { ...g, skip: !g.skip } : g)));
  };

  const setGroupMain = (gIdx: number, entryIdx: number) => {
    setEditableGroups((prev) => prev.map((g, i) => (i === gIdx ? { ...g, mainIdx: entryIdx } : g)));
  };

  const toggleKeep = (gIdx: number, entryIdx: number) => {
    setEditableGroups((prev) =>
      prev.map((g, i) => {
        if (i !== gIdx) return g;
        const next = new Set(g.keepIndices);
        if (next.has(entryIdx)) next.delete(entryIdx);
        else next.add(entryIdx);
        return { ...g, keepIndices: next };
      }),
    );
  };

  const handleExecuteGroup = () => {
    const indicesToRemove = new Set<number>();
    for (const g of editableGroups) {
      if (g.skip) continue;
      for (let i = 0; i < g.entries.length; i++) {
        if (i === g.mainIdx) continue;
        if (g.keepIndices.has(i)) continue;
        indicesToRemove.add(g.entries[i].presetIndex);
      }
    }
    if (indicesToRemove.size === 0) {
      setShowGroupPreview(false);
      return;
    }
    const sorted = [...indicesToRemove].sort((a, b) => b - a);
    for (const idx of sorted) {
      removeFontFromPreset(currentSetName, idx);
    }
    setShowGroupPreview(false);
    setManualSelectMode(false);
    setManualSelected(new Set());
  };

  // --- 手動纏め ---
  const toggleManualSelect = (presetIndex: number) => {
    setManualSelected((prev) => {
      const next = new Set(prev);
      if (next.has(presetIndex)) next.delete(presetIndex);
      else next.add(presetIndex);
      return next;
    });
  };

  const handleManualGroup = () => {
    if (manualSelected.size < 2) return;
    const entries: GroupEntry[] = [...manualSelected]
      .map((idx) => ({
        preset: currentPresets[idx],
        presetIndex: idx,
        count: fontCountMap.get(currentPresets[idx].font) ?? 0,
      }))
      .sort((a, b) => b.count - a.count);
    const newGroup: EditableGroup = {
      family: "(手動グループ)",
      entries,
      mainIdx: 0,
      skip: false,
      keepIndices: new Set(),
    };
    if (!showGroupPreview) {
      // 手動纏めのみ：自動グループは生成しない
      setEditableGroups([newGroup]);
      setShowGroupPreview(true);
    } else {
      setEditableGroups((prev) => [...prev, newGroup]);
    }
    setManualSelected(new Set());
    setManualSelectMode(false);
  };

  // --- ハンドラ ---
  const handleRenameSet = () => {
    if (inputValue.trim() && inputValue.trim() !== currentSetName) {
      renamePresetSet(currentSetName, inputValue.trim());
      setInputValue("");
      setEditMode("none");
    }
  };

  const handleAddUnregistered = (fontName: string, displayName: string, count: number) => {
    const preset: FontPreset = {
      name: displayName || fontName,
      subName: getAutoSubName(fontName),
      font: fontName,
      description: `使用回数: ${count}`,
    };
    addFontToPreset(currentSetName, preset);
  };

  const handleAddAllUnregistered = () => {
    for (const f of unregisteredFonts) {
      const preset: FontPreset = {
        name: f.displayName || f.name,
        subName: getAutoSubName(f.name),
        font: f.name,
        description: `使用回数: ${f.count}`,
      };
      addFontToPreset(currentSetName, preset);
    }
  };

  // --- 手動フォント追加ハンドラ ---
  const handleManualFontAdd = () => {
    if (!manualFont.psName.trim()) return;
    // 「手動追加」セットがなければ作成
    if (!presetSets["手動追加"]) {
      addPresetSet("手動追加");
    }
    const preset: FontPreset = {
      name: manualFont.displayName.trim() || manualFont.psName.trim(),
      subName: manualFont.subName || getAutoSubName(manualFont.psName.trim()),
      font: manualFont.psName.trim(),
      description: "",
    };
    addFontToPreset("手動追加", preset);
    setManualFont({ psName: "", displayName: "", subName: "" });
    setFontSearchQuery("");
    setFontSearchResults([]);
    setShowSearchResults(false);
    setFontSearchNotFound(false);
    setShowManualFontAdd(false);
  };

  // フォント名で部分一致検索
  const resolveManualFontName = async () => {
    const query = fontSearchQuery.trim();
    if (!query) return;
    setManualFontResolving(true);
    setFontSearchNotFound(false);
    try {
      const results = await invoke<
        { postscript_name: string; display_name: string; style_name: string }[]
      >("search_font_names", {
        query,
        maxResults: 30,
      });
      if (results.length === 1) {
        // 1件のみ: 自動選択
        setManualFont((prev) => ({
          ...prev,
          psName: results[0].postscript_name,
          displayName:
            results[0].display_name + (results[0].style_name ? ` ${results[0].style_name}` : ""),
        }));
        setShowSearchResults(false);
        setFontSearchResults([]);
      } else if (results.length > 1) {
        // 複数件: 選択肢を表示
        setFontSearchResults(results);
        setShowSearchResults(true);
      } else {
        // 0件
        setFontSearchResults([]);
        setShowSearchResults(false);
        setFontSearchNotFound(true);
      }
    } catch {
      setFontSearchNotFound(true);
    }
    setManualFontResolving(false);
  };

  // 検索結果からフォントを選択
  const selectSearchResult = (result: {
    postscript_name: string;
    display_name: string;
    style_name: string;
  }) => {
    setManualFont((prev) => ({
      ...prev,
      psName: result.postscript_name,
      displayName: result.display_name + (result.style_name ? ` ${result.style_name}` : ""),
    }));
    setShowSearchResults(false);
    setFontSearchResults([]);
    setFontSearchNotFound(false);
  };

  // --- セット作成（フォントピッカー付き）ハンドラ ---
  const handleOpenFontPicker = () => {
    setShowFontPicker(true);
    setNewSetName("");
    setPickerSelected(new Set());
    setPickerCollapsed({});
  };

  const handleCreateSetWithFonts = () => {
    const name = newSetName.trim();
    if (!name) return;
    if (presetSets[name]) return; // 既存セット名はNG

    addPresetSet(name);

    for (const key of pickerSelected) {
      const sepIdx = key.indexOf(":");
      const source = key.substring(0, sepIdx);
      const id = key.substring(sepIdx + 1);

      if (source === "unreg") {
        const font = unregisteredFonts.find((f) => f.name === id);
        if (font) {
          addFontToPreset(name, {
            name: font.displayName || font.name,
            subName: getAutoSubName(font.name),
            font: font.name,
            description: `使用回数: ${font.count}`,
          });
        }
      } else {
        const presets = presetSets[source];
        const i = parseInt(id);
        if (presets && presets[i]) {
          addFontToPreset(name, { ...presets[i] });
        }
      }
    }

    setCurrentSetName(name);
    setShowFontPicker(false);
    setNewSetName("");
    setPickerSelected(new Set());
  };

  // ピッカーのセクション全選択/全解除
  const togglePickerSection = (sectionKeys: string[], selectAll: boolean) => {
    setPickerSelected((prev) => {
      const next = new Set(prev);
      for (const key of sectionKeys) {
        if (selectAll) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  };

  // ピッカーの折りたたみ
  const togglePickerCollapse = (section: string) => {
    setPickerCollapsed((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  // フィルタ・ソート適用
  const displayPresets = useMemo(
    () =>
      filteredAndSortedPresets(
        currentPresets,
        filterCategory,
        filterInstall,
        sortMode,
        isFontMissing,
        fontChecked,
        fontCountMap,
      ),
    [
      currentPresets,
      filterCategory,
      filterInstall,
      sortMode,
      fontChecked,
      fontCountMap,
      fontResolveMap,
    ],
  );

  // 纏め対象数の計算
  const groupRemoveCount = useMemo(() => {
    let count = 0;
    for (const g of editableGroups) {
      if (g.skip) continue;
      for (let i = 0; i < g.entries.length; i++) {
        if (i === g.mainIdx) continue;
        if (g.keepIndices.has(i)) continue;
        count++;
      }
    }
    return count;
  }, [editableGroups]);

  const gridCols = manualSelectMode ? "20px 20px 76px 1fr 44px" : "20px 76px 1fr 44px";

  // ピッカー用データ
  const pickerSections = useMemo(() => {
    const sections: {
      name: string;
      keys: string[];
      items: { key: string; label: string; subName: string; font: string; count?: number }[];
    }[] = [];

    for (const setName of setNames) {
      const presets = presetSets[setName];
      if (!presets || presets.length === 0) continue;
      const items = presets.map((p, i) => ({
        key: `${setName}:${i}`,
        label: p.name,
        subName: p.subName || "",
        font: p.font,
        count: fontCountMap.get(p.font),
      }));
      sections.push({ name: setName, keys: items.map((it) => it.key), items });
    }

    if (unregisteredFonts.length > 0) {
      const items = unregisteredFonts.map((f) => ({
        key: `unreg:${f.name}`,
        label: f.displayName || f.name,
        subName: getAutoSubName(f.name),
        font: f.name,
        count: f.count,
      }));
      sections.push({ name: "未登録フォント", keys: items.map((it) => it.key), items });
    }

    return sections;
  }, [setNames, presetSets, unregisteredFonts, fontCountMap]);

  return (
    <div className="space-y-4">
      {/* プリセットセット選択 */}
      <div className="bg-bg-tertiary/50 rounded-xl p-3 border border-border/30">
        <div className="flex items-center gap-2 mb-2">
          <select
            value={currentSetName}
            onChange={(e) => setCurrentSetName(e.target.value)}
            className="flex-1 bg-white border border-border rounded-lg px-2.5 py-1.5 text-xs text-text-primary
              focus:border-accent focus:outline-none"
          >
            {setNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <button
            onClick={handleOpenFontPicker}
            className="w-7 h-7 rounded-lg bg-accent/10 text-accent hover:bg-accent/20 flex items-center justify-center transition-colors"
            title="セット追加"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </button>
          <button
            onClick={() => {
              setEditMode("rename");
              setInputValue(currentSetName);
            }}
            className="text-[10px] text-text-muted hover:text-accent px-1.5 py-1 rounded-lg hover:bg-accent/5 transition-colors"
            title="名前変更"
          >
            名前変更
          </button>
          {setNames.length > 1 && (
            <button
              onClick={() => removePresetSet(currentSetName)}
              className="text-[10px] text-text-muted hover:text-error px-1.5 py-1 rounded-lg hover:bg-error/5 transition-colors"
              title="セット削除"
            >
              削除
            </button>
          )}
        </div>

        {editMode === "rename" && (
          <div className="flex items-center gap-2 mt-2">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRenameSet();
                if (e.key === "Escape") setEditMode("none");
              }}
              placeholder="新しいセット名"
              className="flex-1 bg-white border border-accent/40 rounded-lg px-2.5 py-1.5 text-xs text-text-primary
                focus:outline-none focus:ring-2 focus:ring-accent/15"
              autoFocus
            />
            <button
              onClick={handleRenameSet}
              className="text-[10px] text-white font-medium px-3 py-1.5 rounded-lg"
              style={{ background: "linear-gradient(135deg, #ff5a8a, #7c5cff)" }}
            >
              OK
            </button>
            <button
              onClick={() => setEditMode("none")}
              className="text-[10px] text-text-muted px-2 py-1"
            >
              取消
            </button>
          </div>
        )}
      </div>

      {/* === セット作成フォントピッカー === */}
      {showFontPicker && (
        <div className="bg-white rounded-xl border-2 border-accent/30 shadow-lg overflow-hidden">
          <div className="px-3 py-2.5 bg-gradient-to-r from-accent/5 to-accent-secondary/5 border-b border-accent/10">
            <p className="text-[11px] font-bold text-text-primary mb-2">新規セット作成</p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newSetName}
                onChange={(e) => setNewSetName(e.target.value)}
                placeholder="セット名を入力"
                className="flex-1 bg-white border border-border rounded-lg px-2.5 py-1.5 text-xs text-text-primary
                  focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15"
                autoFocus
              />
            </div>
            {newSetName.trim() && presetSets[newSetName.trim()] && (
              <p className="text-[9px] text-error mt-1">同名のセットが既に存在します</p>
            )}
          </div>

          {/* フォント選択エリア */}
          <div className="max-h-[400px] overflow-y-auto px-3 py-2 space-y-2">
            <p className="text-[10px] text-text-muted font-medium">
              追加するフォントを選択してください（{pickerSelected.size}件選択中）
            </p>

            {pickerSections.map((section) => {
              const isCollapsed = pickerCollapsed[section.name];
              const selectedCount = section.keys.filter((k) => pickerSelected.has(k)).length;
              const allSelected = selectedCount === section.keys.length;

              return (
                <div
                  key={section.name}
                  className="border border-border/40 rounded-lg overflow-hidden"
                >
                  {/* セクションヘッダー */}
                  <div
                    className="flex items-center gap-2 px-2.5 py-1.5 bg-bg-tertiary/50 cursor-pointer select-none"
                    onClick={() => togglePickerCollapse(section.name)}
                  >
                    <svg
                      className={`w-3 h-3 text-text-muted transition-transform ${isCollapsed ? "" : "rotate-90"}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                    <span className="text-[10px] font-bold text-text-primary flex-1">
                      {section.name}
                      <span className="text-text-muted font-normal ml-1">
                        ({section.items.length}件)
                      </span>
                    </span>
                    {selectedCount > 0 && (
                      <span className="text-[9px] font-bold text-accent bg-accent/10 px-1.5 py-0.5 rounded-full">
                        {selectedCount}
                      </span>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        togglePickerSection(section.keys, !allSelected);
                      }}
                      className="text-[9px] text-accent hover:text-accent-secondary px-1.5 py-0.5 rounded hover:bg-accent/10 transition-colors"
                    >
                      {allSelected ? "全解除" : "全選択"}
                    </button>
                  </div>

                  {/* フォントリスト */}
                  {!isCollapsed && (
                    <div className="divide-y divide-border/20">
                      {section.items.map((item) => {
                        const checked = pickerSelected.has(item.key);
                        return (
                          <label
                            key={item.key}
                            className={`flex items-center gap-2 px-2.5 py-1 cursor-pointer transition-colors ${
                              checked ? "bg-accent/5" : "hover:bg-bg-tertiary/30"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                setPickerSelected((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(item.key)) next.delete(item.key);
                                  else next.add(item.key);
                                  return next;
                                });
                              }}
                              className="w-3 h-3 accent-accent cursor-pointer flex-shrink-0"
                            />
                            {item.subName && (
                              <span
                                className="text-[8px] font-semibold px-1 py-0.5 rounded border flex-shrink-0"
                                style={getSubNameStyle(item.subName)}
                              >
                                {item.subName}
                              </span>
                            )}
                            <span className="text-[10px] text-text-primary truncate flex-1">
                              {item.label}
                            </span>
                            <span className="text-[8px] text-text-muted font-mono flex-shrink-0">
                              {item.font}
                            </span>
                            {item.count != null && (
                              <span className="text-[8px] text-text-muted flex-shrink-0">
                                ({item.count}回)
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {pickerSections.length === 0 && (
              <p className="text-[10px] text-text-muted text-center py-4">
                選択可能なフォントがありません
              </p>
            )}
          </div>

          {/* アクションバー */}
          <div className="flex items-center gap-2 justify-end px-3 py-2 bg-bg-tertiary/30 border-t border-border/30">
            <button
              onClick={handleCreateSetWithFonts}
              disabled={!newSetName.trim() || !!presetSets[newSetName.trim()]}
              className="text-[10px] font-bold text-white px-4 py-1.5 rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: "linear-gradient(135deg, #ff5a8a, #7c5cff)" }}
            >
              作成{pickerSelected.size > 0 ? `（${pickerSelected.size}件）` : "（空）"}
            </button>
            <button
              onClick={() => setShowFontPicker(false)}
              className="text-[10px] text-text-muted px-3 py-1.5 hover:text-text-primary transition-colors"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* フォントプリセットリスト */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <h4 className="text-[10px] font-bold text-text-secondary">プリセット</h4>
          <span className="text-[9px] font-bold text-accent-secondary bg-accent-secondary/10 px-2 py-0.5 rounded-full">
            {currentPresets.length}
          </span>
          {fontChecked && missingFontNames.length === 0 && currentPresets.length > 0 && (
            <span className="text-[9px] font-bold text-success bg-success/10 px-2 py-0.5 rounded-full flex items-center gap-1">
              <svg
                className="w-2.5 h-2.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={3}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              全フォントOK
            </span>
          )}
        </div>

        {/* フィルタ・ソート・纏めコントロール */}
        {currentPresets.length > 0 && (
          <div className="bg-bg-tertiary/40 rounded-xl px-2.5 py-2 mb-2 border border-border/20 space-y-1.5">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[9px] text-text-muted font-medium mr-0.5">フィルタ:</span>
              <FilterChip
                label="カテゴリあり"
                active={filterCategory === "has"}
                onClick={() => setFilterCategory(filterCategory === "has" ? "all" : "has")}
              />
              <FilterChip
                label="カテゴリなし"
                active={filterCategory === "none"}
                onClick={() => setFilterCategory(filterCategory === "none" ? "all" : "none")}
              />
              <span className="w-px h-3 bg-border/40 mx-0.5" />
              <FilterChip
                label="インストール済み"
                active={filterInstall === "installed"}
                onClick={() =>
                  setFilterInstall(filterInstall === "installed" ? "all" : "installed")
                }
              />
              <FilterChip
                label="未インストール"
                active={filterInstall === "missing"}
                onClick={() => setFilterInstall(filterInstall === "missing" ? "all" : "missing")}
                color="error"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-text-muted font-medium">ソート:</span>
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
                className="bg-white border border-border rounded-lg px-2 py-0.5 text-[10px] text-text-primary
                  focus:border-accent focus:outline-none"
              >
                <option value="default">デフォルト</option>
                <option value="name">名前順</option>
                <option value="category">カテゴリ順</option>
                <option value="count">出現数順</option>
                <option value="install">インストール順</option>
              </select>
              <span className="flex-1" />
              <button
                onClick={() => {
                  setManualSelectMode(!manualSelectMode);
                  setManualSelected(new Set());
                }}
                className={`text-[10px] font-medium px-2.5 py-1 rounded-lg border transition-all ${
                  manualSelectMode
                    ? "bg-purple-100 text-purple-600 border-purple-300"
                    : "bg-white text-text-muted border-border hover:text-purple-500 hover:border-purple-200"
                }`}
              >
                手動纏め
              </button>
              <button
                onClick={handleOpenGroupPreview}
                className={`text-[10px] font-medium px-2.5 py-1 rounded-lg border transition-all ${
                  showGroupPreview
                    ? "bg-accent/10 text-accent border-accent/30"
                    : "bg-white text-text-muted border-border hover:text-accent hover:border-accent/30"
                }`}
              >
                自動纏め
              </button>
            </div>
          </div>
        )}

        {/* 手動纏めバー */}
        {manualSelectMode && (
          <div className="flex items-center gap-2 px-3 py-2 mb-2 bg-purple-50 rounded-xl border border-purple-200">
            <span className="text-[10px] text-purple-600 font-medium flex-1">
              纏めるフォントを選択してください（{manualSelected.size}件選択中）
            </span>
            {manualSelected.size >= 2 && (
              <button
                onClick={handleManualGroup}
                className="text-[9px] font-bold text-white px-3 py-1 rounded-lg"
                style={{ background: "linear-gradient(135deg, #ff5a8a, #7c5cff)" }}
              >
                纏める
              </button>
            )}
            <button
              onClick={() => {
                setManualSelectMode(false);
                setManualSelected(new Set());
              }}
              className="text-[9px] text-text-muted px-2 py-1 hover:text-text-primary"
            >
              取消
            </button>
          </div>
        )}

        {/* 纏めプレビュー */}
        {showGroupPreview && (
          <div className="bg-accent/5 rounded-xl px-3 py-2.5 mb-2 border border-accent/20 space-y-2">
            <div className="flex items-center gap-2">
              <p className="text-[10px] font-bold text-accent flex-1">
                纏めプレビュー
                {editableGroups.length === 0
                  ? " — 統合可能なグループはありません"
                  : ` — ${editableGroups.length}グループ（${groupRemoveCount}件除外予定）`}
              </p>
            </div>
            {editableGroups.map((g, gIdx) => (
              <div
                key={`${g.family}-${gIdx}`}
                className={`rounded-lg px-2.5 py-1.5 border transition-all ${
                  g.skip
                    ? "bg-bg-tertiary/50 border-border/20 opacity-60"
                    : "bg-white border-border/30"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-[10px] font-bold text-text-primary flex-1">{g.family}</p>
                  <button
                    onClick={() => toggleGroupSkip(gIdx)}
                    className={`text-[8px] px-2 py-0.5 rounded border transition-all ${
                      g.skip
                        ? "bg-bg-tertiary text-text-muted border-border"
                        : "bg-white text-text-muted border-border hover:text-error hover:border-error/30"
                    }`}
                  >
                    {g.skip ? "纏める" : "スキップ"}
                  </button>
                </div>
                {!g.skip && (
                  <div className="space-y-0.5">
                    {g.entries.map((e, eIdx) => {
                      const isMain = eIdx === g.mainIdx;
                      const isKept = g.keepIndices.has(eIdx);
                      const willRemove = !isMain && !isKept;
                      return (
                        <div
                          key={e.presetIndex}
                          className={`flex items-center gap-1.5 text-[9px] py-0.5 px-1 rounded ${
                            isMain ? "bg-accent/5" : ""
                          }`}
                        >
                          {isMain ? (
                            <span className="font-bold text-accent bg-accent/10 px-1.5 py-0.5 rounded flex-shrink-0">
                              メイン
                            </span>
                          ) : willRemove ? (
                            <span className="text-text-muted/60 bg-bg-tertiary px-1.5 py-0.5 rounded flex-shrink-0">
                              除外
                            </span>
                          ) : (
                            <span className="text-success bg-success/10 px-1.5 py-0.5 rounded flex-shrink-0">
                              残す
                            </span>
                          )}
                          <span
                            className={`flex-1 truncate ${willRemove && !isMain ? "text-text-muted line-through" : "text-text-primary"}`}
                          >
                            {e.preset.name}
                          </span>
                          <span className="text-text-muted/70 font-mono flex-shrink-0">
                            {e.preset.font}
                          </span>
                          <span className="text-text-muted/70 flex-shrink-0">{e.count}回</span>
                          {!isMain && (
                            <div className="flex gap-0.5 flex-shrink-0">
                              <button
                                onClick={() => setGroupMain(gIdx, eIdx)}
                                className="text-[8px] text-accent hover:bg-accent/10 px-1 py-0.5 rounded transition-colors"
                                title="メインに設定"
                              >
                                メインに
                              </button>
                              <button
                                onClick={() => toggleKeep(gIdx, eIdx)}
                                className={`text-[8px] px-1 py-0.5 rounded transition-colors ${
                                  isKept
                                    ? "text-success hover:bg-success/10"
                                    : "text-text-muted hover:bg-bg-tertiary"
                                }`}
                                title={isKept ? "除外する" : "残す"}
                              >
                                {isKept ? "除外する" : "残す"}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
            <div className="flex gap-1.5 justify-end pt-1">
              {groupRemoveCount > 0 && (
                <button
                  onClick={handleExecuteGroup}
                  className="text-[9px] font-bold text-white px-3 py-1 rounded-lg transition-all"
                  style={{ background: "linear-gradient(135deg, #ff5a8a, #7c5cff)" }}
                >
                  実行（{groupRemoveCount}件除外）
                </button>
              )}
              <button
                onClick={() => setShowGroupPreview(false)}
                className="text-[9px] text-text-muted px-2 py-1 hover:text-text-primary transition-colors"
              >
                閉じる
              </button>
            </div>
          </div>
        )}

        {/* 未インストールフォント警告 */}
        {fontChecked && missingFontNames.length > 0 && (
          <div
            className="flex items-start gap-2 px-3 py-2 rounded-xl mb-2 border"
            style={{
              backgroundColor: `${MISSING_FONT_COLOR}08`,
              borderColor: `${MISSING_FONT_COLOR}25`,
            }}
          >
            <svg
              className="w-3.5 h-3.5 flex-shrink-0 mt-0.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke={MISSING_FONT_COLOR}
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <div className="flex-1">
              <p className="text-[10px] font-bold" style={{ color: MISSING_FONT_COLOR }}>
                未インストール: {missingFontNames.length}件
              </p>
              <p className="text-[9px] mt-0.5" style={{ color: `${MISSING_FONT_COLOR}cc` }}>
                {missingFontNames.map((n) => fontResolveMap[n]?.display_name || n).join(", ")}
              </p>
              <button
                onClick={() => setShowFontBrowser(true)}
                className="mt-1.5 text-[9px] font-bold text-white px-2.5 py-1 rounded-lg transition-colors"
                style={{ backgroundColor: MISSING_FONT_COLOR }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
              >
                共有フォルダから探す
              </button>
            </div>
          </div>
        )}

        {currentPresets.length === 0 ? (
          <p className="text-[10px] text-text-muted py-4 text-center bg-bg-tertiary/30 rounded-xl border border-dashed border-border">
            プリセットがありません
          </p>
        ) : displayPresets.length === 0 ? (
          <p className="text-[10px] text-text-muted py-4 text-center bg-bg-tertiary/30 rounded-xl border border-dashed border-border">
            フィルタ条件に一致するフォントがありません
          </p>
        ) : (
          <div className="border border-border/50 rounded-xl overflow-hidden">
            {/* テーブルヘッダー */}
            <div
              className="grid items-center gap-x-2.5 px-2.5 py-1.5 bg-bg-tertiary/60 border-b border-border/40 text-[9px] font-bold text-text-muted"
              style={{ gridTemplateColumns: gridCols }}
            >
              {manualSelectMode && <span />}
              <span />
              <span>カテゴリ</span>
              <span>フォント名</span>
              <span />
            </div>
            {/* テーブルボディ */}
            <div>
              {displayPresets.map(({ preset: p, originalIndex }, idx) => {
                const missing = isFontMissing(p.font);
                const count = fontCountMap.get(p.font);
                const isManualSelected = manualSelected.has(originalIndex);
                return (
                  <div key={originalIndex}>
                    <div
                      className={`grid items-start gap-x-2.5 px-2.5 py-1.5 group
                    border-b last:border-b-0 transition-all ${
                      isManualSelected
                        ? "bg-purple-50/80 hover:bg-purple-50 border-purple-200/30"
                        : missing
                          ? "bg-red-50/60 hover:bg-red-50 border-red-200/30"
                          : idx % 2 === 0
                            ? "bg-white hover:bg-bg-secondary/60 border-border/20"
                            : "bg-bg-secondary/30 hover:bg-bg-secondary/60 border-border/20"
                    }`}
                      style={{ gridTemplateColumns: gridCols }}
                    >
                      {/* 手動纏め選択 */}
                      {manualSelectMode && (
                        <span className="flex items-center justify-center pt-0.5">
                          <input
                            type="checkbox"
                            checked={isManualSelected}
                            onChange={() => toggleManualSelect(originalIndex)}
                            className="w-3 h-3 accent-purple-500 cursor-pointer"
                          />
                        </span>
                      )}
                      {/* インストール状態 */}
                      <span className="flex items-center justify-center pt-0.5">
                        {fontChecked &&
                          (missing ? (
                            <span
                              className="w-4 h-4 rounded flex items-center justify-center"
                              style={{ backgroundColor: `${MISSING_FONT_COLOR}15` }}
                              title="未インストール"
                            >
                              <svg
                                className="w-2.5 h-2.5"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke={MISSING_FONT_COLOR}
                                strokeWidth={3}
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M6 18L18 6M6 6l12 12"
                                />
                              </svg>
                            </span>
                          ) : (
                            <span
                              className="w-4 h-4 rounded flex items-center justify-center"
                              style={{ backgroundColor: "#10b98115" }}
                              title="インストール済み"
                            >
                              <svg
                                className="w-2.5 h-2.5"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="#10b981"
                                strokeWidth={3}
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M5 13l4 4L19 7"
                                />
                              </svg>
                            </span>
                          ))}
                      </span>
                      {/* カテゴリ */}
                      <span>
                        {p.subName ? (
                          <span
                            className="text-[9px] font-semibold px-1.5 py-0.5 rounded border inline-block truncate max-w-full"
                            style={getSubNameStyle(p.subName)}
                          >
                            {p.subName}
                          </span>
                        ) : (
                          <span className="text-[9px] text-text-muted/40">&mdash;</span>
                        )}
                      </span>
                      {/* フォント名 + PostScript名 + 出現数 */}
                      <span className="min-w-0">
                        <span
                          className={`text-[11px] block ${missing ? "" : "text-text-primary"}`}
                          style={
                            missing
                              ? {
                                  color: MISSING_FONT_COLOR,
                                  textDecoration: "line-through",
                                  textDecorationColor: `${MISSING_FONT_COLOR}50`,
                                }
                              : undefined
                          }
                        >
                          {p.name}
                          {count != null && (
                            <span className="text-[8px] text-text-muted ml-1.5 font-normal">
                              ({count}回)
                            </span>
                          )}
                        </span>
                        <span
                          className={`text-[9px] font-mono block ${missing ? "" : "text-text-muted"}`}
                          style={missing ? { color: `${MISSING_FONT_COLOR}90` } : undefined}
                        >
                          {p.font}
                        </span>
                      </span>
                      {/* アクション */}
                      <span className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => {
                            setEditingPresetIndex(originalIndex);
                            setEditForm({ name: p.name, subName: p.subName || "" });
                          }}
                          className="text-text-muted hover:text-accent transition-colors opacity-0 group-hover:opacity-100"
                          title="編集"
                        >
                          <svg
                            className="w-3 h-3"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                            />
                          </svg>
                        </button>
                        <button
                          onClick={() => removeFontFromPreset(currentSetName, originalIndex)}
                          className="text-text-muted hover:text-error transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <svg
                            className="w-3 h-3"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M6 18L18 6M6 6l12 12"
                            />
                          </svg>
                        </button>
                      </span>
                    </div>
                    {/* インライン編集フォーム */}
                    {editingPresetIndex === originalIndex && (
                      <div className="mx-2 my-1 bg-bg-tertiary/60 rounded-lg px-2.5 py-2 border border-accent/20 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] text-text-muted w-12 flex-shrink-0">
                            カテゴリ
                          </span>
                          <input
                            list="subname-edit-list"
                            value={editForm.subName}
                            onChange={(e) => setEditForm({ ...editForm, subName: e.target.value })}
                            placeholder="なし（選択 or 手入力）"
                            className="flex-1 bg-white border border-border rounded-lg px-2 py-1 text-[10px] text-text-primary
                          focus:border-accent focus:outline-none"
                          />
                          <datalist id="subname-edit-list">
                            {UNIQUE_SUB_NAMES.map((sn) => (
                              <option key={sn} value={sn} />
                            ))}
                          </datalist>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] text-text-muted w-12 flex-shrink-0">
                            表示名
                          </span>
                          <input
                            type="text"
                            value={editForm.name}
                            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                            className="flex-1 bg-white border border-border rounded-lg px-2 py-1 text-[10px] text-text-primary
                          focus:border-accent focus:outline-none"
                          />
                        </div>
                        <div className="flex gap-1.5 justify-end">
                          <button
                            onClick={() => {
                              updateFontInPreset(currentSetName, originalIndex, {
                                name: editForm.name,
                                subName: editForm.subName,
                              });
                              setEditingPresetIndex(null);
                            }}
                            className="text-[9px] font-bold text-white px-3 py-1 rounded-lg transition-all"
                            style={{ background: "linear-gradient(135deg, #ff5a8a, #7c5cff)" }}
                          >
                            保存
                          </button>
                          <button
                            onClick={() => setEditingPresetIndex(null)}
                            className="text-[9px] text-text-muted px-2 py-1 hover:text-text-primary transition-colors"
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* === 手動フォント追加 === */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <h4 className="text-[10px] font-bold text-text-secondary">フォント手動追加</h4>
          <button
            onClick={() => setShowManualFontAdd(!showManualFontAdd)}
            className={`text-[10px] font-medium px-2.5 py-1 rounded-lg border transition-all ${
              showManualFontAdd
                ? "bg-accent-tertiary/10 text-accent-tertiary border-accent-tertiary/30"
                : "bg-white text-text-muted border-border hover:text-accent-tertiary hover:border-accent-tertiary/30"
            }`}
          >
            {showManualFontAdd ? "閉じる" : "+ 追加フォーム"}
          </button>
        </div>

        {showManualFontAdd && (
          <div className="bg-accent-tertiary/5 rounded-xl px-3 py-2.5 border border-accent-tertiary/20 space-y-2">
            <p className="text-[9px] text-text-muted">
              追加したフォントは「手動追加」セットに登録されます。フォント名やPostScript名の一部を入力して検索できます。
            </p>
            <div className="relative">
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-text-muted w-20 flex-shrink-0">フォント検索</span>
                <input
                  type="text"
                  value={fontSearchQuery}
                  onChange={(e) => {
                    setFontSearchQuery(e.target.value);
                    setFontSearchNotFound(false);
                    setShowSearchResults(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") resolveManualFontName();
                  }}
                  placeholder="例: 小塚ゴシック, KozGo, ヒラギノ..."
                  className={`flex-1 bg-white border rounded-lg px-2 py-1 text-[10px] text-text-primary
                    focus:border-accent-tertiary focus:outline-none focus:ring-2 focus:ring-accent-tertiary/15
                    ${fontSearchNotFound ? "border-error" : "border-border"}`}
                />
                <button
                  onClick={resolveManualFontName}
                  disabled={!fontSearchQuery.trim() || manualFontResolving}
                  className="text-[9px] text-accent-tertiary hover:bg-accent-tertiary/10 px-2 py-1 rounded-lg border border-accent-tertiary/30 transition-colors disabled:opacity-40"
                  title="インストール済みフォントを部分一致検索"
                >
                  {manualFontResolving ? "..." : "検索"}
                </button>
              </div>
              {fontSearchNotFound && (
                <p className="text-[9px] text-error mt-1 ml-[88px]">
                  一致するフォントが見つかりませんでした
                </p>
              )}
              {showSearchResults && fontSearchResults.length > 0 && (
                <div className="absolute left-[88px] right-0 mt-1 bg-white border border-accent-tertiary/30 rounded-lg shadow-lg z-50 max-h-48 overflow-y-auto">
                  <div className="px-2 py-1 text-[9px] text-text-muted border-b border-border bg-bg-tertiary rounded-t-lg">
                    {fontSearchResults.length}件のフォントが見つかりました — クリックで選択
                  </div>
                  {fontSearchResults.map((r) => (
                    <button
                      key={r.postscript_name}
                      onClick={() => selectSearchResult(r)}
                      className="w-full text-left px-2 py-1.5 hover:bg-accent-tertiary/10 transition-colors border-b border-border/50 last:border-b-0"
                    >
                      <div className="text-[10px] text-text-primary font-medium">
                        {r.display_name} {r.style_name}
                      </div>
                      <div className="text-[9px] text-text-muted font-mono">
                        {r.postscript_name}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-text-muted w-20 flex-shrink-0">PostScript名</span>
              <input
                type="text"
                value={manualFont.psName}
                onChange={(e) => setManualFont({ ...manualFont, psName: e.target.value })}
                placeholder="検索結果から自動入力 or 直接入力"
                className="flex-1 bg-white border border-border rounded-lg px-2 py-1 text-[10px] text-text-primary font-mono
                  focus:border-accent-tertiary focus:outline-none focus:ring-2 focus:ring-accent-tertiary/15"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-text-muted w-20 flex-shrink-0">表示名</span>
              <input
                type="text"
                value={manualFont.displayName}
                onChange={(e) => setManualFont({ ...manualFont, displayName: e.target.value })}
                placeholder="検索結果から自動入力 or 手入力"
                className="flex-1 bg-white border border-border rounded-lg px-2 py-1 text-[10px] text-text-primary
                  focus:border-accent-tertiary focus:outline-none focus:ring-2 focus:ring-accent-tertiary/15"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-text-muted w-20 flex-shrink-0">カテゴリ</span>
              <input
                list="subname-manual-list"
                value={manualFont.subName}
                onChange={(e) => setManualFont({ ...manualFont, subName: e.target.value })}
                placeholder="自動判定（選択 or 手入力）"
                className="flex-1 bg-white border border-border rounded-lg px-2 py-1 text-[10px] text-text-primary
                  focus:border-accent-tertiary focus:outline-none"
              />
              <datalist id="subname-manual-list">
                {UNIQUE_SUB_NAMES.map((sn) => (
                  <option key={sn} value={sn} />
                ))}
              </datalist>
            </div>
            <div className="flex gap-1.5 justify-end pt-1">
              <button
                onClick={handleManualFontAdd}
                disabled={!manualFont.psName.trim()}
                className="text-[10px] font-bold text-white px-4 py-1.5 rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: "linear-gradient(135deg, #00c9a7, #7c5cff)" }}
              >
                手動追加に登録
              </button>
              <button
                onClick={() => {
                  setShowManualFontAdd(false);
                  setManualFont({ psName: "", displayName: "", subName: "" });
                  setFontSearchQuery("");
                  setFontSearchResults([]);
                  setShowSearchResults(false);
                  setFontSearchNotFound(false);
                }}
                className="text-[10px] text-text-muted px-3 py-1.5 hover:text-text-primary transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 未登録フォント */}
      {scanData && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <h4 className="text-[10px] font-bold text-text-secondary">未登録フォント</h4>
            <span
              className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                unregisteredFonts.length === 0
                  ? "text-success bg-success/10"
                  : "text-warning bg-warning/10"
              }`}
            >
              {unregisteredFonts.length}
            </span>
          </div>
          {unregisteredFonts.length === 0 ? (
            <div className="flex items-center gap-2 py-2.5 px-3 bg-success/5 rounded-xl border border-success/20">
              <svg
                className="w-3.5 h-3.5 text-success flex-shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span className="text-[10px] text-success font-medium">
                全てのフォントが登録済みです
              </span>
            </div>
          ) : (
            <>
              <div className="space-y-1 mb-2">
                {unregisteredFonts.map((f) => (
                  <div
                    key={f.name}
                    className="flex items-center gap-2 bg-warning/5 hover:bg-warning/10 rounded-lg px-2.5 py-1.5
                      border border-warning/10 hover:border-warning/30 transition-all"
                  >
                    <span className="text-xs text-text-primary flex-1 truncate">
                      {f.displayName || f.name}
                    </span>
                    <span className="text-[9px] text-text-muted bg-bg-tertiary px-1.5 py-0.5 rounded">
                      {f.count}回
                    </span>
                    <button
                      onClick={() => handleAddUnregistered(f.name, f.displayName, f.count)}
                      className="text-[10px] text-accent font-medium hover:text-white hover:bg-accent px-2 py-0.5 rounded-lg transition-all"
                    >
                      追加
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={handleAddAllUnregistered}
                className="w-full py-2 text-[10px] font-bold text-white rounded-xl transition-all hover:-translate-y-0.5"
                style={{
                  background: "linear-gradient(135deg, #ff5a8a, #7c5cff)",
                  boxShadow: "0 3px 12px rgba(255,90,138,0.2)",
                }}
              >
                検出フォントを全て追加
              </button>
            </>
          )}
        </div>
      )}

      {/* 共有フォルダフォントブラウザモーダル */}
      {showFontBrowser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowFontBrowser(false);
            e.stopPropagation();
          }}
        >
          <div onMouseDown={(e) => e.stopPropagation()}>
            <FontBrowserDialog
              basePath={FONT_SHARE_PATH}
              missingFontNames={missingFontNames.map((n) => fontResolveMap[n]?.display_name || n)}
              onInstalled={resolveFonts}
              onClose={() => setShowFontBrowser(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// --- フィルタチップコンポーネント ---
function FilterChip({
  label,
  active,
  onClick,
  color = "accent",
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  color?: "accent" | "error";
}) {
  const base =
    color === "error"
      ? active
        ? `bg-red-100 text-red-600 border-red-300`
        : "bg-white text-text-muted border-border hover:text-red-500 hover:border-red-200"
      : active
        ? "bg-accent/10 text-accent border-accent/30"
        : "bg-white text-text-muted border-border hover:text-accent hover:border-accent/20";
  return (
    <button
      onClick={onClick}
      className={`text-[9px] font-medium px-2 py-0.5 rounded-full border transition-all ${base}`}
    >
      {label}
    </button>
  );
}
