// A settings row whose switch is the Branch app's own (desktop/src/desktop-controls.ts). Greyed with why in a plain
// browser or an older app; a change that fails says why under the row and can be tried again.
import { useDesktopControls, type DesktopControlName } from "../../connect/desktop-controls";
import { Ctl, Switch } from "./kit";

export function DesktopCtl({ title, sub, name }: { title: string; sub: string; name: DesktopControlName }) {
  const desk = useDesktopControls();
  return (
    <Ctl title={title} sub={sub} off={desk.off} after={desk.state && desk.error ? <small className="why-k" role="alert">{desk.error}</small> : null}>
      <Switch label={title} checked={desk.state?.[name] ?? false} disabled={desk.busy !== null} onChange={(on) => void desk.set(name, on)} />
    </Ctl>
  );
}
