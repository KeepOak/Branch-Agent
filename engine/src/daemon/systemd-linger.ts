/** Reads and enables systemd user linger for headless daemon sessions. */
import os from "node:os";
import {
  normalizeOptionalLowercaseString,
  normalizeOptionalString,
} from "@branch/normalization-core/string-coerce";
import { execFileUtf8 } from "./exec-file.js";

function resolveLoginctlUser(env: Record<string, string | undefined>): string | null {
  const fromEnv = normalizeOptionalString(env.USER) || normalizeOptionalString(env.LOGNAME);
  if (fromEnv) {
    return fromEnv;
  }
  try {
    return os.userInfo().username;
  } catch {
    return null;
  }
}

type SystemdUserLingerStatus = {
  user: string;
  linger: "yes" | "no";
};

/** Reads systemd user linger status through loginctl when available. */
export async function readSystemdUserLingerStatus(params: {
  env: Record<string, string | undefined>;
  user?: string;
}): Promise<SystemdUserLingerStatus | null> {
  const user = params.user ?? resolveLoginctlUser(params.env);
  if (!user) {
    return null;
  }
  const { stdout, code } = await execFileUtf8("loginctl", ["show-user", user, "-p", "Linger"], {
    timeout: 5_000,
  });
  const line = stdout.split("\n").find((entry) => entry.trim().startsWith("Linger="));
  const value = normalizeOptionalLowercaseString(line?.split("=")[1]);
  return code === 0 && (value === "yes" || value === "no") ? { user, linger: value } : null;
}

/** Enables systemd user linger through loginctl, with optional sudo mode. */
export async function enableSystemdUserLinger(params: {
  env: Record<string, string | undefined>;
  user?: string;
  sudoMode?: "prompt" | "non-interactive";
}): Promise<{ ok: boolean; stdout: string; stderr: string; code: number }> {
  const user = params.user ?? resolveLoginctlUser(params.env);
  if (!user) {
    return { ok: false, stdout: "", stderr: "Missing user", code: 1 };
  }
  const needsSudo = typeof process.getuid === "function" ? process.getuid() !== 0 : true;
  // Non-root callers need sudo for loginctl, but tests and automation can force
  // non-interactive sudo to avoid hanging on password prompts.
  const sudoArgs =
    needsSudo && params.sudoMode !== undefined
      ? ["sudo", ...(params.sudoMode === "non-interactive" ? ["-n"] : [])]
      : [];
  const [command, ...args] = [...sudoArgs, "loginctl", "enable-linger", user];
  const { stdout, stderr, code } = await execFileUtf8(command, args, { timeout: 30_000 });
  return { ok: code === 0, stdout, stderr, code };
}

/** Disables systemd user linger through loginctl (no sudo: polkit lets a signed-in user change their own). */
export async function disableSystemdUserLinger(params: {
  env: Record<string, string | undefined>;
  user?: string;
}): Promise<{ ok: boolean; stdout: string; stderr: string; code: number }> {
  const user = params.user ?? resolveLoginctlUser(params.env);
  if (!user) {
    return { ok: false, stdout: "", stderr: "Missing user", code: 1 };
  }
  const { stdout, stderr, code } = await execFileUtf8("loginctl", ["disable-linger", user], {
    timeout: 30_000,
  });
  return { ok: code === 0, stdout, stderr, code };
}

export type SystemdUserLingerChange =
  | { ok: true; user: string; linger: "yes" | "no" }
  | { ok: false; error: string };

/**
 * "Keep working when nobody is signed in" (Private #454 D, Linux): turns linger on or off for the signed-in user,
 * or reads it. Never prompts: the Branch Agent app runs it without a terminal, so a system that wants an admin
 * password for loginctl gets the one command to run instead.
 */
export async function setSystemdUserLinger(params: {
  env: Record<string, string | undefined>;
  want: "on" | "off" | "status";
  user?: string;
}): Promise<SystemdUserLingerChange> {
  if (params.want !== "status") {
    const user = params.user ?? resolveLoginctlUser(params.env) ?? undefined;
    const change =
      params.want === "on"
        ? await enableSystemdUserLinger({ env: params.env, user })
        : await disableSystemdUserLinger({ env: params.env, user });
    if (!change.ok) {
      const detail = change.stderr.trim() || change.stdout.trim() || `loginctl exited with ${change.code}`;
      const verb = params.want === "on" ? "enable-linger" : "disable-linger";
      return {
        ok: false,
        error: `${detail}. Run \`sudo loginctl ${verb} ${user ?? "$USER"}\` once in a terminal.`,
      };
    }
  }
  const status = await readSystemdUserLingerStatus({ env: params.env, user: params.user });
  return status
    ? { ok: true, user: status.user, linger: status.linger }
    : { ok: false, error: "loginctl could not read linger for this user" };
}
