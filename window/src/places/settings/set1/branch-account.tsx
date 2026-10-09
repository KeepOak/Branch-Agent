// Settings › Branch account: sign in with Google once on each computer (p1-acct part A). The engine's
// account.status, account.google.signIn (a browser sign-in run as a wizard session) and account.signOut. Google's
// page opens in the system browser; Branch never shows it or asks for a password.
import { useEffect, useState } from "react";
import type { WindowEngine } from "../../../connect/engine";
import type { SettingsPageProps } from "../index";
import { Acts, Btn, Ctl, Page, Pill, Sec, type RowEntry } from "../kit";
import { WizardBody } from "../AccountLogin";
import { useWizard } from "../use-wizard";
import { CallLine, rec, str, useCall, useLive, when, type RecordValue } from "../set2/common";

const LEDE = "Sign in with Google once on each computer.";
const LEDE_HELP = "Your Branch account is your Google account. You sign in on Google's own page in your browser, so Branch never sees your password. The sign-in is kept in this computer's keychain, never in a file.";

export const ACCOUNT_ROWS: RowEntry[] = [
  { page: "account", title: "Google account", sec: "Sign-in", group: "Sign-in", lv: 0, words: "google sign in sign out branch account" },
];

export function BranchAccountPage(props: SettingsPageProps) {
  const status = useLive<RecordValue>(props.engine, "account.status", {}, []);
  const google = rec(rec(status.data).google);
  const [signingIn, setSigningIn] = useState(false);
  const signOut = useCall();
  const finish = () => { setSigningIn(false); void status.reload(); };
  return (
    <Page title={props.title} lede={LEDE} help={LEDE_HELP}>
      {status.error ? <p className="hint s2-err" role="alert">{status.error}</p> : null}
      <Sec title="Sign-in">
        {google.signedIn === true ? (
          <Ctl title="Google account" sub={`Signed in ${when(google.signedInAt)}. Kept in ${str(google.keychain)}.`}>
            <Pill tone="ok">{str(google.email)}</Pill>
            <Btn sm ghost disabled={signOut.busy}
              onClick={() => void signOut.run(async () => { await props.engine.request("account.signOut", {}); await status.reload(); }, () => "Signed out. The sign-in was removed from this computer.")}>Sign out</Btn>
          </Ctl>
        ) : signingIn ? (
          <GoogleSignIn engine={props.engine} onDone={finish} />
        ) : (
          <Ctl title="Google account" sub={status.data === undefined ? "Checking…" : google.available === true ? "Not signed in." : str(google.reason)}>
            <Btn sm pri disabled={google.available !== true} onClick={() => { signOut.clear(); setSigningIn(true); }}>Sign in with Google</Btn>
          </Ctl>
        )}
        <CallLine call={signOut} />
      </Sec>
    </Page>
  );
}

/** The sign-in while it runs: the browser link, the waiting line, then the result. */
function GoogleSignIn({ engine, onDone }: { engine: WindowEngine; onDone: () => void }) {
  const w = useWizard(engine, { method: "account.google.signIn", params: {} });
  const done = w.view.phase === "done";
  useEffect(() => { if (done) onDone(); }, [done, onDone]);
  const ended = w.view.phase === "error";
  return (
    <Ctl title="Google account" stack>
      <WizardBody wizard={w} doneText="Signed in." />
      <Acts>
        {ended
          ? <Btn sm onClick={onDone}>Close</Btn>
          : <Btn sm ghost onClick={() => { w.cancel(); onDone(); }}>Cancel</Btn>}
      </Acts>
    </Ctl>
  );
}
