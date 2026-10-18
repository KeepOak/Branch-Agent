// Settings › General, Writing and Starting up: the rows with a real setting (Show "Finish setting up", Start Branch
// when I sign in, Keep working…). Starting up talks to the Branch app's own login-item and linger paths
// (window/src/connect/desktop-controls.ts → desktop/src/desktop-controls.ts). A toggle that cannot be changed is
// greyed with one plain line; a failed enable goes back to OFF with one plain line, never ON beside a failure.
import { useState } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { IN_BROWSER, NEEDS_NEWER_APP, useDesktopControls, type DesktopControlsState } from "../../../connect/desktop-controls";
import { platformName } from "../../../setup/steps-later";
import { Ctl, Sec, Switch, useSaveRunner } from "../kit";
import { useLook } from "./appearance-store";

/** The computer's own name for itself, as setup's Start-with row uses it. */
export const OS = platformName;

export const START_AT_SIGN_IN = "Start Branch when I sign in";
export const KEEP_SIGNED_OUT = "Keep working when nobody is signed in";

/** Said under Start Branch when I sign in when the Branch app on this computer is too old to change it (DA-78): the
 *  app's own note is a developer note that is never shown, so a greyed switch would otherwise sit there with no reason. */
export const START_NEEDS_UPDATE = "Update the Branch app on this computer to change this.";
export const START_FAIL = "Branch couldn’t be set to start when you sign in.";
export const KEEP_FAIL = "Branch couldn’t be set to keep working.";
export const KEEP_SIGNED_OUT_UNAVAILABLE = "This is only on Linux, with Branch’s background service.";
export const DESKTOP_READ_FAIL = "The Branch app on this computer didn’t say how this is set.";

/** The login-item switch (startWithWindows) and the Linux linger switch (keepWorkingSignedOut). */
export type StartupName = "startWithWindows" | "keepWorkingSignedOut";

/** A one-line reason a startup switch failed: never the raw error, a stack or a code. */
export function desktopFailReason(name: StartupName): string {
  return name === "startWithWindows" ? START_FAIL : KEEP_FAIL;
}

/** True when a leftover line from the app is a failure (couldn't install, denied), not a quiet note. */
export function isStartupFailureNote(text: string | undefined): boolean {
  return Boolean(text && /couldn['’]?t|could not|failed|denied/i.test(text));
}

function deskWhy(off: string | undefined, error: string | null, state: DesktopControlsState | null): string | undefined {
  if (off === NEEDS_NEWER_APP) return START_NEEDS_UPDATE;
  if (off === IN_BROWSER) return IN_BROWSER;
  if (!state && (off || error)) return DESKTOP_READ_FAIL;
  return undefined;
}

/** Starting up: Start Branch when I sign in (login item) and Keep working when nobody is signed in (Linux linger). */
export function StartingUp() {
  const desk = useDesktopControls();
  const why = deskWhy(desk.off, desk.error, desk.state);
  return (
    <Sec title="Starting up">
      <StartupSwitch desk={desk} why={why} title={START_AT_SIGN_IN} sub="Opens quietly in the tray." name="startWithWindows" />
      <StartupSwitch
        desk={desk}
        why={why ?? (desk.state && desk.state.keepWorkingSignedOut === undefined ? KEEP_SIGNED_OUT_UNAVAILABLE : undefined)}
        title={KEEP_SIGNED_OUT}
        sub="Your Trunks start after a restart, before anyone signs in."
        name="keepWorkingSignedOut"
      />
    </Sec>
  );
}

function StartupSwitch({
  desk, why, title, sub, name,
}: {
  desk: ReturnType<typeof useDesktopControls>;
  why: string | undefined;
  title: string;
  sub: string;
  name: StartupName;
}) {
  const save = useSaveRunner(desktopFailReason(name));
  const [fail, setFail] = useState<string | null>(null);
  const [hope, setHope] = useState<boolean | null>(null);
  const note = desk.state?.notes?.[name];
  const noteFail = !why && isStartupFailureNote(note);
  const reason = fail ?? (noteFail ? desktopFailReason(name) : null);
  // A failure always draws OFF. Hope is only while a change is in flight, and never beside a reason.
  const on = Boolean(!why && !reason && (hope ?? desk.state?.[name]));
  const change = (want: boolean) => {
    if (why) return;
    setFail(null);
    setHope(want);
    void save(async () => {
      if (!desk.bridge) throw new Error(desktopFailReason(name));
      const ok = await desk.set(name, want);
      if (!ok) throw new Error(desktopFailReason(name));
      if (want) {
        const next = await desk.bridge.get();
        if (next[name] !== true) throw new Error(desktopFailReason(name));
      }
    }).then((ok) => {
      setHope(null);
      if (!ok) setFail(desktopFailReason(name));
    });
  };
  return (
    <Ctl title={title} sub={sub} off={why} after={!why && reason ? <small className="why-k" role="alert">{reason}</small> : null}>
      <Switch checked={on} disabled={desk.busy !== null} label={title} onChange={change} />
    </Ctl>
  );
}

/** Overview's "Finish setting up" checklist: the person's own choice, kept in their look ("checklist"). */
function FinishSetupRow({ engine }: { engine: WindowEngine }) {
  const look = useLook(engine);
  const save = useSaveRunner();
  const on = look.val("checklist", true) !== false;
  return (
    <Ctl title="Show “Finish setting up”" sub="The checklist on Overview until every step is done.">
      <Switch checked={on} label="Show “Finish setting up”" onChange={(v) => void save(() => look.store.set("checklist", v ? null : false))} />
    </Ctl>
  );
}

export function Writing({ engine }: { engine: WindowEngine }) {
  return (
    <Sec title="Writing">
      <FinishSetupRow engine={engine} />
    </Sec>
  );
}
