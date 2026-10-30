// Settings › People › Visitors. Invite, list and revoke go through visitor.invite, visitor.list and
// visitor.revoke. The access policy is visitor.policy. The Gateway keeps the Cloudflare token; this
// form never asks for one.
import { useState } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { isUnknownMethod } from "../../../connect/capabilities";
import { list, record, visible, type RecordValue } from "../adapter";
import { useResource } from "../hooks";
import { Btn, Ctl, Empty, Plist, Prow, Sec, NOSETUP, useLevel } from "../kit";

type Policy = {
  policyName: string;
  defaultTtlDays: number | null;
  maxVisitors: number;
  roleId: string | null;
  roleBound: boolean;
};

const MANAGED = "Visitor invitations are managed by this Branch. They aren't set up on this computer yet.";

function policyOf(data: unknown): Policy | null {
  const policy = record(record(data).policy);
  if (policy.managed !== true || typeof policy.policyName !== "string" || !policy.policyName.trim()) return null;
  return {
    policyName: policy.policyName,
    defaultTtlDays: typeof policy.defaultTtlDays === "number" ? policy.defaultTtlDays : null,
    maxVisitors: typeof policy.maxVisitors === "number" ? policy.maxVisitors : 0,
    roleId: typeof policy.roleId === "string" ? policy.roleId : null,
    roleBound: policy.roleBound === true,
  };
}

/** Regular and Advanced never show a raw role id or an internal policy name such as "(branch-managed)". */
function plainPolicyName(name: string): string {
  const stripped = name.replace(/\s*\(\s*branch-managed\s*\)/gi, "").replace(/\s{2,}/g, " ").trim();
  return stripped && !/^branch-managed$/i.test(stripped) ? stripped : "Visitors";
}

function policyLine(policy: Policy, technical: boolean): string {
  const length = policy.defaultTtlDays === null || policy.defaultTtlDays === 0
    ? "Each invitation sets its own length"
    : `Invitations last ${policy.defaultTtlDays} ${policy.defaultTtlDays === 1 ? "day" : "days"}`;
  const name = technical ? policy.policyName : plainPolicyName(policy.policyName);
  const role = technical
    ? (policy.roleBound && policy.roleId
      ? `The ${policy.roleId} role uses this access policy.`
      : "The default role is not using this access policy yet.")
    : (policy.roleBound
      ? "Guests you invite use this access policy."
      : "Guests are not using this access policy yet.");
  return `${name}. ${length}, up to ${policy.maxVisitors}. ${role}`;
}

function personTitle(row: RecordValue): string {
  if (typeof row.email === "string" && row.email) return row.email;
  if (typeof row.githubLogin === "string" && row.githubLogin) return `@${row.githubLogin}`;
  if (typeof row.githubAccountId === "number") return `GitHub account ${row.githubAccountId}`;
  return "Visitor";
}

function revokeParams(row: RecordValue): Record<string, string> | null {
  if (typeof row.profileId === "string" && row.profileId) return { profileId: row.profileId };
  if (typeof row.grantId === "string" && row.grantId) return { grantId: row.grantId };
  if (typeof row.email === "string" && row.email) return { email: row.email };
  if (typeof row.githubLogin === "string" && row.githubLogin) return { github: row.githubLogin };
  return null;
}

function until(expiresAt: unknown): string {
  if (expiresAt === null) return "Does not expire";
  if (typeof expiresAt !== "string") return "";
  const when = new Date(expiresAt);
  if (Number.isNaN(when.getTime())) return "";
  return `Until ${when.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

const STATE: Record<string, string> = {
  managed: "Invited",
  expired: "Expired",
  missing_from_policy: "Missing from the access policy",
};

function rowSub(row: RecordValue, unmanaged = false): string {
  return [
    unmanaged ? "Not recorded by Branch" : STATE[String(row.state)] ?? "Invited",
    until(row.expiresAt),
    typeof row.gatewayAccess === "string" ? visible(row.gatewayAccess) : "",
  ].filter(Boolean).join(" · ");
}

export function VisitorAccess({ engine, admin }: { engine: WindowEngine; admin: boolean }) {
  const technical = useLevel() >= 2;
  const policyRes = useResource<RecordValue>(engine, "visitor.policy", {});
  const listRes = useResource<RecordValue>(engine, "visitor.list", {});
  const policy = policyOf(policyRes.data);
  const quiet = !policy && (policyRes.error ? isUnknownMethod(policyRes.error) : !policyRes.loading);
  const [email, setEmail] = useState("");
  const [github, setGithub] = useState("");
  const [days, setDays] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const lock = admin ? undefined : NOSETUP;

  const reload = async () => { await listRes.reload(); };
  const run = async (action: () => Promise<void>) => {
    if (busy || !admin) return;
    setBusy(true);
    setNote(null);
    try { await action(); }
    catch (error) { setNote(error instanceof Error ? error.message : "That didn’t work."); }
    finally { setBusy(false); }
  };
  const invite = () => run(async () => {
    const mail = email.trim();
    const login = github.trim().replace(/^@/, "");
    if ((mail === "") === (login === "")) throw new Error("Enter an email or a GitHub login.");
    const length = days.trim();
    const span = length === "" ? undefined : Number(length);
    if (span !== undefined && (!Number.isInteger(span) || span < 1 || span > 3650)) {
      throw new Error("Invitation length is a number of days from 1 to 3650.");
    }
    await engine.request("visitor.invite", { ...(mail ? { email: mail } : { github: login }), ...(span !== undefined ? { days: span } : {}) });
    setEmail("");
    setGithub("");
    setDays("");
    setNote("Invited.");
    await reload();
  });
  const revoke = (row: RecordValue) => run(async () => {
    const params = revokeParams(row);
    if (!params) throw new Error("List visitors again, then revoke that person.");
    await engine.request("visitor.revoke", params);
    setNote("Access revoked.");
    await reload();
  });

  const grants = list(listRes.data?.grants);
  const unmanaged = list(listRes.data?.unmanaged);
  const counts = record(listRes.data?.counts);
  const drift = [
    typeof counts.unmanaged === "number" && counts.unmanaged > 0 ? `${counts.unmanaged} not recorded by Branch` : "",
    typeof counts.missingFromPolicy === "number" && counts.missingFromPolicy > 0 ? `${counts.missingFromPolicy} missing from the access policy` : "",
  ].filter(Boolean).join(", ");

  return (
    <Sec title="Visitors" hint="People you invite sign in with that email or GitHub account. Invitations are managed by this Branch, so you never paste a token.">
      {policy ? <Ctl title="Access policy" sub={policyLine(policy, technical)} /> : (
        <Ctl title="Access policy" off={quiet ? MANAGED : policyRes.loading ? "Reading the access policy…" : visible(policyRes.error ?? MANAGED)} />
      )}
      {policy ? (
        <>
          {listRes.loading && !listRes.data ? <p className="hint">Reading visitors…</p> : listRes.error ? <p className="va-note">{visible(listRes.error)}</p> : (
            <>
              {drift ? <p className="hint">{drift}.</p> : null}
              {grants.length || unmanaged.length ? (
                <Plist>
                  {grants.map((row) => {
                    const title = personTitle(row);
                    return <Prow key={String(row.grantId ?? row.profileId ?? title)} title={visible(title)} sub={rowSub(row)}>
                      <Btn sm ghost disabled={!admin || busy || !revokeParams(row)} title={lock} aria-label={`Revoke ${title}`} onClick={() => void revoke(row)}>Revoke</Btn>
                    </Prow>;
                  })}
                  {unmanaged.map((row) => {
                    const title = personTitle(row);
                    return <Prow key={`unmanaged-${title}`} title={visible(title)} sub={rowSub(row, true)}>
                      <Btn sm ghost disabled={!admin || busy || !revokeParams(row)} title={lock} aria-label={`Revoke ${title}`} onClick={() => void revoke(row)}>Revoke</Btn>
                    </Prow>;
                  })}
                </Plist>
              ) : <Empty>No visitors yet.</Empty>}
            </>
          )}
          <Ctl title="Invite a visitor" stack off={lock}>
            <span className="va-form">
              <label className="fld"><span>Email</span><input className="inp" type="email" aria-label="Visitor email" value={email} disabled={!admin || busy} onChange={(e) => setEmail(e.target.value)} /></label>
              <label className="fld"><span>GitHub login</span><input className="inp" aria-label="GitHub login" value={github} disabled={!admin || busy} placeholder="octocat" onChange={(e) => setGithub(e.target.value)} /></label>
              <label className="fld"><span>Days</span><input className="inp" inputMode="numeric" aria-label="Invitation length in days" value={days} disabled={!admin || busy} placeholder={policy.defaultTtlDays ? String(policy.defaultTtlDays) : "Set on each invitation"} onChange={(e) => setDays(e.target.value)} /></label>
              <Btn pri sm disabled={!admin || busy} onClick={() => void invite()}>Invite</Btn>
              {note ? <p className="va-note">{note}</p> : null}
            </span>
          </Ctl>
        </>
      ) : null}
    </Sec>
  );
}
