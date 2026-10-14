// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import type { Level } from "../../places-nav/level";
import { CustomizeR1Place } from "./r1-place";
import { requestCustomize } from "./r1-request";

vi.mock("../../face/Face", () => ({ Face: ({ label }: { label?: string }) => <span role="img" aria-label={label} /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BASE: Record<string, unknown> = {
  "agents.list": { defaultId: "main", mainKey: "main", agents: [{ id: "main", name: "Sapling" }] },
  "config.get": { hash: "h1", sourceConfig: {}, runtimeConfig: {} },
  "skills.status": { skills: [{ name: "web", skillKey: "web", description: "Search", disabled: false, eligible: true, requirements: {}, missing: {} }] },
  "skills.gardener.status": { lastSuccessAtMs: null, counts: { active: 1, stale: 0, archived: 0 }, skills: [] },
  "skills.proposals.list": { proposals: [] },
  "skills.library.list": { entries: [{ slug: "weekly", description: "Weekly review of the week", skillId: "s1" }, { slug: "old", removed: true }] },
  "plugins.list": { plugins: [] },
  "acpx.agents.list": { agents: [] },
  "tools.catalog": { groups: [] },
  "exec.approvals.get": { hash: "e1", file: { version: 1, agents: {} }, resolvedDefaults: { ask: "on-miss" } },
  "plugins.catalog.categories": { categories: [] },
  "plugins.catalog.browse": { items: [] },
  "seedbank.list": {},
};

let root: Root | null = null;
let host: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; document.body.innerHTML = ""; requestCustomize({}); });

async function open(level: Level = "regular", usePrompt?: (text: string) => void) {
  const request = vi.fn((method: string) => Promise.resolve(BASE[method] ?? { ok: true }));
  const engine: WindowEngine = { request: request as unknown as WindowEngine["request"], onEvent: () => () => {}, sessionKey: "agent:main:main", scopes: ["operator.admin"] };
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(<CustomizeR1Place engine={engine} facts={{ running: 0, waiting: 0 }} openConversation={() => {}} openPlace={() => {}} level={level} usePrompt={usePrompt} />); });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  return host;
}
const tabs = (scope: ParentNode) => [...scope.querySelectorAll("[role=tab]")].map(t => t.textContent?.trim());
const button = (text: string, scope: ParentNode = host) => [...scope.querySelectorAll("button")].find(b => b.textContent?.trim() === text);
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await act(async () => { await Promise.resolve(); }); };

describe("Customize (R1): the place", () => {
  it("has the Personal | Community switch and no Trunks or Chat apps tab", async () => {
    await open();
    expect(tabs(host)).toEqual(["Personal", "Community"]);
    expect(button("Get capabilities")).toBeUndefined();
  });

  it("lists the seven kinds, Prompts included, and opens Skills first", async () => {
    await open();
    expect([...host.querySelectorAll("[data-kind]")].map(k => k.getAttribute("data-kind"))).toEqual(["Connectors", "Skills", "Plugins", "Command-line tools", "Agents", "Toolsets", "Prompts"]);
    expect(host.querySelector("[data-kind][aria-current=true]")?.getAttribute("data-kind")).toBe("Skills");
  });

  it("opens the kind a request names", async () => {
    requestCustomize({ kind: "Toolsets" });
    await open();
    expect(host.querySelector("[data-kind][aria-current=true]")?.getAttribute("data-kind")).toBe("Toolsets");
  });

  it("opens Community when the Seedbank pill asks for it, and switches back to Personal", async () => {
    requestCustomize({ mode: "community" });
    await open();
    expect(host.querySelector(".sb")).not.toBeNull();
    await click(button("Personal", host));
    expect(host.querySelector(".sb")).toBeNull();
    expect(host.querySelector("[data-kind]")).not.toBeNull();
  });

  it("switches to Community while it is already open", async () => {
    await open();
    expect(host.querySelector(".sb")).toBeNull();
    await act(async () => { requestCustomize({ mode: "community" }); });
    expect(host.querySelector(".sb")).not.toBeNull();
  });

  it("lists saved prompts and Use drops the command into the composer", async () => {
    const usePrompt = vi.fn();
    await open("regular", usePrompt);
    await click(host.querySelector("[data-kind=Prompts]"));
    expect(host.querySelector("[data-testid=prompts]")?.textContent).toContain("/weekly");
    expect(host.querySelector("[data-testid=prompts]")?.textContent).not.toContain("/old");
    expect(host.textContent).toContain("1 saved");
    await click(button("Use", host));
    expect(usePrompt).toHaveBeenCalledWith("/weekly ");
  });

  it("hides a Coming control below Technical and tags it at Technical", async () => {
    await open("regular");
    expect(button("Look now")).toBeUndefined();
    await act(async () => { root!.unmount(); }); root = null; document.body.innerHTML = "";
    await open("technical");
    const look = button("Look now");
    expect(look?.getAttribute("data-coming")).toBe("Running the Gardener by hand comes in a later update.");
    expect(look?.getAttribute("aria-disabled")).toBe("true");
    expect(look?.title).toBe("Running the Gardener by hand comes in a later update.");
  });
});
