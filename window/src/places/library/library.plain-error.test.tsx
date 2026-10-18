// @vitest-environment jsdom
// Library screens: a raw engine failure reads as one plain sentence at Regular, exact words at Advanced.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { DocumentEditor } from "./document-editor";
import { DocumentsTab } from "./documents";
import { MadeTab } from "./made";
import { MeetingsTab } from "./meetings";
import { BringInDialog } from "./memory-bring-dialog";
import { FileDialog } from "./reader";
import { RingsRow } from "./rings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("../../face/Face", () => ({ Face: ({ label }: { label?: string }) => <span role="img" aria-label={label} /> }));

const RAW = /ECONNREFUSED|127\.0\.0\.1|unknown method|logbook\.status/;
const ENGINE = "connect ECONNREFUSED 127.0.0.1:19031";
const REACH = "Branch can’t reach its engine right now. It keeps trying, so try again in a moment.";
const TRUNKS = [{ id: "a", identity: { name: "Birch" } }];

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
});

function engineOf(request: (method: string) => Promise<unknown>, extra: Partial<WindowEngine> = {}) {
  return { request, onEvent: () => () => undefined, sessionKey: "s", agentId: "a", scopes: ["operator.admin"], ...extra } as unknown as WindowEngine;
}
const refuse = () => Promise.reject(new Error(ENGINE));
const settle = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); }); };
const alertText = () => [...host.querySelectorAll("[role='alert']")].map((n) => n.textContent ?? "").join("\n");
const shown = () => host.textContent ?? "";

describe("Library never shows a raw engine error at Regular", () => {
  it("names a failed documents list in a plain sentence", async () => {
    await act(async () => root.render(<DocumentsTab engine={engineOf(refuse)} level="regular" trunks={TRUNKS} />));
    await settle();
    expect(shown()).toContain(REACH);
    expect(shown()).not.toMatch(RAW);
  });

  it("names a failed document load in a plain sentence", async () => {
    await act(async () => root.render(
      <DocumentEditor engine={engineOf(refuse)} agentId="a" path="Documents/plan.md" level="regular" onClose={() => undefined} />,
    ));
    await settle();
    expect(alertText()).toBe(REACH);
    expect(alertText()).not.toMatch(RAW);
  });

  it("names a failed file reader load in a plain sentence", async () => {
    await act(async () => root.render(
      <FileDialog engine={engineOf(refuse)} agentId="a" path="plan.md" onClose={() => undefined} />,
    ));
    await settle();
    expect(alertText()).toBe(REACH);
    expect(alertText()).not.toMatch(RAW);
  });

  it("names a failed Made dashboards read in a plain sentence", async () => {
    await act(async () => root.render(
      <MadeTab engine={engineOf(refuse)} trunks={TRUNKS} openConversation={() => undefined} />,
    ));
    await settle();
    expect(shown()).toContain(REACH);
    expect(shown()).not.toMatch(RAW);
  });

  it("names a failed meetings list in a plain sentence", async () => {
    await act(async () => root.render(
      <MeetingsTab engine={engineOf(refuse)} level="regular" trunks={TRUNKS} />,
    ));
    await settle();
    expect(alertText()).toBe(REACH);
    expect(alertText()).not.toMatch(RAW);
  });

  it("names a failed overnight-cleanup diary in a plain sentence", async () => {
    await act(async () => root.render(
      <RingsRow engine={engineOf(refuse)} level="regular" scope="" status={{ data: { embedding: { ok: true }, rings: { enabled: true } } }} />,
    ));
    await settle();
    const open = [...host.querySelectorAll("button")].find((b) => b.textContent === "See what it changed")!;
    await act(async () => { open.click(); });
    await settle();
    expect(alertText()).toBe(REACH);
    expect(alertText()).not.toMatch(RAW);
  });

  it("names a failed bring-in plan in a plain sentence", async () => {
    await act(async () => root.render(
      <BringInDialog engine={engineOf(refuse)} agentId="a" onClose={() => undefined} />,
    ));
    await settle();
    expect(alertText()).toBe(REACH);
    expect(alertText()).not.toMatch(RAW);
  });

  it("keeps the exact words at Advanced", async () => {
    localStorage.setItem("branch.level", "advanced");
    await act(async () => root.render(
      <MeetingsTab engine={engineOf(refuse)} level="advanced" trunks={TRUNKS} />,
    ));
    await settle();
    expect(alertText()).toBe(ENGINE);
  });
});
