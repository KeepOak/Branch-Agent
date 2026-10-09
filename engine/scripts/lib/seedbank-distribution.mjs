import { createHash } from "node:crypto";
import { inspectPackageTarballBytes } from "../plugin-publication-artifact.mjs";
import { buildCmdExeCommandLine, resolveWindowsCmdExePath } from "../windows-cmd-helpers.mjs";

const PACKAGE = /^@branch-agent\/[a-z0-9][a-z0-9._-]*$/u;
const VERSION = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/u;
const REPOSITORY = "https://github.com/KeepOak/Branch-Agent";

// npm and branch are .cmd shims on Windows; spawn them through cmd.exe as docs-dev.mjs does.
export function resolveCommandShim(command, args, platform = process.platform) {
  if (platform !== "win32") {
    return { command, args, windowsVerbatimArguments: false };
  }
  return {
    command: resolveWindowsCmdExePath(),
    args: ["/d", "/s", "/c", buildCmdExeCommandLine(`${command}.cmd`, args)],
    windowsVerbatimArguments: true,
  };
}

// Publication-only identity mapping. Workspace SDK names and license files stay untouched.
export function resolveSeedbankPackageManifest(manifest) {
  const result = structuredClone(manifest);
  if (!/^@branch\/[a-z0-9][a-z0-9._-]*$/u.test(result.name ?? "")) {
    throw new Error("Seedbank publication requires an official Branch Agent package.");
  }
  result.name = result.name.replace(/^@branch\//u, "@branch-agent/");
  result.repository = { type: "git", url: "https://github.com/KeepOak/Branch-Agent.git" };
  result.publishConfig = {
    ...result.publishConfig,
    access: "public",
    registry: "https://registry.npmjs.org/",
  };
  result.branch = {
    ...result.branch,
    install: {
      ...result.branch?.install,
      npmSpec: result.name,
      seedbankSpec: `seedbank:${result.name}`,
      defaultChoice: "npm",
    },
  };
  delete result.branch.install.clawhubSpec;
  result.branch.release = { ...result.branch.release, publishToSeedbank: true };
  delete result.branch.release.publishToClawHub;
  if (Array.isArray(result.files)) {
    result.files = [...new Set([...result.files, "LICENSE"])];
  }
  result.license ??= "MIT";
  return result;
}

export function createSeedbankCatalog({ sourceSha, releaseTag, packages }) {
  if (!/^[a-f0-9]{40}$/u.test(sourceSha) || !/^plugins-[a-zA-Z0-9.-]+$/u.test(releaseTag)) {
    throw new Error("Seedbank catalog requires an exact source SHA and plugin release tag.");
  }
  const identities = new Set();
  const entries = packages
    .map(({ filename, bytes }) => {
      const inspected = inspectPackageTarballBytes(bytes);
      const manifest = inspected.packageManifest;
      if (
        !PACKAGE.test(manifest.name) ||
        !VERSION.test(manifest.version) ||
        !/^[a-z0-9][a-z0-9._-]*$/u.test(inspected.pluginManifest.id ?? "")
      ) {
        throw new Error("Seedbank catalog contains an invalid package identity.");
      }
      const expectedFilename = `${manifest.name.slice(1).replace("/", "-")}-${manifest.version}.tgz`;
      if (filename !== expectedFilename) {
        throw new Error("Seedbank tarball filename differs from its package identity.");
      }
      const identity = `${manifest.name}@${manifest.version}`;
      if (identities.has(identity)) {
        throw new Error("Duplicate Seedbank package identity.");
      }
      identities.add(identity);
      return {
        name: manifest.name,
        version: manifest.version,
        pluginId: inspected.pluginManifest.id,
        description: manifest.description ?? "",
        npmSpec: identity,
        seedbankSpec: `seedbank:${identity}`,
        filename,
        integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
        sha256: inspected.tarballSha256,
        size: bytes.length,
        tarball: `${REPOSITORY}/releases/download/${releaseTag}/${filename}`,
      };
    })
    .toSorted((a, b) => a.npmSpec.localeCompare(b.npmSpec));
  return { schema: "branch-agent.seedbank/v1", sourceSha, releaseTag, packages: entries };
}

export function resolveSeedbankEntry(catalog, spec) {
  const match =
    /^seedbank:(@branch-agent\/[a-z0-9][a-z0-9._-]*)(?:@(\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?))?$/u.exec(
      spec,
    );
  if (
    !match ||
    catalog?.schema !== "branch-agent.seedbank/v1" ||
    !Array.isArray(catalog.packages)
  ) {
    throw new Error("Invalid Seedbank catalog or install spec.");
  }
  const matches = catalog.packages.filter(
    (entry) => entry.name === match[1] && (!match[2] || entry.version === match[2]),
  );
  if (matches.length !== 1) {
    throw new Error("Seedbank spec must resolve to exactly one catalog package; pin a version.");
  }
  const entry = matches[0];
  const filename = `${entry.name.slice(1).replace("/", "-")}-${entry.version}.tgz`;
  if (
    !VERSION.test(entry.version) ||
    !/^plugins-[a-zA-Z0-9.-]+$/u.test(catalog.releaseTag) ||
    entry.filename !== filename ||
    entry.npmSpec !== `${entry.name}@${entry.version}` ||
    entry.tarball !== `${REPOSITORY}/releases/download/${catalog.releaseTag}/${filename}` ||
    !/^sha512-[A-Za-z0-9+/]{86}==$/u.test(entry.integrity) ||
    !/^[a-f0-9]{64}$/u.test(entry.sha256) ||
    !Number.isSafeInteger(entry.size) ||
    entry.size <= 0 ||
    entry.size > 256 * 1024 * 1024
  ) {
    throw new Error("Invalid Seedbank package binding.");
  }
  return entry;
}
