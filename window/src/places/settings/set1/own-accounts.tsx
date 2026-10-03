// Accounts › Your own accounts (§4.7.8): the model account this person's new conversations prefer
// (users.listModelAccounts, users.selectModelAccount, users.unlinkAuthProfile). The household's order still applies.
import { useState } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { Dialog } from "../../../shell/Dialog";
import { list, text, visible, type RecordValue } from "../adapter";
import { useResource } from "../hooks";
import { Btn, Empty, Plist, Prow, Sec, useSaveRunner } from "../kit";
import { Logo, serviceName } from "./service";

export function OwnAccounts({ engine }: { engine: WindowEngine }) {
  const own = useResource<RecordValue>(engine, "users.listModelAccounts", {});
  const save = useSaveRunner();
  const [adding, setAdding] = useState(false);
  const accounts = list(own.data?.accounts);
  const mine = accounts.filter((a) => a.selected === true);
  const remove = (a: RecordValue) => void save(async () => {
    await engine.request("users.unlinkAuthProfile", { profileId: own.data?.profileId, authProfileId: a.authProfileId });
    await own.reload();
  });
  return (
    <Sec personal title="Your own accounts" hint="Accounts only you use. New conversations you start prefer the one you pick; the household’s order still applies when it runs out. This isn’t a billing promise.">
      {own.error ? <p className="hint">{visible(own.error)}</p> : null}
      {mine.length ? (
        <Plist>
          {mine.map((a) => (
            <Prow key={text(a.authProfileId)} icon={<Logo id={text(a.provider)} size={32} />} title={`${serviceName(text(a.provider), undefined, a.authType === "api_key")} · ${visible(a.label)}`} sub="New conversations you start use it first.">
              <Btn sm onClick={() => remove(a)}>Stop using</Btn>
            </Prow>
          ))}
        </Plist>
      ) : !own.loading && !own.error ? <Empty>No account of your own yet. New conversations use the household’s.</Empty> : null}
      <div className="acts"><Btn sm disabled={own.loading || Boolean(own.error) || !accounts.length} title={!accounts.length ? "Add an account above first." : undefined} onClick={() => setAdding(true)}>Add your own account</Btn></div>
      {adding ? <PickOwn engine={engine} accounts={accounts.filter((a) => a.selected !== true)} onClose={(picked) => { setAdding(false); if (picked) void own.reload(); }} /> : null}
    </Sec>
  );
}

function PickOwn({ engine, accounts, onClose }: { engine: WindowEngine; accounts: RecordValue[]; onClose: (picked: boolean) => void }) {
  const save = useSaveRunner();
  const pick = (a: RecordValue) => void save(async () => {
    await engine.request("users.selectModelAccount", { authProfileId: a.authProfileId });
    onClose(true);
  });
  return (
    <Dialog title="Add your own account" onClose={() => onClose(false)} footer={<button type="button" className="btn ghost" onClick={() => onClose(false)}>Cancel</button>}>
      <p className="aa-lede">Which account should your new conversations use first?</p>
      <div className="rows">
        {accounts.map((a) => (
          <button key={text(a.authProfileId)} type="button" className="prow aa-pick" onClick={() => pick(a)}>
            <Logo id={text(a.provider)} size={28} />
            <span className="grow"><b>{serviceName(text(a.provider), undefined, a.authType === "api_key")} · {visible(a.label)}</b><small>{a.authType === "api_key" ? "A key" : "A signed-in account"}</small></span>
          </button>
        ))}
        {!accounts.length ? <p className="empty">Every account is already yours.</p> : null}
      </div>
    </Dialog>
  );
}
