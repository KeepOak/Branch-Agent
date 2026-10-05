// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { currentModelRef } from "../composer/model";
import { UsagePopover } from "./StatusPopovers";
import { readLimits } from "./status-data";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("shows three ChatGPT accounts and refreshes on open and Check now", async () => {
  const status = { updatedAt: Date.now(), providers: ["ash", "elm", "oak"].map((name, index) => ({
    provider: "openai", displayName: "ChatGPT", authProfileId: `openai:${name}`,
    accountEmail: `${name}@example.test`, inUse: index === 0,
    windows: [{ label: "5 hours", usedPercent: 20 + index }],
  })) };
  const limits = readLimits(status);
  expect(limits.rows.map((row) => row.id)).toEqual(["openai:openai:ash", "openai:openai:elm", "openai:openai:oak"]);
  const request = vi.fn(async (method: string) => method === "usage.status" ? status : { totals: { totalCost: 0 } });
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(<UsagePopover above={{ left: 0, right: 300, top: 500, align: "left" }} onClose={() => {}} limits={limits} request={request as never} onOpenUsage={() => {}} />));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(host.textContent).toContain("ash@example.test");
  expect(host.textContent).toContain("elm@example.test");
  expect(host.textContent).toContain("oak@example.test");
  expect(host.textContent).toContain("used next");
  expect(request).toHaveBeenCalledWith("usage.status", { refresh: true });
  await act(async () => { (Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Check now") as HTMLButtonElement).click(); });
  expect(request.mock.calls.filter(([method]) => method === "usage.status")).toHaveLength(2);
  await act(async () => root.unmount());
  host.remove();
});

it("uses a session override, then the Trunk model, then the global default", () => {
  const defaults = { modelProvider: "openai", model: "gpt-6-astra" };
  expect(currentModelRef({}, defaults, "openai/gpt-6-sol")).toBe("openai/gpt-6-sol");
  expect(currentModelRef({ modelOverride: "gpt-6.1-sol", providerOverride: "openai" }, defaults, "openai/gpt-6-sol")).toBe("openai/gpt-6.1-sol");
  expect(currentModelRef({}, defaults)).toBe("openai/gpt-6-astra");
});
