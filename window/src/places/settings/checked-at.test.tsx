// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CheckedAt, useCheckedAt } from "./checked-at";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

function Check({ run }: { run: () => Promise<void> }) {
  const [at, stamp] = useCheckedAt();
  return <div><button type="button" onClick={() => void run().then(stamp, () => undefined)}>Check again</button><CheckedAt at={at} /></div>;
}

describe("check buttons say when they last checked", () => {
  it("shows no line before a check, and a Checked at time once the check has finished", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 15, 14, 5));
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(async () => root?.render(<Check run={async () => undefined} />));
    expect(document.querySelector(".checked-at")).toBeNull();
    await act(async () => document.querySelector<HTMLButtonElement>("button")?.click());
    await act(async () => undefined);
    expect(document.querySelector(".checked-at")?.textContent).toMatch(/^Checked at \d{1,2}:05/);
    vi.useRealTimers();
  });

  it("does not stamp a check that failed", async () => {
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(async () => root?.render(<Check run={async () => { throw new Error("offline"); }} />));
    await act(async () => document.querySelector<HTMLButtonElement>("button")?.click());
    await act(async () => undefined);
    expect(document.querySelector(".checked-at")).toBeNull();
  });
});
