// The approval card (DESIGN-SPEC §4.2.3 and its Parity adds "Command approval details", "Expires in",
// "Always allow not offered", "Approval keys"), answered through exec.approval.resolve (plugin.approval.resolve
// for a plugin's request). Trust details (covers, careful yes, mixed alphabets, masked secrets, look-only)
// are ported from design/spec-v23/index.html pb18. Hooks: data-testid="approval-card", data-state, and
// data-action on each button.
import { Fragment, useEffect, useState } from "react";
import { Pebble } from "../face/Pebble";
import { canAnswer, isCurrent, useNow } from "./approval-guard";
import { alwaysAllowCover, canDecideApprovals, CAREFUL_READ_CHARS, CAREFUL_WAIT_MS, isCarefulCommand, isDesktopSurface, maskCommand, mixedAlphabets, reachedEnd } from "./approval-trust";
import { useThread } from "./context";
import { clockLeft } from "./format";
import { Icon, ICONS } from "./icons";
import type { Approval, ApprovalDecision } from "./model";
import type { ApprovalDetails } from "./useEngineData";

type Props = {
  approval: Approval;
  details?: ApprovalDetails;
  name: string;
  onAnswer: (id: string, decision: ApprovalDecision) => void;
  disabled?: boolean;
  /** False when this person can look but not decide (preview S.person !== 0). */
  canDecide?: boolean;
};

const WARN_MS = 120_000;

/** The verbs on an action's card, as the preview words them (verbG18 / nopeG18): "Send it" and "Don’t send" for a
 *  request that sends, otherwise "Allow" and "Deny". */
export function actionWords(title: string): { yes: string; no: string; done: string; refused: string } {
  return /^send\b/i.test(title.trim())
    ? { yes: "Send it", no: "Don’t send", done: "Sent", refused: "Not sent" }
    : { yes: "Allow", no: "Deny", done: "Allowed", refused: "Refused" };
}

/** A plugin's description split into the card's rows ("To: Dana", "Subject: …") and the rest, its body. */
export function actionFields(description: string): { fields: [string, string][]; body: string } {
  const fields: [string, string][] = [];
  const rest: string[] = [];
  for (const line of description.split(/\r?\n/)) {
    const m = /^([A-Z][\w ]{0,23}):\s+(.+)$/.exec(line.trim());
    if (m && !rest.length) fields.push([m[1], m[2]]);
    else rest.push(line);
  }
  return { fields, body: rest.join("\n").trim() };
}

function Decided({ approval, details, name, expired }: { approval: Approval; details?: ApprovalDetails; name: string; expired: boolean }) {
  const always = approval.always || details?.decision === "allow-always";
  const allowed = approval.state === "allowed";
  const act = details?.plugin ? actionWords(details.title ?? "") : null;
  const words = expired && !allowed
    ? "Expired · not allowed"
    : allowed
      ? act ? (always ? `${act.done} · ${name} may now do this without asking` : act.done) : always ? `Allowed · ${name} may now run this command without asking` : "Allowed"
      : act ? act.refused : "Refused";
  return (
    <div className="decided indent" data-testid="approval-card" data-state={allowed ? "allowed" : "denied"} data-always={always ? "true" : undefined}>
      <span className={allowed ? "pill ok" : "pill bad"}>{words}</span>
      <span>{details?.plugin ? (details.title ?? "").replace(/\?$/, "") : "Run this command"}</span>
      {details?.plugin ? null : <code>{maskCommand(approval.command || details?.command || "")}</code>}
    </div>
  );
}

function commandOf(approval: Approval, details?: ApprovalDetails): string {
  return approval.command || details?.command || "";
}

function hostOf(approval: Approval, details?: ApprovalDetails): string | undefined {
  return details?.host ?? approval.host;
}

function useCarefulAllow(careful: boolean, long: boolean): { hold: boolean; unread: boolean; onRead: (el: HTMLElement) => void } {
  const [shownAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [read, setRead] = useState(false);
  useEffect(() => {
    if (!careful) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [careful]);
  const unread = careful && long && !read;
  return {
    hold: (careful && now - shownAt < CAREFUL_WAIT_MS) || unread,
    unread,
    onRead: (el) => {
      if (reachedEnd(el)) setRead(true);
    },
  };
}

function Rows({ approval, details, open, needRead, unread, onRead }: {
  approval: Approval;
  details?: ApprovalDetails;
  open: boolean;
  needRead: boolean;
  unread: boolean;
  onRead: (el: HTMLElement) => void;
}) {
  const host = hostOf(approval, details);
  const warnings = approval.warnings ?? [];
  const command = commandOf(approval, details);
  return (
    <>
      <dl className="kv">
        <dt>Computer</dt>
        <dd>{!host || host === "gateway" ? "This computer" : host}</dd>
        <dt>Folder</dt>
        <dd>{details?.cwd ?? approval.cwd ?? "Its workspace"}</dd>
        {open ? (
          <>
            {details?.resolvedPath ? (<><dt>Runs</dt><dd>{details.resolvedPath}</dd></>) : null}
            {details?.security ? (<><dt>Rule</dt><dd>{details.security}</dd></>) : null}
            {details?.ask ? (<><dt>Asks</dt><dd>{details.ask}</dd></>) : null}
            {details?.sessionKey ? (<><dt>Conversation</dt><dd>{details.sessionKey}</dd></>) : null}
            <dt>Noticed</dt>
            <dd>{warnings.length ? warnings.join(" · ") : "Nothing unusual"}</dd>
            <dt>Id</dt>
            <dd>{approval.id}</dd>
          </>
        ) : null}
        <dd
          className="kv-body mailbody cmdbody-pb18"
          data-read-pb18={needRead ? approval.id : undefined}
          tabIndex={needRead ? 0 : undefined}
          onScroll={needRead ? (e) => onRead(e.currentTarget) : undefined}
        >
          <code>{maskCommand(command)}</code>
        </dd>
      </dl>
      {mixedAlphabets(command) ? (
        <p className="askline-pb18 warn-pb18" data-testid="approval-mixed">
          <Icon d={ICONS.warn} size={12} />
          This command mixes letters from different alphabets that can look the same.
        </p>
      ) : null}
      {unread ? <p className="askline-pb18" data-testid="approval-read-end">Read to the end to allow</p> : null}
    </>
  );
}

function LookOnly() {
  return <p className="lookonly-pb18" data-testid="approval-lookonly">You can look but not decide. Someone with approval rights decides.</p>;
}

function Buttons({ approval, details, name, onAnswer, disabled, open, setOpen, hold }: Props & { open: boolean; setOpen: (v: boolean) => void; hold: boolean }) {
  const allowed = details?.allowedDecisions ?? ["allow-once", "allow-always", "deny"];
  const always = allowed.includes("allow-always");
  const blocked = Boolean(disabled || hold);
  return (
    <>
      <div className="card-buttons">
        <button type="button" className="btn primary" data-action="allow" disabled={blocked} title={disabled ? "Lockdown is on: nothing leaves this computer." : "Allow once · Ctrl Enter"} onClick={() => onAnswer(approval.id, "allow-once")}>
          Allow once
        </button>
        {always ? (
          <button type="button" className="btn" data-action="always" disabled={blocked} title={disabled ? "Lockdown is on: nothing leaves this computer." : `Always allow for ${name} · Ctrl Shift Enter`} onClick={() => onAnswer(approval.id, "allow-always")}>
            Always allow for {name}
          </button>
        ) : null}
        <button type="button" className="btn ghost" data-action="open" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Close" : "Open"}
        </button>
        <button type="button" className="btn ghost" data-action="deny" title="Don’t · Ctrl D" onClick={() => onAnswer(approval.id, "deny")}>
          Don’t
        </button>
      </div>
      {always ? null : <p className="card-note">Always allow isn’t available for this command: your rules ask every time.</p>}
    </>
  );
}

export function ApprovalCard(props: Props) {
  const { approval, details, name, canDecide } = props;
  const [open, setOpen] = useState(false);
  const pending = approval.state === "pending";
  const now = useNow(pending && Boolean(details?.expiresAtMs));
  const left = details?.expiresAtMs ? details.expiresAtMs - now : null;
  const expired = left !== null && left <= 0;
  const { engine } = useThread();
  const decide = canDecideApprovals(canDecide, engine?.scopes);
  const command = commandOf(approval, details);
  const careful = isCarefulCommand({ desktop: isDesktopSurface(), plugin: details?.plugin, host: hostOf(approval, details) });
  const long = command.length > CAREFUL_READ_CHARS;
  const carefulAllow = useCarefulAllow(pending && !expired && !details?.plugin && careful, long);
  if (!pending || expired) {
    return <Decided approval={approval} details={details} name={name} expired={expired} />;
  }
  if (details?.plugin) {
    return <ActionCard {...props} details={details} left={left} decide={decide} />;
  }
  const always = (details?.allowedDecisions ?? ["allow-once", "allow-always", "deny"]).includes("allow-always");
  return (
    <div className="card ask indent" data-testid="approval-card" data-state="pending" data-approval={approval.id}>
      <div className="card-head">
        <span className="card-title">{details?.plugin ? details.title || "A plugin needs your OK" : "Run this command?"}</span>
        {left !== null ? <span className={left < WARN_MS ? "expires warn" : "expires"}>Expires in {clockLeft(left)}</span> : null}
        <span className="pill wait">
          <i />
          {decide ? "Waiting for you" : "Waiting"}
        </span>
      </div>
      <Rows approval={approval} details={details} open={open} needRead={careful && long} unread={carefulAllow.unread} onRead={carefulAllow.onRead} />
      {always ? (
        <div className="covers-pb18" data-testid="approval-cover">
          <p>{alwaysAllowCover(name)}</p>
        </div>
      ) : null}
      {decide ? <Buttons {...props} open={open} setOpen={setOpen} hold={carefulAllow.hold} /> : <LookOnly />}
    </div>
  );
}

/** The action-shaped card (the preview's askCard): the question, its rows (To, Subject, Attached…) and body, then
 *  "Send it" / "Always allow for <Trunk>" / "Don’t send" (or Allow / Deny). Answered with plugin.approval.resolve. */
function ActionCard({ approval, details, name, onAnswer, disabled, left, decide }: Props & { details: ApprovalDetails; left: number | null; decide: boolean }) {
  const title = details.title || "A plugin needs your OK";
  const words = actionWords(title);
  const { fields, body } = actionFields(details.description ?? "");
  const allowed = details.allowedDecisions;
  return (
    <div className="card ask indent" data-testid="approval-card" data-state="pending" data-approval={approval.id} data-shape="action">
      <div className="card-head">
        <span className="card-title q">{title}</span>
        {left !== null ? <span className={left < WARN_MS ? "expires warn" : "expires"}>Expires in {clockLeft(left)}</span> : null}
        <span className="pill wait">
          <i />
          {decide ? "Waiting for you" : "Waiting"}
        </span>
      </div>
      <dl className="kv">
        {fields.map(([k, v]) => (
          <Fragment key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </Fragment>
        ))}
        {body || details.detail ? <dd className="kv-body mailbody">{[body, details.detail].filter(Boolean).join("\n\n")}</dd> : null}
      </dl>
      {decide ? (
        <div className="card-buttons">
          {allowed.includes("allow-once") ? (
            <button type="button" className="btn primary" data-action="allow" disabled={disabled} title={disabled ? "Lockdown is on: nothing leaves this computer." : `${words.yes} · Ctrl Enter`} onClick={() => onAnswer(approval.id, "allow-once")}>{words.yes}</button>
          ) : null}
          {allowed.includes("allow-always") ? (
            <button type="button" className="btn" data-action="always" disabled={disabled} title={disabled ? "Lockdown is on: nothing leaves this computer." : `Always allow for ${name} · Ctrl Shift Enter`} onClick={() => onAnswer(approval.id, "allow-always")}>Always allow for {name}</button>
          ) : null}
          <button type="button" className="btn ghost" data-action="deny" title={`${words.no} · Ctrl D`} onClick={() => onAnswer(approval.id, "deny")}>{words.no}</button>
        </div>
      ) : <LookOnly />}
    </div>
  );
}

type GroupProps = { approvals: Approval[]; details: Map<string, ApprovalDetails>; name: string; onAnswer: (id: string, decision: ApprovalDecision) => void; disabled?: boolean; canDecide?: boolean };

/** One row of the group: the question, then Yes and No as far as the request allows them, or how it ended. */
function GroupRow({ a, d, name, now, send, disabled, decide }: { a: Approval; d?: ApprovalDetails; name: string; now: number; send: (id: string, decision: ApprovalDecision) => void; disabled?: boolean; decide: boolean }) {
  const q = d?.plugin ? d.title ?? "" : "Run this command?";
  const waiting = a.state === "pending" && isCurrent(d, now);
  const allowed = a.state === "allowed" || (a.state === "pending" && Boolean(d?.decision?.startsWith("allow")));
  const ended = allowed ? "Allowed" : a.state === "pending" && !d?.decision ? "Expired · not allowed" : "Refused";
  return (
    <div className="g-row" data-approval={a.id}>
      <Pebble size={26} label={name} state="idle" priority={50} />
      <span className="g-q">
        <b>{name}: {q}</b>
        <code>{d?.plugin ? d.description ?? "" : maskCommand(a.command || d?.command || "")}</code>
      </span>
      {waiting && decide ? (
        <span className="g-acts">
          {canAnswer(d, "allow-once", now) ? <button type="button" className="btn primary sm" disabled={disabled} title={disabled ? "Lockdown is on: nothing leaves this computer." : undefined} onClick={() => send(a.id, "allow-once")}>Yes</button> : null}
          {canAnswer(d, "deny", now) ? <button type="button" className="btn ghost sm" onClick={() => send(a.id, "deny")}>No</button> : null}
        </span>
      ) : waiting ? null : (
        <span className={allowed ? "pill ok" : "pill bad"}><i />{ended}</span>
      )}
    </div>
  );
}

/** Two things need you at once (the preview's ask2): one row each with Yes and No, and "Yes to both", which
 *  answers each the way its own Yes does. The thread shows it when exactly two approvals wait. Each answer is checked
 *  again when sent (approval-guard), and Yes to both is offered and sent only while every row can still be allowed. */
export function ApprovalGroup({ approvals, details, name, onAnswer, disabled, canDecide }: GroupProps) {
  const pending = approvals.filter((a) => a.state === "pending");
  const now = useNow(pending.some((a) => Boolean(details.get(a.id)?.expiresAtMs)));
  const waiting = pending.filter((a) => isCurrent(details.get(a.id), now)); // a pending row past its expiry waits no more
  const { engine } = useThread();
  const decide = canDecideApprovals(canDecide, engine?.scopes);
  const allOk = (at: number) => decide && pending.length > 1 && pending.every((a) => canAnswer(details.get(a.id), "allow-once", at));
  const send = (id: string, decision: ApprovalDecision) => {
    if (canAnswer(details.get(id), decision, Date.now())) onAnswer(id, decision);
  };
  const both = () => {
    if (allOk(Date.now())) pending.forEach((a) => onAnswer(a.id, "allow-once"));
  };
  return (
    <div className="card ask g-ask indent" data-testid="approval-group">
      <div className="card-head">
        <b className="card-title">Two things need you</b>
        {waiting.length ? (
          <span className="pill wait"><i />{decide ? "Waiting for you" : "Waiting"}</span>
        ) : pending.some((a) => !details.get(a.id)?.decision) ? (
          <span className="pill bad"><i />Expired</span>
        ) : (
          <span className="pill ok"><i />Answered</span>
        )}
      </div>
      {approvals.map((a) => <GroupRow key={a.id} a={a} d={details.get(a.id)} name={name} now={now} send={send} disabled={disabled} decide={decide} />)}
      {decide ? null : <LookOnly />}
      {allOk(now) ? (
        <div className="card-buttons">
          <button type="button" className="btn primary" data-testid="yes-to-all" disabled={disabled} title={disabled ? "Lockdown is on: nothing leaves this computer." : undefined} onClick={both}>
            Yes to both
          </button>
        </div>
      ) : null}
    </div>
  );
}
