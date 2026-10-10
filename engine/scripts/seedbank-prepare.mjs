#!/usr/bin/env node
// Builds and packs once. No npm publication or GitHub write happens here.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { withAugmentedPluginNpmManifestForPackage } from "./lib/plugin-npm-package-manifest.mts";
import {
  createSeedbankCatalog,
  resolveCommandShim,
  resolveSeedbankPackageManifest,
  validatePackManifest,
} from "./lib/seedbank-distribution.mjs";
import { scanDirectoryWithSummary } from "../src/skills/security/scanner.ts";

const PACK_FILE = "branch.pack.json";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const [output, releaseTag, ...ids] = process.argv.slice(2);
const SKILL_TOKEN = /^skill:seedbank-skills\/[a-z0-9][a-z0-9-]*$/u;
if (
  !output ||
  !releaseTag ||
  ids.length === 0 ||
  ids.some((id) => !SKILL_TOKEN.test(id) && !/^[a-z0-9][a-z0-9-]*$/u.test(id))
) {
  throw new Error(
    "Usage: node --import ./scripts/tsx.mjs scripts/seedbank-prepare.mjs <output-dir> <plugins-release-tag> <extension-id | skill:seedbank-skills/<slug>> [...]",
  );
}
const destination = resolve(output);
mkdirSync(destination, { recursive: true });
function run(command, args, cwd = root) {
  const invocation =
    command === "npm"
      ? resolveCommandShim(command, args)
      : { command, args, windowsVerbatimArguments: false };
  const result = spawnSync(invocation.command, invocation.args, {
    cwd,
    encoding: "utf8",
    env: process.env,
    shell: false,
    windowsHide: true,
    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
  });
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message ?? result.stderr ?? `${command} failed`);
  }
  return result.stdout;
}
const sourceSha = run("git", ["rev-parse", "HEAD"]).trim();
const packages = [];
// The pack manifest is the author's declaration: kind, tier and every permission. It is validated here.
function readPackSource(dir) {
  const text = readFileSync(join(dir, PACK_FILE), "utf8");
  validatePackManifest(JSON.parse(text));
  return text;
}
// Community packs are scanned with the same skill scanner the ordinary installer uses. A blocked pack is refused here.
async function scanRecord(dir) {
  const summary = await scanDirectoryWithSummary(dir);
  if (summary.critical > 0) {
    throw new Error(`Pack refused by the scanner: ${summary.critical} critical finding(s).`);
  }
  return {
    scanner: "branch-skill-scanner/v1",
    scannedFiles: summary.scannedFiles,
    critical: summary.critical,
    warn: summary.warn,
    info: summary.info,
    truncated: summary.truncated,
  };
}
// A skill is a folder with SKILL.md, branch.pack.json and package.json. It packs as-is; no plugin runtime build applies.
async function packSkill(token) {
  const skillDir = join(root, token.slice("skill:".length));
  const source = JSON.parse(readFileSync(join(skillDir, "package.json"), "utf8"));
  if (!existsSync(join(skillDir, "SKILL.md"))) {
    throw new Error(`${token} has no SKILL.md.`);
  }
  readPackSource(skillDir);
  if (Array.isArray(source.files) && !source.files.includes(PACK_FILE)) {
    throw new Error(`${token}: add ${PACK_FILE} to package.json files.`);
  }
  const scan = await scanRecord(skillDir);
  const packed = JSON.parse(
    run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", destination], skillDir),
  );
  if (packed.length !== 1) {
    throw new Error("Expected exactly one npm pack result.");
  }
  process.stderr.write(`packed ${source.name}@${source.version}\n`);
  const filename = packed[0].filename;
  packages.push({ filename, bytes: readFileSync(join(destination, filename)), scan });
}
for (const id of new Set(ids)) {
  if (SKILL_TOKEN.test(id)) {
    await packSkill(id);
    continue;
  }
  const packageDir = join(root, "extensions", id);
  const source = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  if (source.branch?.release?.publishToNpm !== true) {
    throw new Error(`${id} does not opt into npm publication.`);
  }
  process.stderr.write(
    run(process.execPath, ["scripts/lib/plugin-npm-runtime-build.mjs", `extensions/${id}`]),
  );
  const scan =
    JSON.parse(readPackSource(packageDir)).tier === "community"
      ? await scanRecord(packageDir)
      : undefined;
  withAugmentedPluginNpmManifestForPackage(
    { repoRoot: root, packageDir },
    ({ packageDir: cwd }) => {
      const file = join(cwd, "package.json");
      const original = readFileSync(file);
      const licensePath = join(cwd, "LICENSE");
      const readmePath = join(cwd, "README.md");
      const license = existsSync(licensePath) ? readFileSync(licensePath) : undefined;
      const readme = existsSync(readmePath) ? readFileSync(readmePath) : undefined;
      const packPath = join(cwd, PACK_FILE);
      const packBefore = existsSync(packPath) ? readFileSync(packPath) : undefined;
      const packText = readPackSource(packageDir);
      try {
        const manifest = resolveSeedbankPackageManifest(JSON.parse(original));
        writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
        writeFileSync(packPath, packText);
        if (!license) {
          writeFileSync(licensePath, readFileSync(join(root, "LICENSE")));
        }
        const attribution =
          readme
            ?.toString("utf8")
            .split("\n")
            .filter((line) => /copyright|SPDX|licensed under/iu.test(line))
            .join("\n") ?? "";
        writeFileSync(
          readmePath,
          `# ${manifest.name}\n\n${manifest.description ?? "Branch Agent plugin."}\n\nInstall using Branch Agent:\n\n\`\`\`sh\nbranch plugins install ${manifest.name}@${manifest.version} --force\n\`\`\`\n\nSeedbank offers the identical tarball as a GitHub Releases backup. See [distribution documentation](https://github.com/KeepOak/Branch-Agent/blob/main/engine/docs/plugins/seedbank-distribution.md).\n\n${attribution}\n`,
        );
        const packed = JSON.parse(
          run(
            "npm",
            ["pack", "--ignore-scripts", "--json", "--pack-destination", destination],
            cwd,
          ),
        );
        if (packed.length !== 1) {
          throw new Error("Expected exactly one npm pack result.");
        }
        const filename = packed[0].filename;
        packages.push({ filename, bytes: readFileSync(join(destination, filename)), scan });
      } finally {
        writeFileSync(file, original);
        if (packBefore) {
          writeFileSync(packPath, packBefore);
        } else {
          rmSync(packPath, { force: true });
        }
        if (readme) {
          writeFileSync(readmePath, readme);
        } else {
          rmSync(readmePath, { force: true });
        }
        if (license) {
          writeFileSync(licensePath, license);
        } else {
          rmSync(licensePath, { force: true });
        }
      }
    },
  );
}
const catalog = createSeedbankCatalog({ sourceSha, releaseTag, packages });
writeFileSync(join(destination, "seedbank.json"), `${JSON.stringify(catalog, null, 2)}\n`);
const template = readFileSync(join(root, "scripts", "seedbank-catalog.html"), "utf8");
const embedded = JSON.stringify(catalog)
  .replaceAll("<", "\\u003c")
  .replaceAll(">", "\\u003e")
  .replaceAll("&", "\\u0026");
writeFileSync(join(destination, "index.html"), template.replace("__SEEDBANK_CATALOG__", embedded));
console.log(
  JSON.stringify({
    sourceSha,
    packages: catalog.packages.length,
    catalog: join(destination, "seedbank.json"),
  }),
);
