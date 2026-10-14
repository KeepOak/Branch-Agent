// Settings › Remote access: the rows of the R1 page, in the approved preview's cards (preview.html PG remote). They come
// from Classic Gateway (set2/gateway.tsx). A config row saves the engine key Classic saved, a "slot" row is drawn by the
// page (remote-live.tsx) on Classic's engine calls, and every row Classic greyed is a Coming row naming what it waits for.
// Classic's chat-app sections belong to Chat apps (preview PG chatapps) and are not drawn here.
import type { Level } from "../nav";
import type { Codec, Control, Row, RowOption } from "../rows";

type Extra = { help?: string; level?: Level; control?: Control; options?: RowOption[]; unit?: string; codec?: Codec };
/** A Coming row says only that it comes later, in the row's own words (R1-10); the call it waits for stays in `need`. */
const coming = (id: string, card: string, label: string, need: string, extra: Extra = {}): Row =>
  ({ id, page: "remote", card, label, level: 0, control: "custom", ...extra, source: { kind: "coming", need, reason: `${label} comes in a later update.` } });
const slot = (id: string, card: string, label: string, calls: string[], extra: Extra = {}): Row =>
  ({ id, page: "remote", card, label, level: 0, control: "custom", ...extra, source: { kind: "slot", calls, reason: `${label} comes in a later update.` } });
const config = (id: string, card: string, label: string, path: string, control: Control, extra: Extra = {}): Row =>
  ({ id, page: "remote", card, label, level: 0, ownerLevel: true, control, ...extra, source: { kind: "config", path } });

export const KEEP = "Keep Branch running";
export const REACH = "Reach";
export const REACHED = "How it’s reached";
export const DOING = "What it has been doing";
export const ANOTHER = "Another computer";
export const CONNECTION = "Connection";
export const EXPOSURE = "Exposure";
export const LIMITS = "Limits";
export const PREVIEWS = "App previews";
export const SCRIPTS = "From scripts";
export const NEVER = "Never break";

const APP = "desktop: a setting of the Branch app";
const RL = "gateway.auth.rateLimit";
/** A string key with a default when unset. */
const str = (fallback: string): Codec => ({ read: (v) => (typeof v === "string" && v ? v : fallback), write: (v) => v });
/** A switch that is on unless set off. */
const onUnlessOff: Codec = { read: (v) => v !== false, write: (v) => v === true };
const onIfOn: Codec = { read: (v) => v === true, write: (v) => v === true };
/** Milliseconds kept, seconds shown. */
const seconds: Codec = { read: (v) => (typeof v === "number" ? v / 1000 : undefined), write: (v) => (typeof v === "number" ? Math.round(v * 1000) : null) };
const text: Codec = { read: (v) => (typeof v === "string" ? v : ""), write: (v) => (typeof v === "string" && v.trim() ? v.trim() : null) };

/** The terminal commands From scripts shows, by row id. */
export const SCRIPT_CODE: Record<string, string> = {
  "remote.scripts.send": 'branch message send --channel telegram --target @me --message "Backup done"',
  "remote.scripts.connect": "branch channels add --channel telegram --token <token>",
  "remote.scripts.poll": 'branch message poll --channel telegram --target @team --poll-question "Lunch?" --poll-option Pizza --poll-option Sushi',
  "remote.scripts.else": "branch message --help",
  "remote.scripts.several": 'branch message broadcast --targets telegram:@me slack:channel:C123 --message "Backup done"',
};

export const REMOTE_ROWS: Row[] = [
  // Keep Branch running
  coming("remote.keep.gateway", KEEP, "Gateway", APP, { control: "segmented", options: [{ v: "off", label: "Off" }, { v: "when-needed", label: "When needed" }, { v: "on", label: "On" }],
    help: "Recommended: On. Telegram, your phone and automations keep working when the window is closed." }),
  { id: "remote.keep.working", page: "remote", card: KEEP, label: "Keep working when the window closes", level: 0, ownerLevel: true, control: "toggle", help: "Trunks finish what they started.", source: { kind: "desktop", name: "keepWorking" } },
  coming("remote.keep.carry-on", KEEP, "Carry on interrupted work by itself", "engine: a switch for carrying work on",
    { control: "toggle", help: "After a restart, safe steps carry on. Anything that sends or changes something asks you first." }),
  coming("remote.keep.tray", KEEP, "Show the gateway in the tray", APP, { control: "toggle", help: "A small Branch icon by the clock with Restart and Quit." }),
  coming("remote.keep.quit", KEEP, "Ask before quitting while work runs", APP, { control: "toggle", help: "Quit asks first while a Trunk is working. Off until you choose: Branch quits at once." }),

  // Reach (Advanced; port, sign-in and the browser page are Technical)
  config("remote.reach.bind", REACH, "Who can reach the Gateway", "gateway.bind", "segmented", { level: 1, codec: str("loopback"),
    options: [{ v: "loopback", label: "This computer" }, { v: "lan", label: "My network" }, { v: "tailnet", label: "Tailscale" }, { v: "custom", label: "One address" }, { v: "auto", label: "Automatic" }] }),
  config("remote.reach.address", REACH, "The address", "gateway.customBindHost", "text", { level: 1, codec: text, help: "Used when Who can reach the Gateway is One address." }),
  config("remote.reach.port", REACH, "Port", "gateway.port", "number", { level: 2, help: "One port for the window, phones and chat apps." }),
  config("remote.reach.auth", REACH, "Sign-in", "gateway.auth.mode", "select", { level: 2, codec: str("token"),
    options: [{ v: "token", label: "Session key" }, { v: "password", label: "Password" }, { v: "trusted-proxy", label: "Trusted proxy" }, { v: "none", label: "None" }],
    help: "How people and apps prove who they are. Changing it restarts the Gateway." }),
  coming("remote.reach.cloudflare", REACH, "Through Cloudflare", "engine: setting up a Cloudflare tunnel", { level: 1,
    help: "A public https address with Cloudflare sign-in in front. The Gateway stays on this computer and no port opens." }),
  coming("remote.reach.tailscale", REACH, "Tailscale", "engine: Tailscale’s state", { level: 1,
    help: "Reach Branch from your other devices over Tailscale." }),
  config("remote.reach.tailscale-mode", REACH, "Tailscale access", "gateway.tailscale.mode", "segmented", { level: 1, codec: str("off"),
    options: [{ v: "off", label: "Off" }, { v: "serve", label: "My tailnet" }, { v: "funnel", label: "Public" }], help: "Branch doesn’t set Tailscale up." }),
  config("remote.reach.page", REACH, "Serve Branch’s page to browsers", "gateway.controlUi.enabled", "toggle", { level: 2, codec: onUnlessOff,
    help: "The page at Branch’s address. Off keeps chat apps and devices working." }),

  // How it's reached (Advanced)
  slot("remote.reached.label", REACHED, "Label this computer", ["config.get", "config.patch"], { level: 1,
    help: "Off until you set a label: shows which computer a window talks to when you use more than one. 1 to 24 characters." }),
  slot("remote.reached.browser", REACHED, "Branch in your browser", ["config.get", "config.patch"], { level: 1,
    help: "The gateway also shows this window to a browser on this computer, at the local address. It works while the gateway runs." }),
  config("remote.reached.path", REACHED, "Web address path", "gateway.controlUi.basePath", "text", { level: 2, codec: text,
    help: "Empty means the root of the local address. Changing it restarts the gateway." }),

  // What it has been doing
  slot("remote.doing.lately", DOING, "Lately", ["health", "system.info", "presence.query"], { help: "When it started, its last health check and what keeps working when the window is closed." }),
  slot("remote.doing.restart", DOING, "Restart the engine", ["gateway.restart.request"], { help: "Running work finishes first; the window reconnects by itself." }),
  coming("remote.doing.terminal", DOING, "A terminal where the Gateway runs", "desktop: opening a terminal on the Gateway’s computer",
    { level: 1, help: "Opens a terminal on the Gateway’s computer: in WSL here, or over SSH on another computer." }),

  // Another computer (Advanced; fingerprint, host key and proxy are Technical)
  config("remote.another.how", ANOTHER, "How to reach it", "gateway.remote.transport", "segmented", { level: 1,
    codec: { read: (v) => (v === "ssh" ? "ssh" : "direct"), write: (v) => v }, options: [{ v: "direct", label: "Tailscale or my network" }, { v: "ssh", label: "Over SSH" }] }),
  config("remote.another.url", ANOTHER, "Its address", "gateway.remote.url", "text", { level: 1, codec: text, help: "For Tailscale or my network. Use wss:// when it sits behind HTTPS or Tailscale Serve." }),
  config("remote.another.ssh", ANOTHER, "SSH address", "gateway.remote.sshTarget", "text", { level: 1, codec: text, help: "For Over SSH, such as you@desk-pc. Branch opens and keeps the tunnel itself." }),
  config("remote.another.key", ANOTHER, "Its gateway key", "gateway.remote.token", "secret", { level: 1, help: "A password works too. It is kept in Branch’s settings and never shown here again." }),
  config("remote.another.fingerprint", ANOTHER, "Certificate fingerprint", "gateway.remote.tlsFingerprint", "text", { level: 2, codec: text,
    help: "Pins a wss:// address. Left empty, Branch pins it on first use, once the system trusts the certificate." }),
  config("remote.another.host-key", ANOTHER, "Check the SSH host key", "gateway.remote.sshHostKeyPolicy", "segmented", { level: 2, codec: str("strict"),
    options: [{ v: "strict", label: "Strictly" }, { v: "openssh", label: "As my SSH settings say" }] }),
  coming("remote.another.proxy", ANOTHER, "Sign in through a proxy", "window: editing gateway.remote.edgeAuth", { level: 2, control: "toggle",
    help: "A sign-in proxy in front of that computer says who you are." }),
  coming("remote.another.connect", ANOTHER, "Connect", "desktop: connecting to another computer", { level: 1 }),

  // Connection (Technical)
  slot("remote.connection.address", CONNECTION, "Gateway address", ["config.get"], { level: 2, help: "Use wss:// behind HTTPS or Tailscale, and for any computer that isn’t this one." }),
  coming("remote.connection.key", CONNECTION, "Session key or password", "desktop: this window’s connection", { level: 2, control: "secret",
    help: "The session key is kept for this window. Passwords are never stored. A phone setup code works here too." }),
  slot("remote.connection.ping", CONNECTION, "Gateway ping", ["health"], { level: 2, help: "Every 5 s while this page is open." }),
  slot("remote.connection.activity", CONNECTION, "Gateway activity", ["system.info"], { level: 2, help: "The Gateway’s own processor, memory and event-loop delay." }),
  config("remote.connection.reload", CONNECTION, "Apply settings changes", "gateway.reload.mode", "segmented", { level: 2, codec: str("hybrid"),
    options: [{ v: "hybrid", label: "Live" }, { v: "off", label: "Only on restart" }], help: "Live applies safe changes at once and restarts the Gateway when one needs it." }),
  coming("remote.connection.join-only", CONNECTION, "Only join a running Gateway", APP, { level: 2, control: "toggle",
    help: "For people who run the Gateway themselves. Off until you choose: nothing keeps Branch running when the window closes." }),
  slot("remote.connection.infra", CONNECTION, "Infrastructure settings", [], { level: 2,
    help: "Every setting for the Gateway, the browser, computers that join, finding computers nearby and the agent protocol." }),

  // Exposure (Technical)
  config("remote.exposure.uploads", EXPOSURE, "Accept files and pictures", "gateway.uploads.enabled", "toggle", { level: 2, codec: onUnlessOff,
    help: "Off refuses every upload, even from old windows; downloads still work." }),
  config("remote.exposure.hsts", EXPOSURE, "HSTS header", "gateway.http.securityHeaders.strictTransportSecurity", "text", { level: 2, codec: text, help: "Only for an https address you control." }),
  slot("remote.exposure.https", EXPOSURE, "HTTPS for the Gateway", ["config.get", "config.patch"], { level: 2,
    help: "Off until you choose: it needs a certificate; Branch can make a self-signed one." }),
  slot("remote.exposure.origins", EXPOSURE, "Allowed browser addresses", ["config.get", "config.patch"], { level: 2, help: "Default: the public address, if set." }),
  config("remote.exposure.host-header", EXPOSURE, "Trust the Host header for origins", "gateway.controlUi.dangerouslyAllowHostHeaderOriginFallback", "toggle", { level: 2, codec: onIfOn,
    help: "Unsafe: only for setups that rely on it." }),
  slot("remote.exposure.risky", EXPOSURE, "Risky switches", ["config.get"], { level: 2 }),

  // Limits (Technical)
  config("remote.limits.attempts", LIMITS, "Wrong sign-ins allowed", `${RL}.maxAttempts`, "number", { level: 2, help: "Within the time below, from one address." }),
  config("remote.limits.per", LIMITS, "per", `${RL}.windowMs`, "number", { level: 2, unit: "s", codec: seconds }),
  config("remote.limits.lockout", LIMITS, "Then lock that address for", `${RL}.lockoutMs`, "number", { level: 2, unit: "s", codec: seconds }),
  config("remote.limits.loopback", LIMITS, "Never lock out this computer", `${RL}.exemptLoopback`, "toggle", { level: 2, codec: onUnlessOff,
    help: "So the terminal and this window can’t be locked out; browser pages are still limited." }),

  // App previews (Technical)
  coming("remote.previews.reach", PREVIEWS, "Reach previews from other devices", "engine: preview server settings", { level: 2, control: "segmented",
    options: [{ v: "here", label: "Directly" }, { v: "tailscale", label: "Private Tailscale" }, { v: "own", label: "My own address" }], help: "Previews show on this computer only." }),

  // From scripts (Technical)
  slot("remote.scripts.send", SCRIPTS, "Send a message", [], { level: 2, control: "text", help: "From any script or scheduled job." }),
  slot("remote.scripts.connect", SCRIPTS, "Connect a chat app", [], { level: 2, control: "text", help: "In one command." }),
  slot("remote.scripts.poll", SCRIPTS, "Ask a poll", [], { level: 2, control: "text", help: "2 to 12 options, in the chat apps that have polls." }),
  slot("remote.scripts.else", SCRIPTS, "Everything else in a chat", [], { level: 2, control: "text", help: "Reply, react, edit, pin, threads and more, per chat app. Add --dry-run to see it first." }),
  slot("remote.scripts.several", SCRIPTS, "Send to several chats", [], { level: 2, control: "text", help: "Each target gets it; any that fails is named." }),

  // Never break (Advanced)
  coming("remote.never.canary", NEVER, "Canary, journal and rollback", "engine: a canary and change journal", { level: 1,
    help: "Every change to how Branch runs is tried on a copy first; a bad one is rolled back by itself." }),
];
