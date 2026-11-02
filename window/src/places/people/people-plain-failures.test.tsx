// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { ActivityTab } from "./activity";
import { Devices } from "./devices";
import { RoleSeg } from "./person-dialogs";
import { TeamsTab } from "./teams";
import { UsageTab } from "./usage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const REFUSED = "connect ECONNREFUSED 127.0.0.1:18789";
const OFFLINE =
  "Branch can’t reach its engine right now. It keeps trying, so try again in a moment.";
const SIGNED_OUT = "Branch isn’t signed in for that. Sign in again, then try again.";

let root: Root | null = null;
let host: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  localStorage.removeItem("branch.level");
});

/** An engine answering from a table; an Error in it is thrown, a missing method fails as the engine says it. */
function fakeEngine(table: Record<string, unknown>) {
  const request = vi.fn(async (method: string) => {
    if (!(method in table)) throw new Error(`unknown method: ${method}`);
    const value = table[method];
    if (value instanceof Error) throw value;
    return value;
  });
  const engine: WindowEngine = {
    request: request as unknown as WindowEngine["request"],
    onEvent: () => () => {},
    sessionKey: null,
    scopes: ["operator.admin"],
  };
  return { engine, request };
}

async function mount(node: ReactNode, level: "regular" | "advanced" | "technical" = "regular") {
  localStorage.setItem("branch.level", level);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(node);
  });
  await act(async () => {
    await Promise.resolve();
  });
}
const alerts = () => [...host.querySelectorAll('[role="alert"]')].map((a) => a.textContent ?? "");

it("a list that fails to load reads as one plain sentence with a next step at Regular, and keeps Try again", async () => {
  const { engine, request } = fakeEngine({
    "sessions.list": new Error(REFUSED),
    "agents.list": { agents: [] },
  });
  await mount(<TeamsTab engine={engine} />);
  expect(alerts()).toEqual([`${OFFLINE}Try again`]);
  expect(host.textContent).not.toContain("ECONNREFUSED");
  expect(host.textContent).not.toContain("127.0.0.1");
  const retry = host.querySelector<HTMLButtonElement>('[role="alert"] button');
  await act(async () => {
    retry!.click();
  });
  expect(request.mock.calls.filter(([m]) => m === "sessions.list")).toHaveLength(2);
});

it("keeps the exact words at Advanced and Technical", async () => {
  const { engine } = fakeEngine({
    "sessions.list": new Error(REFUSED),
    "agents.list": { agents: [] },
  });
  await mount(<TeamsTab engine={engine} />, "advanced");
  expect(alerts()).toEqual([`${REFUSED}Try again`]);
  await act(async () => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  await mount(<TeamsTab engine={engine} />, "technical");
  expect(alerts()).toEqual([`${REFUSED}Try again`]);
});

it("an engine sentence on Devices and on the activity log reads plainly at Regular", async () => {
  const { engine } = fakeEngine({
    "device.pair.list": new Error("unknown method: device.pair.list"),
  });
  await mount(<Devices engine={engine} level="regular" />);
  expect(alerts()).toEqual([
    "This part of Branch isn’t ready on this computer yet. Update Branch, then try again.Try again",
  ]);
  await act(async () => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  const log = fakeEngine({
    "audit.activity.list": new Error("GatewayRequestError: HTTP 403 forbidden"),
    "team-reports.status": new Error("off"),
    "agents.list": { agents: [] },
  });
  await mount(<ActivityTab engine={log.engine} level="regular" />);
  expect(alerts()).toEqual([`${SIGNED_OUT}Try again`]);
  expect(host.textContent).not.toContain("GatewayRequestError");
});

it("a failed change reads plainly at Regular and exactly at Advanced", async () => {
  const person = {
    id: "p-mira",
    displayName: "Mira Stone",
    emails: [],
    mergedInto: null,
    role: "adult",
  };
  const { engine } = fakeEngine({
    "users.setRole": new Error(
      "Error: EPERM: operation not permitted, open '/var/branch/state.json'",
    ),
  });
  await mount(
    <RoleSeg engine={engine} person={person} roles={["adult", "child"]} reload={() => {}} />,
  );
  await act(async () => {
    [...host.querySelectorAll("button")].find((b) => b.textContent === "child")!.click();
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(alerts()).toEqual([
    "Branch isn’t allowed to do that here. Check the folder’s permissions, then try again.",
  ]);
  expect(host.textContent).not.toContain("/var/branch");
  await act(async () => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  await mount(
    <RoleSeg engine={engine} person={person} roles={["adult", "child"]} reload={() => {}} />,
    "advanced",
  );
  await act(async () => {
    [...host.querySelectorAll("button")].find((b) => b.textContent === "child")!.click();
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(alerts()).toEqual(["EPERM: operation not permitted, open '/var/branch/state.json'"]);
});

it("a model account's own failure on Usage reads plainly at Regular", async () => {
  const { engine } = fakeEngine({
    "sessions.usage": { aggregates: { byCreator: [] } },
    "usage.status": {
      providers: [
        { provider: "anthropic", displayName: "Claude", error: "HTTP 401: invalid_api_key" },
      ],
    },
  });
  await mount(<UsageTab engine={engine} />);
  expect(host.textContent).toContain(SIGNED_OUT);
  expect(host.textContent).not.toContain("invalid_api_key");
});
