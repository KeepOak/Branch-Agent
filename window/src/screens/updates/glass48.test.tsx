// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { UpdateBanner, UpdateButton } from "./UpdateButton";
import type { UpdateFlow } from "./useUpdateFlow";

/* README item 48 (owner, final): only the left sidebar is frosted. The update button sits on the sidebar as a solid disc; the
   update banner sits in the clear avatar menu, so its line and its action are small frosted pills with a 1px outline from the
   shared pill tokens (--gp-*). Nothing in updates.css draws the earlier glass (--gc, --gf, --gk). */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });
const css = readFileSync("src/screens/updates/updates.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ");
const rule = (sel: string) => css.slice(css.indexOf(sel + " {"), css.indexOf("}", css.indexOf(sel + " {")));

it("draws the update banner as a clear row with its line and action on outlined frosted pills, and the button from the pill tokens", async () => {
  const flow = { view: { kind: "offer", version: "0.5.0" }, act: () => {} } as unknown as UpdateFlow;
  await act(async () => root.render(<><UpdateButton flow={flow} /><div role="menu"><UpdateBanner flow={flow} /></div></>));
  const banner = host.querySelector(".r1u-ban")!;
  expect(banner.querySelector(".r1u-ban-text")!.textContent).toContain("0.5.0");
  expect(banner.querySelector(".r1u-ban-act")).not.toBeNull();
  expect(rule(".r1u-ban")).toContain("background: transparent");
  const pill = rule(".r1u-ban-text, .r1u-ban-act");
  for (const token of ["border: 1px solid var(--gp-edge)", "backdrop-filter: var(--gp-blur)"]) expect(pill).toContain(token);
  expect(rule(".r1u-ban-text")).toContain("var(--gp-fill)");
  expect(host.querySelector(".r1u-btn")).not.toBeNull();
  expect(rule(".r1u-btn")).toContain("border: 1px solid var(--gp-edge)");
  expect(css).not.toMatch(/var\(--g[cfk]-/);
});
