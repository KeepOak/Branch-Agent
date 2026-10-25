// Settings › Instructions & personality: Classic's own blocks inside the R1 cards (spec-rows ClassicBlock): Just about
// you (users.personalFile.*) and the files each Trunk reads with their editor (agents.files.*).
import { useEffect, useId, useRef, type RefObject } from "react";
import { AboutYouBlock, InstructionFiles } from "../../../places/settings/set1/instructions";
import type { SlotControlProps } from "../slots";
import { ClassicBlock } from "./spec-rows";

/** Why every file's Read switch is greyed (Private #1093): Branch decides what it reads, so the switch only shows it. */
export const READ_WHY = "Branch turns Read on by itself: it reads each file that has something in it, unless this Trunk is set to read none.";

/** Names each greyed control in the files block with a visible reason (aria-describedby): the Read switches with
 *  READ_WHY, and a greyed Edit or Write with its row's own line (why it can't be opened, its error, or Reading…). The
 *  block is Classic's, so the names are added to its rows as they appear. */
function useReasons(box: RefObject<HTMLDivElement | null>, whyId: string) {
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const name = () => {
      for (const sw of el.querySelectorAll<HTMLInputElement>('input[aria-label^="Read "]')) {
        const want = sw.disabled ? whyId : null;
        if (want && sw.getAttribute("aria-describedby") !== want) sw.setAttribute("aria-describedby", want);
        else if (!want && sw.hasAttribute("aria-describedby")) sw.removeAttribute("aria-describedby");
      }
      el.querySelectorAll<HTMLElement>(".if-row").forEach((row, i) => {
        const btn = row.querySelector<HTMLButtonElement>(":scope > button");
        if (!btn) return;
        const why = row.querySelector<HTMLElement>(".why-k") ?? row.querySelector<HTMLElement>(".grow > small");
        if (btn.disabled && why?.textContent?.trim()) {
          if (!why.id) why.id = `${whyId}-${i}`;
          if (btn.getAttribute("aria-describedby") !== why.id) btn.setAttribute("aria-describedby", why.id);
        } else if (btn.hasAttribute("aria-describedby")) btn.removeAttribute("aria-describedby");
      });
    };
    name();
    const watch = new MutationObserver(name);
    watch.observe(el, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["disabled"] });
    return () => watch.disconnect();
  }, [box, whyId]);
}

export const AboutYou = (props: SlotControlProps) => <ClassicBlock {...props} draw={(c) => <AboutYouBlock {...c.props} />} />;
export function Files(props: SlotControlProps) {
  const box = useRef<HTMLDivElement>(null);
  const whyId = useId();
  useReasons(box, whyId);
  return <div ref={box} data-files-reasons="">
    <ClassicBlock {...props} draw={(c) => <InstructionFiles {...c.props} />} />
    <small id={whyId} className="r1s-msg g-label" data-lines>{READ_WHY}</small>
  </div>;
}
