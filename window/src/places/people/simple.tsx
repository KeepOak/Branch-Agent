// People, simple view (the default): you, and a way to invite someone. The admin tabs sit one click away behind "Team admin".
import { useState } from "react";
import { Icon } from "../../shell/icons";
import type { WindowEngine } from "../../connect/engine";
import { InviteDialog } from "./person-dialogs";
import { nameOf, type Profile } from "./data";
import { Avatar, Status } from "./ui";

type Res = { loading: boolean; error: string | null; reload?: () => void };
type YouProps = { engine: WindowEngine; users: Res; you: Profile | undefined; onTeamAdmin: () => void };

export function YouAndInvite({ engine, users, you, onTeamAdmin }: YouProps) {
  const [inviting, setInviting] = useState(false);
  const name = you ? nameOf(you) : "You";
  const email = you?.emails[0] ?? "";
  return <section className="pp-you" aria-label="You">
    <Status {...users} />
    <div className="pp-you-card">
      <Avatar id={you?.id ?? "you"} name={name} size={44} />
      <span className="grow"><b>{name}</b>{email && <small>{email}</small>}</span>
    </div>
    <div className="pp-acts">
      <button type="button" className="btn pri" onClick={() => setInviting(true)}><Icon name="plus" small />Invite someone</button>
    </div>
    <p className="pp-hint">Teammates you invite show up here. Team admin holds the live view, access groups, teams, activity, usage, roles and sign-in.</p>
    <div className="pp-acts"><button type="button" className="btn ghost sm" onClick={onTeamAdmin}>Team admin</button></div>
    {inviting && <InviteDialog engine={engine} onClose={() => setInviting(false)} />}
  </section>;
}
