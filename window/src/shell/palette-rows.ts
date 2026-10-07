// The rows Find anything lists (DESIGN-SPEC §4.1.7 Elements): Actions, Conversations, Places, Settings, Trunks.
import type { Conversation } from "../connect/conversations";
import { settingsGroups } from "../places-nav/settings-nav";
import { PLACES, type PlaceId } from "../places-nav/routes";
import type { Trunk } from "./engine-data";
import type { PaletteRow } from "./palette-model";

type Ctx = {
  conversations: Conversation[];
  trunks: Trunk[];
  trunkName: (id: string | undefined) => string;
  /** The open conversation, so Find anything lists its row-menu commands (Rename <Trunk>…). */
  openRow?: Conversation;
  newConversation: () => void;
  toggleTheme: () => void;
  focusMode: () => void;
  shortcuts: () => void;
  setup: () => void;
  tour: () => void;
  quickAsk: () => void;
  openConversation: (key: string) => void;
  openPlace: (p: PlaceId) => void;
  openSettings: (page: string) => void;
  newTrunk: () => void;
  toggleLockdown?: () => void;
  lockdownOn?: boolean;
};

/** Opens a Trunk's editor or profile the way the conversation ⋯ menu does (branch:open-trunk). */
function openTrunk(c: Ctx, agentId: string, view: "profile" | "edit"): void {
  c.openPlace("people");
  window.dispatchEvent(new CustomEvent("branch:open-trunk", { detail: { agentId, view } }));
}

/** Row-menu commands for the open conversation and each Trunk, listed only while typing. */
function conversationCommands(c: Ctx): PaletteRow[] {
  const rows: PaletteRow[] = [];
  const seen = new Set<string>();
  const add = (id: string, label: string, run: () => void) => {
    if (seen.has(label)) return;
    seen.add(label);
    rows.push({ id, group: "Actions", label, hint: "", run, whenTyping: true });
  };
  const addTrunk = (id: string, name: string) => {
    add(`a:rename:${id}`, `Rename ${name}…`, () => openTrunk(c, id, "edit"));
    add(`a:profile:${id}`, `${name}’s profile`, () => openTrunk(c, id, "profile"));
    add(`a:edit:${id}`, `Edit ${name}…`, () => openTrunk(c, id, "edit"));
  };
  const open = c.openRow;
  if (open) {
    const name = c.trunkName(open.agentId);
    if (open.isMain && open.agentId) addTrunk(open.agentId, name);
    else add(`a:rename:${open.key}`, open.groupChat ? "Rename this group…" : "Rename this thread…", () => c.openConversation(open.key));
  }
  for (const t of c.trunks) addTrunk(t.id, t.name);
  for (const r of c.conversations) {
    if (r.isMain && r.agentId) addTrunk(r.agentId, c.trunkName(r.agentId));
  }
  return rows;
}

export function paletteRows(c: Ctx): PaletteRow[] {
  const actions: PaletteRow[] = [
    { id: "a:new", group: "Actions", label: "New conversation", hint: "Ctrl N", run: c.newConversation },
    { id: "a:trunk", group: "Actions", label: "New Trunk", hint: "", run: c.newTrunk },
    // Preview spec-v23 index.html:8674: "Turn Lockdown on/off" follows New Trunk in Actions.
    ...(c.toggleLockdown ? [{ id: "a:lockdown", group: "Actions", label: c.lockdownOn ? "Turn Lockdown off" : "Turn Lockdown on", hint: "", run: c.toggleLockdown }] : []),
    { id: "a:theme", group: "Actions", label: "Switch light or dark", hint: "", run: c.toggleTheme },
    { id: "a:focus", group: "Actions", label: "Focus mode", hint: "Ctrl .", run: c.focusMode },
    { id: "a:keys", group: "Actions", label: "Keyboard shortcuts", hint: "?", run: c.shortcuts },
    { id: "a:ask", group: "Actions", label: "Quick ask", hint: "Ctrl Shift Space", run: c.quickAsk },
    { id: "a:replay", group: "Actions", label: "Set up Branch", hint: "", run: c.setup },
    { id: "a:help", group: "Actions", label: "Get help setting up", hint: "", run: c.setup },
    { id: "a:tour", group: "Actions", label: "Take the walkthrough", hint: "2 min", run: c.tour },
    { id: "a:skins", group: "Actions", label: "Browse themes", hint: "", run: () => c.openSettings("appearance") },
    ...conversationCommands(c),
  ];
  const conversations = c.conversations.map((r) => ({
    id: `c:${r.key}`,
    group: "Conversations",
    label: r.isMain ? c.trunkName(r.agentId) : r.title || "New conversation",
    hint: r.isMain ? "Default Trunk" : c.trunkName(r.agentId),
    run: () => c.openConversation(r.key),
  }));
  const places = PLACES.map((p) => ({ id: `p:${p.id}`, group: "Places", label: p.name, hint: "Place", run: () => c.openPlace(p.id) }));
  const settings = settingsGroups("technical").flatMap((g) =>
    g.pages.map((p) => ({ id: `s:${p.id}`, group: "Settings", label: p.name, hint: "Settings", run: () => c.openSettings(p.id) })),
  );
  const trunks = c.trunks.map((t) => ({ id: `t:${t.id}`, group: "Trunks", label: t.name, hint: "Trunk", run: () => c.openPlace("customize") }));
  return [...actions, ...conversations, ...places, ...settings, ...trunks];
}
