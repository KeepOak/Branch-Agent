// Written by Branch for atlas OPS-0195 from openclaw/openclaw@57e0aaa1c190f1abe16e597008fbcc14f5e609e3:src/infra/dotenv.ts and runtime dotenv documentation; not copied.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { loadDotEnvAsync } from "./dotenv.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("loads project and isolated profile dotenv fallbacks without replacing shell values", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "branch-dotenv-behaviour-"));
  roots.push(root);
  const cwd = path.join(root, "project");
  const state = path.join(root, ".branch-person");
  mkdirSync(cwd);
  mkdirSync(state);
  writeFileSync(
    path.join(cwd, ".env"),
    "SHELL_VALUE=project\nSHARED_VALUE=project\nPROJECT_VALUE=present\n",
  );
  writeFileSync(
    path.join(state, ".env"),
    "SHELL_VALUE=profile\nSHARED_VALUE=profile\nPROFILE_VALUE=present\n",
  );
  const env: NodeJS.ProcessEnv = {
    BRANCH_HOME: root,
    BRANCH_STATE_DIR: state,
    SHELL_VALUE: "shell",
  };
  await loadDotEnvAsync({ env, cwd, quiet: true });
  expect(env).toMatchObject({
    SHELL_VALUE: "shell",
    SHARED_VALUE: "project",
    PROJECT_VALUE: "present",
    PROFILE_VALUE: "present",
    BRANCH_STATE_DIR: state,
  });
  expect(process.env.PROJECT_VALUE).toBeUndefined();
  writeFileSync(path.join(state, ".env"), "PROFILE_VALUE=changed\n");
  await loadDotEnvAsync({ env, cwd, quiet: true });
  expect(env.PROFILE_VALUE).toBe("present");
});

it("keeps runtime and provider credentials in the trusted profile scope", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "branch-dotenv-behaviour-"));
  roots.push(root);
  writeFileSync(
    path.join(root, ".env"),
    "BRANCH_GATEWAY_TOKEN=workspace\nOPENAI_API_KEY=workspace\nPUBLIC_VALUE=workspace\n",
  );
  const state = path.join(root, "profile");
  mkdirSync(state);
  writeFileSync(path.join(state, ".env"), "BRANCH_GATEWAY_TOKEN=profile\nOPENAI_API_KEY=profile\n");
  const env: NodeJS.ProcessEnv = { BRANCH_HOME: root, BRANCH_STATE_DIR: state };
  await loadDotEnvAsync({ env, cwd: root, quiet: true });
  expect(env).toMatchObject({
    BRANCH_GATEWAY_TOKEN: "profile",
    OPENAI_API_KEY: "profile",
    PUBLIC_VALUE: "workspace",
  });
});
