// Settings › Data & usage › Report a problem. The desktop bundles the recent logs into one zip the owner saves.
import { useState } from "react";
import { Btn, Ctl, Hint, Pick, Sec } from "../kit";

type Reporter = { diagnostics?: { reportProblem?: (minutes: number) => Promise<{ saved: boolean }> } };

const SPANS = [
  { id: "15", label: "Last 15 minutes" },
  { id: "30", label: "Last 30 minutes" },
  { id: "60", label: "Last hour" },
  { id: "120", label: "Last 2 hours" },
];

export function ReportProblem() {
  const [span, setSpan] = useState("30");
  const [status, setStatus] = useState("");
  const reportProblem = (window as unknown as { branchDesktop?: Reporter }).branchDesktop?.diagnostics?.reportProblem;
  if (!reportProblem) {
    return (
      <Sec title="Report a problem">
        <Hint>Saving a report needs the desktop app.</Hint>
      </Sec>
    );
  }
  const save = async () => {
    setStatus("Preparing the report…");
    try {
      const result = await reportProblem(Number(span));
      setStatus(result.saved ? "Saved." : "Not saved.");
    } catch {
      setStatus("Couldn’t prepare the report.");
    }
  };
  return (
    <Sec title="Report a problem">
      <Ctl
        title="Save a report for the team"
        sub="The app log, the engine log and what you did in this window, for the span you pick. Secrets and email addresses are removed. Message text is never recorded."
        stack
        after={
          <>
            <Pick value={span} options={SPANS} onChange={setSpan} label="Time span for the report" />
            <Btn pri onClick={() => void save()}>Save report…</Btn>
          </>
        }
      />
      {status ? <Hint>{status}</Hint> : null}
    </Sec>
  );
}
