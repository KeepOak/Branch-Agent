// The window's one-at-a-time equivalent of `branch graft join`. A pending approval is returned to the window;
// repeating with the same code after approval completes the join without holding a Gateway RPC open for minutes.
import os from "node:os";
import { getRuntimeConfig } from "../config/config.js";
import {
  connectAsDevice,
  assertNotSelfGraftLink,
  graftBranchIdentity,
  graftTrunkIdentity,
  saveGraftLink,
  resolveGraftGatewayPort,
  type GraftLink,
} from "../mcp/graft-join.js";
import { ensureGraftLinks } from "../mcp/graft-link.js";
import { decodePairingSetupCode } from "../pairing/setup-code.js";
import { listGatewayAgentsBasic } from "./agent-list.js";

export async function joinGraftFromWindow(
  code: string,
  name = os.hostname(),
): Promise<
  { pending: true; requestId: string } | { pending: false; link: GraftLink; scopes: string[] }
> {
  const payload = decodePairingSetupCode(code.trim());
  const link: GraftLink = {
    url: payload.url,
    ...(payload.tlsFingerprint ? { tlsFingerprint: payload.tlsFingerprint } : {}),
    name: name.trim() || os.hostname(),
    joinedAt: Date.now(),
  };
  const port = await resolveGraftGatewayPort();
  assertNotSelfGraftLink(link, port);
  const first = await connectAsDevice({
    ...link,
    bootstrapToken: payload.bootstrapToken,
    displayName: link.name,
  });
  first.connection?.stop();
  if (!first.outcome.ok) {
    if (first.outcome.pendingRequestId) {
      return { pending: true, requestId: first.outcome.pendingRequestId };
    }
    throw new Error(first.outcome.message);
  }
  // The host's saved device token, not the one-time setup token, is used from now on.
  saveGraftLink(link, undefined, port);
  const roster = await listGatewayAgentsBasic(getRuntimeConfig());
  const second = await connectAsDevice({ ...link, displayName: link.name });
  if (!second.connection) {
    throw new Error(
      second.outcome.ok ? "No connection to the other Branch" : second.outcome.message,
    );
  }
  try {
    const branch = graftBranchIdentity(link.name);
    await second.connection.request("contacts.outside.hello", { agent: branch });
    for (const trunk of roster.agents.filter((agent) => agent.kind !== "system")) {
      await second.connection.request("contacts.outside.hello", {
        agent: graftTrunkIdentity(branch, trunk),
      });
    }
  } finally {
    second.connection.stop();
  }
  ensureGraftLinks(() => undefined, port);
  return { pending: false, link, scopes: first.outcome.scopes };
}
