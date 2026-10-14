// Find anything (Ctrl K) in the R1 window: the Classic palette (shell/Palette.tsx, shell/palette-rows.ts) re-hosted as a
// clear glass dialog (README item 48). Only its props are adapted here: the rows open R1 routes, and the commands R1 has
// no home for yet say Coming instead of doing nothing.
import { useMemo } from "react";
import type { Conversation, ConversationList } from "../../connect/conversations";
import type { SaplingSession } from "../../connect/session";
import type { PlaceId } from "../../places-nav/routes";
import { createReadyTrunk } from "../../places/trunk/api";
import { conversationActions } from "../../shell/conversation-actions";
import { useTrunks } from "../../shell/engine-data";
import { nextTrunkName } from "../../shell/NewTrunkFlow";
import { notify } from "../../shell/notify";
import { Palette } from "../../shell/Palette";
import type { PaletteRow } from "../../shell/palette-model";
import { paletteRows } from "../../shell/palette-rows";
import { readThemeChoice, setThemeChoice, toggleTheme } from "../../theme/theme";
import { FIND_EVENT } from "../../thread/FindBar";
import "./find.css";

/** Commands with no R1 home yet: the row stays listed, says Coming, and runs nothing but its reason. */
export const FIND_COMING: Readonly<Record<string, string>> = {
  "a:focus": "Focus mode comes in a later update.",
  "a:tour": "The walkthrough returns with the new setup.",
  "a:ask": "Quick ask comes in a later update.",
};

export type FindAnythingProps = {
  session: SaplingSession;
  ready: boolean;
  list: ConversationList;
  conversations: readonly Conversation[];
  current?: Conversation;
  lockdownOn: boolean;
  onToggleLockdown?: () => void;
  onOpenConversation: (key: string) => void;
  onPlace: (place: PlaceId) => void;
  onSettings: (page: string) => void;
  onSetup: () => void;
  onShortcuts: () => void;
  onClose: () => void;
};

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Adapts the Classic rows to R1: Coming for the commands above, and Customize's tabs open Customize. */
export function r1PaletteRows(rows: readonly PaletteRow[], onPlace: (place: PlaceId) => void): PaletteRow[] {
  return rows.map(row => {
    const coming = FIND_COMING[row.id];
    if (coming) return { ...row, hint: "Coming", run: () => void notify(`Coming · ${coming}`) };
    if (row.id.startsWith("p:customize:")) return { ...row, run: () => onPlace("customize") };
    return row;
  });
}

export function FindAnything(p: FindAnythingProps) {
  const { session, ready } = p;
  const trunks = useTrunks(session, ready);
  const request = useMemo(() => <T,>(method: string, params?: unknown) => session.request<T>(method, params), [session]);
  const actions = useMemo(() => conversationActions(request, p.list, () => session.getSnapshot().sessionKey), [request, p.list, session]);
  const trunkName = (id: string | undefined) => trunks.list.find(trunk => trunk.id === id)?.name ?? id ?? "";
  const start = (agentId: string) => void actions.create(agentId).then(key => { if (key) p.onOpenConversation(key); }, (error: unknown) => notify(`Couldn't start a conversation: ${reason(error)}`, { tone: "bad" }));
  const rowName = (key: string) => {
    const row = p.conversations.find(candidate => candidate.key === key);
    return row ? (row.isMain ? trunkName(row.agentId) : row.title || "New conversation") : "Conversation";
  };
  const rows = r1PaletteRows(paletteRows({
    conversations: [...p.conversations],
    trunks: trunks.list,
    trunkName,
    openRow: p.current,
    newConversation: () => { const id = trunks.defaultId ?? trunks.list[0]?.id; if (id) start(id); else notify("Make a Trunk first.", { tone: "bad" }); },
    newTrunk: () => void createReadyTrunk(session.engine, nextTrunkName(trunks.list.map(trunk => trunk.name))).then(start, (error: unknown) => notify(`Couldn't make the Trunk: ${reason(error)}`, { tone: "bad" })),
    toggleTheme: () => void setThemeChoice(toggleTheme(readThemeChoice())),
    focusMode: () => undefined,
    shortcuts: p.onShortcuts,
    setup: p.onSetup,
    tour: () => undefined,
    quickAsk: () => undefined,
    openConversation: p.onOpenConversation,
    openPlace: p.onPlace,
    openSettings: p.onSettings,
    toggleLockdown: p.onToggleLockdown,
    lockdownOn: p.lockdownOn,
  }), p.onPlace);
  return <div className="r1-find">
    <Palette rows={rows} request={request} rowName={rowName} onClose={p.onClose}
      onOpenMessage={(key, words) => { p.onOpenConversation(key); setTimeout(() => window.dispatchEvent(new CustomEvent(FIND_EVENT, { detail: { query: words } })), 0); }} />
  </div>;
}
