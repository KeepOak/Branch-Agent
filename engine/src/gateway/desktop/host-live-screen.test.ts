import { afterEach, describe, expect, it } from "vitest";
import { createDesktopSessionRegistry } from "./session-registry.js";
import { createHostDesktopService, effectiveHostDesktopConfig, usesNativeHostScreen } from "./host-source.js";
import { releaseDesktopObserverToken } from "./observe-bridge.js";

const previous = process.env.BRANCH_DESKTOP_APP;
afterEach(() => {
  if (previous === undefined) delete process.env.BRANCH_DESKTOP_APP;
  else process.env.BRANCH_DESKTOP_APP = previous;
});

describe("installed Windows desktop screen", () => {
  it("ships viewing on but respects the owner's off switch and an explicit VNC port", () => {
    process.env.BRANCH_DESKTOP_APP = "1";
    expect(effectiveHostDesktopConfig(undefined).enabled).toBe(true);
    expect(usesNativeHostScreen(undefined)).toBe(true);
    expect(usesNativeHostScreen({ enabled: false })).toBe(false);
    expect(usesNativeHostScreen({ enabled: true, port: 5901 })).toBe(false);
  });

  it("grants a read-only live frame path without requiring a VNC server", async () => {
    process.env.BRANCH_DESKTOP_APP = "1";
    const registry = createDesktopSessionRegistry();
    const service = createHostDesktopService({ getConfig: () => undefined, registry });
    const requester = { connId: "owner", isCurrent: () => true };
    const result = await service.observe({ control: false, requester });
    expect(result).toMatchObject({ transport: "frames", control: false,
      wsPath: expect.stringMatching(/^\/desktop\/observe\?token=/) });
    expect(await releaseDesktopObserverToken(result.wsPath, requester)).toBe(true);
    await registry.stopAll();
  });
});
