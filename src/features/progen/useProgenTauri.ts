/**
 * ProGen Tauri コマ���ドラッパー
 * tauri-bridge.js の window.electronAPI を直接 invoke に置換
 */
import { invoke } from "@tauri-apps/api/core";

// ═══ JSON/ルール管理 ═══

export async function getJsonFolderPath(): Promise<string> {
  return invoke<string>("progen_get_json_folder_path");
}

export async function listDirectory(dirPath: string): Promise<{ folders: string[]; json_files: string[] }> {
  return invoke("progen_list_directory", { dirPath });
}

export async function readJsonFile(filePath: string): Promise<any> {
  return invoke("progen_read_json_file", { filePath });
}

export async function writeJsonFile(filePath: string, data: any): Promise<any> {
  return invoke("progen_write_json_file", { filePath, data });
}

// ═══ マスタールール ═══

export async function readMasterRule(labelValue: string): Promise<{ success: boolean; data?: any; error?: string }> {
  return invoke("progen_read_master_rule", { labelValue });
}

export async function writeMasterRule(labelValue: string, data: any): Promise<any> {
  return invoke("progen_write_master_rule", { labelValue, data });
}

export async function createMasterLabel(labelKey: string, displayName: string): Promise<any> {
  return invoke("progen_create_master_label", { labelKey, displayName });
}

export async function getMasterLabelList(): Promise<{ success: boolean; labels: { key: string; display_name?: string; displayName?: string }[] }> {
  return invoke("progen_get_master_label_list");
}

// ═══ テキストフォルダ ══���

export async function getTxtFolderPath(): Promise<string> {
  return invoke<string>("progen_get_txt_folder_path");
}

export async function listTxtDirectory(dirPath: string): Promise<any> {
  return invoke("progen_list_txt_directory", { dirPath });
}

export async function readTxtFile(filePath: string): Promise<string> {
  return invoke("progen_read_txt_file", { filePath });
}

export async function writeTextFile(filePath: string, content: string): Promise<any> {
  return invoke("progen_write_text_file", { filePath, content });
}

export async function readDroppedTxtFiles(paths: string[]): Promise<any> {
  return invoke("progen_read_dropped_txt_files", { paths });
}

export async function createTxtWorkFolder(label: string, work: string): Promise<any> {
  return invoke("progen_create_txt_work_folder", { label, work });
}

// ═══ ファイルダイアログ ═══

export async function showSaveTextDialog(defaultName: string): Promise<string | null> {
  return invoke("progen_show_save_text_dialog", { defaultName });
}

export async function showSaveJsonDialog(defaultPath: string, defaultName: string): Promise<string | null> {
  return invoke("progen_show_save_json_dialog", { defaultPath, defaultName });
}

export async function openAndReadJsonDialog(): Promise<any> {
  return invoke("progen_open_and_read_json_dialog");
}

export async function showOpenImageFolderDialog(): Promise<string | null> {
  return invoke("progen_show_open_image_folder_dialog");
}

// ═══ 画像 ═══

export async function listImageFiles(dirPath: string): Promise<string[]> {
  return invoke("progen_list_image_files", { dirPath });
}

export async function listImageFilesFromPaths(paths: string[]): Promise<string[]> {
  return invoke("progen_list_image_files_from_paths", { paths });
}

export async function loadImagePreview(filePath: string, maxSize?: number): Promise<string> {
  return invoke("progen_load_image_preview", { filePath, maxSize: maxSize || 800 });
}

// ═══ データ保存 ═══

export async function saveCalibrationData(params: any): Promise<any> {
  return invoke("progen_save_calibration_data", params);
}

// ═══ 連携 ═══

export async function launchComicBridge(jsonFilePath: string): Promise<any> {
  return invoke("progen_launch_comic_bridge", { jsonFilePath });
}

export async function getComicPotHandoff(): Promise<any> {
  return invoke("progen_get_comicpot_handoff");
}

// ═══ 外部リンク ═══

export async function openExternalUrl(url: string): Promise<void> {
  return invoke("open_with_default_app", { filePath: url });
}
