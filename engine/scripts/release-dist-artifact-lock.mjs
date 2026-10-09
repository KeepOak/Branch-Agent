#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { registerToolingTsx } from "./lib/tsx-cli-shim.mjs";

await registerToolingTsx();
const { releaseDistArtifactLock } = await import("./lib/dist-artifact-lock.mts");
try {
  await releaseDistArtifactLock(fileURLToPath(new URL("../", import.meta.url)), process.argv[2]);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
