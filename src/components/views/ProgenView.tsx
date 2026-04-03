import { useRef, useCallback, useEffect } from "react";
import { useScanPsdStore } from "../../store/scanPsdStore";
import { useUnifiedViewerStore } from "../../store/unifiedViewerStore";
import { useViewStore } from "../../store/viewStore";

/**
 * 親windowに __COMIC_BRIDGE__ オブジェクトを公開する。
 * iframe (ProGen) は window.parent.__COMIC_BRIDGE__ で直接参照。
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
    getCheckJsonPath: () => {
      const v = useUnifiedViewerStore.getState();
      return v.checkData?.filePath || "";
    },
    // レーベル名: workInfoから直接取得（JSONパスより確実）
    getLabelName: () => {
      const s = useScanPsdStore.getState();
      if (s.workInfo.label) return s.workInfo.label;
      // JSONパスからフォルダ名を推定
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

/** iframe側の関数を安全に呼び出す */
function callIframe(iframeRef: React.RefObject<HTMLIFrameElement | null>, fn: string) {
  try {
    const win = iframeRef.current?.contentWindow;
    if (win && typeof (win as any)[fn] === "function") {
      (win as any)[fn]();
    }
  } catch {
    // iframe未準備 or cross-origin: 無視
  }
}

export function ProgenView() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const iframeReady = useRef(false);

  const progenMode = useViewStore((s) => s.progenMode);
  const textContent = useUnifiedViewerStore((s) => s.textContent);

  // ブリッジを常に最新に保つ
  useEffect(() => {
    publishBridge();
  });

  // モード指定が来たらiframeに通知
  useEffect(() => {
    if (!progenMode) return;
    publishBridge();
    if (iframeReady.current) {
      callIframe(iframeRef, "__comicBridgeOnModeReady");
    }
  }, [progenMode]);

  // テキスト変更時にiframe側に通知
  useEffect(() => {
    if (!iframeReady.current) return;
    publishBridge();
    callIframe(iframeRef, "__comicBridgeOnTextChange");
  }, [textContent]);

  const handleIframeLoad = useCallback(() => {
    iframeReady.current = true;
    publishBridge();
    // iframeの初期化完了後にペンディングモードがあれば通知
    // progen-main.js 側でも呼ぶが、こちらからも念のため
    setTimeout(() => callIframe(iframeRef, "__comicBridgeOnModeReady"), 300);
  }, []);

  return (
    <div className="flex h-full w-full overflow-hidden" style={{ position: "absolute", inset: 0 }}>
      <iframe
        ref={iframeRef}
        src="/progen/index.html"
        className="w-full h-full border-0"
        title="ProGen"
        sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
        onLoad={handleIframeLoad}
      />
    </div>
  );
}
