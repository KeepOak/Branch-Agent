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
};

export function paletteRows(c: Ctx): PaletteRow[] {
  const actions: PaletteRow[] = [
    { id: "a:new", group: "Actions", label: "New conversation", hint: "Ctrl N", run: c.newConversation },
    { id: "a:trunk", group: "Actions", label: "New Trunk", hint: "", run: c.newTrunk },
    { id: "a:theme", group: "Actions", label: "Switch light or dark", hint: "", run: c.toggleTheme },
    { id: "a:focus", group: "Actions", label: "Focus mode", hint: "Ctrl .", run: c.focusMode },
    { id: "a:keys", group: "Actions", label: "Keyboard shortcuts", hint: "?", run: c.shortcuts },
    { id: "a:ask", group: "Actions", label: "Quick ask", hint: "Ctrl Shift Space", run: c.quickAsk },
    { id: "a:replay", group: "Actions", label: "Set up Branch", hint: "", run: c.setup },
    { id: "a:help", group: "Actions", label: "Get help setting up", hint: "", run: c.setup },
    { id: "a:tour", group: "Actions", label: "Take the walkthrough", hint: "2 min", run: c.tour },
    { id: "a:skins", group: "Actions", label: "Browse themes", hint: "", run: () => c.openSettings("appearance") },
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
