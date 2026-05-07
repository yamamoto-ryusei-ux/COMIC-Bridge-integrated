// ===========================================================
// リサイくるん連携用コマンド
// COMIC-Bridge ⇔ UXP プラグイン (リサイくるん) のジョブ通信
// ===========================================================

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// ジョブディレクトリ: %APPDATA%/comic-bridge/recycle-jobs/
fn jobs_dir() -> Result<PathBuf, String> {
    let appdata = dirs::config_dir()
        .ok_or_else(|| "Failed to resolve APPDATA directory".to_string())?;
    let dir = appdata.join("comic-bridge").join("recycle-jobs");
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("Failed to create jobs dir: {}", e))?;
    }
    Ok(dir)
}

/// ユニークなジョブIDを生成（YYYYMMDDHHMMSS-randomHex）
fn generate_job_id() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let dt = chrono_like_format(now);

    // ランダムな短い識別子
    let nano = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let suffix = format!("{:x}", nano & 0xffffff);

    format!("{}-{}", dt, suffix)
}

/// 簡易タイムスタンプ生成（chrono 依存を避ける）
fn chrono_like_format(unix_secs: u64) -> String {
    // UTCのまま整形（ジョブIDがファイル名なので可読性のみ）
    // 1970-01-01 起点で日数・時間を計算
    let days = unix_secs / 86400;
    let secs_today = unix_secs % 86400;
    let hh = secs_today / 3600;
    let mm = (secs_today % 3600) / 60;
    let ss = secs_today % 60;

    // ざっくり年月日（うるう年対応）
    let (y, mo, d) = ymd_from_days(days as i64);
    format!(
        "{:04}{:02}{:02}-{:02}{:02}{:02}",
        y, mo, d, hh, mm, ss
    )
}

fn ymd_from_days(mut days: i64) -> (i32, u32, u32) {
    // 1970-01-01 をエポックとして年月日を計算
    let mut year: i32 = 1970;
    loop {
        let dy = if is_leap(year) { 366 } else { 365 };
        if days < dy as i64 {
            break;
        }
        days -= dy as i64;
        year += 1;
    }
    let month_days = if is_leap(year) {
        [31u32, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31u32, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };
    let mut month = 1u32;
    for &md in month_days.iter() {
        if days < md as i64 {
            break;
        }
        days -= md as i64;
        month += 1;
    }
    let day = (days + 1) as u32;
    (year, month, day)
}

fn is_leap(y: i32) -> bool {
    (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0)
}

// =========================================================
// Rust commands
// =========================================================

/// ジョブJSONを書き出してジョブIDを返す
/// `job_json` は完全なジョブJSON（jobIdは含まなくてもOK、自動付与）
#[tauri::command]
pub async fn write_recycle_job(job_json: String) -> Result<String, String> {
    let dir = jobs_dir()?;

    // jobIdを抽出 or 生成
    let parsed: serde_json::Value =
        serde_json::from_str(&job_json).map_err(|e| format!("Invalid job JSON: {}", e))?;
    let job_id = parsed
        .get("jobId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(generate_job_id);

    // jobIdをJSONに反映（後付の場合）
    let mut json_value = parsed;
    if let Some(obj) = json_value.as_object_mut() {
        obj.insert("jobId".to_string(), serde_json::Value::String(job_id.clone()));
    }
    let final_json = serde_json::to_string_pretty(&json_value)
        .map_err(|e| format!("Failed to re-serialize: {}", e))?;

    let job_path = dir.join(format!("{}.job.json", job_id));
    fs::write(&job_path, final_json)
        .map_err(|e| format!("Failed to write job file: {}", e))?;

    Ok(job_id)
}

/// 進捗JSONを読む（存在しなければ None）
#[tauri::command]
pub async fn read_recycle_status(job_id: String) -> Result<Option<String>, String> {
    let path = jobs_dir()?.join(format!("{}.status.json", job_id));
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read status: {}", e))?;
    Ok(Some(content))
}

/// 結果JSONを読む（存在しなければ None）
#[tauri::command]
pub async fn read_recycle_result(job_id: String) -> Result<Option<String>, String> {
    let path = jobs_dir()?.join(format!("{}.result.json", job_id));
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read result: {}", e))?;
    Ok(Some(content))
}

/// 中断要求（空ファイルを作成）
#[tauri::command]
pub async fn cancel_recycle_job(job_id: String) -> Result<(), String> {
    let path = jobs_dir()?.join(format!("{}.cancel", job_id));
    fs::write(&path, b"")
        .map_err(|e| format!("Failed to write cancel marker: {}", e))?;
    Ok(())
}

/// ジョブ関連ファイルを全削除（job/status/result/cancel）
#[tauri::command]
pub async fn cleanup_recycle_job(job_id: String) -> Result<(), String> {
    let dir = jobs_dir()?;
    for ext in &["job.json", "status.json", "result.json", "cancel"] {
        let p = dir.join(format!("{}.{}", job_id, ext));
        if p.exists() {
            let _ = fs::remove_file(&p);
        }
    }
    Ok(())
}

/// セットアップ済みかチェック（.atn が存在するか or 既にセットアップ試行済みフラグ）
fn setup_marker_path() -> Result<PathBuf, String> {
    let appdata = dirs::config_dir()
        .ok_or_else(|| "Failed to resolve APPDATA directory".to_string())?;
    Ok(appdata.join("comic-bridge").join("recycle-setup.json"))
}

/// セットアップが必要か確認
fn needs_setup(resource_atn_path: &Path) -> bool {
    // .atn が既にあるならスキップ
    if resource_atn_path.exists() {
        return false;
    }
    // セットアップマーカーがあるならスキップ（過去に試行済み）
    if let Ok(marker) = setup_marker_path() {
        if marker.exists() {
            return false;
        }
    }
    true
}

/// セットアップ完了マーカーを書く
fn write_setup_marker(result_json: &str) -> Result<(), String> {
    let path = setup_marker_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).ok();
    }
    fs::write(&path, result_json)
        .map_err(|e| format!("Failed to write setup marker: {}", e))?;
    Ok(())
}

/// 古いジョブ関連ファイルを掃除（指定秒以上前のもの）
#[tauri::command]
pub async fn cleanup_old_recycle_jobs(max_age_secs: u64) -> Result<u32, String> {
    let dir = jobs_dir()?;
    let now = SystemTime::now();
    let mut removed = 0u32;
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if let Ok(modified) = meta.modified() {
                    if let Ok(age) = now.duration_since(modified) {
                        if age.as_secs() > max_age_secs {
                            if fs::remove_file(entry.path()).is_ok() {
                                removed += 1;
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(removed)
}

/// Photoshop を起動してリサイくるんプラグインのコマンドを直接呼び出す
/// v1.2.0以降のコマンド駆動方式: app.runMenuItem(stringIDToTypeID("リサイくるん 実行 (CB)"))
/// プラグインの command ハンドラが起動 → jobs ディレクトリの最新ジョブを処理
#[tauri::command]
pub async fn launch_photoshop_with_recycle(
    app_handle: tauri::AppHandle,
    job_id: String,
) -> Result<(), String> {
    use std::io::Write;
    use std::process::Command;
    use tauri::Manager;

    // Photoshop パスを探索
    let ps_path = find_photoshop_path()
        .ok_or_else(|| "Photoshop not found. Please install Adobe Photoshop.".to_string())?;

    // bridge_invoke_command.jsx のパスを解決
    let resource_path = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;

    let script_path = resource_path.join("scripts").join("bridge_invoke_command.jsx");
    let script_path_buf = if script_path.exists() {
        script_path
    } else {
        // 開発時のフォールバック
        let dev_script = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("scripts")
            .join("bridge_invoke_command.jsx");
        if dev_script.exists() {
            dev_script
        } else {
            return Err("bridge_invoke_command.jsx not found".to_string());
        }
    };

    // JSX 本体を読み込んで helper に直接埋め込む（日本語パス問題を回避）
    // $.evalFile を使うと日本語パスで「Unknown escape sequence」エラーが発生する
    let bridge_jsx_content = fs::read_to_string(&script_path_buf)
        .map_err(|e| format!("Failed to read bridge_invoke_command.jsx: {}", e))?;

    let temp_dir = std::env::temp_dir();
    let helper_path = temp_dir.join(format!("cb-recycle-invoke-{}.jsx", job_id));

    let helper_content = format!(
        "// CB-Recycle invoke helper (auto-generated)\nvar __CB_RECYCLE_JOB_ID = \"{}\";\n{}\n",
        job_id.replace('"', "\\\""),
        bridge_jsx_content
    );

    // UTF-8 BOM 付きで書き込み（ExtendScript の日本語認識のため、convert_psd と同じパターン）
    let mut helper_file = fs::File::create(&helper_path)
        .map_err(|e| format!("Failed to create helper: {}", e))?;
    helper_file
        .write_all(&[0xEF, 0xBB, 0xBF])
        .map_err(|e| format!("Failed to write BOM: {}", e))?;
    helper_file
        .write_all(helper_content.as_bytes())
        .map_err(|e| format!("Failed to write helper: {}", e))?;

    eprintln!("[recycle] Photoshop: {}", ps_path);
    eprintln!("[recycle] Invoke helper: {}", helper_path.display());
    eprintln!("[recycle] Job: {}", job_id);

    Command::new(&ps_path)
        .arg("-r")
        .arg(helper_path.to_string_lossy().to_string())
        .spawn()
        .map_err(|e| format!("Failed to launch Photoshop: {}", e))?;

    Ok(())
}

/// PowerShell COM Automation で強制的にプラグインパネルを開く
/// JSX や UI Automation が失敗した場合の最終手段
#[tauri::command]
pub async fn force_open_recycle_panel(
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    use std::process::Command;
    use tauri::Manager;

    // open_recycle_panel.ps1 を永続パスに配置
    let resource_path = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;

    let permanent_ps = deploy_uia_powershell_script(&resource_path)?;

    eprintln!("[recycle:force-open] PowerShell: {}", permanent_ps.display());

    // PowerShell を別プロセスで起動（バックグラウンド・非表示）
    Command::new("powershell.exe")
        .args([
            "-ExecutionPolicy", "Bypass",
            "-WindowStyle", "Hidden",
            "-File", permanent_ps.to_string_lossy().as_ref(),
        ])
        .spawn()
        .map_err(|e| format!("Failed to launch PowerShell: {}", e))?;

    Ok("PowerShell スクリプトをバックグラウンドで起動しました。最大2分後にパネルが開くか確認してください。".to_string())
}

/// Photoshop プロセスが起動済みか確認（簡易版：パスが存在するかと、プロセス一覧から探す）
#[tauri::command]
pub async fn is_photoshop_running() -> Result<bool, String> {
    use std::process::Command;
    // Windows の tasklist でプロセスチェック
    let output = Command::new("tasklist")
        .args(["/FI", "IMAGENAME eq Photoshop.exe", "/NH"])
        .output()
        .map_err(|e| format!("Failed to run tasklist: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout.contains("Photoshop.exe"))
}

/// CB-Recycle セットアップ実行（.atn 自動生成 + パネル展開確認）
/// 初回のみ実行される。setup_recycle_action.jsx を Photoshop で動かす。
#[tauri::command]
pub async fn run_recycle_setup(
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    use std::io::Write;
    use std::process::Command;
    let _ = app_handle;

    let ps_path = find_photoshop_path()
        .ok_or_else(|| "Photoshop not found. Please install Adobe Photoshop.".to_string())?;

    // setup_recycle_action.jsx のパス
    let dev_script = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("scripts")
        .join("setup_recycle_action.jsx");
    if !dev_script.exists() {
        return Err("setup_recycle_action.jsx not found".to_string());
    }

    // .atn 出力先（リソースディレクトリ配下）
    let atn_output = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("CB-Recycle.atn");
    if let Some(parent) = atn_output.parent() {
        fs::create_dir_all(parent).ok();
    }
    let atn_output_str = atn_output.to_string_lossy().to_string();

    // 結果書き出し先（一時ファイル）
    let temp_dir = std::env::temp_dir();
    let result_path = temp_dir.join("cb-recycle-setup-result.json");
    if result_path.exists() {
        let _ = fs::remove_file(&result_path);
    }
    let result_path_str = result_path.to_string_lossy().to_string();

    // setup_recycle_action.jsx の中身を直接埋め込む（日本語パス問題回避）
    let setup_jsx_content = fs::read_to_string(&dev_script)
        .map_err(|e| format!("Failed to read setup_recycle_action.jsx: {}", e))?;

    let helper_path = temp_dir.join("cb-recycle-setup-launch.jsx");
    let helper_content = format!(
        "// CB-Recycle setup launcher (auto-generated)\nvar __CB_RECYCLE_ATN_OUTPUT_PATH = \"{}\";\nvar __CB_RECYCLE_RESULT_PATH = \"{}\";\n{}\n",
        atn_output_str.replace('\\', "/").replace('"', "\\\""),
        result_path_str.replace('\\', "/").replace('"', "\\\""),
        setup_jsx_content
    );

    // UTF-8 BOM 付きで書き込み
    let mut helper_file = fs::File::create(&helper_path)
        .map_err(|e| format!("Failed to create setup helper: {}", e))?;
    helper_file
        .write_all(&[0xEF, 0xBB, 0xBF])
        .map_err(|e| format!("Failed to write BOM: {}", e))?;
    helper_file
        .write_all(helper_content.as_bytes())
        .map_err(|e| format!("Failed to write setup helper: {}", e))?;

    eprintln!("[recycle:setup] Photoshop: {}", ps_path);
    eprintln!("[recycle:setup] ATN output: {}", atn_output_str);

    Command::new(&ps_path)
        .arg("-r")
        .arg(helper_path.to_string_lossy().to_string())
        .spawn()
        .map_err(|e| format!("Failed to launch Photoshop for setup: {}", e))?;

    // 結果ファイルが書かれるまで最大30秒ポーリング
    let mut waited = 0;
    let max_wait = 30_000u64;
    let interval = 500u64;
    while waited < max_wait {
        if result_path.exists() {
            let content = fs::read_to_string(&result_path)
                .map_err(|e| format!("Failed to read result: {}", e))?;
            // セットアップマーカー保存
            let _ = write_setup_marker(&content);
            // 一時ファイル削除
            let _ = fs::remove_file(&result_path);
            let _ = fs::remove_file(&helper_path);
            return Ok(content);
        }
        std::thread::sleep(std::time::Duration::from_millis(interval));
        waited += interval;
    }

    // タイムアウト
    let _ = fs::remove_file(&helper_path);
    Err("Setup timed out (30s). Photoshop may not have run the script.".to_string())
}

/// Photoshop 起動時の自動展開ワークスペースをセットアップ
/// setup_workspace.jsx を実行：パネル展開 → ワークスペース「リサイくるん用」保存 → アクティブ化
/// 1度実行すると、以降 Photoshop 起動時に自動でパネルが開いた状態で起動する
#[tauri::command]
pub async fn setup_recycle_workspace(
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    use std::io::Write;
    use std::process::Command;
    use tauri::Manager;

    let ps_path = find_photoshop_path()
        .ok_or_else(|| "Photoshop not found.".to_string())?;

    // setup_workspace.jsx パスを解決
    let resource_path = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;

    let script_path = resource_path.join("scripts").join("setup_workspace.jsx");
    let script_path_buf = if script_path.exists() {
        script_path
    } else {
        let dev_script = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("scripts")
            .join("setup_workspace.jsx");
        if !dev_script.exists() {
            return Err("setup_workspace.jsx not found".to_string());
        }
        dev_script
    };

    let setup_jsx_content = fs::read_to_string(&script_path_buf)
        .map_err(|e| format!("Failed to read setup_workspace.jsx: {}", e))?;

    // 結果書き出し先（一時ファイル）
    let temp_dir = std::env::temp_dir();
    let result_path = temp_dir.join("cb-recycle-workspace-result.json");
    if result_path.exists() {
        let _ = fs::remove_file(&result_path);
    }
    let result_path_str = result_path.to_string_lossy().to_string();

    // ヘルパースクリプト（変数 + JSX 本体を直接埋め込み、UTF-8 BOM 付き）
    let helper_path = temp_dir.join("cb-recycle-workspace-launch.jsx");
    let helper_content = format!(
        "// CB-Recycle workspace setup launcher\nvar __CB_RECYCLE_RESULT_PATH = \"{}\";\n{}\n",
        result_path_str.replace('\\', "/").replace('"', "\\\""),
        setup_jsx_content
    );

    let mut helper_file = fs::File::create(&helper_path)
        .map_err(|e| format!("Failed to create helper: {}", e))?;
    helper_file
        .write_all(&[0xEF, 0xBB, 0xBF])
        .map_err(|e| format!("Failed to write BOM: {}", e))?;
    helper_file
        .write_all(helper_content.as_bytes())
        .map_err(|e| format!("Failed to write helper: {}", e))?;

    eprintln!("[recycle:workspace] Photoshop: {}", ps_path);
    eprintln!("[recycle:workspace] Helper: {}", helper_path.display());

    Command::new(&ps_path)
        .arg("-r")
        .arg(helper_path.to_string_lossy().to_string())
        .spawn()
        .map_err(|e| format!("Failed to launch Photoshop: {}", e))?;

    // 結果ファイルが書かれるまで最大 180 秒ポーリング
    // （Photoshop 起動最大 90 秒 + UXP 待機 3 秒 + 試行 10 回 × 3 秒 = 約 123 秒 + 余裕）
    let mut waited = 0u64;
    let max_wait = 180_000u64;
    let interval = 500u64;
    while waited < max_wait {
        if result_path.exists() {
            let content = fs::read_to_string(&result_path)
                .map_err(|e| format!("Failed to read result: {}", e))?;
            let _ = fs::remove_file(&result_path);
            let _ = fs::remove_file(&helper_path);
            return Ok(content);
        }
        std::thread::sleep(std::time::Duration::from_millis(interval));
        waited += interval;
    }

    let _ = fs::remove_file(&helper_path);
    Err("Workspace setup timed out (180s). Photoshop may not have started or run the script.".to_string())
}

/// PowerShell UIA スクリプトを永続パスに配置
/// startApplication 通知から参照されるため、固定パスにコピーが必要
fn deploy_uia_powershell_script(resource_path: &Path) -> Result<PathBuf, String> {
    let appdata = dirs::config_dir()
        .ok_or_else(|| "Failed to resolve APPDATA directory".to_string())?;
    let cb_dir = appdata.join("comic-bridge");
    fs::create_dir_all(&cb_dir).ok();
    let permanent_path = cb_dir.join("open_recycle_panel.ps1");

    let src = {
        let resource_src = resource_path.join("scripts").join("open_recycle_panel.ps1");
        if resource_src.exists() {
            resource_src
        } else {
            let dev_src = Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("scripts")
                .join("open_recycle_panel.ps1");
            if !dev_src.exists() {
                return Err("open_recycle_panel.ps1 not found".to_string());
            }
            dev_src
        }
    };
    fs::copy(&src, &permanent_path)
        .map_err(|e| format!("Failed to copy PowerShell script: {}", e))?;

    Ok(permanent_path)
}

/// Photoshop 起動時の自動展開を有効化（Script Events Manager 経由）
/// `enable=true` で登録、`enable=false` で解除
/// 同時に PowerShell UIA スクリプトも配置する（cb_recycle_startup.jsx から参照される）
#[tauri::command]
pub async fn setup_recycle_startup(
    app_handle: tauri::AppHandle,
    enable: bool,
) -> Result<String, String> {
    use std::io::Write;
    use std::process::Command;
    use tauri::Manager;

    let ps_path = find_photoshop_path()
        .ok_or_else(|| "Photoshop not found.".to_string())?;

    let resource_path = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;

    // 1. 起動時実行スクリプト (cb_recycle_startup.jsx) を %APPDATA% に永続コピー
    //    Photoshop が起動するたびにここから読まれる
    let appdata = dirs::config_dir()
        .ok_or_else(|| "Failed to resolve APPDATA directory".to_string())?;
    let cb_dir = appdata.join("comic-bridge");
    fs::create_dir_all(&cb_dir).ok();
    let permanent_startup_path = cb_dir.join("cb_recycle_startup.jsx");

    // ソース（リソースまたは開発時ディレクトリ）から取得
    let startup_src = {
        let resource_src = resource_path.join("scripts").join("cb_recycle_startup.jsx");
        if resource_src.exists() {
            resource_src
        } else {
            let dev_src = Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("scripts")
                .join("cb_recycle_startup.jsx");
            if !dev_src.exists() {
                return Err("cb_recycle_startup.jsx not found".to_string());
            }
            dev_src
        }
    };
    fs::copy(&startup_src, &permanent_startup_path)
        .map_err(|e| format!("Failed to copy startup script: {}", e))?;

    // 1.5. PowerShell UIA スクリプトを永続配置（cb_recycle_startup.jsx が参照する）
    if enable {
        match deploy_uia_powershell_script(&resource_path) {
            Ok(p) => eprintln!("[recycle:startup] PowerShell UIA deployed: {}", p.display()),
            Err(e) => eprintln!("[recycle:startup] PowerShell UIA deploy warning: {}", e),
        }
    }

    // 2. register_startup.jsx を読み込み、ヘルパースクリプトに埋め込む
    let register_src = {
        let resource_src = resource_path.join("scripts").join("register_startup.jsx");
        if resource_src.exists() {
            resource_src
        } else {
            let dev_src = Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("scripts")
                .join("register_startup.jsx");
            if !dev_src.exists() {
                return Err("register_startup.jsx not found".to_string());
            }
            dev_src
        }
    };
    let register_jsx_content = fs::read_to_string(&register_src)
        .map_err(|e| format!("Failed to read register_startup.jsx: {}", e))?;

    // 3. 結果書き出し先
    let temp_dir = std::env::temp_dir();
    let result_path = temp_dir.join("cb-recycle-startup-register-result.json");
    if result_path.exists() {
        let _ = fs::remove_file(&result_path);
    }
    let result_path_str = result_path.to_string_lossy().to_string();

    // 4. ヘルパースクリプト生成（変数 + register_startup.jsx 本体）
    let action_mode = if enable { "register" } else { "unregister" };
    let helper_path = temp_dir.join("cb-recycle-startup-register-launch.jsx");
    let permanent_path_str = permanent_startup_path.to_string_lossy().to_string();
    let helper_content = format!(
        "// CB-Recycle startup register launcher\nvar __CB_STARTUP_SCRIPT_PATH = \"{}\";\nvar __CB_STARTUP_ACTION = \"{}\";\nvar __CB_RECYCLE_RESULT_PATH = \"{}\";\n{}\n",
        permanent_path_str.replace('\\', "/").replace('"', "\\\""),
        action_mode,
        result_path_str.replace('\\', "/").replace('"', "\\\""),
        register_jsx_content
    );

    // UTF-8 BOM 付き
    let mut helper_file = fs::File::create(&helper_path)
        .map_err(|e| format!("Failed to create helper: {}", e))?;
    helper_file
        .write_all(&[0xEF, 0xBB, 0xBF])
        .map_err(|e| format!("Failed to write BOM: {}", e))?;
    helper_file
        .write_all(helper_content.as_bytes())
        .map_err(|e| format!("Failed to write helper: {}", e))?;

    eprintln!("[recycle:startup] Photoshop: {}", ps_path);
    eprintln!("[recycle:startup] Action: {}", action_mode);
    eprintln!("[recycle:startup] Permanent script: {}", permanent_path_str);

    Command::new(&ps_path)
        .arg("-r")
        .arg(helper_path.to_string_lossy().to_string())
        .spawn()
        .map_err(|e| format!("Failed to launch Photoshop: {}", e))?;

    // 結果ファイルを最大30秒待つ
    let mut waited = 0u64;
    let max_wait = 30_000u64;
    let interval = 500u64;
    while waited < max_wait {
        if result_path.exists() {
            let content = fs::read_to_string(&result_path)
                .map_err(|e| format!("Failed to read result: {}", e))?;
            let _ = fs::remove_file(&result_path);
            let _ = fs::remove_file(&helper_path);
            return Ok(content);
        }
        std::thread::sleep(std::time::Duration::from_millis(interval));
        waited += interval;
    }

    let _ = fs::remove_file(&helper_path);
    Err("Startup registration timed out (30s)".to_string())
}

/// セットアップ済み状態を取得（UI 表示用）
/// v1.2.0以降のコマンド駆動方式ではセットアップ不要のため常に setupNeeded=false を返す。
/// 旧版（v1.1.0）ユーザーの既存マーカーは情報として残す。
#[tauri::command]
pub async fn get_recycle_setup_status() -> Result<serde_json::Value, String> {
    let dev_atn = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("CB-Recycle.atn");

    let atn_exists = dev_atn.exists();
    let marker_exists = setup_marker_path().map(|p| p.exists()).unwrap_or(false);

    let marker_content = if marker_exists {
        setup_marker_path()
            .ok()
            .and_then(|p| fs::read_to_string(p).ok())
            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
    } else {
        None
    };

    Ok(serde_json::json!({
        "atnExists": atn_exists,
        "markerExists": marker_exists,
        "marker": marker_content,
        "setupNeeded": false,
        "mode": "command-driven"
    }))
}

// =========================================================
// 内部ヘルパー: Photoshop パス探索
// （commands.rs の find_photoshop_path と同じ。重複を避けるため pub にしてもよいが、
//   モジュール独立性を保つため当面は二重実装。後でリファクタ可能）
// =========================================================
fn find_photoshop_path() -> Option<String> {
    let possible_paths = vec![
        r"C:\Program Files\Adobe\Adobe Photoshop 2026\Photoshop.exe",
        r"C:\Program Files\Adobe\Adobe Photoshop 2025\Photoshop.exe",
        r"C:\Program Files\Adobe\Adobe Photoshop 2024\Photoshop.exe",
        r"C:\Program Files\Adobe\Adobe Photoshop 2023\Photoshop.exe",
        r"C:\Program Files\Adobe\Adobe Photoshop 2022\Photoshop.exe",
        r"C:\Program Files\Adobe\Adobe Photoshop 2021\Photoshop.exe",
        r"C:\Program Files\Adobe\Adobe Photoshop 2020\Photoshop.exe",
        r"C:\Program Files\Adobe\Adobe Photoshop CC 2019\Photoshop.exe",
        r"C:\Program Files\Adobe\Adobe Photoshop CC 2018\Photoshop.exe",
        r"C:\Program Files\Adobe\Adobe Photoshop CS6 (64 Bit)\Photoshop.exe",
        r"C:\Program Files (x86)\Adobe\Adobe Photoshop CS6\Photoshop.exe",
    ];
    for path in possible_paths {
        if Path::new(path).exists() {
            return Some(path.to_string());
        }
    }
    None
}
