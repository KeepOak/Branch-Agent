import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { encodeBitwardenSecretId } from "../bitwarden-secret-id.js";

const resolverPath = fileURLToPath(new URL("../bitwarden-secret-ref-resolver.js", import.meta.url));
const manifestPath = fileURLToPath(new URL("../branch.plugin.json", import.meta.url));
const packagePath = fileURLToPath(new URL("../package.json", import.meta.url));
const SESSION = "test-session-key";
const ITEM_ID = "7d1c9e1a-5b2f-4c8e-9a10-2f3b4c5d6e7f";
const ITEMS = [
  {
    id: ITEM_ID,
    name: "GitHub",
    notes: "recovery codes live elsewhere",
    login: {
      username: "octo-owner",
      password: "correct horse battery staple",
      totp: "otpauth://totp/GitHub?secret=JBSWY3DPEHPK3PXP",
      uris: [{ uri: "https://github.com/login" }],
    },
    fields: [{ name: "deploy token", value: "deploy-fixture-value", type: 1 }],
  },
  {
    id: "0b6a0c8e-0000-4000-8000-000000000002",
    name: "Work Mail Account",
    login: { username: "me@example.com", password: "mail-pass" },
  },
];

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** A stand-in bw that serves fixture items, checks the session, and logs each call. */
function writeFakeBw(): { binDir: string; bwPath: string; calls: () => string[][] } {
  const binDir = tempDir("branch-bw-bin-");
  const logPath = path.join(binDir, "calls.log");
  const bwPath = path.join(binDir, "bw");
  const source = [
    `#!${process.execPath}`,
    'const fs = require("node:fs");',
    `const items = ${JSON.stringify(ITEMS)};`,
    'const args = process.argv.slice(2).filter((arg) => arg !== "--nointeraction");',
    `fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(args) + "\\n");`,
    `if (process.env.BW_SESSION !== ${JSON.stringify(SESSION)} || process.env.BW_NOINTERACTION !== "true") {`,
    '  process.stderr.write("Vault is locked.");',
    "  process.exit(1);",
    "}",
    "const item = items.find((entry) => entry.id === args[2] || entry.name === args[2]);",
    'if (!item) { process.stderr.write("Not found."); process.exit(1); }',
    'if (args[0] === "get" && args[1] === "item") { process.stdout.write(JSON.stringify(item)); }',
    'else if (args[0] === "get" && args[1] === "totp") { process.stdout.write("123456\\n"); }',
    "else { process.exit(2); }",
  ].join("\n");
  fs.writeFileSync(bwPath, source, { mode: 0o755 });
  return {
    binDir,
    bwPath,
    calls: () =>
      fs.existsSync(logPath)
        ? fs
            .readFileSync(logPath, "utf8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line) as string[])
        : [],
  };
}

function stateDirWithSession(session: string | null): string {
  const stateDir = tempDir("branch-bw-state-");
  if (session !== null) {
    const dir = path.join(stateDir, "credentials", "bitwarden");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "session"), `${session}\n`, { mode: 0o600 });
  }
  return stateDir;
}

function runResolver(
  ids: string[],
  env: Record<string, string>,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [resolverPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { HOME: os.homedir(), PATH: "", ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += String(chunk)));
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(`${JSON.stringify({ protocolVersion: 1, provider: "bitwarden", ids })}\n`);
  });
}

async function resolveIds(ids: string[], env: Record<string, string>) {
  const result = await runResolver(ids, env);
  expect(result).toMatchObject({ code: 0, stderr: "" });
  return JSON.parse(result.stdout) as {
    protocolVersion: number;
    values: Record<string, string>;
    errors: Record<string, { message: string }>;
  };
}

describe("Bitwarden manifest", () => {
  it("declares an exec SecretRef integration backed by the packaged resolver", () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const integration = manifest.secretProviderIntegrations.bitwarden;
    expect(integration).toMatchObject({
      providerAlias: "bitwarden",
      source: "exec",
      command: "${node}",
      args: ["./bitwarden-secret-ref-resolver.js"],
    });
    expect(integration.passEnv).toEqual(
      expect.arrayContaining(["BRANCH_BITWARDEN_BW", "BW_SESSION", "BRANCH_STATE_DIR", "PATH"]),
    );
    const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    expect(pkg.branch.build.staticAssets.map((asset: { output: string }) => asset.output)).toEqual([
      "bitwarden-secret-ref-resolver.js",
      "bitwarden-secret-id.js",
    ]);
  });
});

describe.skipIf(process.platform === "win32")("Bitwarden SecretRef resolver", () => {
  it("reads login, custom and code fields with one bw call per item", async () => {
    const bw = writeFakeBw();
    const stateDir = stateDirWithSession(SESSION);
    const expected: Array<[string, string]> = [
      [`${ITEM_ID}/username`, "octo-owner"],
      [`${ITEM_ID}/password`, "correct horse battery staple"],
      [`${ITEM_ID}/totp`, "123456"],
      [`${ITEM_ID}/uri`, "https://github.com/login"],
      [encodeBitwardenSecretId(`${ITEM_ID}/fields/deploy token`), "deploy-fixture-value"],
      [encodeBitwardenSecretId("Work Mail Account/password"), "mail-pass"],
    ];
    const ids = expected.map(([id]) => id);
    const response = await resolveIds(ids, { PATH: bw.binDir, BRANCH_STATE_DIR: stateDir });
    expect(response).toEqual({
      protocolVersion: 1,
      values: Object.fromEntries(expected),
      errors: {},
    });
    expect(bw.calls()).toEqual([
      ["get", "item", ITEM_ID],
      ["get", "totp", ITEM_ID],
      ["get", "item", "Work Mail Account"],
    ]);
  });

  it("uses BRANCH_BITWARDEN_BW and falls back to BW_SESSION", async () => {
    const bw = writeFakeBw();
    const response = await resolveIds(["GitHub/password"], {
      BRANCH_BITWARDEN_BW: bw.bwPath,
      BRANCH_STATE_DIR: stateDirWithSession(null),
      BW_SESSION: SESSION,
    });
    expect(response.values).toEqual({ "GitHub/password": "correct horse battery staple" });
  });

  it("refuses to run bw while the vault is locked for Branch", async () => {
    const bw = writeFakeBw();
    const response = await resolveIds(["GitHub/password"], {
      PATH: bw.binDir,
      BRANCH_STATE_DIR: stateDirWithSession(null),
    });
    expect(response.values).toEqual({});
    expect(response.errors["GitHub/password"]?.message).toMatch(/vault is locked for Branch Agent/);
    expect(bw.calls()).toEqual([]);
  });

  it("reports a stale session, a missing item and a missing field per reference", async () => {
    const bw = writeFakeBw();
    const stale = await resolveIds(["GitHub/password"], {
      PATH: bw.binDir,
      BRANCH_STATE_DIR: stateDirWithSession("expired"),
    });
    expect(stale.errors["GitHub/password"]?.message).toMatch(/locked or logged out/);

    const response = await resolveIds(
      ["Nope/password", "Work-Mail/totp", "GitHub/fields/missing", "GitHub/secret", "GitHub/notes"],
      { PATH: bw.binDir, BRANCH_STATE_DIR: stateDirWithSession(SESSION) },
    );
    expect(response.values).toEqual({ "GitHub/notes": "recovery codes live elsewhere" });
    expect(response.errors["Nope/password"]?.message).toMatch(/item was not found/);
    expect(response.errors["Work-Mail/totp"]?.message).toMatch(/item was not found/);
    expect(response.errors["GitHub/fields/missing"]?.message).toMatch(/no custom field "missing"/);
    expect(response.errors["GitHub/secret"]?.message).toMatch(/unknown field "secret"/);
  });

  it("rejects a relative BRANCH_BITWARDEN_BW without running anything", async () => {
    const response = await resolveIds(["GitHub/password"], {
      BRANCH_BITWARDEN_BW: "bin/bw",
      BRANCH_STATE_DIR: stateDirWithSession(SESSION),
    });
    expect(response.errors["GitHub/password"]?.message).toMatch(/must be an absolute path/);
  });

  it("reports a missing bw CLI", async () => {
    const response = await resolveIds(["GitHub/password"], {
      PATH: tempDir("branch-bw-empty-"),
      BRANCH_STATE_DIR: stateDirWithSession(SESSION),
    });
    expect(response.errors["GitHub/password"]?.message).toMatch(
      /Bitwarden CLI \(bw\) was not found/,
    );
  });
});
