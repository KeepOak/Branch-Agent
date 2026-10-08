import { describe, expect, it } from "vitest";
import type { AuthProfileStore } from "../auth-profiles/types.js";
import {
  createFailedOAuthRefreshFence,
  createOAuthRefreshFence,
} from "../auth-profiles/oauth-refresh-marker.js";
import { prepareAuthFixture } from "./prepare-auth.test-support.js";

function fixture() {
  const credential = {
    type: "oauth" as const,
    provider: "xai",
    access: "fixture-access",
    refresh: "fixture-refresh",
    expires: Date.now() + 3_600_000,
  };
  const store: AuthProfileStore = {
    version: 1,
    profiles: {
      "xai:pinned": credential,
      "xai:backup": { ...credential, access: "fixture-backup" },
      "xai:unlisted": { ...credential, access: "fixture-unlisted" },
    },
  };
  const input = {
    provider: "xai",
    modelId: "grok-4",
    env: {},
    config: { auth: { order: { xai: ["xai:pinned", "xai:backup"] } } },
    authProfileStore: store,
    sessionAuthProfileId: "xai:pinned",
    sessionAuthProfileSource: "user" as const,
  };
  const profiles = () => prepareAuthFixture(input).attempts.map((attempt) => attempt.profileId);
  return { credential, store, input, profiles };
}

describe("unavailable pinned sign-in fallback", () => {
  it("falls back on turn two after refresh fails and retries the pin after recovery", () => {
    const { credential, store, input, profiles } = fixture();
    store.profiles["xai:pinned"] = createOAuthRefreshFence({
      profileId: "xai:pinned",
      credential,
    });
    expect(profiles()).toEqual(["xai:pinned", "xai:backup"]);
    store.profiles["xai:pinned"] = createFailedOAuthRefreshFence(
      store.profiles["xai:pinned"] as typeof credential,
    );
    expect(profiles()).toEqual(["xai:backup"]);
    expect(input.sessionAuthProfileId).toBe("xai:pinned");
    expect(input.sessionAuthProfileSource).toBe("user");
    store.profiles["xai:pinned"] = credential;
    expect(profiles()).toEqual(["xai:pinned", "xai:backup"]);
  });

  it.each(["cooldownUntil", "disabledUntil"] as const)(
    "skips an active %s window without losing the pin",
    (window) => {
      const { store, input, profiles } = fixture();
      store.usageStats = { "xai:pinned": { [window]: Date.now() + 60_000 } };
      expect(profiles()).toEqual(["xai:backup"]);
      expect(input.sessionAuthProfileId).toBe("xai:pinned");
      store.usageStats = {};
      expect(profiles()).toEqual(["xai:pinned", "xai:backup"]);
    },
  );

  it("still rejects an unknown pin rather than borrowing the backup", () => {
    const { store, profiles } = fixture();
    delete store.profiles["xai:pinned"];
    expect(profiles).toThrow();
  });

  it("reports provider mismatch rather than treating it as a refresh failure", () => {
    const { credential, store, profiles } = fixture();
    store.profiles["xai:pinned"] = { ...credential, provider: "anthropic" };
    expect(profiles).toThrow(/provider_mismatch/);
  });

  it("keeps explicit no-fallback bindings strict and reports the failure reason", () => {
    const { credential, store, input } = fixture();
    store.profiles["xai:pinned"] = createFailedOAuthRefreshFence(
      createOAuthRefreshFence({ profileId: "xai:pinned", credential }),
    );
    expect(() => prepareAuthFixture({ ...input, allowAuthProfileFallback: false })).toThrow(
      /expired/,
    );
  });
});
