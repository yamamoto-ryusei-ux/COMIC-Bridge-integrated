import { useState, useEffect, useCallback, useRef } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

interface UpdateInfo {
  version: string;
  body: string;
  /** tauri-plugin-updater の Update オブジェクト */
  raw: Awaited<ReturnType<typeof check>>;
}

type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "error"
  | "up-to-date";

export function useAppUpdater() {
  const [phase, setPhase] = useState<UpdatePhase>("idle");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string>("");
  const [showPrompt, setShowPrompt] = useState(false);
  const startupChecked = useRef(false);

  // 現在のバージョンを取得
  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => {});
  }, []);

  // 起動時自動チェック（2秒遅延）
  useEffect(() => {
    if (startupChecked.current) return;
    startupChecked.current = true;
    const timer = setTimeout(() => {
      checkForUpdate(true);
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  const checkForUpdate = useCallback(async (silent = false) => {
    if (!silent) setPhase("checking");
    setError(null);

    try {
      const update = await check();

      if (update) {
        setUpdateInfo({
          version: update.version,
          body: update.body || "",
          raw: update,
        });
        setPhase("available");
        if (silent) setShowPrompt(true);
      } else {
        setPhase(silent ? "idle" : "up-to-date");
        if (!silent) {
          setTimeout(() => setPhase("idle"), 3000);
        }
      }
    } catch (e: any) {
      if (!silent) {
        setError(e?.message || String(e));
        setPhase("error");
      }
    }
  }, []);

  const downloadAndInstall = useCallback(async () => {
    if (!updateInfo?.raw) return;

    setPhase("downloading");
    try {
      await updateInfo.raw.downloadAndInstall();
      setPhase("ready");

      // 1.5秒後に再起動
      setTimeout(async () => {
        await relaunch();
      }, 1500);
    } catch (e: any) {
      setError(e?.message || String(e));
      setPhase("error");
    }
  }, [updateInfo]);

  const dismiss = useCallback(() => {
    setPhase("idle");
    setError(null);
  }, []);

  const dismissPrompt = useCallback(() => {
    setShowPrompt(false);
  }, []);

  return {
    phase,
    updateInfo,
    error,
    appVersion,
    showPrompt,
    checkForUpdate,
    downloadAndInstall,
    dismiss,
    dismissPrompt,
  };
}
