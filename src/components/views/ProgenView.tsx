import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { desktopDir } from "@tauri-apps/api/path";
import { useProgenStore } from "../../store/progenStore";
import { useViewStore } from "../../store/viewStore";
import { useScanPsdStore } from "../../store/scanPsdStore";
import { useUnifiedViewerStore } from "../../store/unifiedViewerStore";
import { readJsonFile, getMasterLabelList, showSaveTextDialog, writeTextFile, showSaveJsonDialog, writeJsonFile } from "../../hooks/useProgenTauri";
import { ProgenRuleView } from "../progen/ProgenRuleView";
// 注意: ProgenProofreadingView は意図的にインポートしていません（隔離済み）。
// 校正モードは extraction 画面 + popup の 正誤/提案 ボタンで処理します。
import ComicPotEditor from "../progen/comicpot/ComicPotEditor";
import { ProgenResultViewer } from "../progen/ProgenResultViewer";
import { ProgenAdminView } from "../progen/ProgenAdminView";
import type { ProgenScreen } from "../../types/progen";
import { GENRE_LABELS } from "../../types/scanPsd";

// ─── 結果保存モーダル ────────────────────────────────────────────

/** CSV/Markdownテーブル → 構造化チェックアイテム配列にパース */
function parseCheckText(text: string): { items: any[]; kind: "correctness" | "proposal" } {
  const allItems: any[] = [];
  let currentKind: "correctness" | "proposal" = "correctness";
  const lines = text.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // セパレータ行（---）をスキップ
    if (/^[\|\s\-:]+$/.test(trimmed)) continue;
    // CSV or Markdown テーブルを自動判定
    let cols: string[];
    if (trimmed.startsWith("|")) {
      cols = trimmed.split("|").map((c) => c.trim()).filter(Boolean);
    } else {
      // CSV（カンマ区切り）
      cols = trimmed.split(",").map((c) => c.trim());
    }
    if (cols.length < 3) continue;
    // ヘッダー行を検出
    const first = cols[0];
    if (first === "種別" || first === "チェック項目" || first === "ページ" || first.includes("該当箇所") || first.includes("セリフ")) {
      // ヘッダーの列名からcheckKindを判定
      if (first === "チェック項目" || cols.some((c) => c === "チェック項目")) currentKind = "proposal";
      else currentKind = "correctness";
      continue;
    }
    // 正誤: ページ,種別,セリフ,指摘  or  種別,ページ,セリフ,指摘
    // 提案: チェック項目,ページ,セリフ,指摘
    // ページ列の自動検出（数字やN巻/Nページを含む列）
    const pagePattern = /\d+\s*[巻ページpP]/;
    let page: string, category: string;
    if (pagePattern.test(cols[0])) {
      page = cols[0]; category = cols[1] || "";
    } else {
      category = cols[0]; page = cols[1] || "";
    }
    allItems.push({
      picked: false,
      category,
      page,
      excerpt: cols[2] || "",
      content: cols.length >= 4 ? cols[3] : "",
      checkKind: currentKind,
    });
  }
  // 重複除去（後方優先=最終統合リスト優先）
  const seen = new Set<string>();
  const unique: typeof allItems = [];
  for (let i = allItems.length - 1; i >= 0; i--) {
    const item = allItems[i];
    const key = `${item.category}|${item.page}|${item.excerpt}|${item.content}`;
    if (!seen.has(key)) { seen.add(key); unique.unshift(item); }
  }
  return { items: unique, kind: currentKind };
}

function ResultSaveModal() {
  const mode = useProgenStore((s) => s.resultSaveMode);
  const close = useProgenStore((s) => s.setResultSaveMode);
  const [pasteText, setPasteText] = useState("");
  const [volume, setVolume] = useState("1");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  if (!mode) return null;

  const isText = mode === "text";
  const title = isText ? "Gemini結果をテキスト保存" : "Gemini結果をJSON保存";
  const placeholder = isText
    ? "Geminiの出力テキストを貼り付けてください..."
    : "GeminiのCSV/テーブル出力を貼り付けてください...";

  const handleSave = async () => {
    if (!pasteText.trim()) return;
    setSaving(true);
    try {
      if (isText) {
        // テキスト保存 → Desktop/Script_Output/テキスト抽出/ に自動保存
        const scan = useScanPsdStore.getState();
        const title = scan.workInfo.title || "gemini_output";
        const safeTitle = title.replace(/[\\/:*?"<>|]/g, "_");
        const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
        let filePath: string | null = null;
        try {
          // desktopDir() は末尾スラッシュなしで返すため正規化
          const desktop = (await desktopDir()).replace(/[\\/]$/, "") + "\\";
          const outputDir = `${desktop}Script_Output\\テキスト抽出`;
          await invoke("create_directory", { path: outputDir });
          filePath = `${outputDir}\\${safeTitle}_${timestamp}.txt`;
          await writeTextFile(filePath, pasteText);
        } catch {
          filePath = await showSaveTextDialog(`${safeTitle}_${timestamp}.txt`);
          if (filePath) await writeTextFile(filePath, pasteText);
        }
        if (filePath) {
          const viewer = useUnifiedViewerStore.getState();
          viewer.setTextContent(pasteText);
          viewer.setTextFilePath(filePath);
          setSaved(true);
        }
      } else {
        // JSON保存（校正チェックデータ）— CSV/テーブルを構造化JSONに変換
        let jsonData: any;
        let parsedItems: any[] = [];
        try {
          jsonData = JSON.parse(pasteText);
          // 既にJSONの場合はそのまま使用
        } catch {
          // CSV/Markdownテーブルをパースして構造化JSONに変換
          const { items } = parseCheckText(pasteText);
          parsedItems = items;
          jsonData = {
            checks: {
              simple: { items: items.filter((i: any) => i.checkKind === "correctness") },
              variation: { items: items.filter((i: any) => i.checkKind === "proposal") },
            },
            volume: volume ? parseInt(volume, 10) || 1 : 1,
            savedAt: new Date().toISOString(),
          };
        }
        // 保存先: G:/共有ドライブ/.../写植・校正用テキストログ/{レーベル}/{タイトル}/校正チェックデータ/
        const scan = useScanPsdStore.getState();
        const label = scan.workInfo.label || "";
        const titleStr = scan.workInfo.title || "";
        let defaultPath = "";
        if (label && titleStr) {
          const safeLabel = label.replace(/[\\/:*?"<>|]/g, "_");
          const safeTitle = titleStr.replace(/[\\/:*?"<>|]/g, "_");
          const calibrationDir = `G:/共有ドライブ/CLLENN/編集部フォルダ/編集企画部/写植・校正用テキストログ/${safeLabel}/${safeTitle}/校正チェックデータ`;
          try { await invoke("create_directory", { path: calibrationDir }); } catch { /* ignore */ }
          defaultPath = calibrationDir;
        } else {
          defaultPath = useProgenStore.getState().currentJsonPath
            ? useProgenStore.getState().currentJsonPath.replace(/[/\\][^/\\]+$/, "")
            : "";
        }
        // ファイル名は巻数
        const volStr = volume || "1";
        const fileName = `${volStr}巻.json`;
        let filePath: string | null = null;
        if (defaultPath) {
          try {
            await invoke("create_directory", { path: defaultPath });
            filePath = `${defaultPath}/${fileName}`;
            await writeJsonFile(filePath, jsonData);
          } catch {
            filePath = await showSaveJsonDialog(defaultPath, fileName);
            if (filePath) await writeJsonFile(filePath, jsonData);
          }
        } else {
          filePath = await showSaveJsonDialog("", fileName);
          if (filePath) await writeJsonFile(filePath, jsonData);
        }
        if (filePath) {
          // 校正JSONデータを自動読み込み
          try {
            const checkStore = useUnifiedViewerStore.getState();
            // パース済みアイテムがあればそのまま使用、なければ保存データから再パース
            let allItems: any[] = parsedItems;
            if (allItems.length === 0) {
              const content = await invoke<string>("read_text_file", { filePath });
              const data = JSON.parse(content);
              if (data.checks || Array.isArray(data)) {
                const parse = (src: any, fallbackKind: "correctness" | "proposal") => {
                  const arr = Array.isArray(src) ? src : Array.isArray(src?.items) ? src.items : null;
                  if (!arr) return;
                  for (const item of arr) {
                    allItems.push({
                      picked: false,
                      category: item.category || "",
                      page: item.page || "",
                      excerpt: item.excerpt || "",
                      content: item.content || item.text || "",
                      checkKind: item.checkKind || fallbackKind,
                    });
                  }
                };
                if (data.checks) {
                  parse(data.checks.simple, "correctness");
                  parse(data.checks.variation, "proposal");
                } else if (Array.isArray(data)) {
                  parse(data, "correctness");
                }
              } else if (data.rawResult) {
                const { items } = parseCheckText(data.rawResult);
                allItems = items;
              }
            }
            if (allItems.length > 0) {
              checkStore.setCheckData({
                title: "",
                fileName: filePath!.split(/[/\\]/).pop() || "",
                filePath: filePath!,
                allItems,
                correctnessItems: allItems.filter((i) => i.checkKind === "correctness"),
                proposalItems: allItems.filter((i) => i.checkKind === "proposal"),
              });
            }
          } catch (e) {
            console.error("JSON read-back error:", e);
          }
          setSaved(true);
        }
      }
    } catch (e) {
      console.error("Save error:", e);
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { close(null); setPasteText(""); setSaved(false); }}>
      <div className="bg-bg-primary rounded-xl shadow-2xl w-[600px] max-h-[70vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-bg-secondary">
          <h3 className="text-[11px] font-medium text-text-primary">{title}</h3>
          <button onClick={() => { close(null); setPasteText(""); setSaved(false); }} className="text-text-muted hover:text-text-primary text-lg transition-colors">✕</button>
        </div>

        {saved ? (
          <div className="p-8 text-center">
            <div className="w-12 h-12 mx-auto rounded-full bg-emerald-500/15 flex items-center justify-center mb-3">
              <svg className="w-6 h-6 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-xs text-text-primary font-medium">保存して読み込みました</p>
            <p className="text-[10px] text-text-muted mt-1">
              {isText ? "テキストを統合ビューアーに読み込みました" : "校正JSONデータを読み込みました"}
            </p>
            <button onClick={() => { close(null); setPasteText(""); setSaved(false); }} className="mt-4 px-6 py-1.5 text-xs font-medium text-white bg-accent rounded-lg hover:bg-accent-secondary transition-colors">
              閉じる
            </button>
          </div>
        ) : (
          <>
            <div className="p-4 flex-1 overflow-hidden flex flex-col gap-3">
              <p className="text-[10px] text-text-muted">
                {isText
                  ? "Geminiで生成されたテキストを貼り付けて保存してください。保存後、テキストは自動で読み込まれます。"
                  : "Geminiで生成された校正結果を貼り付けてJSON保存してください。保存後、校正データとして自動で読み込まれます。"}
              </p>
              {!isText && (
                <div className="flex items-center gap-2">
                  <label className="text-[10px] text-text-muted">巻数:</label>
                  <input
                    type="number"
                    min="1"
                    value={volume}
                    onChange={(e) => setVolume(e.target.value)}
                    className="w-16 text-[10px] px-2 py-1 bg-bg-tertiary border border-border/50 rounded text-text-primary outline-none text-center"
                  />
                  <span className="text-[9px] text-text-muted">巻</span>
                </div>
              )}
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={placeholder}
                className="flex-1 min-h-[200px] w-full px-3 py-2 text-[11px] font-mono bg-bg-tertiary border border-border/50 rounded-lg text-text-primary placeholder:text-text-muted/40 resize-none focus:outline-none focus:border-accent/50"
                autoFocus
              />
            </div>
            <div className="px-4 py-3 border-t border-border flex gap-2">
              <button
                onClick={handleSave}
                disabled={!pasteText.trim() || saving}
                className="flex-1 py-2 text-xs font-medium text-white bg-accent rounded-lg hover:bg-accent-secondary disabled:opacity-40 transition-colors"
              >
                {saving ? "保存中..." : isText ? "テキストとして保存" : "JSONとして保存"}
              </button>
              <button
                onClick={() => { close(null); setPasteText(""); setSaved(false); }}
                className="px-4 py-2 text-xs text-text-muted hover:text-text-primary transition-colors"
              >
                キャンセル
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

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
  const currentJsonPath = useProgenStore((s) => s.currentJsonPath);
  const currentLoadedJson = useProgenStore((s) => s.currentLoadedJson);
  const currentLabel = useScanPsdStore((s) => s.workInfo.label);
  const hasText = useUnifiedViewerStore((s) => s.textContent.length > 0);
  const hasRules = useProgenStore((s) => s.currentProofRules.length > 0);

  // レーベル一覧
  const [labels, setLabels] = useState<{ key: string; displayName?: string }[]>([]);
  const [selectedLabel, setSelectedLabel] = useState(currentLabel || "");
  const [labelsLoaded, setLabelsLoaded] = useState(false);
  // 新規作成用: ジャンル→レーベル 2段階選択（スキャナーと同じ）
  const [newGenre, setNewGenre] = useState("");

  useEffect(() => {
    if (labelsLoaded) return;
    (async () => {
      try {
        const result = await getMasterLabelList();
        if (result?.success && result.labels) {
          const sorted = [...result.labels].sort((a, b) => {
            if (a.key === "default") return -1;
            if (b.key === "default") return 1;
            return (a.displayName || a.key).localeCompare(b.displayName || b.key, "ja");
          });
          setLabels(sorted);
          setSelectedLabel(currentLabel || (sorted[0]?.key ?? ""));
        }
      } catch (e) {
        console.error("Failed to load label list:", e);
      }
      setLabelsLoaded(true);
    })();
  }, [labelsLoaded, currentLabel]);

  // レーベル選択 → マスタールール読み込み → 画面遷移
  const handleGo = useCallback((screen: ProgenScreen) => {
    if (selectedLabel && (!hasRules || selectedLabel !== currentLabel)) {
      useProgenStore.getState().loadMasterRule(selectedLabel);
    }
    try { localStorage.removeItem("progen_pendingMode"); } catch { /* ignore */ }
    navigateToScreen(screen);
  }, [selectedLabel, hasRules, currentLabel]);

  // 新規作成かどうか（ルール未読み込み）
  const isNew = !currentLoadedJson && !hasRules;

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 bg-bg-primary">
      <h1 className="text-2xl font-bold text-text-primary">ProGen</h1>
      <p className="text-sm text-text-secondary">テキスト校正プロンプト生成ツール</p>

      {/* ── レーベル選択 ── */}
      {/* 新規作成: スキャナーと同じ GENRE_LABELS による 2段階ドロップダウン */}
      {isNew ? (
        <div className="flex items-center gap-3 px-5 py-3 bg-bg-secondary border border-border rounded-xl">
          <span className="text-[10px] text-text-muted">ジャンル:</span>
          <select
            value={newGenre}
            onChange={(e) => {
              const g = e.target.value;
              setNewGenre(g);
              const firstLabel = GENRE_LABELS[g]?.[0] || "";
              setSelectedLabel(firstLabel);
            }}
            className="px-3 py-1.5 text-xs bg-bg-tertiary border border-border/50 rounded-lg text-text-primary focus:outline-none focus:border-accent/50 min-w-[140px]"
          >
            <option value="">選択...</option>
            {Object.keys(GENRE_LABELS).map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
          <span className="text-[10px] text-text-muted">レーベル:</span>
          <select
            value={selectedLabel}
            onChange={(e) => setSelectedLabel(e.target.value)}
            disabled={!newGenre}
            className="px-3 py-1.5 text-xs bg-bg-tertiary border border-border/50 rounded-lg text-text-primary focus:outline-none focus:border-accent/50 min-w-[180px] disabled:opacity-40"
          >
            <option value="">選択...</option>
            {(GENRE_LABELS[newGenre] || []).map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
          <span className="text-[9px] text-accent font-medium">新規作成</span>
        </div>
      ) : (
        /* 既存JSON読み込み済み: マスタールールのレーベル一覧 */
        labels.length > 0 && (
          <div className="flex items-center gap-3 px-5 py-3 bg-bg-secondary border border-border rounded-xl">
            <span className="text-[10px] text-text-muted">レーベル:</span>
            <select
              value={selectedLabel}
              onChange={(e) => setSelectedLabel(e.target.value)}
              className="px-3 py-1.5 text-xs bg-bg-tertiary border border-border/50 rounded-lg text-text-primary focus:outline-none focus:border-accent/50 min-w-[220px]"
            >
              {labels.map((l) => (
                <option key={l.key} value={l.key}>{l.displayName || l.key}</option>
              ))}
            </select>
            <span className="text-[9px] text-text-muted">{currentJsonPath ? `(${currentJsonPath.split(/[/\\]/).pop()})` : "JSON読み込み済み"}</span>
          </div>
        )
      )}

      {/* ── 新規作成: レーベル選択 + 「次へ」のみ（3モード選択なし）── */}
      {isNew && (
        <div className="flex flex-col items-center gap-3">
          <div className="px-4 py-2 bg-accent/10 border border-accent/20 rounded-lg">
            <span className="text-[10px] text-accent font-medium">
              レーベルを選択して「次へ」をクリックしてください
            </span>
          </div>
          <button
            onClick={() => handleGo("extraction")}
            disabled={!selectedLabel}
            className="px-10 py-3 text-sm font-medium text-white bg-gradient-to-r from-accent to-accent-secondary rounded-xl hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            次へ →
          </button>
        </div>
      )}

      {/* ── 既存ルール読み込み済み: WFモード選択 ── */}
      {!isNew && (
        <>
          {/* テキスト有無で大きなモードボタンをポップアップ */}
          <div className="flex flex-col items-center gap-3">
            {hasText ? (
              <button
                onClick={() => handleGo("extraction")}
                className="w-80 px-6 py-5 rounded-xl border-2 border-blue-500/40 bg-blue-500/5 hover:bg-blue-500/10 transition-all cursor-pointer text-center"
              >
                <div className="text-lg font-bold text-blue-500">📝 整形プロンプト</div>
                <div className="text-[10px] text-text-muted mt-1">テキストが読み込まれています — 統一表記ルールを適用して整形</div>
              </button>
            ) : (
              <button
                onClick={() => handleGo("extraction")}
                className="w-80 px-6 py-5 rounded-xl border-2 border-orange-500/40 bg-orange-500/5 hover:bg-orange-500/10 transition-all cursor-pointer text-center"
              >
                <div className="text-lg font-bold text-orange-500">🔍 抽出プロンプト</div>
                <div className="text-[10px] text-text-muted mt-1">テキスト未読み込み — PDF/画像からセリフを抽出</div>
              </button>
            )}

            {/* 校正プロンプトは常に表示（小さめ） */}
            <button
              onClick={() => handleGo("proofreading")}
              className="w-80 px-4 py-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10 transition-all cursor-pointer text-center"
            >
              <div className="text-sm font-medium text-emerald-500">✓ 校正プロンプト</div>
              <div className="text-[9px] text-text-muted mt-0.5">正誤チェック・提案チェック</div>
            </button>
          </div>

          {/* Utility links */}
          <div className="flex gap-4 mt-2">
            <button className="text-[10px] text-text-muted hover:text-accent transition-colors" onClick={() => navigateToScreen("comicpot")}>COMIC-POT エディタ</button>
            <button className="text-[10px] text-text-muted hover:text-accent transition-colors" onClick={() => navigateToScreen("resultViewer")}>結果ビューア</button>
            <button className="text-[10px] text-text-muted hover:text-accent transition-colors" onClick={() => navigateToScreen("admin")}>管理画面</button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── ProgenViewInner (screen router) ─────────────────────────────

function ProgenViewInner() {
  const screen = useProgenStore((s) => s.screen);
  const setScreen = useProgenStore((s) => s.setScreen);
  const progenModeFromStore = useViewStore((s) => s.progenMode);
  // ツールメニューから抽出/整形/校正リンクでアクセスした場合のモード（progenStore から取得）
  const toolMode = useProgenStore((s) => s.toolMode);
  const setToolMode = useProgenStore((s) => s.setToolMode);

  // Mode initialization — progenMode が変わるたびに実行
  useEffect(() => {
    const progenMode = progenModeFromStore;
    if (!progenMode) return;
    useViewStore.getState().setProgenMode(null);

    // WFフラグがある場合は toolMode をクリア（WF優先）
    const isWfMode = !!localStorage.getItem("folderSetup_progenMode") ||
                     !!localStorage.getItem("progen_wfCheckMode");
    if (isWfMode) {
      setToolMode(null);
    }
    // ツールメニュー経由の場合は既に TopNav で toolMode がセット済みなので何もしない

    // Map mode to screen
    // 注意: proofreading は extraction/formatting と同じ画面（ProgenRuleView）を使用。
    // toolMode === "proofreading" の場合は popup で 正誤+提案 ボタンを表示する。
    const screenMap: Record<string, ProgenScreen> = {
      extraction: "extraction",
      formatting: "formatting",
      proofreading: "extraction",
    };

    // ── ラベル取得（複数ソースからフォールバック）──
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

    const jsonPath = scan.currentJsonFilePath || viewer.presetJsonPath || "";

    // ── JSON/ラベルどちらもない場合 → ランディング画面に留まる（レーベル選択が必要）──
    // ただし、ツールメニュー経由 (toolMode がセット済み) の場合は screen を上書きしない
    // （TopNav で既に正しい screen がセット済み、popup を表示させるため）
    if (!jsonPath && !label) {
      if (!useProgenStore.getState().toolMode) {
        useProgenStore.getState().setScreen("landing");
        // pendingMode を localStorage に保存（ランディング画面でモード選択時に使用）
        try { localStorage.setItem("progen_pendingMode", progenMode); } catch { /* ignore */ }
      }
      return;
    }

    // ── JSON/ラベルがある場合 → 直接画面遷移 ──
    const targetScreen = screenMap[progenMode] || "landing";
    useProgenStore.getState().setScreen(targetScreen);

    // ── JSON読み込み + ルール適用 ──
    if (jsonPath) {
      readJsonFile(jsonPath).then((data) => {
        if (data) {
          useProgenStore.getState().setCurrentLoadedJson(data);
          useProgenStore.getState().setCurrentJsonPath(jsonPath);
          const proofRules = data?.proofRules || data?.presetData?.proofRules;
          if (proofRules) {
            useProgenStore.getState().applyJsonRules(proofRules.proof ? data : data.presetData || data);
          } else if (label) {
            useProgenStore.getState().loadMasterRule(label);
          }
        }
      }).catch(() => {
        if (label) useProgenStore.getState().loadMasterRule(label);
      });
    } else if (label) {
      useProgenStore.getState().loadMasterRule(label);
    }
  }, [progenModeFromStore]);

  // WF進行中判定
  const hasText = useUnifiedViewerStore((s) => s.textContent.length > 0);
  const wfProgenMode = (() => {
    try { return localStorage.getItem("folderSetup_progenMode"); } catch { return null; }
  })();
  const wfCheckMode = (() => {
    try { return localStorage.getItem("progen_wfCheckMode"); } catch { return null; }
  })();
  // 抽出/整形画面のpopup表示条件
  // toolMode === "proofreading" も extraction/formatting 画面で表示（正誤+提案ボタン）
  const showWfPopup = (screen === "extraction" || screen === "formatting")
    && (!!wfProgenMode || !!wfCheckMode || !!toolMode);

  // Render current screen
  switch (screen) {
    case "extraction":
    case "formatting":
      return (
        <div className="flex flex-col h-full overflow-hidden relative">
          <div className="flex-1 overflow-hidden"><ProgenRuleView /></div>
          {/* WF進行中: テキスト有無に応じたアクションポップアップ */}
          {showWfPopup && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30">
              {toolMode === "proofreading" && !hasText ? (
                /* 校正モードだがテキスト未読み込み → エラー表示 */
                <div className="flex items-center gap-3 px-8 py-4 rounded-2xl bg-error text-white shadow-xl shadow-error/30">
                  <span className="text-2xl">⚠</span>
                  <div className="text-left flex-1">
                    <div className="text-sm font-bold">テキストが読み込まれていません</div>
                    <div className="text-[10px] opacity-90">校正プロンプトを使うには、TopNavの「テキスト」ボタンからテキストを読み込んでください</div>
                  </div>
                  <button
                    onClick={() => setToolMode(null)}
                    className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-white/20 transition-colors"
                    title="閉じる"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ) : toolMode === "proofreading" ? (
                /* 校正モード: 正誤 + 提案 両方のボタンを並列表示 */
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      const store = useProgenStore.getState();
                      const text = useUnifiedViewerStore.getState().textContent;
                      if (!text) return;
                      import("../../lib/progenPrompts").then(({ generateSimpleCheckPrompt }) => {
                        const prompt = generateSimpleCheckPrompt(text, store.symbolRules, store.currentProofRules, store.options, store.numberRules);
                        navigator.clipboard.writeText(prompt).then(() => {
                          import("../../hooks/useProgenTauri").then(({ openExternalUrl }) => {
                            openExternalUrl("https://gemini.google.com/app");
                          });
                          useProgenStore.getState().setResultSaveMode("json");
                          setToolMode(null);
                        });
                      });
                    }}
                    className="flex items-center gap-3 px-6 py-4 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white shadow-xl shadow-emerald-500/30 transition-all hover:scale-105"
                  >
                    <span className="text-2xl">✓</span>
                    <div className="text-left">
                      <div className="text-sm font-bold">正誤チェック</div>
                      <div className="text-[10px] opacity-80">誤字・脱字・人名ルビ</div>
                    </div>
                  </button>
                  <button
                    onClick={() => {
                      const store = useProgenStore.getState();
                      const text = useUnifiedViewerStore.getState().textContent;
                      if (!text) return;
                      import("../../lib/progenPrompts").then(({ generateVariationCheckPrompt }) => {
                        const prompt = generateVariationCheckPrompt(text, store.symbolRules, store.currentProofRules, store.options, store.numberRules);
                        navigator.clipboard.writeText(prompt).then(() => {
                          import("../../hooks/useProgenTauri").then(({ openExternalUrl }) => {
                            openExternalUrl("https://gemini.google.com/app");
                          });
                          useProgenStore.getState().setResultSaveMode("json");
                          setToolMode(null);
                        });
                      });
                    }}
                    className="flex items-center gap-3 px-6 py-4 rounded-2xl bg-orange-500 hover:bg-orange-600 text-white shadow-xl shadow-orange-500/30 transition-all hover:scale-105"
                  >
                    <span className="text-2xl">💡</span>
                    <div className="text-left">
                      <div className="text-sm font-bold">提案チェック</div>
                      <div className="text-[10px] opacity-80">表記ゆれ・固有名詞等</div>
                    </div>
                  </button>
                </div>
              ) : toolMode === "formatting" && !hasText ? (
                /* 整形モードだがテキスト未読み込み → エラー表示 */
                <div className="flex items-center gap-3 px-8 py-4 rounded-2xl bg-error text-white shadow-xl shadow-error/30">
                  <span className="text-2xl">⚠</span>
                  <div className="text-left flex-1">
                    <div className="text-sm font-bold">テキストが読み込まれていません</div>
                    <div className="text-[10px] opacity-90">整形プロンプトを使うには、TopNavの「テキスト」ボタンからテキストを読み込んでください</div>
                  </div>
                  <button
                    onClick={() => setToolMode(null)}
                    className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-white/20 transition-colors"
                    title="閉じる"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ) : toolMode === "formatting" ? (
                /* ツールメニュー: 整形プロンプトボタン */
                <button
                  onClick={() => {
                    const store = useProgenStore.getState();
                    const viewer = useUnifiedViewerStore.getState();
                    const textContent = viewer.textContent;
                    const textFileName = viewer.textFilePath?.split(/[/\\]/).pop() || "text.txt";
                    import("../../lib/progenPrompts").then(({ generateFormattingPrompt }) => {
                      const prompt = generateFormattingPrompt(store.symbolRules, store.currentProofRules, store.options, store.numberRules, {
                        manuscriptTxtFiles: textContent ? [{ name: textFileName, content: textContent, size: textContent.length }] : [],
                      });
                      navigator.clipboard.writeText(prompt).then(() => {
                        import("../../hooks/useProgenTauri").then(({ openExternalUrl }) => {
                          openExternalUrl("https://gemini.google.com/app");
                        });
                        useProgenStore.getState().setResultSaveMode("text");
                        setToolMode(null);
                      });
                    });
                  }}
                  className="flex items-center gap-3 px-8 py-4 rounded-2xl bg-blue-500 hover:bg-blue-600 text-white shadow-xl shadow-blue-500/30 transition-all hover:scale-105"
                >
                  <span className="text-2xl">📝</span>
                  <div className="text-left">
                    <div className="text-sm font-bold">整形プロンプトをコピーして Gemini を開く</div>
                    <div className="text-[10px] opacity-80">テキストを統一表記ルールで整形</div>
                  </div>
                </button>
              ) : toolMode === "extraction" ? (
                /* ツールメニュー: 抽出プロンプトボタン */
                <button
                  onClick={() => {
                    const store = useProgenStore.getState();
                    import("../../lib/progenPrompts").then(({ generateExtractionPrompt }) => {
                      const prompt = generateExtractionPrompt(store.symbolRules, store.currentProofRules, store.options, store.numberRules);
                      navigator.clipboard.writeText(prompt).then(() => {
                        import("../../hooks/useProgenTauri").then(({ openExternalUrl }) => {
                          openExternalUrl("https://gemini.google.com/app");
                        });
                        useProgenStore.getState().setResultSaveMode("text");
                        setToolMode(null);
                      });
                    });
                  }}
                  className="flex items-center gap-3 px-8 py-4 rounded-2xl bg-orange-500 hover:bg-orange-600 text-white shadow-xl shadow-orange-500/30 transition-all hover:scale-105"
                >
                  <span className="text-2xl">🔍</span>
                  <div className="text-left">
                    <div className="text-sm font-bold">抽出プロンプトをコピーして Gemini を開く</div>
                    <div className="text-[10px] opacity-80">画像を送信してセリフを抽出</div>
                  </div>
                </button>
              ) : wfCheckMode ? (
                /* 正誤チェックボタン（校正プロンプトWF時） */
                <button
                  onClick={() => {
                    const store = useProgenStore.getState();
                    const text = useUnifiedViewerStore.getState().textContent;
                    if (!text) return;
                    import("../../lib/progenPrompts").then(({ generateSimpleCheckPrompt }) => {
                      const prompt = generateSimpleCheckPrompt(text, store.symbolRules, store.currentProofRules, store.options, store.numberRules);
                      navigator.clipboard.writeText(prompt).then(() => {
                        import("../../hooks/useProgenTauri").then(({ openExternalUrl }) => {
                          openExternalUrl("https://gemini.google.com/app");
                        });
                        useProgenStore.getState().setResultSaveMode("json");
                        try { localStorage.removeItem("progen_wfCheckMode"); } catch { /* ignore */ }
                      });
                    });
                  }}
                  className="flex items-center gap-3 px-8 py-4 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white shadow-xl shadow-emerald-500/30 transition-all hover:scale-105"
                >
                  <span className="text-2xl">✓</span>
                  <div className="text-left">
                    <div className="text-sm font-bold">正誤チェックプロンプトをコピーして Gemini を開く</div>
                    <div className="text-[10px] opacity-80">誤字・脱字・人名ルビ + 統一表記ルール反映確認</div>
                  </div>
                </button>
              ) : hasText ? (
                /* 整形プロンプトボタン */
                <button
                  onClick={() => {
                    const store = useProgenStore.getState();
                    const viewer = useUnifiedViewerStore.getState();
                    const textContent = viewer.textContent;
                    const textFileName = viewer.textFilePath?.split(/[/\\]/).pop() || "text.txt";
                    import("../../lib/progenPrompts").then(({ generateFormattingPrompt }) => {
                      const prompt = generateFormattingPrompt(store.symbolRules, store.currentProofRules, store.options, store.numberRules, {
                        manuscriptTxtFiles: textContent ? [{ name: textFileName, content: textContent, size: textContent.length }] : [],
                      });
                      navigator.clipboard.writeText(prompt).then(() => {
                        import("../../hooks/useProgenTauri").then(({ openExternalUrl }) => {
                          openExternalUrl("https://gemini.google.com/app");
                        });
                        useProgenStore.getState().setResultSaveMode("text");
                      });
                    });
                  }}
                  className="flex items-center gap-3 px-8 py-4 rounded-2xl bg-blue-500 hover:bg-blue-600 text-white shadow-xl shadow-blue-500/30 transition-all hover:scale-105"
                >
                  <span className="text-2xl">📝</span>
                  <div className="text-left">
                    <div className="text-sm font-bold">整形プロンプトをコピーして Gemini を開く</div>
                    <div className="text-[10px] opacity-80">テキストが読み込まれています</div>
                  </div>
                </button>
              ) : (
                /* 抽出プロンプトボタン */
                <button
                  onClick={() => {
                    const store = useProgenStore.getState();
                    import("../../lib/progenPrompts").then(({ generateExtractionPrompt }) => {
                      const prompt = generateExtractionPrompt(store.symbolRules, store.currentProofRules, store.options, store.numberRules);
                      navigator.clipboard.writeText(prompt).then(() => {
                        import("../../hooks/useProgenTauri").then(({ openExternalUrl }) => {
                          openExternalUrl("https://gemini.google.com/app");
                        });
                        useProgenStore.getState().setResultSaveMode("text");
                      });
                    });
                  }}
                  className="flex items-center gap-3 px-8 py-4 rounded-2xl bg-orange-500 hover:bg-orange-600 text-white shadow-xl shadow-orange-500/30 transition-all hover:scale-105"
                >
                  <span className="text-2xl">🔍</span>
                  <div className="text-left">
                    <div className="text-sm font-bold">抽出プロンプトをコピーして Gemini を開く</div>
                    <div className="text-[10px] opacity-80">画像を送信してセリフを抽出</div>
                  </div>
                </button>
              )}
            </div>
          )}
        </div>
      );
    // 注意: case "proofreading" は廃止しました。
    // 校正モードは extraction 画面を使用し、popup で 正誤+提案 ボタンを表示します。
    // ProgenProofreadingView コンポーネントは隔離済み（意図的にレンダリングしない）
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

  // unreachable — switch は全ケースを網羅
}

// ─── ProgenViewWrapper (モーダルを常時描画) ──────���─────────────────

export function ProgenView() {
  return (
    <>
      <ProgenViewInner />
      <ResultSaveModal />
    </>
  );
}
