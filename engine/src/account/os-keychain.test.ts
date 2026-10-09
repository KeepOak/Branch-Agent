// The OS keychain wrapper: each platform's store gets the secret on stdin only, never in a command line.
import { describe, expect, it } from "vitest";
import {
  createOsKeychain,
  type KeychainCommand,
  type KeychainCommandResult,
} from "./os-keychain.js";

const SECRET = "fake-refresh-token/with+odd=chars";

/** A stand-in for the platform tool: it records each command and answers from an in-memory store. */
function fakeStore(platform: "win32" | "darwin" | "linux") {
  const saved = new Map<string, string>();
  const commands: KeychainCommand[] = [];
  const run = async (command: KeychainCommand): Promise<KeychainCommandResult> => {
    commands.push(command);
    if (platform === "win32") {
      const request = JSON.parse(
        Buffer.from(command.input ?? "", "base64").toString("utf8"),
      ) as Record<string, string>;
      const target = request.target ?? "";
      if (request.op === "set") {
        saved.set(target, request.secret ?? "");
        return { code: 0, stdout: "" };
      }
      if (request.op === "get") {
        const value = saved.get(target);
        return value === undefined
          ? { code: 3, stdout: "" }
          : { code: 0, stdout: Buffer.from(value).toString("base64") };
      }
      saved.delete(target);
      return { code: 0, stdout: "" };
    }
    if (platform === "darwin") {
      const [, verb, ...rest] = command.argv;
      if (verb === "-i") {
        const match = /-s "([^"]+)" -a "([^"]+)" -X ([0-9a-f]+)\n$/u.exec(command.input ?? "");
        saved.set(
          `${match?.[1]}|${match?.[2]}`,
          Buffer.from(match?.[3] ?? "", "hex").toString("utf8"),
        );
        return { code: 0, stdout: "" };
      }
      const key = `${rest[rest.indexOf("-s") + 1]}|${rest[rest.indexOf("-a") + 1]}`;
      const value = saved.get(key);
      if (verb === "find-generic-password") {
        return value === undefined ? { code: 44, stdout: "" } : { code: 0, stdout: `${value}\n` };
      }
      return saved.delete(key) ? { code: 0, stdout: "" } : { code: 44, stdout: "" };
    }
    const [, verb, ...rest] = command.argv;
    const key = rest.slice(rest.indexOf("service")).join("|");
    if (verb === "store") {
      saved.set(key, command.input ?? "");
      return { code: 0, stdout: "" };
    }
    if (verb === "lookup") {
      const value = saved.get(key);
      return value === undefined ? { code: 1, stdout: "" } : { code: 0, stdout: value };
    }
    return saved.delete(key) ? { code: 0, stdout: "" } : { code: 1, stdout: "" };
  };
  return { saved, commands, run };
}

describe("OS keychain", () => {
  for (const [platform, label, tool] of [
    ["win32", "Windows Credential Manager", "powershell"],
    ["darwin", "the macOS Keychain", "security"],
    ["linux", "the Secret Service", "secret-tool"],
  ] as const) {
    it(`${platform}: saves, reads and removes a secret in ${label} without putting it on a command line`, async () => {
      const store = fakeStore(platform);
      const keychain = createOsKeychain({ service: "Branch account", platform, run: store.run });
      expect(keychain.label).toBe(label);
      expect(await keychain.get("google-refresh-token-0123")).toBeUndefined();
      await keychain.set("google-refresh-token-0123", SECRET);
      expect(await keychain.get("google-refresh-token-0123")).toBe(SECRET);
      await keychain.delete("google-refresh-token-0123");
      expect(await keychain.get("google-refresh-token-0123")).toBeUndefined();
      // Removing what isn't there is not an error.
      await keychain.delete("google-refresh-token-0123");
      expect(store.saved.size).toBe(0);
      for (const command of store.commands) {
        expect(command.argv[0]).toBe(tool);
        expect(command.argv.join(" ")).not.toContain(SECRET);
        expect(command.argv.join(" ")).not.toContain(Buffer.from(SECRET).toString("hex"));
      }
      // The secret reached the store, on stdin.
      expect(store.commands.some((command) => command.input !== undefined)).toBe(true);
    });
  }

  it("keeps Windows' script and request off the command line except as an encoded script", async () => {
    const store = fakeStore("win32");
    const keychain = createOsKeychain({
      service: "Branch account",
      platform: "win32",
      run: store.run,
    });
    await keychain.set("google-refresh-token-0123", SECRET);
    const [command] = store.commands;
    expect(command?.argv.slice(0, -1)).toEqual([
      "powershell",
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
    ]);
    const script = Buffer.from(command?.argv.at(-1) ?? "", "base64").toString("utf16le");
    expect(script).toContain("CredWriteW");
    expect(script).not.toContain(SECRET);
    expect(command?.input).not.toContain(SECRET);
  });

  it("reports a failing store by exit code only", async () => {
    const keychain = createOsKeychain({
      service: "Branch account",
      platform: "linux",
      run: async () => ({ code: 5, stdout: "" }),
    });
    await expect(keychain.set("google-refresh-token-0123", SECRET)).rejects.toThrow(
      "Couldn't save the sign-in in the Secret Service (exit 5).",
    );
  });

  it("refuses unsafe names and systems without a keychain", () => {
    expect(() => createOsKeychain({ service: 'Branch"; rm', platform: "linux" })).toThrow(
      "Invalid keychain service name.",
    );
    const keychain = createOsKeychain({
      service: "Branch account",
      platform: "linux",
      run: async () => ({ code: 0, stdout: "" }),
    });
    expect(() => keychain.get("a\nb")).toThrow("Invalid keychain account name.");
    expect(() => createOsKeychain({ service: "Branch account", platform: "aix" })).toThrow(
      "it has no supported keychain",
    );
  });
});
