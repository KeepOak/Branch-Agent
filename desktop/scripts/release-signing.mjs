#!/usr/bin/env node
// Code signing for the release installers. It stays off until the owner adds the secrets and variables named below
// (desktop/INSTALLERS.md, "Left for the owner"), and says so in one plain line instead of failing.
//   node desktop/scripts/release-signing.mjs status [--target <target>] [--strict]
// Nothing set: one line per target, exit 0, the installers ship unsigned.
// Some set: the line names exactly what is missing, nothing is signed (never half-signed), exit 0 unless --strict.
// All set: release-installers.mjs signs through createSigner below.
//   win32-x64: Azure Artifact Signing through SignTool and its dlib. Branch Agent.exe before packaging, the setup .exe after.
//   darwin-arm64: Developer ID codesign with the hardened runtime, then notarytool submit --wait and stapler staple.
// Command lines are built by pure functions so tests can check them without running anything. Secret values travel
// in the environment or in files, and any that reach a printed command line are replaced with ***.
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { closeSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const TARGETS = ["win32-x64", "darwin-arm64", "linux-x64"];

/** Repository secrets: the app registration allowed to sign. Azure's EnvironmentCredential reads them as they are. */
export const WINDOWS_SECRETS = ["AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET"];
/** Repository variables (not secret): the Artifact Signing endpoint, account name and certificate profile name. */
export const WINDOWS_VARIABLES = ["AZURE_SIGNING_ENDPOINT", "AZURE_SIGNING_ACCOUNT", "AZURE_SIGNING_PROFILE"];
/** Repository secrets: the Developer ID Application certificate and an App Store Connect API key for notarization. */
export const MAC_SECRETS = ["APPLE_DEVELOPER_ID_P12", "APPLE_DEVELOPER_ID_PASSWORD", "APPLE_NOTARY_KEY_ID", "APPLE_NOTARY_ISSUER_ID", "APPLE_NOTARY_KEY"];

export const REQUIRED = {
  "win32-x64": [...WINDOWS_SECRETS, ...WINDOWS_VARIABLES],
  "darwin-arm64": MAC_SECRETS,
  "linux-x64": [],
};
/** Values never printed, even inside a command line. */
export const SECRET_NAMES = [...WINDOWS_SECRETS, ...MAC_SECRETS];

const LABEL = { "win32-x64": "Windows", "darwin-arm64": "macOS", "linux-x64": "Linux" };
const NOT_CONFIGURED = {
  "win32-x64": "set AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET and the three AZURE_SIGNING_* variables",
  "darwin-arm64": "set APPLE_DEVELOPER_ID_P12, APPLE_DEVELOPER_ID_PASSWORD, APPLE_NOTARY_KEY_ID, APPLE_NOTARY_ISSUER_ID and APPLE_NOTARY_KEY",
};
const UNSIGNED = {
  "win32-x64": "Shipping unsigned.",
  "darwin-arm64": "Shipping the self-signed app, not notarized.",
};

/** Azure's recommended timestamp authority. Its certificates last three days, so every signature is timestamped. */
export const AZURE_TIMESTAMP_URL = "http://timestamp.acs.microsoft.com";
/**
 * Pinned NuGet packages: SignTool from the Windows SDK build tools, and the Artifact Signing dlib it loads.
 * Each digest is pinned in the repo, never taken from the download: sha512 is the packageHash NuGet's catalog
 * publishes for that exact version, and sha256 is of the same .nupkg bytes. A download that matches neither
 * is refused before it is extracted, so a changed or substituted package never runs with the signing secrets.
 */
export const WINDOWS_TOOL_PACKAGES = [
  {
    id: "Microsoft.Windows.SDK.BuildTools",
    version: "10.0.26100.6901",
    file: "signtool.exe",
    sha256: "40109fe95b6ccd449327edfbf91a8eef4838e6982e66a6a90a1d6d9eb7d98747",
    sha512: "IfSuuRHAr1KrSYZpDMYHUCROkDBrUuHI+CRXw68KwFMx0hGNmn4NeWvumVN0d75W9ZLD3yy25YfclV6eSAIqHQ==",
  },
  {
    id: "Microsoft.ArtifactSigning.Client",
    version: "1.0.146",
    file: "Azure.CodeSigning.Dlib.dll",
    sha256: "7761e5d8f31e54b764da21d33cd8b0a2940e1b05526c7dfcb5e94b0431426f70",
    sha512: "/G0hG/VDIS6psW23b5t1V/ORIgn0PVAOtGj9w+hkPmAuI4pempfwlW50E2GtHscnz9+5Qz3hbC4mcb7ej2Yn1A==",
  },
];

/** Checks a downloaded .nupkg against its pinned digests. Throws, naming the package, on any mismatch. */
export function verifyToolPackage(archive, pkg) {
  const bytes = readFileSync(archive);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const sha512 = createHash("sha512").update(bytes).digest("base64");
  if (sha256 !== pkg.sha256 || sha512 !== pkg.sha512) {
    throw new Error(
      `Refusing ${pkg.id} ${pkg.version}: the download does not match its pinned digest (SHA-256 ${sha256}, expected ${pkg.sha256}). Nothing was extracted or signed.`,
    );
  }
}
/** Only EnvironmentCredential (the three AZURE_* secrets) may authenticate. Skip every other way DefaultAzureCredential tries. */
export const AZURE_EXCLUDED_CREDENTIALS = [
  "ManagedIdentityCredential", "WorkloadIdentityCredential", "SharedTokenCacheCredential", "VisualStudioCredential",
  "VisualStudioCodeCredential", "AzureCliCredential", "AzurePowerShellCredential", "AzureDeveloperCliCredential",
  "InteractiveBrowserCredential",
];
/** Electron and the bundled Node need these under the hardened runtime. */
export const MAC_ENTITLEMENTS = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
  '<plist version="1.0">',
  "<dict>",
  "  <key>com.apple.security.cs.allow-jit</key><true/>",
  "  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>",
  "  <key>com.apple.security.cs.disable-library-validation</key><true/>",
  "</dict>",
  "</plist>",
  "",
].join("\n");

const isSet = (env, name) => typeof env[name] === "string" && env[name].trim() !== "";

/** "A", "A and B", "A, B and C". */
export function listNames(names) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** none: nothing set. partial: some set, missing names the rest. ready: everything set. n/a: nothing to sign. */
export function signingStatus(target, env = process.env) {
  if (!TARGETS.includes(target)) throw new Error(`Unknown target ${target}`);
  const required = REQUIRED[target];
  if (required.length === 0) return { target, state: "n/a", required, missing: [] };
  const missing = required.filter((name) => !isSet(env, name));
  const state = missing.length === 0 ? "ready" : missing.length === required.length ? "none" : "partial";
  return { target, state, required, missing };
}

/** The one plain line a release log shows per target. Names only, never values. */
export function statusLine(status) {
  const label = LABEL[status.target];
  if (status.state === "n/a") return `${label} signing: nothing to sign (no ${label} installer yet).`;
  if (status.state === "none") return `${label} signing: not configured (${NOT_CONFIGURED[status.target]}). ${UNSIGNED[status.target]}`;
  if (status.state === "partial") {
    return `${label} signing: partly configured, missing ${listNames(status.missing)}. Nothing is signed until all are set. ${UNSIGNED[status.target]}`;
  }
  return status.target === "win32-x64"
    ? "Windows signing: configured. Signing Branch Agent.exe and the setup .exe with Azure Artifact Signing."
    : "macOS signing: configured. Signing with the Developer ID certificate, then notarizing and stapling the disk image.";
}

/** Replaces every secret value (and any extra, such as a throwaway keychain password) in a printable command line. */
export function redact(text, env = process.env, extra = []) {
  const values = [...SECRET_NAMES.map((name) => env[name]), ...extra]
    .filter((value) => typeof value === "string" && value.trim().length >= 4)
    .sort((a, b) => b.length - a.length);
  let out = String(text);
  for (const value of values) out = out.split(value).join("***");
  return out;
}

export function printableCommand(command, args) {
  return [command, ...args].map((part) => (/[\s"]/.test(part) ? JSON.stringify(part) : part)).join(" ");
}

// ---- Windows: Azure Artifact Signing through SignTool ----

/** metadata.json for the dlib. No secrets: those stay in the environment for EnvironmentCredential. */
export function azureMetadata(env = process.env) {
  return {
    Endpoint: env.AZURE_SIGNING_ENDPOINT,
    CodeSigningAccountName: env.AZURE_SIGNING_ACCOUNT,
    CertificateProfileName: env.AZURE_SIGNING_PROFILE,
    ExcludeCredentials: AZURE_EXCLUDED_CREDENTIALS,
  };
}

export function nugetUrl({ id, version }) {
  const lower = id.toLowerCase();
  return `https://api.nuget.org/v3-flatcontainer/${lower}/${version}/${lower}.${version}.nupkg`;
}

/** The documented SignTool call: SHA256 digest, RFC 3161 timestamp from Azure, the Artifact Signing dlib and metadata. */
export function signtoolArgs({ dlib, metadata, file }) {
  return ["sign", "/v", "/fd", "SHA256", "/tr", AZURE_TIMESTAMP_URL, "/td", "SHA256", "/dlib", dlib, "/dmdf", metadata, file];
}

export function signtoolVerifyArgs(file) {
  return ["verify", "/pa", "/v", file];
}

// ---- macOS: Developer ID, hardened runtime, notarization ----

/** A throwaway keychain holding only the Developer ID identity, searched alongside the existing user keychains. */
/** One security(1) interactive-mode line, each word double-quoted so spaces and quotes survive. */
export function securityLine(words) {
  for (const word of words) {
    if (/[\r\n]/.test(word)) throw new Error("A signing value contains a line break, which security -i cannot take");
  }
  return words.map((word) => '"' + word.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"').join(" ") + "\n";
}

/**
 * The keychain setup, as [command, args, stdin?]. Commands that take a password run as `security -i` with the
 * command on stdin, so neither the keychain password nor the .p12 password is ever in argv, where other local
 * processes could read it with ps.
 */
export function keychainCommands({ keychain, keychainPassword, p12, p12Password, existing = [] }) {
  const viaStdin = (words) => ["security", ["-i"], securityLine(words)];
  return [
    viaStdin(["create-keychain", "-p", keychainPassword, keychain]),
    ["security", ["set-keychain-settings", "-lut", "21600", keychain]],
    viaStdin(["unlock-keychain", "-p", keychainPassword, keychain]),
    viaStdin(["import", p12, "-k", keychain, "-P", p12Password, "-f", "pkcs12", "-T", "/usr/bin/codesign"]),
    viaStdin(["set-key-partition-list", "-S", "apple-tool:,apple:", "-s", "-k", keychainPassword, keychain]),
    ["security", ["list-keychains", "-d", "user", "-s", keychain, ...existing]],
  ];
}

/** The SHA-1 of the first "Developer ID Application" identity in security find-identity -v -p codesigning output. */
export function parseDeveloperIdentity(output) {
  const match = /^\s*\d+\)\s+([0-9A-F]{40})\s+"Developer ID Application: [^"]+"/m.exec(String(output));
  if (!match) throw new Error('The Developer ID certificate holds no "Developer ID Application" identity');
  return match[1];
}

/** security list-keychains output as plain paths. */
export function parseKeychainList(output) {
  return String(output).split(/\r?\n/).map((line) => line.trim().replace(/^"|"$/g, "")).filter(Boolean);
}

export function codesignArgs({ identity, keychain, file, entitlements, runtime = true }) {
  return [
    "--force", "--timestamp",
    ...(runtime ? ["--options", "runtime"] : []),
    ...(entitlements ? ["--entitlements", entitlements] : []),
    "--keychain", keychain, "--sign", identity, file,
  ];
}

export function codesignVerifyArgs(file) {
  return ["--verify", "--deep", "--strict", "--verbose=2", file];
}

export function notarySubmitArgs({ file, keyFile, keyId, issuer }) {
  return ["notarytool", "submit", file, "--key", keyFile, "--key-id", keyId, "--issuer", issuer, "--wait"];
}

export function stapleArgs(file) {
  return ["stapler", "staple", file];
}

/** The notary key as .p8 text: pasted as is, or base64 of the file. */
export function notaryKeyText(value) {
  const text = String(value ?? "");
  return text.includes("BEGIN PRIVATE KEY") ? text : Buffer.from(text, "base64").toString("utf8");
}

const LIBRARY = /\.(dylib|so|node)$/;
const BUNDLE = /\.(app|framework)$/;

/**
 * Inside-out signing order for an app's nested code: deepest paths first, plain files before the bundles that hold
 * them, the app's own Contents/MacOS executables after every nested bundle, the app itself last. Executables and .app bundles get the entitlements; libraries and frameworks don't.
 */
export function macSigningOrder(app, nested) {
  const depth = (path) => path.split(/[\\/]/).length;
  const rank = (entry) => (entry.kind === "file" ? 0 : 1);
  const ordered = [...nested].sort((a, b) => depth(b.path) - depth(a.path) || rank(a) - rank(b) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  // The app's own executables in Contents/MacOS go after every nested bundle: they are the app's main code.
  const main = (entry) => entry.path.startsWith(app + "/Contents/MacOS/") || entry.path.startsWith(app + "\\Contents\\MacOS\\");
  return [...ordered.filter((entry) => !main(entry)), ...ordered.filter(main), { path: app, kind: "bundle" }].map((entry) => ({
    ...entry,
    entitlements: entry.kind === "bundle" ? entry.path.endsWith(".app") : !LIBRARY.test(entry.path),
  }));
}

const MACHO = new Set(["feedfacf", "cffaedfe", "feedface", "cefaedfe", "cafebabe", "bebafeca"]);

function isMachO(file) {
  const fd = openSync(file, "r");
  try {
    const head = Buffer.alloc(4);
    return readSync(fd, head, 0, 4, 0) === 4 && MACHO.has(head.toString("hex"));
  } finally {
    closeSync(fd);
  }
}

/** Every bundle and Mach-O file under the app's Contents, skipping symlinks (such as a framework's Versions/Current). */
export function findNestedCode(app) {
  const found = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const info = lstatSync(path);
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) {
        walk(path);
        if (BUNDLE.test(name)) found.push({ path, kind: "bundle" });
      } else if (info.isFile() && info.size >= 4 && isMachO(path)) {
        found.push({ path, kind: "file" });
      }
    }
  };
  walk(join(app, "Contents"));
  return found;
}

// ---- running ----

function defaultRun(command, args, { env, extra, capture = false, input } = {}) {
  const shown = input === undefined ? "" : " <<< " + input.trim();
  console.log(`$ ${redact(printableCommand(command, args) + shown, env, extra)}`);
  const stdin = input === undefined ? "ignore" : "pipe";
  const result = spawnSync(command, args, { input, stdio: capture ? [stdin, "pipe", "inherit"] : input === undefined ? "inherit" : [stdin, "inherit", "inherit"], encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} ${args[0] ?? ""} exited with ${result.status ?? result.signal ?? result.error?.message}`);
  return capture ? result.stdout : "";
}

function findFile(dir, file, arch = "x64") {
  const hits = [];
  const walk = (at) => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      if (lstatSync(path).isDirectory()) walk(path);
      else if (name.toLowerCase() === file.toLowerCase()) hits.push(path);
    }
  };
  walk(dir);
  const match = hits.sort().reverse().find((path) => path.split(sep).includes(arch)) ?? hits[0];
  if (!match) throw new Error(`${file} was not found in its NuGet package`);
  return match;
}

/**
 * Signs for one target, or does nothing when signing isn't fully configured. Tools are fetched, and the macOS keychain
 * made, on first use; dispose() removes them. run(command, args, options) is injectable so tests run nothing.
 */
export function createSigner({ target, env = process.env, run = defaultRun, log = console.log, temp, packages = WINDOWS_TOOL_PACKAGES } = {}) {
  const status = signingStatus(target, env);
  const enabled = status.state === "ready";
  const extra = [];
  const exec = (command, args, options = {}) => run(command, args, { env, extra, ...options });
  let work;
  let tools;
  const scratch = () => (work ??= temp ?? mkdtempSync(join(tmpdir(), "branch-signing-")));

  const windowsTools = () => {
    if (tools) return tools;
    const dir = scratch();
    const system = join(env.SYSTEMROOT ?? "C:\\Windows", "System32");
    const found = {};
    for (const pkg of packages) {
      const archive = join(dir, `${pkg.id}.${pkg.version}.zip`);
      const out = join(dir, pkg.id);
      mkdirSync(out, { recursive: true });
      exec(join(system, "curl.exe"), ["-fsSL", "--retry", "3", "-o", archive, nugetUrl(pkg)]);
      verifyToolPackage(archive, pkg);
      exec(join(system, "tar.exe"), ["-xf", archive, "-C", out]);
      found[pkg.file] = findFile(out, pkg.file);
    }
    const metadata = join(dir, "metadata.json");
    writeFileSync(metadata, JSON.stringify(azureMetadata(env), null, 2));
    return (tools = { signtool: found["signtool.exe"], dlib: found["Azure.CodeSigning.Dlib.dll"], metadata });
  };

  const macTools = () => {
    if (tools) return tools;
    const dir = scratch();
    const keychain = join(dir, "branch-developer-id.keychain-db");
    const keychainPassword = randomBytes(24).toString("hex");
    extra.push(keychainPassword);
    const p12 = join(dir, "developer-id.p12");
    writeFileSync(p12, Buffer.from(env.APPLE_DEVELOPER_ID_P12, "base64"), { mode: 0o600 });
    const keyFile = join(dir, `AuthKey_${env.APPLE_NOTARY_KEY_ID}.p8`);
    writeFileSync(keyFile, notaryKeyText(env.APPLE_NOTARY_KEY), { mode: 0o600 });
    const entitlements = join(dir, "entitlements.plist");
    writeFileSync(entitlements, MAC_ENTITLEMENTS);
    const existing = parseKeychainList(exec("security", ["list-keychains", "-d", "user"], { capture: true }));
    tools = { keychain, keyFile, entitlements, existing };
    try {
      for (const [command, args, input] of keychainCommands({ keychain, keychainPassword, p12, p12Password: env.APPLE_DEVELOPER_ID_PASSWORD, existing })) {
        exec(command, args, input === undefined ? {} : { input });
      }
    } finally {
      rmSync(p12, { force: true });
    }
    tools.identity = parseDeveloperIdentity(exec("security", ["find-identity", "-v", "-p", "codesigning", keychain], { capture: true }));
    return tools;
  };

  const windowsSign = (file) => {
    const { signtool, dlib, metadata } = windowsTools();
    exec(signtool, signtoolArgs({ dlib, metadata, file }));
    exec(signtool, signtoolVerifyArgs(file));
  };

  return {
    status,
    enabled,
    /** Before packaging: Branch Agent.exe on Windows, the whole Branch Agent.app (inside out) on macOS. */
    signApp(path) {
      if (!enabled) return false;
      if (target === "win32-x64") windowsSign(path);
      else {
        const { keychain, identity, entitlements } = macTools();
        for (const entry of macSigningOrder(path, findNestedCode(path))) {
          exec("codesign", codesignArgs({ identity, keychain, file: entry.path, entitlements: entry.entitlements ? entitlements : undefined }));
        }
        exec("codesign", codesignVerifyArgs(path));
      }
      log(`signed: ${path}`);
      return true;
    },
    /** After packaging: the setup .exe on Windows. On macOS the .dmg is signed, notarized (waiting) and stapled. */
    signInstaller(path) {
      if (!enabled) return false;
      if (target === "win32-x64") windowsSign(path);
      else {
        const { keychain, identity, keyFile } = macTools();
        exec("codesign", codesignArgs({ identity, keychain, file: path, runtime: false }));
        exec("xcrun", notarySubmitArgs({ file: path, keyFile, keyId: env.APPLE_NOTARY_KEY_ID, issuer: env.APPLE_NOTARY_ISSUER_ID }));
        exec("xcrun", stapleArgs(path));
      }
      log(target === "win32-x64" ? `signed: ${path}` : `signed, notarized and stapled: ${path}`);
      return true;
    },
    dispose() {
      if (tools?.keychain) {
        try { exec("security", ["list-keychains", "-d", "user", "-s", ...tools.existing]); } catch { /* best effort */ }
        try { exec("security", ["delete-keychain", tools.keychain]); } catch { /* best effort */ }
      }
      if (work && !temp) rmSync(work, { recursive: true, force: true });
      tools = undefined;
    },
  };
}

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command !== "status") throw new Error("Usage: release-signing.mjs status [--target <target>] [--strict]");
  const at = rest.indexOf("--target");
  const target = at === -1 ? undefined : rest[at + 1];
  if (at !== -1 && !TARGETS.includes(target)) throw new Error(`Unknown target ${target}`);
  return { command, targets: target ? [target] : TARGETS, strict: rest.includes("--strict") };
}

/** Prints one line per target and returns the exit code: 0, or 1 under --strict when a target that signs isn't ready. */
export function main(argv = process.argv.slice(2), env = process.env, log = console.log) {
  const { targets, strict } = parseArgs(argv);
  let code = 0;
  for (const target of targets) {
    const status = signingStatus(target, env);
    log(statusLine(status));
    if (strict && (status.state === "none" || status.state === "partial")) code = 1;
  }
  return code;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); }
}
