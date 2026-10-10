// Settings › Computer & browser: the browser sections (The browser … Cloud browsers). Wired rows read and save
// browser.* config; launch flags live in browser.extraArgs; the profile list, status and check come from the
// browser control service through browser.request. Rows the engine can't back are greyed with why.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useRef, useState } from "react";
import { shownWhy } from "../../../shell/shown-why";
import { Btn, Ctl, Empty, Field, Pill, useConfig } from "../kit";
import { list } from "../adapter";
import { useAction } from "../hooks";
import { Dialog } from "../../../shell/Dialog";
import { CallLine, rec, str, useCall, useLive, type RecordValue } from "./common";
import type { Ctx, SecSpec, Spec } from "./computer-more";

const EXT = "Needs the Branch browser extension in your Chrome.";
const NO_HOW = "Needs the engine’s browsing options for this.";
const NO_CLEAN = "Needs the engine to clean pages before a Trunk reads them.";
const NO_HAND = "Needs the engine to hand this step to you.";
const NO_TIMING = "Needs the engine to set the browser’s waits and batches.";
const NO_CLOUD = "Needs a cloud browser service in this engine.";

const sw = (t: string, off: string, sub?: string): Spec => ({ t, k: "sw", off, sub });

export const BROWSER_BASIC: SecSpec = { t: "The browser", lv: 0, rows: [
  { t: "Which browser", k: "seg", key: "browser.defaultProfile", def: "branch", opts: [{ v: "branch", l: "Branch’s own" }, { v: "user", l: "Your Chrome" }], sub: "Its own profile keeps your tabs and sign-ins separate." },
  sw("Ask before a site it hasn’t visited", "Needs the engine to ask before each new site.", "You say yes once per site. Off until you choose: only a risky address asks."),
  sw("Open the browser full size when a task starts", "The browser’s size on screen is set by the Branch app.", "Otherwise it stays small in the corner."),
  { ...sw("Open links in Branch’s browser", "Where links open is set by the Branch app on this computer.", "Links in conversations open in the browser view. Off: they open in your usual browser. Saved on this computer only."), lv: 1 },
  sw("Decline cookie notices", "Needs the engine to answer cookie notices.", "Always picks the most private choice on any site: only the cookies the site needs."),
  sw("Let Trunks ask to read your browser history", "Needs the engine to read your browser history.", "A Trunk can’t read your history."),
  { t: "Browser privacy note", sub: "Shown before a Trunk first used the browser.", k: "btn", btn: "Read it", off: "Needs the engine to show this note before a Trunk first uses the browser." },
] };

const MORE: SecSpec = { t: "The browser, more", group: "The browser", showHeading: false, lv: 1, rows: [
  { t: "Run the browser in a sandbox", k: "seg", key: "browser.noSandbox", def: false, opts: [{ v: true, l: "Off" }, { v: "auto", l: "When needed", off: "The browser’s own sandbox is either on or off." }, { v: false, l: "On" }] },
  sw("Record browser tasks", "Needs the engine to record browser traces.", "A step-by-step trace you can replay. Off until you choose: recordings take disk space."),
  sw("Number the clickable things", "Needs the engine to number what can be clicked.", "Faster and steadier on busy pages."),
  { t: "Site skills", sub: "What Branch learned about the sites you use.", k: "btn", btn: "See", off: "Needs the engine to keep notes for each site." },
  sw("Page notes and “Send to Branch”", EXT, "A right-click in Chrome or Edge sends the page to a Trunk. Turns on when the browser extension is installed."),
  { t: "Browser profiles", k: "custom", render: (c) => <Profiles c={c} /> },
] };

const HOW: SecSpec = { t: "How it browses", group: "The browser", showHeading: false, lv: 1, rows: [
  { t: "How it reads pages", sub: "The list and the picture together. A model that can’t see pictures uses the list.", k: "seg", opts: [{ v: "page", l: "Page" }, { v: "picture", l: "Picture" }, { v: "both", l: "Both" }], off: NO_HOW },
  { t: "Read web pages", sub: "Opens a link in a browser and reads it as plain text when a plain download isn’t enough.", k: "seg", opts: [{ v: "off", l: "Off" }, { v: "auto", l: "When needed" }, { v: "on", l: "Always" }], off: NO_HOW },
  sw("Offer to read links you type", NO_HOW, "A link in your message gets a “Read it in?” offer above the message box."),
  { t: "Never offered for", sub: "Sites you said not to ask about.", k: "info", off: NO_HOW },
  sw("Keep the browser open between tasks", NO_HOW, "Later tasks pick up the same pages and sign-ins."),
  sw("Hand long web tasks to a browsing helper", NO_HOW, "A helper browses and reports back, so the conversation stays short."),
  sw("Use actions a page offers", NO_HOW, "Some sites list their own actions, like “search mail”; a Trunk uses those instead of clicking."),
  sw("Learn a site’s API from its traffic", NO_HOW, "A site it uses often becomes a skill that skips the browser next time."),
  sw("Think ahead before a click it can’t undo", NO_HOW, "It pictures where each choice leads and takes the one that gets closest."),
  sw("Copy a password when a page can’t be filled", NO_HOW, "You approve each copy; the clipboard clears after 30 seconds. The model never sees it."),
] };

const CLEANERS: SecSpec = { t: "Page cleaners", group: "The browser", showHeading: false, lv: 1, hint: "Cookie notices are declined in The browser above.", rows: [
  sw("Block ads", NO_CLEAN, "Pages load faster and read shorter."),
  sw("Clean tracking from links", NO_CLEAN, "Removes tracking bits from an address before opening it."),
  sw("Hide chat widgets and sign-up pop-ups", NO_CLEAN, "Hidden from what a Trunk reads; the page itself is unchanged."),
  sw("Flag pushy design", NO_CLEAN, "Marks fake countdowns, “only 2 left”, hidden fees, pre-ticked boxes and hard-to-cancel steps so a Trunk isn’t steered by them."),
] };

const SITES: SecSpec = { t: "Sites", group: "The browser", showHeading: false, lv: 1, hint: "Any other site follows “Ask before a site it hasn’t visited”. Private and local addresses are always refused.", body: () => <Sites /> };

const HANDS: SecSpec = { t: "What it hands to you", group: "The browser", showHeading: false, lv: 1, hint: "A yes counts only for the exact page, address and button it asked about; if the page changes first, it asks again. While you drive, it neither acts nor reads the page.", rows: [
  { t: "Changing a password", k: "val", val: "Hands it to you", tone: "warn", off: NO_HAND },
  { t: "“Are you a person?” checks and security warnings", k: "val", val: "Hands it to you", tone: "warn", off: NO_HAND },
  { t: "Camera, microphone and location requests", k: "val", val: "Asks you", tone: "idle", off: NO_HAND },
  { t: "Downloads", k: "val", val: "Asks you, or follows the site’s rule", tone: "idle", off: NO_HAND },
  { t: "Installing a browser extension", k: "val", val: "Asks you", tone: "idle", off: NO_HAND },
  sw("Ask before every typing, press or upload", NO_HAND, "Otherwise it asks only for the things above."),
  sw("Block uploads to every site", "Needs the engine to block uploads.", "Otherwise uploads follow each site’s rule."),
] };

const FLOWS: SecSpec = { t: "Saved flows", group: "The browser", showHeading: false, lv: 1, hint: "A journey across pages, saved from a finished browser task with a picture of each step, to run again in one go.", body: () => <Empty>Needs the engine to save browser journeys.</Empty> };

const OWN: SecSpec = { t: "Your own browser", group: "The browser", showHeading: false, lv: 1, rows: [
  sw("Work in its own window in your Chrome", EXT, "Your tabs stay yours. It borrows one only after you allow it on that page, and gives it back when the task ends."),
  sw("Follow videos you watch", EXT, "Where you are in a video, its captions and the picture, for questions about it."),
  { t: "Branch in Chrome’s side panel", sub: "Chat with your Trunks beside any page.", k: "btn", btn: "Get the extension", off: "The extension is installed from the Branch app." },
  { t: "Chat on your own website", sub: "Visitors chat with a Trunk you pick, through your Gateway.", k: "btn", btn: "Show the code", off: "Needs the engine’s website chat." },
  { t: "A helper inside a page you build", sub: "Reads the page as text and clicks and types in place, with a pointer you can see. No extension or pictures needed.", k: "btn", btn: "Show the code", off: "Needs the engine’s in-page helper." },
] };

export const BROWSER_MORE: SecSpec[] = [MORE, HOW, CLEANERS, SITES, HANDS, FLOWS, OWN];

const TECH: SecSpec = { t: "The browser, technical", group: "The browser", showHeading: false, lv: 2, rows: [
  { t: "Browser program", k: "custom", render: (c) => <Program c={c} /> },
  { t: "Branch’s own browser", k: "custom", render: (c) => <Found c={c} /> },
  { t: "Show the browser window", k: "seg", key: "browser.headless", opts: [{ v: null, l: "Auto" }, { v: false, l: "Always" }, { v: true, l: "Never" }], sub: "Auto works without a window. Always opens one on this computer.", help: "Auto keeps the browser out of sight so it does not take over your screen. Always opens a window you can see. Never keeps it hidden." },
  sw("A light browser for reading pages", "Needs a reading-only browser service to connect to.", "Every page opens in the full browser."),
  { t: "Where browser actions go", k: "info", off: "Needs the engine to report how it routes browser actions." },
  { t: "Connect to a browser at an address", k: "text", key: "browser.cdpUrl", ph: "http://127.0.0.1:9222", sub: "A browser’s debugging link, on this computer or another. Empty: Branch starts its own." },
  sw("Let Trunks send raw commands through the debugging link", "Needs the engine to pass raw commands to the browser.", "For anything the browser tools don’t cover. Each site’s Debugging access still applies."),
  { t: "Let a Trunk write browser scripts", k: "sw", key: "browser.evaluateEnabled", def: true, sub: "For many repeated steps it writes one short script against the open browser." },
  { t: "Proxy server", k: "arg", arg: "--proxy-server", ph: "http://proxy.example:8080", sub: "Empty: no proxy." },
  { t: "Skip the proxy for", k: "arg", arg: "--proxy-bypass-list", ph: "localhost, *.internal", sub: "Addresses that go direct, separated by commas." },
  { t: "Proxy sign-in", sub: "Kept with your keys, never in the settings file.", k: "btn", btn: "Set…", off: "Needs the engine to keep a proxy sign-in with your keys." },
  { t: "What every page may use", k: "custom", render: () => <PagePerms /> },
  { t: "Identify as", k: "arg", arg: "--user-agent", ph: "The browser’s own", sub: "What sites see as the browser’s name. Empty: the browser’s own." },
  { t: "Window size", k: "arg", arg: "--window-size", ph: "Fits the screen", sub: "Width × height in pixels. Empty: fits the screen." },
  { t: "Page pop-up questions", sub: "Alerts and confirm boxes go to the Trunk to answer and never block a task; each waits up to 5 minutes.", k: "seg", opts: [{ v: "trunk", l: "The Trunk answers" }, { v: "ok", l: "Always OK" }, { v: "cancel", l: "Always Cancel" }], off: "Needs the engine to answer page pop-ups by a rule." },
  { t: "Close an idle browser after", sub: "Also closes the tabs a Trunk opened, and anything left running when Branch quits.", k: "num", unit: "seconds", off: "Needs the engine to close an idle browser after a set time." },
  { t: "Wait for a click to work", sub: "Up to 60.", k: "num", unit: "seconds", off: NO_TIMING },
  { t: "Wait for a page", sub: "Up to 120.", k: "num", unit: "seconds", off: NO_TIMING },
  { t: "Steps sent in one go", sub: "Up to 100.", k: "num", unit: "steps", off: NO_TIMING },
  sw("Offer Branch’s tools to assistants built into Chrome", "Needs the engine to offer its tools to pages.", "A page’s own assistant can find and call your Trunks’ tools."),
  { t: "Check the browser end to end", k: "custom", render: (c) => <Doctor c={c} /> },
] };

const CLOUD_BROWSERS: SecSpec = { t: "Cloud browsers", group: "The browser", showHeading: false, lv: 2, rows: [
  { t: "Cloud browsers", sub: "A browser run by a hosted service, for sites that need another location or many browsers at once.", k: "btn", btn: "Add one", off: NO_CLOUD },
  { t: "Local addresses on a cloud browser", sub: "A cloud browser can’t reach localhost or your network, so a browser on this computer opens those.", k: "seg", opts: [{ v: "side", l: "Open on this computer" }, { v: "hint", l: "Show how to reach it" }], off: NO_CLOUD },
  sw("Let a cloud service drive a browser on this computer", NO_CLOUD, "Starts your browser with a private link the service can reach."),
] };

export const BROWSER_TECH: SecSpec[] = [TECH, CLOUD_BROWSERS];

const STATUS = { method: "GET", path: "/" };

/** Sites: no per-site rules in the engine yet, so the add field is drawn inert with why. */
function Sites() {
  const why = "Needs the engine to keep a rule for each site.";
  return (
    <>
      <Empty>{why}</Empty>
      <div className="s2cm-site" title={shownWhy(why)}>
        <input className="inp" aria-label="Add a site" placeholder="Add a site, e.g. example.com" disabled />
        <Btn sm disabled>Add</Btn>
      </div>
    </>
  );
}

const PERMS = ["Clipboard", "Notifications", "Location", "Camera", "Microphone"];
function PagePerms() {
  return (
    <Ctl title="What every page may use" sub="Given when the browser starts. Anything else a page wants asks you." off="Needs the engine to grant page permissions when the browser starts.">
      <span className="s2cm-perm">{PERMS.map((p) => <label key={p}><input type="checkbox" disabled />{p}</label>)}</span>
    </Ctl>
  );
}

function Program({ c }: { c: Ctx }) {
  const cfg = useConfig(c.engine);
  const st = useLive<RecordValue>(c.engine, "browser.request", STATUS, []);
  const found = str(rec(st.data).detectedExecutablePath);
  return (
    <Ctl title="Browser program" sub="Branch uses the browser picked here for each job." help="Branch finds the browsers on this computer, starts the one picked here and closes what it started when a task ends.">
      <Field label="Browser program" value={str(cfg.get("browser.executablePath"))} placeholder={found ? `${str(rec(st.data).detectedBrowser) || "Found"} · ${found}` : "Found by itself"} onCommit={(v) => void cfg.set("browser.executablePath", v.trim() || null)} wide />
    </Ctl>
  );
}

function Found({ c }: { c: Ctx }) {
  const st = useLive<RecordValue>(c.engine, "browser.request", STATUS, []);
  const d = rec(st.data);
  return (
    <Ctl title="Branch’s own browser" sub={st.error || str(d.detectError) || "The browser Branch starts for its own profile, found on this computer."}>
      {st.data ? <Pill tone={str(d.detectedBrowser) ? "ok" : "idle"}>{str(d.detectedBrowser) ? `${str(d.detectedBrowser)} found` : "Not found"}</Pill> : null}
    </Ctl>
  );
}

const DRIVER: Record<string, string> = { branch: "Branch’s own", "existing-session": "Your Chrome", extension: "Your Chrome, through the extension" };

/** Browser profiles: each profile the browser service knows, and which one is the default. */
function Profiles({ c }: { c: Ctx }) {
  const [open, setOpen] = useState(false);
  return (
    <Ctl title="Browser profiles" sub="Separate sets of tabs and sign-ins. Each Trunk can use its own.">
      <Btn sm onClick={() => setOpen(true)}>Manage</Btn>
      {open ? <ProfilesDialog c={c} onClose={() => setOpen(false)} /> : null}
    </Ctl>
  );
}

function ProfilesDialog({ c, onClose }: { c: Ctx; onClose: () => void }) {
  const cfg = useConfig(c.engine);
  const res = useLive<RecordValue>(c.engine, "browser.request", { method: "GET", path: "/profiles" }, []);
  const profiles = list(rec(res.data).profiles);
  return (
    <Dialog title="Browser profiles" wide onClose={onClose}>
      {res.error ? <p className="hint s2-err" role="alert">{res.error}</p> : null}
      {res.loading && !res.data ? <p>Reading the profiles…</p> : null}
      {res.data && !profiles.length ? <p className="hint">No browser profiles yet.</p> : null}
      <div className="rows">
        {profiles.map((p) => (
          <div key={str(p.name)} className="prow" data-row={str(p.name)}>
            <span className="s2cm-swatch" style={{ background: str(p.color) || undefined }} />
            <span className="grow"><b>{str(p.name)}</b><small>{[DRIVER[str(p.driver)] ?? str(p.driver), p.running === true ? `${Number(p.tabCount) || 0} tabs open` : "Not running", p.isRemote === true ? "Remote" : ""].filter(Boolean).join(" · ")}</small></span>
            {p.isDefault === true ? <Pill tone="ok">Default</Pill> : <Btn sm ghost disabled={cfg.loading} onClick={() => void cfg.set("browser.defaultProfile", str(p.name))}>Make it the default</Btn>}
          </div>
        ))}
      </div>
    </Dialog>
  );
}

const CHECK_TONE: Record<string, "ok" | "warn" | "bad" | "idle"> = { pass: "ok", warn: "warn", fail: "bad", info: "idle" };
const CHECK_WORD: Record<string, string> = { pass: "Passed", warn: "Look at it", fail: "Failed", info: "Note" };

/** The browser service's own end-to-end check (/doctor), run when asked. */
function Doctor({ c }: { c: Ctx }) {
  const call = useCall();
  const action = useAction();
  const [report, setReport] = useState<RecordValue | null>(null);
  const generation = useRef(0);
  const close = () => { generation.current++; setReport(null); };
  const run = () => void action.run(() => call.run(async () => {
    const current = ++generation.current;
    const next = rec(await c.engine.request("browser.request", { method: "GET", path: "/doctor" }));
    if (current === generation.current) setReport(next);
  }));
  return (
    <Ctl title="Check the browser end to end" sub="Checks browsing, sign-in and forms that need your yes." help="Start, open, read, close, a signed-in flow and a form that stops before your yes." after={<CallLine call={call} />}>
      <Btn sm disabled={action.busy} onClick={run}>{action.busy ? "Checking…" : "Open the check"}</Btn>
      {report ? (
        <Dialog title="Browser check" wide onClose={close} footer={<><Btn ghost disabled={action.busy} onClick={run}>{action.busy ? "Checking…" : "Check again"}</Btn></>}>
          <CallLine call={call} />
          {action.busy ? <p role="status">Checking…</p> : null}
          {!action.busy && !call.error ? <><p>{report.ok === true ? "Every check passed." : "Some checks need attention."}</p>
          <div className="rows">
            {list(report.checks).map((k) => (
              <div key={str(k.id)} className="prow"><span className="grow"><b>{str(k.label)}</b><small>{str(k.summary)}{str(k.fixHint) ? ` ${str(k.fixHint)}` : ""}</small></span><Pill tone={CHECK_TONE[str(k.status)] ?? "idle"}>{CHECK_WORD[str(k.status)] ?? str(k.status)}</Pill></div>
            ))}
          </div></> : null}
        </Dialog>
      ) : null}
    </Ctl>
  );
}
