import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveSeedbankPackageManifest,
  createSeedbankCatalog,
  resolveSeedbankEntry,
} from "../../scripts/lib/seedbank-distribution.mjs";

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
  it("packs real npm bytes and resolves a digest-bound release backup", () => {
    const directory = mkdtempSync(join(tmpdir(), "seedbank-test-"));
    try {
      writeFileSync(
        join(directory, "package.json"),
        JSON.stringify({
          name: "@branch-agent/test-plugin",
          version: "2026.9.8",
          files: ["index.js", "branch.plugin.json"],
        }),
      );
      writeFileSync(join(directory, "index.js"), "export default {};\n");
      writeFileSync(
        join(directory, "branch.plugin.json"),
        JSON.stringify({ id: "test-plugin", configSchema: { type: "object", properties: {} } }),
      );
      const packed = spawnSync("npm", ["pack", "--ignore-scripts", "--json"], {
        cwd: directory,
        encoding: "utf8",
      });
      expect(packed.status).toBe(0);
      const result = JSON.parse(packed.stdout)[0];
      const artifact = {
        filename: result.filename,
        bytes: readFileSync(join(directory, result.filename)),
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
