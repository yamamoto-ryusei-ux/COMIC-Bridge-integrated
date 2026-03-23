interface DropZoneProps {
  showPdf?: boolean;
}

export function DropZone({ showPdf = false }: DropZoneProps) {
  // ブラウザのデフォルトdrag挙動を防止
  const preventDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      className="
        flex flex-col items-center justify-center h-full
        border-2 border-dashed rounded-3xl m-6 transition-all duration-300
        border-text-muted/20 hover:border-accent/40 hover:bg-accent/5
      "
      onDragOver={preventDrag}
      onDragLeave={preventDrag}
      onDrop={preventDrag}
    >
      <div className="text-center p-8">
        {/* アイコン */}
        <div className="w-24 h-24 mx-auto mb-6 rounded-3xl flex items-center justify-center bg-bg-tertiary">
          <svg
            className="w-12 h-12 text-text-muted"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
        </div>

        {/* テキスト */}
        <p className="text-xl font-display font-medium mb-3 text-text-primary">
          PSDファイルをドロップ
        </p>
        <p className="text-sm text-text-muted mb-6">フォルダまたはファイルをドラッグ＆ドロップ</p>

        {/* 対応形式バッジ */}
        <div className="flex items-center justify-center gap-2">
          <span className="px-3 py-1 bg-manga-pink/20 text-manga-pink text-xs rounded-full">
            .psd
          </span>
          <span className="px-3 py-1 bg-manga-lavender/20 text-manga-lavender text-xs rounded-full">
            .psb
          </span>
          {showPdf && (
            <span className="px-3 py-1 bg-manga-lavender/20 text-manga-lavender text-xs rounded-full">
              .pdf
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
