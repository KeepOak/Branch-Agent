// @vitest-environment jsdom
// Settings › Customize's chips do what the approved preview's do (Private #1095, walkthrough B-069). The preview draws the
// same Customize component inline in Settings (preview.html PAGES.czP17, S.czHtmlP17(true)): a kind chip (czKindP17)
// opens that kind, with its head, its count, "＋ Add" and its own list; the "For:" faces (whoseD18) choose whose tools the
// kinds show; "＋ Get more … in Community →" (czMoreP17k) opens Customize in Community on that kind. Before this, a chip
// only changed one hint line, so the chips felt dead.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { peekCustomizeRequest, takeCustomizeRequest } from "../../../places/customize/r1-request";
import { forgetLookStore } from "../../../places/settings/set1/appearance-store";
import { SettingsFrame } from "../SettingsFrame";
import { R1_PAGES } from "./plugged";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); localStorage.clear(); forgetLookStore(); takeCustomizeRequest(); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; takeCustomizeRequest(); });

function engineOf() {
  const request = vi.fn(async (method: string) => {
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "agents.list") return { agents: [{ id: "main", identity: { name: "Sapling" } }], defaultId: "main", mainKey: "agent:main:main" };
    if (method === "contacts.outside.list") return { enabled: true, agents: [] };
    if (method === "skills.status") return { skills: [{ name: "brief", description: "Write a brief.", eligible: true, source: "workspace" }] };
    if (method === "plugins.list") return { plugins: [{ id: "voice", name: "Voice", enabled: true }] };
    return {};
  });
  return { engine: { request, onEvent: () => () => undefined, sessionKey: "s", scopes: ["operator.admin"] } as unknown as WindowEngine, request };
}
async function settle() { for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); }
async function mount(engine: WindowEngine) {
  localStorage.setItem("branch.level", "regular");
  await act(async () => root.render(<SettingsFrame engine={engine} page="customize" pages={R1_PAGES} />));
  await settle();
}
const hub = () => host.querySelector<HTMLElement>("[data-testid=customize-hub]")!;
const chip = (label: string) => [...hub().querySelectorAll<HTMLButtonElement>(".t9-nav .t9-kind")].find((b) => b.textContent?.startsWith(label))!;

/** The preview's six kinds in Settings, each with the head the preview draws for it (KINDS in czP17). */
const KINDS: [chip: string, kind: string, line: string][] = [
  ["Toolsets", "Toolsets", "Groups of tools a Trunk gets together."],
  ["Connectors", "Connectors", "Apps and data a Trunk can reach."],
  ["Skills", "Skills", "Step-by-step know-how a Trunk can follow."],
  ["Plugins", "Plugins", "Packs of skills, servers and tools."],
  ["Command-line tools", "Command-line tools", "Programs on this computer it may run."],
  ["Agents & specialists", "Agents", "Other assistants, helpers a Trunk calls in, and how they work together."],
];

it("each kind chip opens that kind's own list, with its head, count and ＋ Add, as the preview's czKindP17 does", async () => {
  await mount(engineOf().engine);
  for (const [label, kind, line] of KINDS) {
    await act(async () => chip(label).click());
    await settle();
    expect(chip(label).getAttribute("aria-current")).toBe("true");
    const list = hub().querySelector<HTMLElement>(`[data-kind-list="${kind}"]`);
    expect(list, `${label} opens its list`).not.toBeNull();
    expect(list!.querySelector(".cz-kindhead h2")?.textContent).toBe(label);
    expect(list!.querySelector(".cz-kindhead p")?.textContent).toBe(line);
    expect(list!.querySelector(".cz-kindhead .cz-count")?.textContent).toMatch(/\d+ of \d+ on/);
    expect(list!.querySelector(".cz-kindhead")?.textContent).toContain("＋ Add");
    expect(hub().querySelectorAll("[data-kind-list]")).toHaveLength(1);
  }
});

it("a kind's list is that kind's rows: Skills lists the engine's skills, Plugins its plugins", async () => {
  await mount(engineOf().engine);
  await act(async () => chip("Skills").click());
  await settle();
  expect(hub().querySelector("[data-kind-list=Skills]")?.textContent).toContain("brief");
  await act(async () => chip("Plugins").click());
  await settle();
  expect(hub().querySelector("[data-kind-list=Plugins]")?.textContent).toContain("Voice");
});

it("For: is the preview's faces row; a Trunk's face shows that Trunk's tools", async () => {
  const { engine, request } = engineOf();
  await mount(engine);
  const faces = [...hub().querySelectorAll<HTMLButtonElement>(".cz-for .cz-face")];
  expect(hub().querySelector(".cz-for-l")?.textContent).toBe("For:");
  expect(faces.map((b) => b.textContent)).toEqual(["All", "Sapling"]);
  expect(faces[0].getAttribute("aria-pressed")).toBe("true");
  await act(async () => faces[1].click());
  await settle();
  expect(hub().querySelectorAll<HTMLButtonElement>(".cz-for .cz-face")[1].getAttribute("aria-pressed")).toBe("true");
  expect(request).toHaveBeenCalledWith("skills.status", { agentId: "main" });
});

it("＋ Get more … in Community → opens Customize in Community on that kind, as the preview's czMoreP17k does", async () => {
  await mount(engineOf().engine);
  const places: unknown[] = [];
  const listen = (e: Event) => places.push((e as CustomEvent).detail);
  addEventListener("branch:navigate-place", listen);
  try {
    await act(async () => chip("Plugins").click());
    await settle();
    const more = hub().querySelector<HTMLButtonElement>("[data-kind-list=Plugins] .cz-get");
    expect(more?.textContent).toBe("＋ Get more plugins in Community →");
    await act(async () => more!.click());
    expect(peekCustomizeRequest()).toMatchObject({ mode: "community", community: "plugins" });
    expect(places).toEqual([{ place: "customize" }]);
  } finally { removeEventListener("branch:navigate-place", listen); }
});
