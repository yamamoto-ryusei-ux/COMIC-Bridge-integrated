use tauri::{Emitter, Manager};

mod commands;
pub mod kenban;
pub mod pdf;
pub mod progen;
pub mod psd_metadata;
pub mod watcher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(kenban::KenbanState::default())
        .manage(progen::ProgenState::default())
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
            commands::duplicate_files,
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
            commands::get_file_times,
            // KENBAN commands
            kenban::kenban_parse_psd,
            kenban::kenban_open_file_with_default_app,
            kenban::kenban_open_file_in_photoshop,
            kenban::kenban_save_screenshot,
            kenban::open_folder,
            kenban::open_pdf_in_mojiq,
            kenban::decode_and_resize_image,
            kenban::preload_images,
            kenban::clear_image_cache,
            kenban::kenban_list_files_in_folder,
            kenban::kenban_cleanup_preview_cache,
            kenban::compute_diff_simple,
            kenban::compute_diff_heatmap,
            kenban::check_diff_simple,
            kenban::check_diff_heatmap,
            kenban::compute_pdf_diff,
            kenban::kenban_render_pdf_page,
            kenban::kenban_get_pdf_page_count,
            kenban::kenban_get_cli_args,
            kenban::kenban_read_text_file,
            kenban::kenban_write_text_file,
            // ProGen commands
            progen::progen_get_json_folder_path,
            progen::progen_list_directory,
            progen::progen_read_json_file,
            progen::progen_write_json_file,
            progen::progen_read_master_rule,
            progen::progen_write_master_rule,
            progen::progen_create_master_label,
            progen::progen_get_master_label_list,
            progen::progen_create_txt_work_folder,
            progen::progen_get_txt_folder_path,
            progen::progen_list_txt_directory,
            progen::progen_read_txt_file,
            progen::progen_write_text_file,
            progen::progen_read_dropped_txt_files,
            progen::progen_show_save_text_dialog,
            progen::progen_save_calibration_data,
            progen::progen_print_to_pdf,
            progen::progen_list_image_files,
            progen::progen_list_image_files_from_paths,
            progen::progen_load_image_preview,
            progen::progen_show_open_image_folder_dialog,
            progen::progen_show_save_json_dialog,
            progen::progen_open_and_read_json_dialog,
            progen::progen_launch_comic_bridge,
            progen::progen_get_comicpot_handoff,
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
