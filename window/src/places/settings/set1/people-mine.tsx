// Settings › People, your own card: your picture (read on this computer, cropped square, at most 512 px, then saved
// with users.setAvatar), your name (users.setDisplayName), You and Your access (the scopes this connection holds).
import { useState } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { errorText, visible } from "../adapter";
import { Btn, Ctl, Sec, useLevel, useSaveRunner } from "../kit";
import { OWNER_DEFAULT_NAME, PIC_ERRORS, accessLine, avatarParams, pictureFileError, type Profile } from "./people-data";
import type { People } from "./people";

export type Picture = { url: string | null; msg: string; pick: (file: File) => void };

/** Crops the picture square and shrinks it to at most 512 px, as WebP where the browser can make it. */
function shrink(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const src = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(src);
      const s = Math.min(img.width, img.height), n = Math.min(512, s);
      const cv = document.createElement("canvas");
      cv.width = cv.height = n;
      const g = cv.getContext("2d");
      if (!g || !n) { reject(new Error(PIC_ERRORS.read)); return; }
      g.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, n, n);
      try { resolve(cv.toDataURL("image/webp", 0.86)); } catch { reject(new Error(PIC_ERRORS.read)); }
    };
    img.onerror = () => { URL.revokeObjectURL(src); reject(new Error(PIC_ERRORS.read)); };
    img.src = src;
  });
}

export function usePicture(engine: WindowEngine, self: Profile | null, reload: () => Promise<void>): Picture {
  const save = useSaveRunner();
  const [url, setUrl] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const pick = (file: File) => {
    const early = pictureFileError(file);
    if (early || !self) { setMsg(early ?? PIC_ERRORS.read); return; }
    setMsg("Processing…");
    void shrink(file).then((data) => {
      const params = avatarParams(data);
      if (typeof params === "string") { setMsg(params); return; }
      return save(async () => {
        try { await engine.request("users.setAvatar", { profileId: self.id, ...params }); } catch (e) { setMsg(visible(errorText(e))); throw e; }
        setUrl(data); setMsg("");
        await reload();
      });
    }, (e: unknown) => setMsg(e instanceof Error ? e.message : PIC_ERRORS.read));
  };
  return { url, msg, pick };
}

/** The face column and the name row of your own card. */
export function MineHead({ ctx, me, face, where }: { ctx: People; me: Profile; face: React.ReactNode; where: string }) {
  const save = useSaveRunner();
  const [edit, setEdit] = useState<string | null>(null);
  const draft = edit?.trim() ?? "";
  const commit = () => { if (!draft || draft === me.name) return; void save(async () => { await ctx.engine.request("users.setDisplayName", { profileId: me.id, displayName: draft }); setEdit(null); await ctx.reload(); }); };
  return (
    <>
      <span className="facecol-pp">
        {face}
        <span className="picbtns-pp">
          <label className="btn ghost sm">Change picture<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) ctx.pic.pick(f); }} /></label>
          {me.hasAvatar || ctx.pic.url ? <Btn ghost sm disabled title="Branch can’t remove a picture yet.">Remove picture</Btn> : null}
        </span>
        {ctx.pic.msg ? <small className="picmsg-pp" role="status">{ctx.pic.msg}</small> : null}
      </span>
      <span className="grow">
        <span className="namerow-pp">
          {edit === null ? <><b>{visible(me.name)}</b><Btn ghost sm onClick={() => setEdit(me.name === OWNER_DEFAULT_NAME ? "" : me.name)}>{me.name === OWNER_DEFAULT_NAME ? "Add your name" : "Change"}</Btn></> : (
            <span className="nameed-pp">
              <input className="inp" autoFocus maxLength={256} value={edit} aria-label="Your name" onChange={(e) => setEdit(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setEdit(null); } }} />
              <Btn pri sm disabled={!draft || draft === me.name} onClick={commit}>Save</Btn>
              <Btn ghost sm onClick={() => setEdit(null)}>Cancel</Btn>
            </span>
          )}
        </span>
        {me.name === OWNER_DEFAULT_NAME ? <small className="why-k">Nobody has set a name yet. People will see “{OWNER_DEFAULT_NAME}”.</small> : null}
        {where ? <small>{where}</small> : null}
      </span>
    </>
  );
}

/** You and Your access, on your own card. */
export function YouSecs({ ctx, me, owner }: { ctx: People; me: Profile; owner: string }) {
  const lv = useLevel();
  const scopes = ctx.engine.scopes;
  const open = ctx.openSettings;
  return (
    <>
      <Sec title="You">
        {!me.owner && me.emails.length ? <Ctl title="Emails" sub={`The emails linked to you. Ask ${owner} to change them.`}><span className="val-k">{me.emails.map(visible).join(", ")}</span></Ctl> : null}
        <Ctl title="Your own instructions" sub="Instructions & personality › Just about you.">{open ? <Btn sm onClick={() => open("instructions")}>Open</Btn> : null}</Ctl>
        <Ctl title="Your own accounts" sub="Accounts only you use.">{open ? <Btn sm onClick={() => open("accounts")}>Open</Btn> : null}</Ctl>
      </Sec>
      <Sec title="Your access">
        <p className="acc-pp">{accessLine(scopes)}</p>
        {me.owner ? null : <p className="hint">Missing something? Ask {owner} to look at what you may do, then reconnect.</p>}
        {lv >= 2 ? (
          <details className="tech-pp">
            <summary>Technical details</summary>
            <p className="hint">Granted when you connected. A role can narrow these, never widen them.</p>
            <span className="scopes-pp">{scopes.map((s) => <code key={s}>{s}</code>)}</span>
          </details>
        ) : null}
      </Sec>
    </>
  );
}
