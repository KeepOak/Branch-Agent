// Branch-to-Branch Graft commands: `branch graft invite` on the host issues upstream's device setup code;
// `branch graft join <setup-code>` on the other Branch pairs it as a scoped device (src/mcp/graft-join.ts).
import os from "node:os";
import type { Command } from "commander";
import type { BranchConfig } from "../config/types.branch.js";
import { formatErrorMessage } from "../infra/errors.js";
import { defaultRuntime } from "../runtime.js";
import { formatCliCommand } from "./command-format.js";
import { callGatewayFromCli } from "./gateway-rpc.js";

type InviteOpts = { url?: string; token?: string; json?: boolean };

/** The setup code carries this Branch's own loopback address unless the owner opened the gateway to the network
 *  (gateway.bind other than loopback), where upstream's resolver picks the LAN, tailnet or public address. */
export function graftInviteParams(cfg: BranchConfig, port: number): Record<string, unknown> {
  const bind = cfg.gateway?.bind ?? "loopback";
  return {
    includeQr: false,
    bootstrapProfile: "limited",
    ...(bind === "loopback" ? { publicUrl: `ws://127.0.0.1:${port}` } : {}),
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
  if (opts.json) {
    defaultRuntime.writeJson(result);
    return;
  }
  defaultRuntime.log(
    `Setup code for another Branch (works once, until it expires):\n${result.setupCode}`,
  );
  defaultRuntime.log(`It connects to ${result.gatewayUrl}. On the other Branch run:`);
  defaultRuntime.log(`  ${formatCliCommand("branch graft join <setup-code>")}`);
  defaultRuntime.log(
    `Approve it with ${formatCliCommand("branch devices approve <requestId>")} if it waits for approval.`,
  );
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
    .argument("<setup-code>", "The setup code from branch graft invite on the other Branch")
    .option("--name <name>", "How the other Branch shows this one (default: this computer's name)")
    .option("--json", "Print JSON", false)
    .action(async (code: string, opts: JoinOpts) => {
      try {
        await runJoin(code, opts);
      } catch (err) {
        defaultRuntime.error(`Could not join: ${formatErrorMessage(err)}`);
        defaultRuntime.exit(1);
      }
    });
}
