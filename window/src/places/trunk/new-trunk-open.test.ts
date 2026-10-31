import { beforeEach, describe, expect, it, vi } from "vitest";
import { notify } from "../../shell/notify";
import { newTrunkOpenFailedLine, openNewTrunkConversation } from "./new-trunk-open";

vi.mock("../../shell/notify", () => ({ notify: vi.fn() }));

type Options = { tone?: string; keep?: boolean; line?: string; action?: { label: string; run: () => void } };
const lastOptions = () => vi.mocked(notify).mock.calls.at(-1)?.[1] as Options | undefined;

describe("opening a new Trunk's first conversation (#479)", () => {
  beforeEach(() => vi.mocked(notify).mockClear());

  it("shows the conversation and says nothing when it opens", async () => {
    const show = vi.fn();
    await expect(openNewTrunkConversation("Hazel", { ready: async () => undefined, open: async () => "agent:hazel:main", show })).resolves.toBe(true);
    expect(show).toHaveBeenCalledWith("agent:hazel:main");
    expect(notify).not.toHaveBeenCalled();
  });

  it("says plainly the Trunk is ready but its conversation couldn't open, with Try again", async () => {
    const show = vi.fn();
    const open = vi.fn(async () => null);
    await expect(openNewTrunkConversation("Hazel", { ready: async () => undefined, open, show })).resolves.toBe(false);
    expect(show).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notify).mock.calls[0]?.[0]).toBe("“Hazel” is ready, but its conversation couldn’t open.");
    expect(lastOptions()).toMatchObject({ tone: "bad", keep: true });
    expect(lastOptions()?.action?.label).toBe("Try again");
  });

  it("says the same when the gateway has not listed the Trunk yet, without the engine's words", async () => {
    const open = vi.fn(async () => "agent:hazel:main");
    const ready = vi.fn(async () => { throw new Error("Agent creation no longer owns its originally observed target"); });
    await expect(openNewTrunkConversation("Hazel", { ready, open, show: vi.fn() })).resolves.toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(vi.mocked(notify).mock.calls[0]?.[0]).toBe("“Hazel” is ready, but its conversation couldn’t open.");
    expect(JSON.stringify(vi.mocked(notify).mock.calls)).not.toContain("originally observed target");
  });

  it("Try again waits for the Trunk and opens its conversation, with no second create", async () => {
    let up = false;
    const ready = vi.fn(async () => { if (!up) throw new Error("not listed yet"); });
    const show = vi.fn();
    await openNewTrunkConversation("Hazel", { ready, open: async () => "agent:hazel:main", show });
    up = true;
    lastOptions()?.action?.run();
    await vi.waitFor(() => expect(show).toHaveBeenCalledWith("agent:hazel:main"));
    expect(ready).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("opens the new Trunk's page when its conversation can't open, and only then", async () => {
    const showTrunk = vi.fn();
    await openNewTrunkConversation("Hazel", { ready: async () => undefined, open: async () => null, show: vi.fn(), showTrunk });
    expect(showTrunk).toHaveBeenCalledTimes(1);
    expect(lastOptions()?.line).toBe("Its page is open. Try again to start its conversation.");
    showTrunk.mockClear();
    await openNewTrunkConversation("Hazel", { ready: async () => undefined, open: async () => "agent:hazel:main", show: vi.fn(), showTrunk });
    expect(showTrunk).not.toHaveBeenCalled();
  });

  it("names an unnamed Trunk plainly", () => {
    expect(newTrunkOpenFailedLine("  ")).toBe("Your new Trunk is ready, but its conversation couldn’t open.");
  });
});
