import { useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { useResource } from "../settings/hooks";
import { accountName, providersOf, STATUS_WORDS, type Provider } from "../settings/set1/accounts";
import { canWrite, WRITE_WHY } from "./data";

type AuthStatus = { providers?: unknown };

export function AccountsTab({ engine, agentId }: { engine: WindowEngine; agentId: string }) {
  const status = useResource<AuthStatus>(engine, "models.authStatus", { agentId });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [dragged, setDragged] = useState<string>();
  const write = canWrite(engine);
  const save = async (provider: Provider, ids?: string[]) => {
    setBusy(true);
    setError(undefined);
    try {
      await engine.request("models.authOrderSet", {
        provider: provider.authProvider ?? provider.provider,
        agentId,
        ...(ids?.length ? { profileIds: ids } : {}),
      });
      await status.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const providers = providersOf(status.data?.providers).filter((provider) => provider.profiles.length);
  return <div className="tk-accounts">
    <p className="tk-hint">Choose which signed-in accounts this Trunk can use. Drag the selected accounts into priority order; the first available account goes first.</p>
    {status.loading && <p role="status">Reading accounts…</p>}
    {status.error && <p role="alert">{status.error}</p>}
    {!status.loading && !providers.length && <p>No signed-in accounts yet. Add one in Settings › Accounts.</p>}
    {providers.map((provider) => {
      const stored = Boolean((provider as Provider & { profileOrderStored?: boolean }).profileOrderStored);
      const why = provider.profileOrderLocked ? "The order is set in the settings file." : write ? undefined : WRITE_WHY;
      const selected = stored ? provider.profileOrder ?? [] : [];
      const ordered = [
        ...selected.map((id) => provider.profiles.find((profile) => profile.profileId === id)).filter((profile) => profile !== undefined),
        ...provider.profiles.filter((profile) => !selected.includes(profile.profileId)),
      ];
      return <section key={provider.provider} className="tk-accounts-provider" aria-label={`${provider.displayName} accounts`}>
        <h3>{provider.displayName}</h3>
        <button type="button" className="btn sm" disabled={busy || !stored || Boolean(why)} title={why} onClick={() => void save(provider)}>Use any</button>
        <ol className="tk-accounts-list">
          {ordered.map((profile, index) => {
            const id = profile.profileId;
            const checked = !stored || selected.includes(id);
            return <li key={id} draggable={stored && checked && !busy && !why} onDragStart={() => setDragged(id)} onDragEnd={() => setDragged(undefined)} onDragOver={(event) => { if (dragged && dragged !== id && !why) event.preventDefault(); }} onDrop={(event) => {
              event.preventDefault();
              if (why || !dragged || dragged === id || !selected.includes(dragged) || !selected.includes(id)) return;
              const next = selected.filter((item) => item !== dragged);
              next.splice(next.indexOf(id) + (selected.indexOf(dragged) < selected.indexOf(id) ? 1 : 0), 0, dragged);
              setDragged(undefined);
              void save(provider, next);
            }}>
              <label title={why ?? (stored && checked && selected.length === 1 ? "Use any to remove this Trunk’s last selection." : undefined)}><input type="checkbox" disabled={busy || Boolean(why) || (stored && checked && selected.length === 1)} checked={checked} onChange={() => {
                const next = stored ? selected : provider.profiles.map((item) => item.profileId);
                const updated = checked ? next.filter((item) => item !== id) : [...next, id];
                void save(provider, updated);
              }} /> {accountName({ p: provider, a: profile, n: index + 1 })}</label>
              <span className="tk-hint">{stored && checked ? `${selected.indexOf(id) + 1} · Drag to reorder` : STATUS_WORDS[profile.status] ?? profile.status}</span>
            </li>;
          })}
        </ol>
      </section>;
    })}
    {error && <p className="tk-error" role="alert">{error}</p>}
  </div>;
}
