import { describe, expect, it } from "vitest";
import { availability, canAll, isUnknownMethod, noteUnknownMethod, requestOrComing } from "./capabilities";
import type { EngineFeatures, WindowEngine } from "./engine";

const features = (methods: string[]): EngineFeatures => ({ methods, events: [] });
const engineWith = (f: EngineFeatures | undefined, request: WindowEngine["request"] = async () => ({}) as never): WindowEngine =>
  ({ request, onEvent: () => () => {}, sessionKey: null, scopes: [], ...(f ? { features: f } : {}) });

describe("capabilities", () => {
  it("reads the methods the engine announced in its hello", () => {
    const engine = engineWith(features(["chat.send", "sessions.list"]));
    expect(availability(engine, "chat.send")).toBe("yes");
    expect(availability(engine, "channels.add")).toBe("no");
    expect(canAll(engine, ["chat.send", "sessions.list"])).toBe(true);
    expect(canAll(engine, ["chat.send", "channels.add"])).toBe(false);
  });

  it("knows nothing before the first hello", () => {
    expect(availability(engineWith(undefined), "chat.send")).toBe("unknown");
    expect(availability(null, "chat.send")).toBe("unknown");
    expect(canAll(engineWith(undefined), ["chat.send"])).toBe(false);
  });

  it("turns a listed method to missing when the engine answers unknown method, until the next hello", async () => {
    const first = features(["canopy.cards.list"]);
    const engine = engineWith(first, async () => { throw new Error("unknown method: canopy.cards.list"); });
    await expect(requestOrComing(engine, "canopy.cards.list")).rejects.toThrow("unknown method");
    expect(availability(engine, "canopy.cards.list")).toBe("no");
    expect(availability(engineWith(features(["canopy.cards.list"])), "canopy.cards.list")).toBe("yes");
  });

  it("leaves other failures alone", async () => {
    const engine = engineWith(features(["sessions.list"]), async () => { throw new Error("gateway timeout"); });
    await expect(requestOrComing(engine, "sessions.list")).rejects.toThrow("timeout");
    expect(availability(engine, "sessions.list")).toBe("yes");
    expect(noteUnknownMethod(engine, "sessions.list", "INVALID_REQUEST: missing scope")).toBe(false);
    expect(isUnknownMethod("unknown method: x")).toBe(true);
    expect(isUnknownMethod(undefined)).toBe(false);
  });
});
