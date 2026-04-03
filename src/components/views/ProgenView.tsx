import { useEffect, useRef } from "react";
import { useScanPsdStore } from "../../store/scanPsdStore";
import { useUnifiedViewerStore } from "../../store/unifiedViewerStore";
import { useViewStore } from "../../store/viewStore";

/**
 * ProGen統合ビュー
 * iframe state-preserving + localStorage ポーリングでコマンド送信
 */

function buildCommand(mode: string) {
  const scan = useScanPsdStore.getState();
  const viewer = useUnifiedViewerStore.getState();
  return {
    mode,
    ts: Date.now(),
    textContent: viewer.textContent || "",
    textFileName: (() => {
      const p = viewer.textFilePath;
      if (!p) return "";
      return p.split("\\").pop() || p.split("/").pop() || "text.txt";
    })(),
    jsonPath: scan.currentJsonFilePath || viewer.presetJsonPath || "",
    labelName: (() => {
      if (scan.workInfo.label) return scan.workInfo.label;
      const jp = scan.currentJsonFilePath || viewer.presetJsonPath || "";
      if (!jp) return "";
      const parts = jp.replace(/\//g, "\\").split("\\");
      return parts.length >= 2 ? parts[parts.length - 2] : "";
    })(),
  };
}

export function ProgenView() {
  const progenMode = useViewStore((s) => s.progenMode);
  const pendingCmd = useRef<string | null>(null);

  // モード指定 → localStorage書き込み
  useEffect(() => {
    if (!progenMode) return;
    useViewStore.getState().setProgenMode(null);
    const cmd = buildCommand(progenMode);
    const json = JSON.stringify(cmd);
    localStorage.setItem("cb_progen_cmd", json);
    pendingCmd.current = json; // onLoad用に保持
  }, [progenMode]);

  // iframe初回ロード完了時: ペンディングコマンドがあれば再書き込み（ポーリング開始前に書いた分を救済）
  const handleIframeLoad = () => {
    if (pendingCmd.current) {
      // tsを更新して再書き込み（ポーリングが確実に拾えるように）
      try {
        const cmd = JSON.parse(pendingCmd.current);
        cmd.ts = Date.now();
        localStorage.setItem("cb_progen_cmd", JSON.stringify(cmd));
      } catch { /* ignore */ }
      pendingCmd.current = null;
    }
  };

  return (
    <div className="flex h-full w-full overflow-hidden" style={{ position: "absolute", inset: 0 }}>
      <iframe
        src="/progen/index.html"
        className="w-full h-full border-0"
        title="ProGen"
        onLoad={handleIframeLoad}
      />
    </div>
  );
}
