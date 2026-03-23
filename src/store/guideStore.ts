import { create } from "zustand";
import type { Guide } from "../types";

interface GuideStore {
  // Editor state
  guides: Guide[];
  isEditorOpen: boolean;
  selectedGuideIndex: number | null;

  // Undo/Redo
  history: Guide[][];
  future: Guide[][];

  // Actions
  setGuides: (guides: Guide[]) => void;
  addGuide: (guide: Guide) => void;
  updateGuide: (index: number, guide: Guide) => void;
  moveGuide: (index: number, guide: Guide) => void;
  removeGuide: (index: number) => void;
  clearGuides: () => void;

  // Editor actions
  openEditor: () => void;
  closeEditor: () => void;
  setSelectedGuideIndex: (index: number | null) => void;

  // History actions
  undo: () => void;
  redo: () => void;
  pushHistory: () => void;
}

export const useGuideStore = create<GuideStore>((set, get) => ({
  // Initial state
  guides: [],
  isEditorOpen: false,
  selectedGuideIndex: null,
  history: [],
  future: [],

  // Guide actions
  setGuides: (guides) => {
    get().pushHistory();
    set({ guides, future: [] });
  },

  addGuide: (guide) => {
    get().pushHistory();
    set((state) => ({
      guides: [...state.guides, guide],
      future: [],
    }));
  },

  updateGuide: (index, guide) => {
    get().pushHistory();
    set((state) => ({
      guides: state.guides.map((g, i) => (i === index ? guide : g)),
      future: [],
    }));
  },

  // ドラッグ中の位置更新（履歴を積まない。drag開始時に呼び出し側でpushHistory）
  moveGuide: (index, guide) => {
    set((state) => ({
      guides: state.guides.map((g, i) => (i === index ? guide : g)),
      future: [],
    }));
  },

  removeGuide: (index) => {
    get().pushHistory();
    set((state) => ({
      guides: state.guides.filter((_, i) => i !== index),
      selectedGuideIndex: state.selectedGuideIndex === index ? null : state.selectedGuideIndex,
      future: [],
    }));
  },

  clearGuides: () => {
    get().pushHistory();
    set({ guides: [], selectedGuideIndex: null, future: [] });
  },

  // Editor actions
  openEditor: () => set({ isEditorOpen: true }),
  closeEditor: () => set({ isEditorOpen: false, selectedGuideIndex: null }),
  setSelectedGuideIndex: (selectedGuideIndex) => set({ selectedGuideIndex }),

  // History actions
  pushHistory: () => {
    set((state) => ({
      history: [...state.history.slice(-19), state.guides],
    }));
  },

  undo: () => {
    set((state) => {
      if (state.history.length === 0) return state;
      const previous = state.history[state.history.length - 1];
      return {
        guides: previous,
        history: state.history.slice(0, -1),
        future: [state.guides, ...state.future],
      };
    });
  },

  redo: () => {
    set((state) => {
      if (state.future.length === 0) return state;
      const next = state.future[0];
      return {
        guides: next,
        history: [...state.history, state.guides],
        future: state.future.slice(1),
      };
    });
  },
}));
