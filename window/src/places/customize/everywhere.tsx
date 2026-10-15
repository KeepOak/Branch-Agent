// Settings › Devices & apps (once Customize › Everywhere; preview 40-places.js, 70-surfaces.js): one tile per place
// you reach Branch from.
// Connected states come from the engine's computers (node.list) and paired devices (device.pair.list), and the
// chat apps from channels.status; Pair makes a code with device.pair.setupCode.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { useResource } from "../library/data";
import { Grey, list, Pill, rec, str, type Rec } from "./common";
import { Glyph, type GlyphName } from "./glyphs";
import { PairDialog } from "./pairing";
import { joinNames } from "../../shell/join-names";
import { connectedNow } from "../presence";

/** One computer or paired device. `online` is the engine's own "connected now" flag, the same one Computer reads. */
type Seen = { name: string; platform: string; family: string; client: string; online: boolean };
function seen(nodes: unknown, devices: unknown): Seen[] {
  // A paired computer is one entry: its node decides whether it is connected (places/presence.ts).
  const nodeList = list(rec(nodes).nodes);
  const nodeOf = new Map(nodeList.map(n => [str(n.nodeId), n] as const));
  const paired = list(rec(devices).paired);
  const pairedIds = new Set(paired.map(d => str(d.deviceId)));
  const fromNodes = nodeList.filter(n => !pairedIds.has(str(n.nodeId))).map(n => ({ name: str(n.displayName) || str(n.nodeId), platform: str(n.platform), family: "", client: str(n.clientId), online: connectedNow(undefined, n) }));
  const fromDevices = paired.map((d: Rec) => ({ name: str(d.displayName) || str(d.operatorLabel), platform: str(d.platform), family: str(d.deviceFamily), client: `${str(d.clientId)} ${str(d.clientMode)}`, online: connectedNow(d, nodeOf.get(str(d.deviceId))) }));
  return [...fromNodes, ...fromDevices];
}
const match = (all: Seen[], test: (s: Seen) => boolean) => all.filter(test);
/** A tile is Connected only when one of its devices is online now. Paired but offline reads Offline. */
const tileState = (found: Seen[]): "on" | "offline" | "none" => (found.some(s => s.online) ? "on" : found.length ? "offline" : "none");
const isWin = (s: Seen) => /^win|windows/i.test(s.platform);
const isMac = (s: Seen) => /darwin|mac/i.test(s.platform) && !/iphone|ipad/i.test(s.family);
const isTerm = (s: Seen) => /\b(cli|tui|terminal)\b/i.test(s.client);
const isIos = (s: Seen) => /ios|iphone|ipad/i.test(s.platform + " " + s.family);
const isAndroid = (s: Seen) => /android/i.test(s.platform + " " + s.family);

export function EverywhereTab({ engine, openChannels }: { engine: WindowEngine; openChannels: () => void }) {
  const nodes = useResource<unknown>(engine, "node.list");
  const devices = useResource<unknown>(engine, "device.pair.list");
  const channels = useResource<unknown>(engine, "channels.status", { probe: false });
  const [pairing, setPairing] = useState(false);
  const all = seen(nodes.data, devices.data);
  const here = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const win = match(all, isWin), mac = match(all, isMac);
  const labels = rec(rec(channels.data).channelLabels), accounts = rec(rec(channels.data).channelAccounts);
  const chats = Object.keys(accounts).filter(id => list(accounts[id]).some(a => a.connected === true)).map(id => str(labels[id]) || id);
  const names = (s: Seen[], fallback: string) => joinNames([...new Set(s.map(x => x.name))]) || fallback;
  return <div className="cz-page" data-testid="everywhere">
    <div className="cz-grid2">
      <Tile glyph="windows" title="Windows" line={names(win, "The Branch app on Windows")} state={tileState(win)} here={/Windows/.test(here)} />
      <Tile glyph="laptop" title="Mac" line={mac.length ? names(mac, "") : "The same app on a Mac · menu bar icon with usage"} state={tileState(mac)} here={/Macintosh/.test(here)} />
      <Tile glyph="terminal" title="Terminal" line="Type branch in any terminal. Same places, same theme" state={tileState(match(all, isTerm))} />
      <Tile glyph="phone" title="iPhone" line="Pair with the square code · lock screen answers" state={tileState(match(all, isIos))} action={<button type="button" className="btn ghost sm" onClick={() => setPairing(true)}>Pair</button>} />
      <Tile glyph="android" title="Android" line="Pair with the square code · answer from the notification" state={tileState(match(all, isAndroid))} action={<button type="button" className="btn ghost sm" onClick={() => setPairing(true)}>Pair</button>} />
      <Tile glyph="globe" title="keepoak.com" line="Connect your account to reach Branch from a browser" state="none" action={<Grey reason="keepoak.com has no sign-in Branch can use yet.">Connect</Grey>} />
      <Tile glyph="chat" title="Chat apps" line={chats.length ? `${chats.join(", ")} ${chats.length === 1 ? "is" : "are"} connected: talk to a Trunk from where you already are.` : "Talk to a Trunk from the chat apps you already use."} action={<button type="button" className="btn sm" onClick={openChannels}>Chat apps</button>} />
      <Tile glyph="code" title="A page of your own" line="A small box on your own notes page or desk dashboard that asks Branch something. It talks only to your paired address, with its own key." action={<Grey reason="Needs the engine's page widget key.">Get the snippet</Grey>} />
    </div>
    {(nodes.error || devices.error) && <p className="cz-hint">{nodes.error || devices.error}</p>}
    {pairing && <PairDialog engine={engine} close={() => setPairing(false)} />}
  </div>;
}

type TileState = "on" | "offline" | "none";
const WORDS: Record<TileState, [string, "ok" | "idle"]> = { on: ["Connected", "ok"], offline: ["Offline", "idle"], none: ["Not set up", "idle"] };
/** `here` marks the computer this window runs on, which is connected by definition. */
function Tile({ glyph, title, line, state, here, action }: { glyph: GlyphName; title: string; line: string; state?: TileState; here?: boolean; action?: React.ReactNode }) {
  const effective: TileState | undefined = here ? "on" : state;
  const [word, tone] = effective ? WORDS[effective] : ["", "idle"] as const;
  return <section className="cz-tile-card" data-surface={title}><div className="cz-tile-h"><span className="cz-tile"><Glyph name={glyph} size={16} /></span><b>{title}</b></div><p>{line}</p>
    {(effective !== undefined || action) && <div className="cz-tile-acts">{effective !== undefined && <Pill tone={tone}>{word}</Pill>}{action}</div>}</section>;
}
