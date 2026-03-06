use fontdb::{Database, Language};
use ttf_parser::name_id;
use image::{DynamicImage, GenericImageView, ImageBuffer, Rgba, RgbaImage, imageops::FilterType};
use psd::Psd;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use tauri::Manager;
use thiserror::Error;
use std::time::{SystemTime, UNIX_EPOCH};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

// ============================================
// Natural sort comparison (1, 2, 10, 11...)
// ============================================

fn natural_sort_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let mut ai = a.chars().peekable();
    let mut bi = b.chars().peekable();

    loop {
        match (ai.peek(), bi.peek()) {
            (None, None) => return std::cmp::Ordering::Equal,
            (None, Some(_)) => return std::cmp::Ordering::Less,
            (Some(_), None) => return std::cmp::Ordering::Greater,
            (Some(&ac), Some(&bc)) => {
                if ac.is_ascii_digit() && bc.is_ascii_digit() {
                    // 数値部分を丸ごと比較
                    let mut an = String::new();
                    while let Some(&c) = ai.peek() {
                        if c.is_ascii_digit() { an.push(c); ai.next(); } else { break; }
                    }
                    let mut bn = String::new();
                    while let Some(&c) = bi.peek() {
                        if c.is_ascii_digit() { bn.push(c); bi.next(); } else { break; }
                    }
                    let na: u64 = an.parse().unwrap_or(0);
                    let nb: u64 = bn.parse().unwrap_or(0);
                    match na.cmp(&nb) {
                        std::cmp::Ordering::Equal => continue,
                        other => return other,
                    }
                } else {
                    let al = ac.to_lowercase().next().unwrap_or(ac);
                    let bl = bc.to_lowercase().next().unwrap_or(bc);
                    match al.cmp(&bl) {
                        std::cmp::Ordering::Equal => { ai.next(); bi.next(); }
                        other => return other,
                    }
                }
            }
        }
    }
}

// ============================================
// PSD Cache (for faster repeated access)
// ============================================

/// PSD画像キャッシュ（プレビュー用）
/// キー: ファイルパス、値: (画像データ, 幅, 高さ)
static PSD_CACHE: OnceLock<Mutex<HashMap<String, (Vec<u8>, u32, u32)>>> = OnceLock::new();

/// PSDキャッシュの最大エントリ数
const MAX_PSD_CACHE_ENTRIES: usize = 10;

/// PSDキャッシュのハンドルを取得
fn get_psd_cache() -> &'static Mutex<HashMap<String, (Vec<u8>, u32, u32)>> {
    PSD_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

// ============================================
// Preview Result Cache (for instant repeated access)
// ============================================

/// プレビュー結果キャッシュ（ガイドエディタ用）
/// キー: "{file_path}_{modified_secs}_{max_size}", 値: HighResPreviewResult
static PREVIEW_RESULT_CACHE: OnceLock<Mutex<HashMap<String, HighResPreviewResult>>> = OnceLock::new();

/// プレビュー結果キャッシュの最大エントリ数
const MAX_PREVIEW_CACHE_ENTRIES: usize = 20;

/// プレビュー結果キャッシュのハンドルを取得
fn get_preview_result_cache() -> &'static Mutex<HashMap<String, HighResPreviewResult>> {
    PREVIEW_RESULT_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// PSDキャッシュをクリア
#[tauri::command]
pub async fn clear_psd_cache() {
    if let Ok(mut cache) = get_psd_cache().lock() {
        cache.clear();
    }
    if let Ok(mut cache) = get_preview_result_cache().lock() {
        cache.clear();
    }
}

// ============================================
// File watcher commands
// ============================================

#[tauri::command]
pub async fn start_file_watcher(
    app_handle: tauri::AppHandle,
    file_paths: Vec<String>,
) -> Result<(), String> {
    crate::watcher::start(app_handle, file_paths)
}

#[tauri::command]
pub async fn stop_file_watcher() -> Result<(), String> {
    crate::watcher::stop()
}

/// 特定ファイルのキャッシュを無効化（ファイル変更時に使用）
#[tauri::command]
pub async fn invalidate_file_cache(file_path: String) {
    if let Ok(mut cache) = get_psd_cache().lock() {
        cache.remove(&file_path);
    }
    if let Ok(mut cache) = get_preview_result_cache().lock() {
        let keys_to_remove: Vec<String> = cache
            .keys()
            .filter(|k| k.starts_with(&file_path))
            .cloned()
            .collect();
        for key in keys_to_remove {
            cache.remove(&key);
        }
    }
}

/// ファイルの更新日時をUNIXエポックからの秒数で取得
fn get_file_modified_secs(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .map(|t| t.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs())
        .unwrap_or(0)
}

/// PSDヘッダーから寸法のみを高速読み取り（26バイトのみ）
fn read_psd_dimensions(path: &Path) -> Result<(u32, u32), String> {
    let mut file = File::open(path).map_err(|e| format!("Failed to open: {}", e))?;
    let mut header = [0u8; 26];
    file.read_exact(&mut header).map_err(|e| format!("Header read error: {}", e))?;
    if &header[0..4] != b"8BPS" {
        return Err("Not a valid PSD file".to_string());
    }
    let height = u32::from_be_bytes([header[14], header[15], header[16], header[17]]);
    let width = u32::from_be_bytes([header[18], header[19], header[20], header[21]]);
    Ok((width, height))
}

/// PSDキャッシュから画像を取得、またはキャッシュに追加
fn get_or_cache_psd(path: &Path) -> Result<DynamicImage, String> {
    let path_str = path.to_string_lossy().to_string();

    // キャッシュをチェック
    if let Ok(cache) = get_psd_cache().lock() {
        if let Some((rgba_data, width, height)) = cache.get(&path_str) {
            if let Some(img) = ImageBuffer::from_raw(*width, *height, rgba_data.clone()) {
                return Ok(DynamicImage::ImageRgba8(img));
            }
        }
    }

    // キャッシュになければ読み込み
    let img = load_psd_fast(path)?;
    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();

    // キャッシュに追加
    if let Ok(mut cache) = get_psd_cache().lock() {
        // メモリ制限: エントリ数を制限
        if cache.len() >= MAX_PSD_CACHE_ENTRIES {
            cache.clear();
        }
        cache.insert(path_str, (rgba.as_raw().clone(), width, height));
    }

    Ok(img)
}

#[derive(Error, Debug)]
pub enum ImageProcessError {
    #[error("Failed to read file: {0}")]
    FileRead(String),
    #[error("Failed to write file: {0}")]
    FileWrite(String),
    #[error("Failed to parse PSD: {0}")]
    PsdParse(String),
    #[error("Failed to process image: {0}")]
    ImageProcess(String),
    #[error("Invalid parameters: {0}")]
    InvalidParams(String),
}

impl From<ImageProcessError> for String {
    fn from(err: ImageProcessError) -> String {
        err.to_string()
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ResampleOptions {
    pub target_dpi: u32,
    pub source_dpi: Option<u32>, // 元のDPI（指定がなければ72と仮定）
    pub filter: Option<String>,  // "lanczos", "catmullrom", "gaussian", "nearest", "linear"
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ConversionOptions {
    pub target_color_mode: Option<String>, // "RGB", "Grayscale"
    pub target_bit_depth: Option<u8>,      // 8 or 16
    pub target_dpi: Option<u32>,
    pub remove_hidden_layers: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProcessResult {
    pub success: bool,
    pub file_path: String,
    pub changes: Vec<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BatchProcessResult {
    pub results: Vec<ProcessResult>,
    pub success_count: usize,
    pub failed_count: usize,
}

/// Get filter type from string
fn get_filter_type(filter: &str) -> FilterType {
    match filter.to_lowercase().as_str() {
        "nearest" => FilterType::Nearest,
        "linear" | "triangle" => FilterType::Triangle,
        "gaussian" => FilterType::Gaussian,
        "catmullrom" | "cubic" => FilterType::CatmullRom,
        "lanczos" | "lanczos3" => FilterType::Lanczos3,
        _ => FilterType::Lanczos3, // Default to high quality
    }
}

/// Resample a single image file (PSD composite or regular image)
#[tauri::command]
pub async fn resample_image(
    file_path: String,
    output_path: Option<String>,
    options: ResampleOptions,
) -> Result<ProcessResult, String> {
    let path = Path::new(&file_path);
    let mut changes = Vec::new();

    // Determine output path
    let out_path = output_path.unwrap_or_else(|| file_path.clone());

    // Read the file
    let file_bytes = fs::read(path).map_err(|e| ImageProcessError::FileRead(e.to_string()))?;

    // Check if it's a PSD file
    let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    let is_psd = extension.eq_ignore_ascii_case("psd") || extension.eq_ignore_ascii_case("psb");

    if is_psd {
        // Parse PSD and get composite image
        let psd = Psd::from_bytes(&file_bytes).map_err(|e| ImageProcessError::PsdParse(e.to_string()))?;

        let width = psd.width();
        let height = psd.height();

        // Get the flattened image (composite)
        let rgba = psd.rgba();

        // Create image buffer
        let img: ImageBuffer<Rgba<u8>, Vec<u8>> = ImageBuffer::from_raw(width, height, rgba)
            .ok_or_else(|| ImageProcessError::ImageProcess("Failed to create image buffer".to_string()))?;

        let dynamic_img = DynamicImage::ImageRgba8(img);

        // Get current DPI from options or assume 72
        let current_dpi = options.source_dpi.unwrap_or(72);
        let target_dpi = options.target_dpi;

        if current_dpi == target_dpi {
            return Ok(ProcessResult {
                success: true,
                file_path: out_path,
                changes: vec!["No resampling needed - DPI already matches".to_string()],
                error: None,
            });
        }

        // Calculate new dimensions based on DPI ratio
        let scale_factor = target_dpi as f64 / current_dpi as f64;
        let new_width = (width as f64 * scale_factor).round() as u32;
        let new_height = (height as f64 * scale_factor).round() as u32;

        // Get filter type
        let filter = options.filter.as_deref().unwrap_or("lanczos");
        let filter_type = get_filter_type(filter);

        // Resample the image
        let resampled = dynamic_img.resize_exact(new_width, new_height, filter_type);

        changes.push(format!(
            "Resampled: {}x{} -> {}x{} ({}dpi -> {}dpi)",
            width, height, new_width, new_height, current_dpi, target_dpi
        ));

        // Save as PNG for now (PSD writing requires more complex handling)
        let png_path = if out_path.ends_with(".psd") || out_path.ends_with(".psb") {
            format!("{}.png", out_path.trim_end_matches(".psd").trim_end_matches(".psb"))
        } else {
            out_path.clone()
        };

        resampled
            .save(&png_path)
            .map_err(|e| ImageProcessError::FileWrite(e.to_string()))?;

        changes.push(format!("Saved to: {}", png_path));

        Ok(ProcessResult {
            success: true,
            file_path: png_path,
            changes,
            error: None,
        })
    } else {
        // Handle regular image files
        let img = image::load_from_memory(&file_bytes)
            .map_err(|e| ImageProcessError::ImageProcess(e.to_string()))?;

        let (width, height) = img.dimensions();

        // Get current DPI from options or assume 72
        let current_dpi = options.source_dpi.unwrap_or(72);
        let target_dpi = options.target_dpi;

        if current_dpi == target_dpi {
            return Ok(ProcessResult {
                success: true,
                file_path: out_path,
                changes: vec!["No resampling needed".to_string()],
                error: None,
            });
        }

        let scale_factor = target_dpi as f64 / current_dpi as f64;
        let new_width = (width as f64 * scale_factor).round() as u32;
        let new_height = (height as f64 * scale_factor).round() as u32;

        let filter = options.filter.as_deref().unwrap_or("lanczos");
        let filter_type = get_filter_type(filter);

        let resampled = img.resize_exact(new_width, new_height, filter_type);

        changes.push(format!(
            "Resampled: {}x{} -> {}x{}",
            width, height, new_width, new_height
        ));

        resampled
            .save(&out_path)
            .map_err(|e| ImageProcessError::FileWrite(e.to_string()))?;

        Ok(ProcessResult {
            success: true,
            file_path: out_path,
            changes,
            error: None,
        })
    }
}

/// Batch resample multiple images
#[tauri::command]
pub async fn batch_resample_images(
    file_paths: Vec<String>,
    output_dir: Option<String>,
    options: ResampleOptions,
) -> Result<BatchProcessResult, String> {
    let mut results = Vec::new();
    let mut success_count = 0;
    let mut failed_count = 0;

    for file_path in file_paths {
        // Determine output path
        let out_path = if let Some(ref dir) = output_dir {
            let file_name = Path::new(&file_path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("output.png");
            format!("{}/{}", dir, file_name)
        } else {
            file_path.clone()
        };

        match resample_image(file_path.clone(), Some(out_path), options.clone()).await {
            Ok(result) => {
                if result.success {
                    success_count += 1;
                } else {
                    failed_count += 1;
                }
                results.push(result);
            }
            Err(e) => {
                failed_count += 1;
                results.push(ProcessResult {
                    success: false,
                    file_path,
                    changes: vec![],
                    error: Some(e),
                });
            }
        }
    }

    Ok(BatchProcessResult {
        results,
        success_count,
        failed_count,
    })
}

/// Convert image color mode (RGB to Grayscale or vice versa)
#[tauri::command]
pub async fn convert_color_mode(
    file_path: String,
    output_path: Option<String>,
    target_mode: String, // "RGB" or "Grayscale"
) -> Result<ProcessResult, String> {
    let path = Path::new(&file_path);
    let out_path = output_path.unwrap_or_else(|| file_path.clone());
    let mut changes = Vec::new();

    // Read the file
    let file_bytes = fs::read(path).map_err(|e| ImageProcessError::FileRead(e.to_string()))?;

    // Check if it's a PSD file
    let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    let is_psd = extension.eq_ignore_ascii_case("psd") || extension.eq_ignore_ascii_case("psb");

    let img = if is_psd {
        let psd = Psd::from_bytes(&file_bytes).map_err(|e| ImageProcessError::PsdParse(e.to_string()))?;
        let rgba = psd.rgba();
        let img_buf: ImageBuffer<Rgba<u8>, Vec<u8>> = ImageBuffer::from_raw(psd.width(), psd.height(), rgba)
            .ok_or_else(|| ImageProcessError::ImageProcess("Failed to create image buffer".to_string()))?;
        DynamicImage::ImageRgba8(img_buf)
    } else {
        image::load_from_memory(&file_bytes)
            .map_err(|e| ImageProcessError::ImageProcess(e.to_string()))?
    };

    let converted = match target_mode.to_uppercase().as_str() {
        "GRAYSCALE" | "GRAY" => {
            changes.push("Converted to Grayscale".to_string());
            DynamicImage::ImageLuma8(img.to_luma8())
        }
        "RGB" => {
            changes.push("Converted to RGB".to_string());
            DynamicImage::ImageRgb8(img.to_rgb8())
        }
        "RGBA" => {
            changes.push("Converted to RGBA".to_string());
            DynamicImage::ImageRgba8(img.to_rgba8())
        }
        _ => {
            return Err(ImageProcessError::InvalidParams(format!(
                "Unknown color mode: {}",
                target_mode
            ))
            .into())
        }
    };

    // Save the converted image
    let save_path = if is_psd {
        // Save as PNG for PSD files since we can't write PSD easily
        format!("{}.png", out_path.trim_end_matches(".psd").trim_end_matches(".psb"))
    } else {
        out_path.clone()
    };

    converted
        .save(&save_path)
        .map_err(|e| ImageProcessError::FileWrite(e.to_string()))?;

    changes.push(format!("Saved to: {}", save_path));

    Ok(ProcessResult {
        success: true,
        file_path: save_path,
        changes,
        error: None,
    })
}

/// Get image info without full processing
#[tauri::command]
pub async fn get_image_info(file_path: String) -> Result<serde_json::Value, String> {
    let path = Path::new(&file_path);

    let file_bytes = fs::read(path).map_err(|e| ImageProcessError::FileRead(e.to_string()))?;

    let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    let is_psd = extension.eq_ignore_ascii_case("psd") || extension.eq_ignore_ascii_case("psb");

    if is_psd {
        let psd = Psd::from_bytes(&file_bytes).map_err(|e| ImageProcessError::PsdParse(e.to_string()))?;

        Ok(serde_json::json!({
            "width": psd.width(),
            "height": psd.height(),
            "color_mode": format!("{:?}", psd.color_mode()),
            "bit_depth": format!("{:?}", psd.depth()),
            "layer_count": psd.layers().len(),
            "is_psd": true
        }))
    } else {
        let img = image::load_from_memory(&file_bytes)
            .map_err(|e| ImageProcessError::ImageProcess(e.to_string()))?;

        let (width, height) = img.dimensions();

        Ok(serde_json::json!({
            "width": width,
            "height": height,
            "color_type": format!("{:?}", img.color()),
            "is_psd": false
        }))
    }
}

impl Clone for ResampleOptions {
    fn clone(&self) -> Self {
        ResampleOptions {
            target_dpi: self.target_dpi,
            source_dpi: self.source_dpi,
            filter: self.filter.clone(),
        }
    }
}

// ============================================
// Photoshop Integration
// ============================================

#[derive(Debug, Serialize, Deserialize)]
pub struct PhotoshopConversionOptions {
    pub target_dpi: Option<u32>,
    pub target_color_mode: Option<String>,
    pub target_bit_depth: Option<u8>,
    pub remove_hidden_layers: bool,
    pub remove_alpha_channels: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PhotoshopFileSettings {
    pub path: String,
    pub needs_dpi_change: bool,
    pub needs_color_mode_change: bool,
    pub needs_bit_depth_change: bool,
    pub needs_alpha_removal: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PhotoshopConversionSettings {
    pub files: Vec<PhotoshopFileSettings>,
    pub options: PhotoshopConversionOptions,
    #[serde(rename = "outputPath")]
    pub output_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PhotoshopResult {
    #[serde(rename = "filePath")]
    pub file_path: String,
    pub success: bool,
    pub changes: Vec<String>,
    pub error: Option<String>,
}

/// Find Photoshop executable path on Windows
fn find_photoshop_path() -> Option<String> {
    // Common Photoshop installation paths on Windows
    let possible_paths = vec![
        // CC versions (newest first)
        r"C:\Program Files\Adobe\Adobe Photoshop 2026\Photoshop.exe",
        r"C:\Program Files\Adobe\Adobe Photoshop 2025\Photoshop.exe",
        r"C:\Program Files\Adobe\Adobe Photoshop 2024\Photoshop.exe",
        r"C:\Program Files\Adobe\Adobe Photoshop 2023\Photoshop.exe",
        r"C:\Program Files\Adobe\Adobe Photoshop 2022\Photoshop.exe",
        r"C:\Program Files\Adobe\Adobe Photoshop 2021\Photoshop.exe",
        r"C:\Program Files\Adobe\Adobe Photoshop 2020\Photoshop.exe",
        r"C:\Program Files\Adobe\Adobe Photoshop CC 2019\Photoshop.exe",
        r"C:\Program Files\Adobe\Adobe Photoshop CC 2018\Photoshop.exe",
        // CS versions
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

/// Check if Photoshop is installed
#[tauri::command]
pub async fn check_photoshop_installed() -> Result<serde_json::Value, String> {
    match find_photoshop_path() {
        Some(path) => Ok(serde_json::json!({
            "installed": true,
            "path": path
        })),
        None => Ok(serde_json::json!({
            "installed": false,
            "path": null
        }))
    }
}

/// Run Photoshop conversion on specified files
#[tauri::command]
pub async fn run_photoshop_conversion(
    app_handle: tauri::AppHandle,
    settings: PhotoshopConversionSettings,
) -> Result<Vec<PhotoshopResult>, String> {
    use std::process::Command;
    use std::io::Write;

    // Find Photoshop
    let ps_path = find_photoshop_path()
        .ok_or_else(|| "Photoshop not found. Please install Adobe Photoshop.".to_string())?;

    // Get the scripts directory from app resources
    let resource_path = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;

    let script_path = resource_path.join("scripts").join("convert_psd.jsx");

    // If script doesn't exist in resources, use embedded script path
    let script_path_str = if script_path.exists() {
        script_path.to_string_lossy().to_string()
    } else {
        // Fallback: look in the src-tauri/scripts directory during development
        let dev_script = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("scripts")
            .join("convert_psd.jsx");
        if dev_script.exists() {
            dev_script.to_string_lossy().to_string()
        } else {
            return Err("Conversion script not found".to_string());
        }
    };

    // Create temp directory for settings and output
    let temp_dir = std::env::temp_dir();
    let settings_path = temp_dir.join("psd_convert_settings.json");
    let output_path = temp_dir.join("psd_convert_results.json");

    // Remove old output file if exists
    let _ = fs::remove_file(&output_path);

    // Update settings with output path (use forward slashes for JSX compatibility)
    let mut settings_with_output = settings;
    settings_with_output.output_path = output_path.to_string_lossy().to_string().replace("\\", "/");

    // Convert all file paths to use forward slashes for JSX compatibility
    for file in &mut settings_with_output.files {
        file.path = file.path.replace("\\", "/");
    }

    // Write settings to temp file with UTF-8 BOM for Japanese character support
    let settings_json = serde_json::to_string_pretty(&settings_with_output)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    let mut settings_file = fs::File::create(&settings_path)
        .map_err(|e| format!("Failed to create settings file: {}", e))?;
    // Write UTF-8 BOM
    settings_file.write_all(&[0xEF, 0xBB, 0xBF])
        .map_err(|e| format!("Failed to write BOM: {}", e))?;
    settings_file.write_all(settings_json.as_bytes())
        .map_err(|e| format!("Failed to write settings: {}", e))?;

    // Log for debugging
    eprintln!("Photoshop path: {}", ps_path);
    eprintln!("Script path: {}", script_path_str);
    eprintln!("Settings path: {}", settings_path.display());
    eprintln!("Output path: {}", output_path.display());
    eprintln!("Settings JSON: {}", settings_json);

    // Run Photoshop with the script
    // Using -r flag to run script (works on Windows)
    let output = Command::new(&ps_path)
        .arg("-r")
        .arg(&script_path_str)
        .output()
        .map_err(|e| format!("Failed to run Photoshop: {}", e))?;

    eprintln!("Photoshop stdout: {}", String::from_utf8_lossy(&output.stdout));
    eprintln!("Photoshop stderr: {}", String::from_utf8_lossy(&output.stderr));
    eprintln!("Photoshop exit status: {:?}", output.status);

    // Wait for Photoshop to write results (it runs asynchronously)
    // Poll for the output file with timeout
    let max_wait_secs = 120; // 2 minutes max wait
    let poll_interval_ms = 500;
    let max_polls = (max_wait_secs * 1000) / poll_interval_ms;

    for poll in 0..max_polls {
        if output_path.exists() {
            // Check if file is not empty and complete
            if let Ok(content) = fs::read_to_string(&output_path) {
                if content.trim().starts_with('[') && content.trim().ends_with(']') {
                    eprintln!("Output file ready after {} polls", poll);
                    break;
                }
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(poll_interval_ms as u64));

        // Log progress every 10 seconds
        if poll > 0 && poll % 20 == 0 {
            eprintln!("Still waiting for Photoshop... ({} seconds)", poll * poll_interval_ms / 1000);
        }
    }

    // Read results
    if output_path.exists() {
        let results_json = fs::read_to_string(&output_path)
            .map_err(|e| format!("Failed to read results: {}", e))?;

        eprintln!("Results JSON: {}", results_json);

        let results: Vec<PhotoshopResult> = serde_json::from_str(&results_json)
            .map_err(|e| format!("Failed to parse results: {}. JSON was: {}", e, results_json))?;

        // Cleanup temp files
        let _ = fs::remove_file(&settings_path);
        let _ = fs::remove_file(&output_path);

        // Bring app window to foreground
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.set_focus();
        }

        Ok(results)
    } else {
        // Bring app window to foreground even on failure
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.set_focus();
        }
        Err("Photoshop did not produce output file. Script may have failed. Check if Photoshop opened and ran the script.".to_string())
    }
}

// ============================================
// Photoshop Guide Application
// ============================================

#[derive(Debug, Serialize, Deserialize)]
pub struct GuideInfo {
    pub direction: String,
    pub position: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GuideApplySettings {
    pub files: Vec<String>,
    pub guides: Vec<GuideInfo>,
    #[serde(rename = "outputPath")]
    pub output_path: String,
}

/// Run Photoshop to apply guides to PSD files
#[tauri::command]
pub async fn run_photoshop_guide_apply(
    app_handle: tauri::AppHandle,
    file_paths: Vec<String>,
    guides: Vec<GuideInfo>,
) -> Result<Vec<PhotoshopResult>, String> {
    use std::process::Command;
    use std::io::Write;

    let ps_path = find_photoshop_path()
        .ok_or_else(|| "Photoshop not found. Please install Adobe Photoshop.".to_string())?;

    // Resolve script path
    let resource_path = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;

    let script_path = resource_path.join("scripts").join("apply_guides.jsx");

    let script_path_str = if script_path.exists() {
        script_path.to_string_lossy().to_string()
    } else {
        let dev_script = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("scripts")
            .join("apply_guides.jsx");
        if dev_script.exists() {
            dev_script.to_string_lossy().to_string()
        } else {
            return Err("Guide apply script not found".to_string());
        }
    };

    let temp_dir = std::env::temp_dir();
    let settings_path = temp_dir.join("psd_guide_settings.json");
    let output_path = temp_dir.join("psd_guide_results.json");

    let _ = fs::remove_file(&output_path);

    // Build settings JSON
    let settings = GuideApplySettings {
        files: file_paths.iter().map(|p| p.replace("\\", "/")).collect(),
        guides,
        output_path: output_path.to_string_lossy().to_string().replace("\\", "/"),
    };

    let settings_json = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    let mut settings_file = fs::File::create(&settings_path)
        .map_err(|e| format!("Failed to create settings file: {}", e))?;
    // UTF-8 BOM for Japanese support
    settings_file.write_all(&[0xEF, 0xBB, 0xBF])
        .map_err(|e| format!("Failed to write BOM: {}", e))?;
    settings_file.write_all(settings_json.as_bytes())
        .map_err(|e| format!("Failed to write settings: {}", e))?;

    eprintln!("Guide apply - Photoshop: {}", ps_path);
    eprintln!("Guide apply - Script: {}", script_path_str);
    eprintln!("Guide apply - Files: {}", file_paths.len());

    let _output = Command::new(&ps_path)
        .arg("-r")
        .arg(&script_path_str)
        .output()
        .map_err(|e| format!("Failed to run Photoshop: {}", e))?;

    // Poll for results
    let max_wait_secs = 120;
    let poll_interval_ms = 500;
    let max_polls = (max_wait_secs * 1000) / poll_interval_ms;

    for poll in 0..max_polls {
        if output_path.exists() {
            if let Ok(content) = fs::read_to_string(&output_path) {
                if content.trim().starts_with('[') && content.trim().ends_with(']') {
                    eprintln!("Guide apply output ready after {} polls", poll);
                    break;
                }
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(poll_interval_ms as u64));

        if poll > 0 && poll % 20 == 0 {
            eprintln!("Still waiting for Photoshop... ({} seconds)", poll * poll_interval_ms / 1000);
        }
    }

    if output_path.exists() {
        let results_json = fs::read_to_string(&output_path)
            .map_err(|e| format!("Failed to read results: {}", e))?;

        let results: Vec<PhotoshopResult> = serde_json::from_str(&results_json)
            .map_err(|e| format!("Failed to parse results: {}. JSON was: {}", e, results_json))?;

        let _ = fs::remove_file(&settings_path);
        let _ = fs::remove_file(&output_path);

        // Bring app window to foreground
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.set_focus();
        }

        Ok(results)
    } else {
        // Bring app window to foreground even on failure
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.set_focus();
        }
        Err("Photoshop did not produce output file. Script may have failed.".to_string())
    }
}

// ============================================
// Photoshop Unified Prepare (Spec Fix + Guide Apply)
// ============================================

#[derive(Debug, Serialize, Deserialize)]
pub struct PrepareFileSettings {
    pub path: String,
    pub needs_dpi_change: bool,
    pub needs_color_mode_change: bool,
    pub needs_bit_depth_change: bool,
    pub needs_alpha_removal: bool,
    pub needs_guide_apply: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PrepareSettings {
    pub files: Vec<PrepareFileSettings>,
    pub options: PhotoshopConversionOptions,
    pub guides: Vec<GuideInfo>,
    #[serde(rename = "outputPath")]
    pub output_path: String,
}

/// Run Photoshop to prepare PSD files (spec fix + guide apply in one pass)
#[tauri::command]
pub async fn run_photoshop_prepare(
    app_handle: tauri::AppHandle,
    settings: PrepareSettings,
) -> Result<Vec<PhotoshopResult>, String> {
    use std::process::Command;
    use std::io::Write;

    let ps_path = find_photoshop_path()
        .ok_or_else(|| "Photoshop not found. Please install Adobe Photoshop.".to_string())?;

    let resource_path = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;

    let script_path = resource_path.join("scripts").join("prepare_psd.jsx");

    let script_path_str = if script_path.exists() {
        script_path.to_string_lossy().to_string()
    } else {
        let dev_script = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("scripts")
            .join("prepare_psd.jsx");
        if dev_script.exists() {
            dev_script.to_string_lossy().to_string()
        } else {
            return Err("Prepare script not found".to_string());
        }
    };

    let temp_dir = std::env::temp_dir();
    let settings_path = temp_dir.join("psd_prepare_settings.json");
    let output_path = temp_dir.join("psd_prepare_results.json");

    let _ = fs::remove_file(&output_path);

    // Normalize settings
    let mut settings_normalized = settings;
    settings_normalized.output_path = output_path.to_string_lossy().to_string().replace("\\", "/");
    for file in &mut settings_normalized.files {
        file.path = file.path.replace("\\", "/");
    }

    let settings_json = serde_json::to_string_pretty(&settings_normalized)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    let mut settings_file = fs::File::create(&settings_path)
        .map_err(|e| format!("Failed to create settings file: {}", e))?;
    settings_file.write_all(&[0xEF, 0xBB, 0xBF])
        .map_err(|e| format!("Failed to write BOM: {}", e))?;
    settings_file.write_all(settings_json.as_bytes())
        .map_err(|e| format!("Failed to write settings: {}", e))?;

    eprintln!("Prepare - Photoshop: {}", ps_path);
    eprintln!("Prepare - Script: {}", script_path_str);
    eprintln!("Prepare - Files: {}", settings_normalized.files.len());

    let _output = Command::new(&ps_path)
        .arg("-r")
        .arg(&script_path_str)
        .output()
        .map_err(|e| format!("Failed to run Photoshop: {}", e))?;

    // Poll for results
    let max_wait_secs = 180; // 3 minutes
    let poll_interval_ms = 500;
    let max_polls = (max_wait_secs * 1000) / poll_interval_ms;

    for poll in 0..max_polls {
        if output_path.exists() {
            if let Ok(content) = fs::read_to_string(&output_path) {
                if content.trim().starts_with('[') && content.trim().ends_with(']') {
                    eprintln!("Prepare output ready after {} polls", poll);
                    break;
                }
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(poll_interval_ms as u64));

        if poll > 0 && poll % 20 == 0 {
            eprintln!("Still waiting for Photoshop prepare... ({} seconds)", poll * poll_interval_ms / 1000);
        }
    }

    if output_path.exists() {
        let results_json = fs::read_to_string(&output_path)
            .map_err(|e| format!("Failed to read results: {}", e))?;

        let results: Vec<PhotoshopResult> = serde_json::from_str(&results_json)
            .map_err(|e| format!("Failed to parse results: {}. JSON was: {}", e, results_json))?;

        let _ = fs::remove_file(&settings_path);
        let _ = fs::remove_file(&output_path);

        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.set_focus();
        }

        Ok(results)
    } else {
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.set_focus();
        }
        Err("Photoshop did not produce output file. Script may have failed.".to_string())
    }
}

// ============================================
// Photoshop Layer Visibility Control
// ============================================

#[derive(Debug, Serialize, Deserialize)]
pub struct LayerCondition {
    #[serde(rename = "type")]
    pub condition_type: String,
    pub value: Option<String>,
    #[serde(rename = "partialMatch")]
    pub partial_match: Option<bool>,
    #[serde(rename = "caseSensitive")]
    pub case_sensitive: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LayerVisibilitySettings {
    pub files: Vec<String>,
    pub conditions: Vec<LayerCondition>,
    pub mode: String, // "hide" or "show"
    #[serde(rename = "outputPath")]
    pub output_path: String,
    #[serde(rename = "saveFolder", skip_serializing_if = "Option::is_none")]
    pub save_folder: Option<String>,
    #[serde(rename = "deleteHiddenText", skip_serializing_if = "Option::is_none")]
    pub delete_hidden_text: Option<bool>,
}

/// Run Photoshop to change layer visibility in PSD files
#[tauri::command]
pub async fn run_photoshop_layer_visibility(
    app_handle: tauri::AppHandle,
    file_paths: Vec<String>,
    conditions: Vec<LayerCondition>,
    mode: String,
    save_mode: Option<String>,
    delete_hidden_text: Option<bool>,
) -> Result<Vec<PhotoshopResult>, String> {
    use std::process::Command;
    use std::io::Write;

    let ps_path = find_photoshop_path()
        .ok_or_else(|| "Photoshop not found. Please install Adobe Photoshop.".to_string())?;

    // Resolve script path
    let resource_path = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;

    let script_path = resource_path.join("scripts").join("hide_layers.jsx");

    let script_path_str = if script_path.exists() {
        script_path.to_string_lossy().to_string()
    } else {
        let dev_script = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("scripts")
            .join("hide_layers.jsx");
        if dev_script.exists() {
            dev_script.to_string_lossy().to_string()
        } else {
            return Err("Layer visibility script not found".to_string());
        }
    };

    let temp_dir = std::env::temp_dir();
    let settings_path = temp_dir.join("psd_layer_visibility_settings.json");
    let output_path = temp_dir.join("psd_layer_visibility_results.json");

    let _ = fs::remove_file(&output_path);

    // Compute save folder for "copyToFolder" mode
    let save_folder = if save_mode.as_deref() == Some("copyToFolder") {
        let home = std::env::var("USERPROFILE")
            .unwrap_or_else(|_| std::env::var("HOME").unwrap_or_default());
        let parent_name = file_paths
            .first()
            .and_then(|p| {
                Path::new(p)
                    .parent()
                    .and_then(|par| par.file_name())
                    .map(|n| n.to_string_lossy().to_string())
            })
            .unwrap_or_else(|| "output".to_string());
        let folder = Path::new(&home)
            .join("Desktop")
            .join("Script_Output")
            .join("レイヤー制御")
            .join(&parent_name);
        let _ = fs::create_dir_all(&folder);
        Some(folder.to_string_lossy().to_string().replace("\\", "/"))
    } else {
        None
    };

    // Build settings JSON
    let settings = LayerVisibilitySettings {
        files: file_paths.iter().map(|p| p.replace("\\", "/")).collect(),
        conditions,
        mode,
        output_path: output_path.to_string_lossy().to_string().replace("\\", "/"),
        save_folder,
        delete_hidden_text,
    };

    let settings_json = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    let mut settings_file = fs::File::create(&settings_path)
        .map_err(|e| format!("Failed to create settings file: {}", e))?;
    // UTF-8 BOM for Japanese support
    settings_file.write_all(&[0xEF, 0xBB, 0xBF])
        .map_err(|e| format!("Failed to write BOM: {}", e))?;
    settings_file.write_all(settings_json.as_bytes())
        .map_err(|e| format!("Failed to write settings: {}", e))?;

    eprintln!("Layer visibility - Photoshop: {}", ps_path);
    eprintln!("Layer visibility - Script: {}", script_path_str);
    eprintln!("Layer visibility - Files: {}", file_paths.len());
    eprintln!("Layer visibility - Mode: {}", settings.mode);

    let _output = Command::new(&ps_path)
        .arg("-r")
        .arg(&script_path_str)
        .output()
        .map_err(|e| format!("Failed to run Photoshop: {}", e))?;

    // Poll for results
    let max_wait_secs = 120;
    let poll_interval_ms = 500;
    let max_polls = (max_wait_secs * 1000) / poll_interval_ms;

    for poll in 0..max_polls {
        if output_path.exists() {
            if let Ok(content) = fs::read_to_string(&output_path) {
                if content.trim().starts_with('[') && content.trim().ends_with(']') {
                    eprintln!("Layer visibility output ready after {} polls", poll);
                    break;
                }
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(poll_interval_ms as u64));

        if poll > 0 && poll % 20 == 0 {
            eprintln!("Still waiting for Photoshop... ({} seconds)", poll * poll_interval_ms / 1000);
        }
    }

    if output_path.exists() {
        let results_json = fs::read_to_string(&output_path)
            .map_err(|e| format!("Failed to read results: {}", e))?;

        let results: Vec<PhotoshopResult> = serde_json::from_str(&results_json)
            .map_err(|e| format!("Failed to parse results: {}. JSON was: {}", e, results_json))?;

        let _ = fs::remove_file(&settings_path);
        let _ = fs::remove_file(&output_path);

        // Bring app window to foreground
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.set_focus();
        }

        Ok(results)
    } else {
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.set_focus();
        }
        Err("Photoshop did not produce output file. Script may have failed.".to_string())
    }
}

// ============================================
// Photoshop Layer Organize (フォルダ格納)
// ============================================

#[derive(Debug, Serialize, Deserialize)]
struct LayerOrganizeSettings {
    files: Vec<String>,
    #[serde(rename = "targetGroupName")]
    target_group_name: String,
    #[serde(rename = "includeSpecial")]
    include_special: bool,
    #[serde(rename = "outputPath")]
    output_path: String,
    #[serde(rename = "saveFolder", skip_serializing_if = "Option::is_none")]
    save_folder: Option<String>,
}

/// Run Photoshop to organize layers into a target group
#[tauri::command]
pub async fn run_photoshop_layer_organize(
    app_handle: tauri::AppHandle,
    file_paths: Vec<String>,
    target_group_name: String,
    include_special: bool,
    save_mode: Option<String>,
) -> Result<Vec<PhotoshopResult>, String> {
    use std::process::Command;
    use std::io::Write;

    let ps_path = find_photoshop_path()
        .ok_or_else(|| "Photoshop not found. Please install Adobe Photoshop.".to_string())?;

    // Resolve script path
    let resource_path = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;

    let script_path = resource_path.join("scripts").join("organize_layers.jsx");

    let script_path_str = if script_path.exists() {
        script_path.to_string_lossy().to_string()
    } else {
        let dev_script = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("scripts")
            .join("organize_layers.jsx");
        if dev_script.exists() {
            dev_script.to_string_lossy().to_string()
        } else {
            return Err("Layer organize script not found".to_string());
        }
    };

    let temp_dir = std::env::temp_dir();
    let settings_path = temp_dir.join("psd_layer_organize_settings.json");
    let output_path = temp_dir.join("psd_layer_organize_results.json");

    let _ = fs::remove_file(&output_path);

    // Compute save folder for "copyToFolder" mode
    let save_folder = if save_mode.as_deref() == Some("copyToFolder") {
        let home = std::env::var("USERPROFILE")
            .unwrap_or_else(|_| std::env::var("HOME").unwrap_or_default());
        let parent_name = file_paths
            .first()
            .and_then(|p| {
                Path::new(p)
                    .parent()
                    .and_then(|par| par.file_name())
                    .map(|n| n.to_string_lossy().to_string())
            })
            .unwrap_or_else(|| "output".to_string());
        let folder = Path::new(&home)
            .join("Desktop")
            .join("Script_Output")
            .join("レイヤー整理")
            .join(&parent_name);
        let _ = fs::create_dir_all(&folder);
        Some(folder.to_string_lossy().to_string().replace("\\", "/"))
    } else {
        None
    };

    // Build settings JSON
    let settings = LayerOrganizeSettings {
        files: file_paths.iter().map(|p| p.replace("\\", "/")).collect(),
        target_group_name,
        include_special,
        output_path: output_path.to_string_lossy().to_string().replace("\\", "/"),
        save_folder,
    };

    let settings_json = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    let mut settings_file = fs::File::create(&settings_path)
        .map_err(|e| format!("Failed to create settings file: {}", e))?;
    settings_file.write_all(&[0xEF, 0xBB, 0xBF])
        .map_err(|e| format!("Failed to write BOM: {}", e))?;
    settings_file.write_all(settings_json.as_bytes())
        .map_err(|e| format!("Failed to write settings: {}", e))?;

    eprintln!("Layer organize - Photoshop: {}", ps_path);
    eprintln!("Layer organize - Script: {}", script_path_str);
    eprintln!("Layer organize - Files: {}", file_paths.len());

    let _output = Command::new(&ps_path)
        .arg("-r")
        .arg(&script_path_str)
        .output()
        .map_err(|e| format!("Failed to run Photoshop: {}", e))?;

    // Poll for results
    let max_wait_secs = 120;
    let poll_interval_ms = 500;
    let max_polls = (max_wait_secs * 1000) / poll_interval_ms;

    for poll in 0..max_polls {
        if output_path.exists() {
            if let Ok(content) = fs::read_to_string(&output_path) {
                if content.trim().starts_with('[') && content.trim().ends_with(']') {
                    eprintln!("Layer organize output ready after {} polls", poll);
                    break;
                }
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(poll_interval_ms as u64));

        if poll > 0 && poll % 20 == 0 {
            eprintln!("Still waiting for Photoshop... ({} seconds)", poll * poll_interval_ms / 1000);
        }
    }

    if output_path.exists() {
        let results_json = fs::read_to_string(&output_path)
            .map_err(|e| format!("Failed to read results: {}", e))?;

        let results: Vec<PhotoshopResult> = serde_json::from_str(&results_json)
            .map_err(|e| format!("Failed to parse results: {}. JSON was: {}", e, results_json))?;

        let _ = fs::remove_file(&settings_path);
        let _ = fs::remove_file(&output_path);

        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.set_focus();
        }

        Ok(results)
    } else {
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.set_focus();
        }
        Err("Photoshop did not produce output file. Script may have failed.".to_string())
    }
}

// ============================================
// Photoshop Layer Lock (レイヤーロック)
// ============================================

#[derive(Debug, Serialize, Deserialize)]
struct LayerLockSettings {
    files: Vec<String>,
    #[serde(rename = "lockBottom")]
    lock_bottom: bool,
    #[serde(rename = "unlockAll")]
    unlock_all: bool,
    #[serde(rename = "outputPath")]
    output_path: String,
    #[serde(rename = "saveFolder", skip_serializing_if = "Option::is_none")]
    save_folder: Option<String>,
}

/// Run Photoshop to lock specified layers
#[tauri::command]
pub async fn run_photoshop_layer_lock(
    app_handle: tauri::AppHandle,
    file_paths: Vec<String>,
    lock_bottom: bool,
    unlock_all: Option<bool>,
    save_mode: Option<String>,
) -> Result<Vec<PhotoshopResult>, String> {
    use std::process::Command;
    use std::io::Write;

    let ps_path = find_photoshop_path()
        .ok_or_else(|| "Photoshop not found. Please install Adobe Photoshop.".to_string())?;

    // Resolve script path
    let resource_path = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;

    let script_path = resource_path.join("scripts").join("lock_layers.jsx");

    let script_path_str = if script_path.exists() {
        script_path.to_string_lossy().to_string()
    } else {
        let dev_script = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("scripts")
            .join("lock_layers.jsx");
        if dev_script.exists() {
            dev_script.to_string_lossy().to_string()
        } else {
            return Err("Layer lock script not found".to_string());
        }
    };

    let temp_dir = std::env::temp_dir();
    let settings_path = temp_dir.join("psd_layer_lock_settings.json");
    let output_path = temp_dir.join("psd_layer_lock_results.json");

    let _ = fs::remove_file(&output_path);

    // Compute save folder for "copyToFolder" mode
    let save_folder = if save_mode.as_deref() == Some("copyToFolder") {
        let home = std::env::var("USERPROFILE")
            .unwrap_or_else(|_| std::env::var("HOME").unwrap_or_default());
        let parent_name = file_paths
            .first()
            .and_then(|p| {
                Path::new(p)
                    .parent()
                    .and_then(|par| par.file_name())
                    .map(|n| n.to_string_lossy().to_string())
            })
            .unwrap_or_else(|| "output".to_string());
        let folder = Path::new(&home)
            .join("Desktop")
            .join("Script_Output")
            .join("レイヤーロック")
            .join(&parent_name);
        let _ = fs::create_dir_all(&folder);
        Some(folder.to_string_lossy().to_string().replace("\\", "/"))
    } else {
        None
    };

    // Build settings JSON
    let settings = LayerLockSettings {
        files: file_paths.iter().map(|p| p.replace("\\", "/")).collect(),
        lock_bottom,
        unlock_all: unlock_all.unwrap_or(false),
        output_path: output_path.to_string_lossy().to_string().replace("\\", "/"),
        save_folder,
    };

    let settings_json = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    let mut settings_file = fs::File::create(&settings_path)
        .map_err(|e| format!("Failed to create settings file: {}", e))?;
    settings_file.write_all(&[0xEF, 0xBB, 0xBF])
        .map_err(|e| format!("Failed to write BOM: {}", e))?;
    settings_file.write_all(settings_json.as_bytes())
        .map_err(|e| format!("Failed to write settings: {}", e))?;

    eprintln!("Layer lock - Photoshop: {}", ps_path);
    eprintln!("Layer lock - Script: {}", script_path_str);
    eprintln!("Layer lock - Files: {}", file_paths.len());

    let _output = Command::new(&ps_path)
        .arg("-r")
        .arg(&script_path_str)
        .output()
        .map_err(|e| format!("Failed to run Photoshop: {}", e))?;

    // Poll for results
    let max_wait_secs = 120;
    let poll_interval_ms = 500;
    let max_polls = (max_wait_secs * 1000) / poll_interval_ms;

    for poll in 0..max_polls {
        if output_path.exists() {
            if let Ok(content) = fs::read_to_string(&output_path) {
                if content.trim().starts_with('[') && content.trim().ends_with(']') {
                    eprintln!("Layer lock output ready after {} polls", poll);
                    break;
                }
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(poll_interval_ms as u64));

        if poll > 0 && poll % 20 == 0 {
            eprintln!("Still waiting for Photoshop... ({} seconds)", poll * poll_interval_ms / 1000);
        }
    }

    if output_path.exists() {
        let results_json = fs::read_to_string(&output_path)
            .map_err(|e| format!("Failed to read results: {}", e))?;

        let results: Vec<PhotoshopResult> = serde_json::from_str(&results_json)
            .map_err(|e| format!("Failed to parse results: {}. JSON was: {}", e, results_json))?;

        let _ = fs::remove_file(&settings_path);
        let _ = fs::remove_file(&output_path);

        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.set_focus();
        }

        Ok(results)
    } else {
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.set_focus();
        }
        Err("Photoshop did not produce output file. Script may have failed.".to_string())
    }
}

// ============================================
// Photoshop Layer Move (条件ベース レイヤー整理)
// ============================================

#[derive(Debug, Serialize, Deserialize)]
pub struct LayerMoveConditions {
    #[serde(rename = "textLayer")]
    pub text_layer: bool,
    #[serde(rename = "subgroupTop")]
    pub subgroup_top: bool,
    #[serde(rename = "subgroupBottom")]
    pub subgroup_bottom: bool,
    #[serde(rename = "nameEnabled")]
    pub name_enabled: bool,
    #[serde(rename = "namePattern")]
    pub name_pattern: String,
    #[serde(rename = "namePartial")]
    pub name_partial: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct LayerMoveSettings {
    files: Vec<String>,
    #[serde(rename = "targetGroupName")]
    target_group_name: String,
    #[serde(rename = "createIfMissing")]
    create_if_missing: bool,
    #[serde(rename = "searchScope")]
    search_scope: String,
    #[serde(rename = "searchGroupName")]
    search_group_name: String,
    conditions: LayerMoveConditions,
    #[serde(rename = "outputPath")]
    output_path: String,
    #[serde(rename = "saveFolder", skip_serializing_if = "Option::is_none")]
    save_folder: Option<String>,
}

/// Run Photoshop to move layers by conditions into a target group
#[tauri::command]
pub async fn run_photoshop_layer_move(
    app_handle: tauri::AppHandle,
    file_paths: Vec<String>,
    target_group_name: String,
    create_if_missing: bool,
    search_scope: String,
    search_group_name: String,
    conditions: LayerMoveConditions,
    save_mode: Option<String>,
) -> Result<Vec<PhotoshopResult>, String> {
    use std::process::Command;
    use std::io::Write;

    let ps_path = find_photoshop_path()
        .ok_or_else(|| "Photoshop not found. Please install Adobe Photoshop.".to_string())?;

    // Resolve script path
    let resource_path = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;

    let script_path = resource_path.join("scripts").join("move_layers.jsx");

    let script_path_str = if script_path.exists() {
        script_path.to_string_lossy().to_string()
    } else {
        let dev_script = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("scripts")
            .join("move_layers.jsx");
        if dev_script.exists() {
            dev_script.to_string_lossy().to_string()
        } else {
            return Err("Layer move script not found".to_string());
        }
    };

    let temp_dir = std::env::temp_dir();
    let settings_path = temp_dir.join("psd_layer_move_settings.json");
    let output_path = temp_dir.join("psd_layer_move_results.json");

    let _ = fs::remove_file(&output_path);

    // Compute save folder for "copyToFolder" mode
    let save_folder = if save_mode.as_deref() == Some("copyToFolder") {
        let home = std::env::var("USERPROFILE")
            .unwrap_or_else(|_| std::env::var("HOME").unwrap_or_default());
        let parent_name = file_paths
            .first()
            .and_then(|p| {
                Path::new(p)
                    .parent()
                    .and_then(|par| par.file_name())
                    .map(|n| n.to_string_lossy().to_string())
            })
            .unwrap_or_else(|| "output".to_string());
        let folder = Path::new(&home)
            .join("Desktop")
            .join("Script_Output")
            .join("レイヤー整理")
            .join(&parent_name);
        let _ = fs::create_dir_all(&folder);
        Some(folder.to_string_lossy().to_string().replace("\\", "/"))
    } else {
        None
    };

    // Build settings JSON
    let settings = LayerMoveSettings {
        files: file_paths.iter().map(|p| p.replace("\\", "/")).collect(),
        target_group_name,
        create_if_missing,
        search_scope,
        search_group_name,
        conditions,
        output_path: output_path.to_string_lossy().to_string().replace("\\", "/"),
        save_folder,
    };

    let settings_json = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    let mut settings_file = fs::File::create(&settings_path)
        .map_err(|e| format!("Failed to create settings file: {}", e))?;
    settings_file.write_all(&[0xEF, 0xBB, 0xBF])
        .map_err(|e| format!("Failed to write BOM: {}", e))?;
    settings_file.write_all(settings_json.as_bytes())
        .map_err(|e| format!("Failed to write settings: {}", e))?;

    eprintln!("Layer move - Photoshop: {}", ps_path);
    eprintln!("Layer move - Script: {}", script_path_str);
    eprintln!("Layer move - Files: {}", file_paths.len());

    let _output = Command::new(&ps_path)
        .arg("-r")
        .arg(&script_path_str)
        .output()
        .map_err(|e| format!("Failed to run Photoshop: {}", e))?;

    // Poll for results
    let max_wait_secs = 120;
    let poll_interval_ms = 500;
    let max_polls = (max_wait_secs * 1000) / poll_interval_ms;

    for poll in 0..max_polls {
        if output_path.exists() {
            if let Ok(content) = fs::read_to_string(&output_path) {
                if content.trim().starts_with('[') && content.trim().ends_with(']') {
                    eprintln!("Layer move output ready after {} polls", poll);
                    break;
                }
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(poll_interval_ms as u64));

        if poll > 0 && poll % 20 == 0 {
            eprintln!("Still waiting for Photoshop... ({} seconds)", poll * poll_interval_ms / 1000);
        }
    }

    if output_path.exists() {
        let results_json = fs::read_to_string(&output_path)
            .map_err(|e| format!("Failed to read results: {}", e))?;

        let results: Vec<PhotoshopResult> = serde_json::from_str(&results_json)
            .map_err(|e| format!("Failed to parse results: {}. JSON was: {}", e, results_json))?;

        let _ = fs::remove_file(&settings_path);
        let _ = fs::remove_file(&output_path);

        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.set_focus();
        }

        Ok(results)
    } else {
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.set_focus();
        }
        Err("Photoshop did not produce output file. Script may have failed.".to_string())
    }
}

// ============================================
// Photoshop Split Processing
// ============================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SplitFileInfo {
    pub path: String,
    #[serde(rename = "pdfPageIndex")]
    pub pdf_page_index: i32, // -1 = not a PDF page
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SplitSettings {
    pub files: Vec<SplitFileInfo>,
    pub mode: String, // "even", "uneven", "none"
    #[serde(rename = "outputFormat")]
    pub output_format: String, // "psd", "jpg"
    #[serde(rename = "jpgQuality")]
    pub jpg_quality: u8,
    #[serde(rename = "selectionLeft")]
    pub selection_left: i32,
    #[serde(rename = "selectionRight")]
    pub selection_right: i32,
    #[serde(rename = "pageNumbering")]
    pub page_numbering: String, // "rl", "sequential"
    #[serde(rename = "firstPageBlank")]
    pub first_page_blank: bool,
    #[serde(rename = "lastPageBlank")]
    pub last_page_blank: bool,
    #[serde(rename = "customBaseName")]
    pub custom_base_name: String,
    #[serde(rename = "deleteHiddenLayers")]
    pub delete_hidden_layers: bool,
    #[serde(rename = "deleteOffCanvasText")]
    pub delete_off_canvas_text: bool,
    #[serde(rename = "outputDir")]
    pub output_dir: String,
    #[serde(rename = "outputPath")]
    pub output_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SplitResponse {
    pub results: Vec<PhotoshopResult>,
    #[serde(rename = "outputDir")]
    pub output_dir: String,
}

/// Run Photoshop to split spread pages
#[tauri::command]
pub async fn run_photoshop_split(
    app_handle: tauri::AppHandle,
    file_infos: Vec<SplitFileInfo>,
    mode: String,
    output_format: String,
    jpg_quality: u8,
    selection_left: i32,
    selection_right: i32,
    page_numbering: String,
    first_page_blank: bool,
    last_page_blank: bool,
    custom_base_name: String,
    delete_hidden_layers: bool,
    delete_off_canvas_text: bool,
    output_dir: String,
) -> Result<SplitResponse, String> {
    use std::process::Command;
    use std::io::Write;

    let ps_path = find_photoshop_path()
        .ok_or_else(|| "Photoshop not found. Please install Adobe Photoshop.".to_string())?;

    let resource_path = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;

    let script_path = resource_path.join("scripts").join("split_psd.jsx");

    let script_path_str = if script_path.exists() {
        script_path.to_string_lossy().to_string()
    } else {
        let dev_script = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("scripts")
            .join("split_psd.jsx");
        if dev_script.exists() {
            dev_script.to_string_lossy().to_string()
        } else {
            return Err("Split script not found".to_string());
        }
    };

    let temp_dir = std::env::temp_dir();

    // スクリプトをtempにコピー（日本語パスのDDE転送問題を回避）
    let temp_script = temp_dir.join("split_psd_temp.jsx");
    fs::copy(&script_path_str, &temp_script)
        .map_err(|e| format!("Failed to copy script to temp: {}", e))?;
    let script_to_run = temp_script.to_string_lossy().to_string();

    let settings_path = temp_dir.join("psd_split_settings.json");
    let output_path = temp_dir.join("psd_split_results.json");

    let _ = fs::remove_file(&output_path);

    // 出力先フォルダが既存なら連番で新規作成
    let final_output_dir = {
        let base_path = Path::new(&output_dir);
        if base_path.exists() {
            let base = output_dir.clone();
            let mut counter = 1;
            loop {
                let candidate = format!("{} ({})", base, counter);
                if !Path::new(&candidate).exists() {
                    break candidate;
                }
                counter += 1;
            }
        } else {
            output_dir.clone()
        }
    };

    eprintln!("Split - Output dir: {}", final_output_dir);

    let settings = SplitSettings {
        files: file_infos.iter().map(|fi| SplitFileInfo {
            path: fi.path.replace("\\", "/"),
            pdf_page_index: fi.pdf_page_index,
        }).collect(),
        mode,
        output_format,
        jpg_quality,
        selection_left,
        selection_right,
        page_numbering,
        first_page_blank,
        last_page_blank,
        custom_base_name,
        delete_hidden_layers,
        delete_off_canvas_text,
        output_dir: final_output_dir.replace("\\", "/"),
        output_path: output_path.to_string_lossy().to_string().replace("\\", "/"),
    };

    let settings_json = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    let mut settings_file = fs::File::create(&settings_path)
        .map_err(|e| format!("Failed to create settings file: {}", e))?;
    settings_file.write_all(&[0xEF, 0xBB, 0xBF])
        .map_err(|e| format!("Failed to write BOM: {}", e))?;
    settings_file.write_all(settings_json.as_bytes())
        .map_err(|e| format!("Failed to write settings: {}", e))?;
    drop(settings_file);

    eprintln!("Split - Photoshop: {}", ps_path);
    eprintln!("Split - Script (source): {}", script_path_str);
    eprintln!("Split - Script (temp): {}", script_to_run);
    eprintln!("Split - Files: {}", file_infos.len());
    eprintln!("Split - Mode: {}", settings.mode);
    eprintln!("Split - Settings path: {}", settings_path.display());

    // spawn() で即座にリターン（output() だと PS が開いている間ブロックする）
    let _child = Command::new(&ps_path)
        .arg("-r")
        .arg(&script_to_run)
        .spawn()
        .map_err(|e| format!("Failed to run Photoshop: {}", e))?;

    eprintln!("Split - Photoshop launched, polling for results...");

    // Poll for results (split takes longer per file)
    let max_wait_secs = 300; // 5 minutes for split
    let poll_interval_ms = 500;
    let max_polls = (max_wait_secs * 1000) / poll_interval_ms;

    for poll in 0..max_polls {
        if output_path.exists() {
            if let Ok(content) = fs::read_to_string(&output_path) {
                if content.trim().starts_with('[') && content.trim().ends_with(']') {
                    eprintln!("Split output ready after {} polls", poll);
                    break;
                }
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(poll_interval_ms as u64));

        if poll > 0 && poll % 20 == 0 {
            eprintln!("Still waiting for Photoshop split... ({} seconds)", poll * poll_interval_ms / 1000);
        }
    }

    if output_path.exists() {
        let results_json = fs::read_to_string(&output_path)
            .map_err(|e| format!("Failed to read results: {}", e))?;

        let results: Vec<PhotoshopResult> = serde_json::from_str(&results_json)
            .map_err(|e| format!("Failed to parse results: {}. JSON was: {}", e, results_json))?;

        let _ = fs::remove_file(&settings_path);
        let _ = fs::remove_file(&output_path);
        let _ = fs::remove_file(&temp_script);

        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.set_focus();
        }

        Ok(SplitResponse { results, output_dir: final_output_dir.clone() })
    } else {
        let _ = fs::remove_file(&temp_script);
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.set_focus();
        }
        Err("Photoshop did not produce output file. Script may have failed.".to_string())
    }
}

// ============================================
// Fast PSD Loading (from tachimi_standalone)
// ============================================

/// PSDファイルを高速読み込み
/// まずフラット化画像を試し、失敗したらpsd crateにフォールバック
fn load_psd_fast(path: &Path) -> Result<DynamicImage, String> {
    match load_psd_composite(path) {
        Ok(img) => Ok(img),
        Err(_) => {
            // フォールバック: psd crateでレイヤー合成（遅いが確実）
            let bytes = fs::read(path).map_err(|e| format!("Failed to read file: {}", e))?;
            let psd = Psd::from_bytes(&bytes).map_err(|e| format!("Failed to parse PSD: {}", e))?;
            let width = psd.width();
            let height = psd.height();
            let rgba = psd.rgba();
            let img: RgbaImage = ImageBuffer::from_raw(width, height, rgba)
                .ok_or_else(|| "Failed to create image buffer".to_string())?;
            Ok(DynamicImage::ImageRgba8(img))
        }
    }
}

/// PSDファイルのImage Dataセクションを直接読み込む（高速版）
/// Photoshopの「互換性を最大に」で保存されたPSDには合成済み画像が含まれている
fn load_psd_composite(path: &Path) -> Result<DynamicImage, String> {
    let file = File::open(path).map_err(|e| format!("Failed to open file: {}", e))?;
    let mut file = BufReader::with_capacity(64 * 1024, file);
    let mut buf4 = [0u8; 4];
    let mut buf2 = [0u8; 2];

    // === Header (26 bytes) ===
    file.read_exact(&mut buf4).map_err(|e| format!("PSD read error: {}", e))?;
    if &buf4 != b"8BPS" {
        return Err("Invalid PSD file".to_string());
    }

    // Version
    file.read_exact(&mut buf2).map_err(|e| format!("PSD read error: {}", e))?;
    let version = u16::from_be_bytes(buf2);
    if version != 1 && version != 2 {
        return Err("Unsupported PSD version".to_string());
    }

    // Reserved (6 bytes)
    file.seek(SeekFrom::Current(6)).map_err(|e| format!("Seek error: {}", e))?;

    // Channels
    file.read_exact(&mut buf2).map_err(|e| format!("PSD read error: {}", e))?;
    let channels = u16::from_be_bytes(buf2) as usize;

    // Height
    file.read_exact(&mut buf4).map_err(|e| format!("PSD read error: {}", e))?;
    let height = u32::from_be_bytes(buf4);

    // Width
    file.read_exact(&mut buf4).map_err(|e| format!("PSD read error: {}", e))?;
    let width = u32::from_be_bytes(buf4);

    // Depth
    file.read_exact(&mut buf2).map_err(|e| format!("PSD read error: {}", e))?;
    let depth = u16::from_be_bytes(buf2);
    if depth != 8 {
        return Err(format!("Unsupported bit depth: {}", depth));
    }

    // Color Mode
    file.read_exact(&mut buf2).map_err(|e| format!("PSD read error: {}", e))?;
    let color_mode = u16::from_be_bytes(buf2);
    if color_mode != 3 && color_mode != 1 {
        return Err(format!("Unsupported color mode: {} (RGB/Grayscale only)", color_mode));
    }

    // === Color Mode Data Section ===
    file.read_exact(&mut buf4).map_err(|e| format!("PSD read error: {}", e))?;
    let color_mode_len = u32::from_be_bytes(buf4);
    file.seek(SeekFrom::Current(color_mode_len as i64)).map_err(|e| format!("Seek error: {}", e))?;

    // === Image Resources Section ===
    file.read_exact(&mut buf4).map_err(|e| format!("PSD read error: {}", e))?;
    let resources_len = u32::from_be_bytes(buf4);
    file.seek(SeekFrom::Current(resources_len as i64)).map_err(|e| format!("Seek error: {}", e))?;

    // === Layer and Mask Information Section ===
    if version == 2 {
        let mut buf8 = [0u8; 8];
        file.read_exact(&mut buf8).map_err(|e| format!("PSD read error: {}", e))?;
        let layer_len = u64::from_be_bytes(buf8);
        file.seek(SeekFrom::Current(layer_len as i64)).map_err(|e| format!("Seek error: {}", e))?;
    } else {
        file.read_exact(&mut buf4).map_err(|e| format!("PSD read error: {}", e))?;
        let layer_len = u32::from_be_bytes(buf4);
        file.seek(SeekFrom::Current(layer_len as i64)).map_err(|e| format!("Seek error: {}", e))?;
    }

    // === Image Data Section ===
    file.read_exact(&mut buf2).map_err(|e| format!("PSD read error: {}", e))?;
    let compression = u16::from_be_bytes(buf2);

    let pixels = (width as usize) * (height as usize);
    let num_channels = channels.min(4);

    match compression {
        0 => {
            // Raw (uncompressed)
            let mut channel_data = vec![vec![0u8; pixels]; num_channels];
            for ch in 0..num_channels {
                file.read_exact(&mut channel_data[ch]).map_err(|e| format!("Image data read error: {}", e))?;
            }
            channels_to_rgba(channel_data, width, height, color_mode)
        }
        1 => {
            // RLE compressed
            decode_rle_image(&mut file, width, height, num_channels, color_mode, version)
        }
        _ => {
            Err(format!("Unsupported compression: {}", compression))
        }
    }
}

/// RLE圧縮された画像データをデコード
fn decode_rle_image<R: Read>(
    file: &mut R,
    width: u32,
    height: u32,
    num_channels: usize,
    color_mode: u16,
    version: u16,
) -> Result<DynamicImage, String> {
    let rows = height as usize;
    let pixels = (width as usize) * rows;

    // 各チャンネルの各行のバイト数を読み取る
    let total_rows = rows * num_channels;
    let mut row_lengths = vec![0u16; total_rows];

    if version == 2 {
        let mut buf4 = [0u8; 4];
        for i in 0..total_rows {
            file.read_exact(&mut buf4).map_err(|e| format!("Row length read error: {}", e))?;
            row_lengths[i] = u32::from_be_bytes(buf4) as u16;
        }
    } else {
        let mut buf2 = [0u8; 2];
        for i in 0..total_rows {
            file.read_exact(&mut buf2).map_err(|e| format!("Row length read error: {}", e))?;
            row_lengths[i] = u16::from_be_bytes(buf2);
        }
    }

    // 各チャンネルをデコード
    let mut channel_data = vec![vec![0u8; pixels]; num_channels];

    for ch in 0..num_channels {
        for row in 0..rows {
            let row_idx = ch * rows + row;
            let row_len = row_lengths[row_idx] as usize;

            let mut compressed = vec![0u8; row_len];
            file.read_exact(&mut compressed).map_err(|e| format!("RLE data read error: {}", e))?;

            let row_start = row * width as usize;
            let row_data = &mut channel_data[ch][row_start..row_start + width as usize];
            decode_packbits(&compressed, row_data);
        }
    }

    channels_to_rgba(channel_data, width, height, color_mode)
}

/// PackBits RLEデコード
fn decode_packbits(input: &[u8], output: &mut [u8]) {
    let mut i = 0;
    let mut o = 0;

    while i < input.len() && o < output.len() {
        let n = input[i] as i8;
        i += 1;

        if n >= 0 {
            // Literal: copy n+1 bytes
            let count = (n as usize) + 1;
            let end = (o + count).min(output.len());
            let src_end = (i + count).min(input.len());
            let copy_len = (end - o).min(src_end - i);
            output[o..o + copy_len].copy_from_slice(&input[i..i + copy_len]);
            i += count;
            o += count;
        } else if n > -128 {
            // Repeat: repeat next byte (-n+1) times
            let count = (-n as usize) + 1;
            if i < input.len() {
                let val = input[i];
                i += 1;
                let end = (o + count).min(output.len());
                for j in o..end {
                    output[j] = val;
                }
                o += count;
            }
        }
    }
}

/// チャンネルデータをRGBA画像に変換
fn channels_to_rgba(channel_data: Vec<Vec<u8>>, width: u32, height: u32, color_mode: u16) -> Result<DynamicImage, String> {
    let pixels = (width as usize) * (height as usize);
    let mut rgba = vec![255u8; pixels * 4];

    match color_mode {
        3 => {
            // RGB
            for i in 0..pixels {
                rgba[i * 4] = channel_data.get(0).map(|c| c[i]).unwrap_or(0);
                rgba[i * 4 + 1] = channel_data.get(1).map(|c| c[i]).unwrap_or(0);
                rgba[i * 4 + 2] = channel_data.get(2).map(|c| c[i]).unwrap_or(0);
                rgba[i * 4 + 3] = channel_data.get(3).map(|c| c[i]).unwrap_or(255);
            }
        }
        1 => {
            // Grayscale
            for i in 0..pixels {
                let gray = channel_data.get(0).map(|c| c[i]).unwrap_or(0);
                rgba[i * 4] = gray;
                rgba[i * 4 + 1] = gray;
                rgba[i * 4 + 2] = gray;
                rgba[i * 4 + 3] = channel_data.get(1).map(|c| c[i]).unwrap_or(255);
            }
        }
        _ => {}
    }

    let img: RgbaImage = ImageBuffer::from_raw(width, height, rgba)
        .ok_or_else(|| format!("Failed to create RGBA image ({}x{})", width, height))?;
    Ok(DynamicImage::ImageRgba8(img))
}

// ============================================
// High Resolution Preview for Guide Editor
// ============================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HighResPreviewResult {
    pub file_path: String,
    pub original_width: u32,
    pub original_height: u32,
    pub preview_width: u32,
    pub preview_height: u32,
}

/// Generate a high-resolution preview image for the guide editor
/// Returns the path to a temporary JPEG file that can be loaded via asset:// protocol
#[tauri::command]
pub async fn get_high_res_preview(
    file_path: String,
    max_size: u32,
) -> Result<HighResPreviewResult, String> {
    // Run blocking operations in a separate thread to prevent UI freeze
    tokio::task::spawn_blocking(move || {
        get_high_res_preview_sync(&file_path, max_size)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

/// Synchronous version of get_high_res_preview (runs in blocking thread)
/// 3層キャッシュ: メモリ → ディスク → フル生成
fn get_high_res_preview_sync(file_path: &str, max_size: u32) -> Result<HighResPreviewResult, String> {
    let path = Path::new(file_path);

    // ファイル更新日時でキャッシュ無効化を管理
    let modified_secs = get_file_modified_secs(path);

    let original_name = path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("preview");

    // 決定論的キャッシュキー（ファイル更新時に自動無効化）
    let cache_key = format!("{}_{}_{}", file_path, modified_secs, max_size);

    // ===== Layer 1: メモリキャッシュ（~0ms） =====
    if let Ok(cache) = get_preview_result_cache().lock() {
        if let Some(cached_result) = cache.get(&cache_key) {
            if Path::new(&cached_result.file_path).exists() {
                return Ok(cached_result.clone());
            }
        }
    }

    // ===== Layer 2: ディスクキャッシュ（~5-10ms） =====
    let temp_dir = std::env::temp_dir();
    let preview_filename = format!(
        "manga_psd_preview_{}_{}_{}.jpg",
        original_name, modified_secs, max_size
    );
    let preview_path = temp_dir.join(&preview_filename);

    if preview_path.exists() {
        let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        let is_psd = extension.eq_ignore_ascii_case("psd") || extension.eq_ignore_ascii_case("psb");

        let (original_width, original_height) = if is_psd {
            read_psd_dimensions(path)?
        } else {
            image::image_dimensions(path)
                .map_err(|e| format!("Failed to read image dimensions: {}", e))?
        };

        let (preview_width, preview_height) = image::image_dimensions(&preview_path)
            .map_err(|e| format!("Failed to read preview dimensions: {}", e))?;

        let result = HighResPreviewResult {
            file_path: preview_path.to_string_lossy().to_string(),
            original_width,
            original_height,
            preview_width,
            preview_height,
        };

        // メモリキャッシュに追加
        if let Ok(mut cache) = get_preview_result_cache().lock() {
            if cache.len() >= MAX_PREVIEW_CACHE_ENTRIES {
                cache.clear();
            }
            cache.insert(cache_key, result.clone());
        }

        return Ok(result);
    }

    // ===== Layer 3: フル生成 =====
    let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    let is_psd = extension.eq_ignore_ascii_case("psd") || extension.eq_ignore_ascii_case("psb");

    let (img, original_width, original_height) = if is_psd {
        let img = get_or_cache_psd(path)?;
        let (width, height) = img.dimensions();
        (img, width, height)
    } else {
        let file_bytes = fs::read(path)
            .map_err(|e| format!("Failed to read file: {}", e))?;
        let img = image::load_from_memory(&file_bytes)
            .map_err(|e| format!("Failed to load image: {}", e))?;
        let (width, height) = img.dimensions();
        (img, width, height)
    };

    // Triangleフィルタでリサイズ（高速、ガイド配置には十分な品質）
    let resized = img.resize(max_size, max_size, FilterType::Triangle);
    let (preview_width, preview_height) = resized.dimensions();

    // JPEG品質85で保存（速度と品質のバランス）
    use image::codecs::jpeg::JpegEncoder;
    let file = File::create(&preview_path)
        .map_err(|e| format!("Failed to create preview file: {}", e))?;
    let mut writer = std::io::BufWriter::new(file);
    let encoder = JpegEncoder::new_with_quality(&mut writer, 85);
    resized.write_with_encoder(encoder)
        .map_err(|e| format!("Failed to encode preview JPEG: {}", e))?;

    let result = HighResPreviewResult {
        file_path: preview_path.to_string_lossy().to_string(),
        original_width,
        original_height,
        preview_width,
        preview_height,
    };

    // メモリキャッシュに追加
    if let Ok(mut cache) = get_preview_result_cache().lock() {
        if cache.len() >= MAX_PREVIEW_CACHE_ENTRIES {
            cache.clear();
        }
        cache.insert(cache_key, result.clone());
    }

    Ok(result)
}

/// Clean up old temporary files from temp directory
#[tauri::command]
pub async fn cleanup_preview_files() -> Result<u32, String> {
    cleanup_temp_files(86400)
}

/// Internal cleanup logic. Removes temp files older than `max_age_secs`.
/// Called from the periodic command and from the app exit handler.
pub fn cleanup_temp_files(max_age_secs: u64) -> Result<u32, String> {
    let temp_dir = std::env::temp_dir();
    let mut cleaned_count = 0u32;

    if let Ok(entries) = fs::read_dir(&temp_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(filename) = path.file_name().and_then(|s| s.to_str()) {
                let should_clean =
                    // Preview cache files (PSD + PDF)
                    (filename.starts_with("manga_psd_preview_") && filename.ends_with(".jpg"))
                    || (filename.starts_with("manga_pdf_preview_") && filename.ends_with(".jpg"))
                    // Orphaned Photoshop communication files
                    || (filename.starts_with("psd_") && filename.ends_with(".json"))
                    // Orphaned temp script copies
                    || (filename.ends_with("_temp.jsx"));

                if should_clean {
                    if let Ok(metadata) = fs::metadata(&path) {
                        if let Ok(modified) = metadata.modified() {
                            if let Ok(age) = SystemTime::now().duration_since(modified) {
                                if age.as_secs() > max_age_secs {
                                    if fs::remove_file(&path).is_ok() {
                                        cleaned_count += 1;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(cleaned_count)
}

// ============================================
// PDF Support
// ============================================

#[derive(Debug, Clone, Serialize)]
pub struct PdfInfoResult {
    pub page_count: usize,
    pub pages: Vec<PdfPageInfoResult>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PdfPageInfoResult {
    pub width: u32,
    pub height: u32,
}

/// Get PDF page count and dimensions
#[tauri::command]
pub async fn get_pdf_info(file_path: String) -> Result<PdfInfoResult, String> {
    tokio::task::spawn_blocking(move || {
        let info = crate::pdf::get_pdf_info_sync(&file_path)?;
        Ok(PdfInfoResult {
            page_count: info.page_count,
            pages: info.pages.iter().map(|p| PdfPageInfoResult {
                width: p.width_px,
                height: p.height_px,
            }).collect(),
        })
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

/// Generate a high-res preview for a PDF page (same result format as PSD preview)
#[tauri::command]
pub async fn get_pdf_preview(
    file_path: String,
    page_index: usize,
    max_size: u32,
) -> Result<HighResPreviewResult, String> {
    tokio::task::spawn_blocking(move || {
        let path = Path::new(&file_path);
        let modified_secs = get_file_modified_secs(path);
        let original_name = path.file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("pdf_preview");

        // Cache key includes page index
        let cache_key = format!("{}_{}_{}_{}", file_path, modified_secs, page_index, max_size);

        // Check memory cache
        if let Ok(cache) = get_preview_result_cache().lock() {
            if let Some(cached) = cache.get(&cache_key) {
                if Path::new(&cached.file_path).exists() {
                    return Ok(cached.clone());
                }
            }
        }

        // Check disk cache
        let temp_dir = std::env::temp_dir();
        let preview_filename = format!(
            "manga_pdf_preview_{}_{}_p{}_{}.jpg",
            original_name, modified_secs, page_index, max_size
        );
        let preview_path = temp_dir.join(&preview_filename);

        if preview_path.exists() {
            let (img, original_width, original_height) =
                crate::pdf::render_pdf_page_sync(&file_path, page_index, max_size)?;
            let (preview_width, preview_height) = image::image_dimensions(&preview_path)
                .unwrap_or((img.width(), img.height()));

            let result = HighResPreviewResult {
                file_path: preview_path.to_string_lossy().to_string(),
                original_width,
                original_height,
                preview_width,
                preview_height,
            };

            if let Ok(mut cache) = get_preview_result_cache().lock() {
                if cache.len() >= MAX_PREVIEW_CACHE_ENTRIES {
                    cache.clear();
                }
                cache.insert(cache_key, result.clone());
            }

            return Ok(result);
        }

        // Full generation
        let (img, original_width, original_height) =
            crate::pdf::render_pdf_page_sync(&file_path, page_index, max_size)?;

        let resized = img.resize(max_size, max_size, FilterType::Triangle);
        let (preview_width, preview_height) = resized.dimensions();

        // Save to disk cache
        use image::codecs::jpeg::JpegEncoder;
        let file = File::create(&preview_path)
            .map_err(|e| format!("Failed to create PDF preview file: {}", e))?;
        let mut writer = std::io::BufWriter::new(file);
        let encoder = JpegEncoder::new_with_quality(&mut writer, 85);
        resized.write_with_encoder(encoder)
            .map_err(|e| format!("Failed to encode PDF preview JPEG: {}", e))?;

        let result = HighResPreviewResult {
            file_path: preview_path.to_string_lossy().to_string(),
            original_width,
            original_height,
            preview_width,
            preview_height,
        };

        if let Ok(mut cache) = get_preview_result_cache().lock() {
            if cache.len() >= MAX_PREVIEW_CACHE_ENTRIES {
                cache.clear();
            }
            cache.insert(cache_key, result.clone());
        }

        Ok(result)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

/// Generate a small thumbnail for a PDF page (returns base64 JPEG)
#[tauri::command]
pub async fn get_pdf_thumbnail(
    file_path: String,
    page_index: usize,
    max_size: u32,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let (img, _original_width, _original_height) =
            crate::pdf::render_pdf_page_sync(&file_path, page_index, max_size)?;

        let resized = img.resize(max_size, max_size, FilterType::Triangle);

        // Encode to JPEG in memory
        use image::codecs::jpeg::JpegEncoder;
        let mut buffer = Vec::new();
        let mut cursor = std::io::Cursor::new(&mut buffer);
        let encoder = JpegEncoder::new_with_quality(&mut cursor, 75);
        resized.write_with_encoder(encoder)
            .map_err(|e| format!("Failed to encode thumbnail: {}", e))?;

        drop(cursor);
        Ok(base64_encode(&buffer))
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

/// Simple base64 encoder (no external dependency)
fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity(data.len() * 4 / 3 + 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let n = (b0 << 16) | (b1 << 8) | b2;
        result.push(CHARS[((n >> 18) & 0x3F) as usize] as char);
        result.push(CHARS[((n >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            result.push(CHARS[((n >> 6) & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(CHARS[(n & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
    }
    result
}

// ============================================
// Layer Replacement (差替え)
// ============================================

/// 自然順ソート用のキー生成
fn natural_sort_key(s: &str) -> Vec<(bool, String)> {
    let mut result = Vec::new();
    let mut current = String::new();
    let mut in_digit = false;

    for ch in s.chars() {
        let is_digit = ch.is_ascii_digit();
        if is_digit != in_digit && !current.is_empty() {
            if in_digit {
                // 数字部分はゼロ埋め20桁で統一
                result.push((true, format!("{:0>20}", current)));
            } else {
                result.push((false, current.to_lowercase()));
            }
            current.clear();
        }
        in_digit = is_digit;
        current.push(ch);
    }
    if !current.is_empty() {
        if in_digit {
            result.push((true, format!("{:0>20}", current)));
        } else {
            result.push((false, current.to_lowercase()));
        }
    }
    result
}

/// List files in a folder with PSD/PSB/TIF/TIFF extension filter and natural sort
#[tauri::command]
pub async fn list_folder_files(
    folder_path: String,
    recursive: bool,
) -> Result<Vec<String>, String> {
    let folder = Path::new(&folder_path);
    if !folder.exists() || !folder.is_dir() {
        return Err(format!("Folder not found: {}", folder_path));
    }

    let mut files = Vec::new();
    collect_files(folder, recursive, &mut files)?;

    // 自然順ソート
    files.sort_by(|a, b| {
        let key_a = natural_sort_key(
            Path::new(a)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(""),
        );
        let key_b = natural_sort_key(
            Path::new(b)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(""),
        );
        key_a.cmp(&key_b)
    });

    Ok(files)
}

/// Recursively collect PSD/PSB/TIF/TIFF files
fn collect_files(dir: &Path, recursive: bool, files: &mut Vec<String>) -> Result<(), String> {
    let entries = fs::read_dir(dir)
        .map_err(|e| format!("Failed to read dir {}: {}", dir.display(), e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Entry error: {}", e))?;
        let path = entry.path();

        if path.is_file() {
            if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                let ext_lower = ext.to_lowercase();
                if ext_lower == "psd" || ext_lower == "psb" || ext_lower == "tif" || ext_lower == "tiff" {
                    files.push(path.to_string_lossy().to_string());
                }
            }
        } else if recursive && path.is_dir() {
            collect_files(&path, recursive, files)?;
        }
    }

    Ok(())
}

/// List subfolders in a directory
#[tauri::command]
pub async fn list_subfolders(
    folder_path: String,
) -> Result<Vec<String>, String> {
    let folder = Path::new(&folder_path);
    if !folder.exists() || !folder.is_dir() {
        return Err(format!("Folder not found: {}", folder_path));
    }

    let mut subfolders = Vec::new();
    let entries = fs::read_dir(folder)
        .map_err(|e| format!("Failed to read dir: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Entry error: {}", e))?;
        let path = entry.path();
        if path.is_dir() {
            subfolders.push(path.to_string_lossy().to_string());
        }
    }

    // 自然順ソート
    subfolders.sort_by(|a, b| {
        let key_a = natural_sort_key(
            Path::new(a).file_name().and_then(|n| n.to_str()).unwrap_or(""),
        );
        let key_b = natural_sort_key(
            Path::new(b).file_name().and_then(|n| n.to_str()).unwrap_or(""),
        );
        key_a.cmp(&key_b)
    });

    Ok(subfolders)
}

/// Read a text file and return its contents as a string
#[tauri::command]
pub async fn read_text_file(file_path: String) -> Result<String, String> {
    let path = Path::new(&file_path);
    if !path.exists() || !path.is_file() {
        return Err(format!("File not found: {}", file_path));
    }
    fs::read_to_string(path)
        .map_err(|e| format!("Failed to read file: {}", e))
}

/// Write a text file
#[tauri::command]
pub async fn write_text_file(file_path: String, content: String) -> Result<(), String> {
    let path = Path::new(&file_path);
    // 親フォルダが存在しなければ作成
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
        }
    }
    fs::write(path, content)
        .map_err(|e| format!("Failed to write file: {}", e))
}

/// Delete a file (no error if it doesn't exist)
#[tauri::command]
pub async fn delete_file(file_path: String) -> Result<(), String> {
    let path = Path::new(&file_path);
    if path.exists() {
        fs::remove_file(path)
            .map_err(|e| format!("Failed to delete file: {}", e))?;
    }
    Ok(())
}

/// Check if a file or directory exists
#[tauri::command]
pub async fn path_exists(path: String) -> Result<bool, String> {
    Ok(Path::new(&path).exists())
}

/// List folder contents (subfolders + JSON files) — for JSON browser modal
#[derive(Debug, Serialize)]
pub struct FolderContents {
    pub folders: Vec<String>,
    pub json_files: Vec<String>,
}

#[tauri::command]
pub async fn list_folder_contents(
    folder_path: String,
) -> Result<FolderContents, String> {
    let folder = Path::new(&folder_path);
    if !folder.exists() || !folder.is_dir() {
        return Err(format!("Folder not found: {}", folder_path));
    }

    let mut folders = Vec::new();
    let mut json_files = Vec::new();
    let entries = fs::read_dir(folder)
        .map_err(|e| format!("Failed to read dir: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Entry error: {}", e))?;
        let path = entry.path();
        if path.is_dir() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                folders.push(name.to_string());
            }
        } else if path.is_file() {
            if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                if ext.to_lowercase() == "json" {
                    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                        json_files.push(name.to_string());
                    }
                }
            }
        }
    }

    // 自然順ソート
    folders.sort_by(|a, b| natural_sort_key(a).cmp(&natural_sort_key(b)));
    json_files.sort_by(|a, b| natural_sort_key(a).cmp(&natural_sort_key(b)));

    Ok(FolderContents { folders, json_files })
}

/// List all file names in a directory (no extension filter)
#[tauri::command]
pub async fn list_all_files(
    folder_path: String,
) -> Result<Vec<String>, String> {
    let folder = Path::new(&folder_path);
    if !folder.exists() || !folder.is_dir() {
        return Err(format!("Folder not found: {}", folder_path));
    }

    let entries = fs::read_dir(folder)
        .map_err(|e| format!("Failed to read dir: {}", e))?;

    let mut files = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("Entry error: {}", e))?;
        let path = entry.path();
        if path.is_file() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                files.push(name.to_string());
            }
        }
    }

    files.sort_by(|a, b| natural_sort_key(a).cmp(&natural_sort_key(b)));
    Ok(files)
}

/// Search JSON files across subfolders (depth=2: basePath/label/title.json)
#[derive(Debug, Serialize)]
pub struct JsonSearchResult {
    pub label: String,
    pub title: String,
    pub path: String,
}

#[tauri::command]
pub async fn search_json_folders(
    base_path: String,
    query: String,
) -> Result<Vec<JsonSearchResult>, String> {
    let path = std::path::PathBuf::from(&base_path);
    if !path.exists() {
        return Err(format!("フォルダが存在しません: {}", base_path));
    }

    let query_lower = query.to_lowercase();
    let mut results: Vec<JsonSearchResult> = Vec::new();

    for entry in walkdir::WalkDir::new(&path)
        .min_depth(2)
        .max_depth(2)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let entry_path = entry.path();
        if !entry_path.is_file() {
            continue;
        }
        let ext = entry_path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        if ext.to_lowercase() != "json" {
            continue;
        }

        let title = entry_path
            .file_stem()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        if title.to_lowercase().contains(&query_lower) {
            let label = entry_path
                .parent()
                .and_then(|p| p.file_name())
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();

            results.push(JsonSearchResult {
                label,
                title,
                path: entry_path.to_string_lossy().to_string(),
            });
        }
    }

    results.sort_by(|a, b| a.title.cmp(&b.title));
    Ok(results)
}

// --- Replace Job Settings for JSX ---

#[derive(Debug, Serialize, Deserialize)]
pub struct ReplaceTextSettings {
    #[serde(rename = "subMode")]
    pub sub_mode: String,
    #[serde(rename = "groupName")]
    pub group_name: String,
    #[serde(rename = "partialMatch")]
    pub partial_match: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ReplaceImageSettings {
    #[serde(rename = "replaceBackground")]
    pub replace_background: bool,
    #[serde(rename = "replaceSpecialLayer")]
    pub replace_special_layer: bool,
    #[serde(rename = "specialLayerName")]
    pub special_layer_name: String,
    #[serde(rename = "specialLayerPartialMatch")]
    pub special_layer_partial_match: bool,
    #[serde(rename = "replaceNamedGroup")]
    pub replace_named_group: bool,
    #[serde(rename = "namedGroupName")]
    pub named_group_name: String,
    #[serde(rename = "namedGroupPartialMatch")]
    pub named_group_partial_match: bool,
    #[serde(rename = "placeFromBottom")]
    pub place_from_bottom: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ReplaceGeneralSettings {
    #[serde(rename = "skipResize")]
    pub skip_resize: bool,
    #[serde(rename = "roundFontSize")]
    pub round_font_size: bool,
    #[serde(rename = "saveFileName")]
    pub save_file_name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ReplaceSwitchSettings {
    #[serde(rename = "subMode")]
    pub sub_mode: String,
    #[serde(rename = "whiteLayerName")]
    pub white_layer_name: String,
    #[serde(rename = "whitePartialMatch")]
    pub white_partial_match: bool,
    #[serde(rename = "barGroupName")]
    pub bar_group_name: String,
    #[serde(rename = "barPartialMatch")]
    pub bar_partial_match: bool,
    #[serde(rename = "placeFromBottom")]
    pub place_from_bottom: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ReplacePairEntry {
    #[serde(rename = "sourceFile")]
    pub source_file: String,
    #[serde(rename = "targetFile")]
    pub target_file: String,
    #[serde(rename = "outputDir")]
    pub output_dir: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ComposeElementEntry {
    pub id: String,
    #[serde(rename = "type")]
    pub element_type: String,
    pub label: String,
    pub source: String,
    #[serde(rename = "customName")]
    pub custom_name: Option<String>,
    #[serde(rename = "customKind")]
    pub custom_kind: Option<String>,
    #[serde(rename = "partialMatch")]
    pub partial_match: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ReplaceComposeSettings {
    pub elements: Vec<ComposeElementEntry>,
    #[serde(rename = "restSource")]
    pub rest_source: String,
    #[serde(rename = "skipResize")]
    pub skip_resize: bool,
    #[serde(rename = "roundFontSize")]
    pub round_font_size: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ReplaceJobSettings {
    pub mode: String,
    pub pairs: Vec<ReplacePairEntry>,
    #[serde(rename = "textSettings")]
    pub text_settings: ReplaceTextSettings,
    #[serde(rename = "imageSettings")]
    pub image_settings: ReplaceImageSettings,
    #[serde(rename = "switchSettings")]
    pub switch_settings: ReplaceSwitchSettings,
    #[serde(rename = "generalSettings")]
    pub general_settings: ReplaceGeneralSettings,
    #[serde(rename = "composeSettings")]
    pub compose_settings: Option<ReplaceComposeSettings>,
    #[serde(rename = "outputPath")]
    pub output_path: String,
}

/// Run Photoshop to replace layers between paired PSD files
#[tauri::command]
pub async fn run_photoshop_replace(
    app_handle: tauri::AppHandle,
    jobs: ReplaceJobSettings,
) -> Result<Vec<PhotoshopResult>, String> {
    use std::process::Command;
    use std::io::Write;

    let ps_path = find_photoshop_path()
        .ok_or_else(|| "Photoshop not found. Please install Adobe Photoshop.".to_string())?;

    // Resolve script path
    let resource_path = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;

    let script_path = resource_path.join("scripts").join("replace_layers.jsx");

    let script_path_str = if script_path.exists() {
        script_path.to_string_lossy().to_string()
    } else {
        let dev_script = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("scripts")
            .join("replace_layers.jsx");
        if dev_script.exists() {
            dev_script.to_string_lossy().to_string()
        } else {
            return Err("Replace script not found".to_string());
        }
    };

    let temp_dir = std::env::temp_dir();
    let settings_path = temp_dir.join("psd_replace_settings.json");
    let output_path = temp_dir.join("psd_replace_results.json");

    let _ = fs::remove_file(&output_path);

    // Update settings with output path and normalize paths
    let mut jobs_normalized = jobs;
    jobs_normalized.output_path = output_path.to_string_lossy().to_string().replace("\\", "/");
    for pair in &mut jobs_normalized.pairs {
        pair.source_file = pair.source_file.replace("\\", "/");
        pair.target_file = pair.target_file.replace("\\", "/");
        pair.output_dir = pair.output_dir.replace("\\", "/");
    }

    let settings_json = serde_json::to_string_pretty(&jobs_normalized)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    let mut settings_file = fs::File::create(&settings_path)
        .map_err(|e| format!("Failed to create settings file: {}", e))?;
    // UTF-8 BOM for Japanese support
    settings_file.write_all(&[0xEF, 0xBB, 0xBF])
        .map_err(|e| format!("Failed to write BOM: {}", e))?;
    settings_file.write_all(settings_json.as_bytes())
        .map_err(|e| format!("Failed to write settings: {}", e))?;

    eprintln!("Replace - Photoshop: {}", ps_path);
    eprintln!("Replace - Script: {}", script_path_str);
    eprintln!("Replace - Pairs: {}", jobs_normalized.pairs.len());
    eprintln!("Replace - Mode: {}", jobs_normalized.mode);
    // spawn() で即座にリターン（output() だと PS が開いている間ブロックする）
    let _child = Command::new(&ps_path)
        .arg("-r")
        .arg(&script_path_str)
        .spawn()
        .map_err(|e| format!("Failed to run Photoshop: {}", e))?;

    // Poll for results — heartbeat-based timeout
    // JSX writes "X/N" to psd_replace_progress.txt; no timeout while X < N
    let pair_count = jobs_normalized.pairs.len();
    let poll_interval_ms: u64 = 500;
    let initial_timeout_secs: u64 = 600;  // 10 min for PS startup + first pair
    let final_timeout_secs: u64 = 120;    // 2 min after last pair for result file
    let progress_path = temp_dir.join("psd_replace_progress.txt");
    let _ = fs::remove_file(&progress_path);
    let mut last_progress = String::new();
    let mut polls_since_progress: u64 = 0;
    let mut all_done = false; // true when progress shows N/N
    eprintln!("Replace - Heartbeat: {}s initial, no timeout during processing, {} pairs",
        initial_timeout_secs, pair_count);

    loop {
        // Check if final result is ready
        if output_path.exists() {
            if let Ok(content) = fs::read_to_string(&output_path) {
                if content.trim().starts_with('[') && content.trim().ends_with(']') {
                    eprintln!("Replace output ready");
                    break;
                }
            }
        }

        // Check heartbeat progress file ("X/N" format)
        if let Ok(content) = fs::read_to_string(&progress_path) {
            let trimmed = content.trim().to_string();
            if !trimmed.is_empty() && trimmed != last_progress {
                eprintln!("Replace progress: {}", trimmed);
                last_progress = trimmed.clone();
                polls_since_progress = 0;
                // Parse "X/N" to check if all pairs are done
                if let Some((current, total)) = trimmed.split_once('/') {
                    if let (Ok(c), Ok(t)) = (current.parse::<u64>(), total.parse::<u64>()) {
                        all_done = c >= t && t > 0;
                    }
                }
            }
        }

        polls_since_progress += 1;

        // Timeout logic: only enforce timeout before first heartbeat or after N/N
        let timeout_polls = if last_progress.is_empty() {
            (initial_timeout_secs * 1000) / poll_interval_ms
        } else if all_done {
            (final_timeout_secs * 1000) / poll_interval_ms
        } else {
            u64::MAX // no timeout while processing
        };

        if polls_since_progress >= timeout_polls {
            if last_progress.is_empty() {
                eprintln!("Replace timed out (no heartbeat from Photoshop after {}s)", initial_timeout_secs);
            } else {
                eprintln!("Replace timed out (result file not written after last progress)");
            }
            break;
        }

        std::thread::sleep(std::time::Duration::from_millis(poll_interval_ms));

        if polls_since_progress > 0 && polls_since_progress % 60 == 0 {
            eprintln!("Still waiting for Photoshop replace... ({}s since last progress, {})",
                polls_since_progress * poll_interval_ms / 1000, if last_progress.is_empty() { "waiting for start" } else { &last_progress });
        }
    }
    let _ = fs::remove_file(&progress_path);

    if output_path.exists() {
        let results_json = fs::read_to_string(&output_path)
            .map_err(|e| format!("Failed to read results: {}", e))?;

        let results: Vec<PhotoshopResult> = serde_json::from_str(&results_json)
            .map_err(|e| format!("Failed to parse results: {}. JSON was: {}", e, results_json))?;

        let _ = fs::remove_file(&settings_path);
        let _ = fs::remove_file(&output_path);

        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.set_focus();
        }

        Ok(results)
    } else {
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.set_focus();
        }
        Err("Photoshop did not produce output file. Script may have failed.".to_string())
    }
}

/// ファイルをデフォルトアプリで開く
#[tauri::command]
pub async fn open_with_default_app(file_path: String) -> Result<(), String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }
    std::process::Command::new("cmd")
        .args(["/c", "start", "", &file_path])
        .spawn()
        .map_err(|e| format!("Failed to open file: {}", e))?;
    Ok(())
}

/// ファイルをエクスプローラーで選択状態で開く（単一ファイル、後方互換）
#[tauri::command]
pub async fn open_folder_in_explorer(folder_path: String) -> Result<(), String> {
    reveal_files_in_explorer(vec![folder_path]).await
}

/// 複数ファイルをエクスプローラーで選択状態で開く
#[tauri::command]
pub async fn reveal_files_in_explorer(file_paths: Vec<String>) -> Result<(), String> {
    if file_paths.is_empty() {
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        if file_paths.len() == 1 {
            let path = Path::new(&file_paths[0]);
            if !path.exists() {
                return Err(format!("Path not found: {}", file_paths[0]));
            }
            if path.is_file() {
                // /select,path は1つの引数として渡す必要がある
                let select_arg = format!("/select,{}", path.display());
                std::process::Command::new("explorer")
                    .arg(&select_arg)
                    .spawn()
                    .map_err(|e| format!("Failed to open explorer: {}", e))?;
            } else {
                std::process::Command::new("explorer")
                    .arg(path)
                    .spawn()
                    .map_err(|e| format!("Failed to open explorer: {}", e))?;
            }
        } else {
            win_shell::reveal_multiple_files(&file_paths)?;
        }
    }

    #[cfg(target_os = "macos")]
    {
        let first = &file_paths[0];
        let path = Path::new(first);
        if !path.exists() {
            return Err(format!("Path not found: {}", first));
        }
        std::process::Command::new("open")
            .arg("-R")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Failed to open Finder: {}", e))?;
    }

    Ok(())
}

/// Windows Shell API (SHOpenFolderAndSelectItems) で複数ファイルを選択状態で表示
#[cfg(target_os = "windows")]
mod win_shell {
    use std::ffi::c_void;
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;
    use std::ptr;

    #[repr(C)]
    struct ITEMIDLIST {
        _data: [u8; 0],
    }

    #[link(name = "ole32")]
    extern "system" {
        fn CoInitializeEx(pv_reserved: *mut c_void, dw_co_init: u32) -> i32;
        fn CoUninitialize();
    }

    #[link(name = "shell32")]
    extern "system" {
        fn SHParseDisplayName(
            psz_name: *const u16,
            pbc: *mut c_void,
            ppidl: *mut *mut ITEMIDLIST,
            sfgao_in: u32,
            psfgao_out: *mut u32,
        ) -> i32;
        fn SHOpenFolderAndSelectItems(
            pidl_folder: *const ITEMIDLIST,
            cidl: u32,
            apidl: *const *const ITEMIDLIST,
            dw_flags: u32,
        ) -> i32;
        fn ILFree(pidl: *mut ITEMIDLIST);
    }

    fn to_wide(s: &str) -> Vec<u16> {
        OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
    }

    fn parse_pidl(path_str: &str) -> Option<*mut ITEMIDLIST> {
        let wide = to_wide(path_str);
        let mut pidl: *mut ITEMIDLIST = ptr::null_mut();
        let hr = unsafe {
            SHParseDisplayName(wide.as_ptr(), ptr::null_mut(), &mut pidl, 0, ptr::null_mut())
        };
        if hr == 0 && !pidl.is_null() { Some(pidl) } else { None }
    }

    pub fn reveal_multiple_files(file_paths: &[String]) -> Result<(), String> {
        unsafe { CoInitializeEx(ptr::null_mut(), 0x2); }

        let folder = Path::new(&file_paths[0])
            .parent()
            .ok_or("Cannot determine parent folder")?
            .to_string_lossy()
            .to_string();

        let folder_pidl = parse_pidl(&folder)
            .ok_or_else(|| format!("Failed to parse folder: {}", folder))?;

        let mut item_pidls: Vec<*const ITEMIDLIST> = Vec::new();
        for path in file_paths {
            if !Path::new(path).exists() { continue; }
            if let Some(pidl) = parse_pidl(path) {
                item_pidls.push(pidl as *const _);
            }
        }

        let hr = unsafe {
            SHOpenFolderAndSelectItems(
                folder_pidl as *const _,
                item_pidls.len() as u32,
                if item_pidls.is_empty() { ptr::null() } else { item_pidls.as_ptr() },
                0,
            )
        };

        unsafe {
            for pidl in &item_pidls { ILFree(*pidl as *mut _); }
            ILFree(folder_pidl);
            CoUninitialize();
        }

        if hr != 0 {
            return Err(format!("SHOpenFolderAndSelectItems failed: HRESULT {:#x}", hr));
        }
        Ok(())
    }
}

// --- Rename Types ---

#[derive(Debug, Serialize, Deserialize)]
pub struct RenameBottomLayerSettings {
    pub enabled: bool,
    #[serde(rename = "newName")]
    pub new_name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RenameRuleEntry {
    pub target: String,
    #[serde(rename = "oldName")]
    pub old_name: String,
    #[serde(rename = "newName")]
    pub new_name: String,
    #[serde(rename = "matchMode")]
    pub match_mode: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RenameFileOutputSettings {
    pub enabled: bool,
    #[serde(rename = "baseName")]
    pub base_name: String,
    #[serde(rename = "startNumber")]
    pub start_number: u32,
    pub padding: u32,
    pub separator: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RenameJobSettings {
    pub files: Vec<String>,
    #[serde(rename = "bottomLayer")]
    pub bottom_layer: RenameBottomLayerSettings,
    pub rules: Vec<RenameRuleEntry>,
    #[serde(rename = "fileOutput")]
    pub file_output: RenameFileOutputSettings,
    #[serde(rename = "outputDirectory")]
    pub output_directory: Option<String>,
    #[serde(rename = "outputPath")]
    #[serde(default)]
    pub output_path: String,
}

/// Run Photoshop to rename layers/groups in PSD files
#[tauri::command]
pub async fn run_photoshop_rename(
    app_handle: tauri::AppHandle,
    settings: RenameJobSettings,
) -> Result<Vec<PhotoshopResult>, String> {
    use std::process::Command;
    use std::io::Write;

    let ps_path = find_photoshop_path()
        .ok_or_else(|| "Photoshop not found. Please install Adobe Photoshop.".to_string())?;

    let resource_path = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;

    let script_path = resource_path.join("scripts").join("rename_psd.jsx");
    let script_path_str = if script_path.exists() {
        script_path.to_string_lossy().to_string()
    } else {
        let dev_script = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("scripts")
            .join("rename_psd.jsx");
        if dev_script.exists() {
            dev_script.to_string_lossy().to_string()
        } else {
            return Err("Rename script not found".to_string());
        }
    };

    let temp_dir = std::env::temp_dir();
    let settings_path = temp_dir.join("psd_rename_settings.json");
    let output_path = temp_dir.join("psd_rename_results.json");

    let _ = fs::remove_file(&output_path);

    let mut settings_normalized = settings;
    settings_normalized.output_path = output_path.to_string_lossy().to_string().replace("\\", "/");
    for f in &mut settings_normalized.files {
        *f = f.replace("\\", "/");
    }
    if let Some(ref mut dir) = settings_normalized.output_directory {
        *dir = dir.replace("\\", "/");
    }

    let settings_json = serde_json::to_string_pretty(&settings_normalized)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    let mut settings_file = fs::File::create(&settings_path)
        .map_err(|e| format!("Failed to create settings file: {}", e))?;
    settings_file.write_all(&[0xEF, 0xBB, 0xBF])
        .map_err(|e| format!("Failed to write BOM: {}", e))?;
    settings_file.write_all(settings_json.as_bytes())
        .map_err(|e| format!("Failed to write settings: {}", e))?;

    eprintln!("Rename - Photoshop: {}", ps_path);
    eprintln!("Rename - Script: {}", script_path_str);
    eprintln!("Rename - Files: {}", settings_normalized.files.len());

    let _child = Command::new(&ps_path)
        .arg("-r")
        .arg(&script_path_str)
        .spawn()
        .map_err(|e| format!("Failed to run Photoshop: {}", e))?;

    let max_wait_secs = 300;
    let poll_interval_ms = 500;
    let max_polls = (max_wait_secs * 1000) / poll_interval_ms;

    for poll in 0..max_polls {
        if output_path.exists() {
            if let Ok(content) = fs::read_to_string(&output_path) {
                if content.trim().starts_with('[') && content.trim().ends_with(']') {
                    eprintln!("Rename output ready after {} polls", poll);
                    break;
                }
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(poll_interval_ms as u64));

        if poll > 0 && poll % 20 == 0 {
            eprintln!("Still waiting for Photoshop rename... ({} seconds)", poll * poll_interval_ms / 1000);
        }
    }

    if output_path.exists() {
        let results_json = fs::read_to_string(&output_path)
            .map_err(|e| format!("Failed to read results: {}", e))?;

        let results: Vec<PhotoshopResult> = serde_json::from_str(&results_json)
            .map_err(|e| format!("Failed to parse results: {}. JSON was: {}", e, results_json))?;

        let _ = fs::remove_file(&settings_path);
        let _ = fs::remove_file(&output_path);

        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.set_focus();
        }

        Ok(results)
    } else {
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.set_focus();
        }
        Err("Photoshop did not produce output file. Script may have failed.".to_string())
    }
}

// --- Batch File Rename Types ---

#[derive(Debug, Serialize, Deserialize)]
pub struct BatchRenameEntry {
    #[serde(rename = "sourcePath")]
    pub source_path: String,
    #[serde(rename = "newName")]
    pub new_name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BatchRenameResult {
    #[serde(rename = "originalPath")]
    pub original_path: String,
    #[serde(rename = "originalName")]
    pub original_name: String,
    #[serde(rename = "newName")]
    pub new_name: String,
    #[serde(rename = "outputPath")]
    pub output_path: String,
    pub success: bool,
    pub error: Option<String>,
}

/// Batch rename/copy files (no Photoshop needed)
#[tauri::command]
pub async fn batch_rename_files(
    entries: Vec<BatchRenameEntry>,
    output_directory: Option<String>,
    mode: String, // "copy" or "overwrite"
) -> Result<Vec<BatchRenameResult>, String> {
    let mut results = Vec::new();

    // Resolve output directory for copy mode
    let out_dir = if mode == "copy" {
        let dir = if let Some(ref d) = output_directory {
            if d.is_empty() {
                None
            } else {
                Some(d.clone())
            }
        } else {
            None
        };

        let dir = dir.unwrap_or_else(|| {
            let home = std::env::var("USERPROFILE")
                .unwrap_or_else(|_| std::env::var("HOME").unwrap_or_default());
            Path::new(&home)
                .join("Desktop")
                .join("Script_Output")
                .join("リネーム_ファイル")
                .to_string_lossy()
                .to_string()
        });

        let out_path = Path::new(&dir);
        if !out_path.exists() {
            fs::create_dir_all(out_path)
                .map_err(|e| format!("Failed to create output directory: {}", e))?;
        }
        Some(dir)
    } else {
        None
    };

    for entry in &entries {
        let source = Path::new(&entry.source_path);
        let original_name = source
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        let result = if mode == "copy" {
            let dest = Path::new(out_dir.as_ref().unwrap()).join(&entry.new_name);
            match fs::copy(source, &dest) {
                Ok(_) => BatchRenameResult {
                    original_path: entry.source_path.clone(),
                    original_name,
                    new_name: entry.new_name.clone(),
                    output_path: dest.to_string_lossy().to_string(),
                    success: true,
                    error: None,
                },
                Err(e) => BatchRenameResult {
                    original_path: entry.source_path.clone(),
                    original_name,
                    new_name: entry.new_name.clone(),
                    output_path: dest.to_string_lossy().to_string(),
                    success: false,
                    error: Some(e.to_string()),
                },
            }
        } else {
            // overwrite mode: rename in place
            let parent = source.parent().unwrap_or(Path::new("."));
            let dest = parent.join(&entry.new_name);
            match fs::rename(source, &dest) {
                Ok(_) => BatchRenameResult {
                    original_path: entry.source_path.clone(),
                    original_name,
                    new_name: entry.new_name.clone(),
                    output_path: dest.to_string_lossy().to_string(),
                    success: true,
                    error: None,
                },
                Err(e) => BatchRenameResult {
                    original_path: entry.source_path.clone(),
                    original_name,
                    new_name: entry.new_name.clone(),
                    output_path: dest.to_string_lossy().to_string(),
                    success: false,
                    error: Some(e.to_string()),
                },
            }
        };

        results.push(result);
    }

    Ok(results)
}

/// Open a file in Photoshop
#[tauri::command]
pub async fn open_file_in_photoshop(file_path: String) -> Result<(), String> {
    use std::process::Command;

    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }

    let ps_path = find_photoshop_path()
        .ok_or_else(|| "Photoshop not found".to_string())?;

    Command::new(&ps_path)
        .arg(&file_path)
        .spawn()
        .map_err(|e| format!("Failed to open file in Photoshop: {}", e))?;

    Ok(())
}

// ============================================
// TIFF Conversion (Photoshop JSX)
// ============================================

#[derive(Debug, Serialize, Deserialize)]
pub struct TiffConvertResult {
    #[serde(rename = "fileName")]
    pub file_name: String,
    pub success: bool,
    #[serde(rename = "outputPath")]
    pub output_path: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TiffConvertResponse {
    pub results: Vec<TiffConvertResult>,
    #[serde(rename = "outputDir")]
    pub output_dir: String,
    #[serde(rename = "jpgOutputDir")]
    pub jpg_output_dir: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct TiffResultsWrapper {
    results: Vec<TiffConvertResult>,
}

/// Run Photoshop to convert PSD files to TIFF
#[tauri::command]
pub async fn run_photoshop_tiff_convert(
    app_handle: tauri::AppHandle,
    settings_json: String,
    output_dir: String,
    jpg_output_dir: Option<String>,
) -> Result<TiffConvertResponse, String> {
    use std::process::Command;
    use std::io::Write;

    let ps_path = find_photoshop_path()
        .ok_or_else(|| "Photoshop not found. Please install Adobe Photoshop.".to_string())?;

    let resource_path = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;

    let script_path = resource_path.join("scripts").join("tiff_convert.jsx");

    // Dev mode: prefer source dir (always up-to-date), fallback to resource dir (bundled)
    let script_path_str = {
        let dev_script = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("scripts")
            .join("tiff_convert.jsx");
        if dev_script.exists() {
            dev_script.to_string_lossy().to_string()
        } else if script_path.exists() {
            script_path.to_string_lossy().to_string()
        } else {
            return Err("TIFF convert script not found".to_string())
        }
    };

    let temp_dir = std::env::temp_dir();
    let settings_path = temp_dir.join("psd_tiff_settings.json");
    let output_path = temp_dir.join("psd_tiff_results.json");

    let _ = fs::remove_file(&output_path);

    // Output directory: create unique if exists
    let final_output_dir = {
        let base_path = Path::new(&output_dir);
        if base_path.exists() {
            let base = output_dir.clone();
            let mut counter = 1;
            loop {
                let candidate = format!("{} ({})", base, counter);
                if !Path::new(&candidate).exists() {
                    break candidate;
                }
                counter += 1;
            }
        } else {
            output_dir.clone()
        }
    };

    eprintln!("TIFF Convert - Output dir: {}", final_output_dir);

    // JPG output directory: create unique if exists (only when jpg_output_dir is provided and non-empty)
    let final_jpg_output_dir = if let Some(ref jdir) = jpg_output_dir {
        if !jdir.is_empty() {
            let base_path = Path::new(jdir);
            let resolved = if base_path.exists() {
                let base = jdir.clone();
                let mut counter = 1;
                loop {
                    let candidate = format!("{} ({})", base, counter);
                    if !Path::new(&candidate).exists() {
                        break candidate;
                    }
                    counter += 1;
                }
            } else {
                jdir.clone()
            };
            eprintln!("TIFF Convert - JPG Output dir: {}", resolved);
            let _ = fs::create_dir_all(&resolved);
            Some(resolved)
        } else {
            None
        }
    } else {
        None
    };

    // Rewrite outputPath in settings JSON: replace base output_dir with final_output_dir
    let mut rewritten_json = if final_output_dir != output_dir {
        let output_dir_fwd = output_dir.replace('\\', "/");
        let final_dir_fwd = final_output_dir.replace('\\', "/");
        settings_json.replace(&output_dir_fwd, &final_dir_fwd)
    } else {
        settings_json.clone()
    };

    // Rewrite jpgOutputPath in settings JSON
    if let (Some(ref orig), Some(ref final_j)) = (&jpg_output_dir, &final_jpg_output_dir) {
        if !orig.is_empty() && final_j != orig {
            let orig_fwd = orig.replace('\\', "/");
            let final_fwd = final_j.replace('\\', "/");
            rewritten_json = rewritten_json.replace(&orig_fwd, &final_fwd);
        }
    }

    // Create the output directory so explorer can open it even if JSX produces no files
    let _ = fs::create_dir_all(&final_output_dir);

    // Write settings JSON with BOM
    let mut settings_file = fs::File::create(&settings_path)
        .map_err(|e| format!("Failed to create settings file: {}", e))?;
    settings_file.write_all(&[0xEF, 0xBB, 0xBF])
        .map_err(|e| format!("Failed to write BOM: {}", e))?;
    settings_file.write_all(rewritten_json.as_bytes())
        .map_err(|e| format!("Failed to write settings: {}", e))?;
    drop(settings_file);

    // Copy script to temp (avoids Japanese path DDE forwarding issues — same as split_psd)
    let temp_script = temp_dir.join("tiff_convert_temp.jsx");
    fs::copy(&script_path_str, &temp_script)
        .map_err(|e| format!("Failed to copy script to temp: {}", e))?;
    let script_to_run = temp_script.to_string_lossy().to_string();

    eprintln!("TIFF Convert - Photoshop: {}", ps_path);
    eprintln!("TIFF Convert - Script (source): {}", script_path_str);
    eprintln!("TIFF Convert - Script (temp): {}", script_to_run);

    // spawn() for non-blocking (same as split_psd — output() blocks while PS is open)
    let _child = Command::new(&ps_path)
        .arg("-r")
        .arg(&script_to_run)
        .spawn()
        .map_err(|e| format!("Failed to run Photoshop: {}", e))?;

    // Poll for results — heartbeat-based timeout
    // JSX writes "X/N" to psd_tiff_progress.txt; no timeout while X < N
    let file_count = rewritten_json.matches("\"filePath\"").count().max(1);
    let poll_interval_ms: u64 = 500;
    let initial_timeout_secs: u64 = 600;  // 10 min for PS startup + first file
    let final_timeout_secs: u64 = 120;    // 2 min after last file for result file
    let progress_path = temp_dir.join("psd_tiff_progress.txt");
    let _ = fs::remove_file(&progress_path);
    let mut last_progress = String::new();
    let mut polls_since_progress: u64 = 0;
    let mut all_done = false; // true when progress shows N/N
    eprintln!("TIFF Convert - Heartbeat: {}s initial, no timeout during processing, {} files",
        initial_timeout_secs, file_count);

    loop {
        // Check if final result is ready
        if output_path.exists() {
            if let Ok(content) = fs::read_to_string(&output_path) {
                if content.trim().starts_with('{') && content.contains("results") {
                    eprintln!("TIFF Convert output ready");
                    break;
                }
            }
        }

        // Check heartbeat progress file ("X/N" format)
        if let Ok(content) = fs::read_to_string(&progress_path) {
            let trimmed = content.trim().to_string();
            if !trimmed.is_empty() && trimmed != last_progress {
                eprintln!("TIFF Convert progress: {}", trimmed);
                last_progress = trimmed.clone();
                polls_since_progress = 0;
                // Parse "X/N" to check if all files are done
                if let Some((current, total)) = trimmed.split_once('/') {
                    if let (Ok(c), Ok(t)) = (current.parse::<u64>(), total.parse::<u64>()) {
                        all_done = c >= t && t > 0;
                    }
                }
            }
        }

        polls_since_progress += 1;

        // Timeout logic: only enforce timeout before first heartbeat or after N/N
        let timeout_polls = if last_progress.is_empty() {
            (initial_timeout_secs * 1000) / poll_interval_ms
        } else if all_done {
            (final_timeout_secs * 1000) / poll_interval_ms
        } else {
            u64::MAX // no timeout while processing
        };

        if polls_since_progress >= timeout_polls {
            if last_progress.is_empty() {
                eprintln!("TIFF Convert timed out (no heartbeat from Photoshop after {}s)", initial_timeout_secs);
            } else {
                eprintln!("TIFF Convert timed out (result file not written after last progress)");
            }
            break;
        }

        std::thread::sleep(std::time::Duration::from_millis(poll_interval_ms));

        if polls_since_progress > 0 && polls_since_progress % 60 == 0 {
            eprintln!("Still waiting for Photoshop TIFF convert... ({}s since last progress, {})",
                polls_since_progress * poll_interval_ms / 1000, if last_progress.is_empty() { "waiting for start" } else { &last_progress });
        }
    }
    let _ = fs::remove_file(&progress_path);

    if output_path.exists() {
        let results_json = fs::read_to_string(&output_path)
            .map_err(|e| format!("Failed to read results: {}", e))?;

        let wrapper: TiffResultsWrapper = serde_json::from_str(&results_json)
            .map_err(|e| format!("Failed to parse results: {}. JSON was: {}", e, results_json))?;

        let _ = fs::remove_file(&settings_path);
        let _ = fs::remove_file(&output_path);
        let _ = fs::remove_file(&temp_script);

        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.set_focus();
        }

        Ok(TiffConvertResponse {
            results: wrapper.results,
            output_dir: final_output_dir,
            jpg_output_dir: final_jpg_output_dir,
        })
    } else {
        let _ = fs::remove_file(&temp_script);
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.set_focus();
        }
        Err("Photoshop did not produce output file. Script may have failed.".to_string())
    }
}

/// Launch KENBAN-viewer in diff mode with two folder paths
#[tauri::command]
pub async fn launch_kenban_diff(
    folder_a: String,
    folder_b: String,
    mode: Option<String>,
    selection_json: Option<String>,
) -> Result<(), String> {
    use std::process::Command;

    let local_app_data = std::env::var("LOCALAPPDATA")
        .map_err(|_| "LOCALAPPDATA not found".to_string())?;
    let kenban_path = Path::new(&local_app_data).join("KENBAN").join("KENBAN.exe");

    if !kenban_path.exists() {
        return Err(format!(
            "KENBAN.exe が見つかりません: {}",
            kenban_path.display()
        ));
    }

    // mode: "tiff"（デフォルト）, "psd", "psd-tiff"
    let mode_arg = mode.unwrap_or_else(|| "tiff".to_string());

    let mut cmd = Command::new(&kenban_path);
    cmd.arg("--diff")
        .arg(&mode_arg)
        .arg(&folder_a)
        .arg(&folder_b);

    // 選択範囲JSONが指定されていれば、tempに書き出してパスを渡す
    if let Some(json_content) = selection_json {
        let temp_dir = std::env::temp_dir();
        let json_path = temp_dir.join("kenban_selection_bounds.json");
        std::fs::write(&json_path, &json_content)
            .map_err(|e| format!("選択範囲JSON書き込みエラー: {}", e))?;
        cmd.arg(json_path.to_string_lossy().to_string());
    }

    cmd.spawn()
        .map_err(|e| format!("KENBAN起動エラー: {}", e))?;

    Ok(())
}

/// Launch Tachimi with file paths for PDF generation
#[tauri::command]
pub async fn launch_tachimi(file_paths: Vec<String>) -> Result<(), String> {
    use std::process::Command;

    let local_app_data = std::env::var("LOCALAPPDATA")
        .map_err(|_| "LOCALAPPDATA not found".to_string())?;
    let tachimi_path = Path::new(&local_app_data).join("Tachimi").join("Tachimi.exe");

    if !tachimi_path.exists() {
        return Err(format!(
            "Tachimi.exe が見つかりません: {}",
            tachimi_path.display()
        ));
    }

    // ファイルパスをJSONでtempに書き出し
    let temp_dir = std::env::temp_dir();
    let json_path = temp_dir.join("tachimi_cli_files.json");
    let json_content = serde_json::to_string(&file_paths)
        .map_err(|e| format!("JSON変換エラー: {}", e))?;
    std::fs::write(&json_path, &json_content)
        .map_err(|e| format!("JSON書き込みエラー: {}", e))?;

    Command::new(&tachimi_path)
        .spawn()
        .map_err(|e| format!("Tachimi起動エラー: {}", e))?;

    Ok(())
}

// ============================================
// PSD Metadata Batch Parse (Rust-native)
// ============================================

#[derive(Serialize)]
pub struct PsdParseResult {
    #[serde(rename = "filePath")]
    pub file_path: String,
    pub metadata: Option<crate::psd_metadata::PsdMetadata>,
    #[serde(rename = "thumbnailData")]
    pub thumbnail_data: Option<String>,
    #[serde(rename = "fileSize")]
    pub file_size: u64,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn parse_psd_metadata_batch(
    file_paths: Vec<String>,
) -> Vec<PsdParseResult> {
    tokio::task::spawn_blocking(move || {
        use rayon::prelude::*;

        file_paths.par_iter().map(|path| {
            match crate::psd_metadata::parse_psd_file(path) {
                Ok((metadata, thumb_base64)) => {
                    // If no embedded JFIF thumbnail, generate from composite image
                    let thumbnail_data = thumb_base64.or_else(|| {
                        generate_thumbnail_from_composite(std::path::Path::new(path))
                    });
                    PsdParseResult {
                        file_path: path.clone(),
                        metadata: Some(metadata),
                        thumbnail_data,
                        file_size: std::fs::metadata(path).map(|m| m.len()).unwrap_or(0),
                        error: None,
                    }
                },
                Err(e) => PsdParseResult {
                    file_path: path.clone(),
                    metadata: None,
                    thumbnail_data: None,
                    file_size: std::fs::metadata(path).map(|m| m.len()).unwrap_or(0),
                    error: Some(e),
                },
            }
        }).collect()
    })
    .await
    .unwrap_or_default()
}

/// Generate a thumbnail from PSD composite image (Section 5) as fallback
/// when no embedded JFIF thumbnail exists in the PSD file.
fn generate_thumbnail_from_composite(path: &std::path::Path) -> Option<String> {
    let img = load_psd_composite(path).ok()?;

    // Resize to max 200px on longest side
    let (w, h) = img.dimensions();
    let max_dim = 200u32;
    let (new_w, new_h) = if w >= h {
        (max_dim, (h as f64 * max_dim as f64 / w as f64) as u32)
    } else {
        ((w as f64 * max_dim as f64 / h as f64) as u32, max_dim)
    };
    let thumb = img.resize_exact(new_w.max(1), new_h.max(1), FilterType::Triangle);

    // Encode as JPEG to a buffer
    let mut buf = std::io::Cursor::new(Vec::new());
    thumb.write_to(&mut buf, image::ImageFormat::Jpeg).ok()?;

    // Base64 encode
    Some(crate::psd_metadata::base64_encode(buf.get_ref()))
}

// ============================================
// Font Name Resolution
// ============================================

/// システムフォントDBのキャッシュ（フォントインストール後にリフレッシュ可能）
static FONT_DB: OnceLock<Mutex<Database>> = OnceLock::new();

fn get_font_db_lock() -> &'static Mutex<Database> {
    FONT_DB.get_or_init(|| {
        let mut db = Database::new();
        db.load_system_fonts();
        Mutex::new(db)
    })
}

fn refresh_font_db() {
    let lock = get_font_db_lock();
    let mut db = lock.lock().unwrap();
    *db = Database::new();
    db.load_system_fonts();
}

/// フォント解決結果
#[derive(Serialize)]
pub struct FontResolveInfo {
    pub display_name: String,
    pub style_name: String,
}

/// OpenType name table からサブファミリー名を抽出する
/// name ID 17 (Typographic Subfamily) を優先、なければ name ID 2 (Subfamily)
/// 日本語ロケール (language_id 0x0411) を優先、なければ英語 (0x0409)
fn extract_subfamily_name(db: &Database, face_id: fontdb::ID) -> Option<String> {
    let mut result: Option<String> = None;

    db.with_face_data(face_id, |data, face_index| {
        let face = match ttf_parser::Face::parse(data, face_index) {
            Ok(f) => f,
            Err(_) => return,
        };

        // name ID 17 (Typographic Subfamily) → name ID 2 (Subfamily) の優先順
        for target_id in [name_id::TYPOGRAPHIC_SUBFAMILY, name_id::SUBFAMILY] {
            let mut ja_name: Option<String> = None;
            let mut en_name: Option<String> = None;
            let mut any_name: Option<String> = None;

            for name in face.names() {
                if name.name_id != target_id {
                    continue;
                }
                if let Some(s) = name.to_string() {
                    // Platform 3 (Windows), language_id で判別
                    if name.platform_id == ttf_parser::PlatformId::Windows {
                        if name.language_id == 0x0411 {
                            ja_name = Some(s);
                        } else if name.language_id == 0x0409 {
                            en_name = Some(s);
                        } else if any_name.is_none() {
                            any_name = Some(s);
                        }
                    } else if any_name.is_none() {
                        any_name = Some(s);
                    }
                }
            }

            // 日本語 > 英語 > その他
            let found = ja_name.or(en_name).or(any_name);
            if found.is_some() {
                result = found;
                return;
            }
        }
    });

    result
}

// ============================================
// Scan PSD (フォントプリセット管理ツール)
// ============================================

/// Run scan_psd_core.jsx in Photoshop with settings JSON → results JSON pattern
#[tauri::command]
pub async fn run_photoshop_scan_psd(
    app_handle: tauri::AppHandle,
    settings_json: String,
) -> Result<String, String> {
    use std::process::Command;
    use std::io::Write;

    let ps_path = find_photoshop_path()
        .ok_or_else(|| "Photoshopが見つかりません。Adobe Photoshopをインストールしてください。".to_string())?;

    // Resolve script path (dev → resource)
    let resource_path = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("リソースディレクトリの取得に失敗: {}", e))?;

    let script_path_str = {
        let dev_script = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("scripts")
            .join("scan_psd_core.jsx");
        let bundled_script = resource_path.join("scripts").join("scan_psd_core.jsx");
        if dev_script.exists() {
            dev_script.to_string_lossy().to_string()
        } else if bundled_script.exists() {
            bundled_script.to_string_lossy().to_string()
        } else {
            return Err("scan_psd_core.jsx が見つかりません".to_string());
        }
    };

    let temp_dir = std::env::temp_dir();
    let settings_path = temp_dir.join("psd_scan_settings.json");
    let output_path = temp_dir.join("psd_scan_results.json");
    let progress_path = temp_dir.join("psd_scan_progress.json");

    // Clean up previous run
    let _ = fs::remove_file(&output_path);
    let _ = fs::remove_file(&progress_path);

    // Write settings JSON with BOM (required for ExtendScript Japanese paths)
    let mut settings_file = fs::File::create(&settings_path)
        .map_err(|e| format!("設定ファイルの作成に失敗: {}", e))?;
    settings_file.write_all(&[0xEF, 0xBB, 0xBF])
        .map_err(|e| format!("BOM書き込み失敗: {}", e))?;
    settings_file.write_all(settings_json.as_bytes())
        .map_err(|e| format!("設定書き込み失敗: {}", e))?;
    drop(settings_file);

    // Copy script to temp (avoids Japanese path DDE forwarding issues)
    let temp_script = temp_dir.join("scan_psd_core_temp.jsx");
    fs::copy(&script_path_str, &temp_script)
        .map_err(|e| format!("スクリプトのコピーに失敗: {}", e))?;
    let script_to_run = temp_script.to_string_lossy().to_string();

    eprintln!("Scan PSD - Photoshop: {}", ps_path);
    eprintln!("Scan PSD - Script (source): {}", script_path_str);
    eprintln!("Scan PSD - Script (temp): {}", script_to_run);

    // spawn() for non-blocking
    let _child = Command::new(&ps_path)
        .arg("-r")
        .arg(&script_to_run)
        .spawn()
        .map_err(|e| format!("Photoshop起動エラー: {}", e))?;

    // Poll for results — heartbeat-based timeout
    let poll_interval_ms: u64 = 500;
    let initial_timeout_secs: u64 = 600;  // 10 min for PS startup
    let final_timeout_secs: u64 = 120;    // 2 min after last file
    let mut last_progress = String::new();
    let mut polls_since_progress: u64 = 0;
    let mut all_done = false;

    loop {
        // Check if final result is ready
        if output_path.exists() {
            if let Ok(content) = fs::read_to_string(&output_path) {
                let trimmed = content.trim();
                // Skip BOM if present
                let json_str = if trimmed.starts_with('\u{feff}') {
                    &trimmed[3..]
                } else {
                    trimmed
                };
                if json_str.starts_with('{') {
                    eprintln!("Scan PSD output ready");
                    break;
                }
            }
        }

        // Check heartbeat progress file
        if let Ok(content) = fs::read_to_string(&progress_path) {
            let trimmed = content.trim().to_string();
            // Skip BOM
            let clean = if trimmed.starts_with('\u{feff}') {
                trimmed[3..].to_string()
            } else {
                trimmed
            };
            if !clean.is_empty() && clean != last_progress {
                eprintln!("Scan PSD progress: {}", clean);
                last_progress = clean.clone();
                polls_since_progress = 0;
                // Parse JSON progress {"current":X,"total":N,"message":"..."}
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&clean) {
                    if let (Some(c), Some(t)) = (v["current"].as_u64(), v["total"].as_u64()) {
                        all_done = c >= t && t > 0;
                    }
                }
            }
        }

        polls_since_progress += 1;

        let timeout_polls = if last_progress.is_empty() {
            (initial_timeout_secs * 1000) / poll_interval_ms
        } else if all_done {
            (final_timeout_secs * 1000) / poll_interval_ms
        } else {
            u64::MAX
        };

        if polls_since_progress >= timeout_polls {
            if last_progress.is_empty() {
                eprintln!("Scan PSD timed out (no heartbeat after {}s)", initial_timeout_secs);
            } else {
                eprintln!("Scan PSD timed out (result file not written after last progress)");
            }
            break;
        }

        std::thread::sleep(std::time::Duration::from_millis(poll_interval_ms));

        if polls_since_progress > 0 && polls_since_progress % 60 == 0 {
            eprintln!("Still waiting for Photoshop scan... ({}s since last progress)",
                polls_since_progress * poll_interval_ms / 1000);
        }
    }

    if output_path.exists() {
        let results_json = fs::read_to_string(&output_path)
            .map_err(|e| format!("結果ファイルの読み込み失敗: {}", e))?;

        // Strip BOM if present
        let clean_json = if results_json.starts_with('\u{feff}') {
            results_json[3..].to_string()
        } else {
            results_json
        };

        // Cleanup temp files
        let _ = fs::remove_file(&settings_path);
        let _ = fs::remove_file(&output_path);
        let _ = fs::remove_file(&progress_path);
        let _ = fs::remove_file(&temp_script);

        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.set_focus();
        }

        Ok(clean_json)
    } else {
        let _ = fs::remove_file(&temp_script);
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.set_focus();
        }
        Err("Photoshopが結果ファイルを出力しませんでした。スクリプトが失敗した可能性があります。".to_string())
    }
}

/// Poll scan PSD progress from temp file
#[tauri::command]
pub fn poll_scan_psd_progress() -> Result<Option<String>, String> {
    let progress_path = std::env::temp_dir().join("psd_scan_progress.json");
    if progress_path.exists() {
        let content = fs::read_to_string(&progress_path)
            .map_err(|e| format!("進捗ファイル読み込み失敗: {}", e))?;
        let trimmed = content.trim();
        let clean = if trimmed.starts_with('\u{feff}') {
            &trimmed[3..]
        } else {
            trimmed
        };
        if clean.is_empty() {
            Ok(None)
        } else {
            Ok(Some(clean.to_string()))
        }
    } else {
        Ok(None)
    }
}

/// 指定フォルダのPSD/PSBファイル有無を判定し、サブフォルダ一覧を返す
/// - 直下にPSD/PSBがある → そのフォルダ自身を返す
/// - 直下にPSD/PSBがない → PSD/PSBを含むサブフォルダ一覧を返す
#[tauri::command]
pub async fn detect_psd_folders(folder_path: String) -> Result<serde_json::Value, String> {
    let root = Path::new(&folder_path);
    if !root.is_dir() {
        return Err(format!("フォルダが存在しません: {}", folder_path));
    }

    let psd_extensions = ["psd", "psb"];

    // 直下のPSD/PSBファイルをチェック
    let has_direct_psd = fs::read_dir(root)
        .map_err(|e| format!("フォルダ読み込み失敗: {}", e))?
        .filter_map(|e| e.ok())
        .any(|entry| {
            if entry.file_type().map(|ft| ft.is_file()).unwrap_or(false) {
                if let Some(ext) = entry.path().extension() {
                    return psd_extensions.contains(&ext.to_string_lossy().to_lowercase().as_str());
                }
            }
            false
        });

    if has_direct_psd {
        // 直下にPSDがある → そのフォルダ自体を返す
        let name = root.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| folder_path.clone());
        return Ok(serde_json::json!({
            "mode": "direct",
            "folders": [{
                "path": folder_path,
                "name": name,
            }]
        }));
    }

    // サブフォルダを検索し、PSD/PSBを含むものを自然順ソートで返す
    let mut sub_results: Vec<(String, String)> = Vec::new();

    let entries = fs::read_dir(root)
        .map_err(|e| format!("フォルダ読み込み失敗: {}", e))?;

    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let dir_name = path.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        // _. で始まるフォルダを除外
        if dir_name.starts_with('_') || dir_name.starts_with('.') {
            continue;
        }
        // サブフォルダ内にPSD/PSBがあるか
        let has_psd = fs::read_dir(&path)
            .map(|rd| rd.filter_map(|e| e.ok()).any(|e| {
                if e.file_type().map(|ft| ft.is_file()).unwrap_or(false) {
                    if let Some(ext) = e.path().extension() {
                        return psd_extensions.contains(&ext.to_string_lossy().to_lowercase().as_str());
                    }
                }
                false
            }))
            .unwrap_or(false);

        if has_psd {
            sub_results.push((path.to_string_lossy().to_string(), dir_name));
        }
    }

    // 自然順ソート (1, 2, 10, 11)
    sub_results.sort_by(|a, b| natural_sort_cmp(&a.1, &b.1));

    let folders: Vec<serde_json::Value> = sub_results.iter().map(|(p, n)| {
        serde_json::json!({ "path": p, "name": n })
    }).collect();

    Ok(serde_json::json!({
        "mode": "subfolders",
        "folders": folders,
    }))
}

/// PostScript名から表示用フォント名（和名優先）・スタイル名を解決する
#[tauri::command]
pub fn resolve_font_names(postscript_names: Vec<String>) -> HashMap<String, FontResolveInfo> {
    let db = get_font_db_lock().lock().unwrap();
    let mut result = HashMap::new();

    for face in db.faces() {
        if postscript_names.contains(&face.post_script_name) {
            let display_name = face.families.iter()
                .find(|(_, lang)| *lang == Language::Japanese_Japan)
                .or_else(|| face.families.first())
                .map(|(name, _)| name.clone())
                .unwrap_or_else(|| face.post_script_name.clone());

            let style_name = extract_subfamily_name(&db, face.id)
                .unwrap_or_else(|| "Regular".to_string());

            result.insert(face.post_script_name.clone(), FontResolveInfo {
                display_name,
                style_name,
            });
        }
    }

    result
}

/// フォント名で部分一致検索する（PostScript名・表示名の両方を対象）
#[derive(Serialize, Clone)]
pub struct FontNameSearchResult {
    pub postscript_name: String,
    pub display_name: String,
    pub style_name: String,
}

#[tauri::command]
pub fn search_font_names(query: String, max_results: Option<usize>) -> Vec<FontNameSearchResult> {
    let db = get_font_db_lock().lock().unwrap();
    let query_lower = query.to_lowercase();
    let limit = max_results.unwrap_or(30);
    let mut results: Vec<FontNameSearchResult> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for face in db.faces() {
        if seen.contains(&face.post_script_name) {
            continue;
        }
        let ps_lower = face.post_script_name.to_lowercase();
        let display_name = face.families.iter()
            .find(|(_, lang)| *lang == Language::Japanese_Japan)
            .or_else(|| face.families.first())
            .map(|(name, _)| name.clone())
            .unwrap_or_else(|| face.post_script_name.clone());
        let display_lower = display_name.to_lowercase();

        if ps_lower.contains(&query_lower) || display_lower.contains(&query_lower) {
            let style_name = extract_subfamily_name(&db, face.id)
                .unwrap_or_else(|| "Regular".to_string());
            seen.insert(face.post_script_name.clone());
            results.push(FontNameSearchResult {
                postscript_name: face.post_script_name.clone(),
                display_name,
                style_name,
            });
            if results.len() >= limit {
                break;
            }
        }
    }

    results
}

// ============================================
// Font Folder Browser & Installation
// ============================================

/// フォントフォルダの内容を一覧する（フォント拡張子のみ、キャッシュ付き）
#[derive(Serialize, Clone)]
pub struct FontFolderContents {
    pub folders: Vec<String>,
    pub font_files: Vec<String>,
}

/// フォルダ一覧キャッシュ（ネットワーク共有の繰り返しアクセスを高速化）
static FONT_FOLDER_CACHE: OnceLock<Mutex<HashMap<String, FontFolderContents>>> = OnceLock::new();

fn get_font_folder_cache() -> &'static Mutex<HashMap<String, FontFolderContents>> {
    FONT_FOLDER_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

#[tauri::command]
pub async fn list_font_folder_contents(
    folder_path: String,
    no_cache: Option<bool>,
) -> Result<FontFolderContents, String> {
    // キャッシュ確認（no_cache=trueでスキップ）
    if !no_cache.unwrap_or(false) {
        let cache = get_font_folder_cache().lock().unwrap();
        if let Some(cached) = cache.get(&folder_path) {
            return Ok(cached.clone());
        }
    }

    let path_clone = folder_path.clone();
    let result = tokio::task::spawn_blocking(move || {
        let folder = Path::new(&path_clone);
        if !folder.exists() || !folder.is_dir() {
            return Err(format!("フォルダが見つかりません: {}", path_clone));
        }

        let font_exts = ["otf", "ttf", "ttc"];
        let mut folders = Vec::new();
        let mut font_files = Vec::new();

        let entries = fs::read_dir(folder)
            .map_err(|e| format!("フォルダ読み込みエラー: {}", e))?;

        for entry in entries.flatten() {
            let path = entry.path();
            // is_dir()/is_file() はネットワーク共有で遅いのでfile_type()を使う
            let ft = match entry.file_type() {
                Ok(ft) => ft,
                Err(_) => continue,
            };
            if ft.is_dir() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    folders.push(name.to_string());
                }
            } else if ft.is_file() {
                if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                    if font_exts.contains(&ext.to_lowercase().as_str()) {
                        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                            font_files.push(name.to_string());
                        }
                    }
                }
            }
        }

        folders.sort_by(|a, b| natural_sort_key(a).cmp(&natural_sort_key(b)));
        font_files.sort_by(|a, b| natural_sort_key(a).cmp(&natural_sort_key(b)));

        Ok(FontFolderContents { folders, font_files })
    })
    .await
    .map_err(|e| format!("タスクエラー: {}", e))??;

    // キャッシュに保存
    {
        let mut cache = get_font_folder_cache().lock().unwrap();
        cache.insert(folder_path, result.clone());
    }

    Ok(result)
}

/// フォントフォルダ内をファイル名で再帰検索
#[derive(Serialize, Clone)]
pub struct FontSearchResult {
    pub file_name: String,
    pub relative_path: String,
    pub full_path: String,
}

/// フォント検索用インメモリインデックス（初回スキャン後はメモリ内フィルタリングで即座に結果返却）
struct FontFileIndex {
    base_path: String,
    entries: Vec<FontSearchResult>,
}

static FONT_FILE_INDEX: OnceLock<Mutex<Option<FontFileIndex>>> = OnceLock::new();

fn get_font_file_index() -> &'static Mutex<Option<FontFileIndex>> {
    FONT_FILE_INDEX.get_or_init(|| Mutex::new(None))
}

/// インデックスを構築（walkdirで全フォントファイルを列挙）
fn build_font_file_index(base_path: &str) -> Result<Vec<FontSearchResult>, String> {
    let base = Path::new(base_path);
    if !base.exists() {
        return Err(format!("フォルダが見つかりません: {}", base_path));
    }

    let font_exts: std::collections::HashSet<&str> =
        ["otf", "ttf", "ttc"].into_iter().collect();
    let mut entries = Vec::new();

    for entry in walkdir::WalkDir::new(base)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if entry.file_type().is_dir() { continue; }
        let path = entry.path();

        let ext_match = path.extension()
            .and_then(|e| e.to_str())
            .map(|e| font_exts.contains(e.to_lowercase().as_str()))
            .unwrap_or(false);
        if !ext_match { continue; }

        let file_name = path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        let relative = path.strip_prefix(base)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();

        entries.push(FontSearchResult {
            file_name,
            relative_path: relative,
            full_path: path.to_string_lossy().to_string(),
        });
    }

    entries.sort_by(|a, b| natural_sort_key(&a.file_name).cmp(&natural_sort_key(&b.file_name)));
    Ok(entries)
}

#[tauri::command]
pub async fn search_font_files(
    base_path: String,
    query: String,
    no_cache: Option<bool>,
) -> Result<Vec<FontSearchResult>, String> {
    let base_path_clone = base_path.clone();
    tokio::task::spawn_blocking(move || {
        // キャッシュ確認（同じbase_pathのインデックスがあればメモリ内検索）
        if !no_cache.unwrap_or(false) {
            let index = get_font_file_index().lock().unwrap();
            if let Some(ref idx) = *index {
                if idx.base_path == base_path_clone {
                    // インメモリフィルタリング（即座に結果返却）
                    let query_lower = query.to_lowercase();
                    let results: Vec<FontSearchResult> = idx.entries.iter()
                        .filter(|e| e.file_name.to_lowercase().contains(&query_lower))
                        .take(200)
                        .cloned()
                        .collect();
                    return Ok(results);
                }
            }
        }
        // インデックス未構築 or base_path変更 or no_cache → フルスキャン
        drop(get_font_file_index().lock()); // ロック解放
        let entries = build_font_file_index(&base_path_clone)?;

        // インデックスをキャッシュに保存
        {
            let mut index = get_font_file_index().lock().unwrap();
            *index = Some(FontFileIndex {
                base_path: base_path_clone.clone(),
                entries: entries.clone(),
            });
        }

        // クエリでフィルタリング
        let query_lower = query.to_lowercase();
        let results: Vec<FontSearchResult> = entries.into_iter()
            .filter(|e| e.file_name.to_lowercase().contains(&query_lower))
            .take(200)
            .collect();
        Ok(results)
    })
    .await
    .map_err(|e| format!("タスクエラー: {}", e))?
}

/// フォントファイルをユーザーフォントディレクトリにインストール
#[tauri::command]
pub async fn install_font_from_path(font_path: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        install_font_from_path_inner(&font_path)
    })
    .await
    .map_err(|e| format!("タスクエラー: {}", e))?
}

fn install_font_from_path_inner(font_path: &str) -> Result<String, String> {
    let src = Path::new(font_path);
    if !src.exists() {
        return Err(format!("フォントファイルが見つかりません: {}", font_path));
    }

    let file_name = src.file_name()
        .ok_or_else(|| "ファイル名を取得できません".to_string())?
        .to_string_lossy().to_string();

    // フォントメタデータからフルネーム取得
    let data = fs::read(src)
        .map_err(|e| format!("フォントファイルの読み込みに失敗: {}", e))?;
    let face = ttf_parser::Face::parse(&data, 0).ok();

    let font_full_name = face.as_ref().and_then(|f| {
        let mut ja = None;
        let mut en = None;
        let mut any = None;
        for name in f.names() {
            if name.name_id != name_id::FULL_NAME { continue; }
            if let Some(s) = name.to_string() {
                if name.platform_id == ttf_parser::PlatformId::Windows {
                    if name.language_id == 0x0411 { ja = Some(s.clone()); }
                    else if name.language_id == 0x0409 && en.is_none() { en = Some(s.clone()); }
                }
                if any.is_none() { any = Some(s); }
            }
        }
        ja.or(en).or(any)
    }).unwrap_or_else(|| {
        file_name.rsplit('.').last().unwrap_or(&file_name).to_string()
    });

    // フォントタイプ判定
    let ext_lower = src.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let font_type_label = if ext_lower == "otf" { "OpenType" } else { "TrueType" };

    // ユーザーフォントディレクトリ
    let local_app_data = std::env::var("LOCALAPPDATA")
        .map_err(|_| "LOCALAPPDATA 環境変数が見つかりません".to_string())?;
    let user_fonts_dir = Path::new(&local_app_data).join("Microsoft").join("Windows").join("Fonts");
    let _ = fs::create_dir_all(&user_fonts_dir);

    let dest = user_fonts_dir.join(&file_name);
    fs::copy(src, &dest)
        .map_err(|e| format!("フォントのコピーに失敗: {}", e))?;

    let dest_str = dest.to_string_lossy().to_string();

    // AddFontResourceExW で即座にシステムに登録
    #[cfg(target_os = "windows")]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;

        #[link(name = "gdi32")]
        extern "system" {
            fn AddFontResourceExW(name: *const u16, fl: u32, res: *const std::ffi::c_void) -> i32;
        }
        #[link(name = "user32")]
        extern "system" {
            fn SendMessageTimeoutW(
                hwnd: isize, msg: u32, wparam: usize, lparam: isize,
                flags: u32, timeout: u32, result: *mut usize,
            ) -> isize;
        }

        const HWND_BROADCAST: isize = 0xFFFF;
        const WM_FONTCHANGE: u32 = 0x001D;
        const SMTO_ABORTIFHUNG: u32 = 0x0002;

        let wide: Vec<u16> = OsStr::new(&dest_str).encode_wide().chain(std::iter::once(0)).collect();
        unsafe {
            let added = AddFontResourceExW(wide.as_ptr(), 0, std::ptr::null());
            if added > 0 {
                // SendMessageTimeoutW: 応答しないウィンドウでブロックしない（1秒タイムアウト）
                let mut _result: usize = 0;
                SendMessageTimeoutW(
                    HWND_BROADCAST, WM_FONTCHANGE, 0, 0,
                    SMTO_ABORTIFHUNG, 1000, &mut _result,
                );
                eprintln!("Font installed: {} ({} faces)", font_full_name, added);
            }
        }
    }

    // レジストリに登録
    let reg_value_name = format!("{} ({})", font_full_name, font_type_label);
    let _reg_result = std::process::Command::new("reg")
        .args([
            "add",
            r"HKCU\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts",
            "/v", &reg_value_name,
            "/t", "REG_SZ",
            "/d", &dest_str,
            "/f",
        ])
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .output();

    // fontdb キャッシュをリフレッシュ
    refresh_font_db();

    Ok(dest_str)
}

// ============================================
// Photoshop Custom Operations
// ============================================

#[tauri::command]
pub async fn run_photoshop_custom_operations(
    app_handle: tauri::AppHandle,
    file_paths: Vec<String>,
    file_ops: Vec<serde_json::Value>,
    save_mode: Option<String>,
    delete_hidden_text: Option<bool>,
) -> Result<Vec<PhotoshopResult>, String> {
    use std::process::Command;
    use std::io::Write;

    let ps_path = find_photoshop_path()
        .ok_or_else(|| "Photoshop not found. Please install Adobe Photoshop.".to_string())?;

    let resource_path = app_handle.path().resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;
    let script_path = resource_path.join("scripts").join("custom_operations.jsx");
    let script_path_str = if script_path.exists() {
        script_path.to_string_lossy().to_string()
    } else {
        let dev_script = Path::new(env!("CARGO_MANIFEST_DIR")).join("scripts").join("custom_operations.jsx");
        if dev_script.exists() { dev_script.to_string_lossy().to_string() }
        else { return Err("Custom operations script not found".to_string()); }
    };

    let temp_dir = std::env::temp_dir();
    let settings_path = temp_dir.join("psd_custom_operations_settings.json");
    let output_path = temp_dir.join("psd_custom_operations_results.json");
    let _ = fs::remove_file(&output_path);

    let save_folder = if save_mode.as_deref() == Some("copyToFolder") {
        let home = std::env::var("USERPROFILE").unwrap_or_else(|_| std::env::var("HOME").unwrap_or_default());
        let parent_name = file_paths.first()
            .and_then(|p| Path::new(p).parent().and_then(|par| par.file_name()).map(|n| n.to_string_lossy().to_string()))
            .unwrap_or_else(|| "output".to_string());
        let folder = Path::new(&home).join("Desktop").join("Script_Output").join("custom_ops").join(&parent_name);
        let _ = fs::create_dir_all(&folder);
        Some(folder.to_string_lossy().to_string().replace("\\", "/"))
    } else { None };

    let settings = serde_json::json!({
        "files": file_paths.iter().map(|p| p.replace("\\", "/")).collect::<Vec<_>>(),
        "fileOps": file_ops,
        "outputPath": output_path.to_string_lossy().to_string().replace("\\", "/"),
        "saveFolder": save_folder,
        "deleteHiddenText": delete_hidden_text.unwrap_or(false),
    });
    let settings_json = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;
    let mut sf = fs::File::create(&settings_path)
        .map_err(|e| format!("Failed to create settings file: {}", e))?;
    sf.write_all(&[0xEF, 0xBB, 0xBF]).map_err(|e| format!("BOM write error: {}", e))?;
    sf.write_all(settings_json.as_bytes()).map_err(|e| format!("Settings write error: {}", e))?;

    eprintln!("Custom ops - PS: {}, Script: {}, Files: {}", ps_path, script_path_str, file_paths.len());

    let _output = Command::new(&ps_path).arg("-r").arg(&script_path_str).output()
        .map_err(|e| format!("Failed to run Photoshop: {}", e))?;

    let max_polls = (120 * 1000) / 500;
    for poll in 0..max_polls {
        if output_path.exists() {
            if let Ok(content) = fs::read_to_string(&output_path) {
                if content.trim().starts_with('[') && content.trim().ends_with(']') {
                    eprintln!("Custom ops output ready after {} polls", poll);
                    break;
                }
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
        if poll > 0 && poll % 20 == 0 { eprintln!("Waiting for Photoshop... ({}s)", poll / 2); }
    }

    if output_path.exists() {
        let rj = fs::read_to_string(&output_path).map_err(|e| format!("Failed to read results: {}", e))?;
        let results: Vec<PhotoshopResult> = serde_json::from_str(&rj)
            .map_err(|e| format!("Failed to parse results: {}. JSON: {}", e, rj))?;
        let _ = fs::remove_file(&settings_path);
        let _ = fs::remove_file(&output_path);
        if let Some(w) = app_handle.get_webview_window("main") { let _ = w.set_focus(); }
        Ok(results)
    } else {
        if let Some(w) = app_handle.get_webview_window("main") { let _ = w.set_focus(); }
        Err("Photoshop did not produce output file. Script may have failed.".to_string())
    }
}
