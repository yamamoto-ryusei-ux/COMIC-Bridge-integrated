import { useState } from "react";
import { useSpecStore } from "../../store/specStore";
import { Modal } from "../ui/Modal";

export function SpecSelectionModal() {
  const showModal = useSpecStore((state) => state.showSpecSelectionModal);
  const pendingFilesCount = useSpecStore((state) => state.pendingFilesCount);
  const specifications = useSpecStore((state) => state.specifications);
  const lastSelectedSpecId = useSpecStore((state) => state.lastSelectedSpecId);
  const autoCheckEnabled = useSpecStore((state) => state.autoCheckEnabled);
  const closeModal = useSpecStore((state) => state.closeSpecSelectionModal);
  const selectSpecAndCheck = useSpecStore((state) => state.selectSpecAndCheck);
  const setAutoCheckEnabled = useSpecStore((state) => state.setAutoCheckEnabled);

  const [rememberChoice, setRememberChoice] = useState(autoCheckEnabled);

  const handleSelect = (specId: string) => {
    if (rememberChoice) {
      setAutoCheckEnabled(true);
    }
    selectSpecAndCheck(specId);
  };

  const monoSpec = specifications.find((s) => s.id === "mono-spec");
  const colorSpec = specifications.find((s) => s.id === "color-spec");

  const lastSpecName = lastSelectedSpecId
    ? specifications.find((s) => s.id === lastSelectedSpecId)?.name
    : null;

  return (
    <Modal isOpen={showModal} onClose={closeModal} size="lg" showCloseButton={false}>
      <div className="text-center">
        {/* タイトル */}
        <div className="mb-6">
          <h2 className="text-2xl font-display font-bold text-text-primary mb-2">
            どの仕様でチェックしますか?
          </h2>
          <p className="text-text-secondary">{pendingFilesCount}件のファイルを読み込みました</p>
        </div>

        {/* 仕様選択ボタン */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          {/* モノクロ原稿 */}
          <button
            onClick={() => monoSpec && handleSelect(monoSpec.id)}
            className="
              group relative p-6 rounded-2xl
              bg-bg-tertiary
              border-2 border-border
              hover:border-accent hover:shadow-glow-pink
              transition-all duration-300
              hover:-translate-y-1
              shadow-card
            "
          >
            {/* アイコン */}
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-bg-primary flex items-center justify-center group-hover:bg-manga-lavender/30 transition-colors">
              <svg
                className="w-10 h-10 text-text-secondary group-hover:text-text-primary transition-colors"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
            </div>
            <h3 className="text-xl font-display font-bold text-text-primary mb-2">モノクロ原稿</h3>
            <div className="space-y-1 text-sm text-text-muted">
              <p>Grayscale</p>
              <p>600 dpi</p>
              <p>8 bit</p>
            </div>
            {/* ホバー時のグロー */}
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-accent/0 to-accent/0 group-hover:from-accent/10 group-hover:to-accent-secondary/10 transition-all" />
          </button>

          {/* カラー原稿 */}
          <button
            onClick={() => colorSpec && handleSelect(colorSpec.id)}
            className="
              group relative p-6 rounded-2xl
              bg-bg-tertiary
              border-2 border-border
              hover:border-accent-secondary hover:shadow-glow-purple
              transition-all duration-300
              hover:-translate-y-1
              shadow-card
            "
          >
            {/* アイコン */}
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-bg-primary flex items-center justify-center group-hover:bg-manga-mint/30 transition-colors">
              <svg
                className="w-10 h-10 text-text-secondary group-hover:text-text-primary transition-colors"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
                />
              </svg>
            </div>
            <h3 className="text-xl font-display font-bold text-text-primary mb-2">カラー原稿</h3>
            <div className="space-y-1 text-sm text-text-muted">
              <p>RGB</p>
              <p>350 dpi</p>
              <p>8 bit</p>
            </div>
            {/* ホバー時のグロー */}
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-accent-secondary/0 to-accent/0 group-hover:from-accent-secondary/5 group-hover:to-accent/5 transition-all" />
          </button>
        </div>

        {/* 自動選択オプション */}
        <label className="inline-flex items-center gap-2 cursor-pointer text-text-secondary hover:text-text-primary transition-colors">
          <input
            type="checkbox"
            checked={rememberChoice}
            onChange={(e) => setRememberChoice(e.target.checked)}
            className="
              w-4 h-4 rounded
              border-2 border-text-muted
              bg-transparent
              checked:bg-accent checked:border-accent
              focus:ring-2 focus:ring-accent/30
              transition-colors
            "
          />
          <span className="text-sm">
            次回から自動で選択
            {lastSpecName && <span className="text-text-muted ml-1">(前回: {lastSpecName})</span>}
          </span>
        </label>

        {/* スキップボタン */}
        <div className="mt-6">
          <button
            onClick={closeModal}
            className="text-sm text-text-muted hover:text-text-secondary transition-colors"
          >
            スキップして後で選択
          </button>
        </div>
      </div>
    </Modal>
  );
}
