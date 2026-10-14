import { createRoot } from "react-dom/client";
import "./theme/tokens.css";
import "./theme/base.css";
import "./screens/frame/frame.css";
import { setThemeChoice } from "./theme/theme";
import { SettingsFrame } from "./screens/settings";
import { R1_PAGES } from "./screens/settings/pages/plugged";
import type { WindowEngine } from "./connect/engine";

const q = new URLSearchParams(location.search);
localStorage.setItem("branch.level", q.get("level") ?? "regular");
setThemeChoice((q.get("theme") ?? "light") as "light" | "dark");
const DATA: Record<string, unknown> = {
  "config.get": { hash: "h1", valid: true, config: {} },
  "config.schema": { schema: {}, uiHints: {} },
  "users.prefs.get": { status: "ok", entries: {} },
  "agents.list": { agents: [{ id: "main", identity: { name: "Sapling" } }, { id: "scout", identity: { name: "Scout" } }, { id: "ledger", identity: { name: "Ledger" } }], defaultId: "main", mainKey: "agent:main:main" },
  "contacts.outside.list": { enabled: true, agents: [
    { id: "claude-code-a1b2c3", name: "Claude Code", where: "This computer", activity: "Testing every screen through the window tools", online: true, lastSeenAt: Date.now(), revoked: false, mayDriveWindow: true },
    { id: "codex-d4e5f6", name: "Codex", where: "This computer", online: true, lastSeenAt: Date.now(), revoked: false, mayDriveWindow: false },
    { id: "hermes-0a0b0c", name: "Hermes Agent", online: false, lastSeenAt: Date.now() - 2 * 864e5, revoked: false, mayDriveWindow: false },
  ] },
  "skills.library.list": { entries: [{ skillId: "s1", slug: "brief", description: "Write a one-page brief on {{topic}} with numbered sources." }] },
  "skills.status": { skills: [
    { name: "brief", description: "A one-page brief with sources.", eligible: true, source: "workspace" },
    { name: "weather", description: "Today’s weather and the week ahead for any place.", eligible: true, source: "bundled" },
    { name: "pdf-tools", description: "Read scanned PDFs, split and merge them.", eligible: false, source: "bundled" },
  ] },
  "plugins.list": { plugins: [] },
  "sessions.usage": { totals: { totalCost: 16.84 }, aggregates: { messages: { user: 164 } } },
  "usage.status": { providers: [], updatedAt: Date.now() },
  "tools.catalog": { groups: [] },
  "acpx.agents.list": { agents: [] },
  "webSearch.status": { providers: [{ id: "duckduckgo", label: "DuckDuckGo" }, { id: "brave", label: "Brave" }] },
  "models.list": { models: [] },
};
const engine = {
  request: async (method: string) => (method in DATA ? DATA[method] : {}),
  onEvent: () => () => undefined, sessionKey: "s", scopes: ["operator.admin"],
} as unknown as WindowEngine;
createRoot(document.getElementById("root")!).render(
  <div className="r1-proof" style={{ height: "100vh", display: "grid" }}><SettingsFrame engine={engine} page={q.get("page") ?? "customize"} pages={R1_PAGES} onAsk={() => undefined} /></div>,
);
