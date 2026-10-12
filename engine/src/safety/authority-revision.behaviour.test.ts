import { describe, expect, it, vi } from "vitest";
import {
  afterAwait,
  AuthorityRevisions,
  captureAuthority,
  isStaleAuthorityError,
  recheckAuthority,
  RunGenerations,
  StaleAuthorityError,
  type AuthoritySource,
} from "./authority-revision.js";
import { FencedLeaseTable, OrderedFailureCounter, OrderedOutcomeLog } from "./ordered-outcomes.js";
import {
  assertPinnedSignInResponse,
  assertPinnedUnchanged,
  ElevatedChain,
  guardedServerStart,
  makeStreamGuard,
  runCheckedPhases,
} from "./stale-work.js";

type Live = {
  profile: string | undefined;
  locked: boolean | undefined;
  lockdown: boolean | undefined;
};

function liveSource(live: Live): AuthoritySource {
  return {
    profileId: () => live.profile,
    appLocked: () => live.locked,
    lockdown: () => live.lockdown,
  };
}

function setup() {
  const live: Live = { profile: "owner", locked: false, lockdown: false };
  const revisions = new AuthorityRevisions();
  const source = liveSource(live);
  const snapshot = captureAuthority(revisions, source);
  const recheck = () => recheckAuthority(revisions, source, snapshot);
  return { live, revisions, source, snapshot, recheck };
}

describe("authority re-check after every await (SAFETY-0193)", () => {
  it("G-1616: a profile switch away and back during an await is caught by the revision", async () => {
    const { revisions, recheck } = setup();
    const body = afterAwait(
      Promise.resolve().then(() => {
        revisions.bump("owner-profile");
        revisions.bump("owner-profile");
        return "request body";
      }),
      recheck,
    );
    await expect(body).rejects.toThrow(/owner-profile changed/);
  });

  it("G-1616: Lockdown, App lock and config are re-checked right before the side effect", () => {
    const { live, revisions, recheck } = setup();
    expect(() => recheck()).not.toThrow();
    live.lockdown = true;
    expect(() => recheck()).toThrow(/Lockdown is on/);
    live.lockdown = false;
    live.locked = true;
    expect(() => recheck()).toThrow(/Branch is locked/);
    live.locked = false;
    revisions.bump("config");
    expect(() => recheck()).toThrow(/config changed/);
  });

  it("G-1617: locking cancels in-flight work and nothing resumes after unlock", () => {
    const { live, revisions, source } = setup();
    const gens = new RunGenerations();
    const pending = gens.begin("owner-op");
    const accepted = gens.begin("continuation");
    gens.cancelAll();
    revisions.bump("app-lock");
    revisions.bump("app-lock");
    expect(gens.isCurrent(pending)).toBe(false);
    expect(gens.isCurrent(accepted)).toBe(false);
    expect(() => gens.assertCurrent(accepted)).toThrow(StaleAuthorityError);
    live.locked = undefined;
    expect(() => captureAuthority(revisions, source)).toThrow(/lock state could not be read/);
  });

  it("G-1618: overnight work pauses at the phase boundary when Lockdown turns on", async () => {
    const { live, recheck } = setup();
    const apply = vi.fn(async () => undefined);
    const result = await runCheckedPhases({
      phases: [
        { name: "gather", run: async () => undefined },
        { name: "draft", run: async () => void (live.lockdown = true) },
        { name: "check", run: async () => undefined },
      ],
      recheck,
      produce: async () => "draft",
      apply,
    });
    expect(result).toEqual({ status: "paused", atPhase: "check", reason: "Lockdown is on" });
    expect(apply).not.toHaveBeenCalled();
  });

  it("G-1618: a quiet or consent change after the result is produced stops the apply", async () => {
    const { revisions, recheck } = setup();
    const apply = vi.fn(async () => undefined);
    const result = await runCheckedPhases({
      phases: [],
      recheck,
      produce: async () => {
        revisions.bump("policy");
        return 1;
      },
      apply,
    });
    expect(result.status).toBe("paused");
    expect(apply).not.toHaveBeenCalled();
  });

  it("G-1624: a superseded server start closes what it opened and never takes the newer start's resources", async () => {
    const gens = new RunGenerations();
    const closed: string[] = [];
    let release: () => void = () => undefined;
    const first = guardedServerStart({
      generations: gens,
      scope: "mcp:files",
      launchKey: "v1",
      currentLaunchKey: () => "v1",
      open: (t) =>
        new Promise<string>((r) => {
          release = () => r(`handle-${t.generation}`);
        }),
      close: async (h) => void closed.push(h),
    });
    const second = await guardedServerStart({
      generations: gens,
      scope: "mcp:files",
      launchKey: "v1",
      currentLaunchKey: () => "v1",
      open: async (t) => `handle-${t.generation}`,
      close: async (h) => void closed.push(h),
    });
    release();
    expect(await first).toBeUndefined();
    expect(second).toBe("handle-2");
    expect(closed).toEqual(["handle-1"]);
  });

  it("G-1624: a changed saved launch makes the start close its handle", async () => {
    const closed: string[] = [];
    const handle = await guardedServerStart({
      generations: new RunGenerations(),
      scope: "mcp:git",
      launchKey: "v1",
      currentLaunchKey: () => "v2",
      open: async () => "h",
      close: async (h) => void closed.push(h),
    });
    expect(handle).toBeUndefined();
    expect(closed).toEqual(["h"]);
  });

  it("G-1720: a cancelled run's late response cannot alter the next run", () => {
    const gens = new RunGenerations();
    const state: string[] = [];
    const stopped = gens.begin("flow:42");
    gens.cancel("flow:42");
    const next = gens.begin("flow:42");
    for (const [ticket, value] of [
      [stopped, "old answer"],
      [next, "new answer"],
    ] as const) {
      if (gens.isCurrent(ticket)) {
        state.push(value);
      }
    }
    expect(state).toEqual(["new answer"]);
    expect(next.generation).toBeGreaterThan(stopped.generation);
  });

  it("G-1703: a health check begun on an old credential grant is refused after a new sign-in", async () => {
    const { revisions, recheck } = setup();
    const check = afterAwait(
      Promise.resolve().then(() => {
        revisions.bump("credential-grant");
        return { healthy: true };
      }),
      recheck,
    );
    await expect(check).rejects.toThrow(/credential-grant changed/);
  });

  it("G-1725: publishing re-checks the exact commit, tree and destination before the remote effect", () => {
    const pinned = {
      request: "r1",
      contract: "c1",
      commit: "abc",
      tree: "t1",
      destination: "main",
    };
    expect(() => assertPinnedUnchanged(pinned, { ...pinned })).not.toThrow();
    expect(() => assertPinnedUnchanged(pinned, { ...pinned, tree: "t2" })).toThrow(/tree changed/);
    expect(() => assertPinnedUnchanged(pinned, { ...pinned, destination: undefined })).toThrow(
      /destination changed/,
    );
  });

  it("G-1725: owner profile, lock and policy are re-checked right before publishing", () => {
    const { live, recheck } = setup();
    live.profile = "household";
    expect(() => recheck()).toThrow(/owner profile changed/);
  });

  it("G-1682: elevated authority ends at the next step when the switch, Lockdown or account mark changes", () => {
    const ok = { switchOn: true, lockdown: false, accountMarked: true, touchedOtherProgram: false };
    for (const change of [
      { switchOn: false },
      { lockdown: true },
      { accountMarked: false },
      { touchedOtherProgram: true },
    ]) {
      const chain = new ElevatedChain();
      expect(chain.step(ok)).toBe(true);
      expect(chain.step({ ...ok, ...change })).toBe(false);
      expect(chain.step(ok)).toBe(false);
    }
  });

  it("G-1610: an open stream ends when the profile changes or the scope is gone", () => {
    let profile = "owner";
    let scoped = true;
    const guard = makeStreamGuard({
      profileId: "owner",
      currentProfileId: () => profile,
      hasScope: () => scoped,
    });
    expect(guard()).toBe("continue");
    profile = "guest";
    expect(guard()).toBe("end");
    profile = "owner";
    expect(guard()).toBe("end");
    const second = makeStreamGuard({
      profileId: "owner",
      currentProfileId: () => "owner",
      hasScope: () => scoped,
    });
    scoped = false;
    expect(second()).toBe("end");
  });

  it("G-1669: a stale failure completion does not override a newer success", () => {
    const log = new OrderedOutcomeLog<"ok" | "failed">();
    expect(log.record("job", 2, "ok")).toBe(true);
    expect(log.record("job", 1, "failed")).toBe(false);
    expect(log.get("job")).toEqual({ sequence: 2, outcome: "ok" });
    expect(log.record("job", 3, "failed")).toBe(true);
    expect(log.record("job", 2, "ok")).toBe(false);
    expect(log.get("job")?.outcome).toBe("failed");
  });

  it("G-1670: a stale lease claimant cannot act on the replacement claim", () => {
    const leases = new FencedLeaseTable();
    const first = leases.claim("nightly", "worker-a", 1000, 0);
    expect(first).toBeDefined();
    expect(leases.claim("nightly", "worker-b", 1000, 500)).toBeUndefined();
    const replacement = leases.claim("nightly", "worker-b", 1000, 1500);
    expect(replacement?.token).toBeGreaterThan(first?.token ?? Infinity);
    expect(leases.mayAct("nightly", first?.token ?? 0, 1600)).toBe(false);
    expect(leases.release("nightly", first?.token ?? 0)).toBe(false);
    expect(leases.mayAct("nightly", replacement?.token ?? 0, 1600)).toBe(true);
  });

  it("G-1723: sign-ins use only the pinned https endpoint and refuse redirects", () => {
    const pinnedOrigins = ["https://github.com"];
    const ok = {
      url: "https://github.com/login/device/code",
      pinnedOrigins,
      redirected: false,
      status: 200,
    };
    expect(() => assertPinnedSignInResponse(ok)).not.toThrow();
    expect(() => assertPinnedSignInResponse({ ...ok, url: "http://github.com/login" })).toThrow();
    expect(() =>
      assertPinnedSignInResponse({ ...ok, url: "https://evil.example/login" }),
    ).toThrow();
    expect(() => assertPinnedSignInResponse({ ...ok, redirected: true })).toThrow(/redirect/);
    expect(() => assertPinnedSignInResponse({ ...ok, status: 302 })).toThrow(/redirect/);
  });

  it("G-1723: the sign-in poll re-checks owner, profile and lock after every await", async () => {
    const { live, recheck } = setup();
    const poll = afterAwait(
      Promise.resolve().then(() => {
        live.locked = true;
        return "token";
      }),
      recheck,
    );
    await expect(poll).rejects.toSatisfy(isStaleAuthorityError);
  });

  it("G-1453: webhook failure counters ignore results that arrive out of order", () => {
    const counter = new OrderedFailureCounter();
    counter.record(1, false);
    counter.record(3, true);
    expect(counter.record(2, false)).toBe(0);
    expect(counter.record(4, false)).toBe(1);
    expect(counter.record(5, false)).toBe(2);
    expect(counter.count).toBe(2);
  });
});
