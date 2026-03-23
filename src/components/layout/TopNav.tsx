import { createPortal } from "react-dom";
import { useViewStore, type AppView } from "../../store/viewStore";
import { usePsdStore } from "../../store/psdStore";
import { useSpecStore } from "../../store/specStore";
import { useAppUpdater } from "../../hooks/useAppUpdater";

const VIEW_TABS: { id: AppView; label: string; icon: React.ReactNode }[] = [
  {
    id: "specCheck",
    label: "完成原稿チェック",
    icon: (
      <svg
        className="w-4 h-4"
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
    ),
  },
  {
    id: "layers",
    label: "レイヤー制御",
    icon: (
      <svg
        className="w-4 h-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
        />
      </svg>
    ),
  },
  {
    id: "typesetting",
    label: "写植関連",
    icon: (
      <svg
        className="w-4 h-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
        />
      </svg>
    ),
  },
  {
    id: "replace",
    label: "差替え",
    icon: (
      <svg
        className="w-4 h-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M8 7h12m0 0l-4-4m4 4l-4 4M16 17H4m0 0l4-4m-4 4l4 4"
        />
      </svg>
    ),
  },
  {
    id: "compose",
    label: "合成",
    icon: (
      <svg
        className="w-4 h-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zm-5 9l3 3m0 0l3-3m-3 3V10"
        />
      </svg>
    ),
  },
  {
    id: "tiff",
    label: "TIFF化",
    icon: (
      <svg
        className="w-4 h-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
        />
      </svg>
    ),
  },
  {
    id: "scanPsd",
    label: "スキャナー",
    icon: (
      <svg
        className="w-4 h-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
        />
      </svg>
    ),
  },
  {
    id: "split",
    label: "見開き分割",
    icon: (
      <svg
        className="w-4 h-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <circle cx="6" cy="6" r="3" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.12 8.12L12 12" />
        <circle cx="18" cy="6" r="3" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.88 8.12L12 12" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 12l-5 8M12 12l5 8" />
      </svg>
    ),
  },
  {
    id: "rename",
    label: "リネーム",
    icon: (
      <svg
        className="w-4 h-4"
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
    ),
  },
];

export function TopNav() {
  const activeView = useViewStore((s) => s.activeView);
  const setActiveView = useViewStore((s) => s.setActiveView);
  const files = usePsdStore((s) => s.files);
  const checkResults = useSpecStore((s) => s.checkResults);
  const updater = useAppUpdater();

  const passedCount = Array.from(checkResults.values()).filter((r) => r.passed).length;
  const failedCount = Array.from(checkResults.values()).filter((r) => !r.passed).length;

  return (
    <nav
      className="h-12 flex-shrink-0 bg-bg-secondary border-b border-border flex items-center px-3 gap-2 relative z-20 shadow-soft"
      data-tauri-drag-region
    >
      {/* Logo */}
      <div className="flex items-center gap-2 mr-2 flex-shrink-0">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-accent to-accent-secondary flex items-center justify-center shadow-sm">
          <svg
            className="w-4 h-4 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
            />
          </svg>
        </div>
        <span className="font-display font-bold text-sm text-text-primary hidden xl:block">
          COMIC-Bridge
        </span>
      </div>

      {/* Separator */}
      <div className="w-px h-6 bg-border flex-shrink-0" />

      {/* View Tabs */}
      <div className="flex items-center gap-1 flex-1 min-w-0">
        {VIEW_TABS.map((tab) => (
          <button
            key={tab.id}
            className={`
              flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg
              transition-all duration-200 flex-shrink-0
              ${
                activeView === tab.id
                  ? "text-white bg-gradient-to-r from-accent to-accent-secondary shadow-sm"
                  : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary"
              }
            `}
            onClick={() => setActiveView(tab.id)}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Right: Status */}
      {files.length > 0 && (
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-text-muted">{files.length} ファイル</span>
          {checkResults.size > 0 && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-bg-tertiary">
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-success" />
                <span className="text-xs font-medium text-success">{passedCount}</span>
              </div>
              <span className="w-px h-3 bg-border" />
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-error" />
                <span className="text-xs font-medium text-error">{failedCount}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Version + Update */}
      <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
        {updater.appVersion && (
          <span className="text-[10px] text-text-muted/60 font-mono">v{updater.appVersion}</span>
        )}
        {updater.phase === "available" ? (
          <button
            onClick={() => updater.downloadAndInstall()}
            className="relative flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-accent-tertiary bg-accent-tertiary/10 rounded-lg hover:bg-accent-tertiary/20 transition-colors"
          >
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-accent-tertiary animate-pulse" />
            v{updater.updateInfo?.version}
          </button>
        ) : updater.phase === "checking" ? (
          <svg
            className="w-3.5 h-3.5 text-text-muted animate-spin"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        ) : updater.phase === "up-to-date" ? (
          <span className="text-[10px] text-accent-tertiary">
            <svg
              className="w-3 h-3 inline"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={3}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </span>
        ) : null}
      </div>

      {/* Update Prompt Dialog (shown on startup when update available) */}
      {updater.showPrompt &&
        updater.updateInfo &&
        createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-bg-secondary border border-border rounded-2xl p-8 shadow-xl max-w-sm text-center space-y-4">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-accent to-accent-secondary flex items-center justify-center shadow-lg">
                <svg
                  className="w-7 h-7 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-bold text-text-primary">アップデートがあります</h3>
                <p className="text-xs text-text-muted mt-1">
                  v{updater.appVersion} →{" "}
                  <span className="text-accent-tertiary font-semibold">
                    v{updater.updateInfo.version}
                  </span>
                </p>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => updater.dismissPrompt()}
                  className="flex-1 px-4 py-2.5 text-xs font-medium text-text-secondary bg-bg-tertiary rounded-xl hover:bg-bg-tertiary/80 transition-colors"
                >
                  あとで
                </button>
                <button
                  onClick={() => {
                    updater.dismissPrompt();
                    updater.downloadAndInstall();
                  }}
                  className="flex-1 px-4 py-2.5 text-xs font-medium text-white bg-gradient-to-r from-accent to-accent-secondary rounded-xl hover:-translate-y-0.5 transition-all shadow-sm"
                >
                  アップデートする
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* Update Dialog (downloading / ready / error) */}
      {(updater.phase === "downloading" ||
        updater.phase === "ready" ||
        updater.phase === "error") &&
        createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-bg-secondary border border-border rounded-2xl p-8 shadow-xl max-w-sm text-center space-y-4">
              {updater.phase === "downloading" && (
                <>
                  <svg
                    className="w-12 h-12 mx-auto text-accent animate-spin"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                  <h3 className="text-base font-bold text-text-primary">アップデート中...</h3>
                  <p className="text-xs text-text-muted">
                    ダウンロードしています。しばらくお待ちください。
                  </p>
                </>
              )}
              {updater.phase === "ready" && (
                <>
                  <svg
                    className="w-12 h-12 mx-auto text-success"
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
                  <h3 className="text-base font-bold text-text-primary">インストール完了</h3>
                  <p className="text-xs text-text-muted">アプリを再起動します...</p>
                </>
              )}
              {updater.phase === "error" && (
                <>
                  <svg
                    className="w-12 h-12 mx-auto text-error"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                  <h3 className="text-base font-bold text-text-primary">アップデート失敗</h3>
                  <p className="text-xs text-text-muted">{updater.error}</p>
                  <button
                    onClick={updater.dismiss}
                    className="px-4 py-2 text-xs font-medium text-white bg-gradient-to-r from-accent to-accent-secondary rounded-xl hover:-translate-y-0.5 transition-all"
                  >
                    閉じる
                  </button>
                </>
              )}
            </div>
          </div>,
          document.body,
        )}
    </nav>
  );
}
