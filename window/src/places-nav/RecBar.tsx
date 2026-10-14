// The recommendation bar (preview recBar, Private #1049 section G): one question at a time above a place's h1.
// Yes turns the setting on, Not now hides the question until tomorrow, Don't ask again hides it for good. A question
// whose setting is already on is never asked. The gateway question needs the Branch app's switch, so it is not asked in a
// plain browser. A failed save shows its error as a toast.
import { useReducer } from "react";
import type { WindowEngine } from "../connect/engine";
import { useDesktopControls } from "../connect/desktop-controls";
import { configStore } from "../places/settings/config-store";
import { errorText } from "../places/settings/adapter";
import { useConfig } from "../places/settings/kit";
import { notify } from "../shell/notify";
import { dismiss, isDismissed, type RecKind } from "./rec-bar-state";
import "./rec-bar.css";

const COPY: Record<RecKind, { title: string; body: string; done: string }> = {
  gateway: {
    title: "Keep your Trunks running when Branch is closed?",
    body: "The gateway keeps Telegram, your phone and automations working, and restarts Branch if it ever stops.",
    done: "The gateway is on. Your Trunks keep running when Branch is closed.",
  },
  update: {
    title: "Keep Branch up to date by itself?",
    body: "It waits until no task is working, checks the download and keeps a safety copy first.",
    done: "Branch keeps itself up to date.",
  },
};
const LATER_TOAST = "We’ll ask again tomorrow.";

type Ready = { ready: boolean; on: boolean };

/** The first question still open: its setting is off, it is loaded, and it was not dismissed. */
function askKind(gateway: Ready, update: Ready): RecKind | null {
  const now = Date.now();
  if (gateway.ready && !gateway.on && !isDismissed("gateway", now)) return "gateway";
  if (update.ready && !update.on && !isDismissed("update", now)) return "update";
  return null;
}

export function RecBar({ engine }: { engine: WindowEngine }) {
  const config = useConfig(engine);
  const desk = useDesktopControls();
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const kind = askKind(
    { ready: desk.state !== null, on: desk.state?.keepWorking === true },
    { ready: !config.loading, on: config.get("update.auto.enabled") === true },
  );
  if (!kind) return null;
  const copy = COPY[kind];
  const yes = async () => {
    if (kind === "gateway") {
      if (await desk.set("keepWorking", true)) notify(copy.done);
      return;
    }
    try {
      await configStore(engine).set("update.auto.enabled", true);
      notify(copy.done);
    } catch (error) {
      notify(errorText(error), { tone: "bad" });
    }
  };
  const later = () => { dismiss(kind, "later"); notify(LATER_TOAST); redraw(); };
  const never = () => { dismiss(kind, "never"); redraw(); };
  return (
    <div className="recbar" data-rec={kind}>
      <span className="mark mark-face rec-mark" aria-hidden="true" />
      <span className="rec-t"><b>{copy.title}</b><span className="rec-tag">Recommended</span><small>{copy.body}</small></span>
      <button type="button" className="btn pri sm" onClick={() => void yes()}>Yes</button>
      <button type="button" className="btn sm" onClick={later}>Not now</button>
      <button type="button" className="btn ghost sm" onClick={never}>Don’t ask again</button>
    </div>
  );
}
