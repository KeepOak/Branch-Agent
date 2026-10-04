// Accounts at Advanced and Technical (§4.7.8): which account goes next per service (an explicit order, or taking
// turns: the engine's automatic order picks the least recently used), which account each Trunk uses (that Trunk's
// own order), where each sign-in comes from, and the rows the engine has no setting for yet, greyed with why.
import type { WindowEngine } from "../../../connect/engine";
import { list, record, text, visible, type RecordValue } from "../adapter";
import { useResource } from "../hooks";
import { Btn, Ctl, Empty, Pick, Pill, Sec, Seg, Switch, Val, useLevel, useSaveRunner } from "../kit";
import { accountName, providersOf, type Account, type Provider } from "./accounts";
import { Logo, serviceName } from "./service";

type Props = { engine: WindowEngine; providers: Provider[]; all: Account[]; reload: () => Promise<void>; agent: { agentId?: string }; openSettings?: (page: string) => void };
const NO_KEY = "Branch has no setting for this yet.";

export function AccountsMore(props: Props) {
  const lv = useLevel();
  if (lv < 1) return null;
  return (
    <>
      <Sec title="Terms">
        <Ctl title="Each service’s terms" sub="Branch only signs in to a plan the way its service allows, and says so." off="Each service’s terms are on its own site; Branch doesn’t list them yet."><Btn sm>Read the lines</Btn></Ctl>
      </Sec>
      {lv >= 2 ? <><WhichNext {...props} /><Sources providers={props.providers} agent={props.agent} /></> : null}
      <AccountsAdvanced {...props} />
      {lv >= 2 ? <AccountsTechnical engine={props.engine} /> : null}
    </>
  );
}

const NEXT = [{ id: "order", label: "In order" }, { id: "turns", label: "Take turns" }, { id: "random", label: "At random", off: NO_KEY }, { id: "least", label: "Least used", off: NO_KEY }];
function WhichNext({ engine, providers, reload, agent }: Props) {
  const save = useSaveRunner();
  const many = providers.filter((p) => p.profiles.length > 0);
  const set = (p: Provider, mode: string) => void save(async () => {
    const ids = p.profiles.map((a) => a.profileId);
    await engine.request("models.authOrderSet", { provider: p.authProvider ?? p.provider, ...(mode === "order" ? { profileIds: ids } : {}), ...agent });
    await reload();
  });
  return (
    <Sec title="Which account goes next" hint="Whatever the order, an account that runs out, refuses payment or loses its sign-in is skipped until its window refills. Only accounts you own are used.">
      {many.length ? null : <Empty>No account yet.</Empty>}
      {many.map((p) => {
        const mode = p.profileOrder?.length ? "order" : "turns";
        return (
          <Ctl key={p.provider} title={serviceName(p.provider, p.displayName)} icon={<Logo id={p.provider} size={22} />} id={serviceName(p.provider, p.displayName)}
            sub={p.profileOrderLocked ? "The order is set in the settings file." : mode === "order" ? "The first account with room left, as listed above." : "Each turn goes to the account used longest ago."}>
            <Seg label={`Which ${serviceName(p.provider, p.displayName)} account goes next`} value={mode} options={NEXT} disabled={Boolean(p.profileOrderLocked)} onChange={(m) => set(p, m)} />
          </Ctl>
        );
      })}
    </Sec>
  );
}

function AccountsAdvanced({ engine, all, openSettings }: Props) {
  const trunks = useResource<RecordValue>(engine, "agents.list", {});
  const resting = all.filter((a) => a.a.status === "cooldown" || /cooldown|rate/i.test(text(a.a.reasonCode ?? "")));
  return (
    <Sec title="Accounts, more">
      <Ctl title="Which account each Trunk uses" sub="A Trunk with its own account follows that account’s order and limits. Helpers keep the one their Trunk had." />
      {list(trunks.data?.agents).map((t) => <TrunkAccount key={text(t.id)} engine={engine} trunk={t} />)}
      <Ctl title="Helpers keep their account" sub="Through a pause or a restart, a helper keeps the exact account it started with." off={NO_KEY}><Switch checked label="Helpers keep their account" onChange={() => undefined} /></Ctl>
      <Ctl title="Pick by what the task needs" sub="A task that needs pictures or a long room gets an account that has it." off={NO_KEY}><Switch checked label="Pick by what the task needs" onChange={() => undefined} /></Ctl>
      <Ctl title="Fallback keys" sub="One service can hold several keys; a rate-limited key rests while the next one works.">{openSettings ? <Btn sm onClick={() => openSettings("secrets")}>Add a key</Btn> : null}</Ctl>
      <Ctl title="Resting now" sub="A limit benches an account only for that model.">{resting.length ? resting.map((a) => <Pill key={a.a.profileId} tone="warn">{accountName(a)}</Pill>) : <Val>None</Val>}</Ctl>
      <Ctl title="Which sign-in each request used" sub="Key or sign-in, and which account; never the key itself." off={NO_KEY}><Btn sm>See the last 20</Btn></Ctl>
      <Ctl title="Organisation" sub="For accounts in more than one organisation: who is billed." off={NO_KEY}><Pick label="Organisation" value="personal" options={[{ id: "personal", label: "Personal" }]} onChange={() => undefined} /></Ctl>
      <Ctl title="A customer’s ChatGPT plan on a KeepOak computer" sub="Only with that customer’s own sign-in on it. Off until you choose." off={NO_KEY}><Switch checked={false} label="A customer’s ChatGPT plan on a KeepOak computer" onChange={() => undefined} /></Ctl>
    </Sec>
  );
}

/** One Trunk's account: "Anyone’s" (no order of its own), or one account it uses first (that Trunk's own order). */
function TrunkAccount({ engine, trunk }: { engine: WindowEngine; trunk: RecordValue }) {
  const id = text(trunk.id);
  const status = useResource<RecordValue>(engine, "models.authStatus", { agentId: id });
  const save = useSaveRunner();
  const providers = providersOf(status.data?.providers);
  const options = providers.flatMap((p) => p.profiles.map((a, i) => ({ id: `${p.provider}|${a.profileId}`, label: accountName({ p, a, n: i + 1 }) })));
  const own = providers.find((p) => (p as Provider & { profileOrderStored?: boolean }).profileOrderStored && p.profileOrder?.length);
  const value = own ? `${own.provider}|${own.profileOrder?.[0]}` : "";
  const name = visible(record(trunk.identity).name ?? trunk.name ?? id);
  const pick = (v: string) => void save(async () => {
    const [prov, profile] = v.split("|");
    const clear = providers.filter((p) => (p as Provider & { profileOrderStored?: boolean }).profileOrderStored && p.provider !== prov);
    for (const p of clear) await engine.request("models.authOrderSet", { provider: p.authProvider ?? p.provider, agentId: id });
    if (prov) {
      const p = providers.find((x) => x.provider === prov);
      const rest = (p?.profiles ?? []).map((a) => a.profileId).filter((x) => x !== profile);
      await engine.request("models.authOrderSet", { provider: p?.authProvider ?? prov, profileIds: [profile, ...rest], agentId: id });
    } else if (own) {
      await engine.request("models.authOrderSet", { provider: own.authProvider ?? own.provider, agentId: id });
    }
    await status.reload();
  });
  return <Ctl title={name}><Pick label={name} value={value} options={[{ id: "", label: "Anyone’s" }, ...options]} disabled={status.loading} onChange={pick} /></Ctl>;
}

function Sources({ providers, agent }: { providers: Provider[]; agent: { agentId?: string } }) {
  const line = (p: Provider) => {
    const by = (kind: string) => p.profiles.filter((a) => (kind === "key" ? a.type === "api_key" : a.type !== "api_key")).length;
    const env = (p as Provider & { apiKey?: { source?: string; envVar?: string } }).apiKey;
    return [by("signin") ? `Browser sign-ins: ${by("signin")}` : "", by("key") ? `Keys: ${by("key")}` : "", env?.envVar ? `From ${env.envVar}` : env?.source === "config" ? "From the settings file" : ""].filter(Boolean).join(" · ") || "Not set up";
  };
  return (
    <Sec title="Where each sign-in comes from" hint={agent.agentId ? "This Trunk’s own sign-ins." : "Every Trunk."}>
      {providers.length ? null : <Empty>No service set up yet.</Empty>}
      {providers.map((p) => <Ctl key={p.provider} id={serviceName(p.provider, p.displayName)} title={serviceName(p.provider, p.displayName)} icon={<Logo id={p.provider} size={22} />}><Val>{line(p)}</Val></Ctl>)}
    </Sec>
  );
}

/** The engine's device id, shortened for the row; the whole id is in the tooltip. */
function shortId(id: string): string {
  return id.length > 22 ? `${id.slice(0, 16)}…${id.slice(-3)}` : id;
}

function AccountsTechnical({ engine }: { engine: WindowEngine }) {
  const ident = useResource<RecordValue>(engine, "gateway.identity.get", {});
  const id = typeof ident.data?.deviceId === "string" ? ident.data.deviceId : "";
  return (
    <Sec title="Accounts, technical">
      <Ctl stack title="A command that makes a sign-in" sub="For a service whose key comes from a program of yours. Its output is used as the key." off={NO_KEY} after={<input className="inp cmd-acc" placeholder="vault read -field=token secret/llm" aria-label="A command that makes a sign-in" disabled />} />
      <Ctl title="On a build server, sign in with" off={NO_KEY}><Seg label="On a build server, sign in with" value="token" options={[{ id: "token", label: "A personal token" }, { id: "identity", label: "The server’s own identity" }]} onChange={() => undefined} /></Ctl>
      <Ctl title="Accept sign-ins from your editor" sub="An editor or kit already signed in can lend that sign-in." off={NO_KEY}><Switch checked={false} label="Accept sign-ins from your editor" onChange={() => undefined} /></Ctl>
      <Ctl title="This Branch’s identity" sub="Signs Branch’s calls to other services and computers.">{id ? <span title={id}><Val code>{shortId(id)}</Val></span> : <Val>{ident.loading ? "Reading…" : "Not reported"}</Val>}</Ctl>
      <Ctl title="Sign-ins through the Gateway" sub="A service that asks for it signs in through the Gateway, which keeps the refreshed sign-in."><span title="The Gateway always keeps refreshed sign-ins."><Switch checked disabled label="Sign-ins through the Gateway" onChange={() => undefined} /></span></Ctl>
      <Ctl title="Settings from another Branch" sub="Bring in a saved model setup, keys and connectors from a Branch on another computer." off={NO_KEY}><Btn sm disabled>Bring in</Btn></Ctl>
      <Ctl title="Keep service settings in step on my devices" sub="Not keys: those stay on each computer." off={NO_KEY}><Switch checked={false} label="Keep service settings in step on my devices" onChange={() => undefined} /></Ctl>
      <Ctl title="Use a model from a hub for one run"><Val code>branch --model owner/package</Val></Ctl>
      <Ctl title="Region" sub="Changes which services and mirrors come first." off={NO_KEY}><Pick label="Region" value="auto" options={[{ id: "auto", label: "Automatic" }, { id: "world", label: "Worldwide" }, { id: "cn", label: "China" }]} onChange={() => undefined} /></Ctl>
      <Ctl title="Install a service’s package when needed" sub="Otherwise it says which one to install." off={NO_KEY}><Switch checked label="Install a service’s package when needed" onChange={() => undefined} /></Ctl>
      <Ctl title="Each account keeps its own folder" sub="A coding app’s sign-in for one account never mixes with another’s."><Pill tone="ok">Always on</Pill></Ctl>
      <Ctl title="Point your coding apps at Branch" sub="Writes the service you pick into each coding app’s own settings, so they all use the same one." off={NO_KEY}><Btn sm>Choose…</Btn></Ctl>
    </Sec>
  );
}
