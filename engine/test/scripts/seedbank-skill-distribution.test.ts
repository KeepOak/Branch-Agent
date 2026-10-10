import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { installSkillFromSource } from "../../src/skills/lifecycle/source-install.js";
import { withTestDir } from "../../src/test-helpers/temp-dir.js";
import {
  assertPortablePath,
  createSeedbankCatalog,
  permissionsEqual,
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
const CLEAN_SCAN = {
  scanner: "branch-skill-scanner/v1",
  scannedFiles: 3,
  critical: 0,
  warn: 0,
  info: 0,
  truncated: false,
};

type FixtureOptions = {
  skillName?: string;
  packId?: string;
  tier?: string;
  withPackManifest?: boolean;
  permissions?: Record<string, unknown>;
  extraFiles?: Record<string, string>;
};

// Canonical POSIX ustar numeric fields end in " \0" (the inspector refuses any other encoding).
function octalField(value: number, width: number): string {
  return `${value.toString(8).padStart(width, "0")} \0`;
}

function tarHeader(name: string, size: number, type: "0" | "5"): Buffer {
  const h = Buffer.alloc(512, 0);
  const put = (offset: number, length: number, text: string) => h.write(text, offset, length, "ascii");
  put(0, 100, name);
  put(100, 8, octalField(0o644, 6));
  put(108, 8, octalField(0, 6));
  put(116, 8, octalField(0, 6));
  put(124, 12, octalField(size, 10));
  put(136, 12, octalField(0, 10));
  h.fill(" ", 148, 156);
  put(156, 1, type);
  put(257, 6, "ustar\0");
  put(263, 2, "00");
  put(329, 8, octalField(0, 6));
  put(337, 8, octalField(0, 6));
  let sum = 0;
  for (const byte of h) sum += byte;
  put(148, 8, octalField(sum, 6));
  return h;
}

// Packs a directory as "package/..." entries, the layout npm pack produces, with no npm process.
function tarFromDir(root: string): Buffer {
  const parts: Buffer[] = [tarHeader("package/", 0, "5")];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).split(path.sep).join("/");
      if (entry.isDirectory()) {
        parts.push(tarHeader(`package/${rel}/`, 0, "5"));
        walk(full);
        continue;
      }
      const body = readFileSync(full);
      parts.push(tarHeader(`package/${rel}`, body.length, "0"), body, Buffer.alloc((512 - (body.length % 512)) % 512));
    }
  };
  walk(root);
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

// Builds the same package/ layout npm pack produces. No npm process runs, which keeps the Windows
// named shard within its time budget.
async function packFixtureSkill(dir: string, options: FixtureOptions = {}) {
  const skillName = options.skillName ?? "fixture-notes";
  const pkg = path.join(dir, "package");
  await fs.mkdir(path.join(pkg, "references"), { recursive: true });
  await fs.writeFile(
    path.join(pkg, "package.json"),
    JSON.stringify({
      name: "@branch-agent/fixture-notes",
      version: "2026.9.8",
      files: ["SKILL.md", "branch.pack.json", "references"],
    }),
  );
  await fs.writeFile(
    path.join(pkg, "SKILL.md"),
    `---\nname: ${skillName}\ndescription: Fixture skill for distribution tests\n---\n\n# Fixture notes\n`,
  );
  if (options.withPackManifest !== false) {
    await fs.writeFile(
      path.join(pkg, "branch.pack.json"),
      JSON.stringify({
        schema: "branch.pack/v1",
        kind: "skill",
        tier: options.tier ?? "community",
        id: options.packId ?? "fixture-notes",
        summary: "Notes guidance. Instructions only.",
        permissions: options.permissions ?? NO_PERMISSIONS,
      }),
    );
  }
  await fs.writeFile(path.join(pkg, "references", "guide.md"), "Reference material.\n");
  for (const [name, content] of Object.entries(options.extraFiles ?? {})) {
    await fs.writeFile(path.join(pkg, name), content);
  }
  const filename = "branch-agent-fixture-notes-2026.9.8.tgz";
  return { filename, bytes: gzipSync(tarFromDir(pkg)), scan: CLEAN_SCAN };
}

function catalogFor(artifact: { filename: string; bytes: Buffer; scan?: unknown }) {
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
        scan: CLEAN_SCAN,
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

  it("accepts an all-off permission block whose keys come in another order", async () => {
    await withTestDir({ prefix: "seedbank-skill-order-" }, async (dir) => {
      const reordered = {
        computerControl: false,
        secrets: false,
        runCommands: false,
        files: "none",
        network: false,
      };
      const artifact = await packFixtureSkill(dir, { permissions: reordered });
      const entry = resolveSeedbankEntry(catalogFor(artifact), "seedbank:@branch-agent/fixture-notes");
      expect(permissionsEqual(entry.permissions, NO_PERMISSIONS)).toBe(true);
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

  it("refuses a community skill that declares the official tier", async () => {
    await withTestDir({ prefix: "seedbank-skill-tier-" }, async (dir) => {
      const artifact = await packFixtureSkill(dir, { tier: "official" });
      expect(() => catalogFor(artifact)).toThrow("is set by the owner pipeline");
    });
  });

  it("refuses a community pack that has no clean scan record", async () => {
    await withTestDir({ prefix: "seedbank-skill-noscan-" }, async (dir) => {
      const { scan: _scan, ...unscanned } = await packFixtureSkill(dir);
      expect(() => catalogFor(unscanned)).toThrow("clean scan record");
      expect(() => catalogFor({ ...unscanned, scan: { ...CLEAN_SCAN, critical: 1 } })).toThrow(
        "clean scan record",
      );
    });
  });

  // On Windows these names cannot be created on disk (streams or device names), so the pack cannot
  // contain them. The assertPortablePath unit test below covers the same rules on every platform.
  it.skipIf(process.platform === "win32").each(
    ["references/a:b.md", "references/CON.md", "references/NUL .txt", "references/trailing."],
  )(
    "refuses a Windows-unsafe file name in a pack: %s",
    async (name) => {
      await withTestDir({ prefix: "seedbank-skill-portable-" }, async (dir) => {
        const artifact = await packFixtureSkill(dir, { extraFiles: { [name]: "x\n" } });
        expect(() => catalogFor(artifact)).toThrow("not portable to Windows");
      });
    },
  );

  it("rejects alternate streams, device stems, and trailing dots or spaces at staging", () => {
    expect(() => assertPortablePath("references/a:b")).toThrow("not portable");
    expect(() => assertPortablePath("CON.md")).toThrow("not portable");
    expect(() => assertPortablePath("lpt9")).toThrow("not portable");
    expect(() => assertPortablePath("dir./x.md")).toThrow("not portable");
    expect(() => assertPortablePath("references/name ")).toThrow("not portable");
    expect(() => assertPortablePath("references/guide.md")).not.toThrow();
  });

  it("refuses bytes that do not match the catalog digest", async () => {
    await withTestDir({ prefix: "seedbank-skill-tamper-" }, async (dir) => {
      const artifact = await packFixtureSkill(dir);
      const entry = resolveSeedbankEntry(catalogFor(artifact), "seedbank:@branch-agent/fixture-notes");
      const tampered = Buffer.from(artifact.bytes);
      tampered[tampered.length - 1] ^= 0xff;
      // A flipped byte breaks the gzip container before the digest comparison, so only refusal is asserted.
      expect(() => verifySeedbankPackage(entry, tampered)).toThrow();
    });
  });

  it("refuses a catalog entry whose permissions differ from the signed bytes", async () => {
    await withTestDir({ prefix: "seedbank-skill-claim-" }, async (dir) => {
      const artifact = await packFixtureSkill(dir);
      const entry = resolveSeedbankEntry(catalogFor(artifact), "seedbank:@branch-agent/fixture-notes");
      const overclaimed = { ...entry, permissions: { ...NO_PERMISSIONS, secrets: true } };
      expect(() => verifySeedbankPackage(overclaimed, artifact.bytes)).toThrow(
        "installation refused",
      );
    });
  });

  it("refuses --verify-archive without exactly one archive path instead of downloading", async () => {
    await withTestDir({ prefix: "seedbank-skill-argv-" }, async (dir) => {
      const artifact = await packFixtureSkill(dir);
      const catalogFile = path.join(dir, "seedbank.json");
      writeFileSync(catalogFile, JSON.stringify(catalogFor(artifact)));
      const script = fileURLToPath(new URL("../../scripts/seedbank-install.mjs", import.meta.url));
      const run = spawnSync(
        process.execPath,
        [script, catalogFile, "seedbank:@branch-agent/fixture-notes", "--verify-archive"],
        { encoding: "utf8", windowsHide: true },
      );
      expect(run.status).not.toBe(0);
      expect(run.stderr).toContain("takes exactly one archive path");
    });
  });
});
