import { ErrorCodes, errorShape, type GatewayRequestHandlers } from "branch/plugin-sdk/gateway-runtime";
import { z } from "zod";
import { getBrowserGuestRegistry } from "../guest/guest-registry.js";

const hostSchema = z.strictObject({
  sessionKey: z.string().trim().min(1).max(512),
  ready: z.boolean(),
});
const respondSchema = z.object({
  requestId: z.string().min(1).max(128),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().max(2000).optional(),
});

const INVALID_GUEST_REQUEST = "Guest pane request is invalid.";
const GUEST_ACTION_FAILED = "The browser pane couldn't do that.";

/** The window declares whether its guest pane is ready for one conversation. */
export const handleBrowserGuestHost: GatewayRequestHandlers[string] = ({
  params,
  respond,
  client,
  context,
}) => {
  const parsed = hostSchema.safeParse(params);
  if (!parsed.success || !client?.connId) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, INVALID_GUEST_REQUEST));
    return;
  }
  const connId = client.connId;
  getBrowserGuestRegistry().setReady(parsed.data.sessionKey, parsed.data.ready, {
    connId,
    send: (event, payload) => context.broadcastToConnIds(event, payload, new Set([connId])),
    closed: client.connectionSignal,
  });
  respond(true, { ok: true });
};

/** The window answers one guest request by its id. */
export const handleBrowserGuestRespond: GatewayRequestHandlers[string] = ({
  params,
  respond,
  client,
}) => {
  const parsed = respondSchema.safeParse(params);
  if (!parsed.success || !client?.connId) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, INVALID_GUEST_REQUEST));
    return;
  }
  const { requestId, ok, result, error } = parsed.data;
  const answer = ok
    ? { ok: true as const, result }
    : { ok: false as const, error: error ?? GUEST_ACTION_FAILED };
  respond(true, getBrowserGuestRegistry().respond({ requestId, connId: client.connId, answer }));
};
