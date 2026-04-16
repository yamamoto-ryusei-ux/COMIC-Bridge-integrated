// グローバルなPSDローダーの登録レジストリ
// React コンポーネント外（WorkflowBar の executeStepNav など）から
// loadFolder / loadFiles を呼び出すための中継点
//
// AppLayout 内で RegisterPsdLoader を一度だけレンダリングして登録する

type LoadFolderFn = (path: string) => Promise<void>;
type LoadFilesFn = (paths: string[]) => Promise<void>;

let _loadFolder: LoadFolderFn | null = null;
let _loadFiles: LoadFilesFn | null = null;

export function registerPsdLoader(lf: LoadFolderFn, lfs: LoadFilesFn) {
  _loadFolder = lf;
  _loadFiles = lfs;
}

export async function globalLoadFolder(path: string): Promise<void> {
  if (_loadFolder) return _loadFolder(path);
}

export async function globalLoadFiles(paths: string[]): Promise<void> {
  if (_loadFiles) return _loadFiles(paths);
}
