// "Something changed" notices for lists the window keeps open (Trunks, People, worktrees, environments, memory). The
// methods that change that state announce it once they succeed, the way rooms.* announce rooms.changed; the window
// reloads the list on the notice instead of waiting for a click. Payloads carry only the method name: readers fetch
// the new state with their own scope-checked reads.
import type { GatewayRequestHandlers } from "./types.js";

/** Wrap `methods` of `handlers` so a successful call broadcasts `event` (`{ method, ts }`) to readers. */
export function announceChanges(
  handlers: GatewayRequestHandlers,
  event: string,
  methods: readonly string[],
): GatewayRequestHandlers {
  const wrapped: GatewayRequestHandlers = { ...handlers };
  for (const method of methods) {
    const handler = handlers[method];
    if (!handler) continue;
    wrapped[method] = async (options) => {
      let succeeded = false;
      await handler({
        ...options,
        respond: (ok, payload, error, meta) => {
          succeeded = ok;
          options.respond(ok, payload, error, meta);
        },
      });
      if (succeeded) {
        options.context.broadcast(event, { method, ts: Date.now() }, { dropIfSlow: true });
      }
    };
  }
  return wrapped;
}
