// A control the onboarding card doesn't wire yet (R1-10): <Coming unwired> greys it with its one-line reason, swallows
// every click, key and pointer event, and lists it in the dev Coming report by the engine call it waits for.
import type { ReactElement } from "react";
import { Coming } from "../../glass/coming";

export function Unwired({ need, reason, where, children }: { need: string; reason: string; where: string; children: ReactElement }) {
  return <Coming need={need} unwired reason={reason} where={where}>{children}</Coming>;
}
