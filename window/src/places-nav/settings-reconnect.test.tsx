// @vitest-environment jsdom
// The engine restarts or updates while Settings is open and the Trunk is still getting ready. Nothing navigates,
// no conversation is opened, and Settings must come back by itself: the session reconnects and reads again, and
// the page re-reads its data from the new engine handle.
import { act, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { GatewayStatus } from "../connect/gateway";
import { SaplingSession } from "../connect/session";
import { SettingsFrame } from "./SettingsFrame";

type Options = { onStatus: (status: GatewayStatus) => void; onEvent: (frame: { event: string; payload: unknown }) => void };

const fake = vi.hoisted(() => ({
  options: null as Options | null,
  held: true,
  historyFailures: 0,
  methods: [] as string[],
}));

vi.mock("../connect/gateway", () => ({
  BranchGateway: class {
    constructor(options: Options) {
      fake.options = options;
    }
    start(): void {}
    stop(): void {}
    async request(method: string): Promise<unknown> {
      fake.methods.push(method);
      switch (method) {
        case "agents.list":
          return { agents: [{ id: "main", name: "Main", ...(fake.held ? { admissionRefusal: { code: "agent-database-inspection-pending", preparation: { state: "preparing" } } } : {}) }], defaultId: "main" };
        case "chat.history":
          if (fake.historyFailures > 0) {
            fake.historyFailures -= 1;
            throw new Error("Agent main has not completed startup inspection and preparation; run branch doctor --fix");
          }
          return { messages: [] };
        case "exec.approval.list":
          return [];
        case "approval.history":
          return { items: [] };
        default:
          return {};
      }
    }
  },
}));

const KEY = "agent:main:main";
const hello = { snapshot: { sessionDefaults: { mainSessionKey: KEY } }, auth: { scopes: [] }, policy: {} };
const connected = { phase: "connected", hello } as unknown as GatewayStatus;

let root: Root | undefined;
let session: SaplingSession | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  session?.stop();
  session = undefined;
  document.body.innerHTML = "";
  vi.useRealTimers();
  fake.held = true;
  fake.historyFailures = 0;
  fake.methods = [];
});

/** The same wiring the window uses: the page gets the session's current engine handle on every render. */
function WindowWithSettings({ live }: { live: SaplingSession }) {
  useSyncExternalStore(live.subscribe, live.getSnapshot);
  return <SettingsFrame page="accounts" backName="Sapling" engine={live.engine} onPage={() => {}} onBack={() => {}} />;
}

it("reconnects Settings with no navigation after the engine restarts while the Trunk is still getting ready", async () => {
  vi.useFakeTimers();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fake.historyFailures = 1_000_000;
  session = new SaplingSession("ws://fake", undefined);
  session.start();
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root?.render(<WindowWithSettings live={session!} />));
  // The engine restarts with Settings open: the window sees the drop, then the engine answers again.
  await act(async () => fake.options?.onStatus({ phase: "connecting" }));
  await act(async () => fake.options?.onStatus(connected));
  await act(async () => { await vi.advanceTimersByTimeAsync(120_001); });
  expect(session.getSnapshot().error).toBe("Main is still starting up. Try again in a minute.");

  // The Trunk gets ready. Nothing navigates; Settings must re-read from the recovered window.
  fake.held = false;
  fake.historyFailures = 0;
  const modelsReadsBefore = fake.methods.filter((m) => m === "models.list").length;
  await act(async () => { await vi.advanceTimersByTimeAsync(3_500); });

  expect(session.getSnapshot().error).toBeNull();
  expect(session.getSnapshot().historyReady).toBe(true);
  expect(fake.methods.filter((m) => m === "models.list").length).toBeGreaterThan(modelsReadsBefore);
});
