/**
 * COMIC-POT エディタ専用ローカルステート
 * progen-comicpot.js の28個のモジュール変数を移植
 */
import { useReducer, useCallback, useRef } from "react";
import {
  readTxtFile,
  writeTextFile,
  showSaveTextDialog,
  readDroppedTxtFiles,
} from "./useProgenTauri";

// ═══ 型定義 ═══

export interface CpChunk {
  content: string;
  type: "dialogue" | "separator";
}

export type CpRubyMode = "comicpot" | "standard";

export interface CpState {
  /** テキスト全体 */
  text: string;
  /** パース済みチャンク配列 */
  chunks: CpChunk[];
  /** 選択中チャンクインデックス */
  selectedChunkIndex: number | null;
  /** ファイル名 */
  fileName: string;
  /** ファイルパス (上書き保存用) */
  filePath: string;
  /** 最後に保存したテキスト (dirty判定) */
  savedText: string;
  /** 編集モード (true=textarea, false=チャンク選択) */
  isEditing: boolean;
  /** COMIC-POTヘッダー ([COMIC-POT:...]) */
  header: string;
  /** ルビモード */
  rubyMode: CpRubyMode;
  /** D&D: ドラッグ中のインデックス */
  draggedIndex: number | null;
  /** D&D: オーバー中のインデックス */
  dragOverIndex: number | null;
  /** D&D: ドロップ位置 */
  dropPosition: "before" | "after";
  /** 右パネル表示 */
  resultPanelVisible: boolean;
  /** パネルタブ */
  panelTab: "simple" | "variation" | "viewer";
  /** パネル幅(%) */
  panelWidthPercent: number;
  /** Undo履歴 */
  history: string[];
  /** Redo履歴 */
  future: string[];
}

// ═══ 初期値 ═══

const INITIAL_STATE: CpState = {
  text: "",
  chunks: [],
  selectedChunkIndex: null,
  fileName: "無題",
  filePath: "",
  savedText: "",
  isEditing: false,
  header: "",
  rubyMode: (localStorage.getItem("cpRubyMode") as CpRubyMode) || "comicpot",
  draggedIndex: null,
  dragOverIndex: null,
  dropPosition: "before",
  resultPanelVisible: false,
  panelTab: "simple",
  panelWidthPercent: 50,
  history: [],
  future: [],
};

// ═══ パーサー ═══

const HEADER_RE = /^\[COMIC-POT(:\w+)?\]$/;
const VOLUME_RE = /^\[\d+巻\]$/;
const PAGE_RE = /^<<\d+Page>>$/;
const DASH_RE = /^-{10,}$/;

/** COMIC-POT形式テキストをチャンクに分割 */
export function cpParseTextToChunks(inputText: string): CpChunk[] {
  const lines = inputText.split("\n");
  const parsed: CpChunk[] = [];
  let currentLines: string[] = [];

  const flush = () => {
    if (currentLines.length > 0) {
      parsed.push({ content: currentLines.join("\n"), type: "dialogue" });
      currentLines = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (HEADER_RE.test(trimmed)) continue;
    if (VOLUME_RE.test(trimmed) || PAGE_RE.test(trimmed)) {
      flush();
      parsed.push({ content: trimmed, type: "separator" });
    } else if (DASH_RE.test(trimmed)) {
      flush();
      parsed.push({ content: "----------", type: "separator" });
    } else if (trimmed === "") {
      flush();
    } else {
      currentLines.push(line);
    }
  }
  flush();
  return parsed;
}

/** ヘッダー抽出 */
export function cpExtractHeader(content: string): string {
  for (const line of content.split("\n")) {
    if (HEADER_RE.test(line.trim())) return line.trim();
  }
  return "";
}

/** チャンク配列→テキスト再構成 */
export function cpReconstructText(header: string, chunks: CpChunk[]): string {
  let result = "";
  if (header) result = header + "\n\n";
  for (let i = 0; i < chunks.length; i++) {
    result += chunks[i].content;
    if (i < chunks.length - 1) {
      const curr = chunks[i];
      const next = chunks[i + 1];
      result += curr.type === "separator" || next.type === "separator" ? "\n" : "\n\n";
    }
  }
  return result;
}

/** ルビフォーマット */
export function cpFormatRuby(parent: string, ruby: string, mode: CpRubyMode): string {
  return mode === "standard" ? `${parent}（${ruby}）` : `[${parent}](${ruby})`;
}

/** ルビプレースホルダ */
export function cpFormatRubyPlaceholder(parent: string, mode: CpRubyMode): string {
  return mode === "standard" ? `${parent}（...）` : `[${parent}](...)`;
}

/** ルビパターン (表示用) */
export const RUBY_PATTERN = /\[([^\]]+)\]\(([^)]+)\)/g;

// ═══ Reducer ═══

type CpAction =
  | { type: "SET_TEXT"; text: string }
  | { type: "LOAD_FILE"; fileName: string; filePath: string; content: string }
  | { type: "SET_SAVED" }
  | { type: "SELECT_CHUNK"; index: number | null }
  | { type: "TOGGLE_EDIT_MODE" }
  | { type: "MOVE_CHUNK_UP" }
  | { type: "MOVE_CHUNK_DOWN" }
  | { type: "DELETE_CHUNK" }
  | { type: "TOGGLE_DELETE_MARK" }
  | { type: "APPLY_RUBY"; start: number; end: number; replacement: string }
  | { type: "APPLY_CONVERT"; header: string; chunks: CpChunk[] }
  | { type: "DROP_CHUNK"; fromIndex: number; toIndex: number; position: "before" | "after" }
  | { type: "SET_DRAG"; draggedIndex: number | null; dragOverIndex: number | null; dropPosition: "before" | "after" }
  | { type: "SET_RUBY_MODE"; mode: CpRubyMode }
  | { type: "TOGGLE_PANEL" }
  | { type: "SET_PANEL_TAB"; tab: "simple" | "variation" | "viewer" }
  | { type: "SET_PANEL_WIDTH"; percent: number }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "SET_FILE_PATH"; filePath: string; fileName: string };

function pushHistory(state: CpState): CpState {
  return {
    ...state,
    history: [...state.history.slice(-49), state.text],
    future: [],
  };
}

function rebuildText(state: CpState, chunks: CpChunk[], selectedChunkIndex: number | null): CpState {
  const text = cpReconstructText(state.header, chunks);
  const newChunks = cpParseTextToChunks(text);
  return { ...state, text, chunks: newChunks, selectedChunkIndex };
}

function cpReducer(state: CpState, action: CpAction): CpState {
  switch (action.type) {
    case "SET_TEXT": {
      const text = action.text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      const header = cpExtractHeader(text);
      const chunks = cpParseTextToChunks(text);
      return { ...state, text, header, chunks, selectedChunkIndex: null };
    }

    case "LOAD_FILE": {
      let content = action.content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      if (content.charCodeAt(0) === 0xfeff) content = content.substring(1);
      const header = cpExtractHeader(content);
      const chunks = cpParseTextToChunks(content);
      return {
        ...state,
        text: content,
        header,
        chunks,
        fileName: action.fileName,
        filePath: action.filePath,
        savedText: content,
        selectedChunkIndex: null,
        isEditing: false,
      };
    }

    case "SET_SAVED":
      return { ...state, savedText: state.text };

    case "SELECT_CHUNK":
      return { ...state, selectedChunkIndex: action.index };

    case "TOGGLE_EDIT_MODE":
      return { ...state, isEditing: !state.isEditing };

    case "MOVE_CHUNK_UP": {
      const idx = state.selectedChunkIndex;
      if (idx === null || idx <= 0) return state;
      const s = pushHistory(state);
      const newChunks = [...s.chunks];
      const moving = newChunks.splice(idx, 1)[0];
      newChunks.splice(idx - 1, 0, moving);
      return rebuildText(s, newChunks, idx - 1);
    }

    case "MOVE_CHUNK_DOWN": {
      const idx = state.selectedChunkIndex;
      if (idx === null || idx >= state.chunks.length - 1) return state;
      const s = pushHistory(state);
      const newChunks = [...s.chunks];
      const moving = newChunks.splice(idx, 1)[0];
      newChunks.splice(idx + 1, 0, moving);
      return rebuildText(s, newChunks, idx + 1);
    }

    case "DELETE_CHUNK": {
      const idx = state.selectedChunkIndex;
      if (idx === null) return state;
      const s = pushHistory(state);
      const newChunks = [...s.chunks];
      newChunks.splice(idx, 1);
      // 新しい選択: 前のdialogueチャンクを優先
      let newSel: number | null = null;
      for (let i = Math.min(idx, newChunks.length - 1); i >= 0; i--) {
        if (newChunks[i]?.type === "dialogue") { newSel = i; break; }
      }
      if (newSel === null) {
        for (let i = 0; i < newChunks.length; i++) {
          if (newChunks[i]?.type === "dialogue") { newSel = i; break; }
        }
      }
      return rebuildText(s, newChunks, newSel);
    }

    case "TOGGLE_DELETE_MARK": {
      const idx = state.selectedChunkIndex;
      if (idx === null || state.chunks[idx]?.type !== "dialogue") return state;
      const s = pushHistory(state);
      const chunk = { ...s.chunks[idx] };
      const lines = chunk.content.split("\n");
      const allMarked = lines.every((l) => l.trimStart().startsWith("//"));
      if (allMarked) {
        for (let i = 0; i < lines.length; i++) {
          lines[i] = lines[i].replace(/^(\s*)\/\/\s?/, "$1");
        }
      } else {
        for (let i = 0; i < lines.length; i++) {
          if (!lines[i].trimStart().startsWith("//")) lines[i] = "//" + lines[i];
        }
      }
      chunk.content = lines.join("\n");
      const newChunks = [...s.chunks];
      newChunks[idx] = chunk;
      return rebuildText(s, newChunks, idx);
    }

    case "APPLY_RUBY": {
      const s = pushHistory(state);
      const before = s.text.substring(0, action.start);
      const after = s.text.substring(action.end);
      const newText = before + action.replacement + after;
      const header = cpExtractHeader(newText);
      const chunks = cpParseTextToChunks(newText);
      return { ...s, text: newText, header, chunks };
    }

    case "APPLY_CONVERT": {
      const s = pushHistory(state);
      const text = cpReconstructText(action.header, action.chunks);
      const chunks = cpParseTextToChunks(text);
      return { ...s, text, header: action.header, chunks, selectedChunkIndex: null };
    }

    case "DROP_CHUNK": {
      const { fromIndex, toIndex, position } = action;
      if (fromIndex === toIndex) return state;
      const s = pushHistory(state);
      const newChunks = [...s.chunks];
      const dragged = newChunks.splice(fromIndex, 1)[0];
      let insertIdx = toIndex;
      if (position === "after") insertIdx++;
      if (fromIndex < toIndex) insertIdx--;
      insertIdx = Math.max(0, Math.min(insertIdx, newChunks.length));
      newChunks.splice(insertIdx, 0, dragged);
      return rebuildText(s, newChunks, insertIdx);
    }

    case "SET_DRAG":
      return {
        ...state,
        draggedIndex: action.draggedIndex,
        dragOverIndex: action.dragOverIndex,
        dropPosition: action.dropPosition,
      };

    case "SET_RUBY_MODE":
      localStorage.setItem("cpRubyMode", action.mode);
      return { ...state, rubyMode: action.mode };

    case "TOGGLE_PANEL":
      return { ...state, resultPanelVisible: !state.resultPanelVisible };

    case "SET_PANEL_TAB":
      return { ...state, panelTab: action.tab };

    case "SET_PANEL_WIDTH":
      return { ...state, panelWidthPercent: Math.max(20, Math.min(70, action.percent)) };

    case "UNDO": {
      if (state.history.length === 0) return state;
      const prevText = state.history[state.history.length - 1];
      const header = cpExtractHeader(prevText);
      const chunks = cpParseTextToChunks(prevText);
      return {
        ...state,
        text: prevText,
        header,
        chunks,
        selectedChunkIndex: null,
        history: state.history.slice(0, -1),
        future: [state.text, ...state.future],
      };
    }

    case "REDO": {
      if (state.future.length === 0) return state;
      const nextText = state.future[0];
      const header = cpExtractHeader(nextText);
      const chunks = cpParseTextToChunks(nextText);
      return {
        ...state,
        text: nextText,
        header,
        chunks,
        selectedChunkIndex: null,
        history: [...state.history, state.text],
        future: state.future.slice(1),
      };
    }

    case "SET_FILE_PATH":
      return { ...state, filePath: action.filePath, fileName: action.fileName };

    default:
      return state;
  }
}

// ═══ フック ═══

export function useComicPotState() {
  const [state, dispatch] = useReducer(cpReducer, INITIAL_STATE);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isDirty = state.text !== state.savedText;

  // === テキスト操作 ===
  const setText = useCallback((text: string) => dispatch({ type: "SET_TEXT", text }), []);

  const loadFile = useCallback((fileName: string, filePath: string, content: string) => {
    dispatch({ type: "LOAD_FILE", fileName, filePath, content });
  }, []);

  const selectChunk = useCallback((index: number | null) => {
    dispatch({ type: "SELECT_CHUNK", index });
  }, []);

  const toggleEditMode = useCallback(() => dispatch({ type: "TOGGLE_EDIT_MODE" }), []);
  const moveChunkUp = useCallback(() => dispatch({ type: "MOVE_CHUNK_UP" }), []);
  const moveChunkDown = useCallback(() => dispatch({ type: "MOVE_CHUNK_DOWN" }), []);
  const deleteChunk = useCallback(() => dispatch({ type: "DELETE_CHUNK" }), []);
  const toggleDeleteMark = useCallback(() => dispatch({ type: "TOGGLE_DELETE_MARK" }), []);
  const undo = useCallback(() => dispatch({ type: "UNDO" }), []);
  const redo = useCallback(() => dispatch({ type: "REDO" }), []);

  // === ルビ ===
  const applyRuby = useCallback((start: number, end: number, replacement: string) => {
    dispatch({ type: "APPLY_RUBY", start, end, replacement });
  }, []);

  const setRubyMode = useCallback((mode: CpRubyMode) => {
    dispatch({ type: "SET_RUBY_MODE", mode });
  }, []);

  // === 形式変換 ===
  const applyConvert = useCallback((header: string, chunks: CpChunk[]) => {
    dispatch({ type: "APPLY_CONVERT", header, chunks });
  }, []);

  // === D&D ===
  const setDrag = useCallback((draggedIndex: number | null, dragOverIndex: number | null, dropPosition: "before" | "after") => {
    dispatch({ type: "SET_DRAG", draggedIndex, dragOverIndex, dropPosition });
  }, []);

  const dropChunk = useCallback((fromIndex: number, toIndex: number, position: "before" | "after") => {
    dispatch({ type: "DROP_CHUNK", fromIndex, toIndex, position });
  }, []);

  // === パネル ===
  const togglePanel = useCallback(() => dispatch({ type: "TOGGLE_PANEL" }), []);
  const setPanelTab = useCallback((tab: "simple" | "variation" | "viewer") => {
    dispatch({ type: "SET_PANEL_TAB", tab });
  }, []);
  const setPanelWidth = useCallback((percent: number) => {
    dispatch({ type: "SET_PANEL_WIDTH", percent });
  }, []);

  // === ファイルI/O ===
  const handleSave = useCallback(async () => {
    if (state.filePath) {
      await writeTextFile(state.filePath, state.text);
      dispatch({ type: "SET_SAVED" });
      return true;
    }
    return handleSaveAs();
  }, [state.filePath, state.text]);

  const handleSaveAs = useCallback(async () => {
    const result = await showSaveTextDialog(state.fileName || "無題.txt");
    if (!result) return false;
    await writeTextFile(result, state.text);
    const name = result.split(/[/\\]/).pop() || state.fileName;
    dispatch({ type: "SET_FILE_PATH", filePath: result, fileName: name });
    dispatch({ type: "SET_SAVED" });
    return true;
  }, [state.fileName, state.text]);

  const handleLoadTxtFile = useCallback(async (filePath: string) => {
    const content = await readTxtFile(filePath);
    const name = filePath.split(/[/\\]/).pop() || "無題";
    loadFile(name, filePath, content);
  }, [loadFile]);

  const handleLoadDroppedFiles = useCallback(async (paths: string[]) => {
    const txtPaths = paths.filter((p) => p.toLowerCase().endsWith(".txt"));
    if (txtPaths.length === 0) return [];
    const result = await readDroppedTxtFiles(txtPaths);
    if (!result?.success || !result.files?.length) return [];
    return result.files as { name: string; content: string }[];
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(state.text);
      return true;
    } catch {
      return false;
    }
  }, [state.text]);

  return {
    state,
    dispatch,
    textareaRef,
    isDirty,
    // テキスト操作
    setText,
    loadFile,
    selectChunk,
    toggleEditMode,
    moveChunkUp,
    moveChunkDown,
    deleteChunk,
    toggleDeleteMark,
    undo,
    redo,
    // ルビ
    applyRuby,
    setRubyMode,
    // 変換
    applyConvert,
    // D&D
    setDrag,
    dropChunk,
    // パネル
    togglePanel,
    setPanelTab,
    setPanelWidth,
    // ファイルI/O
    handleSave,
    handleSaveAs,
    handleLoadTxtFile,
    handleLoadDroppedFiles,
    handleCopy,
  };
}
