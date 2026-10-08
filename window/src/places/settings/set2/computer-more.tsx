// Settings › Computer & browser (DESIGN-SPEC §4.7.12), every section below "Which Trunk uses which", in the
// preview's order and gated by level. Rows are one table per section: a row with a `key` reads and saves that engine
// config path (config.patch), a row with `off` is greyed with why. The live sections at the end: Cloud computers
// (environments.*, cloudWorkers.*), Everything connected (device.pair.*, node.*, device.token.*) and Who is
// connected now (system-presence). The browser rows are in computer-browser.tsx, the code and git rows in
// computer-code.tsx.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { Fragment, useRef, useState, type ReactNode } from "react";
import type { SettingsPageProps } from "../index";
import { Acts, Btn, Ctl, Empty, Field, Hint, Num, Pick, Pill, Sec, Seg, Switch, Tabs, useConfig, type RowEntry } from "../kit";
import type { WindowEngine } from "../../../connect/engine";
import { list } from "../adapter";
import { Dialog } from "../../../shell/Dialog";
import { CallLine, CodeRow, CopyBtn, Kv, Tile, day, lvOf, rec, span, str, useCall, useLive, type RecordValue } from "./common";
import { BROWSER_BASIC, BROWSER_MORE, BROWSER_TECH } from "./computer-browser";
import { CODE_SECS, CODE_TECH, Confirm } from "./computer-code";
import { Menu, type MenuItem } from "../../../shell/Menu";
import { Icon } from "../../../shell/icons";
import { Ico } from "./icons";
import "./computer-more.css";
import { shownWhy } from "../../../shell/shown-why";

export type Lv = 0 | 1 | 2;
export type Ctx = { engine: WindowEngine; lv: Lv; props: SettingsPageProps };
export type Opt = { v: unknown; l: string; off?: string };
/** One row. k: sw switch, seg, pick, num, text, list (chips), cmd (node command policy), arg (browser launch flag),
 *  code (copyable text), btn, val (a fixed value), info (no control), hint (a paragraph), custom (render). */
export type Spec = {
  t: string; k: "sw" | "seg" | "pick" | "num" | "text" | "list" | "cmd" | "arg" | "code" | "btn" | "val" | "info" | "copy" | "change" | "hint" | "custom";
  sub?: string; help?: string; lv?: Lv; key?: string | string[]; def?: unknown; on?: unknown; offV?: unknown; is?: (v: unknown) => boolean;
  opts?: Opt[]; unit?: string; ph?: string; val?: string; tone?: "ok" | "warn" | "bad" | "idle"; btns?: string[]; bare?: boolean; upTo?: Lv; min?: number; max?: number; csv?: boolean; off?: string; btn?: string; tag?: string;
  code?: string; cmds?: string[]; danger?: boolean; arg?: string; render?: (c: Ctx) => ReactNode;
};
export type SecSpec = { t: string; group?: string; showHeading?: boolean; lv: Lv; hint?: string; id?: string; rows?: Spec[]; body?: (c: Ctx) => ReactNode; titles?: [string, Lv][] };

const LINUX = "Linux only";
const PAIR_EVENTS = ["device.pair", "node.pair", "node"];
const SANDBOX = "agents.defaults.sandbox";
const SANDBOX_IMAGE = "branch-sandbox:bookworm-slim";
const NODE_IMAGE = "node:24.21.0-slim";
const SCREEN_DRIVER = "Needs the screen driver to report this.";

const ON_COMPUTER: SecSpec = { t: "On a computer", lv: 0, rows: [
  { t: "See the screen and use the mouse", k: "sw", key: "plugins.entries.cua-computer.enabled", def: false, sub: "Needed for apps without a connection. Turn it on to let Trunks use this screen and mouse. Full access does not turn this on. You can always take over." },
  { t: "Ask before opening an app it hasn’t used", sub: "Once per app, per Trunk. Off until you choose: apps open without asking each one.", k: "sw", off: "Needs the engine to keep the apps each Trunk has opened." },
  { t: "Use the camera", k: "cmd", cmds: ["camera.snap", "camera.clip"], danger: true, sub: "A Trunk can take a photo or a short clip with a computer’s camera. Applies to every paired computer and phone." },
  { t: "Cameras", sub: "Each camera on this computer, and what it can do.", k: "btn", lv: 1, btn: "See", off: "Needs the engine to list this computer’s cameras." },
  { t: "Show a live panel", sub: "A Trunk can open a panel on this computer to show and update something it made, like a page or a chart.", k: "sw", off: "Needs the engine’s live panel command on this computer." },
  { t: "Where scripts run", k: "seg", key: `${SANDBOX}.mode`, def: "off", opts: [{ v: "all", l: "Sealed box" }, { v: "off", l: "This computer" }], sub: "A sealed box keeps scripts away from your files unless a task needs them." },
  { t: "Your own terminal in the window", k: "sw", key: "gateway.terminal.enabled", def: true, sub: "A command line on this computer inside the window, for the owner only. Not offered to a Trunk whose scripts all run in the sealed box." },
  { t: "Desktop notifications", tag: LINUX, k: "cmd", lv: 1, cmds: ["system.notify"], sub: "A Trunk can show a notification on a computer. Applies to every paired computer and phone." },
  { t: "Camera", sub: "Photos and short clips. Needs a camera this account can read. Off until you choose: it uses the camera.", tag: LINUX, k: "sw", lv: 1, off: "Needs the Linux node to offer its camera." },
  { t: "Location", sub: "Needs the system location service. Off until you choose: it shares where this computer is.", tag: LINUX, k: "sw", lv: 1, off: "Needs the Linux node to offer its location." },
  { t: "Keep awake while working", sub: "Stops idle sleep while a Trunk is working here. Sleeping by hand and locking still work. Off until you choose: it stops this computer sleeping on its power plan.", tag: LINUX, k: "sw", lv: 1, off: "Needs the Linux node to hold off sleep." },
] };

const USING_SCREEN: SecSpec = { t: "Using the screen", lv: 0, rows: [
  { t: "Apps it may use", sub: "Each app on the list is allowed or never used. Every other app follows “Ask before opening an app it hasn’t used”.", k: "btn", btn: "Add an app", off: "Needs the engine to keep a list of allowed apps." },
  { t: "Pause when you touch the mouse", sub: "Moving the mouse or typing while a Trunk uses this computer pauses it at once. Its own clicks don’t count.", k: "sw", off: "Needs the screen driver to notice your own mouse and keys." },
  { t: "Stop-everything key", k: "custom", render: () => <StopKey /> },
  { t: "Branch’s own windows", sub: "Never in its pictures or recordings, and its pointer and borders stay out too.", k: "val", val: "Always", tone: "idle", off: "Needs the screen driver to leave Branch’s windows out of its pictures." },
  { t: "Sign-in and password windows", sub: "No picture is taken while one shows. The live view is never saved, logged or shown to a model, and it’s refused under Lockdown and App lock.", k: "val", val: "Always", tone: "idle", off: "Needs the screen driver to recognise sign-in windows." },
  { t: "Check what works", k: "custom", render: (c) => <CheckWorks c={c} /> },
] };

const TECHNICAL: SecSpec = { t: "Technical", group: "Connections", showHeading: false, lv: 2, body: (c) => <TechKv c={c} /> };

const LET_TRUNKS: SecSpec = { t: "Let Trunks use this computer", lv: 0, hint: "Lend this computer to Branch on another computer.", rows: [
  { t: "Code from the other computer", k: "custom", render: () => <PairRow /> },
  { t: "Share this computer’s screen", k: "custom", lv: 1, render: (c) => <ShareScreen c={c} /> },
] };

const PHONES_LENT: SecSpec = { t: "Phones lent to Branch", lv: 0, body: (c) => <PhonesLent c={c} /> };

const LOGBOOK_KEY = "plugins.entries.logbook";
const LB = `${LOGBOOK_KEY}.config`;
const LOGBOOK: SecSpec = { t: "Logbook", group: "Connections", showHeading: false, lv: 1, rows: [
  { t: "Logbook", k: "sw", key: `${LOGBOOK_KEY}.enabled`, def: false, sub: "Pictures of your screen at intervals, read by a model into a timeline in Library › Logbook. Off until you choose: it takes pictures of your screen and a model reads them." },
  { t: "Picture every", k: "num", key: `${LB}.captureIntervalSeconds`, def: 30, unit: "seconds", min: 5, max: 600, sub: "From 5 to 600." },
  { t: "Look at them every", k: "num", key: `${LB}.analysisIntervalMinutes`, def: 15, unit: "minutes", min: 3, max: 120, sub: "From 3 to 120." },
  { t: "From which computer", k: "custom", render: (c) => <LogbookNode c={c} /> },
  { t: "Which screen", k: "pick", key: `${LB}.screenIndex`, def: 0, opts: [{ v: 0, l: "Main screen" }, { v: 1, l: "2" }, { v: 2, l: "3" }, { v: 3, l: "4" }] },
  { t: "Model that reads the pictures", k: "custom", render: (c) => <LogbookModel c={c} /> },
  { t: "Keep pictures for", k: "num", key: `${LB}.retentionDays`, def: 14, unit: "days", min: 1, max: 365, sub: "From 1 to 365. Timeline cards stay." },
  { t: "Picture width", k: "num", lv: 2, key: `${LB}.maxWidth`, def: 1440, unit: "px", min: 480, max: 3840, sub: "From 480 to 3840." },
] };

const LENT_TECH: SecSpec = { t: "Lent computer, technical", group: "Lending", showHeading: false, lv: 2, rows: [
  { t: "Update this lent computer by itself", k: "sw", key: "nodeHost.autoUpdate.enabled", def: true, sub: "Checks hourly, waits for work to finish, restarts at most every 12 hours." },
  { t: "Run whole conversations here", k: "sw", key: "nodeHost.workerRuns.enabled", def: false, sub: "Hosts conversations sent from the other Branch." },
  { t: "Let Claude Code continue here", k: "sw", key: "nodeHost.agentRuns.claude.enabled", def: false, sub: "Runs still ask for your yes." },
  { t: "Share this computer’s browser", k: "sw", key: "nodeHost.browserProxy.enabled", def: true, sub: "Other computers may drive the browser profiles listed." },
  { t: "Publish skills from this computer", k: "sw", key: "nodeHost.skills.enabled", def: true, sub: "Skills installed here are offered to the other Branch." },
  { t: "Conversations at once", k: "num", key: "nodeHost.workerRuns.capacity", min: 1, sub: "Empty means one per processor core." },
  { t: "Keep hosted conversations", k: "seg", key: "nodeHost.workerRuns.isolation", def: "none", opts: [{ v: "none", l: "On the computer" }, { v: "container", l: "In a container" }] },
  { t: "Container image", k: "copy", key: "nodeHost.workerRuns.containerImage", ph: NODE_IMAGE, sub: "Used when hosted conversations run in a container." },
  { t: "Browser profiles shared", k: "copy", key: "nodeHost.browserProxy.allowProfiles", csv: true, ph: "Every profile", sub: "Profiles other computers may drive." },
  { t: "Connectors on this computer", k: "code", code: "nodeHost.mcp", sub: "The settings file section." },
] };

const SCREEN_TECH: SecSpec = { t: "Screen sharing, technical", group: "Using the screen", showHeading: false, lv: 2, rows: [
  { t: "Screen sharing", k: "custom", render: (c) => <ShareKv c={c} /> },
  { t: "Run a managed desktop", k: "sw", key: "desktop.host.managed", def: false, tag: LINUX, sub: "Starts a private headless desktop just for Branch. Off until you choose: it runs a second desktop." },
  { t: "Screen-sharing port", k: "num", key: "desktop.host.port", ph: "5900", min: 1, max: 65535, sub: "From 1 to 65535." },
  { t: "Password file", k: "change", key: "desktop.host.passwordFile", ph: "Not set", btn: "Change…", sub: "The screen server’s password, kept in a file only Branch reads." },
] };

const PAIRING = "gateway.nodes.pairing";
const ALLOWING: SecSpec = { t: "Allowing connections by themselves", group: "Connections", showHeading: false, lv: 2, rows: [
  { t: "Allow connections from this computer by themselves", k: "sw", key: `${PAIRING}.autoApproveLocal`, def: true, sub: "A browser or app on this same computer, or through an SSH tunnel to it, connects without asking." },
  { t: "Allow a computer that proves it is yours", k: "sw", key: `${PAIRING}.sshVerify`, def: true, is: (v) => v !== false, sub: "Branch signs in to it over SSH and checks its key matches; anything else still asks." },
  { t: "Networks that connect without asking", k: "list", key: `${PAIRING}.autoApproveCidrs`, ph: "192.168.1.0/24", sub: "Only a brand-new computer with no extra access; phones, browsers and upgrades still ask. Turns on when you add a network." },
  { t: "Commands computers may always run", k: "list", key: "gateway.nodes.commands.allow", ph: "camera.snap", sub: "Camera and screen commands need to be listed here before any computer offers them." },
  { t: "Commands computers may never run", k: "list", key: "gateway.nodes.commands.deny", ph: "system.run", sub: "Refused even when a rule would allow them." },
] };

const CODE_COMMITS: SecSpec = { t: "Code and commits", lv: 0, rows: [
  { t: "Mark commits and pull requests as Branch’s", sub: "Adds a line saying Branch helped. Off: they look like yours.", k: "sw", off: "Needs the engine to add Branch’s own line to commits." },
  { t: "Linux computers", sub: "What a paired Linux computer lends to Trunks.", k: "val", lv: 1, val: "Notifications, camera, location", off: "Needs the engine to report what a Linux computer lends." },
] };

const NETWORK_MORE: SecSpec = { t: "Network, more", group: "Network", lv: 1, rows: [
  { t: "Its computer joins a private network", sub: "So a Trunk’s computer reaches your private machines without opening them to the internet.", k: "seg", opts: [{ v: "off", l: "Off" }, { v: "tailscale", l: "Tailscale" }, { v: "netbird", l: "NetBird" }], off: "Needs the engine to join a Trunk’s computer to a private network." },
  { t: "Previews on your other computers", sub: "See a preview server running on taofik-ai, such as an app a Trunk is building, here in Branch’s browser.", k: "sw", off: "Needs the engine to forward preview servers from other computers." },
] };

const ON_MORE: SecSpec = { t: "On a computer, more", group: "On a computer", showHeading: false, lv: 1, rows: [
  { t: "Let Trunks show you pages", sub: "A Trunk can open a page in the side panel’s Clearing tab.", k: "sw", off: "Needs the engine’s live panel command." },
  { t: "Work in apps in the background", sub: "Through the accessibility tree, without taking the screen.", k: "sw", off: "Needs the screen driver to read apps without the screen." },
  { t: "Read Jupyter notebooks", sub: "Cells, outputs and charts.", k: "sw", off: "Needs the engine to read notebooks." },
  { t: "Review checks and a checklist per task", sub: "Checks you write run before a task says it’s done; the checklist shows in the task.", k: "sw", off: "Needs the engine to run your own checks before done." },
  { t: "Write AGENTS.md for a project", sub: "Branch reads the project and writes its house rules.", k: "val", val: "/init", code: "/init", off: "Needs the engine’s /init command." },
] };

const USING_MORE: SecSpec = { t: "Using the screen, more", group: "Using the screen", showHeading: false, lv: 1, rows: [
  { t: "Hide Branch while it works here", sub: "Branch’s window hides and a small status window shows while a Trunk uses this computer’s screen. It comes back when the task ends.", k: "sw", off: "Hiding the window is done by the Branch app on your computer." },
  { t: "Most steps in one task", sub: "A task stops and tells you when it reaches this many steps.", k: "num", unit: "steps", off: SCREEN_DRIVER },
  { t: "Wait between steps", sub: "Slows it down so you can follow along. Empty means no wait.", k: "num", unit: "ms", off: SCREEN_DRIVER },
  { t: "Screen pictures it keeps in mind", sub: "Older pictures leave its conversation; what it learned from them stays.", k: "num", unit: "pictures", off: SCREEN_DRIVER },
  { t: "Which model reads the screen", sub: "The conversation’s model when it can see pictures. Otherwise a picture model describes the screen for it.", k: "pick", opts: [{ v: "auto", l: "Auto" }], off: "Needs the engine to pick a screen-reading model." },
  { t: "Check each step on the screen", sub: "Before a step it looks whether it’s already done; after it, it checks the result and fixes it, so a task works from wherever the screen is.", k: "sw", off: SCREEN_DRIVER },
  { t: "Use an app’s own controls first", sub: "Excel, Word, PowerPoint, Photoshop, Blender and other apps with their own scripting: it uses those instead of clicking, and clicks when they fail.", k: "sw", off: "Needs the engine to drive apps through their own scripting." },
  { t: "What it learned about your apps", sub: "Before real work in a new app it explores it, or watches you once, and writes down what each control does.", k: "btn", btn: "See", off: "Needs the engine to keep notes on your apps." },
  { t: "Recorded workflows", sub: "What you did on a computer, recorded from the computer view’s bar, as steps a Trunk can repeat.", k: "btn", btn: "See", off: "Needs the engine to record workflows." },
  { t: "Suggest a next step from your screen", sub: "Looks at your screen now and then and shows one suggestion in Sapling’s conversation; it only fills your message box when you click it. Each picture is deleted at once. Off until you choose: it takes pictures of your screen.", k: "sw", off: "Needs the engine to suggest steps from your screen." },
  { t: "Covering this computer’s screens", sub: "While someone controls this computer from another device, its own screens are covered. Touching the mouse or keyboard here asks to disconnect, then locks this computer.", k: "val", val: "Always", tone: "idle", off: "Needs the screen driver to cover screens during remote control." },
] };

const PHONES_SMALL: SecSpec = { t: "Phones and small devices", group: "Lending", lv: 1, rows: [
  { t: "Android phones over USB", sub: "With USB debugging on, a Trunk takes pictures of the phone’s screen, taps, swipes, types and opens apps.", k: "btn", btn: "Set up", off: "Needs the engine to drive a phone over USB." },
  { t: "What it learned on phones", sub: "After each phone task it writes down tips and short cuts, so the next task is quicker and steadier.", k: "btn", btn: "See", off: "Needs the engine to keep phone notes." },
  { t: "iPhone simulator beside the conversation", sub: "Shows the simulator of the app being built next to the chat, so you and the Trunk both use it. Pick the device per conversation.", k: "btn", btn: "Show", off: "The simulator is shown by the Branch app on a Mac." },
  { t: "Add a small board", k: "custom", render: () => <Ctl title="Add a small board" sub="A Raspberry Pi or a board like it, with Branch on it."><Btn sm onClick={() => window.dispatchEvent(new CustomEvent("branch:add-computer"))}>Add</Btn></Ctl> },
  { t: "A plug-in keyboard and mouse", sub: "Controls a computer with no Branch on it through a small USB device that acts as its keyboard and mouse.", k: "btn", btn: "Set up", off: "Needs the engine to drive a USB keyboard and mouse device." },
] };

const MORE_PLACES: SecSpec = { t: "More places to run work", lv: 1, rows: [
  { t: "A screen in the sealed box", sub: "A Trunk gets a desktop inside its box that you can watch and take over. Off until you choose: it drives that desktop’s screen and keyboard.", k: "sw", off: "Needs the engine to give a sealed box its own desktop." },
  { t: "Free memory a screen needs", sub: "A desktop doesn’t start while less is free. 0 turns the check off.", k: "num", lv: 2, unit: "MB", off: "Needs the engine to give a sealed box its own desktop." },
  { t: "Bring your skills into the box", sub: "Your skills are copied into each running box and back, so a Trunk has them there too.", k: "sw", off: "Needs the engine to copy skills into a sealed box." },
  { t: "An editor inside the box", sub: "Opens a code editor running in the box, in Branch’s browser.", k: "btn", btn: "Open", off: "Needs the engine to run an editor in a sealed box." },
  { t: "Cloud storage in the box", sub: "Mounts cloud storage buckets beside your folders, under one folder in the box.", k: "btn", btn: "Add", off: "Needs the engine to mount cloud storage in a sealed box." },
  { t: "A Kubernetes cluster", sub: "Each sandbox runs in its own pod on your cluster, with spares ready.", k: "btn", btn: "Add", off: "Needs the engine’s Kubernetes sandbox backend." },
  { t: "A lasting virtual computer", sub: "A Trunk’s own virtual computer here keeps its files and memory.", k: "btn", btn: "Set up", off: "Needs the engine’s virtual computer backend." },
  { t: "Virtual computers on your own machines", sub: "Start in a moment, save a snapshot, copy a sandbox, roll back to any saved point, or move it to another machine.", k: "btn", btn: "Set up", off: "Needs the engine’s virtual computer backend." },
  { t: "Throwaway virtual computers", sub: "A full Linux computer made fresh from a fixed image for each task. It reaches only a package cache; any other address asks you first.", k: "btn", btn: "Set up", off: "Needs the engine’s virtual computer backend." },
  { t: "New addresses waiting for your yes", sub: "None. When a throwaway virtual computer asks to reach a new address, it shows here.", k: "info", off: "Needs the engine’s virtual computer backend." },
  { t: "Each conversation’s folders", k: "info", lv: 2, off: "Needs the engine to keep folders per conversation." },
] };

const USING_TECH: SecSpec = { t: "Using the screen, technical", group: "Using the screen", showHeading: false, lv: 2, rows: [
  { t: "Screen driver", k: "custom", render: (c) => <ScreenDriver c={c} /> },
  { t: "How it drives the screen", sub: "Apps in the background first; it takes the screen only when it has to.", k: "info", off: SCREEN_DRIVER },
  { t: "When a step fails", sub: "A failed picture, model call or action isn’t tried again. It stops after 10 failed pictures in a row.", k: "info", off: SCREEN_DRIVER },
  { t: "Pictures sent to a model", sub: "Shrunk and compressed to under 1 MB each.", k: "info", off: SCREEN_DRIVER },
  { t: "Input on Windows", sub: "Positions across every screen with each screen’s own scaling; any character typed directly. Long text is pasted, short or secret text is typed.", k: "info", off: SCREEN_DRIVER },
  { t: "Stop key check", sub: "Checked every half second. If it stops answering, the mouse and keyboard stop too, until you let them resume.", k: "info", off: "Needs the engine’s stop key on this computer." },
  { t: "Desktop apps built from web pages", sub: "Slack and apps like it are reopened once with a debugging link (port 9223), so it reads them like a web page.", k: "info", off: SCREEN_DRIVER },
  { t: "Its browser on a box’s desktop", sub: "Skips first-run screens, blocks notifications and never saves passwords.", k: "info", off: "Needs the engine to give a sealed box its own desktop." },
  { t: "Offer these screen tools to other apps", sub: "Other AI apps on this computer may use the screen tools through a connector. Off until you choose: another app could use your screen.", k: "sw", off: "Needs the engine to offer the screen tools as a connector." },
  { t: "Linux here may take screen pictures", sub: "Uses Windows tools and blacks out marked parts first.", k: "sw", off: "Needs the engine to take pictures through Windows for Linux." },
  { t: "From the terminal", sub: "Starts a computer, browser or phone task from a command line.", k: "code", code: "branch computer run", off: "Needs the engine’s computer command line." },
] };

const EXTRA: Spec = { t: "Extra folders", k: "list", key: `${SANDBOX}.docker.binds`, ph: "C:\\path\\to\\folder:/data:ro", sub: "Folders on this computer the box can reach, as host path:box path." };
const WHERE_MORE: SecSpec = { t: "Where scripts run, more", group: "On a computer", showHeading: false, lv: 1, rows: [
  { t: "Your project folder in the box", k: "seg", key: `${SANDBOX}.workspaceAccess`, def: "none", opts: [{ v: "none", l: "Not shared" }, { v: "ro", l: "Read only" }, { v: "rw", l: "Read and write" }], sub: "Scripts work in the box’s own folder unless it is shared." },
  { ...EXTRA, k: "custom", render: (c) => <FoldersRow s={EXTRA} c={c} /> },
  { t: "Sealed boxes running", sub: "Each Trunk’s box, and whether it uses the latest settings.", k: "btn", btn: "See", off: "Needs the engine to list running sealed boxes." },
  { t: "Fix and run again", sub: "When a command fails, it reads the error, fixes it and runs it again, with the same permissions.", k: "btn", btn: "Show an example", off: "Needs the engine to retry failed commands by itself." },
  { t: "Programs that keep running", sub: "A Trunk can start a server or a watcher and check on it later.", k: "btn", btn: "See running", off: "Needs the engine to list background programs here." },
  { t: "Watch part of the screen", sub: "A Trunk watches a region, like a progress bar, and acts when it changes.", k: "btn", btn: "Show an example", off: SCREEN_DRIVER },
  { t: "Browser profiles that stay signed in", sub: "Each Trunk can keep its own browser profile, so it doesn’t sign in every time.", k: "btn", btn: "See", off: "Each Trunk’s own profile is set in The browser, more › Browser profiles." },
  { t: "A device for one conversation", sub: "Lend a phone’s camera or location to one conversation, not all of them.", k: "btn", btn: "Show it", off: "Needs the engine to lend a device to one conversation." },
  { t: "Edit files in Branch", sub: "A small editor for project files, with the same folder rules as Trunks.", k: "btn", btn: "Open one", off: "Needs the engine’s file editor." },
] };

const NO_CONTAIN = "Needs the engine to contain scripts on this computer.";
const SCRIPTS: SecSpec = { t: "Scripts on this computer", group: "On a computer", showHeading: false, lv: 1, rows: [
  { t: "Contain scripts on this computer", sub: "Each script a Trunk starts runs in its own container.", k: "sw", off: NO_CONTAIN },
  { t: "Starting point", sub: "No internet, no clipboard, no folders.", k: "seg", opts: [{ v: "locked", l: "Locked down" }, { v: "rec", l: "Recommended" }, { v: "open", l: "Open" }], off: NO_CONTAIN },
  { t: "Internet", sub: "Contained scripts can reach public internet addresses. Your local network and shares are not included. Off until you choose: scripts could send what they read over the internet.", k: "sw", off: NO_CONTAIN },
  { t: "Clipboard", sub: "Scripts can’t see or change your clipboard. Off until you choose: the clipboard often holds passwords.", k: "seg", opts: [{ v: "none", l: "None" }, { v: "r", l: "Read" }, { v: "w", l: "Write" }, { v: "rw", l: "Read and write" }], off: NO_CONTAIN },
  ...["Documents", "Downloads", "Desktop"].map((t): Spec => ({ t, sub: "Scripts can’t see this folder.", k: "seg", opts: [{ v: "no", l: "Blocked" }, { v: "ro", l: "Read only" }, { v: "rw", l: "Read and write" }], off: NO_CONTAIN })),
  { t: "Time limit per command", k: "num", lv: 2, key: "tools.exec.timeoutSeconds", ph: "1800", unit: "s", min: 1, sub: "A command still running after this is stopped. Empty means 1800." },
  { t: "Most output kept", sub: "Longer output is cut; this does not limit disk, memory or processor.", k: "pick", lv: 2, opts: [{ v: "1", l: "1 MiB" }], off: NO_CONTAIN },
  { t: "Allow Windows UI calls", sub: "PowerShell and some console tools need these to start. Off until you choose: it widens what contained scripts can call.", k: "sw", lv: 2, off: NO_CONTAIN },
] };

const SEALED_TECH: SecSpec = { t: "Sealed box, technical", group: "On a computer", showHeading: false, lv: 2, rows: [
  { t: "Box image", k: "custom", render: (c) => <BoxImage c={c} /> },
  { t: "Use another image", k: "change", btn: "Change", bare: true, key: `${SANDBOX}.docker.image`, ph: SANDBOX_IMAGE, sub: "Any image you built or pulled." },
  { t: "Run once when a box is made", k: "copy", key: `${SANDBOX}.docker.setupCommand`, ph: "(none)", sub: "Needs internet, a writable box and the root user." },
  { t: "Internet in the box", k: "sw", key: `${SANDBOX}.docker.network`, def: "none", on: "bridge", offV: "none", sub: "Joining the computer’s own network is never allowed. Off until you choose: scripts in the box could reach the internet." },
  { t: "Graphics cards", k: "pick", key: `${SANDBOX}.docker.gpus`, opts: [{ v: null, l: "None" }, { v: "all", l: "All" }], sub: "Graphics cards the box may use." },
] };

const LIMITS_TECH: SecSpec = { t: "Limits, technical", group: "Limits", lv: 2, rows: [
  { t: "Limits for commands", sub: "On Windows, commands run inside a job with a memory and processor ceiling.", k: "btn", btn: "Show limits", off: "Needs the engine to report the limits it puts on commands." },
] };

export function ComputerMore(props: SettingsPageProps) {
  const lv = lvOf(props.level);
  const c: Ctx = { engine: props.engine, lv, props };
  return <>{SECTIONS.filter((s) => s.lv <= lv).map((s) => <SecView key={s.t} s={s} c={c} />)}</>;
}

function SecView({ s, c }: { s: SecSpec; c: Ctx }) {
  return (
    <Sec title={s.t} group={s.group} showHeading={s.showHeading} hint={s.hint} id={s.id}>
      {s.body ? s.body(c) : null}
      {(s.rows ?? []).filter((r) => (r.lv ?? 0) <= c.lv && c.lv <= (r.upTo ?? 2)).map((r) => <Row key={r.t} s={r} c={c} />)}
    </Sec>
  );
}

function subOf(s: Spec): ReactNode {
  if (!s.tag) return s.sub;
  return <><span className="s2cm-tag">{s.tag}</span>{s.sub}</>;
}

/** Draws one table row: greyed with its reason, or wired to its config path. */
export function Row({ s, c }: { s: Spec; c: Ctx }) {
  if (s.k === "hint") return <Hint>{s.sub}</Hint>;
  if (s.k === "custom") return <>{s.render?.(c)}</>;
  if (s.off) return <OffRow s={s} />;
  if (s.k === "code") return <CodeRow title={s.t} code={s.code ?? ""} sub={s.sub} />;
  if (s.k === "copy") return <CopyCfgRow s={s} c={c} />;
  if (s.k === "change") return <ChangeRow s={s} c={c} />;
  if (s.k === "cmd") return <CmdRow s={s} c={c} />;
  if (s.k === "list") return <ListRow s={s} c={c} />;
  if (s.k === "arg") return <ArgRow s={s} c={c} />;
  return <CfgRow s={s} c={c} />;
}

/** A row the engine can't back yet: the control drawn inert and the reason as its sub-line. */
function OffRow({ s }: { s: Spec }) {
  const none = () => undefined;
  const opts = (s.opts ?? []).map((o, i) => ({ id: String(i), label: o.l }));
  const control = s.k === "sw" ? <Switch label={s.t} checked={false} onChange={none} disabled />
    : s.k === "seg" ? <Seg label={s.t} value="" options={opts} onChange={none} disabled />
    : s.k === "pick" ? <Pick label={s.t} value="0" options={opts} onChange={none} disabled />
    : s.k === "num" ? <Num label={s.t} value={undefined} onCommit={none} unit={s.unit} disabled />
    : s.k === "code" ? <code className="s2-code">{s.code}</code>
    : s.k === "text" || s.k === "list" || s.k === "arg" ? <Field label={s.t} value="" placeholder={s.ph} onCommit={none} disabled />
    : s.k === "val" ? (s.tone ? <Pill tone={s.tone}>{s.val}</Pill> : s.code ? <code className="s2-code">{s.val}</code> : <span className="val-k">{s.val}</span>)
    : s.btns ? <>{s.btns.map((b) => <Btn key={b} sm disabled>{b}</Btn>)}</>
    : s.btn ? <Btn sm disabled>{s.btn}</Btn> : null;
  return <Ctl title={s.t} sub={subOf(s)} off={s.off}>{control}</Ctl>;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** sw / seg / pick / num / text rows on one config path. */
function CfgRow({ s, c }: { s: Spec; c: Ctx }) {
  const cfg = useConfig(c.engine);
  const key = s.key ?? "";
  const raw = cfg.get(key);
  const cur = raw === undefined ? s.def : raw;
  const save = (v: unknown) => void cfg.set(key, v);
  const opts = (s.opts ?? []).map((o, i) => ({ id: String(i), label: o.l, off: o.off }));
  const at = String((s.opts ?? []).findIndex((o) => same(o.v, cur)));
  const pickOpt = (id: string) => save((s.opts ?? [])[Number(id)]?.v ?? null);
  const on = s.on ?? true;
  let control: ReactNode = null;
  if (s.k === "sw") control = <Switch label={s.t} checked={s.is ? s.is(cur) : same(cur, on)} disabled={cfg.loading} onChange={(v) => save(v ? on : (s.offV ?? false))} />;
  else if (s.k === "seg") control = <Seg label={s.t} value={at} options={opts} disabled={cfg.loading} onChange={pickOpt} />;
  else if (s.k === "pick") control = <Pick label={s.t} value={at === "-1" ? str(cur) : at} options={opts} disabled={cfg.loading} onChange={pickOpt} />;
  else if (s.k === "num") control = <Num label={s.t} value={typeof raw === "number" ? raw : undefined} placeholder={s.ph ?? (s.def === undefined ? undefined : String(s.def))} unit={s.unit} min={s.min} max={s.max} disabled={cfg.loading} onCommit={save} />;
  else if (s.k === "text") control = <TextCtl s={s} raw={raw} save={save} />;
  return <Ctl title={s.t} sub={subOf(s)} help={s.help}>{control}</Ctl>;
}

function TextCtl({ s, raw, save }: { s: Spec; raw: unknown; save: (v: unknown) => void }) {
  const value = s.csv ? (Array.isArray(raw) ? raw.map(String).join(", ") : "") : str(raw);
  const commit = (v: string) => {
    const t = v.trim();
    if (!t) return save(null);
    save(s.csv ? t.split(",").map((x) => x.trim()).filter(Boolean) : t);
  };
  return <Field label={s.t} value={value} placeholder={s.ph} onCommit={commit} wide />;
}

const words = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const shownCfg = (v: unknown, csv?: boolean): string => (csv ? words(v).join(", ") : str(v));

/** A config value shown as code with Copy; the placeholder is the engine's default when it is unset. */
function CopyCfgRow({ s, c }: { s: Spec; c: Ctx }) {
  const cfg = useConfig(c.engine);
  const v = shownCfg(cfg.get(s.key as string), s.csv) || (s.ph ?? "");
  return <Ctl title={s.t} sub={subOf(s)}><code className="s2-code">{v}</code><CopyBtn text={v} /></Ctl>;
}

/** A config value (code) with a Change button that edits it in a small dialog; empty goes back to the default. */
function ChangeRow({ s, c }: { s: Spec; c: Ctx }) {
  const cfg = useConfig(c.engine);
  const key = s.key as string;
  const v = str(cfg.get(key));
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const save = () => { void cfg.set(key, draft.trim() || null); setOpen(false); };
  return (
    <Ctl title={s.t} sub={subOf(s)}>
      {s.bare ? null : <code className="s2-code">{v || s.ph}</code>}
      <Btn sm disabled={cfg.loading} onClick={() => { setDraft(v); setOpen(true); }}>{s.btn ?? "Change…"}</Btn>
      {open ? (
        <Dialog title={s.t} onClose={() => setOpen(false)} footer={<><Btn ghost onClick={() => setOpen(false)}>Cancel</Btn><Btn pri onClick={save}>Save</Btn></>}>
          <label className="s2-field"><span>{s.t}</span><input className="inp" autoFocus placeholder={s.ph} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); }} /></label>
          <p className="hint">Empty goes back to the default.</p>
        </Dialog>
      ) : null}
    </Ctl>
  );
}

/** Extra folders for the sealed box (docker.binds): the list as the sub-line, Add a folder in a dialog. */
function FoldersRow({ s, c }: { s: Spec; c: Ctx }) {
  const cfg = useConfig(c.engine);
  const items = words(cfg.get(s.key as string));
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const save = (next: string[]) => void cfg.set(s.key as string, next.length ? next : null);
  const add = () => { const t = draft.trim(); if (t && !items.includes(t)) save([...items, t]); setDraft(""); setOpen(false); };
  const sub = items.length ? <span className="s2cm-list">{items.map((i) => <span key={i} className="chip6">{i}<button type="button" className="s2cm-chipx" aria-label={`Remove ${i}`} onClick={() => save(items.filter((x) => x !== i))}>×</button></span>)}</span> : "No extra folders.";
  return (
    <Ctl title={s.t} sub={sub}>
      <Btn sm disabled={cfg.loading} onClick={() => setOpen(true)}>Add a folder</Btn>
      {open ? (
        <Dialog title="Add a folder" onClose={() => setOpen(false)} footer={<><Btn ghost onClick={() => setOpen(false)}>Cancel</Btn><Btn pri disabled={!draft.trim()} onClick={add}>Add</Btn></>}>
          <label className="s2-field"><span>Folder</span><input className="inp" autoFocus placeholder={s.ph} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} /></label>
          <p className="hint">{s.sub}</p>
        </Dialog>
      ) : null}
    </Ctl>
  );
}

/** A list of words in config (networks, commands, folders): chips with a remove button and an Add field. */
function ListRow({ s, c }: { s: Spec; c: Ctx }) {
  const cfg = useConfig(c.engine);
  const items = words(cfg.get(s.key ?? ""));
  const [draft, setDraft] = useState("");
  const save = (next: string[]) => void cfg.set(s.key ?? "", next.length ? next : null);
  const add = () => { const t = draft.trim(); if (!t) return; if (!items.includes(t)) save([...items, t]); setDraft(""); };
  return (
    <Ctl title={s.t} sub={subOf(s)} stack after={
      <div className="s2cm-x">
        <div className="s2cm-list">{items.length ? items.map((i) => <span key={i} className="chip6">{i}<button type="button" className="s2cm-chipx" aria-label={`Remove ${i}`} onClick={() => save(items.filter((x) => x !== i))}>×</button></span>) : <small>None.</small>}</div>
        <div className="acts">
          <input className="inp" aria-label={`${s.t}: add`} placeholder={s.ph} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
          <Btn sm disabled={!draft.trim() || cfg.loading} onClick={add}>Add</Btn>
        </div>
      </div>
    } />
  );
}

/** A node command a computer may run (gateway.nodes.commands): risky ones are on only when listed in allow;
 *  the rest are on unless listed in deny. */
function CmdRow({ s, c }: { s: Spec; c: Ctx }) {
  const cfg = useConfig(c.engine);
  const cmds = s.cmds ?? [];
  const allow = words(cfg.get("gateway.nodes.commands.allow"));
  const deny = words(cfg.get("gateway.nodes.commands.deny"));
  const denied = cmds.some((x) => deny.includes(x));
  const on = s.danger ? cmds.every((x) => allow.includes(x)) && !denied : !denied;
  const toggle = (v: boolean) => {
    const without = (a: string[]) => a.filter((x) => !cmds.includes(x));
    const next = s.danger
      ? { allow: v ? [...without(allow), ...cmds] : without(allow), deny: without(deny) }
      : { allow, deny: v ? without(deny) : [...without(deny), ...cmds] };
    void cfg.set("gateway.nodes.commands", { allow: next.allow.length ? next.allow : null, deny: next.deny.length ? next.deny : null });
  };
  return <Ctl title={s.t} sub={subOf(s)}><Switch label={s.t} checked={on} disabled={cfg.loading} onChange={toggle} /></Ctl>;
}

/** One browser launch flag kept in browser.extraArgs, such as --proxy-server=… */
function ArgRow({ s, c }: { s: Spec; c: Ctx }) {
  const cfg = useConfig(c.engine);
  const args = words(cfg.get("browser.extraArgs"));
  const flag = `${s.arg ?? ""}=`;
  const size = s.arg === "--window-size";
  const found = args.find((a) => a.startsWith(flag))?.slice(flag.length) ?? "";
  const shown = size ? found.replace(",", " × ") : found;
  const commit = (v: string) => {
    const t = size ? v.trim().replace(/\s*[x×,]\s*/i, ",") : v.trim();
    const rest = args.filter((a) => !a.startsWith(flag));
    const next = t ? [...rest, `${flag}${t}`] : rest;
    void cfg.set("browser.extraArgs", next.length ? next : null);
  };
  return <Ctl title={s.t} sub={subOf(s)}><Field label={s.t} value={shown} placeholder={s.ph} onCommit={commit} wide /></Ctl>;
}

/** Check what works: what computer.status reports for this computer. */
function CheckWorks({ c }: { c: Ctx }) {
  const [open, setOpen] = useState(false);
  return (
    <Ctl title="Check what works" sub="Checks screen, mouse, keyboard, apps and the stop key." help="Screen pictures, the mouse and keyboard, reading apps, each screen, and the stop key on this computer.">
      <Btn sm onClick={() => setOpen(true)}>Check</Btn>
      {open ? <CheckDialog engine={c.engine} onClose={() => setOpen(false)} /> : null}
    </Ctl>
  );
}

function CheckDialog({ engine, onClose }: { engine: WindowEngine; onClose: () => void }) {
  const st = useLive<RecordValue>(engine, "computer.status", {}, []);
  const d = rec(st.data);
  const use = rec(d.computerUse);
  const caps = Object.entries(use).filter(([k, v]) => k !== "provider" && typeof v !== "object").map(([k, v]): [string, ReactNode] => [k, String(v)]);
  return (
    <Dialog title="Check what works" onClose={onClose} footer={<><Btn ghost onClick={() => void st.reload()}>Check again</Btn></>}>
      {st.error ? <p className="hint s2-err" role="alert">{st.error}</p> : null}
      {st.loading && !st.data ? <p>Checking…</p> : null}
      {st.data ? (
        <>
          <p>{d.available === true ? `Computer control works through ${str(rec(use.provider).label) || "this computer’s screen driver"}.` : d.configured === true ? str(d.error) || "Computer control is set up but can’t be used right now." : shownWhy("Computer control isn’t set up in this engine.")}</p>
          <Kv rows={caps} />
        </>
      ) : null}
    </Dialog>
  );
}

function TechKv({ c }: { c: Ctx }) {
  const cfg = useConfig(c.engine);
  const br = useLive<RecordValue>(c.engine, "browser.request", { method: "GET", path: "/" }, []);
  const mode = str(cfg.get(`${SANDBOX}.mode`)) || "off";
  const image = str(cfg.get(`${SANDBOX}.docker.image`)) || SANDBOX_IMAGE;
  return <Kv rows={[["Sealed box", mode === "off" ? `Off · ${image}` : image], ["Browser profile", str(rec(br.data).userDataDir)]]} />;
}

/** Stop-everything key: the keys drawn inert until the engine has a stop key on this computer. */
function StopKey() {
  return (
    <Ctl title="Stop-everything key" sub="Stops every Trunk’s mouse and keyboard on every computer." help="Press it anywhere to stop every Trunk’s mouse and keyboard on every computer at once. It stays stopped until you let them resume." off="Needs the engine’s stop key on this computer.">
      <span className="s2cm-kbd">{["Ctrl", "Alt", "Shift", "Esc"].map((k) => <kbd key={k}>{k}</kbd>)}</span>
    </Ctl>
  );
}

/** Lending this computer starts on this computer's node: the Branch app pairs it with the other Branch. */
function PairRow() {
  return (
    <Ctl title="Code from the other computer" sub="8 characters, two groups of 4." help="8 characters, two groups of 4. Make it on the other computer: Add a computer › Another computer with Branch." off="Lending this computer is done by the Branch app on it.">
      <input className="inp s2cm-code" aria-label="Code from the other computer" placeholder="ABCD-1234" disabled />
      <Btn pri sm disabled>Pair</Btn>
    </Ctl>
  );
}

/** desktop.host.enabled, with the local desktop's setup state from environments.list. */
function ShareScreen({ c }: { c: Ctx }) {
  const cfg = useConfig(c.engine);
  const envs = useLive<RecordValue>(c.engine, "environments.list", { includeDesktopSetup: true }, ["node"]);
  const nodes = useLive<RecordValue>(c.engine, "node.list", {}, ["node"]);
  const setup = localSetup(rec(envs.data), nodes.data);
  const on = cfg.get("desktop.host.enabled") === true;
  return (
    <Ctl title="Share this computer’s screen" sub="Watch and control this computer from Branch on another computer." help="Watch and control this computer from Branch on another computer. A change reconnects it briefly; a new ability may need a yes there."
      after={setup ? <div className="s2cm-x"><div className="s2cm-stat"><span>Screen sharing</span><Pill tone={setup.ok ? "ok" : "bad"}>{setup.word}</Pill>{setup.detail ? <small>{setup.detail}</small> : null}</div></div> : null}>
      <Switch label="Share this computer’s screen" checked={on} disabled={cfg.loading} onChange={(v) => void cfg.set("desktop.host.enabled", v)} />
    </Ctl>
  );
}

const SETUP_WORD: Record<string, string> = { ready: "Ready", managed: "Managed by Branch", "needs-server": "Not available", unsupported: "Not available" };
function localSetup(data: RecordValue, nodes: unknown): { ok: boolean; word: string; detail: string } | null {
  const local = list(rec(nodes).nodes).find((n) => n.gatewayLocal === true);
  const env = local ? list(data.environments).find((e) => str(e.id) === str(local.nodeId) && rec(e.desktopSetup).state) : undefined;
  if (!env) return null;
  const s = rec(env.desktopSetup);
  const state = str(s.state);
  return { ok: state === "ready" || state === "managed", word: SETUP_WORD[state] ?? state, detail: str(s.detail) };
}

function ShareKv({ c }: { c: Ctx }) {
  const cfg = useConfig(c.engine);
  const envs = useLive<RecordValue>(c.engine, "environments.list", { includeDesktopSetup: true }, ["node"]);
  const nodes = useLive<RecordValue>(c.engine, "node.list", {}, ["node"]);
  const setup = localSetup(rec(envs.data), nodes.data);
  return <Kv rows={[["Share this computer’s screen", cfg.get("desktop.host.enabled") === true ? "On" : "Off"], ["Status", setup ? [setup.word, setup.detail].filter(Boolean).join(": ") : ""]]} />;
}

const PHONE = /ios|iphone|ipad|android/i;
function PhonesLent({ c }: { c: Ctx }) {
  const nodes = useLive<RecordValue>(c.engine, "node.list", {}, ["node"]);
  const phones = list(rec(nodes.data).nodes).filter((n) => PHONE.test(str(n.platform)) || PHONE.test(str(n.deviceFamily)));
  if (nodes.error) return <p className="hint s2-err" role="alert">{nodes.error}</p>;
  return (
    <div className="rows">
      {phones.length ? phones.map((n) => (
        <div key={str(n.nodeId)} className="prow" data-row={str(n.displayName) || str(n.nodeId)}>
          <span className="grow"><b>{str(n.displayName) || str(n.nodeId)}</b><small>{[str(n.platform), str(n.version)].filter(Boolean).join(" · ")}</small></span>
          <Pill tone={n.connected === true ? "ok" : "idle"}>{n.connected === true ? "Lent" : "Offline"}</Pill>
        </div>
      )) : <Empty>No phone is lent. Turn it on from the phone’s settings.</Empty>}
    </div>
  );
}

function LogbookNode({ c }: { c: Ctx }) {
  const cfg = useConfig(c.engine);
  const nodes = useLive<RecordValue>(c.engine, "node.list", {}, ["node"]);
  const opts = [{ id: "", label: "The first one that can" }, ...list(rec(nodes.data).nodes).filter((n) => (Array.isArray(n.commands) ? n.commands : []).includes("screen.snapshot") || (Array.isArray(n.caps) ? n.caps : []).includes("screen")).map((n) => ({ id: str(n.nodeId), label: str(n.displayName) || str(n.nodeId) }))];
  return (
    <Ctl title="From which computer" sub="Your computers that can take screen pictures.">
      <Pick label="From which computer" value={str(cfg.get(`${LB}.nodeId`))} options={opts} disabled={cfg.loading} onChange={(id) => void cfg.set(`${LB}.nodeId`, id || null)} />
    </Ctl>
  );
}

function LogbookModel({ c }: { c: Ctx }) {
  const cfg = useConfig(c.engine);
  const models = useLive<RecordValue>(c.engine, "models.list", {}, []);
  const opts = [{ id: "", label: "Your pictures model" }, ...list(rec(models.data).models).map((m) => ({ id: `${str(m.provider)}/${str(m.id)}`, label: str(m.name) || str(m.id) }))];
  return (
    <Ctl title="Model that reads the pictures" sub="Set in Settings › Models.">
      <Pick label="Model that reads the pictures" value={str(cfg.get(`${LB}.visionModel`))} options={opts} disabled={cfg.loading} onChange={(id) => void cfg.set(`${LB}.visionModel`, id || null)} />
    </Ctl>
  );
}

function ScreenDriver({ c }: { c: Ctx }) {
  const st = useLive<RecordValue>(c.engine, "computer.status", {}, []);
  const d = rec(st.data);
  const tone = d.available === true ? "ok" : d.configured === true ? "bad" : "idle";
  const word = d.available === true ? "Ready" : d.configured === true ? "Not working" : "Not set up";
  return (
    <Ctl title="Screen driver" sub={str(d.error) || "The driver computer control uses on this computer."}>
      {st.data ? <Pill tone={tone}>{word}</Pill> : null}
      <Btn sm disabled title="Reinstalling the driver is done by the Branch app on your computer.">Reinstall</Btn>
    </Ctl>
  );
}

function BoxImage({ c }: { c: Ctx }) {
  const cfg = useConfig(c.engine);
  const image = str(cfg.get(`${SANDBOX}.docker.image`)) || SANDBOX_IMAGE;
  return <Ctl title="Box image" sub="Build it once before first use; Branch says how if it is missing."><code className="s2-code">{image}</code><CopyBtn text={image} /></Ctl>;
}

/* ---------- Cloud computers ---------- */

const CLOUD: SecSpec = { t: "Cloud computers", lv: 1, hint: "A fresh machine that does one conversation’s work and is thrown away after. The conversation and its changes stay here.", body: (c) => <Cloud c={c} />, titles: [["Repositories", 1], ["Most spares at once", 1]] };

const TABS = [{ id: "cloud", label: "Cloud computers" }, { id: "spares", label: "Spares" }, { id: "snaps", label: "Snapshots" }];
const STATE: Record<string, string> = { requested: "Asked for", provisioning: "Starting", bootstrapping: "Setting up", ready: "Ready", attached: "Working", idle: "Idle", draining: "Finishing", destroying: "Going away", destroyed: "Gone", failed: "Failed", orphaned: "Lost track" };

function Cloud({ c }: { c: Ctx }) {
  const envs = useLive<RecordValue>(c.engine, "environments.list", { includePreparedDetails: true }, ["node", "environments"]);
  const [tab, setTab] = useState("cloud");
  const data = rec(envs.data);
  const workers = list(data.environments).filter((e) => e.worker);
  const purpose = (e: RecordValue) => str(rec(e.preparation).purpose);
  const shown = workers.filter((e) => (tab === "spares" ? purpose(e) === "reserve" : tab === "snaps" ? purpose(e) === "build" : !purpose(e)));
  const profiles = list(data.profiles);
  return (
    <>
      <Tabs tabs={TABS} value={tab} onChange={setTab} label="Cloud computers" />
      {envs.error ? <p className="hint s2-err" role="alert">{envs.error}</p> : null}
      {shown.length ? <div className="rows">{shown.map((e) => <CloudRow key={str(e.id)} c={c} env={e} onChanged={() => void envs.reload()} />)}</div>
        : <Empty>{tab === "spares" ? "No spares are ready." : tab === "snaps" ? "No snapshots yet." : "No cloud computers yet."}</Empty>}
      {tab === "cloud" ? <CloudOffer c={c} profiles={profiles} onMade={() => void envs.reload()} /> : null}
      <Repos c={c} profiles={profiles} />
      <SparesMax c={c} />
    </>
  );
}

function CloudRow({ c, env, onChanged }: { c: Ctx; env: RecordValue; onChanged: () => void }) {
  const [ask, setAsk] = useState(false);
  const w = rec(env.worker);
  const name = str(env.label) || str(w.profileId) || str(env.id);
  return (
    <div className="prow" data-row={name}>
      <Tile><Ico name="cloud" s /></Tile>
      <span className="grow"><b>{name}</b><small>{[str(w.providerId), STATE[str(w.state)] ?? str(w.state), span(w.ageMs) ? `up ${span(w.ageMs)}` : "", str(w.error)].filter(Boolean).join(" · ")}</small></span>
      <Btn sm ghost onClick={() => setAsk(true)}>Remove…</Btn>
      {ask ? <Confirm title={`Remove ${name}?`} body="The machine is thrown away. Conversations that used it keep their changes here." yes="Remove" danger
        onYes={async () => { await c.engine.request("environments.destroy", { environmentId: str(env.id) }); onChanged(); }} onClose={() => setAsk(false)} /> : null}
    </div>
  );
}

/** Add a cloud computer: starts one from a cloud computer profile the engine has. */
function CloudOffer({ c, profiles, onMade }: { c: Ctx; profiles: RecordValue[]; onMade: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="s2cm-offer">
      <Tile><Ico name="cloud" s /></Tile>
      <span className="grow"><b>Cloud computers</b><small>Off until you choose: they cost money while they run.</small></span>
      <Btn sm disabled={!profiles.length} title={profiles.length ? undefined : "Needs a cloud computer provider set up in this engine."} onClick={() => setOpen(true)}>Add a cloud computer</Btn>
      {open ? <NewCloud engine={c.engine} profiles={profiles} onClose={(made) => { setOpen(false); if (made) onMade(); }} /> : null}
    </div>
  );
}

export function NewCloud({ engine, profiles, onClose }: { engine: WindowEngine; profiles: RecordValue[]; onClose: (made: boolean) => void }) {
  const [pick, setPick] = useState(str(profiles[0]?.id));
  const call = useCall();
  const go = () => void call.run(async () => { await engine.request("environments.create", { profileId: pick, idempotencyKey: crypto.randomUUID() }); onClose(true); });
  return (
    <Dialog title="A cloud computer" onClose={() => onClose(false)} footer={<><Btn ghost onClick={() => onClose(false)}>Cancel</Btn><Btn pri disabled={!pick || call.busy} onClick={go}>Start it</Btn></>}>
      <label className="s2-field"><span>Where it runs</span>
        <Pick label="Where it runs" value={pick} options={profiles.map((p) => ({ id: str(p.id), label: `${str(p.id)} · ${str(p.providerDisplayId) || str(p.providerId)}` }))} onChange={setPick} />
      </label>
      <p className="hint">Each account and region is set up with the provider, not in Branch. It costs money while it runs.</p>
      <CallLine call={call} />
    </Dialog>
  );
}

/** Repositories: which cloud computer profile a repository uses unless the conversation picks one. */
function Repos({ c, profiles }: { c: Ctx; profiles: RecordValue[] }) {
  const cfg = useConfig(c.engine);
  const [open, setOpen] = useState(false);
  const map = rec(cfg.get("cloudWorkers.projectProfiles"));
  const remove = (repo: string) => void cfg.set("cloudWorkers.projectProfiles", { [repo]: null });
  return (
    <>
      <h3 className="s2cm-h3">Repositories</h3>
      <p className="hint">Which cloud computer a conversation in this repository uses unless it picks one.</p>
      {Object.keys(map).length ? <div className="rows">{Object.entries(map).map(([repo, prof]) => (
        <div key={repo} className="prow" data-row={repo}><span className="grow"><b>{repo}</b><small>{str(prof)}</small></span><Btn sm ghost onClick={() => remove(repo)}>Remove</Btn></div>
      ))}</div> : null}
      <Acts><Btn sm disabled={!profiles.length || cfg.loading} title={profiles.length ? undefined : "Needs a cloud computer provider set up in this engine."} onClick={() => setOpen(true)}>Add a repository</Btn></Acts>
      {open ? <AddRepo profiles={profiles} onSave={(repo, prof) => { void cfg.set("cloudWorkers.projectProfiles", { [repo]: prof }); setOpen(false); }} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function AddRepo({ profiles, onSave, onClose }: { profiles: RecordValue[]; onSave: (repo: string, profile: string) => void; onClose: () => void }) {
  const [repo, setRepo] = useState("");
  const [prof, setProf] = useState(str(profiles[0]?.id));
  const key = repo.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\.git$/, "").replace(/\/$/, "");
  const ok = /^[^/\s]+\/[^/\s]+\/[^/\s]+$/.test(key);
  return (
    <Dialog title="Add a repository" onClose={onClose} footer={<><Btn ghost onClick={onClose}>Cancel</Btn><Btn pri disabled={!ok || !prof} onClick={() => onSave(key, prof)}>Add</Btn></>}>
      <label className="s2-field"><span>Repository</span><input className="inp" autoFocus placeholder="github.com/owner/repo" value={repo} onChange={(e) => setRepo(e.target.value)} /></label>
      <label className="s2-field"><span>Cloud computer</span><Pick label="Cloud computer" value={prof} options={profiles.map((p) => ({ id: str(p.id), label: str(p.id) }))} onChange={setProf} /></label>
    </Dialog>
  );
}

/** Most spares at once: typed, then saved with Save (empty clears it back to the engine's 4). */
function SparesMax({ c }: { c: Ctx }) {
  const cfg = useConfig(c.engine);
  const v = cfg.get("cloudWorkers.preparedPool.maxTotal");
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (typeof v === "number" ? String(v) : "");
  const n = shown.trim() === "" ? null : Number(shown);
  const ok = n === null || (Number.isInteger(n) && n >= 0);
  const save = () => { if (!ok) return; void cfg.set("cloudWorkers.preparedPool.maxTotal", n); setDraft(null); };
  return (
    <Ctl title="Most spares at once" sub="Across every repository and cloud computer." help="Across every repository and cloud computer. Empty means 4; 0 stops spares and lets the unused ones go.">
      <input className="inp s2cm-num" inputMode="numeric" aria-label="Most spares at once" placeholder="4" value={shown} disabled={cfg.loading} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
      <Btn sm disabled={cfg.loading || !ok} onClick={save}>Save</Btn>
    </Ctl>
  );
}

/* ---------- Everything connected ---------- */

const EVERYTHING: SecSpec = { t: "Everything connected", group: "Connections", lv: 1, hint: "Every app, browser, phone and computer that can reach this Branch.", body: (c) => <Everything c={c} /> };

type Group = "Computers" | "Phones" | "Browsers and apps";
type Thing = {
  key: string; kind: "device" | "node"; id: string; name: string; plat: string; version: string; connected: boolean; seen: number; ip: string;
  paired: number; roles: string[]; scopes: string[]; tokens: RecordValue[]; group: Group; old: Thing[]; how: string; cluster: string;
};
const OS: Record<string, string> = { win32: "Windows", windows: "Windows", darwin: "macOS", macos: "macOS", linux: "Linux", ios: "iOS", android: "Android" };
const osOf = (p: unknown) => OS[str(p).toLowerCase()] ?? str(p);
/** "just now", "12 minutes ago". */
function ago(ms: unknown): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
  const d = Date.now() - ms;
  return d < 60_000 ? "just now" : `${span(d)} ago`;
}

function groupOf(plat: string, family: string, roles: string[], kind: string): Group {
  if (PHONE.test(plat) || PHONE.test(family)) return "Phones";
  return kind === "node" || roles.includes("node") ? "Computers" : "Browsers and apps";
}

/** Paired devices and nodes as one list, a node's live state joined onto its device; older pairings of the same
 *  device (same name and platform, not connected) are folded under the newest one. */
function things(devices: RecordValue, nodes: RecordValue): Thing[] {
  const byNode = new Map(list(nodes.nodes).map((n) => [str(n.nodeId), n]));
  const out: Thing[] = list(devices.paired).map((d) => {
    const n = byNode.get(str(d.deviceId)); byNode.delete(str(d.deviceId));
    const roles = words(d.roles).length ? words(d.roles) : str(d.role) ? [str(d.role)] : [];
    return { key: `d:${str(d.deviceId)}`, kind: "device", id: str(d.deviceId), name: str(d.operatorLabel) || str(d.displayName) || str(n?.displayName) || str(d.clientId) || str(d.deviceId),
      plat: osOf(str(d.platform) || str(n?.platform)), version: str(n?.version), connected: d.connected === true || n?.connected === true, seen: Number(d.lastSeenAtMs ?? n?.lastSeenAtMs) || 0,
      ip: str(d.remoteIp), paired: Number(d.approvedAtMs) || 0, roles, scopes: words(d.scopes), tokens: list(d.tokens), group: groupOf(str(d.platform), str(d.deviceFamily), roles, "device"), old: [], how: str(d.approvedVia),
      cluster: d.approvedVia === "silent" ? [d.clientId, d.clientMode, d.displayName].map((x) => str(x).trim().toLowerCase()).join("|") : "" };
  });
  for (const n of byNode.values()) {
    if (n.approvalState === "pending-approval" || n.approvalState === "unapproved") continue;
    out.push({ key: `n:${str(n.nodeId)}`, kind: "node", id: str(n.nodeId), name: str(n.displayName) || str(n.nodeId), plat: osOf(n.platform), version: str(n.version), connected: n.connected === true,
      seen: Number(n.lastSeenAtMs) || 0, ip: str(n.remoteIp), paired: 0, roles: ["node"], scopes: [], tokens: [], group: groupOf(str(n.platform), str(n.deviceFamily), ["node"], "node"), old: [], how: "", cluster: "" });
  }
  return foldOld(out);
}

/** The engine's own rule for superseded pairings: same client and name, approved by itself on this computer;
 *  the newest one stays and older ones that aren't connected are offered for clean-up. */
function foldOld(all: Thing[]): Thing[] {
  const newest = new Map<string, Thing>();
  const out: Thing[] = [];
  for (const t of [...all].sort((a, b) => b.paired - a.paired)) {
    const keep = t.cluster ? newest.get(t.cluster) : undefined;
    if (keep && !t.connected && Date.now() - t.paired > 60_000) { keep.old.push(t); continue; }
    if (t.cluster && !keep) newest.set(t.cluster, t);
    out.push(t);
  }
  return all.filter((t) => out.includes(t));
}

function Everything({ c }: { c: Ctx }) {
  const devs = useLive<RecordValue>(c.engine, "device.pair.list", {}, PAIR_EVENTS);
  const nodes = useLive<RecordValue>(c.engine, "node.list", {}, PAIR_EVENTS);
  const npairs = useLive<RecordValue>(c.engine, "node.pair.list", {}, PAIR_EVENTS);
  const [clean, setClean] = useState(false);
  const all = things(rec(devs.data), rec(nodes.data));
  const old = all.flatMap((t) => t.old);
  const waiting = list(rec(devs.data).pending).length + list(rec(npairs.data).pending).length;
  const reload = () => { void devs.reload(); void nodes.reload(); };
  const groups: Group[] = ["Computers", "Phones", "Browsers and apps"];
  return (
    <>
      {devs.error || nodes.error ? <p className="hint s2-err" role="alert">{devs.error || nodes.error}</p> : null}
      {old.length ? <Acts><Btn sm ghost onClick={() => setClean(true)}>Clean up {old.length} old</Btn></Acts> : null}
      {devs.data && !all.length ? <Empty>Nothing is paired yet.</Empty> : null}
      {groups.map((g, i) => {
        const rows = all.filter((t) => t.group === g);
        if (!rows.length) return null;
        return (
          <Fragment key={g}>
            <div className="s2-grp">{g} · {rows.filter((t) => t.connected).length} of {rows.length} connected{i === groups.findIndex((x) => all.some((t) => t.group === x)) && waiting ? <> · <button type="button" className="link-k s2cm-wait" onClick={() => document.getElementById("s2-waiting")?.scrollIntoView({ behavior: "smooth" })}>{waiting} waiting for your yes</button></> : null}</div>
            <div className="rows">{rows.map((t) => <ThingRow key={t.key} c={c} t={t} onChanged={reload} />)}</div>
          </Fragment>
        );
      })}
      {clean ? <Confirm title={`Remove ${old.length} old ${old.length === 1 ? "pairing" : "pairings"}?`} body={`They are older copies of devices that paired again: ${old.map((t) => `${t.name}${t.seen ? `, last seen ${ago(t.seen)}` : ""}`).join("; ")}. Each one pairs again by itself the next time it connects.`} yes="Remove them"
        onYes={async () => { for (const t of old) await c.engine.request("device.pair.remove", { deviceId: t.id }); reload(); }} onClose={() => setClean(false)} /> : null}
    </>
  );
}

const ICON: Record<Group, string> = { Computers: "monitor", Phones: "phone", "Browsers and apps": "globe" };

function ThingRow({ c, t, onChanged }: { c: Ctx; t: Thing; onChanged: () => void }) {
  const [dlg, setDlg] = useState<"" | "rename" | "remove">("");
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const more = useRef<HTMLButtonElement>(null);
  const items: MenuItem[] = [
    { label: "Rename…", run: () => setDlg("rename") },
    { kind: "sep" },
    { label: "Remove…", danger: true, run: () => setDlg("remove") },
  ];
  const sub = [t.plat, t.version, t.connected ? "" : t.seen ? `Offline · last seen ${ago(t.seen)}` : "Offline"].filter(Boolean).join(" · ");
  return (
    <div className="prow s2cm-thing" data-row={t.name}>
      <Tile><Ico name={ICON[t.group]} s /></Tile>
      <span className="grow">
        <b>{t.name}</b><small>{sub}</small>
        {t.old.length ? <small>{t.old.length} older {t.old.length === 1 ? "pairing" : "pairings"} of {t.name}</small> : null}
        {c.lv >= 2 ? <Details c={c} t={t} onChanged={onChanged} /> : null}
      </span>
      {t.connected ? <span className="s2cm-dot ok" aria-label="Connected now" /> : null}
      <button ref={more} type="button" className="icon-btn s2cm-more" aria-label={`More for ${t.name}`} aria-haspopup="menu" onClick={() => { const r = more.current?.getBoundingClientRect(); setMenu(r ? { x: r.right - 200, y: r.bottom + 4 } : null); }}><Icon name="more" small /></button>
      {menu ? <Menu at={menu} items={items} label={`More for ${t.name}`} onClose={() => setMenu(null)} /> : null}
      {dlg === "rename" ? <Rename c={c} t={t} onClose={(ch) => { setDlg(""); if (ch) onChanged(); }} /> : null}
      {dlg === "remove" ? <Confirm title={`Remove ${t.name}?`} body="It must pair again before it can reach this Branch." yes="Remove" danger
        onYes={async () => { await c.engine.request(t.kind === "device" ? "device.pair.remove" : "node.pair.remove", t.kind === "device" ? { deviceId: t.id } : { nodeId: t.id }); onChanged(); }} onClose={() => setDlg("")} /> : null}
    </div>
  );
}

function Rename({ c, t, onClose }: { c: Ctx; t: Thing; onClose: (changed: boolean) => void }) {
  const [name, setName] = useState(t.name);
  const call = useCall();
  const save = () => void call.run(async () => {
    if (t.kind === "device") await c.engine.request("device.pair.rename", { deviceId: t.id, label: name.trim() });
    else await c.engine.request("node.rename", { nodeId: t.id, displayName: name.trim() });
    onClose(true);
  });
  return (
    <Dialog title={`Rename ${t.name}`} onClose={() => onClose(false)} footer={<><Btn ghost onClick={() => onClose(false)}>Cancel</Btn><Btn pri disabled={!name.trim() || call.busy} onClick={save}>Rename</Btn></>}>
      <label className="s2-field"><span>Name</span><input className="inp" autoFocus maxLength={64} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) save(); }} /></label>
      <CallLine call={call} />
    </Dialog>
  );
}

const DAY = 86_400_000;
function Details({ c, t, onChanged }: { c: Ctx; t: Thing; onChanged: () => void }) {
  const rows: [string, ReactNode][] = [
    ["Platform", t.plat], ["Version", t.version], ["Last seen", t.connected ? "just now" : ago(t.seen)], ["Address", t.ip],
    ["Paired", t.paired ? `${day(t.paired)}${t.how && t.how !== "owner" && t.how !== "bootstrap" ? " · Paired by itself" : ""}` : ""],
    ["Roles", t.roles.length ? <code>{t.roles.join(", ")}</code> : ""], ["Access", t.scopes.length ? <code>{t.scopes.join(", ")}</code> : ""],
  ];
  return (
    <details className="s2-det">
      <summary>Details</summary>
      <Kv rows={rows} />
      {t.kind === "device" && t.tokens.length ? (
        <>
          <h3 className="s2cm-h3">Access keys</h3>
          <div className="rows">{t.tokens.map((k) => <KeyRow key={str(k.role)} c={c} t={t} k={k} onChanged={onChanged} />)}</div>
        </>
      ) : null}
    </details>
  );
}

function KeyRow({ c, t, k, onChanged }: { c: Ctx; t: Thing; k: RecordValue; onChanged: () => void }) {
  const [dlg, setDlg] = useState<"" | "revoke">("");
  const [done, setDone] = useState<RecordValue | null>(null);
  const call = useCall();
  const role = str(k.role);
  const revoked = typeof k.revokedAtMs === "number";
  const age = Math.max(0, Math.floor((Date.now() - (Number(k.rotatedAtMs ?? k.createdAtMs) || Date.now())) / DAY));
  const rotate = () => void call.run(async () => { setDone(rec(await c.engine.request("device.token.rotate", { deviceId: t.id, role }))); onChanged(); });
  return (
    <div className="prow">
      <span className="grow"><b>Role {role}</b><small>{revoked ? "Revoked" : "Active"} · Age {age} {age === 1 ? "day" : "days"}</small><CallLine call={call} /></span>
      {revoked ? null : <><Btn sm ghost disabled={call.busy} onClick={rotate}>Replace</Btn><Btn sm ghost onClick={() => setDlg("revoke")}>Revoke</Btn></>}
      {dlg === "revoke" ? <Confirm title={`Revoke the ${role} key?`} body="It stops working at once and can’t be brought back." yes="Revoke" danger
        onYes={async () => { await c.engine.request("device.token.revoke", { deviceId: t.id, role }); onChanged(); }} onClose={() => setDlg("")} /> : null}
      {done ? (
        <Dialog title={`Key replaced · ${t.name}`} onClose={() => setDone(null)}>
          <p>{done.tokenDelivery === "in-band" ? "This device has its new key already; there is nothing else to do." : "It reconnects with the new key by itself; there is nothing else to do. If it doesn’t, pair it again. For safety, the new key is shown only on the device itself."}</p>
        </Dialog>
      ) : null}
    </div>
  );
}

/* ---------- Who is connected now ---------- */

const WHO: SecSpec = { t: "Who is connected now", group: "Connections", showHeading: false, lv: 1, hint: "Every app, browser, phone and computer reporting in right now.", body: (c) => <Who c={c} /> };

const MODE: Record<string, string> = { ui: "the window", webchat: "a browser", cli: "the terminal", node: "a computer", backend: "a service", gateway: "this Branch" };
const IDLE_S = 300;

function Who({ c }: { c: Ctx }) {
  const pres = useLive<unknown>(c.engine, "system-presence", {}, ["presence"]);
  const nodes = useLive<RecordValue>(c.engine, "node.list", {}, PAIR_EVENTS);
  const devs = useLive<RecordValue>(c.engine, "device.pair.list", {}, PAIR_EVENTS);
  const rows = list(pres.data);
  const byNode = new Map(list(rec(nodes.data).nodes).map((n) => [str(n.nodeId), n]));
  const pending = list(rec(devs.data).pending);
  return (
    <>
      <Acts><button type="button" className="icon-btn" aria-label="Refresh" title="Refresh" onClick={() => { void pres.reload(); void nodes.reload(); }}><Ico name="retry" s /></button></Acts>
      {pres.error ? <p className="hint s2-err" role="alert">{pres.error}</p> : null}
      {pres.data && !rows.length && !pending.length ? <Empty>Nothing is reporting in right now.</Empty> : null}
      <div className="rows">
        {rows.map((p, i) => <PresRow key={str(p.connectionId) || str(p.instanceId) || i} p={p} node={byNode.get(str(p.deviceId))} />)}
        {pending.map((r) => (
          <div key={str(r.requestId)} className="prow">
            <Tile><Ico name="monitor" s /></Tile>
            <span className="grow"><b>{str(r.displayName) || str(r.clientId) || "A device"}</b><small>Waiting for your yes. Its abilities stay off until you allow it.</small></span>
            <Btn sm onClick={() => document.getElementById("s2-waiting")?.scrollIntoView({ behavior: "smooth" })}>Review</Btn>
          </div>
        ))}
      </div>
    </>
  );
}

function PresRow({ p, node }: { p: RecordValue; node?: RecordValue }) {
  const off = str(p.reason) === "disconnect";
  const idle = !off && typeof p.lastInputSeconds === "number" && p.lastInputSeconds >= IDLE_S;
  const state = off ? "Offline" : idle ? "Idle" : "Active";
  const caps = node ? words(node.caps).length : 0;
  const cmds = node ? words(node.commands).length : 0;
  const reason = str(p.reason);
  const name = str(node?.displayName) || str(p.host) || str(p.clientId) || "A device";
  const phone = PHONE.test(str(p.platform)) || PHONE.test(str(p.deviceFamily));
  const kind = phone ? "a phone" : MODE[str(p.mode)] ?? str(p.mode);
  return (
    <div className="prow" data-row={name}>
      <Tile><Ico name={phone ? "phone" : str(p.mode) === "webchat" ? "globe" : "monitor"} s /></Tile>
      <span className="grow">
        <b>{name}</b>
        <small>{[osOf(p.platform), str(p.version), kind].filter(Boolean).join(" · ")}</small>
        <small>{[words(p.roles).join(", "), node ? `${caps} abilities · ${cmds} commands` : "", reason ? `Last update: ${reason[0].toUpperCase()}${reason.slice(1)}` : ""].filter(Boolean).join(" · ")}</small>
      </span>
      <span className={`s2cm-dot ${off ? "hollow" : idle ? "idle" : "ok"}`} aria-hidden="true" />
      <small className="s2cm-pres">{state} · last seen {ago(p.ts) || "just now"}</small>
    </div>
  );
}

/** The sections in the preview's order; a section shows from its level up. */
const SECTIONS: SecSpec[] = [
  CLOUD, ON_COMPUTER, USING_SCREEN, BROWSER_BASIC, TECHNICAL, LET_TRUNKS, PHONES_LENT, EVERYTHING, WHO, LOGBOOK,
  LENT_TECH, SCREEN_TECH, ALLOWING, CODE_COMMITS, NETWORK_MORE, ...BROWSER_MORE, ...BROWSER_TECH, ...CODE_SECS, CODE_TECH,
  ON_MORE, USING_MORE, PHONES_SMALL, MORE_PLACES, USING_TECH, WHERE_MORE, SCRIPTS, SEALED_TECH, LIMITS_TECH,
];

export const ROWS: RowEntry[] = SECTIONS.flatMap((s) => [
  { page: "computer", title: s.t, sec: s.t, group: s.group ?? s.t, lv: s.lv },
  ...(s.rows ?? []).filter((r) => r.k !== "hint").map((r) => ({ page: "computer", title: r.t, sec: s.t, group: s.group ?? s.t, lv: Math.max(s.lv, r.lv ?? 0) as Lv })),
  ...(s.titles ?? []).map(([title, lv]) => ({ page: "computer", title, sec: s.t, group: s.group ?? s.t, lv: Math.max(s.lv, lv) as Lv })),
]);
