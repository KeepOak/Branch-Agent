import { describe, expect, it, vi } from "vitest";
import { decideHostAttach, type HostGateway } from "./host-attach.js";

const owner = (overrides: Partial<HostGateway> = {}): HostGateway => ({
  pid: process.pid + 1,
  home: "owner-home",
  port: 32123,
  profiles: ["default"],
  servedKnown: true,
  standalone: false,
  ...overrides,
});

describe("Hermes host attach ladder", () => {
  it("starts when no host owner is present", async () => {
    expect(await decideHostAttach({ profile: "default" })).toMatchObject({ outcome: "start" });
  });

  it("attaches only when the live owner serves the profile", async () => {
    expect(await decideHostAttach({ profile: "default", owner: owner() })).toMatchObject({
      outcome: "attach",
      transient: true,
    });
  });

  it("waits for an unknown owner to publish its served set", async () => {
    const waitForOwner = vi.fn().mockResolvedValue(owner());
    expect(
      await decideHostAttach({
        profile: "default",
        owner: owner({ profiles: [], servedKnown: false }),
        waitForOwner,
      }),
    ).toMatchObject({ outcome: "attach" });
    expect(waitForOwner).toHaveBeenCalledOnce();
  });

  it("rescans a live gateway before refusing an unserved profile", async () => {
    const rescan = vi.fn().mockResolvedValue(owner({ profiles: ["default", "work"] }));
    expect(
      await decideHostAttach({ profile: "work", owner: owner(), rescan }),
    ).toMatchObject({ outcome: "attach" });
    expect(rescan).toHaveBeenCalledOnce();
  });

  it("keeps an unresponsive owner's served set unknown and retries transiently", async () => {
    expect(
      await decideHostAttach({
        profile: "work",
        owner: owner({ profiles: [], servedKnown: false }),
        waitForOwner: async () => owner({ profiles: [], servedKnown: false }),
      }),
    ).toMatchObject({ outcome: "refuse", transient: true });
  });

  it("replaces only an owner that serves this profile or has not answered", async () => {
    expect(
      await decideHostAttach({ profile: "default", owner: owner(), replace: true }),
    ).toMatchObject({ outcome: "replace-host" });
    expect(
      await decideHostAttach({ profile: "work", owner: owner(), replace: true }),
    ).toMatchObject({ outcome: "refuse" });
  });

  it("lets another standalone profile start beside a confirmed standalone owner", async () => {
    expect(
      await decideHostAttach({
        profile: "work",
        owner: owner(),
        rescan: async () => owner({ standalone: true }),
      }),
    ).toMatchObject({ outcome: "start" });
  });
});
