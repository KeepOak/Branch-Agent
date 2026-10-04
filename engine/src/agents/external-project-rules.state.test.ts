import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import {
  prepareExternalProjectRulesPrompt,
  toggleExternalProjectRule,
} from "./external-project-rules.js";
import {
  externalRuleStatePath,
  readExternalRuleState,
  refreshExternalRuleState,
  updateExternalRuleState,
} from "./external-project-rules.state.js";

const parent = path.join(
  os.tmpdir(),
  "Codex-session-files",
  "branch-feature-third-20261003",
  "memory",
);
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!path.relative(parent, root).startsWith("state-"))
      throw new Error("Invalid state fixture cleanup");
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function fixture() {
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, "state-"));
  roots.push(root);
  const scope = { agentDir: path.join(root, "agent"), workspace: path.join(root, "workspace") };
  await fs.mkdir(scope.agentDir);
  await fs.mkdir(scope.workspace);
  await fs.writeFile(path.join(scope.workspace, ".cursorrules"), "CURSOR");
  await fs.writeFile(path.join(scope.workspace, ".windsurfrules"), "WINDSURF");
  return scope;
}

async function restartedRead(scope: Awaited<ReturnType<typeof fixture>>) {
  const module = pathToFileURL(path.resolve("src/agents/external-project-rules.state.ts")).href;
  const code = `import {readExternalRuleState} from ${JSON.stringify(module)}; process.stdout.write(JSON.stringify(await readExternalRuleState(${JSON.stringify(scope)})));`;
  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "./scripts/tsx.mjs", "--input-type=module", "--eval", code],
      {
        cwd: process.cwd(),
        env: { ...process.env },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    let error = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      error += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (status) =>
      status === 0 ? resolve(output) : reject(new Error(`Restart reader ${status}: ${error}`)),
    );
  });
}

it("persists independent toggles through an actual fresh process", async () => {
  const scope = await fixture();
  await prepareExternalProjectRulesPrompt(scope);
  await toggleExternalProjectRule(scope, "cursor", ".cursorrules", false);
  expect(JSON.parse(await restartedRead(scope))).toEqual({
    cursor: { ".cursorrules": false },
    windsurf: { ".windsurfrules": true },
  });
  await toggleExternalProjectRule(scope, "windsurf", ".windsurfrules", false);
  await toggleExternalProjectRule(scope, "cursor", ".cursorrules", true);
  expect(await readExternalRuleState(scope)).toEqual({
    cursor: { ".cursorrules": true },
    windsurf: { ".windsurfrules": false },
  });
});

it("does not lose a disable during concurrent durable refresh", async () => {
  const scope = await fixture();
  const layouts = [
    { provider: "cursor" as const, source: ".cursorrules", files: [".cursorrules"] },
    { provider: "windsurf" as const, source: ".windsurfrules", files: [".windsurfrules"] },
  ];
  await Promise.all([
    toggleExternalProjectRule(scope, "cursor", ".cursorrules", false),
    updateExternalRuleState(scope, (previous) => refreshExternalRuleState(previous, layouts)),
  ]);
  expect((await readExternalRuleState(scope)).cursor[".cursorrules"]).toBe(false);
});

it("isolates actual agent directories and selected logical workspaces", async () => {
  const scope = await fixture();
  await toggleExternalProjectRule(scope, "cursor", ".cursorrules", false);
  const otherAgent = { ...scope, agentDir: path.join(scope.agentDir, "other") };
  const otherWorkspace = { ...scope, workspace: path.join(scope.workspace, "other") };
  expect(await readExternalRuleState(otherAgent)).toEqual({ cursor: {}, windsurf: {} });
  expect(await readExternalRuleState(otherWorkspace)).toEqual({ cursor: {}, windsurf: {} });
});

it("retains corrupt durable state and reports discovery unavailability", async () => {
  const scope = await fixture();
  await prepareExternalProjectRulesPrompt(scope);
  const file = externalRuleStatePath(scope);
  await fs.writeFile(file, "broken JSON");
  expect(await prepareExternalProjectRulesPrompt(scope)).toContain(
    "External project rules unavailable",
  );
  await expect(toggleExternalProjectRule(scope, "cursor", ".cursorrules", false)).rejects.toThrow();
  expect(await fs.readFile(file, "utf8")).toBe("broken JSON");
});

it("refuses publication when actual awaited refresh loses its captured authority", async () => {
  const scope = await fixture();
  await prepareExternalProjectRulesPrompt(scope);
  let checks = 0;
  await expect(
    updateExternalRuleState(
      {
        ...scope,
        assertCurrent: () => {
          if (++checks >= 5) throw new Error("authority expired");
        },
      },
      (previous) => ({ ...previous, cursor: { ".cursorrules": false } }),
    ),
  ).rejects.toThrow("authority expired");
  expect((await readExternalRuleState(scope)).cursor[".cursorrules"]).toBe(true);
});
