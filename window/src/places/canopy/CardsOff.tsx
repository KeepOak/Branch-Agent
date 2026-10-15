// Canopy › Cards when the Canopy plugin is switched off. Cards come from engine/extensions/canopy, which is bundled
// but off by default (engine/docs/plugins/canopy.md), so the engine answers canopy.cards.list with "unknown method".
// Instead of that raw error the tab says what is missing and switches the plugin on through plugins.setEnabled,
// with the engine's capability review when it asks for one.
import { EmptyLine } from "../../places-nav/PlaceFrame";
import { ConsentDialog, usePluginAction } from "../customize/catalog";
import { Glyph } from "./glyphs";
import type { Ctx } from "./ui";

/** True when the engine has no Canopy card methods, which means the Canopy plugin is not running. */
export const isCardsOff = (error: string) => /unknown method/i.test(error);

export function CardsOff({ ctx, refresh }: { ctx: Ctx; refresh: () => void }) {
  const action = usePluginAction(ctx.engine);
  const reason = ctx.write ? "" : "Only someone who can change settings can switch Canopy on.";
  return <>
    <EmptyLine icon={<span className="cn-empty-i"><Glyph name="eye" /></span>}>Cards need the Canopy plugin, which is switched off. Switch it on to make cards and hand them to your Trunks.</EmptyLine>
    <div className="cn-center">
      <button className="btn pri sm" type="button" disabled={!ctx.write || !!action.busy} title={reason || undefined}
        onClick={() => void action.run("on", "plugins.setEnabled", { pluginId: "canopy", enabled: true }, refresh)}>
        {action.busy ? "Switching on…" : "Switch on Canopy"}</button>
    </div>
    {reason ? <p className="cn-hint cn-center">{reason}</p> : null}
    {action.error ? <p role="alert" className="cn-err">{action.error}</p> : null}
    <ConsentDialog action={action} done={refresh} />
  </>;
}
