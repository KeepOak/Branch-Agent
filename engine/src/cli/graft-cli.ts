// Branch-to-Branch Graft commands: `branch graft invite` on the host issues upstream's device setup code;
// `branch graft join` on the other Branch pairs it as a scoped device (src/mcp/graft-join.ts).
import os from "node:os";
import type { Command } from "commander";
import type { BranchConfig } from "../config/types.branch.js";
import { formatErrorMessage } from "../infra/errors.js";
import { defaultRuntime } from "../runtime.js";
import { formatCliCommand } from "./command-format.js";
import { callGatewayFromCli } from "./gateway-rpc.js";

type InviteOpts = { url?: string; token?: string; json?: boolean };

/** Tailscale's IPv4 addresses sit in the carrier-grade NAT block 100.64.0.0/10. Unlike a LAN address, they do not
 *  change when the router reassigns addresses. */
export function tailnetIPv4(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()): string | undefined {
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      const isIPv4 = entry.family === "IPv4" || (entry.family as unknown) === 4;
      if (!isIPv4 || entry.internal) continue;
      const [first = -1, second = -1] = entry.address.split(".").map(Number);
      if (first === 100 && second >= 64 && second <= 127) return entry.address;
    }
  }
  return undefined;
}

const GRAFT_ADDRESS_LIMIT = 8;

function isPrivateIPv4(address: string): boolean {
  const [first = -1, second = -1] = address.split(".").map(Number);
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

/** Every address a joined Branch may try, best first: the tailnet (stable across networks), the setup code's own
 *  address, then this computer's private LAN addresses. Tailscale is optional: without it the LAN addresses remain. */
export function graftAddressCandidates(params: {
  bind: string;
  port: number;
  primary: string;
  interfaces?: NodeJS.Dict<os.NetworkInterfaceInfo[]>;
}): string[] {
  if (params.bind === "loopback") return [params.primary];
  const interfaces = params.interfaces ?? os.networkInterfaces();
  const lan = Object.values(interfaces).flatMap((entries) =>
    (entries ?? []).filter((entry) => {
      const isIPv4 = entry.family === "IPv4" || (entry.family as unknown) === 4;
      return isIPv4 && !entry.internal && isPrivateIPv4(entry.address);
    }).map((entry) => entry.address),
  );
  const tailnet = tailnetIPv4(interfaces);
  const urls = [tailnet, params.primary, ...lan.map((address) => `ws://${address}:${params.port}`)]
    .map((value) => (value && !value.startsWith("ws") ? `ws://${value}:${params.port}` : value));
  return [...new Set(urls.filter((value): value is string => Boolean(value)))].slice(0, GRAFT_ADDRESS_LIMIT);
}

/** The setup code carries this Branch's own loopback address unless the owner opened the gateway to the network
 *  (gateway.bind other than loopback). Then it prefers the tailnet address: upstream's resolver picks the LAN
 *  address, which goes stale when the router reassigns it and strands every joined Branch. */
export function graftInviteParams(
  cfg: BranchConfig,
  port: number,
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(),
): Record<string, unknown> {
  const bind = cfg.gateway?.bind ?? "loopback";
  const tailnet = bind === "loopback" ? undefined : tailnetIPv4(interfaces);
  const publicUrl =
    bind === "loopback" ? `ws://127.0.0.1:${port}` : tailnet ? `ws://${tailnet}:${port}` : undefined;
  return {
    includeQr: false,
    bootstrapProfile: "limited",
    ...(publicUrl ? { publicUrl } : {}),
  };
}

async function runInvite(opts: InviteOpts): Promise<void> {
  const [{ getRuntimeConfig }, { resolveGatewayPort }] = await Promise.all([
    import("../config/config.js"),
    import("../config/paths.js"),
  ]);
  const cfg = getRuntimeConfig();
  const port = opts.url ? Number(new URL(opts.url).port) : resolveGatewayPort(cfg);
  const result = (await callGatewayFromCli(
    "device.pair.setupCode",
    { url: opts.url, token: opts.token, json: opts.json },
    graftInviteParams(cfg, port),
    { scopes: ["operator.admin"] },
  )) as { setupCode: string; gatewayUrl: string; expiresAtMs?: number };
  result.setupCode = await withAddressCandidates(result.setupCode, cfg.gateway?.bind ?? "loopback", port);
  if (opts.json) {
    defaultRuntime.writeJson(result);
    return;
  }
  defaultRuntime.log(
    `Setup code for another Branch (works once, until it expires):\n${result.setupCode}`,
  );
  defaultRuntime.log(`It connects to ${result.gatewayUrl}. On the other Branch run:`);
  defaultRuntime.log(`  ${formatCliCommand("branch graft join")}`);
  defaultRuntime.log("  (paste the setup code at the hidden prompt, or use --code-file)");
  defaultRuntime.log(
    `Approve it with ${formatCliCommand("branch devices approve <requestId>")} if it waits for approval.`,
  );
}

/** The same setup code, listing every address this host can be reached on (the code's own bootstrap token is kept). */
async function withAddressCandidates(setupCode: string, bind: string, port: number): Promise<string> {
  const { decodePairingSetupCode, encodePairingSetupCode } = await import("../pairing/setup-code.js");
  const payload = decodePairingSetupCode(setupCode);
  const urls = graftAddressCandidates({ bind, port, primary: payload.url });
  return urls.length > 1 ? encodePairingSetupCode({ ...payload, urls }) : setupCode;
}

type JoinOpts = { name?: string; json?: boolean };

async function runJoin(code: string, opts: JoinOpts): Promise<void> {
  const [{ decodePairingSetupCode }, graft, { getRuntimeConfig }, { listGatewayAgentsBasic }] =
    await Promise.all([
      import("../pairing/setup-code.js"),
      import("../mcp/graft-join.js"),
      import("../config/config.js"),
      import("../gateway/agent-list.js"),
    ]);
  const payload = decodePairingSetupCode(code.trim());
  const name = opts.name?.trim() || os.hostname();
  const link = {
    url: payload.url,
    ...(payload.urls ? { urls: payload.urls } : {}),
    tlsFingerprint: payload.tlsFingerprint,
    name,
    joinedAt: Date.now(),
  };
  // Each attempt uses the code's one-time bootstrap token; once approved, the device token is stored.
  const joined = await graft.joinHost({
    connect: async () => {
      const { outcome, connection } = await graft.connectAsDevice({
        ...link,
        bootstrapToken: payload.bootstrapToken,
        displayName: name,
      });
      connection?.stop();
      return outcome;
    },
    onPending: (requestId) =>
      defaultRuntime.log(
        `Waiting for the other Branch to approve this one. On it: ${formatCliCommand(`branch devices approve ${requestId}`)}`,
      ),
  });
  graft.saveGraftLink(link);
  // Say hello once as this Branch and its Trunks, so the host lists them right away.
  const roster = await listGatewayAgentsBasic(getRuntimeConfig());
  const { connection, outcome } = await graft.connectAsDevice({ ...link, displayName: name });
  if (!connection) throw new Error(outcome.ok ? "No connection" : outcome.message);
  try {
    const branch = graft.graftBranchIdentity(name);
    await connection.request("contacts.outside.hello", { agent: branch });
    for (const trunk of roster.agents.filter((agent) => agent.kind !== "system")) {
      await connection.request("contacts.outside.hello", {
        agent: graft.graftTrunkIdentity(branch, trunk),
      });
    }
  } finally {
    connection.stop();
  }
  // This Branch's gateway keeps the link from now on (it also starts it whenever the gateway starts).
  const linked = await callGatewayFromCli(
    "graft.links.sync",
    { json: true },
    {},
    { scopes: ["operator.admin"] },
  )
    .then(() => true)
    .catch(() => false);
  const summary = {
    host: link.url,
    name,
    deviceId: joined.deviceId,
    scopes: joined.scopes,
    linked,
  };
  if (opts.json) {
    defaultRuntime.writeJson(summary);
    return;
  }
  defaultRuntime.log(`Grafted into ${link.url} as "${name}" (${joined.scopes.join(", ")}).`);
  defaultRuntime.log(
    linked
      ? "This Branch's gateway keeps it connected."
      : "This Branch's gateway connects to it when it next starts.",
  );
  defaultRuntime.log(
    `Work with it from this Branch: ${formatCliCommand(`branch graft --host ${link.url}`)}`,
  );
}

/** `branch graft invite` and `branch graft join`, under the `graft` command. */
export function registerGraftBranchCommands(graft: Command): void {
  graft
    .command("invite")
    .description("Issue a setup code another Branch joins this one with (branch graft join)")
    .option("--url <url>", "Gateway WebSocket URL (defaults to this Branch's gateway)")
    .option("--token <token>", "Gateway token (if required)")
    .option("--json", "Print JSON", false)
    .action(async (opts: InviteOpts) => {
      try {
        await runInvite(opts);
      } catch (err) {
        defaultRuntime.error(`Could not issue a setup code: ${formatErrorMessage(err)}`);
        defaultRuntime.exit(1);
      }
    });
  graft
    .command("join")
    .description("Graft this Branch into another Branch as a scoped device, with its setup code")
    .argument("[setup-code]", "The setup code from branch graft invite (or '-' for stdin, or omit to prompt)")
    .option("--code-file <path>", "Read setup code from file (must be mode 0600 on POSIX)")
    .option("--name <name>", "How the other Branch shows this one (default: this computer's name)")
    .option("--json", "Print JSON", false)
    .action(async (code: string | undefined, opts: JoinOpts & { codeFile?: string }) => {
      try {
        const { resolveSetupCode, warnIfSetupCodeFromArgv } = await import("./setup-code-input.js");

        const resolved = await resolveSetupCode({
          argv: code,
          filePath: opts.codeFile,
          envVar: "BRANCH_PAIRING_CODE",
          allowStdin: !code || code === "-",
          onWarn: (msg) => defaultRuntime.log(msg),
        });

        warnIfSetupCodeFromArgv(resolved.source, defaultRuntime);
        
        await runJoin(resolved.code, opts);
      } catch (err) {
        defaultRuntime.error(`Could not join: ${formatErrorMessage(err)}`);
        defaultRuntime.exit(1);
      }
    });
}
