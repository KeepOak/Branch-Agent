// Step 3, How much may it do? (preview item 37 step 2): the same choices as everywhere in Branch. Ask first is
// preselected; Full access lives in Settings › Permissions only. The choice saves as tools.exec.mode on Continue.
// A choice the engine has no mode for (Plan first) is left out, not greyed (#1769). It shows again once its
// composer row names an engine mode and step 3 has a tools.exec.mode to save for it.
import { Icon } from "../../composer/icons";
import { offeredModeRows } from "../../composer/mode";
import { Coming } from "../../glass/coming";
import { MODES, type ModeId } from "./model";

const offered = (m: (typeof MODES)[number]) => m.exec !== null && offeredModeRows().some((row) => row.name === m.name);

export function ModeStep({ mode, onMode, error }: { mode: ModeId; onMode: (m: ModeId) => void; error: string | null }) {
  return (
    <>
      <h1>How much may it do?</h1>
      <p className="r1-ob-lede">The same choices you’ll see everywhere in Branch.</p>
      <div className="r1-ob-modes" role="radiogroup" aria-label="How much it may do">
        {MODES.filter(offered).map((m) => (
          <Coming key={m.id} need="config.patch" where={m.name}>
            <button type="button" className="r1-ob-mode" role="radio" aria-checked={mode === m.id} onClick={() => onMode(m.id)}>
              <Icon name={m.icon} size={15} /><span><b>{m.name}{m.recommended ? <em>Recommended</em> : null}</b><small>{m.line}</small></span>
            </button>
          </Coming>
        ))}
      </div>
      {error ? <p className="r1-ob-error" role="alert">{error}</p> : null}
      <p className="r1-ob-hint">Change it any time in Settings › Permissions. Full access lives there too, one click away.</p>
    </>
  );
}
