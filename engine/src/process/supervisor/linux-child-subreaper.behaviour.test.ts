// Written by Branch for SESSIONS-0102 using openclaw/openclaw@40ee2cbdd25bd2eadf01ea9685464502509771e3 native child-owner behavior; not copied.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";
import { afterEach, describe, expect, it } from "vitest";
import { requireNodeTool } from "../../../test/helpers/node-toolchain.js";
import { useAutoCleanupTempDirTracker } from "../../../test/helpers/temp-dir.js";
import { runtimeProcessEntrypoints } from "../../infra/runtime-process-entrypoints.js";
import { linuxSiginfoPidOffset } from "./linux-child-subreaper.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
const runFile = promisify(execFile);
const nativeLinux = process.platform === "linux" && ["x64", "arm64"].includes(process.arch);
const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));
const engineRoot = path.resolve(sourceRoot, "..");
const builtRoots: string[] = [];

afterEach(() => {
  for (const dir of builtRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * The owner refuses source loaders, so every native case runs built output in
 * a dist layout: runtime workers resolve beside the entry exactly as packaged,
 * and packages resolve from engine/node_modules. Independent of the runner.
 */
async function buildDist(distPaths: string[]): Promise<string> {
  const cacheRoot = path.join(engineRoot, "node_modules", ".cache");
  fs.mkdirSync(cacheRoot, { recursive: true });
  const root = fs.mkdtempSync(path.join(cacheRoot, "branch-linux-owner-"));
  builtRoots.push(root);
  await build({
    entryPoints: Object.fromEntries(
      distPaths.map((distPath) => [
        distPath.replace(/\.js$/u, ""),
        path.join(sourceRoot, distPath.replace(/\.js$/u, ".ts")),
      ]),
    ),
    outdir: path.join(root, "dist"),
    bundle: true,
    format: "esm",
    platform: "node",
    packages: "external",
    logLevel: "silent",
  });
  return path.join(root, "dist", distPaths[0]!);
}

/** Simulates a kernel without CONFIG_PROC_CHILDREN for the owner process only. */
function hideTaskChildren(): { preload: string; marker: string } {
  const root = tempDirs.make("branch-proc-children-");
  const preload = path.join(root, "without-task-children.mjs");
  const marker = path.join(root, "task-children-reads.txt");
  fs.writeFileSync(
    preload,
    String.raw`import fs from "node:fs";
     import { syncBuiltinESMExports } from "node:module";
     const read = fs.readFileSync;
     fs.readFileSync = function(file, ...args) {
       if (typeof file === "string" && /^\/proc\/self\/task\/\d+\/children$/.test(file)) {
         fs.appendFileSync(${JSON.stringify(marker)}, process.pid + "\n");
         throw Object.assign(new Error("task children unavailable"), { code: "ENOENT" });
       }
       return Reflect.apply(read, fs, [file, ...args]);
     };
     syncBuiltinESMExports();`,
  );
  return { preload, marker };
}

function taskChildrenReads(marker: string): number {
  return fs.existsSync(marker) ? fs.readFileSync(marker, "utf8").trim().split("\n").length : 0;
}

async function runBuilt(entry: string, args: string[], preload?: string): Promise<unknown> {
  const { stdout } = await runFile(requireNodeTool("node"), [entry, ...args], {
    cwd: engineRoot,
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
    env: {
      ...process.env,
      NODE_OPTIONS: preload ? `--import=${pathToFileURL(preload).href}` : "",
    },
  });
  return JSON.parse(stdout);
}

const probe = "process/supervisor/linux-child-subreaper.probe.test-support.js";

const expectedRetirements = [
  ...["A", "B"].map((label) => ({
    label,
    code: 0,
    signal: null,
    stdout: label + "-final-output",
    extinct: true,
    owner: "linux-subreaper",
  })),
  {
    label: "graceful-term",
    code: 23,
    signal: null,
    stdout: "",
    extinct: true,
    owner: "linux-subreaper",
  },
  {
    label: "startup-failed",
    code: null,
    signal: null,
    stdout: "",
    extinct: true,
    owner: "linux-subreaper",
  },
];

describe("linuxSiginfoPidOffset", () => {
  it("places si_pid after the pointer-aligned siginfo preamble", () => {
    expect(linuxSiginfoPidOffset(8)).toBe(16);
    expect(linuxSiginfoPidOffset(4)).toBe(12);
    expect(() => linuxSiginfoPidOffset(2)).toThrow(/32-bit or 64-bit siginfo layout/u);
  });
});

it.skipIf(!nativeLinux)(
  "reaps native children without task children files or permission to signal process groups",
  async () => {
    const { preload, marker } = hideTaskChildren();
    const fixture = await buildDist([
      "process/supervisor/service-child-subreaper.test-support.js",
      runtimeProcessEntrypoints.spawnBroker.distWorkerPath,
      runtimeProcessEntrypoints.serviceChildRelay.distWorkerPath,
      runtimeProcessEntrypoints.serviceChildGroupAnchor.distWorkerPath,
    ]);
    await expect(runBuilt(fixture, [], preload)).resolves.toEqual(expectedRetirements);
    expect(taskChildrenReads(marker)).toBeGreaterThan(0);
  },
);

it.skipIf(!nativeLinux)("refuses an owner loaded through a source loader", async () => {
  const root = tempDirs.make("branch-proc-source-owner-");
  const entry = path.join(root, "owner-from-source.mts");
  const ownerSource = path.join(sourceRoot, "process/supervisor/linux-child-subreaper.ts");
  fs.writeFileSync(
    entry,
    `const { acquireLinuxChildSubreaper } = await import(${JSON.stringify(pathToFileURL(ownerSource).href)});` +
      'try { acquireLinuxChildSubreaper(); process.stdout.write("admitted"); }' +
      " catch (error) { process.stdout.write(String(error.message)); }",
  );
  const { stdout } = await runFile(
    requireNodeTool("node"),
    ["--import", import.meta.resolve("tsx"), entry],
    { cwd: engineRoot, encoding: "utf8", timeout: 10_000, windowsHide: true },
  );
  expect(stdout).toBe(
    "Linux child ownership requires the built process owner, without a source loader",
  );
});

describe.skipIf(!nativeLinux)("built Linux child owner", () => {
  const censuses = [
    { census: "task children files", hidden: false },
    { census: "/proc parent identities", hidden: true },
  ];

  it.each(censuses)("refuses admission with an existing child via $census", async ({ hidden }) => {
    const hiding = hidden ? hideTaskChildren() : undefined;
    const owner = await buildDist([probe]);
    await expect(runBuilt(owner, ["existing-child"], hiding?.preload)).resolves.toEqual({
      outcome: "Linux child ownership requires a dedicated owner without existing children",
    });
    if (hiding) {
      expect(taskChildrenReads(hiding.marker)).toBeGreaterThan(0);
    }
  });

  it.each(censuses)("signals and reaps an adopted orphan via $census", async ({ hidden }) => {
    const hiding = hidden ? hideTaskChildren() : undefined;
    const owner = await buildDist([probe]);
    await expect(runBuilt(owner, ["adopted-orphan"], hiding?.preload)).resolves.toEqual({
      adopted: true,
      extinct: true,
      orphanAlive: false,
    });
    if (hiding) {
      expect(taskChildrenReads(hiding.marker)).toBeGreaterThan(0);
    }
  });
});
