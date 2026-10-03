import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveStateDir } from "branch/plugin-sdk/state-paths";
const CANOPY_DB_RELATIVE_PATH = ["plugins", "canopy", "canopy.sqlite"] as const;

export function resolveCanopySqlitePath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveStateDir(env), ...CANOPY_DB_RELATIVE_PATH);
}

export function resolveCanopySqliteWorkerModuleUrl(runtimeSource: string | undefined): URL {
  if (!runtimeSource) {
    throw new Error("Canopy requires runtime entrypoint metadata");
  }
  return new URL(
    `./src/sqlite-store.worker${path.extname(runtimeSource)}`,
    pathToFileURL(runtimeSource),
  );
}
