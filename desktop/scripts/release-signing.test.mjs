import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  AZURE_TIMESTAMP_URL, codesignArgs, createSigner, keychainCommands, securityLine, MAC_SECRETS, macSigningOrder, main, notaryKeyText,
  notarySubmitArgs, nugetUrl, parseDeveloperIdentity, printableCommand, redact, signingStatus, signtoolArgs, stapleArgs,
  statusLine, WINDOWS_SECRETS, WINDOWS_TOOL_PACKAGES, WINDOWS_VARIABLES,
} from "./release-signing.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");

const WINDOWS_ENV = {
  AZURE_TENANT_ID: "tenant-0000-secret",
  AZURE_CLIENT_ID: "client-1111-secret",
  AZURE_CLIENT_SECRET: "client-secret-value-2222",
  AZURE_SIGNING_ENDPOINT: "https://eus.codesigning.azure.net",
  AZURE_SIGNING_ACCOUNT: "keepoak-signing",
  AZURE_SIGNING_PROFILE: "branch-agent-public",
};
const MAC_ENV = {
  APPLE_DEVELOPER_ID_P12: Buffer.from("p12-bytes-secret").toString("base64"),
  APPLE_DEVELOPER_ID_PASSWORD: "p12-password-secret",
  APPLE_NOTARY_KEY_ID: "KEYID12345",
  APPLE_NOTARY_ISSUER_ID: "issuer-3333-secret",
  APPLE_NOTARY_KEY: "-----BEGIN PRIVATE KEY-----\nnotary-key-secret\n-----END PRIVATE KEY-----\n",
};
const IDENTITY = "0123456789ABCDEF0123456789ABCDEF01234567";

function capture(fn) {
  const lines = [];
  const code = fn((line) => lines.push(line));
  return { code, lines };
}

test("nothing configured: one plain line per target, exit 0, nothing runs", () => {
  const { code, lines } = capture((log) => main(["status"], {}, log));
  assert.equal(code, 0);
  assert.deepEqual(lines, [
    "Windows signing: not configured (set AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET and the three AZURE_SIGNING_* variables). Shipping unsigned.",
    "macOS signing: not configured (set APPLE_DEVELOPER_ID_P12, APPLE_DEVELOPER_ID_PASSWORD, APPLE_NOTARY_KEY_ID, APPLE_NOTARY_ISSUER_ID and APPLE_NOTARY_KEY). Shipping the self-signed app, not notarized.",
    "Linux signing: nothing to sign (no Linux installer yet).",
  ]);
  assert.deepEqual(capture((log) => main(["status", "--target", "win32-x64"], { AZURE_TENANT_ID: "  " }, log)), { code: 0, lines: [lines[0]] }, "blank counts as unset");
  for (const target of ["win32-x64", "darwin-arm64", "linux-x64"]) {
    const calls = [];
    const signer = createSigner({ target, env: {}, run: (...args) => calls.push(args), log: () => {} });
    assert.equal(signer.enabled, false);
    assert.equal(signer.signApp("app"), false);
    assert.equal(signer.signInstaller("installer"), false);
    signer.dispose();
    assert.deepEqual(calls, [], target + " runs nothing");
  }
});

test("partly configured: names exactly what is missing, signs nothing, fails only under --strict", () => {
  const env = { AZURE_TENANT_ID: "t", AZURE_CLIENT_ID: "c", AZURE_SIGNING_ENDPOINT: "https://eus.codesigning.azure.net" };
  const status = signingStatus("win32-x64", env);
  assert.equal(status.state, "partial");
  assert.deepEqual(status.missing, ["AZURE_CLIENT_SECRET", "AZURE_SIGNING_ACCOUNT", "AZURE_SIGNING_PROFILE"]);
  assert.equal(statusLine(status), "Windows signing: partly configured, missing AZURE_CLIENT_SECRET, AZURE_SIGNING_ACCOUNT and AZURE_SIGNING_PROFILE. Nothing is signed until all are set. Shipping unsigned.");
  assert.deepEqual(capture((log) => main(["status", "--target", "win32-x64"], env, log)), { code: 0, lines: [statusLine(status)] });
  assert.equal(capture((log) => main(["status", "--target", "win32-x64", "--strict"], env, log)).code, 1);
  assert.equal(capture((log) => main(["status", "--target", "win32-x64", "--strict"], {}, log)).code, 1);
  assert.equal(capture((log) => main(["status", "--target", "linux-x64", "--strict"], {}, log)).code, 0);
  const mac = { ...MAC_ENV };
  delete mac.APPLE_NOTARY_KEY;
  assert.equal(statusLine(signingStatus("darwin-arm64", mac)), "macOS signing: partly configured, missing APPLE_NOTARY_KEY. Nothing is signed until all are set. Shipping the self-signed app, not notarized.");
  const calls = [];
  const signer = createSigner({ target: "darwin-arm64", env: mac, run: (...args) => calls.push(args), log: () => {} });
  assert.equal(signer.signApp("Branch Agent.app"), false, "never half-signed");
  assert.equal(signer.signInstaller("x.dmg"), false);
  assert.deepEqual(calls, []);
  assert.throws(() => main(["status", "--target", "win32-arm64"], {}, () => {}), /Unknown target/);
  assert.throws(() => main(["sign"], {}, () => {}), /Usage/);
});

test("fully configured: the status line says what will be signed", () => {
  assert.equal(statusLine(signingStatus("win32-x64", WINDOWS_ENV)), "Windows signing: configured. Signing Branch Agent.exe and the setup .exe with Azure Artifact Signing.");
  assert.equal(statusLine(signingStatus("darwin-arm64", MAC_ENV)), "macOS signing: configured. Signing with the Developer ID certificate, then notarizing and stapling the disk image.");
  assert.deepEqual(signingStatus("win32-x64", WINDOWS_ENV).required, [...WINDOWS_SECRETS, ...WINDOWS_VARIABLES]);
  assert.deepEqual(signingStatus("darwin-arm64", MAC_ENV).required, MAC_SECRETS);
});

test("Windows: SignTool with the Artifact Signing dlib, the app before packaging and the setup after", () => {
  const temp = mkdtempSync(join(tmpdir(), "branch-signing-test-"));
  try {
    const calls = [];
    const packages = fakePackages();
    const run = (command, args) => {
      calls.push([command, args]);
      if (command.endsWith("curl.exe")) writeFileSync(args[args.indexOf("-o") + 1], "fake " + args.at(-1));
      if (command.endsWith("tar.exe")) {
        const out = args[args.indexOf("-C") + 1];
        const pkg = packages.find((p) => out.endsWith(p.id));
        for (const arch of ["x86", "x64", "arm64"]) {
          mkdirSync(join(out, "bin", arch), { recursive: true });
          writeFileSync(join(out, "bin", arch, pkg.file), "");
        }
      }
      return "";
    };
    const logs = [];
    const signer = createSigner({ target: "win32-x64", env: { ...WINDOWS_ENV, SYSTEMROOT: "C:\\Windows" }, run, log: (line) => logs.push(line), temp, packages });
    assert.equal(signer.signApp("payload\\Branch Agent.exe"), true);
    assert.equal(signer.signInstaller("out\\Branch-Agent-Setup-0.4.4-win32-x64.exe"), true);
    signer.dispose();
    const signtool = join(temp, "Microsoft.Windows.SDK.BuildTools", "bin", "x64", "signtool.exe");
    const dlib = join(temp, "Microsoft.ArtifactSigning.Client", "bin", "x64", "Azure.CodeSigning.Dlib.dll");
    const metadata = join(temp, "metadata.json");
    const system = join("C:\\Windows", "System32");
    assert.deepEqual(calls.map(([command]) => command), [
      join(system, "curl.exe"), join(system, "tar.exe"), join(system, "curl.exe"), join(system, "tar.exe"),
      signtool, signtool, signtool, signtool,
    ], "tools are fetched once");
    assert.ok(calls[0][1].includes(nugetUrl(WINDOWS_TOOL_PACKAGES[0])));
    assert.equal(nugetUrl(WINDOWS_TOOL_PACKAGES[1]), "https://api.nuget.org/v3-flatcontainer/microsoft.artifactsigning.client/1.0.146/microsoft.artifactsigning.client.1.0.146.nupkg");
    assert.deepEqual(calls[4][1], ["sign", "/v", "/fd", "SHA256", "/tr", "http://timestamp.acs.microsoft.com", "/td", "SHA256", "/dlib", dlib, "/dmdf", metadata, "payload\\Branch Agent.exe"]);
    assert.deepEqual(calls[5][1], ["verify", "/pa", "/v", "payload\\Branch Agent.exe"]);
    assert.deepEqual(calls[6][1], signtoolArgs({ dlib, metadata, file: "out\\Branch-Agent-Setup-0.4.4-win32-x64.exe" }));
    assert.equal(AZURE_TIMESTAMP_URL, "http://timestamp.acs.microsoft.com");
    const written = JSON.parse(readFileSync(metadata, "utf8"));
    assert.equal(written.Endpoint, "https://eus.codesigning.azure.net");
    assert.equal(written.CodeSigningAccountName, "keepoak-signing");
    assert.equal(written.CertificateProfileName, "branch-agent-public");
    assert.ok(!written.ExcludeCredentials.includes("EnvironmentCredential"), "the AZURE_* secrets authenticate");
    const everything = JSON.stringify(calls) + readFileSync(metadata, "utf8") + logs.join("\n");
    for (const name of WINDOWS_SECRETS) assert.ok(!everything.includes(WINDOWS_ENV[name]), name + " never appears in argv, metadata or logs");
    assert.deepEqual(logs, ["signed: payload\\Branch Agent.exe", "signed: out\\Branch-Agent-Setup-0.4.4-win32-x64.exe"]);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("macOS: pure argv for keychain, hardened-runtime codesign, notarytool --wait and staple", () => {
  assert.deepEqual(codesignArgs({ identity: IDENTITY, keychain: "/k.keychain-db", file: "/a/Branch Agent.app", entitlements: "/e.plist" }),
    ["--force", "--timestamp", "--options", "runtime", "--entitlements", "/e.plist", "--keychain", "/k.keychain-db", "--sign", IDENTITY, "/a/Branch Agent.app"]);
  assert.deepEqual(codesignArgs({ identity: IDENTITY, keychain: "/k", file: "/o.dmg", runtime: false }), ["--force", "--timestamp", "--keychain", "/k", "--sign", IDENTITY, "/o.dmg"]);
  assert.deepEqual(notarySubmitArgs({ file: "/o.dmg", keyFile: "/AuthKey_K.p8", keyId: "K", issuer: "I" }),
    ["notarytool", "submit", "/o.dmg", "--key", "/AuthKey_K.p8", "--key-id", "K", "--issuer", "I", "--wait"]);
  assert.deepEqual(stapleArgs("/o.dmg"), ["stapler", "staple", "/o.dmg"]);
  const commands = keychainCommands({ keychain: "/k", keychainPassword: "kc-pass-9999", p12: "/c.p12", p12Password: MAC_ENV.APPLE_DEVELOPER_ID_PASSWORD, existing: ["/login"] });
  assert.deepEqual(commands.map(([, args, input]) => operation(args, input)), ["create-keychain", "set-keychain-settings", "unlock-keychain", "import", "set-key-partition-list", "list-keychains"]);
  assert.deepEqual(commands.at(-1)[1], ["list-keychains", "-d", "user", "-s", "/k", "/login"]);
  for (const [, args] of commands) {
    assert.ok(!args.includes("kc-pass-9999"), "the keychain password is never in argv: " + args.join(" "));
    assert.ok(!args.includes(MAC_ENV.APPLE_DEVELOPER_ID_PASSWORD), "the .p12 password is never in argv: " + args.join(" "));
  }
  assert.deepEqual(words(commands[3][2]), ["import", "/c.p12", "-k", "/k", "-P", MAC_ENV.APPLE_DEVELOPER_ID_PASSWORD, "-f", "pkcs12", "-T", "/usr/bin/codesign"]);
  assert.deepEqual(words(securityLine(['a "quoted" pass\\word', "/My Keychain"])), ['a "quoted" pass\\word', "/My Keychain"]);
  assert.throws(() => securityLine(["two\nlines"]), /line break/);
  assert.equal(parseDeveloperIdentity("  1) " + IDENTITY + ' "Developer ID Application: KeepOak (TEAM123456)"\n     1 valid identities found'), IDENTITY);
  assert.throws(() => parseDeveloperIdentity("  0 valid identities found"), /Developer ID Application/);
  assert.equal(notaryKeyText(MAC_ENV.APPLE_NOTARY_KEY), MAC_ENV.APPLE_NOTARY_KEY);
  assert.equal(notaryKeyText(Buffer.from(MAC_ENV.APPLE_NOTARY_KEY).toString("base64")), MAC_ENV.APPLE_NOTARY_KEY);
  const order = macSigningOrder("/A.app", [
    { path: "/A.app/Contents/Frameworks/E.framework", kind: "bundle" },
    { path: "/A.app/Contents/Frameworks/E.framework/Versions/A/Libraries/libffmpeg.dylib", kind: "file" },
    { path: "/A.app/Contents/Frameworks/E.framework/Versions/A/E", kind: "file" },
    { path: "/A.app/Contents/Frameworks/A Helper.app", kind: "bundle" },
    { path: "/A.app/Contents/Frameworks/A Helper.app/Contents/MacOS/A Helper", kind: "file" },
    { path: "/A.app/Contents/Resources/node/node", kind: "file" },
    { path: "/A.app/Contents/MacOS/A", kind: "file" },
  ]);
  assert.deepEqual(order.map((entry) => [entry.path, entry.entitlements]), [
    ["/A.app/Contents/Frameworks/E.framework/Versions/A/Libraries/libffmpeg.dylib", false],
    ["/A.app/Contents/Frameworks/A Helper.app/Contents/MacOS/A Helper", true],
    ["/A.app/Contents/Frameworks/E.framework/Versions/A/E", true],
    ["/A.app/Contents/Resources/node/node", true],
    ["/A.app/Contents/Frameworks/A Helper.app", true],
    ["/A.app/Contents/Frameworks/E.framework", false],
    ["/A.app/Contents/MacOS/A", true],
    ["/A.app", true],
  ]);
});

test("macOS: a configured signer signs inside out, notarizes, staples and cleans up without printing secrets", () => {
  const temp = mkdtempSync(join(tmpdir(), "branch-signing-test-"));
  try {
    const app = join(temp, "payload", "Branch Agent.app");
    const macho = Buffer.from("cffaedfe00000000", "hex");
    mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
    writeFileSync(join(app, "Contents", "MacOS", "Branch Agent"), macho);
    mkdirSync(join(app, "Contents", "Resources"), { recursive: true });
    writeFileSync(join(app, "Contents", "Resources", "app.asar"), "not code");
    const work = join(temp, "work");
    mkdirSync(work);
    const calls = [];
    const seen = {};
    const run = (command, args, options) => {
      calls.push([command, args, options?.input]);
      if (operation(args, options?.input) === "import") seen.p12 = readFileSync(words(options.input)[1], "utf8");
      if (args[0] === "notarytool") seen.keyMode = statSync(args[args.indexOf("--key") + 1]).mode & 0o777;
      if (args[0] === "list-keychains" && options?.capture) return '    "/Users/runner/Library/Keychains/login.keychain-db"\n';
      if (args[0] === "find-identity") return "  1) " + IDENTITY + ' "Developer ID Application: KeepOak (TEAM123456)"\n     1 valid identities found\n';
      return "";
    };
    const logs = [];
    const signer = createSigner({ target: "darwin-arm64", env: MAC_ENV, run, log: (line) => logs.push(line), temp: work });
    assert.equal(signer.signApp(app), true);
    const dmg = join(temp, "Branch-Agent-0.4.4-darwin-arm64.dmg");
    assert.equal(signer.signInstaller(dmg), true);
    signer.dispose();
    assert.equal(seen.p12, "p12-bytes-secret", "the base64 certificate is decoded to a file");
    assert.equal(existsSync(join(work, "developer-id.p12")), false, "the certificate file is removed once imported");
    if (process.platform !== "win32") assert.equal(seen.keyMode, 0o600);
    const keychain = join(work, "branch-developer-id.keychain-db");
    const entitlements = join(work, "entitlements.plist");
    const codesigns = calls.filter(([command]) => command === "codesign").map(([, args]) => args);
    assert.deepEqual(codesigns, [
      codesignArgs({ identity: IDENTITY, keychain, file: join(app, "Contents", "MacOS", "Branch Agent"), entitlements }),
      codesignArgs({ identity: IDENTITY, keychain, file: app, entitlements }),
      ["--verify", "--deep", "--strict", "--verbose=2", app],
      ["--force", "--timestamp", "--keychain", keychain, "--sign", IDENTITY, dmg],
    ]);
    assert.ok(codesigns[1].includes("runtime"), "hardened runtime");
    const xcrun = calls.filter(([command]) => command === "xcrun").map(([, args]) => args);
    assert.deepEqual(xcrun, [
      ["notarytool", "submit", dmg, "--key", join(work, "AuthKey_KEYID12345.p8"), "--key-id", "KEYID12345", "--issuer", MAC_ENV.APPLE_NOTARY_ISSUER_ID, "--wait"],
      ["stapler", "staple", dmg],
    ]);
    assert.deepEqual(calls.filter(([, args]) => args[0] === "delete-keychain").map(([, args]) => args), [["delete-keychain", keychain]]);
    assert.equal(calls.filter(([, args, input]) => operation(args, input) === "create-keychain").length, 1, "one keychain per run");
    const keychainPassword = words(calls.find(([, args, input]) => operation(args, input) === "create-keychain")[2])[2];
    for (const [, args] of calls) {
      assert.ok(!args.includes(keychainPassword) && !args.includes(MAC_ENV.APPLE_DEVELOPER_ID_PASSWORD), "no password in argv: " + args.join(" "));
    }
    const printed = calls.map(([command, args]) => redact(printableCommand(command, args), MAC_ENV, [keychainPassword])).join("\n");
    for (const name of MAC_SECRETS) assert.ok(!printed.includes(MAC_ENV[name]), name + " is redacted");
    assert.ok(!printed.includes(keychainPassword), "the throwaway keychain password is redacted");
    assert.deepEqual(logs, ["signed: " + app, "signed, notarized and stapled: " + dmg]);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("the release workflow runs the status every time and passes signing secrets only through env", () => {
  const workflow = readFileSync(join(repo, ".github/workflows/component-release.yml"), "utf8").replace(/\r\n/g, "\n");
  const native = workflow.slice(workflow.indexOf("\n  native:"), workflow.indexOf("\n  report:"));
  const step = (name) => {
    const at = native.indexOf("- name: " + name);
    assert.ok(at !== -1, name);
    return native.slice(at, native.indexOf("\n      - ", at + 1));
  };
  const status = step("Code signing status");
  assert.match(status, /run: node desktop\/scripts\/release-signing\.mjs status --target "\$BRANCH_RELEASE_TARGET"/);
  assert.match(status, /continue-on-error: true/);
  assert.doesNotMatch(status, /^\s+if:/m, "runs on every target, every time");
  assert.doesNotMatch(status, /--strict/, "never fails a release when signing is not configured");
  const installers = step("Build installers, signed only when configured");
  assert.match(installers, /continue-on-error: true/);
  const expr = (target, kind, name) => "          " + name + ": ${{ matrix.target == '" + target + "' && " + kind + "." + name + " || '' }}";
  for (const block of [status, installers]) {
    for (const name of WINDOWS_SECRETS) assert.ok(block.includes(expr("win32-x64", "secrets", name)), name);
    for (const name of WINDOWS_VARIABLES) assert.ok(block.includes(expr("win32-x64", "vars", name)), name);
    for (const name of MAC_SECRETS) assert.ok(block.includes(expr("darwin-arm64", "secrets", name)), name);
    assert.doesNotMatch(block.slice(block.indexOf("run:")), /secrets\.|vars\./, "secrets reach the scripts only through env");
  }
  assert.ok(native.indexOf("- name: Code signing status") < native.indexOf("- name: Build installers"));
  assert.match(native, /desktop\/scripts\/release-signing\.test\.mjs/);
  const checks = readFileSync(join(repo, ".github/workflows/desktop-checks.yml"), "utf8");
  assert.match(checks, /scripts\/release-signing\.test\.mjs/);
});

test("INSTALLERS.md tells the owner every name to add", () => {
  const doc = readFileSync(join(repo, "desktop/INSTALLERS.md"), "utf8");
  const owner = doc.slice(doc.indexOf("## Left for the owner"));
  for (const name of [...WINDOWS_SECRETS, ...WINDOWS_VARIABLES, ...MAC_SECRETS]) assert.ok(owner.includes("`" + name + "`"), name);
  assert.match(owner, /release-signing\.mjs/);
});

/** The pinned packages with digests of the bytes the fake curl writes, so the happy path can run offline. */
function fakePackages() {
  return WINDOWS_TOOL_PACKAGES.map((pkg) => {
    const bytes = Buffer.from("fake " + nugetUrl(pkg));
    return { ...pkg, sha256: createHash("sha256").update(bytes).digest("hex"), sha512: createHash("sha512").update(bytes).digest("base64") };
  });
}

test("Windows tool packages are pinned by digest, not only by version", () => {
  for (const pkg of WINDOWS_TOOL_PACKAGES) {
    assert.match(pkg.sha256, /^[0-9a-f]{64}$/, pkg.id);
    assert.equal(Buffer.from(pkg.sha512, "base64").length, 64, pkg.id);
  }
});

test("Windows: a tool package that doesn't match its pinned digest is refused before tar or SignTool run", () => {
  const temp = mkdtempSync(join(tmpdir(), "branch-signing-test-"));
  try {
    const calls = [];
    const run = (command, args) => {
      calls.push(command);
      if (command.endsWith("curl.exe")) writeFileSync(args[args.indexOf("-o") + 1], "a substituted package");
      return "";
    };
    const signer = createSigner({ target: "win32-x64", env: { ...WINDOWS_ENV, SYSTEMROOT: "C:\\Windows" }, run, log: () => {}, temp });
    assert.throws(() => signer.signApp("payload\\Branch Agent.exe"), /Refusing Microsoft\.Windows\.SDK\.BuildTools 10\.0\.26100\.6901: the download does not match its pinned digest.*Nothing was extracted or signed\./);
    signer.dispose();
    assert.deepEqual(calls.map((c) => c.split(/[\\/]/).at(-1)), ["curl.exe"], "nothing after the download ran");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

/** The security(1) operation a call runs, whether in argv or on security -i's stdin. */
function operation(args, input) {
  return args[0] === "-i" ? words(input)[0] : args[0];
}

/** Splits one security -i line back into words, undoing securityLine's quoting. */
function words(line) {
  return [...String(line).matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => match[1].replace(/\\(.)/g, "$1"));
}
