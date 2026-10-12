// Settings › Connected agents (Graft is the bridge's name): coding agents (Claude Code, Codex, Gemini CLI, Hermes, any MCP client) that work with
// Branch through `branch graft` (alias `branch mcp serve`). The master switch and per-agent disconnect / window rights are the engine's
// contacts.outside.list / contacts.outside.set; "may message" is each Trunk's agentToAgent deny list for a2a:<id>,
// the same rule Who it knows writes (shell/who-it-knows-menu.tsx) and the gateway enforces on every send.
import type { SettingsPageProps } from "../index";
import { useState } from "react";
import { BranchLinkDialog } from "../../../shell/BranchLinkDialog";
import { Btn, Ctl, Empty, Page, Sec, Switch, useConfig, type RowEntry } from "../kit";
import { RoomAvatar, a2aBadge } from "../../../rooms/RoomMessage";
import { trunkAppearance } from "../../../face/appearance";
import { DesktopCtl } from "../desktop-ctl";
import { CodeRow, rec, str, useCall, useLive, when } from "./common";
import "./agents.css";

const LEDE = "Coding agents connected to Branch: what each may do, and how to connect another.";

export type OutsideAgentRow = {
  id: string; name: string; version?: string; where?: string; project?: string; activity?: string; activityAt?: number;
  lastSeenAt: number; online: boolean; revoked: boolean; mayDriveWindow: boolean;
  /** "branch": another Branch grafted in as a device; "trunk": one of its Trunks (via = that Branch's id). */
  kind?: "branch" | "trunk"; via?: string;
  avatar?: string;
};

export function readAgents(result: unknown): { enabled: boolean; agents: OutsideAgentRow[] } {
  const r = rec(result);
  const agents = (Array.isArray(r.agents) ? r.agents : []).map(rec).filter((a) => str(a.id) && str(a.name)).map((a) => ({
    id: str(a.id), name: str(a.name), version: str(a.version) || undefined, where: str(a.where) || undefined, project: str(a.project) || undefined,
    activity: str(a.activity) || undefined, activityAt: typeof a.activityAt === "number" ? a.activityAt : undefined,
    lastSeenAt: typeof a.lastSeenAt === "number" ? a.lastSeenAt : 0, online: a.online === true, revoked: a.revoked === true, mayDriveWindow: a.mayDriveWindow === true,
    ...(a.kind === "branch" || a.kind === "trunk" ? { kind: a.kind as "branch" | "trunk" } : {}), ...(str(a.via) ? { via: str(a.via) } : {}),
    ...(str(a.avatar).startsWith("branch:") ? { avatar: str(a.avatar) } : {}),
  }));
  return { enabled: r.enabled !== false, agents: agents.toSorted((x, y) => Number(y.online) - Number(x.online) || y.lastSeenAt - x.lastSeenAt) };
}

/** Grafted Branches with their Trunks nested under them; every other agent (and a Trunk whose Branch row is
 *  missing) stays a row of its own. */
export function groupAgents(agents: readonly OutsideAgentRow[]): { row: OutsideAgentRow; trunks: OutsideAgentRow[] }[] {
  const branches = new Set(agents.filter((a) => a.kind === "branch").map((a) => a.id));
  const nested = (a: OutsideAgentRow) => a.kind === "trunk" && !!a.via && branches.has(a.via);
  return agents.filter((a) => !nested(a)).map((row) => ({ row, trunks: row.kind === "branch" ? agents.filter((a) => nested(a) && a.via === row.id) : [] }));
}

/** The lines an agent's owner pastes once. `branch` is the desktop's shim: it always runs the current engine. */
export const CONNECT_LINES: [string, string][] = [
  ["Claude Code", "claude mcp add --scope user branch -- branch graft"],
  ["Codex", "codex mcp add branch -- branch graft"],
  ["Gemini CLI", "gemini mcp add branch branch graft"],
  ["Hermes Agent (~/.hermes/config.yaml)", "mcp_servers:\n  branch:\n    command: branch\n    args: [graft]"],
  ["Any MCP client (stdio)", '{"mcpServers":{"branch":{"command":"branch","args":["graft"]}}}'],
];

export const ROWS: RowEntry[] = [
  { page: "agents", title: "Let other agents work with Branch", group: "Connected agents", lv: 0 },
  ...CONNECT_LINES.map(([title]) => ({ page: "agents", title, sec: "Connect an agent", group: "Connect an agent", lv: 0 as const })),
];

type Trunk = { id: string; name: string };

/** "Claude Code · Branch-Agent", plus "· session 2" when a second session in the same folder got `<id>-2`. */
export function agentTitle(agent: Pick<OutsideAgentRow, "id" | "name" | "project">): string {
  const session = /-[0-9a-f]{6}-(\d+)$/.exec(agent.id)?.[1];
  return [agent.name, agent.project, session ? `session ${session}` : undefined].filter(Boolean).join(" · ");
}

/** The product-wide id from before per-session ids (engine contacts/outside-agents.ts legacyOutsideId). */
export function legacyOutsideId(id: string): string | undefined {
  return /^(.+)-[0-9a-f]{6}(?:-\d+)?$/.exec(id)?.[1];
}

/**
 * The Trunk's deny list after this agent's "May message" switch: its own `a2a:<id>` entry, and a product-wide
 * `a2a:<product>` entry written before per-session ids turned into entries for the product's other sessions, so
 * one session's switch never changes the others.
 */
export function nextDeny(current: readonly string[], id: string, allow: boolean, sessions: readonly string[]): string[] {
  const legacy = legacyOutsideId(id);
  const expanded = legacy && current.includes(`a2a:${legacy}`)
    ? [...current.filter((v) => v !== `a2a:${legacy}`), ...sessions.filter((s) => legacyOutsideId(s) === legacy).map((s) => `a2a:${s}`)]
    : [...current];
  const set = new Set(expanded);
  if (allow) set.delete(`a2a:${id}`); else set.add(`a2a:${id}`);
  return [...set];
}

function trunksOf(result: unknown): Trunk[] {
  const list = rec(result).agents;
  return (Array.isArray(list) ? list : []).map(rec).filter((a) => str(a.id) && a.kind !== "system")
    .map((a) => ({ id: str(a.id), name: str(rec(a.identity).name) || str(a.name) || str(a.id) }));
}

function AgentRow({ agent, trunks, props, reload, sessions, nested = [] }: { agent: OutsideAgentRow; trunks: Trunk[]; props: SettingsPageProps; reload: () => void; sessions: string[]; nested?: OutsideAgentRow[] }) {
  const isBranch = agent.kind === "branch";
  const config = useConfig(props.engine);
  const call = useCall();
  const set = (change: Record<string, unknown>) => void call.run(async () => { await props.engine.request("contacts.outside.set", { id: agent.id, ...change }); reload(); });
  const denyPath = (trunk: string) => ["agents", "entries", trunk, "agentToAgent", "deny"];
  const legacy = legacyOutsideId(agent.id);
  const denied = (trunk: string) => { const d = config.get(denyPath(trunk)); return Array.isArray(d) && (d.includes(`a2a:${agent.id}`) || (!!legacy && d.includes(`a2a:${legacy}`))); };
  const allow = (trunk: string, on: boolean) => {
    const d = config.get(denyPath(trunk));
    const current = Array.isArray(d) ? d.filter((v): v is string => typeof v === "string") : [];
    void config.set(denyPath(trunk), nextDeny(current, agent.id, on, sessions));
  };
  const seen = agent.online ? "Online now" : agent.lastSeenAt ? `Last seen ${when(agent.lastSeenAt)}` : "Not seen yet";
  const doing = agent.activity ? ` · ${agent.activity}${agent.activityAt ? ` (${when(agent.activityAt)})` : ""}` : "";
  return (
    <div className="sec" data-testid="connected-agent" data-agent={agent.id} data-kind={agent.kind}>
      <h3 className="ca-head">
        <RoomAvatar id={agent.id} name={agent.name} size={28} online={agent.online} />
        <span className="ca-name">{agentTitle(agent)}</span>
        {isBranch ? <span className="ca-badge" data-testid="branch-badge">Branch</span> : null}
        <span className="rm-tag">{a2aBadge(agent.where ?? null)}</span>
      </h3>
      <p className="hint">{agent.revoked ? "Disconnected" : seen}{doing}{agent.version ? ` · version ${agent.version}` : ""}</p>
      {nested.length ? (
        <ul className="ca-trunks" aria-label={`${agent.name}'s Trunks`}>
          {nested.map((t) => (
            <li key={t.id} className="ca-trunk" data-testid="grafted-trunk" data-agent={t.id}>
              <RoomAvatar id={t.id} name={t.name} size={20} src={trunkAppearance(t.avatar, t.name)?.still} online={t.online && !agent.revoked} />
              <span className="ca-name">{t.name}</span>
              <span className="hint">{agent.revoked || t.revoked ? "Disconnected" : t.online ? "Online now" : t.lastSeenAt ? `Last seen ${when(t.lastSeenAt)}` : "Not seen yet"}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {trunks.map((t) => (
        <Ctl key={t.id} id={`${agent.id}-${t.id}`} title={`May message ${t.name}`} noPin>
          <Switch label={`${agent.name} may message ${t.name}`} checked={!denied(t.id)} disabled={config.loading} onChange={(on) => allow(t.id, on)} />
        </Ctl>
      ))}
      <Ctl id={`${agent.id}-window`} title="May use your Branch window" sub="Also needs About Branch › Let agents use this window." help="Also needs About Branch › Let agents use this window. Without it the agent gets its own test Branch." noPin>
        <Switch label={`${agent.name} may use your Branch window`} checked={agent.mayDriveWindow} disabled={call.busy} onChange={(on) => set({ mayDriveWindow: on })} />
      </Ctl>
      {isBranch ? (
        <Ctl id={`${agent.id}-connection`} title={agent.revoked ? "Disconnected" : "Disconnect"} sub={agent.revoked ? "Its pairing was removed. To bring it back, give it a new setup code (branch graft invite) and run branch graft join on it." : "Removes this Branch's pairing and its Trunks from your contacts. It needs a new setup code to join again."} noPin>
          {agent.revoked ? null : <Btn sm disabled={call.busy} onClick={() => set({ revoked: true })}>Disconnect</Btn>}
        </Ctl>
      ) : (
        <Ctl id={`${agent.id}-connection`} title={agent.revoked ? "Let it connect again" : "Disconnect"} sub={agent.revoked ? "It can work with your Trunks again the next time it connects." : "It stops working with Branch within a minute, until you let it back."} noPin>
          <Btn sm disabled={call.busy} onClick={() => set({ revoked: !agent.revoked })}>{agent.revoked ? "Reconnect" : "Disconnect"}</Btn>
        </Ctl>
      )}
      {call.error ? <p className="hint" role="alert">{call.error}</p> : null}
    </div>
  );
}

export function AgentsPage(props: SettingsPageProps) {
  const [linking, setLinking] = useState(false);
  const live = useLive<unknown>(props.engine, "contacts.outside.list", {}, ["contacts.changed"]);
  const roster = useLive<unknown>(props.engine, "agents.list", {}, ["config.changed"]);
  const call = useCall();
  const { enabled, agents } = readAgents(live.data);
  const trunks = trunksOf(roster.data);
  const reload = () => void live.reload();
  return (
    <Page title={props.title} lede={LEDE}>
      <Sec title="">
        <Ctl title="Let other agents work with Branch" sub="Connected agents may message your Trunks and join groups." help="Claude Code, Codex, Hermes and other connected agents may see your Trunks, message them and join group chats. Off turns every one of them away." off={live.error ? String(live.error) : undefined}>
          <Switch label="Let other agents work with Branch" checked={enabled} disabled={live.loading || call.busy} onChange={(on) => void call.run(async () => { await props.engine.request("contacts.outside.set", { enabled: on }); reload(); })} />
        </Ctl>
      </Sec>
      {agents.length ? groupAgents(agents).map(({ row, trunks: nested }) => <AgentRow key={row.id} agent={row} nested={nested} trunks={trunks} props={props} reload={reload} sessions={agents.map((x) => x.id)} />) : (
        <Sec title="Connected agents"><Empty>No agent is connected yet. Paste one of the lines below into it.</Empty></Sec>
      )}
      <Sec title="Another Branch" hint="Link a teammate's computer with a one-time code or QR.">
        <button type="button" className="btn" onClick={() => setLinking(true)}>Link another Branch</button>
      </Sec>
      <Sec title="Connect an agent" hint="Each line is pasted once." help="Each line is pasted once. It runs the branch command, which always uses the Branch on this computer, so it keeps working after updates.">
        <DesktopCtl title="Type branch in any terminal" sub="Needed for these lines: adds the branch command." name="branchOnPath" />
        {CONNECT_LINES.map(([title, code]) => <CodeRow key={title} title={title} code={code} />)}
      </Sec>
      {linking && <BranchLinkDialog engine={props.engine} onClose={() => setLinking(false)} onLinked={reload} />}
    </Page>
  );
}
