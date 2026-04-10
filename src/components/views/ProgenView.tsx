import { useEffect } from "react";
import { useProgenStore } from "../../store/progenStore";
import { useViewStore } from "../../store/viewStore";
import { useScanPsdStore } from "../../store/scanPsdStore";
import { useUnifiedViewerStore } from "../../store/unifiedViewerStore";
import { readJsonFile } from "../../hooks/useProgenTauri";
import { ProgenRuleView } from "../progen/ProgenRuleView";
import { ProgenProofreadingView } from "../progen/ProgenProofreadingView";
import ComicPotEditor from "../progen/comicpot/ComicPotEditor";
import { ProgenResultViewer } from "../progen/ProgenResultViewer";
import { ProgenAdminView } from "../progen/ProgenAdminView";
import type { ProgenScreen } from "../../types/progen";

// ─── Landing Screen (inline) ─────────────────────────────────────

/** ランディングからスクリーン遷移時にラベルも読み込む */
function navigateToScreen(screen: ProgenScreen) {
  useProgenStore.getState().setScreen(screen);
  // ラベルが未読み込みなら読み込む
  const ps = useProgenStore.getState();
  if (ps.currentProofRules.length === 0) {
    const scan = useScanPsdStore.getState();
    const viewer = useUnifiedViewerStore.getState();
    let label = scan.workInfo.label || "";
    if (!label) {
      const jp = scan.currentJsonFilePath || viewer.presetJsonPath || "";
      if (jp) {
        const parts = jp.replace(/\//g, "\\").split("\\");
        if (parts.length >= 2) label = parts[parts.length - 2];
      }
    }
    if (label) ps.loadMasterRule(label);
  }
}

function LandingScreen() {
  const modeCards: {
    label: string;
    desc: string;
    screen: ProgenScreen;
  }[] = [
    {
      label: "抽出プロンプト",
      desc: "原稿テキストの抽出ルールを設定",
      screen: "extraction",
    },
    {
      label: "整形プロンプト",
      desc: "抽出テキストの整形ルールを設定",
      screen: "formatting",
    },
    {
      label: "校正プロンプト",
      desc: "テキスト校正のルールを設定",
      screen: "proofreading",
    },
  ];

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 bg-bg-primary">
      <h1 className="text-2xl font-bold text-text-primary">ProGen</h1>
      <p className="text-sm text-text-secondary">
        テキスト校正プロンプト生成ツール
      </p>

      {/* Mode cards */}
      <div className="flex gap-4">
        {modeCards.map((card) => (
          <button
            key={card.screen}
            className="w-60 p-6 rounded-xl border border-border bg-bg-secondary hover:border-accent/50 transition-all cursor-pointer text-left"
            onClick={() => navigateToScreen(card.screen)}
          >
            <div className="text-sm font-medium text-text-primary">
              {card.label}
            </div>
            <div className="text-[10px] text-text-muted mt-1">{card.desc}</div>
          </button>
        ))}
      </div>

      {/* Utility links */}
      <div className="flex gap-4 mt-2">
        <button
          className="text-[10px] text-text-muted hover:text-accent transition-colors"
          onClick={() => navigateToScreen("comicpot")}
        >
          COMIC-POT エディタ
        </button>
        <button
          className="text-[10px] text-text-muted hover:text-accent transition-colors"
          onClick={() => navigateToScreen("resultViewer")}
        >
          結果ビューア
        </button>
        <button
          className="text-[10px] text-text-muted hover:text-accent transition-colors"
          onClick={() => navigateToScreen("admin")}
        >
          管理画面
        </button>
      </div>
    </div>
  );
}

// ─── ProgenView (screen router) ──────────────────────────────────

export function ProgenView() {
  const screen = useProgenStore((s) => s.screen);
  const setScreen = useProgenStore((s) => s.setScreen);

  // Mode initialization from viewStore
  // 旧buildCommand互換: scanPsdStore + unifiedViewerStore からラベル・JSONを取得
  useEffect(() => {
    const progenMode = useViewStore.getState().progenMode;
    if (!progenMode) return;
    useViewStore.getState().setProgenMode(null);

    // Map mode to screen
    const screenMap: Record<string, ProgenScreen> = {
      extraction: "extraction",
      formatting: "formatting",
      proofreading: "proofreading",
    };
    const targetScreen = screenMap[progenMode] || "landing";
    useProgenStore.getState().setScreen(targetScreen);

    // ── ラベル取得（複数ソースからフォールバック）──
    const scan = useScanPsdStore.getState();
    const viewer = useUnifiedViewerStore.getState();
    let label = scan.workInfo.label || "";
    if (!label) {
      // JSONパスの親フォルダ名をラベルとして推定
      const jp = scan.currentJsonFilePath || viewer.presetJsonPath || "";
      if (jp) {
        const parts = jp.replace(/\//g, "\\").split("\\");
        if (parts.length >= 2) label = parts[parts.length - 2];
      }
    }

    // ── JSON読み込み + ルール適用 ──
    const jsonPath = scan.currentJsonFilePath || viewer.presetJsonPath || "";
    if (jsonPath) {
      // JSON がある場合: JSONからルールを読み込む
      readJsonFile(jsonPath).then((data) => {
        if (data) {
          useProgenStore.getState().setCurrentLoadedJson(data);
          useProgenStore.getState().setCurrentJsonPath(jsonPath);
          const proofRules = data?.proofRules || data?.presetData?.proofRules;
          if (proofRules) {
            useProgenStore.getState().applyJsonRules(proofRules.proof ? data : data.presetData || data);
          } else if (label) {
            // JSONにproofRulesがなければマスタールールから読み込み
            useProgenStore.getState().loadMasterRule(label);
          }
        }
      }).catch(() => {
        // JSON読み込み失敗 → マスタールールにフォールバック
        if (label) useProgenStore.getState().loadMasterRule(label);
      });
    } else if (label) {
      // JSON なし → マスタールールから読み込み
      useProgenStore.getState().loadMasterRule(label);
    }
  }, []);

  // Render current screen
  switch (screen) {
    case "extraction":
    case "formatting":
      return <ProgenRuleView />;
    case "proofreading":
      return <ProgenProofreadingView />;
    case "admin":
      return <ProgenAdminView onBack={() => setScreen("landing")} />;
    case "comicpot":
      return <ComicPotEditor onBack={() => setScreen("landing")} />;
    case "resultViewer":
      return (
        <ProgenResultViewer
          onBack={() => setScreen("landing")}
          onGoToProofreading={() => setScreen("proofreading")}
        />
      );
    default:
      return <LandingScreen />;
  }
}
