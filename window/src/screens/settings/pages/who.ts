// Settings › Who uses Branch: the approved preview's three cards (preview.html PG who): People, Records, Signing in to
// Branch. People opens with the list of everyone who uses Branch, the chosen person's card and Invite someone (Classic's
// own block, who-live.tsx), as the preview draws it; the PIN and conversation-separation rows and every sign-in row wait
// for Branch (Coming in their own words); the People place buttons and Signed household records are live.
import type { Level } from "../nav";
import type { Control, Row, RowOption } from "../rows";

type Extra = { help?: string; level?: Level; control?: Control; options?: RowOption[] };
const coming = (id: string, card: string, label: string, need: string, extra: Extra = {}): Row =>
  ({ id, page: "who", card, label, level: 0, control: "custom", ...extra, source: { kind: "coming", need, reason: `${label} comes in a later update.` } });
const SIGN = "Signing in to Branch";
const AUTH = "engine: ways to sign in to Branch";

export const WHO_ROWS: Row[] = [
  { id: "who.people.everyone", page: "who", card: "People", label: "Invite someone", level: 0, control: "custom", bare: true,
    source: { kind: "slot", calls: ["users.list", "users.self", "system-presence"], reason: "Invite someone comes in a later update." } },
  coming("who.people.pin", "People", "Ask for a PIN when switching person", "engine: a PIN for switching person", { control: "toggle",
    help: "At least four digits, kept on this computer. Five wrong tries in a row tell the owner." }),
  coming("who.people.separate", "People", "Keep conversations separate", "window: setting each role's conversation access", { control: "toggle",
    help: "People can’t read each other’s conversations unless they share one." }),
  { id: "who.people.open", page: "who", card: "People", label: "What you share", level: 0, control: "custom", bare: true,
    source: { kind: "slot", calls: [], reason: "What you share comes in a later update." } },
  { id: "who.records.signed", page: "who", card: "Records", label: "Signed household records", level: 1, control: "custom",
    help: "Changes people make are signed, so it’s clear who did what; code changes come as patches.",
    source: { kind: "slot", calls: ["audit.list", "agents.list"], reason: "Signed household records comes in a later update." } },
  coming("who.sign.passkeys", SIGN, "Passkeys", AUTH, { control: "toggle", level: 1, help: "People sign in with their device’s face, finger or PIN." }),
  coming("who.sign.codes", SIGN, "Authenticator codes", AUTH, { control: "toggle", level: 1, help: "A six-digit code as a second step, with backup codes." }),
  coming("who.sign.email-link", SIGN, "A link by email", AUTH, { control: "toggle", level: 1, help: "A one-time link instead of a password." }),
  coming("who.sign.social", SIGN, "Google, GitHub or Apple", AUTH, { control: "toggle", level: 1, help: "People sign in with an account they already have." }),
  coming("who.sign.company", SIGN, "Company sign-in", AUTH, { control: "select", level: 1, help: "Roles and groups come across with it.",
    options: ["None", "OpenID Connect", "SAML", "LDAP or Active Directory", "The sign-in proxy in front"].map((v) => ({ v, label: v })) }),
  coming("who.sign.new", SIGN, "New people", AUTH, { control: "segmented", level: 1,
    options: [{ v: "invite", label: "By invite only" }, { v: "ask", label: "Anyone, after my yes" }] }),
  coming("who.sign.domains", SIGN, "Allowed email domains", AUTH, { control: "text", level: 1, help: "One per line. Empty: any." }),
  coming("who.sign.check-email", SIGN, "Check their email first", AUTH, { control: "toggle", level: 1 }),
  coming("who.sign.bots", SIGN, "A check against bots on the sign-in page", AUTH, { control: "toggle", level: 1, help: "Off until you choose: it loads a check from Cloudflare." }),
  coming("who.sign.directory", SIGN, "Add people from your directory", AUTH, { control: "toggle", level: 1, help: "Your company’s directory adds and removes people (SCIM)." }),
  coming("who.sign.one-time", SIGN, "One-time sign-in links for other systems", AUTH, { control: "toggle", level: 1, help: "Short-lived, for a system that opens Branch for someone." }),
  coming("who.sign.pass-on", SIGN, "Pass company sign-in on to tools", AUTH, { control: "toggle", level: 1, help: "A tool can act as the person who signed in." }),
  coming("who.sign.guest", SIGN, "Let someone start as a guest", AUTH, { control: "toggle", level: 1, help: "Their work stays when they make an account." }),
  coming("who.sign.recovery", SIGN, "Recovery key", AUTH, { level: 1, help: "Resets the owner’s password if every other way is lost. Keep it somewhere safe." }),
];
