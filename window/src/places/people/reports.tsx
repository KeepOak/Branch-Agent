// People › Activity › Reports (§4.6.5.6 line 59): the Team Reports plugin's reports when it is on (team-reports.*),
// otherwise its off row. Turning it on needs its GitHub and Discord sources set up in the engine.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useState } from "react";
import { shownWhy } from "../../shell/shown-why";
import type { WindowEngine } from "../../connect/engine";
import { shows, type Level } from "../../places-nav/level";
import { useOperation, useResource } from "../library/data";
import { num, rec, recs, str } from "./data";
import { Glyph, Section, Seg, Status } from "./ui";

export const REPORTS_OFF = "Needs the engine's Team Reports plugin turned on, with its GitHub and Discord sources.";
const PERIODS = [{ id: "day", name: "Today" }, { id: "week", name: "Week to date" }, { id: "month", name: "Month to date" }];

export function Reports({ engine, level }: { engine: WindowEngine; level: Level }) {
  const status = useResource<unknown>(engine, "team-reports.status");
  if (status.loading) return null;
  if (status.error) return <Section title="Reports"><div className="pp-rows flat"><div className="pp-prow">
    <span className="pp-tile"><Glyph name="pulse" /></span>
    <span className="grow"><b>Reports</b><small>Off until you choose: it reads your team's GitHub and Discord activity and your model writes summaries.</small></span>
    <button type="button" className="btn sm" disabled title={shownWhy(REPORTS_OFF)}>Set up</button></div></div></Section>;
  return <ReportsOn engine={engine} level={level} />;
}

function ReportsOn({ engine, level }: { engine: WindowEngine; level: Level }) {
  const [period, setPeriod] = useState("day");
  const list = useResource<unknown>(engine, "team-reports.list", { period });
  const latest = recs(rec(list.data).periods)[0];
  const key = latest ? str(latest.key) : "";
  const doc = useResource<unknown>(engine, key ? "team-reports.get" : null, { period, key, format: "markdown" });
  const make = useOperation(engine);
  const [made, setMade] = useState<string | null>(null);
  return <Section title="Reports" side={<Seg label="Report period" value={period} options={PERIODS} onChange={setPeriod} />}>
    <Status {...list} />
    {list.data != null && !latest && <p className="pp-hint" style={{ margin: 0 }}>No report for this period yet.</p>}
    {latest && <div className="pp-team">
      <div className="th"><b>{key}</b><span className={str(latest.status) === "closed" ? "pill ok" : "pill idle"}><i />{str(latest.status) === "closed" ? "Complete" : "So far"}</span></div>
      <p>{num(latest.activeMembers) ?? 0} people active · made {new Date(num(latest.generatedAtMs) ?? 0).toLocaleString()}</p>
      <Status {...doc} />
      {doc.data != null && <pre className="pp-report">{str(rec(doc.data).markdown)}</pre>}
    </div>}
    {shows(level, "advanced") && <div className="pp-acts" style={{ marginTop: 8 }}>
      <button type="button" className="btn sm" disabled={make.busy} onClick={() => void make.run<unknown>("team-reports.generate", { period: "day" }, r => { setMade(str(rec(r).runId)); list.reload(); })}>{make.busy ? "Making the report…" : "Make today's report"}</button>
      {made && <span role="status" className="pp-mut">Started: run {made}</span>}{make.error && <span role="alert" className="pp-error">{make.error}</span>}</div>}
  </Section>;
}
