import { describe, expect, it } from "vitest";
import { createFrameActions } from "./frame-harness-actions";
import { SLATE, toPalette } from "../src/places/settings/set1/appearance-look";

describe("frame crawl create/save responses", () => {
  it("creates distinct conversations that appear in the fixture list", () => {
    const fixture = createFrameActions();
    const first = fixture.request("sessions.create", { agentId: "main", label: "Planning" });
    const second = fixture.request("sessions.create", { agentId: "main" });
    expect(first).toMatchObject({ key: fixture.sessions[0].key });
    expect(first).not.toEqual(second);
    expect(fixture.sessions[0]).toMatchObject({ agentId: "main", label: "Planning" });
  });
  it("round-trips missing and existing instruction files with revision checks", () => {
    const { request } = createFrameActions();
    const p = { agentId: "main", name: "SOUL.md" };
    expect(request("agents.files.get", p)).toMatchObject({ file: { missing: true } });
    const saved = request("agents.files.set", { ...p, content: "First", expectedMissing: true }) as { file: { hash: string } };
    expect(request("agents.files.get", p)).toMatchObject({ file: { content: "First", missing: false, hash: saved.file.hash } });
    expect(() => request("agents.files.set", { ...p, content: "Stale", expectedMissing: true })).toThrow();
    request("agents.files.set", { ...p, content: "Second", expectedHash: saved.file.hash });
    expect(request("agents.files.get", p)).toMatchObject({ file: { content: "Second" } });
  });
  it("provides a profile and retains imported theme definitions and preferences", () => {
    const { request } = createFrameActions();
    expect(request("users.prefs.get")).toMatchObject({ status: "ok" });
    const definition = { name: "Test", light: toPalette(SLATE.light), dark: toPalette(SLATE.dark) };
    request("themes.import", { id: "test", definition });
    request("users.prefs.set", { entries: { "ui.window.look": { themeExtra: {} } } });
    expect(request("themes.get", { id: "user/test" })).toMatchObject({ definition });
    expect(request("themes.list")).toMatchObject({ themes: expect.arrayContaining([expect.objectContaining({ id: "user/test", name: "Test" })]) });
    expect(request("users.prefs.get")).toMatchObject({ entries: { "ui.window.look": { themeExtra: {} } } });
  });
});
