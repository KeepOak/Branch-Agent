import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { inspectPackageTarballBytes } from "../plugin-publication-artifact.mjs";
import { buildCmdExeCommandLine, resolveWindowsCmdExePath } from "../windows-cmd-helpers.mjs";

const PACKAGE = /^@branch-agent\/[a-z0-9][a-z0-9._-]*$/u;
const VERSION = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/u;
const SLUG = /^[a-z0-9][a-z0-9._-]*$/u;
const REPOSITORY = "https://github.com/KeepOak/Branch-Agent";
const SCOPE = "@branch-agent/";
const PACKAGE_PREFIX = "package/";
const SKILL_MARKDOWN = `${PACKAGE_PREFIX}SKILL.md`;
const PLUGIN_MANIFEST = `${PACKAGE_PREFIX}branch.plugin.json`;
const PACK_MANIFEST_FILE = "branch.pack.json";
const PACK_MANIFEST = `${PACKAGE_PREFIX}${PACK_MANIFEST_FILE}`;
const PACK_SCHEMA = "branch.pack/v1";
const PACK_KINDS = new Set(["skill", "plugin"]);
const PACK_TIERS = new Set(["bundled", "official", "community"]);
const FILES_MODES = new Set(["none", "workspace"]);
const PERMISSION_KEYS = ["network", "files", "runCommands", "secrets", "computerControl"];
const NO_PERMISSIONS = {
  network: false,
  files: "none",
  runCommands: false,
  secrets: false,
  computerControl: false,
};
// Only the owner's pipeline may mark a pack official. Plugin ids listed here may be official; nothing else may.
export const OFFICIAL_PLUGIN_IDS = new Set(["cerebras"]);
const WINDOWS_RESERVED_STEM = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu;

export function permissionsEqual(left, right) {
  return PERMISSION_KEYS.every((key) => left?.[key] === right?.[key]);
}

function isAllOff(permissions) {
  return permissionsEqual(permissions, NO_PERMISSIONS);
}

// A community author may not claim a tier. Official status belongs to allowlisted owner plugins.
export function assertTierAllowed({ kind, id, tier }) {
  if (tier === "community") {
    return;
  }
  if (tier === "official" && kind === "plugin" && OFFICIAL_PLUGIN_IDS.has(id)) {
    return;
  }
  throw new Error(`Tier "${tier}" is set by the owner pipeline; this pack must be community.`);
}

// Community packs need a clean scan record before they enter the catalog.
export function assertCleanScan({ tier, scan }) {
  if (tier !== "community") {
    return;
  }
  const clean =
    scan !== undefined &&
    scan !== null &&
    scan.critical === 0 &&
    scan.truncated === false &&
    typeof scan.scanner === "string";
  if (!clean) {
    throw new Error("Community packs need a clean scan record before they enter the catalog.");
  }
}

// Refuses names Windows cannot store safely: alternate streams, device names, trailing dots or spaces.
export function assertPortablePath(relativePath) {
  for (const segment of relativePath.split("/")) {
    const stem = segment.split(".")[0].trimEnd();
    if (
      segment.includes(":") ||
      WINDOWS_RESERVED_STEM.test(stem) ||
      /[. ]$/u.test(segment)
    ) {
      throw new Error(`Seedbank path is not portable to Windows: ${relativePath}`);
    }
  }
}

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
    result.files = [...new Set([...result.files, "LICENSE", PACK_MANIFEST_FILE])];
  }
  result.license ??= "MIT";
  return result;
}

// A skill has no branch.plugin.json. Its identity is the SKILL.md frontmatter name.
export function parseSkillName(markdown) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(markdown);
  const line = frontmatter?.[1].split(/\r?\n/u).find((item) => /^name:/u.test(item));
  const name = line
    ?.slice("name:".length)
    .trim()
    .replace(/^(["'])(.*)\1$/u, "$2");
  if (!name) {
    throw new Error("SKILL.md frontmatter must declare a name.");
  }
  return name;
}

function isPermissionBlock(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    Object.keys(value).sort().join(",") === [...PERMISSION_KEYS].sort().join(",") &&
    typeof value.network === "boolean" &&
    FILES_MODES.has(value.files) &&
    typeof value.runCommands === "boolean" &&
    typeof value.secrets === "boolean" &&
    typeof value.computerControl === "boolean"
  );
}

// Every pack declares what it can reach. A skill is instructions only, so it declares none.
export function validatePackManifest(manifest) {
  const valid =
    manifest?.schema === PACK_SCHEMA &&
    PACK_KINDS.has(manifest.kind) &&
    PACK_TIERS.has(manifest.tier) &&
    SLUG.test(manifest.id ?? "") &&
    isPermissionBlock(manifest.permissions) &&
    (manifest.summary === undefined || typeof manifest.summary === "string");
  if (!valid) {
    throw new Error("Seedbank pack manifest is invalid.");
  }
  if (manifest.kind === "skill" && !isAllOff(manifest.permissions)) {
    throw new Error("Skills are instructions only and may not declare permissions.");
  }
  return manifest;
}

// Returns the pack manifest and the identity it must agree with: SKILL.md name or plugin id.
export function inspectSeedbankTarball(bytes) {
  const files = new Map();
  const inspected = inspectPackageTarballBytes(bytes, {
    requirePluginManifest: false,
    onFile: ({ content, path }) => {
      if ([SKILL_MARKDOWN, PLUGIN_MANIFEST, PACK_MANIFEST].includes(path)) {
        files.set(path, Buffer.from(content).toString("utf8"));
      }
    },
  });
  if (!files.has(PACK_MANIFEST)) {
    throw new Error("Seedbank package must contain branch.pack.json.");
  }
  const pack = validatePackManifest(JSON.parse(files.get(PACK_MANIFEST)));
  const declared =
    pack.kind === "skill"
      ? files.has(SKILL_MARKDOWN) && parseSkillName(files.get(SKILL_MARKDOWN))
      : inspected.pluginManifest?.id;
  if (!declared || declared !== pack.id) {
    throw new Error("Seedbank pack id differs from its skill or plugin identity.");
  }
  return { inspected, pack, kind: pack.kind, id: pack.id };
}

function assertPackageIdentity({ kind, id }, manifestName) {
  const sameSkill = kind !== "skill" || id === manifestName.slice(SCOPE.length);
  if (!SLUG.test(id) || !sameSkill) {
    throw new Error("Seedbank catalog contains an invalid package identity.");
  }
}

export function createSeedbankCatalog({ sourceSha, releaseTag, packages }) {
  if (!/^[a-f0-9]{40}$/u.test(sourceSha) || !/^plugins-[a-zA-Z0-9.-]+$/u.test(releaseTag)) {
    throw new Error("Seedbank catalog requires an exact source SHA and plugin release tag.");
  }
  const identities = new Set();
  const entries = packages
    .map(({ filename, bytes, scan }) => {
      const { inspected, pack, kind, id } = inspectSeedbankTarball(bytes);
      const manifest = inspected.packageManifest;
      if (!PACKAGE.test(manifest.name) || !VERSION.test(manifest.version)) {
        throw new Error("Seedbank catalog contains an invalid package identity.");
      }
      assertPackageIdentity({ kind, id }, manifest.name);
      assertTierAllowed({ kind, id, tier: pack.tier });
      assertCleanScan({ tier: pack.tier, scan });
      for (const item of inspected.inventory) {
        assertPortablePath(item.path.slice(PACKAGE_PREFIX.length));
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
        kind,
        tier: pack.tier,
        permissions: pack.permissions,
        summary: pack.summary ?? "",
        scan: scan ?? null,
        ...(kind === "plugin" ? { pluginId: id } : { skillName: id }),
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
    entry.size > 256 * 1024 * 1024 ||
    !["plugin", "skill"].includes(entry.kind ?? "plugin") ||
    !PACK_TIERS.has(entry.tier) ||
    !isPermissionBlock(entry.permissions) ||
    !SLUG.test(entry.kind === "skill" ? (entry.skillName ?? "") : (entry.pluginId ?? ""))
  ) {
    throw new Error("Invalid Seedbank package binding.");
  }
  return entry;
}

// Refuses bytes whose digest, identity or kind differ from the catalog entry.
export function verifySeedbankPackage(entry, bytes) {
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  const { inspected, pack, kind, id } = inspectSeedbankTarball(bytes);
  const expectedId = kind === "skill" ? entry.skillName : entry.pluginId;
  if (
    bytes.length !== entry.size ||
    integrity !== entry.integrity ||
    inspected.tarballSha256 !== entry.sha256 ||
    inspected.packageManifest.name !== entry.name ||
    inspected.packageManifest.version !== entry.version ||
    kind !== (entry.kind ?? "plugin") ||
    id !== expectedId ||
    pack.tier !== entry.tier ||
    !permissionsEqual(pack.permissions, entry.permissions)
  ) {
    throw new Error("Seedbank package integrity or identity mismatch; installation refused.");
  }
  return inspected;
}

// Writes a verified skill package into parentDir/<skill name>, ready for `branch skills install`.
export function stageSeedbankSkill({ bytes, entry, parentDir }) {
  const files = [];
  inspectPackageTarballBytes(bytes, {
    requirePluginManifest: false,
    onFile: ({ content, path }) => files.push({ path, content: Buffer.from(content) }),
  });
  const directory = resolve(parentDir, entry.skillName);
  for (const { path, content } of files) {
    const relative = path.slice(PACKAGE_PREFIX.length);
    assertPortablePath(relative);
    const target = resolve(directory, relative);
    if (!target.startsWith(`${directory}${sep}`)) {
      throw new Error("Seedbank skill path escapes its staging directory.");
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, { mode: 0o644 });
  }
  return directory;
}

// Argument list handed to the ordinary Branch Agent installer. Consent and policy run there.
export function seedbankInstallArgs({ entry, location, options = [] }) {
  if (entry.kind === "skill") {
    return ["skills", "install", location, "--as", entry.skillName, ...options];
  }
  return ["plugins", "install", location, ...options];
}

// Only the variables npm needs to publish with OIDC provenance. GH_TOKEN and other job secrets are not passed.
const NPM_ENV_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "LANG",
  "TMPDIR",
  "TEMP",
  "TMP",
  "SYSTEMROOT",
  "RUNNER_TEMP",
  "CI",
  "ACTIONS_ID_TOKEN_REQUEST_URL",
  "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
];
const GH_ENV_KEYS = ["PATH", "HOME", "TMPDIR", "TEMP", "TMP", "SYSTEMROOT"];

function pickEnv(source, keys) {
  return Object.fromEntries(
    keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]),
  );
}

// npm publish runs in a job that holds contents:write, so it gets no GitHub token at all.
export function npmPublishEnv(source = process.env) {
  return pickEnv(source, NPM_ENV_KEYS);
}

// gh gets GH_TOKEN and nothing else from the job's environment.
export function ghCommandEnv(source = process.env) {
  const env = pickEnv(source, GH_ENV_KEYS);
  if (source.GH_TOKEN !== undefined) {
    env.GH_TOKEN = source.GH_TOKEN;
  }
  return env;
}
