import path from "node:path";
import { pathToFileURL } from "node:url";

export function resolveCanopySqliteWorkerModuleUrl(runtimeSource: string | undefined): URL {
  if (!runtimeSource) {
    throw new Error("Canopy requires runtime entrypoint metadata");
  }
  return new URL(
    `./src/sqlite-store.worker${path.extname(runtimeSource)}`,
    pathToFileURL(runtimeSource),
  );
}
