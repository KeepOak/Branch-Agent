import { spawnSync, type SpawnSyncReturns } from "node:child_process";
// elizaOS/eliza@3f38e54495ba5518f84bcf9cc1e84e0dc3d60bbf:packages/auth/src/vault/keychain-process.ts (atlas SAFETY-0077)
/**
 * Isolates OS keychain operations behind a bounded child-process boundary.
 * Key material travels only through a private pipe; failures never include child
 * output. A blocked OS prompt cannot indefinitely stall a synchronous caller.
 *
 * Upstream drives @napi-rs/keyring in a child; Branch drives each platform's own
 * keychain tool instead (no native dependency): Windows DPAPI (current user) through
 * PowerShell, the macOS login Keychain through security(1), and the Linux Secret
 * Service through secret-tool(1).
 */
import { randomBytes } from "node:crypto";

const TIMEOUT_MS = 5_000;
const KEY_BYTES = 32;
const MAC_ITEM_NOT_FOUND = 44;

export type KeychainCommandRunner = (
  command: string,
  args: readonly string[],
  options: { input?: string; env?: NodeJS.ProcessEnv; timeoutMs: number },
) => Pick<SpawnSyncReturns<string>, "status" | "stdout" | "error">;

export interface KeychainProcessOptions {
  platform?: NodeJS.Platform;
  timeoutMs?: number;
  /** Where the DPAPI-protected key lives on Windows. */
  windowsKeyFile?: string;
  run?: KeychainCommandRunner;
}

export const runKeychainCommand: KeychainCommandRunner = (command, args, options) =>
  spawnSync(command, args, {
    encoding: "utf8",
    input: options.input,
    env: options.env,
    timeout: options.timeoutMs,
    killSignal: "SIGKILL",
    maxBuffer: 4096,
    windowsHide: true,
    // Native diagnostics are not part of the key protocol. Discard them so
    // stderr cannot expose keychain error data.
    stdio: ["pipe", "pipe", "ignore"],
  });

export function keychainUnavailable(): Error {
  return new Error(
    "OS keychain did not complete a verified key read within its deadline. Unlock the keychain and allow Branch Agent access, then retry. No replacement key was returned.",
  );
}

/** Accepts only a canonical base64 encoding of exactly 32 bytes. */
export function decodeKeychainKey(encoded: string): Buffer {
  const trimmed = encoded.trim();
  const key = Buffer.from(trimmed, "base64");
  if (key.length !== KEY_BYTES || key.toString("base64") !== trimmed) {
    throw keychainUnavailable();
  }
  return key;
}

function succeeded(result: ReturnType<KeychainCommandRunner>): boolean {
  return !result.error && result.status === 0;
}

// The DPAPI script owns the complete read/create/verify operation. A failed read
// must never be interpreted as an absent key and overwrite it.
const WINDOWS_DPAPI_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -AssemblyName System.Security",
  "$file = $env:BRANCH_KEYCHAIN_FILE",
  "$scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser",
  "$entropy = [System.Text.Encoding]::UTF8.GetBytes($env:BRANCH_KEYCHAIN_ENTROPY)",
  "if (-not (Test-Path -LiteralPath $file)) {",
  "  $key = New-Object byte[] 32",
  "  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($key)",
  "  $blob = [System.Security.Cryptography.ProtectedData]::Protect($key, $entropy, $scope)",
  "  $tmp = $file + '.tmp'",
  "  [System.IO.File]::WriteAllBytes($tmp, $blob)",
  "  Move-Item -LiteralPath $tmp -Destination $file",
  "}",
  "$blob = [System.IO.File]::ReadAllBytes($file)",
  "$key = [System.Security.Cryptography.ProtectedData]::Unprotect($blob, $entropy, $scope)",
  "[Console]::Out.Write([Convert]::ToBase64String($key))",
].join("\n");

function readWindowsKey(
  service: string,
  account: string,
  options: Required<Omit<KeychainProcessOptions, "platform">>,
): Buffer {
  const result = options.run(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      Buffer.from(WINDOWS_DPAPI_SCRIPT, "utf16le").toString("base64"),
    ],
    {
      timeoutMs: options.timeoutMs,
      env: {
        ...process.env,
        BRANCH_KEYCHAIN_FILE: options.windowsKeyFile,
        BRANCH_KEYCHAIN_ENTROPY: `${service}/${account}`,
      },
    },
  );
  if (!succeeded(result)) {
    throw keychainUnavailable();
  }
  return decodeKeychainKey(result.stdout);
}

function readMacKey(
  service: string,
  account: string,
  run: KeychainCommandRunner,
  timeoutMs: number,
) {
  const find = () =>
    run("security", ["find-generic-password", "-s", service, "-a", account, "-w"], { timeoutMs });
  const existing = find();
  if (succeeded(existing)) {
    return decodeKeychainKey(existing.stdout);
  }
  if (existing.error || existing.status !== MAC_ITEM_NOT_FOUND) {
    throw keychainUnavailable();
  }
  const encoded = randomBytes(KEY_BYTES).toString("base64");
  const added = run(
    "security",
    ["add-generic-password", "-s", service, "-a", account, "-w", encoded],
    { timeoutMs },
  );
  const verify = succeeded(added) ? find() : added;
  if (!succeeded(verify) || verify.stdout.trim() !== encoded) {
    throw keychainUnavailable();
  }
  return decodeKeychainKey(encoded);
}

function readLinuxKey(
  service: string,
  account: string,
  run: KeychainCommandRunner,
  timeoutMs: number,
) {
  const attributes = ["service", service, "account", account];
  const lookup = () => run("secret-tool", ["lookup", ...attributes], { timeoutMs });
  const existing = lookup();
  if (succeeded(existing) && existing.stdout.trim()) {
    return decodeKeychainKey(existing.stdout);
  }
  // secret-tool exits 1 with no output when the item is absent.
  if (existing.error || existing.status !== 1 || existing.stdout.trim()) {
    throw keychainUnavailable();
  }
  const encoded = randomBytes(KEY_BYTES).toString("base64");
  const stored = run("secret-tool", ["store", `--label=${service} ${account}`, ...attributes], {
    input: encoded,
    timeoutMs,
  });
  const verify = succeeded(stored) ? lookup() : stored;
  if (!succeeded(verify) || verify.stdout.trim() !== encoded) {
    throw keychainUnavailable();
  }
  return decodeKeychainKey(encoded);
}

/** Reads the 32-byte key for service/account, creating and verifying it on first use. */
export function readKeychainKeySync(
  service: string,
  account: string,
  options: KeychainProcessOptions = {},
): Buffer {
  const platform = options.platform ?? process.platform;
  const run = options.run ?? runKeychainCommand;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  if (platform === "win32") {
    if (!options.windowsKeyFile) {
      throw keychainUnavailable();
    }
    return readWindowsKey(service, account, {
      run,
      timeoutMs,
      windowsKeyFile: options.windowsKeyFile,
    });
  }
  if (platform === "darwin") {
    return readMacKey(service, account, run, timeoutMs);
  }
  return readLinuxKey(service, account, run, timeoutMs);
}
