// The operating system's own password store for Branch account secrets: Windows Credential Manager, the macOS
// Keychain and the Linux Secret Service. A secret travels to and from the store on stdin and stdout only, never in
// a command line, a file or a log line.
import { runCommandWithTimeout } from "../process/exec-runner.js";

export type KeychainCommand = { argv: string[]; input?: string };
export type KeychainCommandResult = { code: number | null; stdout: string };
export type KeychainRunner = (command: KeychainCommand) => Promise<KeychainCommandResult>;

export type OsKeychain = {
  /** The store's name, as the owner knows it (for messages). */
  readonly label: string;
  set(account: string, secret: string): Promise<void>;
  get(account: string): Promise<string | undefined>;
  delete(account: string): Promise<void>;
};

const KEYCHAIN_TIMEOUT_MS = 30_000;
/** Service and account names are fixed identifiers, so nothing in them needs quoting. */
const NAME_PATTERN = /^[A-Za-z0-9 ._:-]{1,128}$/u;
/** The Windows script's exit code when no credential has that name. */
const WINDOWS_NOT_FOUND_EXIT = 3;
/** `security` exits with errSecItemNotFound (44) when no item matches. */
const MACOS_NOT_FOUND_EXIT = 44;

// Credential Manager through advapi32 (CredWriteW / CredReadW / CredDeleteW). The request (operation, target name,
// secret) arrives as base64 JSON on stdin; a read answers in base64 on stdout.
const WINDOWS_SCRIPT = `$ErrorActionPreference = 'Stop'
$request = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd())) | ConvertFrom-Json
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public static class BranchCredentialStore {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct Credential {
    public uint Flags; public uint Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist;
    public uint AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredWriteW(ref Credential credential, uint flags);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredReadW(string target, uint type, uint flags, out IntPtr credential);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredDeleteW(string target, uint type, uint flags);
  [DllImport("advapi32.dll")]
  private static extern void CredFree(IntPtr buffer);
  private const uint Generic = 1;
  private const uint PersistLocalMachine = 2;
  private const int NotFound = 1168;
  public static void Write(string target, string user, string secret) {
    byte[] bytes = Encoding.UTF8.GetBytes(secret);
    IntPtr blob = Marshal.AllocHGlobal(bytes.Length);
    try {
      Marshal.Copy(bytes, 0, blob, bytes.Length);
      Credential credential = new Credential();
      credential.Type = Generic;
      credential.TargetName = target;
      credential.UserName = user;
      credential.CredentialBlobSize = (uint)bytes.Length;
      credential.CredentialBlob = blob;
      credential.Persist = PersistLocalMachine;
      if (!CredWriteW(ref credential, 0)) { throw new Win32Exception(Marshal.GetLastWin32Error()); }
    } finally {
      Marshal.FreeHGlobal(blob);
    }
  }
  public static string Read(string target) {
    IntPtr pointer;
    if (!CredReadW(target, Generic, 0, out pointer)) {
      int error = Marshal.GetLastWin32Error();
      if (error == NotFound) { return null; }
      throw new Win32Exception(error);
    }
    try {
      Credential credential = (Credential)Marshal.PtrToStructure(pointer, typeof(Credential));
      byte[] bytes = new byte[credential.CredentialBlobSize];
      Marshal.Copy(credential.CredentialBlob, bytes, 0, bytes.Length);
      return Encoding.UTF8.GetString(bytes);
    } finally {
      CredFree(pointer);
    }
  }
  public static void Delete(string target) {
    if (CredDeleteW(target, Generic, 0)) { return; }
    int error = Marshal.GetLastWin32Error();
    if (error != NotFound) { throw new Win32Exception(error); }
  }
}
'@
switch ($request.op) {
  'set' { [BranchCredentialStore]::Write($request.target, $request.user, $request.secret) }
  'delete' { [BranchCredentialStore]::Delete($request.target) }
  'get' {
    $value = [BranchCredentialStore]::Read($request.target)
    if ($null -eq $value) { exit ${WINDOWS_NOT_FOUND_EXIT} }
    [Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($value)))
  }
}
`;

const defaultRunner: KeychainRunner = async ({ argv, input }) => {
  const result = await runCommandWithTimeout(argv, {
    timeoutMs: KEYCHAIN_TIMEOUT_MS,
    ...(input !== undefined ? { input } : {}),
  });
  return { code: result.code, stdout: result.stdout };
};

function assertName(kind: string, value: string): void {
  if (!NAME_PATTERN.test(value)) {
    throw new Error(`Invalid keychain ${kind} name.`);
  }
}

function failure(label: string, action: string, code: number | null): Error {
  // Only the exit code: a store's own error output is never repeated.
  return new Error(`Couldn't ${action} the sign-in in ${label} (exit ${code ?? "none"}).`);
}

function windowsKeychain(service: string, run: KeychainRunner): OsKeychain {
  const label = "Windows Credential Manager";
  // -EncodedCommand (UTF-16LE base64) keeps the script's quotes intact on the command line.
  const argv = [
    "powershell",
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
    Buffer.from(WINDOWS_SCRIPT, "utf16le").toString("base64"),
  ];
  const call = (request: Record<string, string>) =>
    run({ argv, input: Buffer.from(JSON.stringify(request), "utf8").toString("base64") });
  const target = (account: string) => `${service}:${account}`;
  return {
    label,
    async set(account, secret) {
      const result = await call({ op: "set", target: target(account), user: account, secret });
      if (result.code !== 0) {
        throw failure(label, "save", result.code);
      }
    },
    async get(account) {
      const result = await call({ op: "get", target: target(account) });
      if (result.code === WINDOWS_NOT_FOUND_EXIT) {
        return undefined;
      }
      if (result.code !== 0) {
        throw failure(label, "read", result.code);
      }
      return Buffer.from(result.stdout.trim(), "base64").toString("utf8");
    },
    async delete(account) {
      const result = await call({ op: "delete", target: target(account) });
      if (result.code !== 0) {
        throw failure(label, "remove", result.code);
      }
    },
  };
}

function macosKeychain(service: string, run: KeychainRunner): OsKeychain {
  const label = "the macOS Keychain";
  return {
    label,
    async set(account, secret) {
      // `security -i` reads its command from stdin, so the secret (as hex, -X) never reaches a command line.
      const hex = Buffer.from(secret, "utf8").toString("hex");
      const result = await run({
        argv: ["security", "-i"],
        input: `add-generic-password -U -s "${service}" -a "${account}" -X ${hex}\n`,
      });
      if (result.code !== 0) {
        throw failure(label, "save", result.code);
      }
    },
    async get(account) {
      const result = await run({
        argv: ["security", "find-generic-password", "-s", service, "-a", account, "-w"],
      });
      if (result.code === MACOS_NOT_FOUND_EXIT) {
        return undefined;
      }
      if (result.code !== 0) {
        throw failure(label, "read", result.code);
      }
      return result.stdout.replace(/\r?\n$/u, "");
    },
    async delete(account) {
      const result = await run({
        argv: ["security", "delete-generic-password", "-s", service, "-a", account],
      });
      if (result.code !== 0 && result.code !== MACOS_NOT_FOUND_EXIT) {
        throw failure(label, "remove", result.code);
      }
    },
  };
}

function linuxKeychain(service: string, run: KeychainRunner): OsKeychain {
  const label = "the Secret Service";
  const attributes = (account: string) => ["service", service, "account", account];
  return {
    label,
    async set(account, secret) {
      // secret-tool reads the secret from stdin when stdin is not a terminal.
      const result = await run({
        argv: ["secret-tool", "store", "--label", service, ...attributes(account)],
        input: secret,
      });
      if (result.code !== 0) {
        throw failure(label, "save", result.code);
      }
    },
    async get(account) {
      const result = await run({ argv: ["secret-tool", "lookup", ...attributes(account)] });
      // lookup exits 1 with no output when nothing matches.
      if (result.code === 1 && result.stdout === "") {
        return undefined;
      }
      if (result.code !== 0) {
        throw failure(label, "read", result.code);
      }
      return result.stdout.replace(/\r?\n$/u, "");
    },
    async delete(account) {
      const result = await run({ argv: ["secret-tool", "clear", ...attributes(account)] });
      // clear exits 1 when there was nothing to remove.
      if (result.code !== 0 && result.code !== 1) {
        throw failure(label, "remove", result.code);
      }
    },
  };
}

/** This operating system's password store, holding secrets under one service name. */
export function createOsKeychain(params: {
  service: string;
  platform?: NodeJS.Platform;
  run?: KeychainRunner;
}): OsKeychain {
  assertName("service", params.service);
  const run = params.run ?? defaultRunner;
  const platform = params.platform ?? process.platform;
  const store =
    platform === "win32"
      ? windowsKeychain(params.service, run)
      : platform === "darwin"
        ? macosKeychain(params.service, run)
        : platform === "linux"
          ? linuxKeychain(params.service, run)
          : undefined;
  if (!store) {
    throw new Error(
      `Branch can't keep a sign-in on this system (${platform}): it has no supported keychain.`,
    );
  }
  return {
    label: store.label,
    set: (account, secret) => {
      assertName("account", account);
      return store.set(account, secret);
    },
    get: (account) => {
      assertName("account", account);
      return store.get(account);
    },
    delete: (account) => {
      assertName("account", account);
      return store.delete(account);
    },
  };
}
