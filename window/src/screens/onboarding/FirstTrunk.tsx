// Step 4, Your first Trunk (preview item 37 `body()` step 3): a sentence drives 1–3 suggestions, the eight day-one
// templates are chips, and the default Trunk stays the default. A template this engine doesn't carry (trunks.template.list)
// shows Coming. Creating happens on Meet them (finish.ts), never on a tap here.
import { useEffect, useRef, type ReactElement } from "react";
import { Icon } from "../../composer/icons";
import { Face } from "../../face/Face";
import { DAY_ONE_TEMPLATES, type DayOneTemplate, type ListedTemplate } from "../seedbank/templates";
import { carried, picked, suggest, suggestHint, WAITS_FOR, type OnboardingState } from "./model";
import { Unwired } from "./Unwired";

type Props = {
  s: Pick<OnboardingState, "text" | "pick" | "tpl">;
  /** What trunks.template.list returned, or null while it loads (or when this engine can't list). */
  listed: readonly ListedTemplate[] | null;
  defaultName: string;
  error: string | null;
  onText: (text: string) => void;
  onPick: (id: string) => void;
};

export function FirstTrunk({ s, listed, defaultName, error, onText, onPick }: Props) {
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { box.current?.focus({ preventScroll: true }); }, []);
  const sug = suggest(s.text), on = new Set(picked(s));
  /** A template this engine carries is a local toggle; one it doesn't is Coming with its reason and the call it waits for. */
  const live = (template: DayOneTemplate, button: (props: Record<string, unknown>) => ReactElement) => {
    const c = carried(template, listed);
    return "reason" in c
      ? <Unwired key={template.id} need={WAITS_FOR.template} reason={c.reason} where={template.name}>{button({})}</Unwired>
      : button({ key: template.id, "data-local": true, "aria-pressed": on.has(template.id), onClick: () => onPick(template.id) });
  };
  return (
    <>
      <h1>Your first Trunk</h1>
      <p className="r1-ob-lede">What should it take off your plate?</p>
      <textarea ref={box} className="r1-ob-text" data-local rows={2} placeholder="I chase receipts and invoices, and my inbox is a mess…" aria-label="What should it take off your plate?" value={s.text} onChange={(e) => onText(e.target.value)} />
      <div className="r1-ob-sug" aria-live="polite">
        {sug.length ? (
          <>
            <small>Branch suggests</small>
            {sug.map(({ template, why }) => {
              return (
                live(template, (props) => <button type="button" className="r1-ob-pick" {...props}>
                  <span className="r1-ob-face" aria-hidden="true"><Face size={40} label={template.name} pebbleLook={{ colour: template.colour }} /></span>
                  <span><b>{template.name}</b><small>{why}</small></span>
                  {on.has(template.id) ? <Icon name="check" size={15} /> : null}
                </button>)
              );
            })}
          </>
        ) : <small>{suggestHint(s.text)}</small>}
      </div>
      <div className="r1-ob-tpls">
        <small>Or pick a template</small>
        <div className="r1-ob-chips">
          {DAY_ONE_TEMPLATES.map((t) => live(t, (props) => <button type="button" className="r1-ob-chip" {...props}>{t.name}</button>))}
        </div>
      </div>
      {error ? <p className="r1-ob-error" role="alert">{error}</p> : null}
      <p className="r1-ob-sap"><span className="r1-ob-face" aria-hidden="true"><Face size={26} label={defaultName || "Trunk"} /></span><span><b>{defaultName || "Your default Trunk"}</b> stays your default Trunk, with the leaf.</span></p>
    </>
  );
}
