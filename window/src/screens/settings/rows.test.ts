import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { NAV, PAGES, TOP_PAGES, pageFor, pageShown, type PageId } from "./nav";
import { agentsWork } from "./pages/general";
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
    expect(cardRows("general", "Waiting line", 1, {})).toEqual([]);
    expect(cardRows("general", "Waiting line", 2, {}).length).toBe(2);
    expect(pageFirstLevel("general", {})).toBe(0);
    expect(pageFirstLevel("seedbank", {})).toBeNull();
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
    const old: [string, PageId][] = [["people", "who"], ["gateway", "remote"], ["usage", "privacy"], ["seasons", "history"], ["trunksP17", "trunks"], ["general", "general"], ["nope", "general"], ["__proto__", "general"]];
    for (const [from, to] of old) expect(pageFor(from)).toBe(to);
  });

  it("shows Developer only at Technical", () => {
    expect(pageShown("developer", 1)).toBe(false);
    expect(pageShown("developer", 2)).toBe(true);
    expect(pageShown("general", 0)).toBe(true);
  });
});
