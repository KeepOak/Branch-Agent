// Settings › People: Each person (switching PIN, separate conversations), and at Advanced the records (audit.list,
// the engine's newest-first run and tool record) and how people sign in to Branch, greyed where the engine has no
// setting yet.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useState } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { list, record, visible } from "../adapter";
import { useResource } from "../hooks";
import { Dialog } from "../../../shell/Dialog";
import { Acts, Btn, Ctl, Empty, Pick, Pill, Plist, Prow, Sec, Seg, Switch } from "../kit";
import { ago, type Roles } from "./people-data";

const NO_KEY = "Branch has no setting for this yet.";

/** On when every role hides other people's conversations (gateway.roles.definitions.*.sessions.others = "none").
 *  No roles (a fresh install) is on: no role grants access. Unset others is off: the engine treats that as not "none". */
export function separate(roles: Roles): boolean {
  return Object.values(roles.defs).every((d) => record(d.sessions).others === "none");
}

/** Opens the People place at a tab (WindowShell's branch:navigate-place). Settings › People stays in Settings; this is the obvious way out. */
export function openPeople(tab?: string) {
  window.dispatchEvent(new CustomEvent("branch:navigate-place", { detail: { place: "people", ...(tab ? { tab } : {}) } }));
}

export function EachPerson({ roles }: { roles: Roles }) {
  return (
    <>
      <Sec title="Each person">
        <Ctl title="Ask for a PIN when switching person" sub="At least four digits, kept on this computer." help="At least four digits, kept on this computer. Five wrong tries in a row tell the owner." off={NO_KEY}>
          <Switch checked label="Ask for a PIN when switching person" onChange={() => undefined} />
        </Ctl>
        <Ctl title="Keep conversations separate" sub="People can’t read each other’s conversations unless they share one." off={roles.names.length ? "Each role sets this in the settings file." : "No roles are set up on this Gateway yet."}>
          <Switch checked={separate(roles)} label="Keep conversations separate" onChange={() => undefined} />
        </Ctl>
        <Ctl title="Open People" sub="The People place: who’s here now, groups, what you share, and signing in from other devices.">
          <Btn sm onClick={() => openPeople()}>Open People</Btn>
        </Ctl>
      </Sec>
      <Acts>
        <Btn ghost sm onClick={() => openPeople("Groups")}>Groups</Btn>
        <Btn ghost sm onClick={() => openPeople("Signing in")}>Signing in from other devices</Btn>
        <Btn ghost sm onClick={() => openPeople("Shared")}>What you share</Btn>
      </Acts>
    </>
  );
}

export function Records({ engine, trunks }: { engine: WindowEngine; trunks: Map<string, string> }) {
  const [open, setOpen] = useState(false);
  return (
    <Sec title="Records">
      <Ctl title="Signed household records" sub="Sign people’s changes so you can see who did what." help="Changes people make are signed, so it’s clear who did what; code changes come as patches.">
        <Btn sm onClick={() => setOpen(true)}>See the last</Btn>
      </Ctl>
      {open ? <RecordsDialog engine={engine} trunks={trunks} onClose={() => setOpen(false)} /> : null}
    </Sec>
  );
}

const STATUS: Record<string, [string, "ok" | "warn" | "bad" | "idle" | "work"]> = {
  started: ["Started", "work"], succeeded: ["Done", "ok"], failed: ["Failed", "bad"], cancelled: ["Stopped", "idle"],
  timed_out: ["Timed out", "warn"], blocked: ["Blocked", "warn"], unknown: ["Unknown", "idle"],
};

function RecordsDialog({ engine, trunks, onClose }: { engine: WindowEngine; trunks: Map<string, string>; onClose: () => void }) {
  const res = useResource(engine, "audit.list", { limit: 20 });
  const events = list(record(res.data).events);
  return (
    <Dialog title="Signed household records" onClose={onClose}>
      {res.loading ? <p className="hint">Reading the record…</p> : res.error ? <p className="err-pp">{visible(res.error)}</p> : events.length ? (
        <>
          <p className="lede-pp">Recent:</p>
          <Plist>
            {events.map((e) => {
              const [word, tone] = STATUS[String(e.status)] ?? STATUS.unknown;
              const who = trunks.get(String(e.agentId)) ?? visible(e.agentId);
              const what = e.toolName ? visible(e.toolName) : e.kind === "agent_run" ? "A run" : "A tool";
              return <Prow key={String(e.eventId)} title={`${who} · ${what}`} sub={typeof e.occurredAt === "number" ? ago(e.occurredAt) : undefined}><Pill tone={tone}>{word}</Pill></Prow>;
            })}
          </Plist>
        </>
      ) : <Empty>Nothing recorded yet.</Empty>}
    </Dialog>
  );
}

const sw = (title: string, sub: string | undefined, on: boolean) => (
  <Ctl key={title} title={title} sub={sub} off={NO_KEY}><Switch checked={on} label={title} onChange={() => undefined} /></Ctl>
);
const SSO = ["None", "OpenID Connect", "SAML", "LDAP or Active Directory", "The sign-in proxy in front"].map((l) => ({ id: l, label: l }));

/** How people sign in to this Branch (Advanced). The engine has none of these settings yet. */
export function SigningIn() {
  return (
    <Sec title="Signing in to Branch">
      {sw("Passkeys", "People sign in with their device’s face, finger or PIN.", true)}
      {sw("Authenticator codes", "A six-digit code as a second step, with backup codes.", false)}
      {sw("A link by email", "A one-time link instead of a password.", false)}
      {sw("Google, GitHub or Apple", "People sign in with an account they already have.", false)}
      <Ctl title="Company sign-in" sub="Roles and groups come across with it." off={NO_KEY}><Pick label="Company sign-in" value="None" options={SSO} onChange={() => undefined} /></Ctl>
      <Ctl title="New people" off={NO_KEY}><Seg label="New people" value="invite" options={[{ id: "invite", label: "By invite only" }, { id: "yes", label: "Anyone, after my yes" }]} onChange={() => undefined} /></Ctl>
      <Ctl stack title="Allowed email domains" sub="One per line. Empty: any." off={NO_KEY}><input className="inp" aria-label="Allowed email domains" /></Ctl>
      {sw("Check their email first", undefined, true)}
      {sw("A check against bots on the sign-in page", "Off until you choose: it loads a check from Cloudflare.", false)}
      {sw("Add people from your directory", "Your company’s directory adds and removes people (SCIM).", false)}
      {sw("One-time sign-in links for other systems", "Short-lived, for a system that opens Branch for someone.", false)}
      {sw("Pass company sign-in on to tools", "A tool can act as the person who signed in.", false)}
      {sw("Let someone start as a guest", "Their work stays when they make an account.", false)}
      <Ctl title="Recovery key" sub="Resets the owner’s password if every other way is lost." help="Resets the owner’s password if every other way is lost. Keep it somewhere safe." off="Shown once, in the Branch app."><Btn sm disabled>Show it</Btn></Ctl>
    </Sec>
  );
}
