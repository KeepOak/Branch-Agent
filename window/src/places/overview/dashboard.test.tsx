// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { OverviewPlace } from "./index";
import { githubLink, connectorLinked } from "./links";
import { readLayout } from "./Dashboard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("../../face/Face", () => ({ Face: ({ label }: { label?: string }) => <span role="img" aria-label={label} /> }));
vi.mock("../../screens/chat/examples-greeting", () => ({ useFirstName: () => "Taofik" }));

const FX: Record<string, unknown> = {
  "config.get": { hash: "h1", valid: true, config: {} },
  "sessions.list": { sessions: [] },
  health: { ok: true },
  "system.info": {},
  "users.list": { profiles: [] },
  "system-presence": [],
  "agents.list": { defaultId: "main", mainKey: "main", agents: [{ id: "main", identity: { name: "Sapling" } }] },
  "backup.status": {},
  "update.status": {},
  "audit.list": { events: [] },
  "sessions.usage": {},
  "tools.github.status": { agentId: "main", selectedScope: "system", selected: { scope: "system", configured: true, identity: null }, effective: { credentialState: "available", account: { login: "taofik" } } },
  "chat.send": {},
};

let root: Root | undefined;
beforeEach(() => { localStorage.clear(); });
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; document.body.innerHTML = ""; localStorage.clear(); });

async function render(overrides: Record<string, unknown> = {}, sessionKey: string | null = null) {
  const request = vi.fn(async (method: string, params?: unknown) => {
    if (!(method in overrides)) return FX[method] ?? {};
    const value = overrides[method];
    return typeof value === "function" ? (value as (p: unknown) => unknown)(params) : value;
  });
  const engine = { request, sessionKey, scopes: ["operator.admin"], onEvent: () => () => undefined } as unknown as WindowEngine;
  const openConversation = vi.fn(), openSettings = vi.fn(), openPlace = vi.fn();
  const host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => root!.render(<OverviewPlace engine={engine} facts={{ running: 0, waiting: 0 }} openConversation={openConversation} openPlace={openPlace} openSettings={openSettings} level="regular" />));
  for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
  return { host, request, openConversation, openSettings };
}
const cards = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>("[data-w]")].map(el => el.getAttribute("data-w"));
const button = (host: HTMLElement, label: string) => [...host.querySelectorAll("button")].find(b => b.getAttribute("aria-label") === label || b.textContent?.trim() === label);
const click = (el: HTMLElement | undefined) => act(async () => el?.click());

describe("Overview as approved (P34)", () => {
  it("draws the hero, the range and account chips, and the cards in the preview's order", async () => {
    const { host } = await render();
    expect(host.querySelector<HTMLInputElement>('input[placeholder="Ask anything, or describe a change…"]')).not.toBeNull();
    expect(host.querySelector(".p34-to")!.textContent).toContain("Goes to Sapling, your default Trunk.");
    expect(host.querySelector(".p34-head h1")!.textContent).toBe("Overview");
    expect([...host.querySelectorAll<HTMLButtonElement>(".p34-seg button")].map(b => b.textContent)).toEqual(["Today", "This week", "This month", "This year"]);
    expect(host.querySelector<HTMLButtonElement>('.p34-seg button[aria-pressed="true"]')!.textContent).toBe("This week");
    expect([...host.querySelectorAll<HTMLButtonElement>(".p34-src .p34-chips button")].map(b => b.textContent)).toEqual(["All accounts", "GitHub", "Gmail", "Branch"]);
    expect(cards(host)).toEqual(["github", "gmail", "branch", "calendar", "drive"]);
    expect(button(host, "Add a widget")).toBeTruthy();
  });

  it("puts Finish setting up under the hero, not above the page", async () => {
    const { host } = await render();
    const children = [...host.querySelector(".p34-place")!.children];
    const hero = children.findIndex(el => el.classList.contains("p34-hero"));
    expect(hero).toBeGreaterThanOrEqual(0);
    expect(children[hero + 1]!.textContent).toContain("Finish setting up");
    expect(children.findIndex(el => el.classList.contains("p34-head"))).toBeGreaterThan(hero + 1);
  });

  it("shows GitHub linked with its account, and Gmail, Calendar and Drive as Coming when not linked", async () => {
    const { host } = await render();
    const github = host.querySelector<HTMLElement>('[data-w="github"]')!;
    expect(github.textContent).toContain("@taofik");
    expect(github.textContent).toContain("Pull requests opened");
    expect(github.textContent).toContain("Needs your attention");
    const gmail = host.querySelector<HTMLElement>('[data-w="gmail"]')!;
    expect(gmail.textContent).toContain("Gmail isn’t linked yet.");
    expect(gmail.textContent).toContain("Link Gmail");
    for (const id of ["calendar", "drive"]) {
      const card = host.querySelector<HTMLElement>(`[data-w="${id}"]`)!;
      expect(card.textContent).toContain("Coming: link it and this card shows what changed and what needs you.");
      expect(card.textContent).toContain("Coming");
    }
  });

  it("lists the Gmail card as linked when the engine has a Gmail connector", async () => {
    const { host } = await render({ "config.get": { hash: "h1", valid: true, config: { mcp: { servers: { gmail: { command: "gmail-mcp" } } } } } });
    expect(host.querySelector<HTMLElement>('[data-w="gmail"]')!.textContent).toContain("Unread");
  });

  it("keeps the old tiles inside the Branch card", async () => {
    const { host } = await render();
    const branch = host.querySelector<HTMLElement>('[data-w="branch"]')!;
    expect(branch.querySelector(".p34-old .ov-grid")).not.toBeNull();
    expect(branch.textContent).toContain("Health");
    expect(branch.textContent).toContain("Who is using Branch");
    expect(branch.textContent).toContain("Accounts & usage");
  });

  it("moves a card down and up, and keeps the order on this computer", async () => {
    const { host } = await render();
    await click(button(host, "Move GitHub down"));
    expect(cards(host).slice(0, 2)).toEqual(["gmail", "github"]);
    expect(JSON.parse(localStorage.getItem("branch-p34-ov")!).order.slice(0, 2)).toEqual(["gmail", "github"]);
    await click(button(host, "Move GitHub up"));
    expect(cards(host).slice(0, 2)).toEqual(["github", "gmail"]);
  });

  it("hides a card with Hide, says how to bring it back, and shows it again from Add a widget", async () => {
    const { host } = await render();
    await click(button(host, "Hide GitHub"));
    expect(cards(host)).not.toContain("github");
    expect(JSON.parse(localStorage.getItem("branch-p34-ov")!).hidden).toEqual(["github"]);
    await click(button(host, "Add a widget"));
    const item = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]')].find(b => b.textContent?.startsWith("GitHub"))!;
    expect(item.getAttribute("aria-checked")).toBe("false");
    expect(item.textContent).toContain("Add");
    await click(item);
    expect(cards(host)).toContain("github");
  });

  it("the Add a widget menu shows each widget as Shown, Add, Link first or Coming, as the preview does", async () => {
    const { host, openSettings } = await render();
    await click(button(host, "Hide Gmail"));
    await click(button(host, "Add a widget"));
    const items = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]')];
    expect(items.find(b => b.textContent?.startsWith("Google Calendar"))!.textContent).toContain("Shown");
    expect(items.find(b => b.textContent?.startsWith("Google Drive"))!.textContent).toContain("Shown");
    expect(items.find(b => b.textContent?.startsWith("Gmail"))!.textContent).toContain("Link first");
    await click(items.find(b => b.textContent?.startsWith("Gmail")));
    expect(openSettings).toHaveBeenCalledWith("accounts");
  });

  it("sends the hero's message to the default Trunk's main conversation and opens it", async () => {
    const { host, request, openConversation } = await render();
    const input = host.querySelector<HTMLInputElement>(".p34-ask input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Plan my week");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { host.querySelector(".p34-ask")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    for (let i = 0; i < 3; i++) await act(async () => { await Promise.resolve(); });
    expect(request).toHaveBeenCalledWith("chat.send", expect.objectContaining({ sessionKey: "agent:main:main", message: "Plan my week" }));
    expect(openConversation).toHaveBeenCalledWith("agent:main:main");
  });
});

describe("Overview hero", () => {
  it("names the default Trunk's real model and effort in the chip, and has Change background as Coming", async () => {
    const { host } = await render({
      "agents.list": { defaultId: "main", mainKey: "main", agents: [{ id: "main", identity: { name: "Sapling" }, model: { primary: "openai/gpt-6.1-sol" } }] },
      "models.list": { models: [{ id: "gpt-6.1-sol", provider: "openai", name: "GPT-6.1 Sol", available: true }] },
      "sessions.list": { sessions: [], defaults: { thinkingDefault: "medium" } },
    }, "agent:main:main");
    expect(host.querySelector(".p34-chip")?.textContent).toBe("GPT-6.1 Sol · Medium");
    expect(host.querySelector<HTMLButtonElement>(".p34-bg")?.textContent).toBe("Change background");
    expect(host.querySelector<HTMLButtonElement>(".p34-bg")?.disabled).toBe(true);
  });
});

describe("Overview links and layout", () => {
  it("reads a GitHub account only when its connection is available and has a login", () => {
    expect(githubLink({ effective: { credentialState: "available", account: { login: "taofik" } } })).toEqual({ linked: true, login: "taofik" });
    expect(githubLink({ effective: { credentialState: "unverified", account: { login: "taofik" } } })).toEqual({ linked: false, login: "taofik" });
    expect(githubLink({ effective: { credentialState: "available", account: null } })).toEqual({ linked: false, login: "" });
    expect(githubLink(undefined)).toEqual({ linked: false, login: "" });
  });

  it("finds a connector by name among the enabled servers in config", () => {
    expect(connectorLinked({ config: { mcp: { servers: { gmail: {} } } } }, /gmail/i)).toBe(true);
    expect(connectorLinked({ config: { mcp: { servers: { gmail: { enabled: false } } } } }, /gmail/i)).toBe(false);
    expect(connectorLinked({ config: {} }, /drive/i)).toBe(false);
  });

  it("keeps the default order when nothing is saved, and adds widgets a saved layout leaves out", () => {
    expect(readLayout(null)).toEqual({ order: ["github", "gmail", "branch", "calendar", "drive"], hidden: [] });
    expect(readLayout(JSON.stringify({ order: ["branch", "github"], hidden: ["drive", "nonsense"] }))).toEqual({ order: ["branch", "github", "gmail", "calendar", "drive"], hidden: ["drive"] });
    expect(readLayout("not json")).toEqual({ order: ["github", "gmail", "branch", "calendar", "drive"], hidden: [] });
  });
});

const EFFECTIVE_BOTH = {
  groups: [{ id: "mcp", tools: [
    { id: "github__search", mcpServer: "github", mcpToolName: "search_pull_requests" },
    { id: "gmail__search", mcpServer: "gmail", mcpToolName: "search_messages" },
  ] }],
};
function live(query: string): unknown {
  if (query.includes("review-requested")) return { items: [{ title: "Billing page copy", number: 212, repository: { full_name: "keepoak/site" } }] };
  if (query.includes("mentions")) return { items: [] };
  if (query.includes("merged")) return { total_count: 3 };
  if (query.includes("is:pr author")) return { total_count: 5 };
  if (query.includes("reviewed-by")) return { total_count: 9 };
  if (query === "is:unread") return { resultSizeEstimate: 23 };
  if (query.startsWith("is:unread in:inbox")) return { messages: [{ from: "Dana Okafor", subject: "August numbers" }] };
  if (query.startsWith("in:inbox")) return { messages: [{ from: "Dana Okafor" }] };
  return { resultSizeEstimate: 4 };
}

describe("Overview live connector data", () => {
  it("shows the GitHub numbers and attention rows the connector returns, and Ask Sapling sends to the default Trunk", async () => {
    const { host, request } = await render({
      "tools.effective": EFFECTIVE_BOTH,
      "tools.invoke": (params: unknown) => ({ ok: true, output: live(String((params as { args: { query: string } }).args.query)) }),
    }, "agent:main:main");
    for (let i = 0; i < 3; i++) await act(async () => { await Promise.resolve(); });
    const github = host.querySelector<HTMLElement>('[data-w="github"]')!;
    expect(github.textContent).toContain("Pull requests opened");
    const stat = (label: string) => [...github.querySelectorAll<HTMLElement>(".p34-stat")].find(el => el.querySelector("small")?.textContent === label)!;
    expect(stat("Pull requests opened").querySelector("b")?.textContent).toBe("5");
    expect(stat("Pull requests merged").querySelector("b")?.textContent).toBe("3");
    expect(stat("Reviews").querySelector("b")?.textContent).toBe("9");
    expect(stat("Contributions").textContent).toContain("Coming");
    expect([...github.querySelectorAll(".p34-chips button")].map(b => b.textContent)).toEqual(["All repositories", "keepoak/site"]);
    const ask = [...github.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "Ask Sapling")!;
    await act(async () => ask.click());
    for (let i = 0; i < 3; i++) await act(async () => { await Promise.resolve(); });
    expect(request).toHaveBeenCalledWith("chat.send", expect.objectContaining({ sessionKey: "agent:main:main", message: "Review requested: Billing page copy" }));
  });

  it("shows the Gmail numbers, the mail that needs a reply, and Draft a reply sends to the default Trunk", async () => {
    const { host, request } = await render({
      "config.get": { hash: "h1", valid: true, config: { mcp: { servers: { gmail: { command: "gmail-mcp" } } } } },
      "tools.effective": EFFECTIVE_BOTH,
      "tools.invoke": (params: unknown) => ({ ok: true, output: live(String((params as { args: { query: string } }).args.query)) }),
    }, "agent:main:main");
    for (let i = 0; i < 3; i++) await act(async () => { await Promise.resolve(); });
    const gmail = host.querySelector<HTMLElement>('[data-w="gmail"]')!;
    const stat = (label: string) => [...gmail.querySelectorAll<HTMLElement>(".p34-stat")].find(el => el.querySelector("small")?.textContent === label)!;
    expect(stat("Unread").querySelector("b")?.textContent).toBe("23");
    expect(stat("Important").querySelector("b")?.textContent).toBe("4");
    expect(gmail.textContent).toContain("Dana Okafor");
    const draft = [...gmail.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "Draft a reply")!;
    await act(async () => draft.click());
    for (let i = 0; i < 3; i++) await act(async () => { await Promise.resolve(); });
    expect(request).toHaveBeenCalledWith("chat.send", expect.objectContaining({ message: "Draft a reply to Dana Okafor about “August numbers”" }));
  });

  it("says Coming only on the tiles it cannot read, when the connector offers no search tool", async () => {
    const { host } = await render({ "tools.effective": { groups: [] } }, "agent:main:main");
    const github = host.querySelector<HTMLElement>('[data-w="github"]')!;
    expect(github.querySelectorAll(".p34-stat .pill").length).toBeGreaterThanOrEqual(4);
    expect(github.textContent).not.toContain("Linked. A card like the others");
  });
});
