// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { WindowEngine } from "../connect/engine";
import { notify } from "../shell/notify";
import { ROOM_REASONS } from "./room-menu";
import { roomRulesItems, ruleToast } from "./room-rules";
import { useShellRoom, type ShellRoom } from "./useShellRoom";

vi.mock("../shell/notify", () => ({ notify: vi.fn() }));

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.mocked(notify).mockClear();
});

function who(items: ReturnType<typeof roomRulesItems>) {
  return items.filter((item): item is Extract<(typeof items)[number], { run: () => void; label: string }> => "run" in item && "label" in item).slice(0, 3);
}

describe("Group rules in a Branch group", () => {
  it("keeps Everyone and @mention greyed in a Branch group and leaves lead enabled", () => {
    const items = who(roomRulesItems({ chatApp: false, branchGroup: true, rule: "mention", choose: () => undefined }));
    expect(items.map((row) => [row.label, Boolean(row.disabled), row.checked])).toEqual([
      ["A lead Trunk decides", false, false],
      ["Everyone, every time", true, false],
      ["Only those you @mention", true, true],
    ]);
    expect(items[1]?.disabled).toBe(ROOM_REASONS.everyone);
    expect(items[2]?.disabled).toBe(ROOM_REASONS.mentions);
  });

  it("choosing a lead Trunk calls rooms.rule.set; Everyone and @mention do not persist", async () => {
    const request = vi.fn(async () => ({ room: {} }));
    const names: Record<string, string> = { scout: "Scout", builder: "Builder" };
    let shell: ShellRoom | undefined;
    function Harness() {
      shell = useShellRoom({
        engine: { request } as unknown as WindowEngine,
        rowKind: undefined,
        agentId: "scout",
        title: "Planning circle",
        ownTrunk: "Scout",
        history: [],
        trunks: [{ id: "scout", name: "Scout" }, { id: "builder", name: "Builder" }],
        groupRoom: { roomId: "room-1", rule: "mentions", members: [{ kind: "trunk", id: "scout" }, { kind: "trunk", id: "builder" }] },
        memberName: (_kind, id) => names[id] ?? id,
      });
      return null;
    }
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root!.render(<Harness />));
    expect(shell?.menu?.ruleWords).toBe("mentions only");
    const items = who(shell!.menu!.rules());
    expect(items[1]?.disabled).toBe(ROOM_REASONS.everyone);
    expect(items[2]?.disabled).toBe(ROOM_REASONS.mentions);
    await act(async () => items[1]!.run());
    await act(async () => items[2]!.run());
    expect(request).not.toHaveBeenCalledWith("rooms.rule.set", expect.anything());
    expect(notify).not.toHaveBeenCalled();
    await act(async () => items[0]!.run());
    expect(request).toHaveBeenCalledWith("rooms.rule.set", { roomId: "room-1", rule: "lead" });
    expect(notify).toHaveBeenCalledWith("A lead Trunk decides, in Planning circle from now on.");
  });

  it("keeps Who answers greyed in a participant room that is not a Branch group", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "users.self") return { profile: { id: "p-me" } };
      if (method === "sessions.describe") {
        return {
          session: {
            participants: [
              { identity: { type: "agent", id: "scout" }, label: "Scout" },
              { identity: { type: "agent", id: "builder" }, label: "Builder" },
            ],
          },
        };
      }
      return {};
    });
    const engine = { request, onEvent: () => () => undefined, sessionKey: "agent:scout:shared", agentId: "scout" } as unknown as WindowEngine;
    let shell: ShellRoom | undefined;
    function Harness() {
      shell = useShellRoom({
        engine,
        rowKind: undefined,
        agentId: "scout",
        title: "Shared",
        ownTrunk: "Scout",
        history: [],
        trunks: [{ id: "scout", name: "Scout" }, { id: "builder", name: "Builder" }],
      });
      return null;
    }
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root!.render(<Harness />));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(shell?.menu).not.toBeNull();
    const rows = who(shell!.menu!.rules());
    expect(rows.map((row) => [row.label, Boolean(row.disabled)])).toEqual([
      ["A lead Trunk decides", true],
      ["Everyone, every time", true],
      ["Only those you @mention", true],
    ]);
    expect(rows[0]?.disabled).toBe(ROOM_REASONS.lead);
    expect(rows[1]?.disabled).toBe(ROOM_REASONS.whoAnswers);
  });

  it("keeps lead greyed in a chat-app group and still sets mention or always", () => {
    const chosen: string[] = [];
    const rows = who(roomRulesItems({ chatApp: true, rule: "mention", choose: (rule) => chosen.push(rule) }));
    expect(rows.map((row) => [row.label, Boolean(row.disabled), row.checked])).toEqual([
      ["A lead Trunk decides", true, false],
      ["Everyone, every time", false, false],
      ["Only those you @mention", false, true],
    ]);
    expect(rows[0]?.disabled).toBe(ROOM_REASONS.lead);
    rows[1]!.run();
    expect(chosen).toEqual(["always"]);
    expect(ruleToast("lead", "Planning circle")).toBe("A lead Trunk decides, in Planning circle from now on.");
  });
});
