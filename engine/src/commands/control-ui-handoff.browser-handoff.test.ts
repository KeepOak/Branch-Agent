// #1932: the one-time browser pairing link passes the caller's lifetime to the bootstrap grant.
import { beforeEach, describe, expect, it, vi } from "vitest";

const issueDeviceBootstrapToken = vi.hoisted(() => vi.fn());
vi.mock("../infra/device-bootstrap.js", () => ({ issueDeviceBootstrapToken }));

const { issueControlUiBrowserHandoff } = await import("./control-ui-handoff.js");
const { CONTROL_UI_OWNER_BOOTSTRAP_PROFILE } = await import("../shared/device-bootstrap-profile.js");

const links = { httpUrl: "http://127.0.0.1:19031/", wsUrl: "ws://127.0.0.1:19031" };

describe("issueControlUiBrowserHandoff", () => {
  beforeEach(() => {
    issueDeviceBootstrapToken.mockReset();
    issueDeviceBootstrapToken.mockResolvedValue({ token: "one-time-code", expiresAtMs: 1234 });
  });

  it("keeps the default lifetime when no ttl is given", async () => {
    await issueControlUiBrowserHandoff(links);
    expect(issueDeviceBootstrapToken).toHaveBeenCalledWith({ profile: CONTROL_UI_OWNER_BOOTSTRAP_PROFILE });
  });

  it("passes the requested ttl and returns a one-time link without the shared token", async () => {
    const handoff = await issueControlUiBrowserHandoff(links, { ttlMs: 120_000 });
    expect(issueDeviceBootstrapToken).toHaveBeenCalledWith({
      profile: CONTROL_UI_OWNER_BOOTSTRAP_PROFILE,
      ttlMs: 120_000,
    });
    expect(handoff.expiresAtMs).toBe(1234);
    const url = new URL(handoff.browserUrl);
    const fragment = new URLSearchParams(url.hash.slice(1));
    expect(`${url.origin}${url.pathname}`).toBe("http://127.0.0.1:19031/");
    expect(fragment.get("bootstrapToken")).toBe("one-time-code");
    expect(fragment.get("gatewayUrl")).toBe(links.wsUrl);
    expect(fragment.has("token")).toBe(false);
    expect(url.search).toBe("");
  });
});
