// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { SaplingSession } from "../connect/session";
import type { Limits } from "./status-data";
import { useLimits } from "./use-status";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let current: Limits | null = null;

function Fixture({ session }: { session: SaplingSession }) {
  current = useLimits(session, true);
  return null;
}

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  current = null;
  document.body.replaceChildren();
});

it("notifies Control tower when a later usage poll returns a result", async () => {
  const request = vi.fn(async (method: string) => {
    if (method === "usage.status") {
      return {
        updatedAt: 1,
        providers: [{ provider: "openai-codex", displayName: "ChatGPT plan", windows: [{ label: "5h", usedPercent: 23 }] }],
      };
    }
    return {};
  });
  const session = {
    request,
    onGatewayEvent: () => () => undefined,
  } as unknown as SaplingSession;
  const seen: unknown[] = [];
  const onChecked = (event: Event) => { seen.push((event as CustomEvent).detail); };
  window.addEventListener("branch:usage-checked", onChecked);
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root?.render(<Fixture session={session} />));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  window.removeEventListener("branch:usage-checked", onChecked);
  expect(request).toHaveBeenCalledWith("usage.status", {});
  expect(current?.rows).toHaveLength(1);
  expect(seen[0]).toMatchObject({ rows: [{ name: "ChatGPT · Account 1" }] });
});
