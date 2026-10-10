import { describe, expect, it } from "vitest";
import type { Account, Provider } from "./accounts";
import { accountsOf } from "./accounts";
import { isPausedNow, orderAfterDrop, orderAfterMove, pauseEnd, pauseLabel, reorderedIds, usableCountFor } from "./accounts-order";

const PROVIDERS: Provider[] = [
  { provider: "openai", displayName: "OpenAI", status: "ok", profileOrder: ["openai:a", "openai:b", "openai:c"], profiles: [
    { profileId: "openai:a", type: "oauth", status: "ok" },
    { profileId: "openai:b", type: "oauth", status: "ok" },
    { profileId: "openai:c", type: "oauth", status: "ok" },
  ] },
  { provider: "anthropic", displayName: "Anthropic", status: "ok", profiles: [
    { profileId: "anthropic:x", type: "token", status: "ok" },
    { profileId: "anthropic:y", type: "token", status: "ok" },
  ] },
];
const ALL = accountsOf(PROVIDERS);
const byId = (id: string): Account => ALL.find((acc) => acc.a.profileId === id)!;
const openai = ["openai:a", "openai:b", "openai:c"];

describe("account order", () => {
  it("moves one place up and down, and never past the ends", () => {
    expect(orderAfterMove(byId("openai:b"), ALL, "down")).toEqual(["openai:a", "openai:c", "openai:b"]);
    expect(orderAfterMove(byId("openai:b"), ALL, "up")).toEqual(["openai:b", "openai:a", "openai:c"]);
    expect(orderAfterMove(byId("openai:a"), ALL, "up")).toEqual(openai);
    expect(orderAfterMove(byId("openai:c"), ALL, "down")).toEqual(openai);
  });

  it("moves to the top and to the bottom", () => {
    expect(orderAfterMove(byId("openai:c"), ALL, "top")).toEqual(["openai:c", "openai:a", "openai:b"]);
    expect(orderAfterMove(byId("openai:a"), ALL, "bottom")).toEqual(["openai:b", "openai:c", "openai:a"]);
  });

  it("drops a dragged account where it lands, within its provider only", () => {
    expect(orderAfterDrop(ALL, byId("openai:a").p, "openai:a", "openai:c")).toEqual(["openai:b", "openai:c", "openai:a"]);
    expect(orderAfterDrop(ALL, byId("openai:a").p, "openai:c", "openai:a")).toEqual(["openai:c", "openai:a", "openai:b"]);
  });

  it("keeps the list unchanged for an out-of-range or same-place move", () => {
    expect(reorderedIds(openai, 1, 1)).toEqual(openai);
    expect(reorderedIds(openai, 0, 9)).toEqual(openai);
    expect(reorderedIds(openai, -1, 0)).toEqual(openai);
  });

  it("counts only accounts that are not paused", () => {
    const now = Date.now();
    const paused = accountsOf([{ ...PROVIDERS[0], profiles: [
      { profileId: "openai:a", type: "oauth", status: "ok", paused: {} },
      { profileId: "openai:b", type: "oauth", status: "ok", paused: { until: now - 1 } },
      { profileId: "openai:c", type: "oauth", status: "ok" },
    ] }]);
    expect(usableCountFor(paused.find((x) => x.a.profileId === "openai:c")!, paused, now)).toBe(2);
  });
});

describe("account pauses", () => {
  const now = new Date(2026, 9, 9, 14, 30);

  it("ends an hour from now, or at the next local midnight", () => {
    expect(pauseEnd("hour", now)).toBe(now.getTime() + 60 * 60 * 1000);
    expect(pauseEnd("tomorrow", now)).toBe(new Date(2026, 9, 10, 0, 0).getTime());
  });

  it("has no end for until I turn it back on", () => {
    expect(pauseEnd("indefinite", now)).toBeUndefined();
  });

  it("is paused for an open pause, and for a timed pause until its end", () => {
    const at = now.getTime();
    expect(isPausedNow({}, at)).toBe(true);
    expect(isPausedNow({ until: at + 1000 }, at)).toBe(true);
    expect(isPausedNow({ until: at - 1000 }, at)).toBe(false);
    expect(isPausedNow(undefined, at)).toBe(false);
  });

  it("labels the pause for the badge line", () => {
    const at = now.getTime();
    expect(pauseLabel({}, at)).toBe("Paused until you turn it back on");
    expect(pauseLabel({ until: at + 1000 }, at)).toMatch(/^Paused until /);
    expect(pauseLabel(undefined, at)).toBe("");
  });
});
