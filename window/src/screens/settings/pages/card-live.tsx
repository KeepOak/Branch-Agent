// Settings › Your card: the person's own card, as the approved preview draws it (preview.html PG card, item 36: one
// "Your card" card with three rows: your name with View and Edit, Your picture with Choose…, and See your card with
// Open). It reuses Classic People's own card logic on the same calls (places/settings/set1/people-mine.tsx and
// people-data.tsx): users.self for who you are, users.setDisplayName for your name and users.setAvatar for your picture
// (read on this computer, cropped square, at most 512 px). View and Open show your card in People, as teammates see it.
import { useState } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { record, visible, type RecordValue } from "../../../places/settings/adapter";
import { useResource } from "../../../places/settings/hooks";
import { KitProvider } from "../../../places/settings/kit";
import { usePicture } from "../../../places/settings/set1/people-mine";
import { initials, profilesOf, type Profile } from "../../../places/settings/set1/people-data";
import { openPlace } from "../../../places/settings/set2/common";
import type { PageSlot, SlotPageProps } from "../slots";
import { Failed, Needs, useFailure } from "./appearance-live";

const QUIET = { saving: () => undefined, saved: () => undefined, failed: () => undefined };

/** The signed-in person (users.self), or null when this connection has none. */
export function useSelf(engine: WindowEngine): { me: Profile | null; loading: boolean; error?: string; reload: () => Promise<void> } {
  const self = useResource<RecordValue>(engine, "users.self", {});
  const profile = record(self.data).profile;
  const me = profile ? profilesOf({ profiles: [profile] })[0] ?? null : null;
  return { me, loading: self.loading, error: self.error, reload: self.reload };
}

function MyCard({ engine }: SlotPageProps) {
  const { me, loading, error, reload } = useSelf(engine);
  const pic = usePicture(engine, me, reload);
  const [failed, run] = useFailure();
  const [edit, setEdit] = useState<string | null>(null);
  const draft = edit?.trim() ?? "";
  const save = () => { if (!me || !draft || draft === me.name) { setEdit(null); return; } void run(async () => { await engine.request("users.setDisplayName", { profileId: me.id, displayName: draft }); setEdit(null); await reload(); }); };
  if (loading) return null;
  // Without a signed-in person there is no card to draw; a failed read shows what went wrong.
  if (!me) return error ? <small className="r1s-msg r1s-bad g-label" data-lines role="status">{visible(error)}</small> : null;
  return (
    <div className="r1s-items">
      <div className="r1s-row" data-row="card.card.name">
        <span className="r1s-item">
          <span className="r1s-av g-frost" aria-hidden="true">{pic.url ? <img src={pic.url} alt="" /> : initials(me.name)}</span>
          {edit === null ? <b className="g-label">{visible(me.name)}</b> : (
            <input className="r1s-inp" autoFocus maxLength={256} value={edit} aria-label="Your name" onChange={(e) => setEdit(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setEdit(null); } }} />
          )}
        </span>
        <small className="g-label" data-lines>Your photo, name and role, as teammates see them.</small>
        <div className="r1s-ctl"><span className="r1s-acts">
          {edit === null ? <>
            <button type="button" className="r1s-btn" data-local="" onClick={() => openPlace("people")}>View</button>
            <Needs engine={engine} need={["users.setDisplayName"]} where="Edit your name"><button type="button" className="r1s-btn" onClick={() => setEdit(me.name)}>Edit</button></Needs>
          </> : <>
            <Needs engine={engine} need={["users.setDisplayName"]} where="Save your name"><button type="button" className="r1s-btn" disabled={!draft || draft === me.name} onClick={save}>Save</button></Needs>
            <button type="button" className="r1s-btn" data-local="" onClick={() => setEdit(null)}>Cancel</button>
          </>}
        </span></div>
        <Failed text={failed} />
      </div>
      <div className="r1s-row" data-row="card.card.picture">
        <b className="g-label">Your picture</b>
        <small className="g-label" data-lines>Upload, take a photo, pick an emoji, or have a Trunk make one.</small>
        <div className="r1s-ctl">
          <Needs engine={engine} need={["users.setAvatar"]} where="Choose your picture">
            <label className="r1s-btn r1s-file">Choose…<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) pic.pick(f); }} /></label>
          </Needs>
        </div>
        {pic.msg ? <small className="r1s-msg g-label" role="status">{pic.msg}</small> : null}
      </div>
      <div className="r1s-row" data-row="card.card.see">
        <b className="g-label">See your card</b>
        <small className="g-label" data-lines>What teammates see when they click you.</small>
        <div className="r1s-ctl"><button type="button" className="r1s-btn" data-local="" onClick={() => openPlace("people")}>Open</button></div>
      </div>
    </div>
  );
}

/** usePicture reports through Classic's save kit; here its own line says how it went. */
function YourCard(props: SlotPageProps) {
  return <KitProvider level={0} report={QUIET} scope={null}><MyCard {...props} /></KitProvider>;
}

/** The Your card page's own card (plugged.ts). */
export const CARD_PAGE: PageSlot = { cards: { "Your card": { component: YourCard } } };
