export function resolveBranchCompileCacheDirectory(params: {
  installRoot: string;
  env?: NodeJS.ProcessEnv;
}): string;
export function maintainBranchCompileCache(directory: string): Promise<void>;
