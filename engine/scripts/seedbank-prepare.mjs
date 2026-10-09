#!/usr/bin/env node
// Builds and packs once. No npm publication or GitHub write happens here.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { withAugmentedPluginNpmManifestForPackage } from "./lib/plugin-npm-package-manifest.mts";
import {
  createSeedbankCatalog,
  resolveSeedbankPackageManifest,
} from "./lib/seedbank-distribution.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const [output, releaseTag, ...ids] = process.argv.slice(2);
if (
  !output ||
  !releaseTag ||
  ids.length === 0 ||
  ids.some((id) => !/^[a-z0-9][a-z0-9-]*$/u.test(id))
) {
  throw new Error(
    "Usage: node --import ./scripts/tsx.mjs scripts/seedbank-prepare.mjs <output-dir> <plugins-release-tag> <extension-id> [...]",
  );
}
const destination = resolve(output);
mkdirSync(destination, { recursive: true });
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: process.env,
    shell: false,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message ?? result.stderr ?? `${command} failed`);
  }
  return result.stdout;
}
const sourceSha = run("git", ["rev-parse", "HEAD"]).trim();
const packages = [];
for (const id of new Set(ids)) {
  const packageDir = join(root, "extensions", id);
  const source = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  if (source.branch?.release?.publishToNpm !== true) {
    throw new Error(`${id} does not opt into npm publication.`);
  }
  process.stderr.write(
    run(process.execPath, ["scripts/lib/plugin-npm-runtime-build.mjs", `extensions/${id}`]),
  );
  withAugmentedPluginNpmManifestForPackage(
    { repoRoot: root, packageDir },
    ({ packageDir: cwd }) => {
      const file = join(cwd, "package.json");
      const original = readFileSync(file);
      const licensePath = join(cwd, "LICENSE");
      const readmePath = join(cwd, "README.md");
      const license = existsSync(licensePath) ? readFileSync(licensePath) : undefined;
      const readme = existsSync(readmePath) ? readFileSync(readmePath) : undefined;
      try {
        const manifest = resolveSeedbankPackageManifest(JSON.parse(original));
        writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
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
        packages.push({ filename, bytes: readFileSync(join(destination, filename)) });
      } finally {
        writeFileSync(file, original);
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
