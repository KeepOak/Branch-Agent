// Claude Code owns its subscription token. Ask its control channel for limits;
// never read or refresh its credential files from provider usage.
import { spawn } from "node:child_process";
import type { ProviderUsageSnapshot, UsageWindow } from "../../src/infra/provider-usage.types.js";
import { resolveClaudeTerminalExecutable } from "./session-catalog-executable.js";

const ARGS = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
  "--settings", JSON.stringify({ disableAllHooks: true }), "--strict-mcp-config", "--no-session-persistence"];
const THROTTLE_MS = 120_000;
const TIMEOUT_MS = 120_000;
let cached: { at: number; home: string; value: ProviderUsageSnapshot | null } | undefined;
let pending: Promise<ProviderUsageSnapshot | null> | undefined;

function command(args: string[], input: string, env: NodeJS.ProcessEnv, onLine?: (line: string) => boolean): Promise<string> {
  const resolved = resolveClaudeTerminalExecutable(env);
  if (!resolved) return Promise.reject(new Error("Claude Code is not installed"));
  return new Promise((resolve, reject) => {
    const child = spawn(resolved.executable, args, {
      env: { ...env, ...(resolved.pathEnv ? { PATH: resolved.pathEnv } : {}) },
      stdio: ["pipe", "pipe", "ignore"], windowsHide: true, shell: false,
    });
    let output = "";
    let lines = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(output);
      child.kill();
    };
    const timer = setTimeout(() => finish(new Error("Claude Code usage timed out")), TIMEOUT_MS);
    timer.unref?.();
    child.on("error", (error) => finish(error));
    child.on("close", () => finish(output ? undefined : new Error("Claude Code returned no usage")));
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk;
      if (output.length > 1_000_000) return finish(new Error("Claude Code response was too large"));
      if (!onLine) return;
      lines += chunk;
      const parts = lines.split("\n");
      lines = parts.pop() ?? "";
      for (const line of parts) if (onLine(line)) return finish();
    });
    child.stdin.on("error", () => {});
    if (onLine) child.stdin.write(input); else child.stdin.end(input);
  });
}

export function claudeCodeUsageWindows(line: string): UsageWindow[] | null {
  let event: { type?: string; response?: { request_id?: string; subtype?: string; response?: { rate_limits?: Record<string, { utilization?: number; resets_at?: string }> } } };
  try { event = JSON.parse(line); } catch { return null; }
  if (event.type !== "control_response" || event.response?.request_id !== "branch-usage") return null;
  if (event.response.subtype !== "success") return [];
  return ([ ["five_hour", "5 hours"], ["seven_day", "Week"] ] as const).flatMap(([id, label]) => {
    const limit = event.response?.response?.rate_limits?.[id];
    if (typeof limit?.utilization !== "number" || !Number.isFinite(limit.utilization)) return [];
    const reset = limit.resets_at ? Date.parse(limit.resets_at) : NaN;
    return [{ label, usedPercent: Math.max(0, Math.min(100, limit.utilization)), ...(Number.isFinite(reset) ? { resetAt: reset } : {}) }];
  });
}

export async function readClaudeCodeUsage(env: NodeJS.ProcessEnv = process.env, now = Date.now()): Promise<ProviderUsageSnapshot | null> {
  const home = env.CLAUDE_CONFIG_DIR ?? "";
  if (cached?.home === home && now - cached.at < THROTTLE_MS) return cached.value;
  if (pending) return await pending;
  pending = (async () => {
    const status = JSON.parse(await command(["auth", "status"], "", env)) as { loggedIn?: boolean; email?: string; authMethod?: string };
    if (!status.loggedIn || status.authMethod !== "claude.ai") return null;
    const input = ["initialize", "get_usage"].map((subtype, i) => JSON.stringify({ type: "control_request", request_id: i ? "branch-usage" : "branch-start", request: { subtype } })).join("\n") + "\n";
    let windows: UsageWindow[] | null = null;
    await command(ARGS, input, env, (line) => {
      windows = claudeCodeUsageWindows(line);
      return windows !== null;
    });
    return { provider: "claude-code", displayName: "Claude Code", windows: windows ?? [],
      ...(status.email ? { accountEmail: status.email } : {}),
      authProfileId: `claude-code:${home || "default"}` };
  })();
  try {
    const value = await pending;
    cached = { home, at: now, value };
    return value;
  } finally { pending = undefined; }
}
