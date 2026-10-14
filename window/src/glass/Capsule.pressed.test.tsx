// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { Capsule } from "./Capsule";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => { document.body.innerHTML = ""; });

it("draws aria-pressed only for items that say pressed, so other capsules are unchanged", async () => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const engine = { features: { methods: ["computer.status"], events: [] } };
  await act(async () => root.render(<Capsule label="Tools" engine={engine} items={[
    { label: "On", icon: null, pressed: true, onClick: () => undefined },
    { label: "Off", icon: null, pressed: false, onClick: () => undefined },
    { label: "Plain", icon: null, onClick: () => undefined },
    { label: "Wired on", icon: null, need: "computer.status", pressed: true, onClick: () => undefined },
    { label: "Wired plain", icon: null, need: "computer.status", onClick: () => undefined },
  ]} />));
  const button = (label: string) => host.querySelector(`button[aria-label="${label}"]`)!;
  expect(button("On").getAttribute("aria-pressed")).toBe("true");
  expect(button("Off").getAttribute("aria-pressed")).toBe("false");
  expect(button("Wired on").getAttribute("aria-pressed")).toBe("true");
  expect(button("Plain").hasAttribute("aria-pressed")).toBe(false);
  expect(button("Wired plain").hasAttribute("aria-pressed")).toBe(false);
  await act(async () => root.unmount());
});
