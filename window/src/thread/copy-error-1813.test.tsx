// @vitest-environment jsdom
// Classic thread error block: Copy error is a Technical control, same as Details.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ErrorBlock } from "./blocks";
import { ThreadContext } from "./context";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
  localStorage.clear();
});

async function renderAt(level: "regular" | "advanced" | "technical") {
  localStorage.setItem("branch.level", level);
  if (root) await act(async () => root!.unmount());
  document.body.innerHTML = "";
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <ThreadContext.Provider value={{ name: "Juniper", toast: () => undefined, running: false }}>
        <ErrorBlock
          block={{ kind: "error", key: "failed-run", message: "the provider timed out" }}
          onDismiss={() => undefined}
        />
      </ThreadContext.Provider>,
    ),
  );
  return host;
}

function copyErrorLabels(host: HTMLElement): string[] {
  return [...host.querySelectorAll("[data-testid=run-error] button")]
    .map((button) => button.textContent)
    .filter((label) => label === "Copy error");
}

describe("classic thread Copy error", () => {
  it("is absent at Regular and Advanced, and present at Technical", async () => {
    expect(copyErrorLabels(await renderAt("regular"))).toEqual([]);
    expect(copyErrorLabels(await renderAt("advanced"))).toEqual([]);
    expect(copyErrorLabels(await renderAt("technical"))).toEqual(["Copy error"]);
  });
});
