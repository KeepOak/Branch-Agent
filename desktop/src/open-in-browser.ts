// "Open in browser" (#1932). The app never hands the browser its long-lived Gateway secret. It asks the engine's own
// `branch dashboard --json` for the one-time browser pairing link the engine already issues: a single-use,
// owner bootstrap code that expires in two minutes that the page trades for its own device credential when it connects, then strips
// from the address bar. Nothing here logs the link or the engine's answer.

/** The engine command that issues the one-time browser pairing link (engine/src/commands/dashboard.ts). */
export const DASHBOARD_HANDOFF_ARGS: readonly string[] = ["branch.mjs", "dashboard", "--json", "--ttl-seconds", "120"];

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** The last JSON object the engine printed, or undefined. */
function lastJsonObject(stdout: string): Record<string, unknown> | undefined {
  const lines = stdout.trim().split(/\r?\n/u);
  for (let start = lines.length - 1; start >= 0; start -= 1) {
    if (!lines[start]!.trimStart().startsWith("{")) continue;
    try {
      const value = JSON.parse(lines.slice(start).join("\n")) as unknown;
      if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
    } catch { /* keep looking further up */ }
  }
  return undefined;
}

/**
 * The one-time pairing link from the engine's answer, accepted only when it points at this machine's Gateway port and
 * carries a single-use bootstrap code and never the shared secret. Errors never quote the answer.
 */
export function pickBrowserHandoffUrl(stdout: string, port: number): string {
  const answer = lastJsonObject(stdout);
  if (!answer || answer.ok !== true || typeof answer.browserUrl !== "string") {
    throw new Error("The engine did not return a browser pairing link");
  }
  let url: URL;
  try { url = new URL(answer.browserUrl); } catch { throw new Error("The engine returned an unreadable browser pairing link"); }
  const fragment = new URLSearchParams(url.hash.replace(/^#/u, ""));
  const query = url.searchParams;
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("The browser pairing link is not a web address");
  if (!LOOPBACK_HOSTS.has(url.hostname) || Number(url.port) !== port) throw new Error("The browser pairing link is not this computer's Gateway");
  if (url.username || url.password) throw new Error("The browser pairing link carries a sign-in");
  if (fragment.has("token") || query.has("token") || fragment.has("password") || query.has("password")) {
    throw new Error("The browser pairing link carries the Gateway secret");
  }
  if (!fragment.get("bootstrapToken")) throw new Error("The browser pairing link has no one-time code");
  return url.toString();
}

export interface OpenInBrowserSteps {
  /** Runs DASHBOARD_HANDOFF_ARGS for the running engine and resolves its stdout. */
  issue(): Promise<string>;
  /** The live Gateway port. */
  port(): number;
  /** Opens the default browser. */
  open(url: string): Promise<void>;
  log(line: string): void;
}

/** Issues a fresh one-time link for each click and opens it. Resolves false, logging a plain line, when it can't. */
export async function openInBrowser(steps: OpenInBrowserSteps): Promise<boolean> {
  steps.log("tray: open in browser");
  try {
    const url = pickBrowserHandoffUrl(await steps.issue(), steps.port());
    await steps.open(url);
    return true;
  } catch (error) {
    // The engine's answer and stderr can hold secrets: log only our own plain sentences.
    const plain = error instanceof Error && /^The (engine|browser pairing link)/u.test(error.message)
      ? error.message : "the engine could not issue a browser pairing link";
    steps.log(`open in browser failed: ${plain}`);
    return false;
  }
}
