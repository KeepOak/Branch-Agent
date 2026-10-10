// Settings › People, the chosen person's card: face, name, where they use Branch and their role; what they may do
// (their role's or connection's operator scopes); Trunks and devices; and the owner's actions: role (users.setRole),
// a one-time code for their device (device.pair.setupCode) and Sign out everywhere (device.token.revoke).
import { useState } from "react";
import { visible } from "../adapter";
import { Acts, Btn, Pill, Sec, Seg, useSaveRunner } from "../kit";
import { ACTKINDS, OWNER_ID, devicesLine, firstName, mayOf, revokePlan, roleOf, scopesOf, type Profile } from "./people-data";
import { Face, type People } from "./people";
import { MineHead, YouSecs } from "./people-mine";
import { shownWhy } from "../../../shell/shown-why";

export function PersonCard({ ctx, p }: { ctx: People; p: Profile }) {
  const mine = p.id === ctx.self?.id;
  const conns = ctx.conns.filter((c) => c.profileId === p.id);
  const where = p.owner ? "This computer" : devicesLine(conns) || visible(p.emails[0] ?? "");
  const role = roleOf(p, ctx.roles);
  const owner = visible(ctx.people.find((x) => x.id === OWNER_ID)?.name ?? "the owner");
  const face = <Face p={p} size={44} pic={mine ? ctx.pic.url : null} />;
  const [out, setOut] = useState(false);
  return (
    <div className="pcard-pp">
      <div className={`pdh-pp${mine ? " mine-pp" : ""}`}>
        {mine ? <MineHead ctx={ctx} me={p} face={face} where={where} /> : <>{face}<span className="grow"><b>{visible(p.name)}</b>{where ? <small>{where}</small> : null}</span></>}
        {role ? <Pill tone={p.owner ? "ok" : "idle"}>{visible(role)}</Pill> : null}
      </div>
      <May ctx={ctx} p={p} />
      {mine ? <YouSecs ctx={ctx} me={p} owner={owner} /> : null}
      <dl className="kv-pp">
        <dt>Trunks</dt><dd>{trunksLine(ctx, role)}</dd>
        <dt>Signed in on</dt><dd>{out ? "Signed out everywhere" : devicesLine(conns) || "No device connected now"}</dd>
      </dl>
      {p.owner ? (mine ? <p className="hint">You’re the owner. Only you change how Branch is set up.</p> : null) : <Actions ctx={ctx} p={p} out={out} onOut={() => setOut(true)} />}
    </div>
  );
}

function May({ ctx, p }: { ctx: People; p: Profile }) {
  const may = mayOf(p.owner, scopesOf(p, ctx.roles, ctx.conns));
  return (
    <Sec title="May">
      <div className="may-pp">
        {ACTKINDS.map((a, i) => (
          <label key={a} className={`chk-pp${may[i] ? "" : " no-pp"}`} title={p.owner ? "The owner may do everything." : i === 5 ? "Branch has no spending permission yet." : undefined}>
            <input type="checkbox" checked={may[i]} disabled aria-label={a} onChange={() => undefined} /> {a}
          </label>
        ))}
      </div>
      {p.owner ? null : <p className="hint">{ctx.roles.defs[roleOf(p, ctx.roles)] ? `Follows ${firstName(visible(p.name))}’s role.` : `What ${firstName(visible(p.name))}’s devices were granted.`}</p>}
    </Sec>
  );
}

function trunksLine(ctx: People, role: string): string {
  const def = ctx.roles.defs[role];
  const agents = def?.agents;
  if (!def || agents === "*" || agents === undefined) return "All";
  const ids = Array.isArray(agents) ? agents.filter((a): a is string => typeof a === "string") : [];
  return ids.length ? ids.map((id) => ctx.trunks.get(id) ?? visible(id)).join(", ") : "None";
}

type ActProps = { ctx: People; p: Profile; out: boolean; onOut: () => void };
function Actions({ ctx, p, out, onOut }: ActProps) {
  const save = useSaveRunner();
  const first = firstName(visible(p.name));
  const [code, setCode] = useState<{ c: string; until?: number } | null>(null);
  const makeCode = () => void save(async () => {
    const r = await ctx.engine.request<{ setupCode: string; expiresAtMs?: number }>("device.pair.setupCode", { includeQr: false, bootstrapProfile: "limited" });
    setCode({ c: r.setupCode, until: r.expiresAtMs });
  });
  const noAdmin = ctx.admin ? undefined : "Only the owner can do this.";
  return (
    <>
      <Acts>
        <RoleSeg ctx={ctx} p={p} />
        <Btn ghost sm disabled={Boolean(noAdmin)} title={noAdmin} onClick={makeCode}>Make a one-time code</Btn>
        <SignOut ctx={ctx} p={p} out={out} onOut={onOut} />
      </Acts>
      {code ? <p className="code-pp"><code>{code.c}</code><span>Works once{code.until ? `, until ${new Date(code.until).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true })}` : ""}. {first} types it on their own device.</span></p> : null}
    </>
  );
}

function RoleSeg({ ctx, p }: { ctx: People; p: Profile }) {
  const save = useSaveRunner();
  const { names } = ctx.roles;
  if (!names.length) return <span title="No roles are set up on this Gateway yet."><Seg label={`${visible(p.name)}’s role`} value="" options={[{ id: "Adult", label: "Adult" }, { id: "Child", label: "Child" }]} disabled onChange={() => undefined} /></span>;
  const set = (role: string) => void save(async () => { await ctx.engine.request("users.setRole", { profileId: p.id, role }); await ctx.reload(); });
  return <Seg label={`${visible(p.name)}’s role`} value={roleOf(p, ctx.roles)} disabled={!ctx.admin} options={names.map((n) => ({ id: n, label: visible(n) }))} onChange={set} />;
}

function SignOut({ ctx, p, out, onOut }: ActProps) {
  const save = useSaveRunner();
  const keep = ctx.keep;
  const devices = ctx.conns.filter((c) => c.profileId === p.id && c.deviceId && !keep.has(c.deviceId)).map((c) => c.deviceId);
  const why = !ctx.admin ? "Only the owner can do this." : !devices.length ? `No device of ${firstName(visible(p.name))}’s is connected now.` : undefined;
  const run = () => void save(async () => {
    const plan = revokePlan(devices, keep, await ctx.engine.request("device.pair.list", {}));
    if (!plan.length) throw new Error("Branch found no sign-in to end on their devices.");
    for (const t of plan) await ctx.engine.request("device.token.revoke", t);
    onOut();
    await ctx.reload();
  });
  return <Btn ghost sm disabled={out || Boolean(why)} title={shownWhy(why)} onClick={run}>Sign out everywhere</Btn>;
}
