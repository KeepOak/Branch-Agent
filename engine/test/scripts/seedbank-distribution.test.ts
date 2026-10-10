import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ghCommandEnv,
  npmPublishEnv,
  resolveCommandShim,
  resolveSeedbankPackageManifest,
  createSeedbankCatalog,
  resolveSeedbankEntry,
} from "../../scripts/lib/seedbank-distribution.mjs";

const JOB_SECRETS = {
  PATH: "/usr/bin:/bin",
  HOME: "/home/runner",
  GH_TOKEN: "gh-token-value",
  GITHUB_TOKEN: "github-token-value",
  NPM_TOKEN: "npm-token-value",
  ACTIONS_ID_TOKEN_REQUEST_URL: "https://oidc.example.test/token",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "oidc-request-value",
  AWS_SECRET_ACCESS_KEY: "unrelated-secret",
};

describe("Seedbank distribution", () => {
  it("keeps verification and publication jobs within the repository CI cap", () => {
    const workflow = readFileSync(
      new URL("../../../.github/workflows/seedbank-plugin-distribution.yml", import.meta.url),
      "utf8",
    );
    const timeouts = [...workflow.matchAll(/timeout-minutes:\s*(\d+)/gu)].map((match) =>
      Number(match[1]),
    );
    expect(timeouts).toHaveLength(2);
    expect(timeouts.every((timeout) => timeout > 0 && timeout <= 15)).toBe(true);
  });
  it("publishes in the owned scope without changing SDK dependencies or upstream attribution", () => {
    const original = JSON.parse(
      readFileSync(new URL("../../extensions/cerebras/package.json", import.meta.url), "utf8"),
    );
    const result = resolveSeedbankPackageManifest(original);
    expect(result.name).toBe("@branch-agent/cerebras-provider");
    expect(result.branch.install.npmSpec).toBe(result.name);
    expect(result.branch.install.seedbankSpec).toBe(`seedbank:${result.name}`);
    expect(result.branch.install.clawhubSpec).toBeUndefined();
    expect(result.repository.url).toBe("https://github.com/KeepOak/Branch-Agent.git");
    expect(result.devDependencies).toEqual(original.devDependencies);
    expect(original.name).toBe("@branch/cerebras-provider");
  });
  it("spawns npm and branch shims through cmd.exe on Windows only", () => {
    expect(resolveCommandShim("npm", ["pack", "--json"], "linux")).toEqual({
      command: "npm",
      args: ["pack", "--json"],
      windowsVerbatimArguments: false,
    });
    const windows = resolveCommandShim(
      "branch",
      ["plugins", "install", "C:\\Temp dir\\a.tgz"],
      "win32",
    );
    expect(windows.command.toLowerCase()).toMatch(/system32[\\/]cmd\.exe$/u);
    expect(windows.args).toEqual([
      "/d",
      "/s",
      "/c",
      'branch.cmd plugins install "C:\\Temp dir\\a.tgz"',
    ]);
    expect(windows.windowsVerbatimArguments).toBe(true);
    expect(() => resolveCommandShim("branch", ["a&b"], "win32")).toThrow("unsafe");
  });
  it("packs real npm bytes and resolves a digest-bound release backup", () => {
    const directory = mkdtempSync(join(tmpdir(), "seedbank-test-"));
    try {
      writeFileSync(
        join(directory, "package.json"),
        JSON.stringify({
          name: "@branch-agent/test-plugin",
          version: "2026.9.8",
          files: ["index.js", "branch.plugin.json", "branch.pack.json"],
        }),
      );
      writeFileSync(join(directory, "index.js"), "export default {};\n");
      writeFileSync(
        join(directory, "branch.plugin.json"),
        JSON.stringify({ id: "test-plugin", configSchema: { type: "object", properties: {} } }),
      );
      writeFileSync(
        join(directory, "branch.pack.json"),
        JSON.stringify({
          schema: "branch.pack/v1",
          kind: "plugin",
          tier: "community",
          id: "test-plugin",
          permissions: {
            network: false,
            files: "none",
            runCommands: false,
            secrets: false,
            computerControl: false,
          },
        }),
      );
      const npm = resolveCommandShim("npm", ["pack", "--ignore-scripts", "--json"]);
      const packed = spawnSync(npm.command, npm.args, {
        cwd: directory,
        encoding: "utf8",
        windowsHide: true,
        windowsVerbatimArguments: npm.windowsVerbatimArguments,
      });
      expect(packed.status).toBe(0);
      const result = JSON.parse(packed.stdout)[0];
      const artifact = {
        filename: result.filename,
        bytes: readFileSync(join(directory, result.filename)),
        // Community packs need a clean scan record; the fixture plugin is community-tier.
        scan: {
          scanner: "branch-skill-scanner/v1",
          scannedFiles: 2,
          critical: 0,
          warn: 0,
          info: 0,
          truncated: false,
        },
      };
      const params = {
        sourceSha: "a".repeat(40),
        releaseTag: "plugins-2026.9.8",
        packages: [artifact],
      };
      const catalog = createSeedbankCatalog(params);
      expect(catalog.packages[0].integrity).toBe(result.integrity);
      expect(
        resolveSeedbankEntry(catalog, "seedbank:@branch-agent/test-plugin@2026.9.8").npmSpec,
      ).toBe("@branch-agent/test-plugin@2026.9.8");
      expect(resolveSeedbankEntry(catalog, "seedbank:@branch-agent/test-plugin").filename).toBe(
        result.filename,
      );
      expect(() => createSeedbankCatalog({ ...params, packages: [artifact, artifact] })).toThrow(
        "Duplicate",
      );
      expect(() =>
        createSeedbankCatalog({ ...params, packages: [{ ...artifact, filename: "other.tgz" }] }),
      ).toThrow("filename");
      expect(() => resolveSeedbankEntry(catalog, "clawhub:@branch/test-plugin")).toThrow("Invalid");
      expect(() =>
        resolveSeedbankEntry(catalog, "seedbank:@branch-agent/test-plugin@latest"),
      ).toThrow("Invalid");
      expect(() =>
        resolveSeedbankEntry(
          {
            ...catalog,
            packages: [{ ...catalog.packages[0], tarball: "https://evil.invalid/plugin.tgz" }],
          },
          "seedbank:@branch-agent/test-plugin",
        ),
      ).toThrow("binding");
      expect(() =>
        resolveSeedbankEntry(
          { ...catalog, packages: [...catalog.packages, ...catalog.packages] },
          "seedbank:@branch-agent/test-plugin",
        ),
      ).toThrow("exactly one");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("Seedbank publish environment", () => {
  it("gives npm publish no GitHub token and no other job secret", () => {
    const env = npmPublishEnv(JOB_SECRETS);
    expect(env).not.toHaveProperty("GH_TOKEN");
    expect(env).not.toHaveProperty("GITHUB_TOKEN");
    expect(env).not.toHaveProperty("NPM_TOKEN");
    expect(env).not.toHaveProperty("AWS_SECRET_ACCESS_KEY");
    expect(env).toMatchObject({
      PATH: JOB_SECRETS.PATH,
      HOME: JOB_SECRETS.HOME,
      ACTIONS_ID_TOKEN_REQUEST_URL: JOB_SECRETS.ACTIONS_ID_TOKEN_REQUEST_URL,
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: JOB_SECRETS.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
    });
  });

  it("does not leak GH_TOKEN into a real child process spawned for npm", () => {
    const child = spawnSync(
      process.execPath,
      ["-e", "process.stdout.write(JSON.stringify(Object.keys(process.env)))"],
      { encoding: "utf8", env: npmPublishEnv(JOB_SECRETS), windowsHide: true },
    );
    expect(child.status).toBe(0);
    const names: string[] = JSON.parse(child.stdout);
    expect(names).not.toContain("GH_TOKEN");
    expect(names).not.toContain("GITHUB_TOKEN");
    expect(names).not.toContain("AWS_SECRET_ACCESS_KEY");
  });

  it("gives gh only GH_TOKEN and no npm or OIDC variables", () => {
    const env = ghCommandEnv(JOB_SECRETS);
    expect(env.GH_TOKEN).toBe(JOB_SECRETS.GH_TOKEN);
    expect(env).not.toHaveProperty("ACTIONS_ID_TOKEN_REQUEST_TOKEN");
    expect(env).not.toHaveProperty("NPM_TOKEN");
    expect(env).not.toHaveProperty("AWS_SECRET_ACCESS_KEY");
  });
});
