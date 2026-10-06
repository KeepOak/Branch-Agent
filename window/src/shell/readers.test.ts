import { describe, expect, it } from "vitest";
import { readTrunks } from "./engine-data";
import { readPersonName } from "./PersonMenu";
import { roomColour } from "./StatusBar";
import { dismiss, getToasts, notify } from "./notify";
import { dragResult } from "./use-layout";

describe("engine readers", () => {
  it("agents.list", () => {
    expect(readTrunks({ defaultId: "dev", agents: [{ id: "dev", identity: { name: "Sapling" } }, { id: "x", name: "Other" }] })).toEqual({
      defaultId: "dev",
      list: [
        { id: "dev", name: "Sapling", isDefault: true },
        { id: "x", name: "Other", isDefault: false },
      ],
    });
    expect(readTrunks({ defaultId: "main", agents: [{ id: "main", kind: "system" }] })).toEqual({
      defaultId: "main", list: [], bootstrapDefault: { id: "main", name: "main", isDefault: true },
    });
  });
  it("users.self falls back like OpenClaw: name, email, Owner", () => {
    expect(readPersonName({ profile: { displayName: "Taylor", emails: [] } })).toBe("Taylor");
    expect(readPersonName({ profile: { displayName: "", emails: ["t@example.com"] } })).toBe("t@example.com");
    expect(readPersonName(null)).toBe("Owner");
  });
});

describe("status and layout", () => {
  it("room colour by share used", () => {
    expect(roomColour(0.1)).toBe("var(--ok)");
    expect(roomColour(0.6)).toBe("var(--warn)");
    expect(roomColour(0.85)).toBe("#E8912F");
    expect(roomColour(0.97)).toBe("var(--bad)");
  });
  it("sidebar drag: rail or width", () => {
    expect(dragResult(20)).toEqual({ rail: true });
    expect(dragResult(100)).toEqual({ rail: true });
    expect(dragResult(170)).toEqual({ rail: true });
    expect(dragResult(900)).toEqual({ sideW: 640, rail: false });
  });
  it("notify keeps the newest and dismisses by id", () => {
    const ids = [notify("a"), notify("b"), notify("c"), notify("d")];
    expect(getToasts().map((t) => t.text).at(-1)).toBe("d");
    ids.forEach(dismiss);
    expect(getToasts()).toEqual([]);
  });
});

describe("projects", () => {
  it("projects.list as the sidebar shows them", async () => {
    const { readProjects } = await import("./Projects");
    expect(readProjects({ projects: [{ id: "p1", displayName: "Home", source: "registered" }, { id: "", displayName: "x" }] })).toEqual([{ id: "p1", name: "Home" }]);
    expect(readProjects({})).toEqual([]);
  });
});
