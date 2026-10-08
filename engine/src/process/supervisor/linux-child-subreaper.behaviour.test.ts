// Written by Branch for SESSIONS-0102 using openclaw/openclaw@40ee2cbdd25bd2eadf01ea9685464502509771e3 native child-owner behavior; not copied.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import { requireNodeTool } from "../../../test/helpers/node-toolchain.js";
import { useAutoCleanupTempDirTracker } from "../../../test/helpers/temp-dir.js";
import {
  resolveRuntimeWorkerArgv,
  resolveRuntimeWorkerUrl,
} from "../../infra/runtime-worker-url.js";
import { processProbeEntrypoints } from "../process-probes-runtime.test-support.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

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

it.skipIf(process.platform !== "linux" || !["x64", "arm64"].includes(process.arch))(
  "reaps native children without task children files or permission to signal process groups",
  async () => {
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
    const fixture = resolveRuntimeWorkerUrl(processProbeEntrypoints.serviceChildSubreaper);
    const node = requireNodeTool("node");
    const { stdout } = await promisify(execFile)(node, resolveRuntimeWorkerArgv(fixture, node), {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 10_000,
      env: { ...process.env, NODE_OPTIONS: `--import=${pathToFileURL(preload).href}` },
    });
    expect(JSON.parse(stdout)).toEqual(expectedRetirements);
    expect(fs.readFileSync(marker, "utf8").trim().split("\n").length).toBeGreaterThan(0);
  },
);
