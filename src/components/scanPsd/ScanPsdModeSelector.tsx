import { useScanPsdStore } from "../../store/scanPsdStore";
import type { ScanPsdMode } from "../../types/scanPsd";

const MODES: { id: ScanPsdMode; label: string; desc: string; icon: React.ReactNode }[] = [
  {
    id: "new",
    label: "新規作成",
    desc: "PSDフォルダをスキャンしてフォントプリセットを新規作成",
    icon: (
      <svg
        className="w-10 h-10"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
      </svg>
    ),
  },
  {
    id: "edit",
    label: "JSON編集",
    desc: "既存のプリセットJSONファイルを読み込んで編集",
    icon: (
      <svg
        className="w-10 h-10"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"
        />
      </svg>
    ),
  },
];

export function ScanPsdModeSelector() {
  const setMode = useScanPsdStore((s) => s.setMode);

  return (
    <div className="h-full flex items-center justify-center bg-bg-primary">
      <div className="text-center space-y-8">
        {/* Header */}
        <div className="space-y-2">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-accent to-accent-secondary flex items-center justify-center shadow-lg">
            <svg
              className="w-8 h-8 text-white"
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
          </div>
          <h2 className="text-xl font-bold text-text-primary">PSDスキャナー</h2>
        </div>

        {/* Mode Cards */}
        <div className="flex gap-4">
          {MODES.map((mode) => (
            <button
              key={mode.id}
              onClick={() => setMode(mode.id)}
              className="group w-80 bg-bg-secondary border border-border rounded-2xl p-8 text-left
                hover:border-accent/50 hover:shadow-md transition-all duration-200 hover:-translate-y-0.5"
            >
              <div
                className="w-20 h-20 rounded-xl bg-bg-tertiary flex items-center justify-center text-text-muted
                group-hover:text-accent group-hover:bg-accent/10 transition-colors mb-5"
              >
                {mode.icon}
              </div>
              <h3 className="text-base font-bold text-text-primary mb-1.5">{mode.label}</h3>
              <p className="text-xs text-text-muted leading-relaxed">{mode.desc}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
