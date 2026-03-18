use tauri::{Emitter, Manager};

mod commands;
pub mod pdf;
pub mod psd_metadata;
pub mod watcher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            commands::resample_image,
            commands::batch_resample_images,
            commands::convert_color_mode,
            commands::get_image_info,
            commands::check_photoshop_installed,
            commands::run_photoshop_conversion,
            commands::run_photoshop_guide_apply,
            commands::run_photoshop_prepare,
            commands::run_photoshop_layer_visibility,
            commands::run_photoshop_layer_organize,
            commands::run_photoshop_layer_move,
            commands::run_photoshop_layer_lock,
            commands::run_photoshop_merge_layers,
            commands::run_photoshop_split,
            commands::get_high_res_preview,
            commands::cleanup_preview_files,
            commands::clear_psd_cache,
            commands::list_folder_files,
            commands::list_subfolders,
            commands::list_folder_contents,
            commands::search_json_folders,
            commands::read_text_file,
            commands::write_text_file,
            commands::write_binary_file,
            commands::delete_file,
            commands::path_exists,
            commands::run_photoshop_replace,
            commands::run_photoshop_rename,
            commands::batch_rename_files,
            commands::open_folder_in_explorer,
            commands::reveal_files_in_explorer,
            commands::open_file_in_photoshop,
            commands::get_pdf_info,
            commands::get_pdf_preview,
            commands::get_pdf_thumbnail,
            commands::run_photoshop_tiff_convert,
            commands::launch_kenban_diff,
            commands::launch_tachimi,
            commands::launch_progen,
            commands::resolve_font_names,
            commands::search_font_names,
            commands::list_font_folder_contents,
            commands::search_font_files,
            commands::install_font_from_path,
            commands::run_photoshop_scan_psd,
            commands::poll_scan_psd_progress,
            commands::detect_psd_folders,
            commands::list_all_files,
            commands::open_with_default_app,
            commands::parse_psd_metadata_batch,
            commands::run_photoshop_custom_operations,
            commands::start_file_watcher,
            commands::stop_file_watcher,
            commands::invalidate_file_cache,
            commands::check_handoff,
        ])
        .setup(|app| {
            // CLI引数から校正データJSONパスを検出してフロントエンドに通知
            let args: Vec<String> = std::env::args().collect();
            if let Some(pos) = args.iter().position(|a| a == "--proofreading-json") {
                if let Some(json_path) = args.get(pos + 1) {
                    let window = app.get_webview_window("main").unwrap();
                    let path = json_path.clone();
                    std::thread::spawn(move || {
                        // フロントエンドの初期化完了を待つ
                        std::thread::sleep(std::time::Duration::from_millis(1500));
                        let _ = window.emit("open-proofreading-json", &path);
                    });
                }
            }

            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            Ok(())
        })
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // Clean up temp files on app exit (max_age = 0 removes all matching files)
                let _ = commands::cleanup_temp_files(0);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
