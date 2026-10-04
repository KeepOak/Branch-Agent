// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { GatewayEventListener, SaplingSession, SessionSnapshot } from "../connect/session";
import { usePetCompletion } from "./use-pet-completion";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); });

function fixture() {
  let snapshot = { sessionKey:"main", liveRunId:"run1", doneAt:null } as SessionSnapshot;
  const events = new Set<GatewayEventListener>(), reads = new Set<() => void>();
  const session = { getSnapshot:() => snapshot,
    onGatewayEvent:(listener: GatewayEventListener) => { events.add(listener); return () => events.delete(listener); },
    subscribe:(listener: () => void) => { reads.add(listener); return () => reads.delete(listener); },
  } as unknown as SaplingSession;
  return { session, events, reads,
    terminal:(state: string) => events.forEach(listener => listener("chat", { runId:"run1", state })),
    settle:() => { snapshot = { ...snapshot, liveRunId:null, doneAt:100 }; reads.forEach(listener => listener()); },
  };
}
function Fixture({ session }: { session: SaplingSession }) { usePetCompletion(session); return null; }
it("binds native completion to one cheer only after history settles, and unsubscribes on unmount", async () => {
  const f = fixture(), reaction = vi.fn();
  document.addEventListener("branch:pet-reaction", reaction);
  const host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
  await act(async () => root?.render(<Fixture session={f.session} />));
  f.terminal("final"); expect(reaction).not.toHaveBeenCalled();
  f.settle(); f.settle(); expect(reaction).toHaveBeenCalledOnce();
  expect((reaction.mock.calls[0][0] as CustomEvent).detail).toBe("cheer");
  await act(async () => root?.unmount()); root = undefined;
  expect(f.events.size).toBe(0); expect(f.reads.size).toBe(0);
  document.removeEventListener("branch:pet-reaction", reaction);
});
it("does not cheer the engine error terminal", async () => {
  const f = fixture(), reaction = vi.fn();
  document.addEventListener("branch:pet-reaction", reaction);
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root?.render(<Fixture session={f.session} />));
  f.terminal("error"); f.settle(); expect(reaction).not.toHaveBeenCalled();
  document.removeEventListener("branch:pet-reaction", reaction);
});
