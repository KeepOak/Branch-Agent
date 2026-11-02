// @vitest-environment jsdom
// Settings › Who uses Branch: the greyed "May" boxes on a person's card say why on a visible line, not only in a
// hover title. The owner's boxes were ticked and greyed with the reason only in a title (Verifier p1093-4, p1093-5).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { isComingWhy, isDevNote } from "../../../shell/shown-why";
import { KitProvider, type SaveReport } from "../kit";
import { PeoplePage } from "./people";
import { OWNER_MAY_WHY } from "./people-card";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const prof = (id: string, displayName: string | null, extra: Record<string, unknown> = {}) => ({
  id,
  displayName,
  avatarMime: null,
  mergedInto: null,
  createdAt: 1,
  updatedAt: 1,
  emails: [],
  githubIdentity: null,
  hasAvatar: false,
  ...extra,
});
const PROFILES = [
  prof("gateway-owner", "Alex"),
  prof("p-dana", "Dana Okafor", { emails: ["dana@example.test"] }),
];
const NOW = Date.now();
const PRESENCE = [
  {
    ts: NOW,
    ip: "127.0.0.1",
    deviceId: "dev-owner",
    user: { id: "gateway-owner" },
    scopes: ["operator.admin"],
    lastActivityAt: NOW,
  },
  {
    ts: NOW,
    ip: "10.0.0.7",
    host: "Dana’s MacBook",
    deviceId: "dev-dana",
    user: { id: "p-dana" },
    scopes: ["operator.read"],
    lastActivityAt: NOW,
  },
];

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
});

const report: SaveReport = { saving: vi.fn(), saved: vi.fn(), failed: vi.fn() };
async function render(level: 0 | 1 | 2) {
  const replies: Record<string, unknown> = {
    "users.list": { profiles: PROFILES },
    "users.self": { profile: PROFILES[0] },
    "system-presence": PRESENCE,
    "config.get": { hash: "h1", valid: true, config: {} },
    "device.pair.list": { pending: [], paired: [] },
    "agents.list": { agents: [] },
    "audit.list": { events: [] },
  };
  const request = vi.fn(async (method: string) => replies[method] ?? {});
  const engine = {
    request,
    onEvent: () => () => undefined,
    sessionKey: "s",
    scopes: ["operator.read", "operator.write", "operator.admin"],
  } as unknown as WindowEngine;
  const name = level === 2 ? "technical" : level === 1 ? "advanced" : "regular";
  await act(async () =>
    root.render(
      <KitProvider level={level} report={report} scope={null}>
        <PeoplePage
          page="people"
          title="Who uses Branch"
          level={name}
          engine={engine}
          openSettings={() => undefined}
        />
      </KitProvider>,
    ),
  );
  await act(async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
  });
}
const pick = async (name: string) =>
  act(async () =>
    [...host.querySelectorAll<HTMLButtonElement>(".pitem-pp")]
      .find((b) => b.textContent?.includes(name))!
      .click(),
  );
/** Each greyed box and the visible line its aria-describedby names. */
const boxes = () =>
  [...host.querySelectorAll<HTMLInputElement>(".may-pp input[type=checkbox]")].map((box) => {
    const ref = box.getAttribute("aria-describedby");
    const line = ref ? document.getElementById(ref) : null;
    return {
      disabled: box.disabled,
      why: line?.textContent?.trim() ?? "",
      shown: Boolean(line?.closest(".pcard-pp")) && !line?.hidden,
    };
  });

describe("Settings › Who uses Branch: greyed May boxes say why", () => {
  it.each([1, 2] as const)(
    "the owner's greyed boxes name a visible reason at level %s",
    async (level) => {
      await render(level);
      const all = boxes();
      expect(all).toHaveLength(7);
      for (const b of all) expect(b).toEqual({ disabled: true, why: OWNER_MAY_WHY, shown: true });
      expect(host.querySelector(".may-pp + p.hint")?.textContent).toBe(OWNER_MAY_WHY);
      // The reason no longer hides only in a hover title.
      expect(host.querySelectorAll(".may-pp label[title]")).toHaveLength(0);
    },
  );

  it("another person's greyed boxes point at the line that says why", async () => {
    await render(1);
    await pick("Dana");
    const all = boxes();
    expect(all).toHaveLength(7);
    for (const b of all)
      expect(b).toEqual({
        disabled: true,
        why: "What Dana’s devices were granted. Branch can’t tick these one by one yet.",
        shown: true,
      });
    expect(host.textContent).not.toContain(OWNER_MAY_WHY);
  });

  it("the owner's reason is plain copy that stays visible", () => {
    expect(isDevNote(OWNER_MAY_WHY)).toBe(false);
    expect(isComingWhy(OWNER_MAY_WHY)).toBe(false);
    expect(OWNER_MAY_WHY).not.toMatch(/\u2014|#\d/);
  });
});
