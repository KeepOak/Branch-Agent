// Written by Branch from openclaw/openclaw@57e0aaa1c190f1abe16e597008fbcc14f5e609e3:src/tui/tui-task-suggestions.ts (atlas UI-DESKTOP-0164). Verifies restored history suggestions through the production controller.
import type { Component, OverlayHandle } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import type { TaskSuggestion } from "../../packages/gateway-protocol/src/index.js";
import { stripAnsi } from "../../packages/terminal-core/src/ansi.js";
import { createTuiTaskSuggestionController } from "./tui-task-suggestions.js";

function suggestion(id: string, createdAt: number, agentId = "main"): TaskSuggestion {
  return {
    id,
    title: id,
    prompt: `Investigate ${id} from the previous session.`,
    tldr: `Follow-up from ${id}.`,
    cwd: "/repo/project",
    sessionKey: `agent:${agentId}:main`,
    agentId,
    createdAt,
  };
}

function historyHarness(history: TaskSuggestion[]) {
  type Deps = Parameters<typeof createTuiTaskSuggestionController>[0];
  type Selector = ReturnType<NonNullable<Deps["createSelector"]>>;
  const selectors: Selector[] = [];
  const prompts: Component[] = [];
  const listTaskSuggestions = vi.fn().mockResolvedValue(history);
  const dismissTaskSuggestion = vi.fn().mockResolvedValue({ taskId: "oldest", dismissed: true });
  const acceptTaskSuggestion = vi
    .fn()
    .mockResolvedValue({ taskId: "newest", key: "agent:main:follow-up" });
  const onAccepted = vi.fn();
  const controller = createTuiTaskSuggestionController({
    client: { listTaskSuggestions, dismissTaskSuggestion, acceptTaskSuggestion },
    chatLog: { addSystem: vi.fn() },
    getAgentId: () => "main",
    getSessionKey: () => "agent:main:main",
    openOverlay: (prompt) => {
      prompts.push(prompt);
      return {
        hide: vi.fn(),
        setHidden: vi.fn(),
        isHidden: () => false,
        focus: vi.fn(),
        unfocus: vi.fn(),
        isFocused: () => true,
        getBounds: () => undefined,
      } satisfies OverlayHandle;
    },
    closeOverlay: vi.fn(),
    requestRender: vi.fn(),
    onAccepted,
    createSelector: () => {
      const selector: Selector = { render: () => [], invalidate: () => {} };
      selectors.push(selector);
      return selector;
    },
  });
  return {
    controller,
    prompts,
    selectors,
    dismissTaskSuggestion,
    acceptTaskSuggestion,
    onAccepted,
  };
}

describe("UI-DESKTOP-0164 restored history suggestions", () => {
  it("offers owned history in chronological order and starts the selected follow-up", async () => {
    const harness = historyHarness([
      suggestion("newest", 30),
      suggestion("another agent's history", 0, "other"),
      suggestion("oldest", 10),
    ]);
    await harness.controller.refresh();
    expect(harness.prompts).toHaveLength(1);
    expect(stripAnsi(harness.prompts[0]!.render(80).join("\n"))).toContain(
      "Suggested follow-up: oldest",
    );
    harness.selectors[0]!.onSelect!({ value: "dismiss", label: "Dismiss" });
    await vi.waitFor(() => expect(harness.prompts).toHaveLength(2));
    expect(harness.dismissTaskSuggestion).toHaveBeenCalledExactlyOnceWith("oldest");
    const next = stripAnsi(harness.prompts[1]!.render(80).join("\n"));
    expect(next).toContain("Suggested follow-up: newest");
    expect(next).toContain("Investigate newest from the previous session.");
    const accept = { value: "accept", label: "Start in a new session" };
    harness.selectors[1]!.onSelect!(accept);
    expect(harness.acceptTaskSuggestion).not.toHaveBeenCalled();
    harness.selectors[1]!.onSelect!(accept);
    await vi.waitFor(() =>
      expect(harness.onAccepted).toHaveBeenCalledExactlyOnceWith("agent:main:follow-up"),
    );
    expect(harness.acceptTaskSuggestion).toHaveBeenCalledExactlyOnceWith("newest");
    expect(harness.prompts).toHaveLength(2);
    harness.controller.dispose();
  });
});
