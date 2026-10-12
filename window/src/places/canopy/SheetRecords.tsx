// The card sheet's Activity tab (timeline; [A] proof, made, attachments, failed attempts, worker log, checks;
// [T] worker rules) and Details tab [T], from the card's own engine record (CanopyCard.events / metadata).
import { Fragment } from "react";
import { shows } from "../../places-nav/level";
import { rec, rows, str, type Row } from "../automations/runtime";
import { statusName, meta } from "./cards-model";
import { Pill, Sec, when, type Ctx } from "./ui";

const WORDS: Record<string, string> = {
  created: "Created", edited: "Edited", linked: "Conversation linked", specified: "Made clear", decomposed: "Split", claimed: "Claimed",
  heartbeat: "Still working", comment_added: "Note added", link_added: "Link added", proof_added: "Proof added", artifact_added: "Made a file",
  attachment_added: "Attachment added", diagnostic: "Warning", notification: "Notice", dispatch: "Started by Start Trunks", orchestration: "Organised",
  protocol_violation: "Broke the card rules", archived: "Archived", unarchived: "Restored", stale: "Conversation went quiet",
};

export function eventWords(e: Row, attempt: number): string {
  if (e.kind === "moved") return `Moved to ${statusName(str(e.toStatus))}`;
  if (e.kind === "attempt_started") return `Attempt ${attempt} started`;
  return WORDS[str(e.kind)] ?? "";
}

function Timeline({ c }: { c: Row }) {
  let n = 0;
  const list = rows(c.events).map(e => ({ e, w: eventWords(e, e.kind === "attempt_started" ? ++n : n) })).filter(x => x.w).reverse();
  return list.length ? <ol className="cn-tl">{list.map(({ e, w }) => <li key={str(e.id)}><span>{w}</span><time>{when(e.at)}</time></li>)}</ol> : <p className="cn-hint cn-flush">Nothing has happened yet.</p>;
}

/** Opens a card attachment from canopy.cards.attachments.get ({attachment, contentBase64}) in a new window, or saves it. */
export async function openAttachment(ctx: Ctx, id: string) {
  const got = rec(await ctx.engine.request("canopy.cards.attachments.get", { id })), info = rec(got.attachment), b64 = str(got.contentBase64);
  if (!b64) throw new Error("The engine returned no content for this attachment.");
  const bytes = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: str(info.mimeType) || "application/octet-stream" }));
  if (!window.open(url, "_blank")) { const a = document.createElement("a"); a.href = url; a.download = str(info.fileName) || "attachment"; a.click(); }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return got;
}

export function ActivityTab({ ctx, c }: { ctx: Ctx; c: Row }) {
  if (!shows(ctx.level, "advanced")) return <Timeline c={c} />;
  const m = meta(c), proof = rows(m.proof), made = rows(m.artifacts), files = rows(m.attachments), logs = rows(m.workerLogs);
  const failed = rows(m.attempts).map((a, i) => ({ a, i: i + 1 })).filter(x => x.a.status === "failed"), checks = rows(m.diagnostics), proto = rec(m.workerProtocol);
  const none = (t: string) => <p className="cn-hint cn-flush">{t}</p>;
  return <>
    <Timeline c={c} />
    <Sec title="Proof">{proof.length ? <>{proof.map(p => <p className="cn-cm" key={str(p.id)}><Pill tone={p.status === "passed" ? "ok" : p.status === "failed" ? "bad" : "idle"}>{str(p.status).replace(/^./, s => s.toUpperCase())}</Pill> {str(p.label) || str(p.command) || str(p.note)}</p>)}
      <p className="cn-hint cn-flush">Reported by the Trunk, not checked by Branch.</p></> : none("No proof yet.")}</Sec>
    <Sec title="Made">{made.length ? made.map(a => <p className="cn-cm" key={str(a.id)}>{str(a.label) || str(a.path) || str(a.url)}</p>) : none("Nothing made yet.")}</Sec>
    <Sec title="Attachments">{files.length ? files.map(f => <p className="cn-cm" key={str(f.id)}>{str(f.fileName)} <small className="cn-hint">{Math.ceil(Number(f.byteSize) / 1024)} KB</small>
      <button className="btn ghost sm" type="button" disabled={ctx.busy} onClick={() => void ctx.act(() => openAttachment(ctx, str(f.id)), `Opened ${str(f.fileName)}.`)}>Open</button></p>) : none("No attachments.")}</Sec>
    <Sec title="Failed attempts">{failed.length ? failed.map(({ a, i }) => <p className="cn-cm" key={str(a.id)}><b>Attempt {i}</b> {when(a.endedAt || a.startedAt)}{str(a.model) ? ` · ${str(a.model)}` : ""} · <span className="cn-err">{str(a.error) || "Failed"}</span></p>) : none("None.")}</Sec>
    <Sec title="Worker log">{logs.length ? <pre className="cn-log">{logs.map(l => `${when(l.createdAt)} ${str(l.message)}`).join("\n")}</pre> : none("Nothing logged yet.")}</Sec>
    <Sec title="Checks" extra={<button className="btn ghost sm" type="button" disabled={!ctx.write || ctx.busy} onClick={() => void ctx.act(() => ctx.engine.request("canopy.cards.diagnostics.refresh", {}), "Checked again.")}>Check again</button>}>
      {checks.length ? <ul className="cn-warns">{checks.map((d, i) => <li key={i}>{str(d.title)}{str(d.detail) ? ` · ${str(d.detail)}` : ""}</li>)}</ul> : none("No warnings.")}</Sec>
    {shows(ctx.level, "technical") ? <Sec title="Worker rules"><dl className="kv cn-kv"><dt>Protocol</dt><dd>{str(proto.state) || "idle"}{str(proto.detail) ? ` · ${str(proto.detail)}` : ""}</dd><dt>Claim</dt><dd>{str(rec(m.claim).ownerId) || "—"}</dd></dl></Sec> : null}
  </>;
}

export function DetailsTab({ c }: { c: Row }) {
  const m = meta(c), claim = rec(m.claim), auto = rec(m.automation), attempts = rows(m.attempts);
  const secs = (n: unknown) => Number(n) > 0 ? `${Number(n)} s` : "";
  const kv: [string, string][] = [
    ["Claimed by", str(claim.ownerId)], ["Last sign of life", Number(claim.lastHeartbeatAt) > 0 ? when(claim.lastHeartbeatAt) : ""], ["Starts", attempts.length ? String(attempts.length) : ""],
    ["Last start", attempts.length ? when(attempts[attempts.length - 1].startedAt) : ""], ["Time limit", secs(auto.maxRuntimeSeconds)], ["Retry limit", Number(auto.maxRetries) >= 0 && auto.maxRetries !== undefined ? String(auto.maxRetries) : ""],
    ["Team", str(auto.tenant)], ["Project folder", str(rec(auto.workspace).path)], ["Skills", Array.isArray(auto.skills) ? auto.skills.join(", ") : ""],
    ["Failed attempts", attempts.filter(a => a.status === "failed").length ? String(attempts.filter(a => a.status === "failed").length) : ""], ["Notices", rows(m.notifications).length ? String(rows(m.notifications).length) : ""],
  ];
  return <dl className="kv cn-kv">{kv.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v || "—"}</dd></Fragment>)}</dl>;
}
