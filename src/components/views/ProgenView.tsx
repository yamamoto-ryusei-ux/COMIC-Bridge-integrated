import { useRef, useEffect, useState } from "react";
import { useScanPsdStore } from "../../store/scanPsdStore";
import { useUnifiedViewerStore } from "../../store/unifiedViewerStore";
import { useViewStore } from "../../store/viewStore";

/**
 * ProGen統合ビュー
 *
 * モード遷移: URLハッシュ + ランディング画面CSSで強制非表示
 * テキスト連携: Tauri invoke経由で一時ファイルに書き出し → ProGen側で読み込み
 * ブリッジ: window.__COMIC_BRIDGE__ を公開（親windowアクセスが可能な場合のみ動作）
 */

function publishBridge() {
  (window as any).__COMIC_BRIDGE__ = {
    pendingMode: useViewStore.getState().progenMode,
    consumeMode: () => {
      const mode = useViewStore.getState().progenMode;
      useViewStore.getState().setProgenMode(null);
      return mode;
    },
    getTextContent: () => useUnifiedViewerStore.getState().textContent || "",
    getTextFilePath: () => useUnifiedViewerStore.getState().textFilePath || "",
    getTextFileName: () => {
      const p = useUnifiedViewerStore.getState().textFilePath;
      if (!p) return "";
      return p.split("\\").pop() || p.split("/").pop() || "text.txt";
    },
    getJsonPath: () => {
      const s = useScanPsdStore.getState();
      const v = useUnifiedViewerStore.getState();
      return s.currentJsonFilePath || v.presetJsonPath || "";
    },
    getCheckJsonPath: () => useUnifiedViewerStore.getState().checkData?.filePath || "",
    getLabelName: () => {
      const s = useScanPsdStore.getState();
      if (s.workInfo.label) return s.workInfo.label;
      const jp = s.currentJsonFilePath || useUnifiedViewerStore.getState().presetJsonPath || "";
      if (!jp) return "";
      const parts = jp.replace(/\//g, "\\").split("\\");
      return parts.length >= 2 ? parts[parts.length - 2] : "";
    },
    hasWorkJson: () => {
      const s = useScanPsdStore.getState();
      const v = useUnifiedViewerStore.getState();
      return !!(s.currentJsonFilePath || (v.fontPresets.length > 0 && v.presetJsonPath));
    },
    getWorkInfo: () => {
      const s = useScanPsdStore.getState();
      return {
        genre: s.workInfo.genre || "",
        label: s.workInfo.label || "",
        title: s.workInfo.title || "",
        author: s.workInfo.author || "",
        volume: s.workInfo.volume || 0,
      };
    },
  };
}

export function ProgenView() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const progenMode = useViewStore((s) => s.progenMode);
  const textContent = useUnifiedViewerStore((s) => s.textContent);

  // iframeのURLにモードをハッシュで渡す（リロードでモード切替）
  // ハッシュ変更 = iframe再読み込み → progen-main.js がハッシュを読んで自動遷移
  const [iframeSrc, setIframeSrc] = useState("/progen/index.html");

  useEffect(() => {
    publishBridge();
  });

  // モード指定が来たら iframe src を変更して強制リロード
  useEffect(() => {
    if (!progenMode) return;
    publishBridge();
    const ts = Date.now(); // キャッシュバスター
    setIframeSrc(`/progen/index.html?mode=${progenMode}&t=${ts}`);
    useViewStore.getState().setProgenMode(null);
  }, [progenMode]);

  // テキスト変更時: ブリッジ更新のみ（iframe側がpullする）
  useEffect(() => {
    publishBridge();
  }, [textContent]);

  return (
    <div className="flex h-full w-full overflow-hidden" style={{ position: "absolute", inset: 0 }}>
      <iframe
        ref={iframeRef}
        src={iframeSrc}
        className="w-full h-full border-0"
        title="ProGen"
        onLoad={() => publishBridge()}
      />
    </div>
  );
}
