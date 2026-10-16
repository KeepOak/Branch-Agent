// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Face } from "./Face";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("mounts a full face in a host without matchMedia, as the R1 frame does in App-level tests", async () => {
  vi.stubGlobal("matchMedia", undefined);
  const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
  await act(async () => root.render(<Face size={32} label="Main" />));
  expect(host.firstElementChild).not.toBeNull();
  expect(errors.mock.calls.flat().join(" ")).not.toContain("matchMedia");
});
