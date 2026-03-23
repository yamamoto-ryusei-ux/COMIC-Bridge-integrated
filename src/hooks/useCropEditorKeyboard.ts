import { useEffect, useRef } from "react";

interface CropEditorKeyboardOptions {
  isActive: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onDeleteGuide: () => void;
  onDeleteRange: () => void;
  onEscape: () => void;
  /** ガイド移動: 1px / Shift+10px（Tachimi互換） */
  onNudgeGuide: (dx: number, dy: number) => void;
  /** 範囲移動: 10px / Shift+1px（Tachimi互換 — ガイドと逆） */
  onNudgeRange: (dx: number, dy: number, isFirst: boolean) => void;
  /** ガイドが選択されているか（矢印キーの振り分けに使用） */
  hasSelectedGuide: boolean;
  /** 範囲が存在するか */
  hasRange: boolean;
  onSpaceDown: () => void;
  onSpaceUp: () => void;
}

export function useCropEditorKeyboard(options: CropEditorKeyboardOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // 矢印キー連続操作のUndo最適化用フラグ
  const arrowKeyActiveRef = useRef(false);

  useEffect(() => {
    if (!optionsRef.current.isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const opts = optionsRef.current;
      if (!opts.isActive) return;

      // Ignore when typing in input/textarea/select
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const ctrl = e.ctrlKey || e.metaKey;

      // Space for pan
      if (e.code === "Space") {
        e.preventDefault();
        if (!e.repeat) {
          opts.onSpaceDown();
        }
        return;
      }

      // Ctrl+Z: Undo
      if (ctrl && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        opts.onUndo();
        return;
      }

      // Ctrl+Y or Ctrl+Shift+Z: Redo
      if (
        ctrl &&
        (e.key === "y" || (e.key === "z" && e.shiftKey) || (e.key === "Z" && e.shiftKey))
      ) {
        e.preventDefault();
        opts.onRedo();
        return;
      }

      // Ctrl+= or Ctrl++ or Ctrl+;: Zoom in (Tachimi互換)
      if (ctrl && (e.key === "=" || e.key === "+" || e.key === ";")) {
        e.preventDefault();
        opts.onZoomIn();
        return;
      }

      // Ctrl+-: Zoom out
      if (ctrl && e.key === "-") {
        e.preventDefault();
        opts.onZoomOut();
        return;
      }

      // Ctrl+0: Reset zoom
      if (ctrl && e.key === "0") {
        e.preventDefault();
        opts.onZoomReset();
        return;
      }

      // Delete/Backspace: ガイド選択時→ガイド削除、それ以外→範囲削除
      if (e.key === "Delete" || e.key === "Backspace") {
        if (opts.hasSelectedGuide) {
          e.preventDefault();
          opts.onDeleteGuide();
          return;
        }
        if (opts.hasRange) {
          e.preventDefault();
          opts.onDeleteRange();
          return;
        }
      }

      // Escape: Deselect guide or close crop mode
      if (e.key === "Escape") {
        e.preventDefault();
        opts.onEscape();
        return;
      }

      // Arrow keys: ガイド移動 or 範囲移動（Tachimi互換 — ステップ値が逆）
      if (
        e.key === "ArrowUp" ||
        e.key === "ArrowDown" ||
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight"
      ) {
        e.preventDefault();

        if (opts.hasSelectedGuide) {
          // ガイド移動: 1px / Shift+10px
          const step = e.shiftKey ? 10 : 1;
          const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
          const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
          opts.onNudgeGuide(dx, dy);
        } else if (opts.hasRange) {
          // 範囲移動: 10px / Shift+1px（Tachimiと同じ — ガイドと逆）
          const step = e.shiftKey ? 1 : 10;
          const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
          const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
          // 連続操作で1回だけUndoを保存
          const isFirst = !arrowKeyActiveRef.current;
          arrowKeyActiveRef.current = true;
          opts.onNudgeRange(dx, dy, isFirst);
        }
        return;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        optionsRef.current.onSpaceUp();
      }
      // 矢印キーリリースでUndoフラグリセット
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        arrowKeyActiveRef.current = false;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [options.isActive]);
}
