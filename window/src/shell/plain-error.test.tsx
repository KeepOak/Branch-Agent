// @vitest-environment jsdom
// Private #1089: on Linux at Regular, toasts, banners and the line above the conversation showed an engine's raw words
// (`unknown method: logbook.status`, `connect ECONNREFUSED 127.0.0.1:18789`, CodexNotInstalledError, a stack, a file
// path). At Regular each reads as one plain sentence with a next step; Advanced and Technical keep the exact words.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Frame } from "../screens/frame/Frame";
import { clearBanner, currentBanner, raiseBanner } from "./Banner";
import { dismiss, getToasts, notify } from "./notify";
import { LOCK_BUSY, plainError, PLAIN_FAILURE, plainText } from "./plain-error";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RAW = /unknown method|unknown agent id|ECONNREFUSED|ENOENT|EACCES|[A-Z][a-z]+Error\b|INVALID_REQUEST|logbook\.status|127\.0\.0\.1|\/home\/|\bat run|:\d+:\d+|gateway closed/;
const SAMPLES = [
  "unknown method: logbook.status",
  'unknown agent id "main"',
  "connect ECONNREFUSED 127.0.0.1:18789",
  "gateway closed (1006): abnormal closure",
  'No API key found for provider "anthropic". Auth store: /home/alex/.branch/agents/main/agent/auth-profiles.json',
  "ENOENT: no such file or directory, open '/home/alex/.branch/workspace/MEMORY.md'",
  "EACCES: permission denied, mkdir '/opt/branch/plugins'",
  "CodexNotInstalledError: Codex is not installed.",
  "TypeError: Cannot read properties of undefined (reading 'path')\n    at runTool (/app/engine/dist/tools/run.js:41:12)",
  "INVALID_REQUEST: sessions.patch rejected",
];

let root: Root | null = null;
let host: HTMLDivElement | null = null;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(async () => {
  clearBanner();
  for (const toast of getToasts()) dismiss(toast.id);
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null; host = null;
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("no raw error at Regular (Private #1089)", () => {
  it.each(SAMPLES)("a toast and its line never show %j", (raw) => {
    notify(`Couldn't change Lockdown: ${raw}`, { tone: "bad", line: raw });
    const [toast] = getToasts();
    expect(toast.text).not.toMatch(RAW);
    expect(toast.text.startsWith("Couldn't change Lockdown.")).toBe(true);
    expect(toast.line).not.toMatch(RAW);
  });

  it.each(SAMPLES)("a banner never shows %j", (raw) => {
    raiseBanner({ icon: "alert", title: raw, text: `Branch couldn't finish: ${raw}` });
    expect(currentBanner()?.title).not.toMatch(RAW);
    expect(currentBanner()?.text).not.toMatch(RAW);
  });

  it("the line above the conversation never shows the engine's words", async () => {
    host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root!.render(<Frame navigationKey="one" sidebar={<button>Conversation</button>} main={<p>Empty</p>} header={{ title: "Conversation" }} notice="unknown method: logbook.status" />));
    const line = host.querySelector(".r1-notice")?.textContent ?? "";
    expect(line).not.toMatch(RAW);
    expect(line).toBe("This part of Branch isn’t ready on this computer yet. Update Branch, then try again.");
  });

  it("names each common failure in a plain sentence with a next step", () => {
    expect(plainError("unknown agent id \"main\"", true)).toBe("That Trunk isn’t on this computer. Choose another Trunk.");
    expect(plainError("connect ECONNREFUSED 127.0.0.1:18789", true)).toBe("Branch can’t reach its engine right now. It keeps trying, so try again in a moment.");
    expect(plainError(SAMPLES[4], true)).toBe("No model is connected. Connect one in Settings, Models, then try again.");
    expect(plainError(SAMPLES[5], true)).toBe("That file or folder isn’t there. Check that it still exists, then try again.");
    expect(plainError(SAMPLES[6], true)).toBe("Branch isn’t allowed to do that here. Check the folder’s permissions, then try again.");
    expect(plainError(new Error(SAMPLES[7]), true)).toBe("That isn’t installed on this computer. Install it, then try again.");
    expect(plainError(SAMPLES[8], true)).toBe(PLAIN_FAILURE);
    expect(plainError("Researcher: unknown method: logbook.status", true)).toBe("Researcher: This part of Branch isn’t ready on this computer yet. Update Branch, then try again.");
    expect(plainError("Storage is full. Send or remove some first. (QuotaExceededError: the quota has been exceeded)", true)).toBe("Storage is full. Send or remove some first.");
  });

  it("leaves plain words alone", () => {
    expect(plainError(" keeps running.", true)).toBe(" keeps running.");
    for (const words of ["Saved plan.md", "Stopped Builder. Researcher carries on without it.", "Done at 12:30.", "Version 2.4.1 is ready.", "Couldn't save the Pinned order."]) {
      expect(plainError(words, true)).toBe(words);
    }
  });

  // PR Closer's FIX on #1735: ids that #1700's friendlyError() catches never show either.
  const IDS = ["cedar:trunk:birch", "3f2c9a1e-8b4d-4c1a-9e2f-7a6b5c4d3e2f", "runId deadbeefdeadbeef", "Run 0123456789abcdef0123 failed"];
  it.each(IDS)("a plain toast, a banner and the notice line never show %j", async (raw) => {
    notify(raw);
    expect(getToasts()[0].text).not.toContain(raw.split(" ").pop());
    raiseBanner({ icon: "alert", title: raw, text: raw });
    expect(currentBanner()?.title).not.toContain(raw.split(" ").pop());
    host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root!.render(<Frame navigationKey="one" sidebar={<button>Conversation</button>} main={<p>Empty</p>} header={{ title: "Conversation" }} notice={raw} />));
    expect(host.querySelector(".r1-notice")?.textContent).not.toContain(raw.split(" ").pop());
  });

  it("a failure toast is checked by #1700's friendlyError() too", () => {
    notify("Couldn't send: Request failed 502 Bad Gateway", { tone: "bad" });
    expect(getToasts()[0].text).toBe("Couldn't send. That didn’t work. Try again.");
  });

  it("other toasts keep plain words, even one word or a number", () => {
    for (const words of ["Copied.", "Saved 250 files.", "Restarting…"]) {
      notify(words);
      expect(getToasts().at(-1)?.text).toBe(words);
    }
  });

  it("drops a leading Error: before it decides", () => {
    expect(plainError("Error: something")).not.toContain("Error:");
    expect(plainError("Error: something", true)).not.toContain("Error:");
    expect(plainError("error:   The file was not found.", true)).toBe("The file was not found.");
    expect(plainError(new Error("ERROR: connect ECONNREFUSED 127.0.0.1:18789"), true)).not.toMatch(/Error|ECONNREFUSED|127\.0/);
  });

  it.each(["advanced", "technical"])("keeps the exact words at %s", (level) => {
    localStorage.setItem("branch.level", level);
    notify("Couldn't change Lockdown: unknown method: logbook.status");
    expect(getToasts()[0].text).toBe("Couldn't change Lockdown: unknown method: logbook.status");
    expect(plainError("connect ECONNREFUSED 127.0.0.1:18789")).toBe("connect ECONNREFUSED 127.0.0.1:18789");
  });

  const LOCK = "GatewayLockError: failed to acquire gateway state ownership: Branch Agent state database is busy at state/branch.sqlite";
  it.each(["", "advanced", "technical"])("never names GatewayLockError in a toast, banner or notice at %j", async (level) => {
    if (level) localStorage.setItem("branch.level", level);
    notify(LOCK);
    expect(getToasts()[0].text).toBe(LOCK_BUSY);
    expect(getToasts()[0].text).not.toMatch(/GatewayLockError/);
    raiseBanner({ icon: "alert", title: LOCK, text: `desktop handoff recovery failed: ${LOCK}` });
    expect(currentBanner()?.title).toBe(LOCK_BUSY);
    expect(currentBanner()?.text).toBe(LOCK_BUSY);
    host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root!.render(<Frame navigationKey="one" sidebar={<button>Conversation</button>} main={<p>Empty</p>} header={{ title: "Conversation" }} notice={LOCK} />));
    const line = host.querySelector(".r1-notice")?.textContent ?? "";
    expect(line).toBe(LOCK_BUSY);
    expect(line).not.toMatch(/GatewayLockError/);
    expect(plainError(LOCK)).toBe(LOCK_BUSY);
    expect(plainText(LOCK)).toBe(LOCK_BUSY);
  });
});

/** Main's unchanged engine path (`run-loop.ts`): `desktop handoff recovery failed: ${String(error)}`.
 *  `String(GatewayLockError)` is `GatewayLockError: <message>`. The window maps that itself via plainText /
 *  plainError / shortReason. It must not depend on a deleted engine handoff wrapper. */
describe("window maps main's unchanged engine GatewayLockError", () => {
  const fromEngine = "GatewayLockError: failed to acquire gateway state ownership: Branch Agent state database is busy at state/branch.sqlite";
  const fromMainHandoffLog = `desktop handoff recovery failed: ${fromEngine}`;
  const fromErrorMessage = "failed to acquire gateway state ownership: Branch Agent state database is busy at state/branch.sqlite";

  it.each(["", "advanced", "technical"])("notice shows the friendly busy sentence and never GatewayLockError at %j", async (level) => {
    if (level) localStorage.setItem("branch.level", level);
    for (const raw of [fromEngine, fromMainHandoffLog, fromErrorMessage]) {
      host = document.body.appendChild(document.createElement("div"));
      root = createRoot(host);
      await act(async () => root!.render(<Frame navigationKey="one" sidebar={<button>Conversation</button>} main={<p>Empty</p>} header={{ title: "Conversation" }} notice={raw} />));
      const shown = host.textContent ?? "";
      expect(host.querySelector(".r1-notice")?.textContent).toBe(LOCK_BUSY);
      expect(shown).toContain(LOCK_BUSY);
      expect(shown).not.toMatch(/GatewayLockError/);
      expect(plainText(raw)).toBe(LOCK_BUSY);
      expect(plainError(raw)).toBe(LOCK_BUSY);
      await act(async () => root!.unmount());
      host.remove();
      root = null;
      host = null;
    }
  });
});
