import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { AppLayout } from "./components/layout/AppLayout";
import { useViewStore } from "./store/viewStore";
import { useTypesettingCheckStore } from "./store/typesettingCheckStore";
import type { ProofreadingCheckItem } from "./types/typesettingCheck";

function App() {
  // ProGenからのCLI引数経由で校正データJSONを自動ロード
  useEffect(() => {
    const unlistenPromise = listen<string>("open-proofreading-json", async (event) => {
      const filePath = event.payload;
      try {
        const content = await invoke<string>("read_text_file", { filePath });
        const raw = JSON.parse(content);

        const allItems: ProofreadingCheckItem[] = [];
        if (raw.checks?.variation?.items) allItems.push(...raw.checks.variation.items);
        if (raw.checks?.simple?.items) allItems.push(...raw.checks.simple.items);

        const correctnessItems = allItems.filter((i) => i.checkKind === "correctness");
        const proposalItems = allItems.filter((i) => i.checkKind === "proposal");

        const fileName = filePath.replace(/\\/g, "/").split("/").pop()?.replace(".json", "") || "";
        const title = raw.work ? `${raw.work} ${fileName}` : fileName;

        const store = useTypesettingCheckStore.getState();
        store.setCheckData({
          title,
          fileName,
          filePath,
          allItems,
          correctnessItems,
          proposalItems,
        });

        if (correctnessItems.length > 0 && proposalItems.length > 0) {
          store.setCheckTabMode("both");
        } else if (correctnessItems.length > 0) {
          store.setCheckTabMode("correctness");
        } else if (proposalItems.length > 0) {
          store.setCheckTabMode("proposal");
        }

        useViewStore.getState().setActiveView("typesetting");
      } catch (e) {
        console.error("Failed to load proofreading JSON from CLI:", e);
      }
    });

    return () => {
      unlistenPromise.then((fn) => fn());
    };
  }, []);

  return <AppLayout />;
}

export default App;
