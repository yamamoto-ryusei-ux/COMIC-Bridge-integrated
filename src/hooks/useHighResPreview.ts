import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";

interface HighResPreviewResult {
  file_path: string;
  original_width: number;
  original_height: number;
  preview_width: number;
  preview_height: number;
}

interface UseHighResPreviewOptions {
  maxSize?: number;
  enabled?: boolean;
  pdfPageIndex?: number;
  pdfSourcePath?: string;
}

interface UseHighResPreviewReturn {
  imageUrl: string | null;
  originalSize: { width: number; height: number } | null;
  previewSize: { width: number; height: number } | null;
  isLoading: boolean;
  error: string | null;
  reload: () => void;
}

/** フロントエンド側URLキャッシュ（asset:// URL + サイズ情報） */
const urlCache = new Map<
  string,
  {
    url: string;
    original: { width: number; height: number };
    preview: { width: number; height: number };
  }
>();
const MAX_URL_CACHE = 50;

function cacheKey(filePath: string, maxSize: number, pdfPageIndex?: number) {
  return `${filePath}::${maxSize}::${pdfPageIndex ?? -1}`;
}

/**
 * 特定ファイルのフロントエンドURLキャッシュを無効化。
 * ファイルが外部で変更されたときに呼ぶ。
 */
export function invalidateUrlCache(filePath: string): void {
  const normalized = filePath.replace(/\//g, "\\").toLowerCase();
  for (const key of urlCache.keys()) {
    if (key.toLowerCase().startsWith(normalized + "::")) {
      urlCache.delete(key);
    }
  }
}

/**
 * Rust側のキャッシュをウォームアップ（結果はURLキャッシュにも保存）。
 * コンポーネント外から呼べるのでプリフェッチに最適。
 */
export async function prefetchPreview(
  filePath: string,
  maxSize: number,
  pdfPageIndex?: number,
  pdfSourcePath?: string,
): Promise<void> {
  const key = cacheKey(filePath, maxSize, pdfPageIndex);
  if (urlCache.has(key)) return; // 既にフロント側キャッシュ済み

  try {
    let result: HighResPreviewResult;
    if (pdfPageIndex !== undefined && pdfSourcePath) {
      result = await invoke<HighResPreviewResult>("get_pdf_preview", {
        filePath: pdfSourcePath,
        pageIndex: pdfPageIndex,
        maxSize,
      });
    } else {
      result = await invoke<HighResPreviewResult>("get_high_res_preview", {
        filePath,
        maxSize,
      });
    }
    const assetUrl = convertFileSrc(result.file_path);
    if (urlCache.size >= MAX_URL_CACHE) {
      // 古いエントリを削除
      const first = urlCache.keys().next().value;
      if (first !== undefined) urlCache.delete(first);
    }
    urlCache.set(key, {
      url: assetUrl,
      original: { width: result.original_width, height: result.original_height },
      preview: { width: result.preview_width, height: result.preview_height },
    });
  } catch {
    // プリフェッチ失敗は無視（通常ロード時にリトライされる）
  }
}

/**
 * High-resolution preview hook for the guide editor & viewer.
 * - ロード中も前の画像を維持（ちらつき防止）
 * - フロントエンド側URLキャッシュでキャッシュヒット時は即座に表示
 */
export function useHighResPreview(
  filePath: string | undefined,
  options: UseHighResPreviewOptions = {},
): UseHighResPreviewReturn {
  const { maxSize = 1200, enabled = true, pdfPageIndex, pdfSourcePath } = options;

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [originalSize, setOriginalSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [previewSize, setPreviewSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // リクエストの陳腐化検出用
  const requestIdRef = useRef(0);

  const loadPreview = useCallback(async () => {
    if (!filePath || !enabled) {
      setImageUrl(null);
      setOriginalSize(null);
      setPreviewSize(null);
      setError(null);
      return;
    }

    const thisRequest = ++requestIdRef.current;

    // フロントキャッシュヒット → 即座に表示（isLoadingなし）
    const key = cacheKey(filePath, maxSize, pdfPageIndex);
    const cached = urlCache.get(key);
    if (cached) {
      setImageUrl(cached.url);
      setOriginalSize(cached.original);
      setPreviewSize(cached.preview);
      setIsLoading(false);
      setError(null);
      return;
    }

    // ロード開始（前の imageUrl はそのまま維持 — ちらつき防止）
    setIsLoading(true);
    setError(null);

    try {
      let result: HighResPreviewResult;

      if (pdfPageIndex !== undefined && pdfSourcePath) {
        result = await invoke<HighResPreviewResult>("get_pdf_preview", {
          filePath: pdfSourcePath,
          pageIndex: pdfPageIndex,
          maxSize,
        });
      } else {
        result = await invoke<HighResPreviewResult>("get_high_res_preview", {
          filePath,
          maxSize,
        });
      }

      // 古いリクエストの結果は無視
      if (thisRequest !== requestIdRef.current) return;

      const assetUrl = convertFileSrc(result.file_path);

      // URLキャッシュに保存
      if (urlCache.size >= MAX_URL_CACHE) {
        const first = urlCache.keys().next().value;
        if (first !== undefined) urlCache.delete(first);
      }
      urlCache.set(key, {
        url: assetUrl,
        original: { width: result.original_width, height: result.original_height },
        preview: { width: result.preview_width, height: result.preview_height },
      });

      setImageUrl(assetUrl);
      setOriginalSize({
        width: result.original_width,
        height: result.original_height,
      });
      setPreviewSize({
        width: result.preview_width,
        height: result.preview_height,
      });
    } catch (err) {
      if (thisRequest !== requestIdRef.current) return;
      console.error("Failed to load high-res preview:", err);
      setError(err instanceof Error ? err.message : String(err));
      setImageUrl(null);
      setOriginalSize(null);
      setPreviewSize(null);
    } finally {
      if (thisRequest === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [filePath, maxSize, enabled, pdfPageIndex, pdfSourcePath]);

  // Load preview when filePath changes
  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  // Cleanup old preview files periodically
  useEffect(() => {
    const cleanup = async () => {
      try {
        await invoke("cleanup_preview_files");
      } catch (err) {
        console.warn("Failed to cleanup preview files:", err);
      }
    };

    cleanup();
    const interval = setInterval(cleanup, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  return {
    imageUrl,
    originalSize,
    previewSize,
    isLoading,
    error,
    reload: loadPreview,
  };
}
