// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { pairingCheckCode } from "../shared/pairing-check-code";
import {
  announcePairingRequest,
  PAIRING_PROMPT_ARM_MS,
  PairingPrompt,
  pairingPromptCheckCode,
  pairingPromptNotice,
  raisePairingWindow,
  readPairingRequest,
} from "./pairing-prompt";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  delete (window as { branchDesktop?: unknown }).branchDesktop;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type Listener = (event: { event: string; payload?: unknown }) => void;

function engineOf(fx: Record<string, unknown> = {}, scopes = ["operator.admin"]) {
  let listener: Listener | undefined;
  const request = vi.fn(async (method: string) => {
    const value = fx[method];
    if (value instanceof Error) throw value;
    return value ?? {};
  });
  const engine = {
    request,
    onEvent: (cb: Listener) => {
      listener = cb;
      return () => { if (listener === cb) listener = undefined; };
    },
    sessionKey: null,
    scopes,
  } as unknown as WindowEngine;
  return {
    engine,
    request,
    emit: (event: string, payload?: unknown) => listener?.({ event, payload }),
  };
}

async function render(fx: Record<string, unknown> = {}, scopes = ["operator.admin"]) {
  const env = engineOf(fx, scopes);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<PairingPrompt engine={env.engine} ready />);
  });
  await act(async () => { await Promise.resolve(); });
  return env;
}

const click = async (text: string) => {
  const button = [...host.querySelectorAll("button")].find((el) => el.textContent?.trim() === text);
  expect(button).toBeTruthy();
  await act(async () => { (button as HTMLButtonElement).click(); });
  await act(async () => { await Promise.resolve(); });
};

const REQUEST = {
  requestId: "6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f",
  displayName: "Pixel",
  deviceId: "pixel-1",
  platform: "android",
  role: "operator",
  deviceFamily: "phone",
  scopes: ["operator.admin"],
  isRepair: false,
  ts: 1,
};

describe("pairing check codes", () => {
  it("matches on the phone and the computer for the same request", () => {
    for (const id of ["request-1", REQUEST.requestId, "D1", "abc", "", "--", "ZZ-zz_9"]) {
      expect(pairingPromptCheckCode(id)).toBe(pairingCheckCode(id));
    }
    expect(pairingPromptCheckCode(REQUEST.requestId)).toBe("4E5F");
    expect(pairingPromptCheckCode("request-1")).toBe("EST1");
  });
});

describe("the pairing prompt", () => {
  it("opens itself with the matching check code when a phone asks to pair", async () => {
    const showWindow = vi.fn();
    (window as { branchDesktop?: { showWindow: () => void } }).branchDesktop = { showWindow };
    const focus = vi.spyOn(window, "focus").mockImplementation(() => undefined);
    const { emit } = await render();
    await act(async () => { emit("device.pair.requested", REQUEST); });
    const dialog = host.querySelector("[data-testid=pairing-prompt]");
    expect(dialog?.textContent).toContain("Pixel wants to connect");
    expect(host.querySelector("[data-testid=pair-check-code] .pair-check-value")?.textContent).toBe("4E5F");
    expect(host.querySelector("[data-testid=pair-check-code]")?.textContent).toContain("Your phone shows the same code");
    expect(showWindow).toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();
  });

  it("opens from a pending list when the window missed the event", async () => {
    await render({ "device.pair.list": { pending: [REQUEST] } });
    expect(host.querySelector("[data-testid=pair-check-code] .pair-check-value")?.textContent).toBe("4E5F");
  });

  it("approves the request after the arm delay", async () => {
    vi.useFakeTimers();
    const { request, emit } = await render();
    await act(async () => { emit("device.pair.requested", REQUEST); });
    const allow = [...host.querySelectorAll("button")].find((el) => el.textContent?.trim() === "Allow") as HTMLButtonElement;
    expect(allow.disabled).toBe(true);
    await act(async () => { vi.advanceTimersByTime(PAIRING_PROMPT_ARM_MS); });
    expect(allow.disabled).toBe(false);
    await click("Allow");
    expect(request).toHaveBeenCalledWith("device.pair.approve", { requestId: REQUEST.requestId });
    expect(host.querySelector("[data-testid=pairing-prompt]")).toBeNull();
  });

  it("rejects the request", async () => {
    const { request, emit } = await render();
    await act(async () => { emit("device.pair.requested", REQUEST); });
    await click("Don’t allow");
    expect(request).toHaveBeenCalledWith("device.pair.reject", { requestId: REQUEST.requestId });
    expect(host.querySelector("[data-testid=pairing-prompt]")).toBeNull();
  });

  it("closes when the request is resolved elsewhere", async () => {
    const { emit } = await render();
    await act(async () => { emit("device.pair.requested", REQUEST); });
    expect(host.querySelector("[data-testid=pairing-prompt]")).toBeTruthy();
    await act(async () => { emit("device.pair.resolved", { requestId: REQUEST.requestId, decision: "approved" }); });
    expect(host.querySelector("[data-testid=pairing-prompt]")).toBeNull();
  });

  it("stays closed when the connection cannot approve pairing", async () => {
    const { emit } = await render({}, ["operator.read"]);
    await act(async () => { emit("device.pair.requested", REQUEST); });
    expect(host.querySelector("[data-testid=pairing-prompt]")).toBeNull();
  });
});

describe("pairing prompt helpers", () => {
  it("reads a request and names the OS notice", () => {
    expect(readPairingRequest({ foo: 1 })).toBeNull();
    expect(readPairingRequest(REQUEST)?.requestId).toBe(REQUEST.requestId);
    expect(pairingPromptNotice(REQUEST)).toEqual({ title: "Pixel wants to connect", body: "Check code 4E5F" });
  });

  it("raises the window and notifies when it is hidden", () => {
    const showWindow = vi.fn();
    const close = vi.fn();
    const shown = { close, onclick: null as ((this: Notification, ev: Event) => unknown) | null };
    const notify = vi.fn(() => shown);
    const raise = vi.fn();
    raisePairingWindow({ showWindow });
    expect(showWindow).toHaveBeenCalled();
    announcePairingRequest(REQUEST, { hidden: true, permission: "granted", notify, raise });
    expect(raise).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("Pixel wants to connect", expect.objectContaining({ body: "Check code 4E5F" }));
    shown.onclick?.call(shown as unknown as Notification, new Event("click"));
    expect(raise).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalled();
  });
});
