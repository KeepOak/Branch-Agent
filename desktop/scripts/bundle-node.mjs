import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Copy the packaging host's Node24 runtime into the portable app; never download/alter a system installation. */
export function validateRuntime(runtime, target) {
  const parts = /^v(\d+)\.(\d+)\.(\d+)$/.exec(runtime.version);
  if (!parts || Number(parts[1]) !== 24 || Number(parts[2]) < 16) throw new Error("Package the engine's supported Node24.16+ runtime");
  if (runtime.platform !== target.platform || runtime.arch !== target.arch) throw new Error("Bundled Node runtime does not match the package platform/architecture");
}

export async function bundleNode(resources, executable = process.env.BRANCH_DESKTOP_NODE ?? process.execPath, target = { platform: process.platform, arch: process.arch }) {
  const runtime = JSON.parse(execFileSync(executable, ["-p", 'JSON.stringify({version:process.version,platform:process.platform,arch:process.arch})'], { encoding: "utf8", windowsHide: true, timeout: 5000 }));
  validateRuntime(runtime, target);
  const { version, platform, arch } = runtime;
  const directory = join(resources, "node"); await mkdir(directory, { recursive: true });
  const file = join(directory, platform === "win32" ? "node.exe" : "node");
  await copyFile(executable, file);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  const receipt = { version, sha256: hash.digest("hex"), platform, arch };
  await writeFile(join(directory, "node-runtime.json"), JSON.stringify(receipt, null, 2) + "\n");
  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error("Pass the packaged application's resources directory");
  const receipt = await bundleNode(process.argv[2], undefined, { platform: process.argv[3] ?? process.platform, arch: process.argv[4] ?? process.arch });
  console.log(`Bundled ${receipt.version} ${receipt.platform}/${receipt.arch}`);
}
