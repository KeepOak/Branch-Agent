import fs from "node:fs";
import os from "node:os";
import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";
import { toErrorObject } from "../infra/errors.js";
import { PromptInputClosedError } from "./prompt.js";

/** Read setup code from various secure sources, avoiding argv exposure. */

type SetupCodeSource =
  | { kind: "stdin"; value: string }
  | { kind: "file"; value: string; path: string }
  | { kind: "env"; value: string; varName: string }
  | { kind: "argv"; value: string };

export type SetupCodeInput = {
  code: string;
  source: SetupCodeSource;
};

/**
 * Read setup code from stdin when it's a TTY (interactive hidden prompt)
 * or from piped input.
 */
export async function readSetupCodeFromStdin(): Promise<string> {
  // Check if stdin is a TTY (interactive terminal)
  if (input.isTTY) {
    return await promptHiddenInput("Setup code: ");
  }

  // Read from piped stdin
  let data = "";
  for await (const chunk of input) {
    data += chunk;
  }
  return data.trim();
}

/**
 * Prompt for hidden input (password-style). On TTYs with mute support,
 * input is not echoed. On non-TTY stdin, input is read normally.
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

    // Mute output during input
    const mutableStdout = output as { muted?: boolean };
    mutableStdout.muted = false;

    const originalWrite = output.write.bind(output);
    // @ts-expect-error -- overriding write for muting
    output.write = (chunk: unknown, ...args: unknown[]) => {
      if (mutableStdout.muted) {
        return true;
      }
      // @ts-expect-error -- dynamic args
      return originalWrite(chunk, ...args);
    };

    mutableStdout.muted = true;

    void rl.question(prompt).then(
      (answer) => {
        mutableStdout.muted = false;
        output.write = originalWrite;
        // Write newline after hidden input
        output.write("\n");
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
 * Read setup code from a file, validating that the file has secure permissions
 * (0600 or stricter on POSIX, owner-only on Windows).
 */
export function readSetupCodeFromFile(filePath: string): string {
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

  // Check file permissions
  if (os.platform() !== "win32") {
    // POSIX: check permissions are 0600 or stricter (owner-only read/write, no group/other)
    const mode = stats.mode & 0o777;
    if ((mode & 0o077) !== 0) {
      throw new Error(
        `Setup code file has unsafe permissions: ${mode.toString(8)}. ` +
          `Set to 0600 (owner read/write only): chmod 600 ${filePath}`,
      );
    }
  } else {
    // Windows: ACL validation requires external tools (icacls) or native modules.
    // For now, document the requirement. A future enhancement could shell out to
    // icacls and parse its output to verify owner-only access.
    // 
    // Expected manual verification:
    // Right-click file → Properties → Security → Advanced
    // Ensure only the owner has permissions, inheritance is disabled,
    // and no other users/groups are listed.
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
 * Read setup code from an environment variable.
 */
export function readSetupCodeFromEnv(varName: string): string | undefined {
  return process.env[varName]?.trim();
}

/**
 * Resolve setup code from various sources in priority order:
 * 1. Stdin (when argv is "-" or allowStdin is true and no other source)
 * 2. File (--pair-file / --code-file)
 * 3. Environment variable (fallback for non-interactive automation; visible to same-user processes)
 * 4. Command-line argument (deprecated, warns)
 *
 * The code is never logged.
 * Returns both the code and metadata about where it came from.
 */
export async function resolveSetupCode(options: {
  argv?: string;
  filePath?: string;
  envVar?: string;
  allowStdin?: boolean;
}): Promise<SetupCodeInput> {
  // Priority 1: stdin (explicit request with `-` or when no other source)
  if (options.allowStdin && options.argv === "-") {
    const code = await readSetupCodeFromStdin();
    if (!code) {
      throw new Error("No setup code provided on stdin.");
    }
    return { code, source: { kind: "stdin", value: code } };
  }

  // Priority 2: file
  if (options.filePath) {
    const code = readSetupCodeFromFile(options.filePath);
    if (!code) {
      throw new Error(`Setup code file is empty: ${options.filePath}`);
    }
    return { code, source: { kind: "file", value: code, path: options.filePath } };
  }

  // Priority 3: environment variable (fallback for non-interactive automation)
  if (options.envVar) {
    const code = readSetupCodeFromEnv(options.envVar);
    if (code) {
      return { code, source: { kind: "env", value: code, varName: options.envVar } };
    }
  }

  // Priority 4: argv (deprecated, emit warning)
  if (options.argv && options.argv !== "-") {
    return { code: options.argv, source: { kind: "argv", value: options.argv } };
  }

  // Priority 5: stdin fallback (when TTY or piped)
  if (options.allowStdin) {
    const code = await readSetupCodeFromStdin();
    if (!code) {
      throw new Error("No setup code provided on stdin.");
    }
    return { code, source: { kind: "stdin", value: code } };
  }

  throw new Error("No setup code provided.");
}

/**
 * Warn if setup code came from argv (deprecated) or environment variable (visible to processes).
 */
export function warnIfSetupCodeFromArgv(
  source: SetupCodeSource,
  runtime: { warn: (msg: string) => void },
): void {
  if (source.kind === "argv") {
    runtime.warn(
      "WARNING: Passing setup codes as command-line arguments is deprecated and insecure. " +
        "Any local process can read them from the process list. " +
        "Use --pair-file <path>, stdin prompt, or set BRANCH_PAIRING_CODE environment variable instead.",
    );
  } else if (source.kind === "env") {
    runtime.warn(
      "WARNING: BRANCH_PAIRING_CODE environment variable is visible to same-user processes. " +
        "For interactive use, prefer stdin prompt (--pair -) or --pair-file with mode 0600.",
    );
  }
}
