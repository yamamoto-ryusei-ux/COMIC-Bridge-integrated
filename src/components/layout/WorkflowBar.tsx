import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as tauriDialogOpen } from "@tauri-apps/plugin-dialog";
import { useViewStore } from "../../store/viewStore";
import { useScanPsdStore } from "../../features/scan-psd/scanPsdStore";
import { useUnifiedViewerStore } from "../../store/unifiedViewerStore";
import { useProgenStore } from "../../features/progen/progenStore";
import { usePsdStore } from "../../store/psdStore";
import { useWorkflowStore, WORKFLOWS, type Workflow, type WorkflowStep } from "../../store/workflowStore";
import { useSpecStore } from "../../store";
import { globalLoadFolder, globalLoadFiles } from "../../lib/psdLoaderRegistry";

// ═══ ナビゲーション実行ヘルパー ═══

function executeStepNav(step: WorkflowStep) {
  if (!step.nav) return;
  const vs = useViewStore.getState();
  // WFステップ経由の場合、ツールメニューの toolMode をクリア
  useProgenStore.getState().setToolMode(null);
  if (step.progenMode) {
    // "_auto" の場合はフォルダセットアップのテキスト有無フラグから判定
    let resolvedMode = step.progenMode;
    if (resolvedMode === "_auto") {
      try {
        resolvedMode = localStorage.getItem("folderSetup_progenMode") || "extraction";
        localStorage.removeItem("progen_wfCheckMode");
      } catch { resolvedMode = "extraction"; }
    }
    // "_check" の場合はルール一覧画面に遷移 + 正誤チェックフラグをセット
    if (resolvedMode === "_check") {
      resolvedMode = "extraction";
      try {
        localStorage.setItem("progen_wfCheckMode", "simple");
        localStorage.removeItem("folderSetup_progenMode");
      } catch { /* ignore */ }
    }
    // "_check_variation" の場合は提案チェックフラグをセット
    if (resolvedMode === "_check_variation") {
      resolvedMode = "extraction";
      try {
        localStorage.setItem("progen_wfCheckMode", "variation");
        localStorage.removeItem("folderSetup_progenMode");
      } catch { /* ignore */ }
    }
    vs.setProgenMode(resolvedMode as any);
    // レーベル読み込み（ProGen起動時）
    const scan = useScanPsdStore.getState();
    const viewer = useUnifiedViewerStore.getState();
    let lbl = scan.workInfo.label || "";
    if (!lbl) {
      const jp = scan.currentJsonFilePath || viewer.presetJsonPath || "";
      if (jp) { const ps = jp.replace(/\//g, "\\").split("\\"); if (ps.length >= 2) lbl = ps[ps.length - 2]; }
    }
    if (lbl) useProgenStore.getState().loadMasterRule(lbl);
  }

  // テキストチェックステップ: コピー先の画像/PDFを統合ビューアーに読み込む
  // PDFが存在する場合はPDFファイルのみを読み込み（PSDなど他のファイルは無視）
  // PDFがなく画像データ(JPG/PNG等)が存在する場合はフォルダをそのまま読み込む
  if (step.label.includes("テキストチェック")) {
    (async () => {
      try {
        const copyDest = localStorage.getItem("folderSetup_copyDestFolder");
        if (!copyDest) return;

        // PDFを最優先で探す（PSDとPDFが同居しているケースでPSDが混ざらないように）
        const pdfs = await invoke<string[]>("list_files_by_extension_recursive", {
          folderPath: copyDest,
          extensions: ["pdf"],
        }).catch(() => [] as string[]);
        if (pdfs && pdfs.length > 0) {
          // PDFファイルのみを統合ビューアーに読み込む（PSDは含めない）
          vs.setKenbanPathA(pdfs[0]);
          await globalLoadFiles(pdfs);
          return;
        }

        // PDFがなければ画像(JPG/PNG等)を探す
        const imageExts = ["jpg", "jpeg", "png", "tif", "tiff", "bmp", "gif"];
        const images = await invoke<string[]>("list_files_by_extension_recursive", {
          folderPath: copyDest,
          extensions: imageExts,
        }).catch(() => [] as string[]);
        if (images && images.length > 0) {
          vs.setKenbanPathA(copyDest);
          await globalLoadFolder(copyDest);
          return;
        }

        // どちらもなければフォルダをそのまま読み込む
        vs.setKenbanPathA(copyDest);
        await globalLoadFolder(copyDest);
      } catch { /* ignore */ }
    })();
  }

  // ZIP リリースステップ: FolderSetupのコピー先の1つ上の階層をRequestPrepに自動セット
  if (step.label.includes("ZIP リリース")) {
    try {
      const copyDest = localStorage.getItem("folderSetup_copyDestFolder");
      if (copyDest) {
        const parent = copyDest.replace(/[\\/][^\\/]+$/, "");
        if (parent) localStorage.setItem("requestPrep_autoFolder", parent);
      }
    } catch { /* ignore */ }
  }

  // メイン画面（仕様チェック）に遷移する場合、PSDのみフィルタを自動適用
  if (step.nav === "specCheck") {
    usePsdStore.getState().setFileTypeFilter("psd");
    // フォルダセットアップで選択したカラーモードを仕様チェックに反映
    try {
      const specId = localStorage.getItem("folderSetup_specId");
      if (specId) {
        useSpecStore.getState().selectSpecAndCheck(specId);
      }
    } catch { /* ignore */ }
  }

  // 統合ビューアーのタブ位置を自動設定
  if (step.viewerTabSetup) {
    const uvs = useUnifiedViewerStore.getState();
    for (const [tabId, position] of Object.entries(step.viewerTabSetup)) {
      uvs.setTabPosition(tabId as any, position === null ? null : position as any);
    }
  }

  // RequestPrepView の初期モードをセット
  if (step.requestPrepMode) {
    try {
      localStorage.setItem("requestPrep_autoMode", step.requestPrepMode);
    } catch { /* ignore */ }
  }

  // 外部校正ZIPステップ: 作成したPDFを見開きPDFとして参照 + JSONからジャンル・レーベル取得
  if (step.requestPrepMode === "external") {
    try {
      // 直前のTachimi出力PDFを検索
      const copyDest = localStorage.getItem("folderSetup_copyDestFolder");
      if (copyDest) {
        const parent = copyDest.replace(/[\\/][^\\/]+$/, "");
        if (parent) localStorage.setItem("requestPrep_autoFolder", parent);
      }
      // Tachimi出力のPDFパスを設定（Desktop/Script_Output/PDF_Output内の最新PDF）
      const scan = useScanPsdStore.getState();
      const viewer = useUnifiedViewerStore.getState();
      const wi = scan.workInfo;
      if (wi.genre) localStorage.setItem("requestPrep_autoGenre", wi.genre);
      if (wi.label) localStorage.setItem("requestPrep_autoLabel", wi.label);
      if (wi.title) localStorage.setItem("requestPrep_autoTitle", wi.title);
      // presetJsonPathからもフォールバック
      if (!wi.genre && viewer.presetJsonPath) {
        const parts = viewer.presetJsonPath.replace(/\//g, "\\").split("\\");
        if (parts.length >= 2) {
          localStorage.setItem("requestPrep_autoLabel", parts[parts.length - 2]);
        }
      }
    } catch { /* ignore */ }
  }

  vs.setActiveView(step.nav as any);
}

// ═══ WorkflowBar（TopNav内の起動ボタン / フルバー） ═══

export function WorkflowBar() {
  const [showPicker, setShowPicker] = useState(false);
  const [showAbortConfirm, setShowAbortConfirm] = useState(false);
  const [showNextConfirm, setShowNextConfirm] = useState<{ title: string; message: string; type: "warning" | "success" | "save" | "complete" } | null>(null);
  const [showProofLoadOverlay, setShowProofLoadOverlay] = useState(false);
  const [showFontWarn, setShowFontWarn] = useState<{ missing: string[] } | null>(null);
  const [fontCheckedForStep, setFontCheckedForStep] = useState<number>(-1);
  const activeWorkflow = useWorkflowStore((s) => s.activeWorkflow);
  const currentStep = useWorkflowStore((s) => s.currentStep);

  const handleSelect = (wf: Workflow) => {
    useWorkflowStore.getState().startWorkflow(wf);
    setShowPicker(false);
    // 初校確認WF: 最初にデータ読み込みオーバーレイを表示
    if (wf.id === "proof") {
      setShowProofLoadOverlay(true);
      return;
    }
    if (wf.steps[0]?.nav) executeStepNav(wf.steps[0]);
  };

  // ワークフロー進行中: TopNavの行全体をWFバーで塗りつぶす
  if (activeWorkflow) {
    return (
      <div className="flex-1 flex items-center gap-2 min-w-0">
        {/* ワークフロー名 */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gradient-to-br from-accent to-accent-secondary shadow-sm flex-shrink-0">
          <span className="text-sm">{activeWorkflow.icon}</span>
          <span className="text-[11px] font-bold text-white">{activeWorkflow.name}</span>
        </div>

        {/* 戻るボタン */}
        <button
          onClick={() => {
            useWorkflowStore.getState().prevStep();
            const prevIdx = Math.max(currentStep - 1, 0);
            const step = activeWorkflow.steps[prevIdx];
            if (step?.nav) executeStepNav(step);
          }}
          disabled={currentStep === 0}
          className="flex items-center gap-0.5 px-2 py-1 rounded-md text-[11px] font-medium bg-bg-tertiary hover:bg-bg-elevated text-text-primary border border-border disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0 transition-colors"
          title="前のステップへ戻る"
        >
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          <span>戻る</span>
        </button>

        {/* 進める / 完了ボタン */}
        <button
          onClick={async () => {
            const currentStepDef = activeWorkflow.steps[currentStep];
            // 未インストールフォント検出（1ステップにつき1回のみ）
            if (fontCheckedForStep !== currentStep) {
              try {
                const psdFiles = usePsdStore.getState().files;
                const fontSet = new Set<string>();
                const collectFonts = (nodes: any[]) => {
                  for (const n of nodes) {
                    if (n.type === "text" && n.visible && n.textInfo?.fonts) {
                      for (const f of n.textInfo.fonts) fontSet.add(f);
                    }
                    if (n.children) collectFonts(n.children);
                  }
                };
                for (const f of psdFiles) {
                  if (f.metadata?.layerTree) collectFonts(f.metadata.layerTree);
                }
                if (fontSet.size > 0) {
                  const names = Array.from(fontSet);
                  const resolved = await invoke<Record<string, any>>("resolve_font_names", { postscriptNames: names }).catch(() => ({} as Record<string, any>));
                  const missing = names.filter((ps) => !(ps in resolved));
                  if (missing.length > 0) {
                    setFontCheckedForStep(currentStep);
                    setShowFontWarn({ missing });
                    return;
                  }
                }
                setFontCheckedForStep(currentStep);
              } catch { setFontCheckedForStep(currentStep); }
            }
            // 最終項目の場合
            if (currentStep >= activeWorkflow.steps.length - 1) {
              if (currentStepDef?.confirmOnNext === "wfComplete") {
                setShowNextConfirm({ title: "完了", message: "ワークフローを終了しますか？", type: "complete" });
                return;
              }
              useWorkflowStore.getState().abortWorkflow();
              return;
            }
            // confirmOnNext: 進む前にチェック確認
            if (currentStepDef?.confirmOnNext === "specCheck") {
              const specState = useSpecStore.getState();
              const files = usePsdStore.getState().files;
              let ngCount = 0;
              let cautionCount = 0;
              for (const f of files) {
                const result = specState.checkResults.get(f.id);
                if (result && !result.passed) ngCount++;
                else if (!result && f.metadata) cautionCount++;
              }
              if (ngCount > 0 || cautionCount > 0) {
                setShowNextConfirm({
                  title: "⚠ 仕様チェックに問題があります",
                  message: `NG: ${ngCount}件${cautionCount > 0 ? `、未チェック: ${cautionCount}件` : ""}。このまま次へ進みますか？`,
                  type: "warning",
                });
                return;
              }
              setShowNextConfirm({
                title: "✓ 仕様チェック完了",
                message: `全${files.length}ファイルが合格しています。次の工程へ進みます。`,
                type: "success",
              });
              return;
            }
            if (currentStepDef?.confirmOnNext === "textSave") {
              const viewer = useUnifiedViewerStore.getState();
              if (viewer.isDirty) {
                setShowNextConfirm({
                  title: "⚠ テキストが未保存です",
                  message: "編集中のテキストが保存されていません。保存してから進みますか？",
                  type: "save",
                });
                return;
              }
              setShowNextConfirm({
                title: "✓ テキスト確認完了",
                message: "テキストは保存済みです。次の工程へ進みます。",
                type: "success",
              });
              return;
            }
            if (currentStepDef?.confirmOnNext === "textDiffThenExtract") {
              // テキスト照合結果を確認
              // diffResultsはUnifiedViewer内のローカルstateなので、ストアからテキスト有無で簡易チェック
              const viewer = useUnifiedViewerStore.getState();
              const psdFiles = usePsdStore.getState().files;
              const hasText = viewer.textContent.length > 0;
              const hasPsdWithLayers = psdFiles.some((f) => f.metadata?.layerTree?.length);

              if (!hasText || !hasPsdWithLayers) {
                setShowNextConfirm({
                  title: "⚠ テキスト照合ができません",
                  message: !hasText ? "テキストが読み込まれていません。" : "PSDにテキストレイヤーがありません。",
                  type: "warning",
                });
                return;
              }
              // テキスト照合の不一致チェック: textPages vs PSD textLayersを簡易比較
              let hasDiff = false;
              for (const f of psdFiles) {
                if (!f.metadata?.layerTree) continue;
                const layers = f.metadata.layerTree;
                const collectText = (nodes: any[]): string[] => {
                  const texts: string[] = [];
                  for (const n of nodes) {
                    if (n.type === "text" && n.visible && n.textInfo?.text) texts.push(n.textInfo.text.trim());
                    if (n.children) texts.push(...collectText(n.children));
                  }
                  return texts;
                };
                const psdTexts = collectText(layers);
                if (psdTexts.length > 0) {
                  const fi = psdFiles.indexOf(f);
                  const page = viewer.textPages.find((p) => p.pageNumber === fi + 1);
                  if (!page) { hasDiff = true; break; }
                  const loadedTexts = page.blocks.filter((b) => !b.lines[0]?.startsWith("//")).map((b) => b.lines.join("\n").trim());
                  // 簡易比較: ブロック数が違えばdiff
                  if (psdTexts.length !== loadedTexts.length) { hasDiff = true; break; }
                }
              }
              if (hasDiff) {
                setShowNextConfirm({
                  title: "⚠ テキスト照合に不一致があります",
                  message: "PSDテキストとテキストデータに差異があります。確認してから進んでください。",
                  type: "warning",
                });
                return;
              }
              // 不一致なし → テキスト抽出 + 提案チェックまで自動進行
              setShowNextConfirm({
                title: "✓ テキスト照合一致",
                message: "テキスト抽出を実行し、提案チェックプロンプトまで自動で進みます。",
                type: "success",
              });
              return;
            }
            if (currentStepDef?.confirmOnNext === "wfComplete") {
              setShowNextConfirm({
                title: "完了",
                message: "ワークフローを終了しますか？",
                type: "complete",
              });
              return;
            }
            useWorkflowStore.getState().nextStep();
            const nextIdx = currentStep + 1;
            const step = activeWorkflow.steps[nextIdx];
            if (step?.nav) executeStepNav(step);
          }}
          className={`flex items-center gap-0.5 px-2 py-1 rounded-md text-[11px] font-medium text-white shadow-sm flex-shrink-0 transition-colors ${
            currentStep >= activeWorkflow.steps.length - 1
              ? "bg-success hover:bg-success/90"
              : "bg-accent hover:bg-accent-hover"
          }`}
          title={currentStep >= activeWorkflow.steps.length - 1 ? "ワークフローを完了する" : "次のステップへ進む"}
        >
          {currentStep >= activeWorkflow.steps.length - 1 ? (
            <>
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span>完了</span>
            </>
          ) : (
            <>
              <span>進める</span>
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </>
          )}
        </button>

        {/* 中断ボタン */}
        <button
          onClick={() => setShowAbortConfirm(true)}
          className="flex items-center gap-0.5 px-2 py-1 rounded-md text-[11px] font-medium bg-error/10 hover:bg-error/20 text-error border border-error/30 flex-shrink-0 transition-colors"
          title="ワークフローを中断"
        >
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <rect x="6" y="6" width="12" height="12" rx="1" />
          </svg>
          <span>中断</span>
        </button>

        {/* 中断確認ダイアログ */}
        {showAbortConfirm && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40" onClick={() => setShowAbortConfirm(false)}>
            <div className="bg-bg-secondary border border-border rounded-2xl p-5 shadow-xl w-[280px] space-y-3" onClick={(e) => e.stopPropagation()}>
              <p className="text-xs text-text-primary font-medium text-center">中止しますか？</p>
              <div className="flex gap-2">
                <button onClick={() => setShowAbortConfirm(false)} className="flex-1 px-3 py-2 text-xs font-medium text-text-secondary bg-bg-tertiary rounded-lg hover:bg-bg-elevated transition-colors">キャンセル</button>
                <button onClick={() => { setShowAbortConfirm(false); useWorkflowStore.getState().abortWorkflow(); }} className="flex-1 px-3 py-2 text-xs font-medium text-white bg-error rounded-lg hover:bg-error/90 transition-colors">中止する</button>
              </div>
            </div>
          </div>
        )}

        {/* 次へ進む確認ダイアログ */}
        {showNextConfirm && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40" onClick={() => setShowNextConfirm(null)}>
            <div className="bg-bg-secondary border border-border rounded-2xl p-5 shadow-xl w-[340px] space-y-3" onClick={(e) => e.stopPropagation()}>
              <p className={`text-sm font-medium text-center ${
                showNextConfirm.type === "warning" || showNextConfirm.type === "save" ? "text-warning"
                : showNextConfirm.type === "complete" ? "text-text-primary"
                : "text-success"
              }`}>
                {showNextConfirm.title}
              </p>
              <p className="text-xs text-text-secondary text-center">{showNextConfirm.message}</p>
              <div className="flex gap-2">
                {showNextConfirm.type === "save" ? (
                  <>
                    <button onClick={() => setShowNextConfirm(null)} className="flex-1 px-3 py-2 text-xs font-medium text-text-secondary bg-bg-tertiary rounded-lg hover:bg-bg-elevated transition-colors">戻る</button>
                    <button
                      onClick={async () => {
                        // テキスト保存してから進む
                        const viewer = useUnifiedViewerStore.getState();
                        if (viewer.textFilePath && viewer.textPages.length > 0) {
                          const { serializeText } = await import("../../components/unified-viewer/utils");
                          const content = serializeText(viewer.textHeader, viewer.textPages, viewer.fontPresets);
                          await invoke("write_text_file", { filePath: viewer.textFilePath, content });
                          viewer.setTextContent(content);
                          viewer.setIsDirty(false);
                        }
                        setShowNextConfirm(null);
                        useWorkflowStore.getState().nextStep();
                        const nextIdx = currentStep + 1;
                        const step = activeWorkflow.steps[nextIdx];
                        if (step?.nav) executeStepNav(step);
                      }}
                      className="flex-1 px-3 py-2 text-xs font-medium text-white bg-accent rounded-lg hover:bg-accent/90 transition-colors"
                    >保存して進む</button>
                  </>
                ) : showNextConfirm.type === "complete" ? (
                  <>
                    <button onClick={() => setShowNextConfirm(null)} className="flex-1 px-3 py-2 text-xs font-medium text-text-secondary bg-bg-tertiary rounded-lg hover:bg-bg-elevated transition-colors">いいえ</button>
                    <button
                      onClick={async () => {
                        setShowNextConfirm(null);
                        // Notionページが設定されていればデフォルトブラウザで開く
                        const raw = useScanPsdStore.getState().workInfo.notionPage?.trim() || "";
                        if (raw) {
                          try {
                            await invoke("open_url_in_browser", { url: raw });
                          } catch (e) {
                            console.error("Failed to open Notion URL:", e);
                            alert(`Notionページをブラウザで開けませんでした:\n${raw}\n\n${e}`);
                          }
                        }
                        useWorkflowStore.getState().abortWorkflow();
                      }}
                      className="flex-1 px-3 py-2 text-xs font-medium text-white bg-success rounded-lg hover:bg-success/90 transition-colors"
                    >はい</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => setShowNextConfirm(null)} className="flex-1 px-3 py-2 text-xs font-medium text-text-secondary bg-bg-tertiary rounded-lg hover:bg-bg-elevated transition-colors">
                      {showNextConfirm.type === "warning" ? "修正に戻る" : "戻る"}
                    </button>
                    <button
                      onClick={async () => {
                        const currentDef = activeWorkflow.steps[currentStep];
                        setShowNextConfirm(null);
                        if (currentDef?.confirmOnNext === "textDiffThenExtract") {
                          // テキスト抽出を自動実行 → 提案チェックまでスキップ
                          try {
                            // テキスト抽出をインラインで実行
                            const psdFiles = usePsdStore.getState().files.filter((f) => f.metadata?.layerTree?.length);
                            if (psdFiles.length > 0) {
                              const { desktopDir } = await import("@tauri-apps/api/path");
                              const desktop = await desktopDir();
                              const outputDir = `${desktop}\\Script_Output\\テキスト抽出`;
                              await invoke("create_directory", { path: outputDir }).catch(() => {});
                              // 簡易テキスト抽出
                              const lines: string[] = ["[COMIC-POT:bottomToTop]", "[01巻]"];
                              for (let i = 0; i < psdFiles.length; i++) {
                                lines.push(`<<${i + 1}Page>>`);
                                const collect = (nodes: any[]): string[] => {
                                  const r: string[] = [];
                                  for (const n of [...nodes].reverse()) {
                                    if (n.type === "text" && n.visible && n.textInfo?.text) {
                                      const t = n.textInfo.text.trim();
                                      if (t && !/^.+（.+）$/.test(n.name)) { r.push(t); r.push(""); }
                                    }
                                    if (n.children) r.push(...collect(n.children));
                                  }
                                  return r;
                                };
                                if (psdFiles[i].metadata?.layerTree) lines.push(...collect(psdFiles[i].metadata!.layerTree));
                                else lines.push("");
                              }
                              const output = lines.join("\n");
                              const folderName = psdFiles[0].filePath.replace(/\//g, "\\").split("\\").slice(-2, -1)[0] || "extracted";
                              const filePath = `${outputDir}\\${folderName}.txt`;
                              await invoke("write_text_file", { filePath, content: output });
                              const viewer = useUnifiedViewerStore.getState();
                              viewer.setTextContent(output);
                              viewer.setTextFilePath(filePath);
                              viewer.setIsDirty(false);
                              // COMIC-POTパース → textPages設定
                              const tLines = output.split(/\r?\n/);
                              const header: string[] = [];
                              const pages: { pageNumber: number; blocks: { id: string; originalIndex: number; lines: string[] }[] }[] = [];
                              let curPage: typeof pages[0] | null = null;
                              let bLines: string[] = [];
                              let bIdx = 0;
                              const flush = () => { if (bLines.length > 0 && curPage) { curPage.blocks.push({ id: `p${curPage.pageNumber}-b${bIdx}`, originalIndex: bIdx, lines: [...bLines] }); bIdx++; bLines = []; } };
                              for (const ln of tLines) {
                                const m = ln.match(/^<<(\d+)Page>>$/);
                                if (m) { flush(); bIdx = 0; bLines = []; curPage = { pageNumber: parseInt(m[1], 10), blocks: [] }; pages.push(curPage); }
                                else if (curPage) { if (ln.trim() === "") flush(); else bLines.push(ln); }
                                else header.push(ln);
                              }
                              flush();
                              viewer.setTextHeader(header);
                              viewer.setTextPages(pages);
                            }
                          } catch (e) { console.error("Auto extract error:", e); }
                          // テキスト抽出(step+1)をスキップ → 提案チェックプロンプト作成(step+2)に移動
                          const targetIdx = currentStep + 2;
                          if (targetIdx < activeWorkflow.steps.length) {
                            useWorkflowStore.setState({ currentStep: targetIdx });
                            const step = activeWorkflow.steps[targetIdx];
                            if (step?.nav) executeStepNav(step);
                          }
                        } else {
                          useWorkflowStore.getState().nextStep();
                          const nextIdx = currentStep + 1;
                          const step = activeWorkflow.steps[nextIdx];
                          if (step?.nav) executeStepNav(step);
                        }
                      }}
                      className={`flex-1 px-3 py-2 text-xs font-medium text-white rounded-lg transition-colors ${
                        showNextConfirm.type === "warning" ? "bg-warning hover:bg-warning/90" : "bg-accent hover:bg-accent/90"
                      }`}
                    >{showNextConfirm.type === "warning" ? "このまま進む" : "次へ進む"}</button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 未インストールフォント警告ダイアログ */}
        {showFontWarn && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40" onClick={() => setShowFontWarn(null)}>
            <div className="bg-bg-secondary border border-border rounded-2xl p-5 shadow-xl w-[420px] space-y-3" onClick={(e) => e.stopPropagation()}>
              <p className="text-sm font-medium text-center text-warning">⚠ 未インストールのフォントがあります</p>
              <p className="text-xs text-text-secondary text-center">以下のフォントがシステムに見つかりません。このまま進めますか？</p>
              <div className="max-h-40 overflow-y-auto bg-bg-tertiary rounded-lg p-2 border border-border/50">
                <ul className="text-[10px] text-text-primary space-y-0.5">
                  {showFontWarn.missing.map((f) => <li key={f} className="truncate">• {f}</li>)}
                </ul>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShowFontWarn(null)} className="flex-1 px-3 py-2 text-xs font-medium text-text-secondary bg-bg-tertiary rounded-lg hover:bg-bg-elevated transition-colors">戻る</button>
                <button
                  onClick={() => { setShowFontWarn(null); }}
                  className="flex-1 px-3 py-2 text-xs font-medium text-white bg-warning rounded-lg hover:bg-warning/90 transition-colors"
                >このまま進む</button>
              </div>
            </div>
          </div>
        )}

        {/* 初校データ読み込みオーバーレイ */}
        {showProofLoadOverlay && <ProofLoadOverlay onClose={() => {
          setShowProofLoadOverlay(false);
          // キャンセル時はWFも中止
          useWorkflowStore.getState().abortWorkflow();
        }} onProceed={() => {
          setShowProofLoadOverlay(false);
          // 最初のステップへナビゲーション
          const step = activeWorkflow.steps[0];
          if (step?.nav) executeStepNav(step);
        }} />}

        {/* 区切り線 */}
        <div className="w-px h-6 bg-border/50 flex-shrink-0" />

        {/* 全工程を横並び（自由にクリック可能）— スクロール対応 */}
        <div className="flex-1 flex items-center gap-1 overflow-x-auto min-w-0 scrollbar-thin">
          {activeWorkflow.steps.map((s, i) => {
            const isActive = i === currentStep;
            const isCompleted = i < currentStep;
            return (
              <button
                key={i}
                onClick={() => {
                  useWorkflowStore.getState().jumpToStep(i);
                  if (s.nav) executeStepNav(s);
                }}
                className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-all flex-shrink-0 ${
                  isActive
                    ? "bg-accent text-white shadow-sm ring-2 ring-accent/40"
                    : isCompleted
                      ? "bg-success/15 text-success hover:bg-success/25"
                      : "bg-bg-tertiary text-text-secondary hover:bg-bg-elevated hover:text-text-primary border border-border"
                }`}
                title={s.desc ? `${s.label} — ${s.desc}` : s.label}
              >
                <span className="text-[9px] tabular-nums opacity-70">{i + 1}</span>
                <span className="whitespace-nowrap">{s.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ワークフロー非アクティブ時: 小さなボタンのみ
  return (
    <div className="relative">
      <button
        onClick={() => setShowPicker(!showPicker)}
        className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all flex-shrink-0 ${
          showPicker
            ? "bg-gradient-to-br from-accent to-accent-secondary shadow-md scale-105"
            : "bg-gradient-to-br from-accent to-accent-secondary shadow-sm hover:shadow-md hover:scale-105"
        }`}
        title="ワークフロー"
      >
        <span className="text-[10px] font-bold text-white">WF</span>
      </button>

      {/* ワークフロー選択ドロップダウン */}
      {showPicker && (
        <div className="absolute left-0 top-full mt-1 z-50 bg-bg-secondary border border-border rounded-lg shadow-xl py-1 min-w-[200px]">
          {WORKFLOWS.map((wf) => (
            <button
              key={wf.id}
              className="w-full text-left px-3 py-2 text-[11px] text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors flex items-center gap-2"
              onClick={() => handleSelect(wf)}
            >
              <span className="text-sm">{wf.icon}</span>
              <span>{wf.name}</span>
              <span className="text-[9px] text-text-muted ml-auto">{wf.steps.length}工程</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══ WorkflowDescriptionBar（GlobalAddressBar 置換用） ═══

export function WorkflowDescriptionBar() {
  const activeWorkflow = useWorkflowStore((s) => s.activeWorkflow);
  const currentStep = useWorkflowStore((s) => s.currentStep);

  if (!activeWorkflow) return null;

  const step = activeWorkflow.steps[currentStep];
  const total = activeWorkflow.steps.length;
  const progress = ((currentStep + 1) / total) * 100;

  return (
    <div className="h-9 flex-shrink-0 bg-bg-secondary border-b border-accent/20 flex items-center px-3 gap-3 relative z-10">
      {/* ステップ番号 */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <span className="text-[10px] text-text-muted tabular-nums">
          <span className="text-[13px] font-bold text-accent">{currentStep + 1}</span>
          <span className="mx-0.5 opacity-50">/</span>
          <span>{total}</span>
        </span>
      </div>

      {/* 区切り線 */}
      <div className="w-px h-4 bg-border/50 flex-shrink-0" />

      {/* 現在のステップ名 */}
      <span className="text-xs font-semibold text-text-primary flex-shrink-0">{step.label}</span>

      {/* 区切り線 */}
      {step.desc && <div className="w-px h-4 bg-border/50 flex-shrink-0" />}

      {/* 説明 */}
      {step.desc && (
        <span className="text-[11px] text-text-secondary truncate flex-1 min-w-0">{step.desc}</span>
      )}

      {!step.desc && <div className="flex-1" />}

      {/* プログレスバー */}
      <div className="w-32 h-1.5 bg-border/40 rounded-full overflow-hidden flex-shrink-0">
        <div
          className="h-full bg-gradient-to-r from-accent to-accent-secondary rounded-full transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
      <span className="text-[10px] text-text-muted tabular-nums flex-shrink-0">{Math.round(progress)}%</span>
    </div>
  );
}

// 画像/PDFパスから1_入稿と同階層の2_写植パスを算出
function resolveShokuchiDir(imgPath: string): string {
  const parts = imgPath.replace(/\//g, "\\").split("\\");
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i] === "1_入稿") return parts.slice(0, i).join("\\") + "\\2_写植";
  }
  // 1_入稿が見つからない場合: フォルダなら親、ファイルなら2階層上
  const isFile = /\.\w+$/.test(parts[parts.length - 1]);
  const baseIdx = isFile ? parts.length - 2 : parts.length - 1;
  return parts.slice(0, baseIdx).join("\\") + "\\2_写植";
}

// ═══ 初校データ読み込みオーバーレイ ═══
function ProofLoadOverlay({ onClose, onProceed }: { onClose: () => void; onProceed: () => void }) {
  const [psdPath, setPsdPath] = useState("");
  const [pendingZipPath, setPendingZipPath] = useState("");
  const [imagePath, setImagePath] = useState("");
  const [textPath, setTextPath] = useState("");
  const presetJsonPath = useScanPsdStore.getState().currentJsonFilePath || useUnifiedViewerStore.getState().presetJsonPath || "";
  const checkJsonPath = useUnifiedViewerStore.getState().checkData?.filePath || "";
  const [selectedSpecId, setSelectedSpecId] = useState(() => { try { return localStorage.getItem("folderSetup_specId") || ""; } catch { return ""; } });

  const hasPsd = (!!psdPath && !psdPath.startsWith("(ZIP:")) || !!pendingZipPath;
  const hasImage = !!imagePath;
  const canProceed = (!!psdPath && !psdPath.startsWith("(ZIP:")) && !!selectedSpecId;

  const pickFolder = async (title: string): Promise<string> => {
    const p = await tauriDialogOpen({ directory: true, title });
    if (!p) return "";
    return Array.isArray(p) ? (p[0] || "") : String(p);
  };
  const pickFile = async (title: string, exts: string[]): Promise<string> => {
    const p = await tauriDialogOpen({ filters: [{ name: "ファイル", extensions: exts }], title, multiple: false });
    if (!p) return "";
    return Array.isArray(p) ? (p[0] || "") : String(p);
  };

  const handleProceed = async () => {
    if (!canProceed) return;
    const vs = useViewStore.getState();
    // PSD → A（検A）+ メイン画面に読み込み
    if (psdPath) {
      vs.setKenbanPathA(psdPath);
      try { await globalLoadFolder(psdPath); } catch {}
    }
    // 画像/PDF → B（検B）
    if (imagePath) vs.setKenbanPathB(imagePath);
    // テキスト → 統合ビューアーに読み込み
    if (textPath) {
      try {
        const content = await invoke<string>("read_text_file", { filePath: textPath });
        const viewer = useUnifiedViewerStore.getState();
        viewer.setTextContent(content);
        viewer.setTextFilePath(textPath);
      } catch {}
    }
    // 作品情報JSON
    if (presetJsonPath) {
      try {
        const content = await invoke<string>("read_text_file", { filePath: presetJsonPath });
        const data = JSON.parse(content);
        useScanPsdStore.getState().setCurrentJsonFilePath(presetJsonPath);
        if (data?.presetData?.workInfo || data?.workInfo) {
          const wi = data?.presetData?.workInfo || data?.workInfo;
          const scan = useScanPsdStore.getState();
          if (wi.genre) scan.setWorkInfo({ genre: wi.genre });
          if (wi.label) scan.setWorkInfo({ label: wi.label });
          if (wi.title) scan.setWorkInfo({ title: wi.title });
        }
        const presets: any[] = [];
        const obj = data?.presetData?.presets ?? data?.presets ?? data?.presetSets;
        if (obj && typeof obj === "object" && !Array.isArray(obj)) {
          for (const [, arr] of Object.entries(obj)) {
            if (Array.isArray(arr)) for (const p of arr as any[]) if (p?.font) presets.push({ font: p.font, name: p.name || "", subName: p.subName || "" });
          }
        }
        if (presets.length > 0) {
          useUnifiedViewerStore.getState().setFontPresets(presets);
          useUnifiedViewerStore.getState().setPresetJsonPath(presetJsonPath);
        }
        if (data?.proofRules) useProgenStore.getState().applyJsonRules(data.proofRules);
      } catch {}
    }
    // 校正JSON
    if (checkJsonPath) {
      try {
        const content = await invoke<string>("read_text_file", { filePath: checkJsonPath });
        const data = JSON.parse(content);
        const allItems: any[] = [];
        const parse = (src: any, kind: "correctness" | "proposal") => {
          const arr = Array.isArray(src) ? src : Array.isArray(src?.items) ? src.items : null;
          if (!arr) return;
          for (const item of arr) allItems.push({ picked: false, category: item.category || "", page: item.page || "", excerpt: item.excerpt || "", content: item.content || item.text || "", checkKind: item.checkKind || kind });
        };
        if (data.checks) { parse(data.checks.simple, "correctness"); parse(data.checks.variation, "proposal"); }
        if (allItems.length > 0) {
          useUnifiedViewerStore.getState().setCheckData({
            title: data.work || "", fileName: checkJsonPath.split(/[/\\]/).pop() || "", filePath: checkJsonPath,
            allItems, correctnessItems: allItems.filter((i) => i.checkKind === "correctness"), proposalItems: allItems.filter((i) => i.checkKind === "proposal"),
          });
        }
      } catch {}
    }
    // カラーモード
    if (selectedSpecId) {
      try { localStorage.setItem("folderSetup_specId", selectedSpecId); } catch {}
      useSpecStore.getState().selectSpecAndCheck(selectedSpecId);
    }
    onProceed();
  };

  const shortPath = (p: string) => p ? p.replace(/\//g, "\\").split("\\").slice(-2).join("\\") : "";

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40">
      <div className="bg-bg-secondary border border-border rounded-2xl shadow-2xl w-[480px] p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="text-[12px] font-bold text-text-primary">📋 初校データ 読み込み</div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary text-lg">✕</button>
        </div>

        {/* データ選択 */}
        <div className="space-y-2">
          {/* PSD */}
          <div className={`p-2.5 rounded-lg border ${hasPsd ? "bg-success/5 border-success/20" : "bg-bg-tertiary border-border/50"}`}>
            <div className="flex items-center gap-2">
              <span className={`text-base ${hasPsd ? "text-success" : "text-text-muted"}`}>{hasPsd ? "✓" : "○"}</span>
              <span className="text-[10px] font-medium text-text-primary flex-1">PSD</span>
              <button onClick={async () => { const p = await pickFolder("PSDフォルダ"); if (p) setPsdPath(p); }}
                className="px-2 py-0.5 text-[9px] rounded bg-bg-primary text-text-secondary hover:text-accent border border-border/50">フォルダ</button>
              <button onClick={async () => {
                const r = await tauriDialogOpen({
                  title: "PSDファイル / ZIPを選択",
                  multiple: false,
                  filters: [
                    { name: "PSD / ZIP", extensions: ["psd", "psb", "zip"] },
                    { name: "すべて", extensions: ["*"] },
                  ],
                });
                const p = !r ? "" : Array.isArray(r) ? (r[0] || "") : String(r);
                if (!p) return;
                console.log("Selected PSD/ZIP:", p);
                if (p.toLowerCase().endsWith(".zip")) {
                  if (imagePath) {
                    // 画像/PDFパスが設定済み → 即座に解凍
                    const destDir = resolveShokuchiDir(imagePath);
                    try {
                      await invoke("create_directory", { path: destDir });
                      await invoke("extract_zip", { zipPath: p, destDir });
                      const psdFiles = await invoke<string[]>("list_files_by_extension_recursive", { folderPath: destDir, extensions: ["psd", "psb"] });
                      if (psdFiles.length > 0) {
                        const firstPsd = psdFiles[0].replace(/\//g, "\\");
                        setPsdPath(firstPsd.substring(0, firstPsd.lastIndexOf("\\")));
                      } else {
                        setPsdPath(destDir);
                      }
                    } catch (e) { console.error("ZIP extract error:", e); }
                  } else {
                    // 画像/PDFがまだ未選択 → ZIPパスを保存、後で解凍
                    setPendingZipPath(p);
                    setPsdPath("(ZIP: " + p.replace(/\\/g, "/").split("/").pop() + " — 画像/PDF選択後に解凍)");
                  }
                } else {
                  setPsdPath(p);
                }
              }} className="px-2 py-0.5 text-[9px] rounded bg-bg-primary text-text-secondary hover:text-accent border border-border/50">ファイル/ZIP</button>
            </div>
            {hasPsd && <div className="text-[8px] text-text-muted truncate mt-1 ml-6">{pendingZipPath ? `ZIP: ${pendingZipPath.replace(/\\/g, "/").split("/").pop()} (画像/PDF選択後に解凍)` : shortPath(psdPath)}</div>}
          </div>
          {/* 画像/PDF */}
          <div className={`p-2.5 rounded-lg border ${hasImage ? "bg-success/5 border-success/20" : "bg-bg-tertiary border-border/50"}`}>
            <div className="flex items-center gap-2">
              <span className={`text-base ${hasImage ? "text-success" : "text-text-muted"}`}>{hasImage ? "✓" : "○"}</span>
              <span className="text-[10px] font-medium text-text-primary flex-1">画像/PDF <span className="text-text-muted">(任意)</span></span>
              <button onClick={async () => {
                const p = await pickFolder("画像/PDFフォルダ");
                if (!p) return;
                setImagePath(p);
                // 保留中のZIPがあれば解凍
                if (pendingZipPath) {
                  const destDir = resolveShokuchiDir(p);
                  try {
                    await invoke("create_directory", { path: destDir });
                    await invoke("extract_zip", { zipPath: pendingZipPath, destDir });
                    const psdFiles = await invoke<string[]>("list_files_by_extension_recursive", { folderPath: destDir, extensions: ["psd", "psb"] });
                    if (psdFiles.length > 0) { const fp = psdFiles[0].replace(/\//g, "\\"); setPsdPath(fp.substring(0, fp.lastIndexOf("\\"))); }
                    else setPsdPath(destDir);
                  } catch (e) { console.error("ZIP extract error:", e); }
                  setPendingZipPath("");
                }
              }} className="px-2 py-0.5 text-[9px] rounded bg-bg-primary text-text-secondary hover:text-accent border border-border/50">フォルダ</button>
              <button onClick={async () => {
                const p = await pickFile("画像/PDFファイル", ["jpg", "jpeg", "png", "tif", "tiff", "pdf", "bmp"]);
                if (!p) return;
                setImagePath(p);
                if (pendingZipPath) {
                  const destDir = resolveShokuchiDir(p);
                  try {
                    await invoke("create_directory", { path: destDir });
                    await invoke("extract_zip", { zipPath: pendingZipPath, destDir });
                    const psdFiles = await invoke<string[]>("list_files_by_extension_recursive", { folderPath: destDir, extensions: ["psd", "psb"] });
                    if (psdFiles.length > 0) { const fp = psdFiles[0].replace(/\//g, "\\"); setPsdPath(fp.substring(0, fp.lastIndexOf("\\"))); }
                    else setPsdPath(destDir);
                  } catch (e) { console.error("ZIP extract error:", e); }
                  setPendingZipPath("");
                }
              }} className="px-2 py-0.5 text-[9px] rounded bg-bg-primary text-text-secondary hover:text-accent border border-border/50">ファイル</button>
            </div>
            {hasImage && <div className="text-[8px] text-text-muted truncate mt-1 ml-6">{shortPath(imagePath)}</div>}
          </div>
          {/* テキスト */}
          <div className={`p-2.5 rounded-lg border ${textPath ? "bg-blue-500/5 border-blue-500/20" : "bg-bg-tertiary border-border/50"}`}>
            <div className="flex items-center gap-2">
              <span className={`text-base ${textPath ? "text-blue-500" : "text-text-muted"}`}>{textPath ? "✓" : "○"}</span>
              <span className="text-[10px] font-medium text-text-primary flex-1">テキスト</span>
              <button onClick={async () => { const p = await pickFile("テキストファイル", ["txt"]); if (p) setTextPath(p); }}
                className="px-2 py-0.5 text-[9px] rounded bg-bg-primary text-text-secondary hover:text-accent border border-border/50">ファイル</button>
            </div>
            {textPath && <div className="text-[8px] text-text-muted truncate mt-1 ml-6">{shortPath(textPath)}</div>}
          </div>
        </div>

        {/* 作品情報JSON + 校正JSON */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-text-muted flex-shrink-0 w-16">作品情報:</span>
            <span className="text-[9px] text-accent truncate flex-1">{presetJsonPath ? shortPath(presetJsonPath) : "未選択"}</span>
            <button onClick={() => useViewStore.getState().setJsonBrowserMode("preset")}
              className="px-2 py-0.5 text-[9px] rounded bg-bg-tertiary text-text-secondary hover:text-accent border border-border/50 flex-shrink-0">読み取り</button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-text-muted flex-shrink-0 w-16">校正JSON:</span>
            <span className="text-[9px] text-warning truncate flex-1">{checkJsonPath ? shortPath(checkJsonPath) : "未選択"}</span>
            <button onClick={() => useViewStore.getState().setJsonBrowserMode("check")}
              className="px-2 py-0.5 text-[9px] rounded bg-bg-tertiary text-text-secondary hover:text-accent border border-border/50 flex-shrink-0">読み取り</button>
          </div>
        </div>

        {/* カラーモード */}
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-text-muted">カラーモード<span className="text-error">*</span>:</span>
          {[{ id: "mono-spec", label: "モノクロ" }, { id: "color-spec", label: "カラー" }].map((spec) => (
            <button key={spec.id} onClick={() => setSelectedSpecId(spec.id)}
              className={`px-2.5 py-1 text-[10px] rounded border transition-colors ${selectedSpecId === spec.id ? "bg-accent/15 text-accent border-accent/30 font-medium" : "bg-bg-tertiary text-text-secondary border-border/50"}`}
            >{spec.label}</button>
          ))}
        </div>

        {/* 進むボタン */}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 text-xs font-medium text-text-secondary bg-bg-tertiary rounded-lg hover:bg-bg-elevated transition-colors">戻る</button>
          <button onClick={handleProceed} disabled={!canProceed}
            className="flex-1 py-2 text-xs font-medium text-white bg-accent rounded-lg hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            {!hasPsd ? "PSDを選択してください" : !selectedSpecId ? "カラーモードを選択" : "確認完了 → 次の工程へ"}
          </button>
        </div>
      </div>
    </div>
  );
}
