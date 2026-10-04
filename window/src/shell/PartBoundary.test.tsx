// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PartBoundary } from "./PartBoundary";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

let fail = true;
function Place({ name }: { name: string }) {
  if (fail) {
    const reply = {} as { items: string[] }; // an engine reply missing its list
    return <p>{reply.items.length}</p>;
  }
  return <p data-testid="place">{name} loaded</p>;
}

async function show(place: string) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <>
        <PartBoundary label={`Place ${place}`} resetKey={place}><Place name={place} /></PartBoundary>
        <p data-testid="rest">The list and the status bar</p>
      </>,
    ),
  );
  return host;
}

it("shows the part's error state while the rest of the window keeps drawing, and Try again redraws the part", async () => {
  fail = true;
  const host = await show("inbox");
  expect(host.querySelector('[data-testid="part-failed"]')!.textContent).toContain("This part didn’t load");
  expect(host.querySelector('[data-testid="rest"]')).not.toBeNull();
  fail = false;
  await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === "Try again")!.click());
  expect(host.querySelector('[data-testid="place"]')!.textContent).toBe("inbox loaded");
});

it("clears the error when you move to another place", async () => {
  fail = true;
  const host = await show("inbox");
  expect(host.querySelector('[data-testid="part-failed"]')).not.toBeNull();
  fail = false;
  await act(async () =>
    root!.render(
      <>
        <PartBoundary label="Place canopy" resetKey="canopy"><Place name="canopy" /></PartBoundary>
        <p data-testid="rest">The list and the status bar</p>
      </>,
    ),
  );
  expect(host.querySelector('[data-testid="place"]')!.textContent).toBe("canopy loaded");
});
