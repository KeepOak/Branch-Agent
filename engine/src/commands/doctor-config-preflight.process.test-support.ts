import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { runCliProcessChild } from "../cli/cli-process-child.test-helpers.js";
import { resolveRuntimeWorkerUrl } from "../infra/runtime-worker-url.js";
import { removeCanonicalValidationFromHistoricalAgentFixture } from "../state/branch-agent-db.test-support.js";
import { seedBranchAgentSchemaV21 } from "../state/branch-agent-schema-v21.test-support.js";
import {
  closeBranchStateDatabaseForTest,
  openBranchStateDatabase,
} from "../state/branch-state-db.js";
import { resolveTestNodeExecPath } from "../test-utils/node-process.js";

const execFileAsync = promisify(execFile);
const isolatedRuntimeNodeExecPath = resolveTestNodeExecPath();
const ENGINE_ROOT = fileURLToPath(new URL("../..", import.meta.url));
// The fixture owns its package assets; resolving linked source back to the checkout
// makes Doctor repair that checkout instead, including building its Control UI.
// Dependency realpaths still own their transitive packages under isolated installs.
export const ISOLATED_RUNTIME_NODE_ARGS = [
  "--preserve-symlinks",
  "--preserve-symlinks-main",
  "--import",
  `data:text/javascript,${encodeURIComponent(`
    import fs from "node:fs";
    import { registerHooks } from "node:module";
    import path from "node:path";
    import { fileURLToPath, pathToFileURL } from "node:url";
    registerHooks({
      resolve(specifier, context, nextResolve) {
        const resolved = nextResolve(specifier, context);
        if (!resolved.url.startsWith("file:")) return resolved;
        const filename = fileURLToPath(resolved.url);
        if (!filename.split(path.sep).includes("node_modules")) return resolved;
        const url = new URL(resolved.url);
        url.pathname = pathToFileURL(fs.realpathSync(filename)).pathname;
        return { ...resolved, url: url.href };
      }
    });
  `)}`,
];

export function runBuiltRuntime(
  runtimeRoot: string,
  env: NodeJS.ProcessEnv,
  args: string[],
  timeout: number,
  options: Pick<Parameters<typeof runCliProcessChild>[0], "maxBuffer" | "onTestFinished"> = {},
) {
  return runCliProcessChild({
    nodeExecutable: isolatedRuntimeNodeExecPath,
    nodeArgs: [...ISOLATED_RUNTIME_NODE_ARGS, path.join(runtimeRoot, "dist", "entry.js"), ...args],
    nodeArgsPolicy: "caller",
    cwd: runtimeRoot,
    env,
    timeoutMs: timeout,
    maxBuffer: options.maxBuffer ?? 1024 * 1024,
    ...(options.onTestFinished ? { onTestFinished: options.onTestFinished } : {}),
  });
}

export function runSourceRuntime(
  runtimeRoot: string,
  env: NodeJS.ProcessEnv,
  args: string[],
  timeout: number,
  maxBuffer?: number,
) {
  return runCliProcessChild({
    nodeExecutable: isolatedRuntimeNodeExecPath,
    nodeArgs: [...ISOLATED_RUNTIME_NODE_ARGS, "--import", "tsx", ...args],
    nodeArgsPolicy: "caller",
    cwd: runtimeRoot,
    env,
    timeoutMs: timeout,
    maxBuffer: maxBuffer ?? 1024 * 1024,
  });
}

export function runIsolatedModuleScript(
  env: NodeJS.ProcessEnv,
  script: string,
  options: { runtimeRoot?: string; timeoutMs?: number } = {},
) {
  return execFileAsync(
    isolatedRuntimeNodeExecPath,
    [
      ...(options.runtimeRoot ? ISOLATED_RUNTIME_NODE_ARGS : []),
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      script,
    ],
    {
      cwd: options.runtimeRoot ?? path.resolve("."),
      encoding: "utf8",
      env,
      maxBuffer: 4 * 1024 * 1024,
      timeout: options.timeoutMs ?? 30_000,
    },
  );
}

export function createSourceRuntime(root: string): string {
  const runtimeRoot = path.join(root, "runtime");
  fs.mkdirSync(path.join(runtimeRoot, "dist"), { recursive: true });
  for (const dirname of ["node_modules", "packages", "scripts", "src"]) {
    fs.symlinkSync(
      path.join(ENGINE_ROOT, dirname),
      path.join(runtimeRoot, dirname),
      process.platform === "win32" ? "junction" : "dir",
    );
  }
  for (const filename of [
    "node-host-launcher.mjs",
    "node-compile-cache.mjs",
    "node-version.mjs",
    "node-sqlite.mjs",
    "node-runtime-update.mjs",
    "node-runtime-recovery.mjs",
    "node-runtime-env.mjs",
    "cli-root-options.mjs",
    "gateway-run-argv.mjs",
    "gateway-shutdown-budget.mjs",
    "package.json",
    "tsconfig.json",
  ]) {
    fs.copyFileSync(path.join(ENGINE_ROOT, filename), path.join(runtimeRoot, filename));
  }
  fs.writeFileSync(
    path.join(runtimeRoot, "dist", "build-info.json"),
    JSON.stringify({ builtAt: "2026-08-05T00:00:00.000Z" }),
  );
  const uiDir = path.join(runtimeRoot, "dist", "control-ui");
  fs.mkdirSync(uiDir, { recursive: true });
  fs.writeFileSync(path.join(uiDir, "index.html"), "<!doctype html>\n");
  return runtimeRoot;
}

export function createDoctorCliRuntime(root: string): { source: boolean; root: string } {
  const resolvedEntry = fileURLToPath(
    resolveRuntimeWorkerUrl({
      currentModuleUrl: import.meta.url,
      sourceWorkerName: "../entry",
      distWorkerPath: "entry.js",
    }),
  );
  const distEntry = fileURLToPath(new URL("../../dist/entry.js", import.meta.url));
  const builtEntry =
    resolvedEntry.endsWith(".js") && fs.existsSync(resolvedEntry)
      ? resolvedEntry
      : fs.existsSync(distEntry)
        ? distEntry
        : undefined;
  return builtEntry
    ? { source: false, root: createBuiltRuntime(root, path.dirname(builtEntry)) }
    : { source: true, root: createSourceRuntime(root) };
}

export function runDoctorCli(
  runtime: { source: boolean; root: string },
  env: NodeJS.ProcessEnv,
  args: string[],
  timeout: number,
  options: Pick<Parameters<typeof runCliProcessChild>[0], "maxBuffer" | "onTestFinished"> = {},
) {
  return runtime.source
    ? runSourceRuntime(
        runtime.root,
        env,
        [path.join(runtime.root, "src", "entry.ts"), ...args],
        timeout,
        options.maxBuffer,
      )
    : runBuiltRuntime(runtime.root, env, args, timeout, options);
}

export function doctorCliEntrypoint(runtime: { source: boolean; root: string }): string[] {
  return runtime.source
    ? [...ISOLATED_RUNTIME_NODE_ARGS, "--import", "tsx", path.join(runtime.root, "src", "entry.ts")]
    : [...ISOLATED_RUNTIME_NODE_ARGS, path.join(runtime.root, "dist", "entry.js")];
}

export function createBuiltRuntime(
  root: string,
  sourceDist = path.join(ENGINE_ROOT, "dist"),
  options: { copyDirectories?: boolean; emptyExtensions?: boolean } = {},
): string {
  const runtimeRoot = createSourceRuntime(root);
  // The pretest owner supplies immutable built modules once; mutable package
  // metadata and Control UI assets remain private to each fixture.
  for (const entry of fs.readdirSync(sourceDist, { withFileTypes: true })) {
    if (entry.name === "build-info.json" || entry.name === "control-ui") {
      continue;
    }
    const source = path.join(sourceDist, entry.name);
    const target = path.join(runtimeRoot, "dist", entry.name);
    if (entry.isDirectory() && entry.name === "extensions" && options.emptyExtensions) {
      fs.mkdirSync(target);
    } else if (entry.isDirectory() && options.copyDirectories) {
      // Direct package entry invocations do not pass --preserve-symlinks.
      fs.cpSync(source, target, { recursive: true, mode: fs.constants.COPYFILE_FICLONE });
    } else if (entry.isDirectory()) {
      fs.symlinkSync(source, target, process.platform === "win32" ? "junction" : "dir");
    } else {
      fs.copyFileSync(source, target, fs.constants.COPYFILE_FICLONE);
    }
  }
  if (!fs.existsSync(path.join(runtimeRoot, "dist", "entry.js"))) {
    throw new Error("built Doctor fixture requires dist/entry.js; prepare the runtime first");
  }
  return runtimeRoot;
}

export function seedPluginStateSidecar(stateDir: string, canonicalCreatedAt: number): void {
  const sharedPath = path.join(stateDir, "state", "branch.sqlite");
  const sidecarPath = path.join(stateDir, "plugin-state", "state.sqlite");
  fs.mkdirSync(path.dirname(sharedPath), { recursive: true });
  fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });

  openBranchStateDatabase({
    path: sharedPath,
    env: { ...process.env, BRANCH_STATE_DIR: stateDir },
  });
  closeBranchStateDatabaseForTest();

  const shared = new DatabaseSync(sharedPath);
  try {
    shared
      .prepare(`
        INSERT INTO plugin_state_entries (
          plugin_id, namespace, entry_key, value_json, created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run("discord", "components", "interaction:1", '{"ok":false}', canonicalCreatedAt, null);
  } finally {
    shared.close();
  }

  const sidecar = new DatabaseSync(sidecarPath);
  try {
    sidecar.exec(`
      CREATE TABLE plugin_state_entries (
        plugin_id TEXT NOT NULL,
        namespace TEXT NOT NULL,
        entry_key TEXT NOT NULL,
        value_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        PRIMARY KEY (plugin_id, namespace, entry_key)
      );
    `);
    sidecar
      .prepare(`
        INSERT INTO plugin_state_entries (
          plugin_id, namespace, entry_key, value_json, created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `)
      // Keep retired sidecar data distinct from the canonical row.
      .run("discord", "components", "interaction:1", '{"ok":true}', 3_000, null);
  } finally {
    sidecar.close();
  }
}

export function seedV17AdditiveRepairDatabase(
  stateDir: string,
  options: { participantDependency?: boolean } = {},
): string {
  const env = { ...process.env, BRANCH_STATE_DIR: stateDir };
  openBranchStateDatabase({ env });
  closeBranchStateDatabaseForTest();
  const databasePath = path.join(stateDir, "agents", "main", "agent", "branch-agent.sqlite");
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  try {
    seedBranchAgentSchemaV21(database);
    removeCanonicalValidationFromHistoricalAgentFixture(database);
    database.exec(`
      DROP TABLE session_participants;
      DROP TRIGGER session_conversations_route_context_invalidate_after_update;
      ALTER TABLE session_conversations DROP COLUMN route_context_json;
      DROP INDEX idx_agent_transcript_event_identity_sequence;
      PRAGMA user_version = 17;
      UPDATE schema_meta SET schema_version = 17;
    `);
    if (options.participantDependency) {
      database.exec(`
        CREATE TABLE session_participants (
          session_key TEXT NOT NULL,
          actor_type TEXT NOT NULL,
          actor_id TEXT NOT NULL,
          actor_source TEXT,
          contribution_count INTEGER,
          first_prompted_at INTEGER NOT NULL,
          last_prompted_at INTEGER NOT NULL,
          PRIMARY KEY (session_key, actor_type, actor_id),
          FOREIGN KEY (session_key) REFERENCES session_nodes(session_key) ON DELETE CASCADE
        ) STRICT;
        CREATE INDEX idx_test_participant_dependency ON session_participants(actor_id);
      `);
    }
  } finally {
    database.close();
  }
  return databasePath;
}
