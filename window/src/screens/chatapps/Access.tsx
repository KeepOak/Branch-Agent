import { useMemo } from "react";
import type { WindowEngine } from "../../connect/engine";
import { useRow, type Row } from "../settings";
import { useResource } from "../../places/settings/hooks";
import { record } from "../../places/settings/adapter";
import { appRoute, withRoute, type Binding } from "../../places/settings/set1/chatapps-who";
import { trunksOf } from "../../places/settings/set1/chatapps-data";
import type { ChatApp } from "./catalogue";

const bindingRow: Row = { id: "chatapps.answers.bindings", page: "chatapps", card: "Who answers", level: 0, control: "custom", source: { kind: "config", path: "bindings" } };
export function Access({ engine, app }: { engine: WindowEngine; app: ChatApp }) {
  const row = useMemo<Row>(() => ({ id: `chatapps.${app.id}.access`, page: "chatapps", card: "Who may message", level: 0, control: "custom", source: { kind: "config", path: `channels.${app.channel}` } }), [app]);
  const access = useRow(engine, row), routes = useRow(engine, bindingRow);
  const agents = useResource<Record<string, unknown>>(engine, "agents.list");
  const { trunks, defaultId } = trunksOf(agents.data);
  const bindings = (Array.isArray(routes.value) ? routes.value : []) as Binding[];
  const channel = record(access.value);
  const allow = Array.isArray(channel.allowFrom) ? channel.allowFrom : [];
  const policy = typeof channel.dmPolicy === "string" ? channel.dmPolicy : "pairing";
  const setPolicy = (value: string) => {
    const nextAllow = value === "open" ? [...new Set([...allow, "*"])] : allow.filter(v => v !== "*");
    void access.set({ dmPolicy: value, allowFrom: nextAllow }).catch(() => undefined);
  };
  return <section className="r1-ca-access" aria-label={`Access for ${app.name}`}>
    <label>Who answers in {app.name}<select aria-label={`Who answers in ${app.name}`} disabled={routes.state !== "ready" || !trunks.length} value={appRoute(bindings, app.channel!) ?? defaultId} data-need="config.patch agents.list" onChange={e => void routes.set(withRoute(bindings, app.channel!, null, e.target.value === defaultId ? null : e.target.value)).catch(() => undefined)}>{!trunks.length && <option value="">Loading Trunks…</option>}{trunks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
    <label>Who may message it<select aria-label={`Who may message ${app.name}`} disabled={access.state !== "ready"} value={policy} data-need="config.patch" onChange={e => setPolicy(e.target.value)}>
      <option value="only-me" disabled>Only me · Coming</option><option value="pairing">People I approve</option><option value="workspace" disabled>Anyone in my workspace · Coming</option><option value="open">Anyone</option><option value="disabled">No one</option>{policy === "allowlist" && <option value="allowlist" disabled>People on the allowlist · Coming</option>}
    </select></label><small>Only me, workspace membership and editing the allowlist come in a later update. Changing who may message keeps everyone already on the allowlist. Changes save immediately.</small>
    {routes.reason && <p role="alert">{routes.reason}</p>}{access.reason && <p role="alert">{access.reason}</p>}{agents.error && <p role="alert">{agents.error}</p>}
  </section>;
}
