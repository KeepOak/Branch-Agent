// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Typing } from "./blocks";
import { Thread } from "./Thread";
vi.mock("../face/Face", () => ({ Face: ({ label }: { label: string }) => <span data-testid="face">{label}</span> }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) });
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; document.body.innerHTML = ""; });
describe("sender-aware activity", () => {
  it("shows the sender face, status, name and three animated dots", async () => {
    const host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
    await act(async () => root?.render(<Typing name="Research" />));
    expect(host.querySelector('[data-testid="face"]')?.textContent).toBe("Research");
    expect(host.querySelector('.typing-status')).not.toBeNull();
    expect(host.querySelector('.typing-words')?.textContent).toBe("Research is typing");
    expect(host.querySelectorAll('.typing i')).toHaveLength(3);
  });
  it("shows one named line for each active sender, including working agents", async () => {
    const host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
    await act(async () => root?.render(<><Typing name="Dana" face={<img alt="Dana" src="/avatar.png" />} /><Typing name="Research" working /></>));
    expect([...host.querySelectorAll('.typing-words')].map((el) => el.textContent)).toEqual(["Dana is typing", "Research is working"]);
    expect(host.querySelectorAll('.typing-status')).toHaveLength(2);
    expect(host.querySelector('img')?.getAttribute('alt')).toBe("Dana");
  });
});

it("keeps separate working rows for distinct group senders with the same name", async () => {
  const host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
  await act(async () => root?.render(<Thread name="Research" history={[]} live={[
    { kind: "text", key: "one", text: "First", streaming: true, meta: { sender: { kind: "trunk", agentId: "one" } } },
    { kind: "text", key: "two", text: "Second", streaming: true, meta: { sender: { kind: "trunk", agentId: "two" } } },
  ]} pendingUser={null} running onAnswer={() => {}} room={{ isRoom: true, selfId: "viewer", trunkName: () => "Research", whereRuns: () => null }} />));
  expect([...host.querySelectorAll('.typing-words')].map((el) => el.textContent)).toEqual(["Research is working", "Research is working"]);
});
