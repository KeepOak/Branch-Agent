// @vitest-environment jsdom
// Private #1089: no raw engine text reaches the composer. The ring popover's This computer row put the engine's error
// after its sentence, and the @ drawer put it in brackets after "Couldn't load People".
import { act, createRef, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../composer/engine";
import { useDrawer } from "../../composer/useDrawer";
import { RingPopover } from "./RingPopover";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
beforeEach(() => { vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} }); vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; document.body.innerHTML = ""; vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const RAW = /unknown method|computer\.status|browser\.request|users\.mentionable|Error:|\bat\s+\S+\s*\(|:\d+:\d+|ECONNRESET|[A-Za-z]:\\/;
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
const failing = (raw: string) => {
  const request = vi.fn(async () => { throw new Error(raw); });
  return { sessionKey: "agent:scout:main", agentId: "scout", request, onEvent: () => () => {}, scopes: ["operator.admin"], features: { methods: ["computer.status", "browser.request", "users.mentionable"], events: [] } } as unknown as WindowEngine;
};

it("This computer says it couldn't check, in plain words, when the engine fails", async () => {
  const engine = failing("Error: ECONNRESET at read (C:\\work\\computer.ts:12:3)");
  const anchor = createRef<HTMLButtonElement>();
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(<><button ref={anchor} type="button" data-local="">ring</button>
    <RingPopover anchor={anchor} onClose={() => {}} engine={engine} sessionKey="agent:scout:main" name="Scout" working={false} offline={false} context={null} running={[]} limits={null} onOpen={() => {}} onOpenConversation={() => {}} /></>));
  await flush();
  const row = document.querySelector<HTMLElement>('[data-part="this-computer"]')!;
  expect(row.textContent).toContain("Couldn’t check computer control. Try again in a moment.");
  expect(row.textContent).toContain("Couldn’t check the browser. Try again in a moment.");
  expect(row.textContent).not.toMatch(RAW);
});

it("the @ drawer says People didn't load without the engine's words", async () => {
  const engine = failing("unknown method: users.mentionable");
  function Probe() {
    const drawer = useDrawer(engine, [], [], {});
    const { loadPeople } = drawer;
    useEffect(() => { loadPeople(); }, [loadPeople]);
    return <p data-testid="people-error">{drawer.peopleError}</p>;
  }
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root?.render(<Probe />));
  await flush();
  expect(document.querySelector('[data-testid="people-error"]')?.textContent).toBe("Couldn't load People. Try again.");
  expect(document.body.textContent).not.toMatch(RAW);
});
