// P46 / P24: what a thread shows after a restart. A run the engine's restart recovery carried on is marked
// "Continued after update" (not shown as a message from you); one it could not carry on keeps its
// lastRunError on the Trunk's own conversation row, so the thread can offer Resume.
import { describe, expect, it, vi } from "vitest";
import type { Contact } from "@branch/gateway-protocol";
import type { Conversation } from "../connect/conversations";
import { contactRow, projectContact } from "../shell/contacts-model";
import { historyToBlocks, RESUMED_AFTER_RESTART } from "./history";

vi.mock("../connect/gateway", () => ({ BranchGateway: class {} }));

const KEY = "agent:oak:main";

describe("restart marks", () => {
  it("shows the recovery turn as Continued after update, not as a message from you", () => {
    const blocks = historyToBlocks([
      { role: "user", content: "Build it", timestamp: 1, __branch: { id: "u1" } },
      { role: "assistant", content: [{ type: "text", text: "Starting" }], timestamp: 2, __branch: { id: "a1", runId: "r1" } },
      {
        role: "user",
        content: "[System] The gateway restarted while you were working. Continue.",
        timestamp: 3,
        provenance: { kind: "internal_system", sourceSessionKey: KEY, sourceTool: "main_session_restart_recovery" },
        __branch: { id: "u2" },
      },
      { role: "assistant", content: [{ type: "text", text: "Done" }], timestamp: 4, __branch: { id: "a2", runId: "r2" } },
    ], [], KEY, null);
    expect(blocks.filter((b) => b.kind === "user").map((b) => b.kind === "user" && b.text)).toEqual(["Build it"]);
    expect(blocks.find((b) => b.kind === "notice")).toMatchObject({ text: RESUMED_AFTER_RESTART });
    expect(JSON.stringify(blocks)).not.toContain("gateway restarted");
  });

  it("keeps an ordinary internal turn (a cron run) as it was", () => {
    const blocks = historyToBlocks([
      { role: "user", content: "Daily summary", timestamp: 1, provenance: { kind: "internal_system", sourceTool: "cron" } },
    ], [], KEY, null);
    expect(blocks[0]).toMatchObject({ kind: "user", text: "Daily summary" });
  });

  it("carries the thread's last run error onto the Trunk's row, where the restart notice reads it", () => {
    const thread = { key: KEY, runError: "Interrupted by a restart. Continue?" } as Conversation;
    const contact = {
      id: "trunk:oak", kind: "trunk", name: "Oak", threadKey: KEY, isDefault: true, lastActivityAt: 1,
      preview: { kind: "message", text: "", at: 1 }, unreadTopics: 0, threadUnread: false, needsYou: false, working: false, topicCount: 0,
    } as Contact;
    expect(contactRow(projectContact([contact], [thread])[0]!).runError).toBe("Interrupted by a restart. Continue?");
  });
});
