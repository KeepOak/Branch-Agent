// Step 3, How much may it do? (preview item 37 step 2): the same four choices as everywhere in Branch. Ask first is
// preselected; Full access lives in Settings › Permissions only. The choice saves as tools.exec.mode on Continue.
import { Icon } from "../../composer/icons";
import { Coming } from "../../glass/coming";
import { MODES, PLAN_FIRST_REASON, WAITS_FOR, type ModeId } from "./model";
import { Unwired } from "./Unwired";

export function ModeStep({ mode, onMode, error }: { mode: ModeId; onMode: (m: ModeId) => void; error: string | null }) {
  return (
    <>
      <h1>How much may it do?</h1>
      <p className="r1-ob-lede">The same four choices you’ll see everywhere in Branch.</p>
      <div className="r1-ob-modes" role="radiogroup" aria-label="How much it may do">
        {MODES.map((m) => {
          const body = <><Icon name={m.icon} size={15} /><span><b>{m.name}{m.recommended ? <em>Recommended</em> : null}</b><small>{m.line}</small></span></>;
          return m.exec
            ? <Coming key={m.id} need="config.patch" where={m.name}><button type="button" className="r1-ob-mode" role="radio" aria-checked={mode === m.id} onClick={() => onMode(m.id)}>{body}</button></Coming>
            : <Unwired key={m.id} need={WAITS_FOR.planFirst} reason={PLAN_FIRST_REASON} where={m.name}><button type="button" className="r1-ob-mode" role="radio" aria-checked={false}>{body}</button></Unwired>;
        })}
      </div>
      {error ? <p className="r1-ob-error" role="alert">{error}</p> : null}
      <p className="r1-ob-hint">Change it any time in Settings › Permissions. Full access lives there too, one click away.</p>
    </>
  );
}
