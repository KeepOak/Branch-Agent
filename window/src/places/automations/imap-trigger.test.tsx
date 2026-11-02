// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { EmailTrigger } from "./EmailTrigger";
import { connectedMailboxes, imapTriggerPatch, triggerSummary, validateImapTrigger } from "./imap-trigger";
import { TriggersTab } from "./Triggers";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const storePassword = { source: "store", provider: "default", id: "__BRANCH_REDACTED__" };
const snapshot = {
  hash: "h",
  config: {
    plugins: {
      entries: {
        imap: {
          config: {
            accounts: {
              personal: {
                host: "imap.example.com",
                user: "reader@example.com",
                password: storePassword,
                mailbox: "INBOX",
                allowedSenders: ["trusted@example.com"],
                agentId: "main",
                match: "invoice",
              },
              relay: {
                host: "imap.example.com",
                user: "relay@example.com",
                password: { source: "env", provider: "default", id: "IMAP_PASSWORD" },
                agentId: "main",
              },
              plain: {
                host: "imap.example.com",
                user: "plain@example.com",
                password: "secret-value",
                agentId: "main",
              },
            },
          },
        },
      },
    },
  },
};

let root: Root | null = null;
let host: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  document.body.innerHTML = "";
});

async function mount(request: WindowEngine["request"], scopes: string[] = ["operator.admin"]) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const engine = { request, onEvent: () => () => {}, sessionKey: null, scopes } as unknown as WindowEngine;
  await act(async () => {
    root!.render(<EmailTrigger engine={engine} trunks={[{ id: "sapling", name: "Sapling" }]} canWrite={scopes.includes("operator.admin")} />);
  });
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}

const setValue = async (label: string, value: string) => {
  const input = host.querySelector(`[aria-label='${label}']`) as HTMLInputElement | HTMLSelectElement;
  await act(async () => {
    const proto = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("change", { bubbles: true }));
    if (!(input instanceof HTMLSelectElement)) input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

describe("IMAP mailbox trigger", () => {
  it("validates the trigger and never copies a password into the patch", () => {
    const mailboxes = connectedMailboxes(snapshot);
    expect(mailboxes.map(box => box.id)).toEqual(["personal", "relay"]);
    expect(JSON.stringify(mailboxes)).not.toContain("secret-value");
    expect(JSON.stringify(mailboxes)).not.toContain("password");
    expect(JSON.stringify(mailboxes)).not.toContain("__BRANCH_REDACTED__");
    expect(triggerSummary(mailboxes[0])).toBe("Folder INBOX. Only when the sender or subject contains “invoice”.");
    const trigger = validateImapTrigger({ accountId: "personal", folder: " Receipts ", filter: " invoice ", agentId: "sapling" }, mailboxes);
    const patch = imapTriggerPatch(trigger);
    expect(patch).toEqual({
      plugins: { entries: { imap: { enabled: true, config: { accounts: { personal: { mailbox: "Receipts", match: "invoice", agentId: "sapling" } } } } } },
    });
    expect(JSON.stringify(patch)).not.toContain("password");
    expect(JSON.stringify(patch)).not.toContain("secret");
    expect(() => validateImapTrigger({ accountId: "missing", folder: "INBOX", filter: "", agentId: "sapling" }, mailboxes)).toThrow("already connected");
    expect(() => validateImapTrigger({ accountId: "personal", folder: " ", filter: "", agentId: "sapling" }, mailboxes)).toThrow("Choose a folder");
    expect(() => validateImapTrigger({ accountId: "personal", folder: "INBOX", filter: "x".repeat(201), agentId: "sapling" }, mailboxes)).toThrow("shorter filter");
    expect(() => validateImapTrigger({ accountId: "personal", folder: "INBOX", filter: "", agentId: " " }, mailboxes)).toThrow("Choose who does it");
    expect(connectedMailboxes({ config: {} })).toEqual([]);
  });

  it("saves a connected mailbox, folder and filter", async () => {
    const request = vi.fn(async (method: string) => (method === "config.get" ? snapshot : { ok: true }));
    await mount(request as unknown as WindowEngine["request"]);
    expect(host.textContent).toContain("When an email arrives in...");
    expect(host.textContent).toContain("reader@example.com");
    expect(host.textContent).toContain("relay@example.com");
    expect(host.textContent).not.toContain("plain@example.com");
    await setValue("Mailbox", "personal");
    expect(host.textContent).not.toContain("secret-value");
    expect(host.querySelector(".au-pill")).toBeNull();
    await setValue("Folder", "Receipts");
    await setValue("Filter", "invoice");
    await setValue("Who does it", "sapling");
    await act(async () => { (host.querySelector("button.btn.pri") as HTMLButtonElement).click(); });
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(request).toHaveBeenCalledWith("config.patch", {
      baseHash: "h",
      raw: JSON.stringify({
        plugins: { entries: { imap: { enabled: true, config: { accounts: { personal: { mailbox: "Receipts", match: "invoice", agentId: "sapling" } } } } } },
      }),
    });
  });

  it("stays off until a mailbox is connected", async () => {
    const request = vi.fn(async () => ({ hash: "h", config: {} }));
    await mount(request as unknown as WindowEngine["request"]);
    const button = [...host.querySelectorAll("button")].find(item => item.textContent === "Turn on") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe("Connect a mailbox first.");
  });

  it("is on the Automations triggers tab", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "config.get") return { hash: "h", config: {} };
      if (method === "cron.list") return { jobs: [], hasMore: false };
      if (method === "agents.list") return { defaultId: "main", agents: [] };
      return {};
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<TriggersTab engine={{ request: request as unknown as WindowEngine["request"], onEvent: () => () => {}, sessionKey: null, scopes: ["operator.admin"] }} level="regular" openConversation={() => {}} />);
    });
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(host.textContent).toContain("When an email arrives in...");
    expect(host.textContent).not.toContain("—");
  });
});
