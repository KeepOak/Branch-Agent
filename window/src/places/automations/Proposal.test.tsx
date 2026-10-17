// @vitest-environment jsdom
import { useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import type { Level } from "../../places-nav/level";
import type { ChannelsStatus } from "../settings/set1/chatapps-data";
import { addParams, draftFromJob, draftFromWords, deliveryFor, isChatDelivery, type Draft } from "./draft";
import { Proposal, chatAppChoices, type Trunk } from "./Proposal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TELEGRAM: ChannelsStatus = {
  channelOrder: ["telegram"],
  channelLabels: { telegram: "Telegram" },
  channelAccounts: { telegram: [{ accountId: "default", name: "Taofik", configured: true, running: true, connected: true }] },
  channels: { telegram: { configured: true, running: true, connected: true } },
};
const EMPTY: ChannelsStatus = { channelOrder: [], channelAccounts: {}, channels: {} };
const trunk: Trunk = { id: "main", name: "Sapling" };

let root: Root | null = null, host: HTMLDivElement, latest: Draft | null = null;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; latest = null; document.body.innerHTML = ""; });

function draftOf(patch: Partial<Draft> = {}): Draft {
  return { ...draftFromWords("every day at 9, check prices", "main"), ...patch };
}

function Card({ level, status, start, engine }: { level: Level; status?: ChannelsStatus; start?: Draft; engine?: WindowEngine }) {
  const [draft, setDraft] = useState<Draft>(start ?? draftOf());
  latest = draft;
  return <Proposal draft={draft} change={p => setDraft(d => ({ ...d, ...p }))} level={level} trunks={[trunk]} models={[]} busy={false} canWrite={true} error="" onCancel={() => {}} onConfirm={() => {}} channelsStatus={status} engine={engine} />;
}

async function mount(level: Level, status?: ChannelsStatus, start?: Draft, engine?: WindowEngine) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root!.render(<Card level={level} status={status} start={start} engine={engine} />); });
}

const option = (label: string) => [...host.querySelectorAll("option")].find(o => o.textContent === label) as HTMLOptionElement;
const select = (label: string) => host.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
async function choose(el: HTMLSelectElement, value: string) {
  await act(async () => { el.value = value; el.dispatchEvent(new Event("change", { bubbles: true })); });
}

describe("Proposal › Sends to › Chats in your chat apps", () => {
  it("disables Chats in your chat apps when no chat app is connected", async () => {
    await mount("regular", EMPTY);
    const chats = option("Chats in your chat apps");
    expect(chats.disabled).toBe(true);
    expect(chats.title).toBe("Connect a chat app in Settings › Chat apps first.");
    expect(host.querySelector("[aria-label='Chat app']")).toBeNull();
  });

  it("enables Chats in your chat apps when channels.status has a connected Telegram account", async () => {
    await mount("regular", TELEGRAM);
    const chats = option("Chats in your chat apps");
    expect(chats.disabled).toBe(false);
    expect(chats.value).toBe("chats");
    expect(chats.title).toBe("");
  });

  it("shows a chat-app picker and recipient without raw ids at Regular", async () => {
    await mount("regular", TELEGRAM, draftOf({ sendsTo: "chats", account: "default" }));
    const app = select("Chat app");
    expect(app).toBeTruthy();
    expect([...app.options].map(o => o.textContent)).toEqual(["Telegram · Taofik"]);
    expect([...app.options].every(o => !o.textContent?.includes("default") && !o.textContent?.includes("telegram"))).toBe(true);
    expect(host.querySelector("[aria-label='Chat-app account']")).toBeNull();
    expect((host.querySelector("[aria-label=Recipient]") as HTMLInputElement).className).not.toContain("au-mono");
  });

  it("shows account and recipient ids at Technical", async () => {
    await mount("technical", TELEGRAM, draftOf({ sendsTo: "chats", account: "default", recipient: "+15551212" }));
    expect(select("Chat app").selectedOptions[0].textContent).toBe("Telegram · default");
    expect((host.querySelector("[aria-label='Chat-app account']") as HTMLInputElement).value).toBe("default");
    expect((host.querySelector("[aria-label=Recipient]") as HTMLInputElement).value).toBe("+15551212");
  });

  it("choosing chats and a recipient builds the same delivery the Technical fields produce", async () => {
    await mount("regular", TELEGRAM);
    await choose(select("Sends to"), "chats");
    expect(latest?.sendsTo).toBe("chats");
    expect(latest?.account).toBe("default");
    await act(async () => {
      const recpt = host.querySelector("[aria-label=Recipient]") as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(recpt, "@me");
      recpt.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(latest?.recipient).toBe("@me");
    const technical = draftOf({ sendsTo: "conversation", account: "default", recipient: "@me" });
    expect(deliveryFor(latest!)).toEqual(deliveryFor(technical));
    expect(addParams(latest!).delivery).toEqual({ mode: "announce", to: "@me", accountId: "default" });
    expect(addParams(latest!).delivery).toEqual(addParams(technical).delivery);
  });

  it("editing a job that already sends to a chat app pre-selects it", async () => {
    const job = {
      id: "a", name: "Morning brief", agentId: "main", configRevision: "r-a",
      schedule: { kind: "cron", expr: "0 9 * * *" }, payload: { kind: "agentTurn", message: "brief" },
      delivery: { mode: "announce", accountId: "default", to: "@me" },
    };
    const d = draftFromJob(job, "edit");
    expect(d.sendsTo).toBe("chats");
    expect(d.account).toBe("default");
    expect(d.recipient).toBe("@me");
    await mount("regular", TELEGRAM, d);
    expect(select("Sends to").value).toBe("chats");
    expect(select("Chat app").value).toBe("telegram:default");
  });
});

describe("chat delivery drafts", () => {
  it("treats announce+account as a chat-app send and keeps the Technical delivery shape", () => {
    expect(isChatDelivery({ mode: "announce", accountId: "default" })).toBe(true);
    expect(isChatDelivery({ mode: "announce", channel: "telegram" })).toBe(true);
    expect(isChatDelivery({ mode: "announce" })).toBe(false);
    expect(isChatDelivery({ mode: "announce", channel: "last" })).toBe(false);
    expect(isChatDelivery({ mode: "webhook", to: "https://example.com" })).toBe(false);
    const d = draftFromWords("every day at 9, check prices", "main");
    expect(addParams({ ...d, sendsTo: "chats", account: "default", recipient: "@me" }).delivery).toEqual(
      addParams({ ...d, sendsTo: "conversation", account: "default", recipient: "@me" }).delivery,
    );
    expect(chatAppChoices(TELEGRAM, false).map(c => c.label)).toEqual(["Telegram · Taofik"]);
    expect(chatAppChoices(EMPTY, false)).toEqual([]);
  });
});

describe("Proposal loads channels.status from the engine", () => {
  it("enables the option after channels.status reports a connected account", async () => {
    const request = vi.fn(async (method: string) => method === "channels.status" ? TELEGRAM : {});
    const engine = { request, onEvent: () => () => {}, sessionKey: null, scopes: ["operator.admin"] } as unknown as WindowEngine;
    await mount("regular", undefined, undefined, engine);
    await act(async () => { await Promise.resolve(); });
    expect(request).toHaveBeenCalledWith("channels.status", { probe: false });
    expect(option("Chats in your chat apps").disabled).toBe(false);
  });
});
