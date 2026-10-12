import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isPlace } from "../../places-nav/routes";
import { navPage } from "../settings/nav";
import { AREA, HOME, KINDS, TECHNICAL_AREAS, countLine, countsOf, flatten, loadAtlas, visibleRange, type AtlasRow } from "./atlas";

const row = (id: string, a: string, s: AtlasRow["s"], f = id, w = ""): AtlasRow => ({ id, a, f, w, s, p: "pack1" });

describe("the shipped atlas", () => {
  it("has the 4,973 features of the approved preview: 387 In Branch, 42 Partly built, 4,544 Coming", async () => {
    const rows = await loadAtlas();
    expect(countsOf(rows)).toEqual({ all: 4973, in: 387, part: 42, soon: 4544 });
    expect(new Set(rows.map((r) => r.id)).size).toBe(4973);
  });

  it("files every row under one of the 21 areas of the 7 kinds", async () => {
    const areas = new Set(KINDS.flatMap(([, list]) => list));
    expect(KINDS).toHaveLength(7);
    expect(areas.size).toBe(21);
    expect(Object.keys(AREA).sort()).toEqual([...areas].sort());
    for (const r of await loadAtlas()) expect(areas.has(r.a), r.id).toBe(true);
  });

  const dir = join(process.cwd(), "src/screens/features/atlas");
  const shards = readdirSync(dir).filter((name) => name.endsWith(".json")).sort();

  it("names no upstream product, so the shipped copy passes the wording check", () => {
    for (const name of shards) expect(readFileSync(join(dir, name), "utf8"), name).not.toMatch(/\bopen[\s_-]?claw\b|openclaw\.ai/i);
  });

  it("keeps every shard under 95,000 bytes, so GitHub returns a patch the personal-info gate can read", () => {
    expect(shards.length).toBeGreaterThan(1);
    for (const name of shards) expect(statSync(join(dir, name)).size, name).toBeLessThan(95_000);
  });

  it("loads the shards in order as whole rows", async () => {
    const rows = await loadAtlas();
    expect(rows[0]).toEqual({ id: "AGENT-LOOP-0001", a: "agent-loop", f: "Agent turn loop (model, tools, model)", w: expect.stringContaining("Runs each user turn as a loop"), s: "in Branch", p: "pack1" });
    for (const row of rows) expect([row.id, row.a, row.f, row.w, row.s, row.p].every((v) => typeof v === "string" && v.length > 0), row.id).toBe(true);
  });

  it("only links to areas that exist", () => {
    for (const area of Object.keys(HOME)) expect(AREA[area], area).toBeDefined();
  });

  it("only opens Settings pages and places that exist, so a host can route every Open", () => {
    for (const [area, home] of Object.entries(HOME)) {
      if (home.kind === "settings") expect(navPage(home.page), `${area} → ${home.page}`).toBeDefined();
      if (home.kind === "place") expect(isPlace(home.place), `${area} → ${home.place}`).toBe(true);
    }
    expect(HOME["multi-agent"]).toEqual({ kind: "settings", page: "trunks" });
    expect(HOME.sessions).toEqual({ kind: "chat" });
  });
});

describe("flatten", () => {
  const rows = [
    row("T-1", "tools", "in Branch", "Run shell commands", "exec"),
    row("T-2", "tools", "planned", "Spreadsheet tool"),
    row("O-1", "ops", "partly built", "Gateway restart"),
    row("V-1", "voice", "planned", "Talk mode"),
  ];

  it("groups kinds › areas › rows and holds Technical areas back below Technical", () => {
    const flat = flatten(rows, { query: "", filter: "all", technical: false });
    expect(flat.items.map((i) => i.key)).toEqual(["k:Tools and connections", "a:tools", "T-1", "T-2", "k:Conversations and channels", "a:voice", "V-1"]);
    expect(flat.hidden).toBe(1);
    expect(countLine(flat, 4)).toBe("3 of 4 features · 1 more at the Technical level");
    const tech = flatten(rows, { query: "", filter: "all", technical: true });
    expect(tech.hidden).toBe(0);
    expect(tech.items.some((i) => i.key === "a:ops")).toBe(true);
    expect(TECHNICAL_AREAS.has("ops")).toBe(true);
  });

  it("filters by status and searches name, description and id, Technical areas included while searching", () => {
    expect(flatten(rows, { query: "", filter: "in", technical: false }).shown).toBe(1);
    expect(flatten(rows, { query: "", filter: "soon", technical: false }).shown).toBe(2);
    expect(flatten(rows, { query: "gateway", filter: "all", technical: false }).items.map((i) => i.key)).toEqual(["k:Safety and oversight", "a:ops", "O-1"]);
    expect(flatten(rows, { query: "EXEC", filter: "all", technical: false }).shown).toBe(1);
    expect(flatten(rows, { query: "v-1", filter: "all", technical: false }).shown).toBe(1);
    expect(flatten(rows, { query: "nothing like it", filter: "all", technical: false }).items).toEqual([]);
  });

  it("lays rows out at fixed heights (kind 44, area 34, row 58) and draws only what is near the viewport", () => {
    const many = Array.from({ length: 300 }, (_, i) => row(`T-${i}`, "tools", "planned"));
    const flat = flatten(many, { query: "", filter: "all", technical: false });
    expect(flat.offsets.slice(0, 4)).toEqual([0, 44, 78, 136]);
    expect(flat.height).toBe(44 + 34 + 300 * 58);
    const [from, to] = visibleRange(flat, 5800, 640);
    expect(flat.offsets[from]! + 58).toBeGreaterThanOrEqual(5800 - 200);
    expect(flat.offsets[to - 1]!).toBeLessThan(5800 + 640 + 200);
    expect(to - from).toBeLessThan(25);
    expect(visibleRange(flatten([], { query: "", filter: "all", technical: false }), 0, 640)).toEqual([0, 0]);
  });
});