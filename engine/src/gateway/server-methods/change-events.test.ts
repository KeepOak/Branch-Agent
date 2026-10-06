// The window keeps the Trunk list, People, worktrees, environments and memory open and reloads them on these notices.
// They used to be listened for but never sent (agents.changed, users.changed, ...): methods that change the state
// now announce it once they succeed, and readers receive it.
import { describe, expect, it, vi } from "vitest";
import { hasEventScope } from "../server-broadcast-scopes.js";
import { announceChanges } from "./change-events.js";

const reader = { connect: { role: "operator", scopes: ["operator.read"] } } as never;

async function run(handler: (o: never) => unknown) {
  const broadcast = vi.fn();
  const respond = vi.fn();
  await handler({ params: {}, respond, context: { broadcast } } as never);
  return { broadcast, respond };
}

describe("change notices for the window's open lists", () => {
  it("announces a successful change, and nothing for a refused one or an untouched method", async () => {
    const handlers = announceChanges(
      {
        "agents.create": ({ respond }) => respond(true, { agentId: "scout" }),
        "agents.delete": ({ respond }) =>
          respond(false, undefined, { code: "INVALID_REQUEST", message: "no" }),
        "agents.list": ({ respond }) => respond(true, { agents: [] }),
      },
      "agents.changed",
      ["agents.create", "agents.delete"],
    );
    const created = await run(handlers["agents.create"] as never);
    expect(created.respond).toHaveBeenCalledWith(true, { agentId: "scout" }, undefined, undefined);
    expect(created.broadcast).toHaveBeenCalledWith(
      "agents.changed",
      { method: "agents.create", ts: expect.any(Number) },
      { dropIfSlow: true },
    );
    expect((await run(handlers["agents.delete"] as never)).broadcast).not.toHaveBeenCalled();
    expect((await run(handlers["agents.list"] as never)).broadcast).not.toHaveBeenCalled();
  });

  it.each([
    "agents.changed",
    "users.changed",
    "worktrees.changed",
    "environments.changed",
    "memory.changed",
  ])("%s reaches readers", (event) => {
    expect(hasEventScope(reader, event)).toBe(true);
    expect(hasEventScope({ connect: { role: "operator", scopes: [] } } as never, event)).toBe(
      false,
    );
  });
});
