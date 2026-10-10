// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Topic } from "@branch/gateway-protocol";
import { afterEach, describe, expect, it } from "vitest";
import { ContactTopicsPane } from "./ContactTopicsPane";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; });

describe("ContactTopicsPane names", () => {
  it("gives two threads with the same readable name distinct row titles", async () => {
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    const keys = ["agent:juniper:a2a:branch-coordinator-a5a54c", "agent:juniper:a2a:branch-coordinator-b1c2d3"];
    const items = keys.map((key) => ({ topic: { key, contactId: "trunk:juniper", title: key, status: "active", unread: false } as Topic, preview: "", updatedAt: 0 }));
    await act(async () => root!.render(<ContactTopicsPane items={items} name="Juniper" onOpen={() => {}} />));
    const titles = [...host.querySelectorAll("strong")].map((strong) => strong.textContent ?? "");
    expect(titles).toHaveLength(2);
    expect(titles[0]).toMatch(/^Talk with Coordinator · [0-9a-f]{6}$/);
    expect(new Set(titles).size).toBe(2);
    expect(host.textContent).not.toContain("a2a:");
  });
});
