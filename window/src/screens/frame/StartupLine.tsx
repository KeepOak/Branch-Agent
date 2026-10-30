// The R1 window's one line while the open Trunk is still getting ready (the engine's structured startup refusal,
// connect/preparation-status isStartupUnavailable). It says "Getting <Trunk> ready…" in the composer's words, never in
// red. Only after PREPARATION_TIMEOUT_MS does it say so in a plain sentence with Fix it, which starts the Trunk's
// preparation again through the same agents.retryStartup the Classic thread's Retry uses (connect/startup-preparation).
// The engine's own words show only at Technical, in a Raw error fold (preview §5.6).
import { useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { preparationLabel, preparationSlowLabel, type StartupWait } from "../../connect/preparation-status";
import { useStartupPreparation } from "../../connect/startup-preparation";
import { Coming } from "../../glass/coming";
import { shows, useLevel } from "../../places-nav/level";

const FIX_IT = "Fix it";
const FIX_IT_FAILED = "Couldn’t fix it. Try again in a minute.";

export function StartupLine({ engine, name, startup }: { engine: WindowEngine; name: string; startup: StartupWait }) {
  const technical = shows(useLevel(), "technical");
  const repair = useStartupPreparation(engine, startup.stalled);
  // Fix it worked: back to the calm line until the conversation reads again (connect/session.ts startup watch).
  // A read that is refused again is a new wait (a new `startup`): Fix it shows again once that one times out.
  const [fixedFor, setFixedFor] = useState<StartupWait | null>(null);
  const slow = startup.stalled && !(fixedFor === startup && !repair.busy && !repair.error);
  const fix = () => { setFixedFor(startup); repair.retry(); };
  return <>
    <span data-testid="startup-line" data-state={slow ? "slow" : "getting-ready"}>{slow ? preparationSlowLabel(name) : preparationLabel(name)}</span>
    {slow ? <>{" "}<Coming engine={engine} need="agents.retryStartup" reason={`${FIX_IT} comes in a later update.`}><button type="button" data-testid="startup-fix" disabled={repair.busy} onClick={fix}>{repair.busy ? "Fixing…" : FIX_IT}</button></Coming></> : null}
    {slow && repair.error ? <span data-testid="startup-fix-failed"> {FIX_IT_FAILED}</span> : null}
    {technical ? <details className="r1-startup-raw" data-testid="startup-raw"><summary>Raw error</summary><pre>{repair.error ? `${startup.detail}\n\n${repair.error}` : startup.detail}</pre></details> : null}
  </>;
}
