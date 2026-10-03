// @vitest-environment jsdom
// Answering an approval out loud in a call: only this conversation's unexpired request, only a decision it allows,
// once per request until its resolved event, and only a whole "yes" (dot's r2-approvals review cases, ported).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import type { ApprovalDetails } from "../thread/useEngineData";
import { VoiceScreen, spokenAnswer } from "./VoiceParts";

type Handlers = { onCaption: (role: string, text: string) => void };
const fake = vi.hoisted(() => ({ calls: [] as Handlers[] }));
vi.mock("./voice", () => ({
  Dictation: class {},
  voiceError: (e: unknown) => String(e),
  VoiceCall: class {
    voice = "";
    constructor(_e: unknown, on: Handlers) {
      fake.calls.push(on);
    }
    async start() {}
    async end() {}
    mute() {}
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
const matchMedia = () => ({ matches: false, media: "", addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() });
beforeEach(() => vi.stubGlobal("matchMedia", vi.fn(matchMedia)));
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
  localStorage.clear();
  fake.calls = [];
  vi.unstubAllGlobals();
});

const detail = (id: string, patch: Partial<ApprovalDetails> = {}): ApprovalDetails => ({
  id,
  plugin: true,
  title: "Send this synthetic note?",
  description: "To: Synthetic recipient\nSubject: Synthetic subject",
  sessionKey: "agent:main:main",
  allowedDecisions: ["allow-once", "deny"],
  expiresAtMs: Date.now() + 60_000,
  ...patch,
});

async function voice(d: ApprovalDetails, fail = false) {
  const request = vi.fn(async (method: string) => {
    if (method === "plugin.approval.list") return { items: [{ id: d.id, expiresAtMs: d.expiresAtMs, request: { ...d } }] };
    if (method === "exec.approval.list") return [];
    if (fail && method === "plugin.approval.resolve") throw new Error("synthetic failure");
    return {};
  });
  const engine = { sessionKey: "agent:main:main", request, onEvent: () => () => {}, scopes: [] } as unknown as WindowEngine;
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root!.render(<VoiceScreen engine={engine} name="Sapling" onClose={() => {}} />));
  return request;
}
const resolutions = (request: ReturnType<typeof vi.fn>) => request.mock.calls.filter((c) => String(c[0]).endsWith(".approval.resolve"));
const say = (text: string) => fake.calls[0].onCaption("user", text);

describe("voice approvals", () => {
  it("routes a supported current-conversation Yes to the plugin resolver only", async () => {
    const request = await voice(detail("p1"));
    await act(async () => say("yes"));
    expect(resolutions(request)).toEqual([["plugin.approval.resolve", { id: "p1", decision: "allow-once" }]]);
  });

  it("ignores another conversation's approval", async () => {
    const request = await voice(detail("p1", { sessionKey: "agent:main:other" }));
    expect(document.querySelector("[data-testid=voice-ask]")).toBeNull();
    await act(async () => say("yes"));
    expect(resolutions(request)).toEqual([]);
  });

  it("never offers or submits an expired approval", async () => {
    const request = await voice(detail("p1", { expiresAtMs: Date.now() - 1000 }));
    expect(document.querySelector("[data-testid=voice-ask]")).toBeNull();
    await act(async () => say("yes"));
    expect(resolutions(request)).toEqual([]);
  });

  it("never submits allow-once for a deny-only plugin request, and offers only No", async () => {
    const request = await voice(detail("p1", { allowedDecisions: ["deny"] }));
    await act(async () => say("yes"));
    expect(resolutions(request)).toEqual([]);
    expect([...document.querySelectorAll("[data-testid=voice-ask] button")].map((b) => b.textContent)).toEqual(["No"]);
  });

  it("duplicate captions do not submit the same approval twice before its resolved event", async () => {
    const request = await voice(detail("p1"));
    await act(async () => {
      say("yes");
      say("yes");
    });
    expect(resolutions(request)).toHaveLength(1);
  });

  it("a failed answer can be given again", async () => {
    const request = await voice(detail("p1"), true);
    await act(async () => say("yes"));
    await act(async () => say("yes"));
    expect(resolutions(request)).toHaveLength(2);
  });
});

describe("spoken answers", () => {
  it("an affirmative with a qualifier or refusal is not consent", () => {
    expect(spokenAnswer("yes but don't send it")).toBeNull();
    expect(spokenAnswer("yes but don’t send it")).toBeNull();
    expect(spokenAnswer("yeah, wait")).toBeNull();
    expect(spokenAnswer("okay so what is it")).toBeNull();
  });

  it("whole answers from the closed lists", () => {
    expect(spokenAnswer("Yes, go ahead.")).toBe("allow-once");
    expect(spokenAnswer("  Yep! ")).toBe("allow-once");
    expect(spokenAnswer("No thanks")).toBe("deny");
    expect(spokenAnswer("Don’t send it")).toBe("deny");
    expect(spokenAnswer("no")).toBe("deny");
  });
});
