// @vitest-environment jsdom
// The question card's submit and skip failures: one plain sentence at Regular, exact words at Advanced.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DockQuestion } from "./QuestionCard";
import { parseRecord, type QuestionRecord } from "./questions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RAW = /ECONNREFUSED|127\.0\.0\.1|unknown method|logbook\.status/;
const ENGINE = "connect ECONNREFUSED 127.0.0.1:18789";
const PLAIN = "Branch can’t reach its engine right now. It keeps trying, so try again in a moment.";

const raw = {
  id: "q1", sessionKey: "agent:main:x", createdAtMs: 500, expiresAtMs: 9e12, status: "pending",
  questions: [{ questionId: "format", header: "Format", question: "Which format?", options: [{ label: "Brief" }, { label: "Report" }], isOther: true }],
};
const record = () => parseRecord(raw) as QuestionRecord;

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

const alertText = () => host.querySelector("[role='alert']")?.textContent ?? "";

describe("the question card never shows a raw engine error at Regular", () => {
  it("names a failed submit in a plain sentence", async () => {
    const resolve = vi.fn().mockRejectedValue(new Error(ENGINE));
    await act(async () => root.render(<DockQuestion record={record()} trunkName="Research" onResolve={resolve} />));
    await act(async () => host.querySelector<HTMLButtonElement>(".opt")!.click());
    expect(alertText()).toBe(PLAIN);
    expect(alertText()).not.toMatch(RAW);
  });

  it("names a failed skip in a plain sentence", async () => {
    const two = parseRecord({
      ...raw,
      questions: [raw.questions[0], { questionId: "when", header: "When", question: "When is it due?", options: [{ label: "Today" }, { label: "Friday" }] }],
    }) as QuestionRecord;
    const resolve = vi.fn().mockRejectedValue(new Error("unknown method: logbook.status"));
    await act(async () => root.render(<DockQuestion record={two} trunkName="Research" onResolve={resolve} />));
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>(".card-buttons button")].find((b) => b.textContent === "Skip")!.click());
    expect(alertText()).toBe("This part of Branch isn’t ready on this computer yet. Update Branch, then try again.");
    expect(alertText()).not.toMatch(RAW);
  });

  it("keeps the exact words at Advanced", async () => {
    localStorage.setItem("branch.level", "advanced");
    const resolve = vi.fn().mockRejectedValue(new Error(ENGINE));
    await act(async () => root.render(<DockQuestion record={record()} trunkName="Research" onResolve={resolve} />));
    await act(async () => host.querySelector<HTMLButtonElement>(".opt")!.click());
    expect(alertText()).toBe(ENGINE);
  });
});
