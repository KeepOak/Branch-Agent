// Step 1, Welcome (preview item 37 `body()` step 0): the mark, the promise and where Branch runs. No tick box.
import { useEffect, useRef } from "react";
import { KeeperMark } from "../../brand/KeeperMark";
import { Icon as ComposerIcon } from "../../composer/icons";
import { Icon } from "../../shell/icons";
import { WAITS_FOR, WHERE, whereWord, type Where } from "./model";
import { Unwired } from "./Unwired";

export function Welcome({ where, onChangeWhere }: { where: Where; onChangeWhere: () => void }) {
  return (
    <>
      <div className="r1-ob-hero">
        <span className="r1-ob-mark" aria-hidden="true">
          <img className="r1-ob-mark-colour" src="/keepoak-mark.svg" alt="" draggable={false} />
          <span className="r1-ob-mark-ink"><KeeperMark size={60} /></span>
        </span>
      </div>
      <h1>Hi, I’m Branch.</h1>
      <p className="r1-ob-lede">Agents that work on your computer: Trunks that each take one job off your plate.</p>
      <p className="r1-ob-promise"><ComposerIcon name="lock" size={15} /><span>It asks before it sends, deletes, spends or installs anything.</span></p>
      <p className="r1-ob-where">Runs on <b>{whereWord(where)}</b> · <button type="button" className="r1-ob-link" data-local onClick={onChangeWhere}>Change</button></p>
    </>
  );
}

/** "Where Branch runs": a small glass sheet over the card. This computer is the one this window is talking to. */
export function WhereSheet({ where, onPick, onClose }: { where: Where; onPick: (w: Where) => void; onClose: () => void }) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => { first.current?.focus({ preventScroll: true }); }, []);
  return (
    <div className="r1-ob-sheet-layer" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <div className="r1-ob-sheet" role="dialog" aria-modal="true" aria-label="Where Branch runs">
        <h2>Where Branch runs</h2>
        <div className="r1-ob-modes" role="radiogroup" aria-label="Where Branch runs">
          {WHERE.map((w, i) => {
            const button = <button key={w.id} type="button" ref={i === 0 ? first : undefined} className="r1-ob-mode" role="radio" aria-checked={where === w.id} {...(w.reason ? {} : { "data-local": true, onClick: () => onPick(w.id) })}>
              <Icon name={w.icon} size={15} />
              <span><b>{w.name}</b><small>{w.line}</small></span>
            </button>;
            return w.reason && w.id !== "here" ? <Unwired key={w.id} need={WAITS_FOR[w.id]} reason={w.reason} where={w.name}>{button}</Unwired> : button;
          })}
        </div>
        <p className="r1-ob-hint">Restoring from a backup lives in Settings › History & backups.</p>
        <div className="r1-ob-sheet-foot"><button type="button" className="r1-ob-btn r1-ob-pri" data-local onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}
