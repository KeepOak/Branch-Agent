// @vitest-environment jsdom
// #1049 (section D): Settings search in the R1 window finds Trunks (open, Make default, New Trunk) and features.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ConversationList } from "../../connect/conversations";
import type { WindowEngine } from "../../connect/engine";
import type { SaplingSession } from "../../connect/session";
import { useSettingsSearch } from "./settings-search";

vi.mock("../features/atlas", async () => ({
  ...(await vi.importActual<typeof import("../features/atlas")>("../features/atlas")),
  loadAtlas: async () => [{ id: "VOICE-1", a: "voice", f: "Read a message aloud", w: "", s: "planned", p: "" }, { id: "X-1", a: "nowhere", f: "Odd one", w: "", s: "in Branch", p: "" }],
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

it("passes the Trunks and the atlas to Settings search, and opens, makes default and opens features where they live", async () => {
  const request = vi.fn(async (method: string, params?: unknown) => {
    if (method === "agents.list") return { defaultId: "oak", agents: [{ id: "oak", identity: { name: "Oak" } }, { id: "birch", identity: { name: "Birch" } }] };
    if (method === "config.get") return { hash: "h1", valid: true, config: { agents: { defaultId: "oak" } } };
    return params ?? {};
  });
  const session = { request, onGatewayEvent: () => () => undefined } as unknown as SaplingSession;
  const engine = { request, features: { methods: ["agents.list", "config.get", "config.patch"], events: [] }, scopes: ["operator.admin"] } as unknown as WindowEngine;
  const navigate = vi.fn(), onNotice = vi.fn();
  let out: ReturnType<typeof useSettingsSearch> | null = null;
  function Probe() {
    out = useSettingsSearch({ session, engine, ready: true, list: {} as ConversationList, open: true, navigate, onNotice, mainKey: (id) => (id === "oak" ? "agent:oak:main" : undefined) });
    return null;
  }
  await act(async () => root.render(<Probe />));
  await settle();
  expect(out!.trunks).toEqual([{ id: "oak", name: "Oak", isDefault: true }, { id: "birch", name: "Birch", isDefault: false }]);
  // The preview names a feature by its title, with its status under it.
  expect(out!.features).toEqual([{ id: "VOICE-1", name: "Read a message aloud", description: "Coming" }, { id: "X-1", name: "Odd one", description: "In Branch" }]);
  out!.onTrunk!("oak", "open");
  out!.onTrunk!("birch", "open");
  expect(navigate.mock.calls.map(([r]) => r)).toEqual([{ kind: "chat", key: "agent:oak:main" }, { kind: "chat", key: "agent:birch:main" }]);
  out!.onOpenFeature!("VOICE-1");
  out!.onOpenFeature!("X-1");
  expect(navigate.mock.calls.slice(2).map(([r]) => r)).toEqual([{ kind: "settings", page: "voice" }, { kind: "settings", page: "features" }]);
  out!.onTrunk!("birch", "makeDefault");
  await settle();
  expect(request.mock.calls.map(([m]) => m)).toContain("config.patch");
  expect(onNotice).toHaveBeenCalledWith("Birch is your default Trunk now.");
});
