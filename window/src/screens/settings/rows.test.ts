import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { NAV, PAGES, TOP_PAGES, pageFor, pageShown, type PageId } from "./nav";
import { APPEARANCE_ROWS as CLASSIC_APPEARANCE } from "../../places/settings/set1/appearance-rows";
import { ASK_BEFORE_DELETE_KEY, agentsWork, askBeforeDeleting, checklistShown } from "./pages/general";
import { ROWS, cardRows, hintFor, pageFirstLevel, rowLabel, rowLevel, type Row } from "./rows";

/** The keys the engine keeps in its schema history but that do nothing (engine/src/config/dead-config-keys.test.ts). */
function deadKeys(): string[] {
  const file = resolve(process.cwd(), "../engine/src/config/dead-config-keys.test.ts");
  const text = readFileSync(file, "utf8");
  const list = text.slice(text.indexOf("it.each(["), text.indexOf("])", text.indexOf("it.each([")));
  return [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

describe("settings row table", () => {
  it("gives every row a unique id under its page, on a card its page has", () => {
    const ids = ROWS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const row of ROWS) {
      expect(row.id.startsWith(`${row.page}.`), row.id).toBe(true);
      expect(PAGES[row.page].cards, row.id).toContain(row.card);
    }
  });

  it("keeps segmented rows to 2 to 4 options", () => {
    for (const row of ROWS.filter((r) => r.control === "segmented")) {
      expect(row.options?.length ?? 0, row.id).toBeGreaterThanOrEqual(2);
      expect(row.options?.length ?? 0, row.id).toBeLessThanOrEqual(4);
    }
  });

  it("never maps a row to a dead config key", () => {
    const dead = deadKeys();
    expect(dead).toContain("messages.suppressToolErrors");
    // The paths a row really writes: a row on an object (Show agents' work) writes only the keys its codec puts in it.
    const leaves = (path: string, value: unknown): string[] =>
      value && typeof value === "object" && !Array.isArray(value) ? Object.entries(value).flatMap(([k, v]) => leaves(`${path}.${k}`, v)) : [path];
    const paths = ROWS.flatMap((r) => (r.source.kind === "config" ? leaves(r.source.path, r.codec ? r.codec.write(r.options?.[0]?.v ?? true) : 1) : []));
    expect(paths).toContain("agents.defaults.reasoningDefault");
    for (const path of paths) {
      for (const key of dead) expect(path === key || path.startsWith(`${key}.`), `${path} vs ${key}`).toBe(false);
    }
  });

  it("gives every Coming row the call it waits for and a one-line reason", () => {
    for (const row of ROWS) {
      if (row.source.kind !== "coming") continue;
      expect(row.source.need, row.id).toBeTruthy();
      expect(row.source.reason, row.id).not.toMatch(/\n/);
    }
  });

  it("takes labels and the Advanced level from schema hints, owner words first", () => {
    const row: Row = { id: "general.x.y", page: "general", card: "Writing", level: 0, control: "toggle", source: { kind: "config", path: "channels.telegram.enabled" } };
    const hints = { "channels.*.enabled": { label: "Turned on", advanced: true } };
    expect(hintFor(hints, "channels.telegram.enabled")?.label).toBe("Turned on");
    expect(hintFor(hints, "channels.telegram")).toBeUndefined();
    expect(rowLabel(row, hints)).toBe("Turned on");
    expect(rowLabel({ ...row, label: "On" }, hints)).toBe("On");
    expect(rowLabel(row, {})).toBe("enabled");
    expect(rowLevel(row, hints)).toBe(1);
    expect(rowLevel({ ...row, level: 2 }, hints)).toBe(2);
    expect(rowLevel({ ...row, ownerLevel: true }, hints)).toBe(0);
  });

  it("hides rows above the level and keeps them in their own card when shown", () => {
    const work = "Show agents’ work";
    expect(cardRows("general", work, 0, {}).map((r) => r.id)).toEqual(["general.work.mode"]);
    expect(cardRows("general", work, 1, {}).map((r) => r.id)).toContain("general.work.steps");
    // Moved here from Chat apps (preview item 36): shown at Advanced, Coming until one key covers every chat app.
    const moved = cardRows("general", work, 1, {}).filter((r) => ["general.work.chat-steps", "general.work.chat-steps-shown", "general.work.chat-thinking"].includes(r.id));
    expect(moved.map((r) => r.id)).toEqual(["general.work.chat-steps", "general.work.chat-steps-shown", "general.work.chat-thinking"]);
    for (const row of moved) expect(row.source.kind, row.id).toBe("coming");
    expect(moved[1].options?.map((o) => o.label)).toEqual(["Off", "New kinds", "All", "Every detail"]);
    expect(cardRows("general", "Waiting line", 1, {})).toEqual([]);
    expect(cardRows("general", "Waiting line", 2, {}).length).toBe(3);
    expect(pageFirstLevel("general", {})).toBe(0);
    expect(pageFirstLevel("seedbank", {})).toBeNull();
  });

  it("keeps Classic General's four controls, each on its card and on the key Classic uses (#952)", () => {
    const at = (id: string) => ROWS.find((r) => r.id === id);
    // Starting up: "Start Branch when I sign in" (Private #454 F), which opens quietly in the tray: the desktop app's
    // startWithWindows switch.
    const start = at("general.start.with-computer");
    expect(start).toMatchObject({ card: "Starting up", level: 0, control: "toggle", source: { kind: "desktop", name: "startWithWindows" } });
    expect(start?.label).toBe("Start Branch when I sign in");
    expect(start?.help).toBe("Opens quietly in the tray.");
    // Projects: Classic's list of projects (projects.list), each with its greyed Edit, is one bare row its page draws.
    const projects = at("general.projects.list");
    expect(projects).toMatchObject({ card: "Projects", level: 0, bare: true, source: { kind: "slot", calls: ["projects.list", "sessions.list"] } });
    // Writing: Show "Finish setting up", the person's look "checklist" (false hides it, null puts the default back).
    expect(at("general.writing.finish-setup")).toMatchObject({ card: "Writing", level: 0, control: "toggle", source: { kind: "look", key: "checklist" } });
    expect(checklistShown.read(undefined)).toBe(true);
    expect(checklistShown.read(false)).toBe(false);
    expect([checklistShown.write(true), checklistShown.write(false)]).toEqual([null, false]);
    // The conversation (Advanced): Ask before deleting, the device key the delete dialog reads ("0" = don't ask).
    expect(ASK_BEFORE_DELETE_KEY).toBe("branch.askBeforeDelete");
    expect(at("general.conversation.ask-delete")).toMatchObject({ card: "The conversation", level: 1, control: "toggle", source: { kind: "device", key: ASK_BEFORE_DELETE_KEY } });
    expect([askBeforeDeleting.read(null), askBeforeDeleting.read("0")]).toEqual([true, false]);
    expect([askBeforeDeleting.write(true), askBeforeDeleting.write(false)]).toEqual([null, "0"]);
    // Each card now draws these rows instead of a whole-card Coming mark.
    expect(cardRows("general", "Starting up", 0, {}).map((r) => r.id)).toContain("general.start.with-computer");
    expect(cardRows("general", "Projects", 0, {}).map((r) => r.id)).toEqual(["general.projects.list"]);
    expect(cardRows("general", "Writing", 0, {}).map((r) => r.id)).toContain("general.writing.finish-setup");
    expect(cardRows("general", "The conversation", 0, {})).toEqual([]);
    expect(cardRows("general", "The conversation", 1, {}).map((r) => r.id)).toContain("general.conversation.ask-delete");
  });

  it("keeps every Classic Accounts control on the R1 Accounts page, drawn by the page or Coming with its need (#952, #976)", () => {
    const page = ROWS.filter((r) => r.page === "accounts");
    const labels = new Set(page.map((r) => r.label));
    // Each control Classic's Accounts page draws (accounts.tsx, accounts-more.tsx, accounts-select.tsx, coding-apps.tsx,
    // own-accounts.tsx, GitHubSettings.tsx), by its title or button.
    const classic = [
      "Add an account", "Test it", "Answer first", "Rename", "Which Trunks use it", "Sign out", "Select accounts", "Pause",
      "Move to the next account in the list", "Fall back to this computer", "Each service’s terms", "Which account goes next",
      "Your own accounts", "Add your own account", "Claude Code", "Codex", "Gemini CLI", "Check again", "Where each sign-in comes from",
      // Classic's expiry row is a value on the GitHub row now ("Expires …"), as the preview shows an expiry.
      "GitHub", "Permissions", "Your keepoak.com account",
      "Which account each Trunk uses", "Helpers keep their account", "Pick by what the task needs", "Fallback keys", "Resting now",
      "Which sign-in each request used", "Organisation", "A customer’s ChatGPT plan on a KeepOak computer",
      "A command that makes a sign-in", "On a build server, sign in with", "Accept sign-ins from your editor", "This Branch’s identity",
      "Sign-ins through the Gateway", "Settings from another Branch", "Keep service settings in step on my devices",
      "Use a model from a hub for one run", "Region", "Install a service’s package when needed", "Each account keeps its own folder",
      "Point your coding apps at Branch",
    ];
    for (const title of classic) expect(labels.has(title), title).toBe(true);
    // Each working control is a row the page draws (accounts-live.tsx), naming the calls it makes; what Classic greys
    // names the call it waits for.
    const at = (id: string) => page.find((r) => r.id === id);
    for (const row of page) {
      // Show usage in the tray is the desktop app's own switch (Classic's trayUsage), as on Classic Data & usage.
      expect(["slot", "coming", "desktop"], row.id).toContain(row.source.kind);
      if (row.source.kind === "coming") expect(row.source.need, row.id).toMatch(/^(window|engine): /);
    }
    expect(at("accounts.apps.codex")?.source).toMatchObject({ kind: "slot", calls: expect.arrayContaining(["config.patch"]) });
    expect(at("accounts.order.sign-out")?.source).toMatchObject({ kind: "slot", calls: expect.arrayContaining(["models.authLogout"]) });
    expect(at("accounts.order.answer-first")?.source).toMatchObject({ kind: "slot", calls: expect.arrayContaining(["models.authOrderSet"]) });
    expect(at("accounts.order.test")?.source).toMatchObject({ kind: "slot", calls: expect.arrayContaining(["models.probe"]) });
    for (const id of ["accounts.order.rename", "accounts.order.pause"]) expect(at(id)?.source.kind, id).toBe("coming");
    // keepoak.com is the preview's button, drawn by the page and Coming with its reason.
    expect(at("accounts.keepoak.connect")?.source).toMatchObject({ kind: "slot", reason: "keepoak.com has no sign-in Branch can use yet." });
    // The preview's levels: Classic's "more" rows sit in Your own accounts at Advanced, the "technical" ones in Where each
    // sign-in comes from at Technical; there are no "Accounts, more" or "Accounts, technical" cards.
    expect(cardRows("accounts", "Your own accounts", 0, {}).map((r) => r.id)).not.toContain("accounts.more.each-trunk");
    expect(cardRows("accounts", "Your own accounts", 1, {}).map((r) => r.id)).toContain("accounts.more.each-trunk");
    expect(cardRows("accounts", "Where each sign-in comes from", 1, {})).toEqual([]);
    for (const card of ["Usage by account", "Linked accounts", "Order Branch uses them in", "When one runs out", "Which account goes next", "Your own accounts", "Coding apps on this computer",
      "Where each sign-in comes from", "Terms"]) {
      expect(cardRows("accounts", card, 2, {}).length, card).toBeGreaterThan(0);
    }
  });

  it("keeps every Classic Appearance control on the R1 Appearance page, on the key Classic uses (#952)", () => {
    const page = ROWS.filter((r) => r.page === "appearance");
    const labels = new Set(page.map((r) => r.label));
    // Classic draws these as pictures or a gallery tile, not a control; Light or dark is Classic's "Match this computer" mirrors.
    const notControls = new Set(["Pictures around Branch"]);
    const renamed: Record<string, string> = { "Match this computer": "Light or dark" };
    const classic = CLASSIC_APPEARANCE.map((e) => e.title).filter((t) => !notControls.has(t));
    expect(classic.length).toBeGreaterThan(40);
    for (const title of classic) expect(labels.has(renamed[title] ?? title), title).toBe(true);
    // Every one of Classic's look keys is a row on the same key (or Coming, where Classic greys it).
    const lookKeys = ["reduceTransparency", "contrast", "agentSize", "bg", "season", "size", "petSounds", "show.usage", "show.gateway", "show.gfx", "show.projects", "show.live",
      "show.statusbar", "still", "scenery", "msgLook", "dir", "math", "scroll", "codeCol", "tabs", "ch.act", "ch.move", "ch.touch", "ch.cap", "headlines",
      "accent", "scene", "scrim", "see", "fontUi", "fontChat", "pet", "petName", "agentShown", "askDelete"];
    const wired = new Set(page.flatMap((r) => (r.source.kind === "look" ? [r.source.key] : [])));
    for (const key of lookKeys) expect(wired.has(key), key).toBe(true);
    // Classic greys these: they stay Coming rows with the call they wait for, never a whole-card placeholder.
    const at = (id: string) => page.find((r) => r.id === id);
    for (const id of ["appearance.reading.editor-theme", "appearance.window.kiosk", "appearance.window.frame", "appearance.tray.menu", "appearance.language.pick"]) {
      expect(at(id)?.source.kind, id).toBe("coming");
    }
    // Classic's controls with more than a key are drawn by the page itself (#976), each naming the calls it makes.
    for (const id of ["appearance.theme.mode", "appearance.theme.pick", "appearance.background.preview", "appearance.pet.had", "appearance.characters.each-trunk", "appearance.list.threads", "appearance.list.small-model"]) {
      expect(at(id)?.source.kind, id).toBe("slot");
    }
    // Back to the default removes the choice, as Classic's SpecRow does; the theme's own accent and font are no choice.
    const contrast = at("appearance.theme.contrast");
    expect(contrast).toMatchObject({ card: "Theme", control: "toggle", source: { kind: "look", key: "contrast" } });
    expect([contrast?.codec?.read(undefined), contrast?.codec?.write(false), contrast?.codec?.write(true)]).toEqual([false, null, true]);
    const accent = at("appearance.theme.accent");
    expect([accent?.codec?.read(null), accent?.codec?.write("theme"), accent?.codec?.write("#2f8f5b")]).toEqual(["theme", null, "#2f8f5b"]);
    expect(at("appearance.reading.size")).toMatchObject({ control: "select", source: { kind: "look", key: "size" } });
    expect(at("appearance.background.behind")?.options?.map((o) => o.v)).not.toContain("own");
    expect(at("appearance.pet.name")?.codec?.write("  Hazel ")).toBeNull();
    // No pet and no done cheer until the person picks one: the default is "none", picking it removes the choice.
    expect([at("appearance.pet.pick")?.codec?.read(undefined), at("appearance.pet.pick")?.codec?.write("otter"), at("appearance.pet.pick")?.codec?.write("none")]).toEqual(["none", "otter", null]);
    // There is no Let it roam switch: picking a pet turns it on, so the roam row is gone from the page.
    expect(at("appearance.pet.roam")).toBeUndefined();
    expect(at("appearance.characters.shown")).toMatchObject({ control: "toggle", source: { kind: "look", key: "agentShown" }, fallback: false });
    expect(at("appearance.characters.cheer")).toMatchObject({ card: "Characters", label: "Celebrate when a task finishes", control: "toggle", source: { kind: "look", key: "cheer" }, fallback: false });
    // Each Classic card now draws rows: none of the page's Classic cards is empty at Technical.
    for (const card of ["Theme", "Background", "Reading", "The pet", "Characters", "What’s shown", "The list", "Window", "Tray", "Language"]) {
      expect(cardRows("appearance", card, 2, {}).length, card).toBeGreaterThan(0);
    }
    expect(cardRows("appearance", "Theme", 0, {}).map((r) => r.id)).toContain("appearance.theme.contrast");
  });

  it("maps Show agents’ work to the two engine defaults and back", () => {
    expect(agentsWork.read(undefined)).toBe("normal");
    expect(agentsWork.read({ reasoningDefault: "on" })).toBe("thinking");
    expect(agentsWork.read({ reasoningDefault: "off", verboseDefault: "full" })).toBe("verbose");
    for (const mode of ["normal", "thinking", "verbose"]) expect(agentsWork.read(agentsWork.write(mode))).toBe(mode);
  });
});

describe("settings nav", () => {
  it("lists the approved groups in order with a page spec for each", () => {
    expect(NAV.map((g) => g.title)).toEqual(["You", "Your Trunks", "Talking", "Accounts & models", "Permissions & safety", "Computers", "Branch"]);
    const ids = [...TOP_PAGES, ...NAV.flatMap((g) => g.pages)].map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(PAGES).sort()).toEqual([...ids].sort());
  });

  it("sends old page ids to their new page", () => {
    const old: [string, PageId][] = [["people", "who"], ["gateway", "remote"], ["usage", "privacy"], ["seasons", "learning"], ["trunksP17", "trunks"], ["general", "general"], ["nope", "general"], ["__proto__", "general"]];
    for (const [from, to] of old) expect(pageFor(from)).toBe(to);
  });

  it("shows Developer only at Technical", () => {
    expect(pageShown("developer", 1)).toBe(false);
    expect(pageShown("developer", 2)).toBe(true);
    expect(pageShown("general", 0)).toBe(true);
  });
});
