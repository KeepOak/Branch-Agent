// Settings › Computer & browser: the browser sections (The browser … Cloud browsers). Wired rows read and save
// browser.* config; launch flags live in browser.extraArgs; the profile list, status and check come from the
// browser control service through browser.request. Rows the engine can't back are greyed with why.
import { useState } from "react";
import { Btn, Ctl, Field, Pill, useConfig } from "../kit";
import { list } from "../adapter";
import { Dialog } from "../../../shell/Dialog";
import { CallLine, rec, str, useCall, useLive, type RecordValue } from "./common";
import type { Ctx, SecSpec, Spec } from "./computer-more";

const EXT = "Needs the Branch browser extension in your Chrome.";
const NO_HOW = "Needs the engine’s browsing options for this.";
const NO_CLEAN = "Needs the engine to clean pages before a Trunk reads them.";
const NO_HAND = "Needs the engine to hand this step to you.";
const NO_TIMING = "Needs the engine to set the browser’s waits and batches.";
const NO_CLOUD = "Needs a cloud browser service in this engine.";

const sw = (t: string, off: string): Spec => ({ t, k: "sw", off });

export const BROWSER_BASIC: SecSpec = { t: "The browser", lv: 0, rows: [
  { t: "Which browser", k: "seg", key: "browser.defaultProfile", def: "branch", opts: [{ v: "branch", l: "Branch’s own" }, { v: "user", l: "Your Chrome" }], sub: "Its own profile keeps your tabs and sign-ins separate." },
  sw("Ask before a site it hasn’t visited", "Needs the engine to ask before each new site."),
  sw("Open the browser full size when a task starts", "The browser’s size on screen is set by the Branch app."),
  { ...sw("Open links in Branch’s browser", "Where links open is set by the Branch app on this computer."), lv: 1 },
  sw("Decline cookie notices", "Needs the engine to answer cookie notices."),
  sw("Let Trunks ask to read your browser history", "Needs the engine to read your browser history."),
  { t: "Browser privacy note", k: "btn", btn: "Read it", off: "Needs the engine to show this note before a Trunk first uses the browser." },
] };

const MORE: SecSpec = { t: "The browser, more", lv: 1, rows: [
  { t: "Run the browser in a sandbox", k: "seg", key: "browser.noSandbox", def: false, opts: [{ v: true, l: "Off" }, { v: "auto", l: "When needed", off: "The browser’s own sandbox is either on or off." }, { v: false, l: "On" }] },
  sw("Record browser tasks", "Needs the engine to record browser traces."),
  sw("Number the clickable things", "Needs the engine to number what can be clicked."),
  { t: "Site skills", k: "btn", btn: "See", off: "Needs the engine to keep notes for each site." },
  sw("Page notes and “Send to Branch”", EXT),
  { t: "Browser profiles", k: "custom", render: (c) => <Profiles c={c} /> },
] };

const HOW: SecSpec = { t: "How it browses", lv: 1, rows: [
  { t: "How it reads pages", k: "seg", opts: [{ v: "page", l: "Page" }, { v: "picture", l: "Picture" }, { v: "both", l: "Both" }], off: NO_HOW },
  { t: "Read web pages", k: "seg", opts: [{ v: "off", l: "Off" }, { v: "auto", l: "When needed" }, { v: "on", l: "Always" }], off: NO_HOW },
  sw("Offer to read links you type", NO_HOW),
  { t: "Never offered for", k: "btn", btn: "See", off: NO_HOW },
  sw("Keep the browser open between tasks", NO_HOW),
  sw("Hand long web tasks to a browsing helper", NO_HOW),
  sw("Use actions a page offers", NO_HOW),
  sw("Learn a site’s API from its traffic", NO_HOW),
  sw("Think ahead before a click it can’t undo", NO_HOW),
  sw("Copy a password when a page can’t be filled", NO_HOW),
] };

const CLEANERS: SecSpec = { t: "Page cleaners", lv: 1, hint: "Cookie notices are declined in The browser above.", rows: [
  sw("Block ads", NO_CLEAN), sw("Clean tracking from links", NO_CLEAN), sw("Hide chat widgets and sign-up pop-ups", NO_CLEAN), sw("Flag pushy design", NO_CLEAN),
] };

const SITES: SecSpec = { t: "Sites", lv: 1, hint: "Any other site follows “Ask before a site it hasn’t visited”. Private and local addresses are always refused.", rows: [
  { t: "Add a site", k: "text", off: "Needs the engine to keep a rule for each site." },
] };

const HANDS: SecSpec = { t: "What it hands to you", lv: 1, hint: "A yes counts only for the exact page, address and button it asked about; if the page changes first, it asks again. While you drive, it neither acts nor reads the page.", rows: [
  { t: "Changing a password", k: "btn", off: NO_HAND },
  { t: "“Are you a person?” checks and security warnings", k: "btn", off: NO_HAND },
  { t: "Camera, microphone and location requests", k: "btn", off: NO_HAND },
  { t: "Downloads", k: "btn", off: NO_HAND },
  { t: "Installing a browser extension", k: "btn", off: NO_HAND },
  sw("Ask before every typing, press or upload", NO_HAND),
  sw("Block uploads to every site", "Needs the engine to block uploads."),
] };

const FLOWS: SecSpec = { t: "Saved flows", lv: 1, hint: "A journey across pages, saved from a finished browser task with a picture of each step, to run again in one go.", rows: [
  { t: "Saved journeys", k: "btn", btn: "See", off: "Needs the engine to save browser journeys." },
] };

const OWN: SecSpec = { t: "Your own browser", lv: 1, rows: [
  sw("Work in its own window in your Chrome", EXT),
  sw("Follow videos you watch", EXT),
  { t: "Branch in Chrome’s side panel", k: "btn", btn: "Get the extension", off: "The extension is installed from the Branch app." },
  { t: "Chat on your own website", k: "btn", btn: "Show the code", off: "Needs the engine’s website chat." },
  { t: "A helper inside a page you build", k: "btn", btn: "Show the code", off: "Needs the engine’s in-page helper." },
] };

export const BROWSER_MORE: SecSpec[] = [MORE, HOW, CLEANERS, SITES, HANDS, FLOWS, OWN];

const TECH: SecSpec = { t: "The browser, technical", lv: 2, rows: [
  { t: "Browser program", k: "custom", render: (c) => <Program c={c} /> },
  { t: "Branch’s own browser", k: "custom", render: (c) => <Found c={c} /> },
  { t: "Show the browser window", k: "seg", key: "browser.headless", opts: [{ v: null, l: "Auto" }, { v: false, l: "Always" }, { v: true, l: "Never" }], sub: "Auto shows a window when this computer has a screen." },
  sw("A light browser for reading pages", "Needs a reading-only browser service to connect to."),
  { t: "Where browser actions go", k: "btn", btn: "See", off: "Needs the engine to report how it routes browser actions." },
  { t: "Connect to a browser at an address", k: "text", key: "browser.cdpUrl", ph: "http://127.0.0.1:9222", sub: "A browser’s debugging link, on this computer or another. Empty: Branch starts its own." },
  sw("Let Trunks send raw commands through the debugging link", "Needs the engine to pass raw commands to the browser."),
  { t: "Let a Trunk write browser scripts", k: "sw", key: "browser.evaluateEnabled", def: true, sub: "For many repeated steps it writes one short script against the open browser." },
  { t: "Proxy server", k: "arg", arg: "--proxy-server", ph: "http://proxy:8080", sub: "Empty: no proxy." },
  { t: "Skip the proxy for", k: "arg", arg: "--proxy-bypass-list", ph: "localhost,*.internal", sub: "Addresses that go direct, separated by commas." },
  { t: "Proxy sign-in", k: "btn", btn: "Set…", off: "Needs the engine to keep a proxy sign-in with your keys." },
  { t: "What every page may use", k: "btn", off: "Needs the engine to grant page permissions when the browser starts." },
  { t: "Identify as", k: "arg", arg: "--user-agent", sub: "What sites see as the browser’s name. Empty: the browser’s own." },
  { t: "Window size", k: "arg", arg: "--window-size", ph: "1280 × 800", sub: "Width × height in pixels. Empty: fits the screen." },
  { t: "Page pop-up questions", k: "seg", opts: [{ v: "trunk", l: "The Trunk answers" }, { v: "ok", l: "Always OK" }, { v: "cancel", l: "Always Cancel" }], off: "Needs the engine to answer page pop-ups by a rule." },
  { t: "Close an idle browser after", k: "num", unit: "seconds", off: "Needs the engine to close an idle browser after a set time." },
  { t: "Wait for a click to work", k: "num", unit: "seconds", off: NO_TIMING },
  { t: "Wait for a page", k: "num", unit: "seconds", off: NO_TIMING },
  { t: "Steps sent in one go", k: "num", unit: "steps", off: NO_TIMING },
  sw("Offer Branch’s tools to assistants built into Chrome", "Needs the engine to offer its tools to pages."),
  { t: "Check the browser end to end", k: "custom", render: (c) => <Doctor c={c} /> },
] };

const CLOUD_BROWSERS: SecSpec = { t: "Cloud browsers", lv: 2, rows: [
  { t: "Cloud browsers", k: "btn", btn: "Add one", off: NO_CLOUD },
  { t: "Local addresses on a cloud browser", k: "seg", opts: [{ v: "side", l: "Open on this computer" }, { v: "hint", l: "Show how to reach it" }], off: NO_CLOUD },
  sw("Let a cloud service drive a browser on this computer", NO_CLOUD),
] };

export const BROWSER_TECH: SecSpec[] = [TECH, CLOUD_BROWSERS];

const STATUS = { method: "GET", path: "/" };

function Program({ c }: { c: Ctx }) {
  const cfg = useConfig(c.engine);
  const st = useLive<RecordValue>(c.engine, "browser.request", STATUS, []);
  const found = str(rec(st.data).detectedExecutablePath);
  return (
    <Ctl title="Browser program" sub="Branch finds the browsers on this computer, starts the one picked here and closes what it started when a task ends.">
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
    <Dialog title="Browser profiles" wide onClose={onClose} footer={<Btn onClick={onClose}>Close</Btn>}>
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
  const [report, setReport] = useState<RecordValue | null>(null);
  const run = () => void call.run(async () => setReport(rec(await c.engine.request("browser.request", { method: "GET", path: "/doctor" }))));
  return (
    <Ctl title="Check the browser end to end" sub="Start, open, read, close, a signed-in flow and a form that stops before your yes." after={<CallLine call={call} />}>
      <Btn sm disabled={call.busy} onClick={run}>{call.busy ? "Checking…" : "Open the check"}</Btn>
      {report ? (
        <Dialog title="Browser check" wide onClose={() => setReport(null)} footer={<><Btn ghost onClick={run}>Check again</Btn><Btn onClick={() => setReport(null)}>Close</Btn></>}>
          <p>{report.ok === true ? "Every check passed." : "Some checks need attention."}</p>
          <div className="rows">
            {list(report.checks).map((k) => (
              <div key={str(k.id)} className="prow"><span className="grow"><b>{str(k.label)}</b><small>{str(k.summary)}{str(k.fixHint) ? ` ${str(k.fixHint)}` : ""}</small></span><Pill tone={CHECK_TONE[str(k.status)] ?? "idle"}>{CHECK_WORD[str(k.status)] ?? str(k.status)}</Pill></div>
            ))}
          </div>
        </Dialog>
      ) : null}
    </Ctl>
  );
}
