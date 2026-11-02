// The first message of a conversation started with "Try it with examples" (preview.html:45806 greet): the Trunk's
// introduction and the note that its replies are examples until a model is added. The preview writes it locally, with no
// engine call, so it is shown here in place of an empty history and is not sent anywhere.
import { useEffect, useMemo, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { recalledSessionName } from "../onboarding/session-name";
import { readPersonName } from "../../shell/PersonMenu";
import type { Block } from "../../thread/model";

export const EXAMPLES_GREETING_KEY = "examples-greeting";
/** The default Trunk's line (preview greet, isSap). */
export const DEFAULT_TRUNK_WHY = "I’m your default Trunk, the one with the leaf. I take new conversations and anything nobody else has.";
/** A Trunk made from a template (preview greet, the template's own line). */
export const TEMPLATE_TRUNK_WHY = "I take one job off your plate.";

/** The greeting's words. A name from setup is used; without one, the Trunk still asks what to call you. */
export function examplesGreetingText(me: string, name: string, why: string): string {
  const hello = me ? `Hi ${me}, I’m ${name}.` : `Hi, I’m ${name}.`;
  const ask = me ? "What are you working on right now?" : "What should I call you, and what are you working on right now?";
  return `${hello} ${why} You’re trying Branch with examples, so my replies are examples until you add a model.\n\n${ask}`;
}

function firstWord(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

/** The person's first name from users.self, or the name remembered from setup. */
export function useFirstName(engine: WindowEngine | undefined, on: boolean): string {
  const [me, setMe] = useState(() => (on ? firstWord(recalledSessionName()) : ""));
  useEffect(() => {
    if (!on) return;
    const remembered = firstWord(recalledSessionName());
    if (remembered) setMe(remembered);
    if (!engine) return;
    let live = true;
    engine.request("users.self", {}).then((r) => {
      const name = readPersonName(r);
      const fromProfile = !name.includes("@") && name !== "Owner" ? firstWord(name) : "";
      if (live) setMe(fromProfile || remembered);
    }, () => {
      if (live && remembered) setMe(remembered);
    });
    return () => { live = false; };
  }, [engine, on]);
  return me;
}

/** The history to draw: the greeting alone while an examples conversation is empty, else the real history. */
export function useExamplesHistory(opts: { history: Block[]; live: Block[]; why?: string; historyReady: boolean; name: string; engine?: WindowEngine }): Block[] {
  const { history, live, why, historyReady, name, engine } = opts;
  const active = Boolean(why) && historyReady && history.length === 0 && live.length === 0;
  const me = useFirstName(engine, active);
  return useMemo<Block[]>(() => (active && why
    ? [{ kind: "text", key: EXAMPLES_GREETING_KEY, text: examplesGreetingText(me, name, why), streaming: false }]
    : history), [active, why, me, name, history]);
}
