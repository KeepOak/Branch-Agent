// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { installUiEventLog, recordRequest, recordUiEvent, textIdOf, type UiEvent } from "./ui-log";

type Bridge = { diagnostics: { uiEvent: (event: UiEvent) => void } };

function withBridge(): UiEvent[] {
  const events: UiEvent[] = [];
  (window as unknown as { branchDesktop: Bridge }).branchDesktop = { diagnostics: { uiEvent: (event) => events.push(event) } };
  return events;
}

let uninstall: (() => void) | undefined;
afterEach(() => {
  uninstall?.();
  uninstall = undefined;
  delete (window as unknown as { branchDesktop?: Bridge }).branchDesktop;
  document.body.innerHTML = "";
});

describe("window UI event log", () => {
  it("records nothing and never throws outside the desktop app", () => {
    expect(() => recordUiEvent({ kind: "place.open", place: "inbox" })).not.toThrow();
  });

  it("sends events to the desktop bridge", () => {
    const events = withBridge();
    recordRequest("chat.send", false, "UNAVAILABLE", 42.4);
    expect(events).toEqual([{ kind: "request", method: "chat.send", ok: false, code: "UNAVAILABLE", ms: 42 }]);
  });

  it("names a message's wording the same way whatever its numbers are", () => {
    expect(textIdOf('Model "gpt-5" failed after 12 tries')).toBe(textIdOf('Model "claude" failed after 480 tries'));
    expect(textIdOf("Model failed")).not.toBe(textIdOf("Connection lost"));
  });

  it("records a click on a control by its accessible name", () => {
    const events = withBridge();
    document.body.innerHTML = '<button aria-label="Record a voice note">mic</button>';
    uninstall = installUiEventLog();
    (document.querySelector("button") as HTMLButtonElement).click();
    expect(events).toEqual([{ kind: "action", name: "Record a voice note", role: "button" }]);
  });

  it("does not record the labels of conversation rows or messages", () => {
    const events = withBridge();
    document.body.innerHTML =
      '<div data-testid="conversation-row"><button aria-label="Private thread title">open</button></div>' +
      '<div data-diag-private><button aria-label="Private text">copy</button></div>';
    uninstall = installUiEventLog();
    document.querySelectorAll("button").forEach((button) => button.click());
    expect(events).toEqual([]);
  });

  it("records dialogs opening and closing, and alerts by text id", async () => {
    const events = withBridge();
    uninstall = installUiEventLog();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-label", "Report a problem");
    document.body.appendChild(dialog);
    const alert = document.createElement("div");
    alert.setAttribute("role", "alert");
    alert.textContent = "Not supported";
    document.body.appendChild(alert);
    await Promise.resolve();
    dialog.remove();
    await Promise.resolve();
    expect(events).toEqual([
      { kind: "dialog.open", name: "Report a problem" },
      { kind: "alert", textId: textIdOf("Not supported") },
      { kind: "dialog.close", name: "Report a problem" },
    ]);
  });

  it("stops recording after uninstall", () => {
    const events = withBridge();
    document.body.innerHTML = '<button aria-label="Save">save</button>';
    const stop = installUiEventLog();
    stop();
    (document.querySelector("button") as HTMLButtonElement).click();
    expect(events).toEqual([]);
  });
});
