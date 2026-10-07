import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readArtifactRecord, publishArtifactFiles } from "./lib/build-artifact-cache.mts";
import { TSDOWN_NON_SDK_DTS_CONFIG_GROUPS } from "./lib/tsdown-config-groups.mts";
import { listReplaceableTsdownDeclarationOutputs } from "./tsdown-build.mts";

/** Rejoin compiler groups built by this workflow's six isolated CI jobs. */
export function restoreCiUnifiedDeclarations(root = process.cwd()) {
  if (process.env.GITHUB_ACTIONS !== "true") {
    throw new Error("Prebuilt declaration restoration is only available in GitHub Actions");
  }
  const declarations = new Map<string, string>();
  for (const group of TSDOWN_NON_SDK_DTS_CONFIG_GROUPS) {
    const cache = path.join(root, ".artifacts", "build-all-cache", `tsdown-unified-${group}`);
    const record = readArtifactRecord(path.join(cache, "stamp.json"));
    if (!record?.inputs?.length || !record.outputs[`compiler-inputs/${group}.json`]) {
      throw new Error(`Missing complete CI declaration cache for ${group}`);
    }
    const sourceRoot = path.join(cache, "outputs");
    let count = 0;
    for (const [file, expected] of Object.entries(record.outputs)) {
      const source = path.resolve(sourceRoot, file);
      if (createHash("sha256").update(fs.readFileSync(source)).digest("hex") !== expected) {
        throw new Error(`CI declaration cache digest mismatch: ${group}/${file}`);
      }
      if (!/^dist\/.+\.d\.[cm]?ts$/u.test(file)) {
        continue;
      }
      if (declarations.has(file)) {
        throw new Error(`Duplicate CI declaration output: ${file}`);
      }
      declarations.set(file, sourceRoot);
      count++;
    }
    if (!count) {
      throw new Error(`Empty CI declaration cache for ${group}`);
    }
  }
  for (const file of listReplaceableTsdownDeclarationOutputs({ cwd: root, roots: ["dist"] })) {
    fs.rmSync(file);
  }
  for (const [file, sourceRoot] of declarations) {
    publishArtifactFiles(sourceRoot, root, [file]);
  }
  console.log(`Restored ${declarations.size} verified declarations from CI compiler shards`);
}
