import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";
import { toErrorObject } from "../infra/errors.js";
import { PromptInputClosedError } from "./prompt.js";

/** Read setup code from various secure sources, avoiding argv exposure. */

type SetupCodeSource =
  | { kind: "stdin" }
  | { kind: "file"; path: string }
  | { kind: "env"; varName: string }
  | { kind: "argv" };

export type SetupCodeInput = {
  code: string;
  source: SetupCodeSource;
};

export type SetupCodeRuntimeLog = {
  log: (msg: string) => void;
};

/** Windows principals that are the ACL equivalent of POSIX group/other read. */
export const WINDOWS_BROAD_READ_PRINCIPALS = [
  "everyone:(",
  "builtin\\users:(",
  "nt authority\\authenticated users:(",
  "guest:(",
] as const;

/**
 * Read setup code from stdin when it's a TTY (interactive hidden prompt)
 * or from piped input.
 */
export async function readSetupCodeFromStdin(): Promise<string> {
  if (input.isTTY) {
    return await promptHiddenInput("Setup code: ");
  }
  return await readSetupCodeFromStream(input);
}

/** Read and trim a setup code from an already-open readable stream (piped stdin). */
export async function readSetupCodeFromStream(
  stream: AsyncIterable<string | Buffer>,
): Promise<string> {
  let data = "";
  for await (const chunk of stream) {
    data += typeof chunk === "string" ? chunk : chunk.toString("utf8");
  }
  return data.trim();
}

/**
 * Prompt for hidden input (password-style). The prompt is shown; the typed
 * code is not echoed.
 */
async function promptHiddenInput(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input,
    output,
    terminal: true,
  });

  return await new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (complete: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      rl.off("close", onClose);
      complete();
    };
    const onClose = () => finish(() => reject(new PromptInputClosedError()));

    rl.once("close", onClose);

    const mutableStdout = output as { muted?: boolean };
    const originalWrite = output.write.bind(output);
    const write = output.write as unknown as (
      chunk: unknown,
      ...args: unknown[]
    ) => boolean;
    output.write = ((chunk: unknown, ...args: unknown[]) => {
      if (mutableStdout.muted) {
        return true;
      }
      return originalWrite(chunk as string, ...(args as []));
    }) as typeof output.write;

    mutableStdout.muted = false;
    write(prompt);
    mutableStdout.muted = true;

    void rl.question("").then(
      (answer) => {
        mutableStdout.muted = false;
        output.write = originalWrite;
        write("\n");
        rl.close();
        finish(() => resolve(answer.trim()));
      },
      (error: unknown) => {
        mutableStdout.muted = false;
        output.write = originalWrite;
        rl.close();
        finish(() => reject(toErrorObject(error, "Non-Error rejection")));
      },
    );
  });
}

/**
 * Return Windows ACL principals that grant read-equivalent access beyond the
 * owner. Inherited SYSTEM/Administrators entries are expected on Windows and
 * are not treated as a leak.
 */
export function findWindowsBroadReadPrincipals(icaclsOutput: string): string[] {
  const lowered = icaclsOutput.toLowerCase();
  return WINDOWS_BROAD_READ_PRINCIPALS.filter((needle) => lowered.includes(needle)).map((needle) =>
    needle.slice(0, -2),
  );
}

function assertWindowsSetupCodeFileAcl(filePath: string, onWarn?: (msg: string) => void): void {
  const result = spawnSync("icacls", [filePath], {
    encoding: "utf8",
    timeout: 5_000,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) {
    onWarn?.(
      "WARNING: Could not verify the setup code file ACL with icacls. " +
        "Restrict the file to the owner (File Properties → Security → Advanced) " +
        "and disable inheritance from Users/Everyone. " +
        "Inherited SYSTEM/Administrators entries are expected on Windows.",
    );
    return;
  }
  const broad = findWindowsBroadReadPrincipals(`${result.stdout}\n${result.stderr}`);
  if (broad.length > 0) {
    // Warn rather than refuse: Windows files commonly inherit Users from the
    // parent directory, so a POSIX-style hard fail would reject ordinary
    // owner-created files. SYSTEM/Administrators are ignored above.
    onWarn?.(
      `WARNING: Setup code file ACL grants read access to ${broad.join(", ")}. ` +
        "Restrict the file to the owner (File Properties → Security → Advanced) " +
        "and remove Users/Everyone/Authenticated Users. " +
        "Inherited SYSTEM/Administrators entries are expected and are not this check.",
    );
  }
}

/**
 * Read setup code from a file, validating that the file has secure permissions
 * (0600 or stricter on POSIX). On Windows, warn when ACLs grant read access
 * to Everyone, Users, Authenticated Users, or Guest.
 */
export function readSetupCodeFromFile(
  filePath: string,
  onWarn?: (msg: string) => void,
): string {
  let stats: fs.Stats;
  try {
    stats = fs.statSync(filePath);
  } catch (error) {
    throw new Error(
      `Cannot read setup code file: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!stats.isFile()) {
    throw new Error(`Setup code path is not a regular file: ${filePath}`);
  }

  if (os.platform() !== "win32") {
    const mode = stats.mode & 0o777;
    if ((mode & 0o077) !== 0) {
      throw new Error(
        `Setup code file has unsafe permissions: ${mode.toString(8)}. ` +
          `Set to 0600 (owner read/write only): chmod 600 ${filePath}`,
      );
    }
  } else {
    assertWindowsSetupCodeFileAcl(filePath, onWarn);
  }

  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    throw new Error(
      `Cannot read setup code file: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return content.trim();
}

/**
 * Read setup code from an environment variable. Visible to same-user processes;
 * fallback for non-interactive automation only.
 */
export function readSetupCodeFromEnv(varName: string): string | undefined {
  return process.env[varName]?.trim() || undefined;
}

/**
 * Resolve setup code from various sources in priority order:
 * 1. Stdin (when argv is "-" , or when allowStdin is set and no other source)
 * 2. File (--pair-file / --code-file)
 * 3. Environment variable (BRANCH_PAIRING_CODE; fallback for non-interactive
 *    automation; visible to same-user processes)
 * 4. Command-line argument (deprecated, warns)
 *
 * The code is never logged or included in thrown messages.
 */
export async function resolveSetupCode(options: {
  argv?: string;
  filePath?: string;
  envVar?: string;
  allowStdin?: boolean;
  onWarn?: (msg: string) => void;
}): Promise<SetupCodeInput> {
  if (options.allowStdin && options.argv === "-") {
    const code = await readSetupCodeFromStdin();
    if (!code) {
      throw new Error("No setup code provided on stdin.");
    }
    return { code, source: { kind: "stdin" } };
  }

  if (options.filePath) {
    const code = readSetupCodeFromFile(options.filePath, options.onWarn);
    if (!code) {
      throw new Error(`Setup code file is empty: ${options.filePath}`);
    }
    return { code, source: { kind: "file", path: options.filePath } };
  }

  if (options.envVar) {
    const code = readSetupCodeFromEnv(options.envVar);
    if (code) {
      return { code, source: { kind: "env", varName: options.envVar } };
    }
  }

  if (options.argv && options.argv !== "-") {
    return { code: options.argv, source: { kind: "argv" } };
  }

  if (options.allowStdin) {
    const code = await readSetupCodeFromStdin();
    if (!code) {
      throw new Error("No setup code provided on stdin.");
    }
    return { code, source: { kind: "stdin" } };
  }

  throw new Error("No setup code provided.");
}

/**
 * Warn if setup code came from argv (deprecated) or an environment variable
 * (visible to same-user processes). Never logs the code itself.
 */
export function warnIfSetupCodeFromArgv(
  source: SetupCodeSource,
  runtime: SetupCodeRuntimeLog,
): void {
  if (source.kind === "argv") {
    runtime.log(
      "WARNING: Passing setup codes as command-line arguments is deprecated and insecure. " +
        "Any local process can read them from the process list. " +
        "Use --pair-file <path> or an interactive stdin prompt (`--pair -`) instead. " +
        "BRANCH_PAIRING_CODE is a fallback for non-interactive automation and is visible to same-user processes.",
    );
  } else if (source.kind === "env") {
    runtime.log(
      "WARNING: BRANCH_PAIRING_CODE is a fallback for non-interactive automation. " +
        "Environment variables are visible to same-user processes. " +
        "For interactive use, prefer a stdin prompt (`--pair -`) or --pair-file with mode 0600.",
    );
  }
}
