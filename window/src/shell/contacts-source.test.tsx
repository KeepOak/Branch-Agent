// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SaplingSession } from "../connect/session";
import { useContacts } from "./engine-data";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; });

describe("contacts.list source", () => {
  it("refreshes the engine-owned roster on contacts.changed", async () => {
    let event: ((name: string) => void) | undefined;
    let name = "Oak";
    const request = vi.fn(async () => ({ contacts: [{ id: "trunk:oak", name }] }));
    const session = { request, onGatewayEvent: (listener: (name: string) => void) => { event = listener; return () => { event = undefined; }; } } as unknown as SaplingSession;
    const container = document.createElement("div"); document.body.append(container);
    root = createRoot(container);
    function Probe() { const [contacts] = useContacts(session, true); return <span>{contacts[0]?.name}</span>; }
    await act(async () => root!.render(<Probe />));
    expect(container.textContent).toBe("Oak");
    expect(request).toHaveBeenCalledWith("contacts.list", { includeArchived: true });
    name = "Elm";
    await act(async () => { event?.("contacts.changed"); });
    expect(container.textContent).toBe("Elm");
    expect(request).toHaveBeenCalledTimes(2);
  });
});
