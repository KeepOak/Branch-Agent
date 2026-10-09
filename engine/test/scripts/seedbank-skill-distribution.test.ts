import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { installSkillFromSource } from "../../src/skills/lifecycle/source-install.js";
import { withTestDir } from "../../src/test-helpers/temp-dir.js";
import {
  createSeedbankCatalog,
  resolveCommandShim,
  resolveSeedbankEntry,
  seedbankInstallArgs,
  stageSeedbankSkill,
  verifySeedbankPackage,
} from "../../scripts/lib/seedbank-distribution.mjs";

const SHA = "a".repeat(40);
const NO_PERMISSIONS = {
  network: false,
  files: "none",
  runCommands: false,
  secrets: false,
  computerControl: false,
};

type FixtureOptions = {
  packageName?: string;
  skillName?: string;
  packId?: string;
  withPackManifest?: boolean;
  permissions?: Record<string, unknown>;
};

async function packFixtureSkill(dir: string, options: FixtureOptions = {}) {
  const skillName = options.skillName ?? "fixture-notes";
  await fs.mkdir(path.join(dir, "references"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: options.packageName ?? "@branch-agent/fixture-notes",
      version: "2026.9.8",
      files: ["SKILL.md", "branch.pack.json", "references"],
    }),
  );
  await fs.writeFile(
    path.join(dir, "SKILL.md"),
    `---\nname: ${skillName}\ndescription: Fixture skill for distribution tests\n---\n\n# Fixture notes\n`,
  );
  if (options.withPackManifest !== false) {
    await fs.writeFile(
      path.join(dir, "branch.pack.json"),
      JSON.stringify({
        schema: "branch.pack/v1",
        kind: "skill",
        tier: "community",
        id: options.packId ?? "fixture-notes",
        summary: "Notes guidance. Instructions only.",
        permissions: options.permissions ?? NO_PERMISSIONS,
      }),
    );
  }
  await fs.writeFile(path.join(dir, "references", "guide.md"), "Reference material.\n");
  const npm = resolveCommandShim("npm", ["pack", "--ignore-scripts", "--json"]);
  const packed = spawnSync(npm.command, npm.args, {
    cwd: dir,
    encoding: "utf8",
    windowsHide: true,
    windowsVerbatimArguments: npm.windowsVerbatimArguments,
  });
  expect(packed.status).toBe(0);
  const filename = JSON.parse(packed.stdout)[0].filename as string;
  return { filename, bytes: readFileSync(path.join(dir, filename)) };
}

function catalogFor(artifact: { filename: string; bytes: Buffer }) {
  return createSeedbankCatalog({
    sourceSha: SHA,
    releaseTag: "plugins-2026.9.8",
    packages: [artifact],
  });
}

describe("Seedbank skill distribution", () => {
  it("installs a skill from a local catalog fixture through the ordinary skill installer", async () => {
    await withTestDir({ prefix: "seedbank-skill-pack-" }, async (packDir) => {
      const artifact = await packFixtureSkill(packDir);
      const catalog = catalogFor(artifact);
      expect(catalog.packages[0]).toMatchObject({
        kind: "skill",
        tier: "community",
        skillName: "fixture-notes",
        permissions: NO_PERMISSIONS,
      });
      const entry = resolveSeedbankEntry(catalog, "seedbank:@branch-agent/fixture-notes");
      expect(() => verifySeedbankPackage(entry, artifact.bytes)).not.toThrow();

      await withTestDir({ prefix: "seedbank-skill-stage-" }, async (stageRoot) => {
        const staged = stageSeedbankSkill({ bytes: artifact.bytes, entry, parentDir: stageRoot });
        expect(readFileSync(path.join(staged, "SKILL.md"), "utf8")).toContain("name: fixture-notes");
        expect(readFileSync(path.join(staged, "references", "guide.md"), "utf8")).toBe(
          "Reference material.\n",
        );
        expect(seedbankInstallArgs({ entry, location: staged, options: ["--force"] })).toEqual([
          "skills",
          "install",
          staged,
          "--as",
          "fixture-notes",
          "--force",
        ]);

        await withTestDir({ prefix: "seedbank-skill-workspace-" }, async (workspaceDir) => {
          const result = await installSkillFromSource({ workspaceDir, spec: staged });
          expect(result).toMatchObject({ ok: true, slug: "fixture-notes", source: "path" });
          expect(
            readFileSync(path.join(workspaceDir, "skills", "fixture-notes", "SKILL.md"), "utf8"),
          ).toContain("Fixture notes");
        });
      });
    });
  });

  it("refuses a skill whose SKILL.md name does not match its pack id", async () => {
    await withTestDir({ prefix: "seedbank-skill-mismatch-" }, async (dir) => {
      const artifact = await packFixtureSkill(dir, { skillName: "other-name" });
      expect(() => catalogFor(artifact)).toThrow("differs from its skill or plugin identity");
    });
  });

  it("refuses a package without a pack manifest", async () => {
    await withTestDir({ prefix: "seedbank-skill-nopack-" }, async (dir) => {
      const artifact = await packFixtureSkill(dir, { withPackManifest: false });
      expect(() => catalogFor(artifact)).toThrow("must contain branch.pack.json");
    });
  });

  it("refuses a skill that declares any permission, because skills are instructions only", async () => {
    await withTestDir({ prefix: "seedbank-skill-perm-" }, async (dir) => {
      const artifact = await packFixtureSkill(dir, {
        permissions: { ...NO_PERMISSIONS, network: true },
      });
      expect(() => catalogFor(artifact)).toThrow("Skills are instructions only");
    });
  });

  it("refuses a pack manifest whose permission block is missing a key", async () => {
    await withTestDir({ prefix: "seedbank-skill-shape-" }, async (dir) => {
      const partial: Record<string, unknown> = { ...NO_PERMISSIONS };
      delete partial.network;
      const artifact = await packFixtureSkill(dir, { permissions: partial });
      expect(() => catalogFor(artifact)).toThrow("Seedbank pack manifest is invalid");
    });
  });

  it("refuses bytes that do not match the catalog digest", async () => {
    await withTestDir({ prefix: "seedbank-skill-tamper-" }, async (dir) => {
      const artifact = await packFixtureSkill(dir);
      const entry = resolveSeedbankEntry(
        catalogFor(artifact),
        "seedbank:@branch-agent/fixture-notes",
      );
      const tampered = Buffer.from(artifact.bytes);
      tampered[tampered.length - 1] ^= 0xff;
      // A flipped byte breaks the gzip container before the digest comparison, so only refusal is asserted.
      expect(() => verifySeedbankPackage(entry, tampered)).toThrow();
    });
  });

  it("refuses a catalog entry whose permissions differ from the signed bytes", async () => {
    await withTestDir({ prefix: "seedbank-skill-claim-" }, async (dir) => {
      const artifact = await packFixtureSkill(dir);
      const entry = resolveSeedbankEntry(
        catalogFor(artifact),
        "seedbank:@branch-agent/fixture-notes",
      );
      const overclaimed = { ...entry, permissions: { ...NO_PERMISSIONS, secrets: true } };
      expect(() => verifySeedbankPackage(overclaimed, artifact.bytes)).toThrow(
        "installation refused",
      );
    });
  });
});
