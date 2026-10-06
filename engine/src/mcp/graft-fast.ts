// Fast start for Graft (`branch graft`, `branch mcp serve`): coding agents give an MCP server about 30 seconds to
// answer, and the full engine CLI (plugin scan, config guard, doctor checks) took 8-11 s on the owner's PC. When the
// gateway to talk to is already known (the desktop app's loopback gateway, or --url with a token or password file),
// this starts the MCP server straight away and talks only to that running gateway. Anything else, and
// BRANCH_GRAFT_FULL_CLI=1, falls through to the full CLI unchanged.
import fs from "node:fs";
import { resolveDesktopGateway } from "./desktop-gateway.js";

export type GraftFastPlan = {
  gatewayUrl: string;
  gatewayToken?: string;
  gatewayPassword?: string;
  claudeChannelMode: "auto" | "on" | "off";
  verbose: boolean;
};

const VALUE_FLAGS = new Set(["--url", "--token-file", "--password-file", "--claude-channel-mode"]);

/** The arguments after `graft` or `mcp serve`, or undefined when this is another command. */
function graftArgs(argv: readonly string[]): string[] | undefined {
  const args = argv.slice(2);
  if (args[0] === "graft") return args.slice(1);
  if (args[0] === "mcp" && args[1] === "serve") return args.slice(2);
  return undefined;
}

function firstLine(file: string): string | undefined {
  const stat = fs.lstatSync(file);
  // The full CLI's secret-file policy: a regular file, not a link, and small.
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024) return undefined;
  return fs.readFileSync(file, "utf8").split(/\r?\n/)[0]?.trim() || undefined;
}

/**
 * What the fast path would run, or undefined when the full CLI must handle it: help, an unknown flag, --token or
 * --password on the command line (the full CLI warns about those), or no gateway known without reading config.
 */
export function planGraftFast(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  desktop: typeof resolveDesktopGateway = resolveDesktopGateway,
): GraftFastPlan | undefined {
  const args = graftArgs(argv);
  if (!args || env.BRANCH_GRAFT_FULL_CLI === "1") return undefined;
  const values: Record<string, string> = {};
  let verbose = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const [flag, inline] = arg.includes("=")
      ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)]
      : [arg, undefined];
    if (flag === "-v" || flag === "--verbose") {
      verbose = true;
    } else if (VALUE_FLAGS.has(flag)) {
      const value = inline ?? args[++i];
      if (!value || value.startsWith("-")) return undefined;
      values[flag] = value;
    } else {
      return undefined;
    }
  }
  const mode = values["--claude-channel-mode"] ?? "auto";
  if (mode !== "auto" && mode !== "on" && mode !== "off") return undefined;
  const token = values["--token-file"] ? firstLine(values["--token-file"]) : undefined;
  const password = values["--password-file"] ? firstLine(values["--password-file"]) : undefined;
  if ((values["--token-file"] && !token) || (values["--password-file"] && !password))
    return undefined;
  const base = { claudeChannelMode: mode, verbose } as const;
  if (values["--url"]) {
    return token || password
      ? {
          ...base,
          gatewayUrl: values["--url"],
          ...(token ? { gatewayToken: token } : {}),
          ...(password ? { gatewayPassword: password } : {}),
        }
      : undefined;
  }
  if (token || password) return undefined;
  // The desktop's branch command sets the gateway token and port; without them, the desktop app's token file.
  const envToken = env.BRANCH_GATEWAY_TOKEN?.trim();
  const envPort = Number(env.BRANCH_GATEWAY_PORT);
  if (envToken && Number.isInteger(envPort) && envPort > 0) {
    return { ...base, gatewayUrl: `ws://127.0.0.1:${envPort}`, gatewayToken: envToken };
  }
  if (envToken || env.BRANCH_GATEWAY_PASSWORD) return undefined;
  const found = desktop({}, env);
  return found ? { ...base, gatewayUrl: found.url, gatewayToken: found.token } : undefined;
}

/** Runs Graft without the full CLI when it can. Resolves false (nothing started) when the full CLI must run. */
export async function runGraftFast(argv: readonly string[]): Promise<boolean> {
  const plan = planGraftFast(argv);
  if (!plan) return false;
  // stdout carries MCP frames only; anything a module logs goes to stderr.
  console.log = console.error;
  console.info = console.error;
  console.debug = console.error;
  const { serveBranchChannelMcp } = await import("./channel-server.js");
  try {
    await serveBranchChannelMcp({
      gatewayUrl: plan.gatewayUrl,
      gatewayToken: plan.gatewayToken,
      gatewayPassword: plan.gatewayPassword,
      claudeChannelMode: plan.claudeChannelMode,
      verbose: plan.verbose,
      // The gateway is named above; no engine config is read on this path.
      config: {},
    });
  } catch (error) {
    process.stderr.write(
      `Graft failed to start: ${error instanceof Error ? error.message : String(error)}. Run branch gateway status --deep --require-rpc to inspect Gateway health.\n`,
    );
    process.exitCode = 1;
  }
  return true;
}
