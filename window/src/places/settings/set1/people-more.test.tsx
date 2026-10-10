// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KitProvider, type SaveReport } from "../kit";
import { EachPerson } from "./people-more";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;


let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });

const report: SaveReport = { saving: () => undefined, saved: () => undefined, failed: () => undefined };

describe("Settings › People › Each person", () => {
  it("Open People is the explicit way out of Settings › People", async () => {
    const left: unknown[] = [];
    const onLeave = (event: Event) => left.push((event as CustomEvent).detail);
    window.addEventListener("branch:navigate-place", onLeave);
    try {
      await act(async () => root.render(
        <KitProvider level={0} report={report} scope={null}>
          <EachPerson />
        </KitProvider>,
      ));
      expect(host.querySelector('[data-row="Open People"]')).not.toBeNull();
      expect(left).toEqual([]);
      await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Open People")!.click());
      expect(left).toEqual([{ place: "people" }]);
    } finally {
      window.removeEventListener("branch:navigate-place", onLeave);
    }
  });

});
