// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Skills } from "./skills";
import type { ToolsCtx } from "./tools";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; vi.restoreAllMocks(); });

const mockEngine = {
  call: vi.fn(),
  resource: vi.fn(),
  request: vi.fn(),
};

const createMockCtx = (): ToolsCtx => ({
  engine: mockEngine as never,
  skills: {
    data: null,
    loading: false,
    error: null,
    reload: vi.fn(),
  },
  level: "advanced",
  whose: null,
});

describe("Skills Remove button", () => {
  it("calls skills.library.mutate with remove action after confirmation for library skill", async () => {
    const librarySkill = {
      skillKey: "test-skill",
      name: "Test Skill",
      description: "A test skill",
      bundled: false,
      source: null,
      clawhub: true,
      disabled: false,
      eligible: true,
      missing: {},
      install: [],
      always: false,
      userInvocable: true,
      filePath: "/path/to/skill",
      modelVisible: true,
      blockedByAgentFilter: false,
    };

    const libraryEntry = {
      skillId: "skill-id-123",
      slug: "test-skill",
      name: "Test Skill",
      revision: "abc123def456",
      enabled: true,
    };

    const skillsData = { skills: [librarySkill] };
    const libraryData = { entries: [libraryEntry] };

    mockEngine.resource.mockImplementation((method: string) => {
      if (method === "skills.library.list") {
        return { data: libraryData, loading: false, error: null, reload: vi.fn() };
      }
      if (method === "skills.proposals.list") {
        return { data: { proposals: [] }, loading: false, error: null, reload: vi.fn() };
      }
      return { data: null, loading: false, error: null, reload: vi.fn() };
    });

    mockEngine.request.mockImplementation((method: string) => {
      if (method === "skills.library.list") {
        return Promise.resolve(libraryData);
      }
      if (method === "skills.proposals.list") {
        return Promise.resolve({ proposals: [] });
      }
      if (method === "skills.library.mutate") {
        return Promise.resolve({});
      }
      return Promise.resolve(null);
    });

    mockEngine.call.mockResolvedValue([true, {}]);

    const ctx = createMockCtx();
    ctx.skills.data = skillsData;
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root!.render(<Skills ctx={ctx} />);
    });

    const skillRow = Array.from(document.querySelectorAll('.t9-item')).find(
      el => el.textContent?.includes("Test Skill")
    ) as HTMLButtonElement;
    expect(skillRow).not.toBeNull();

    await act(async () => {
      skillRow.click();
    });

    const detail = document.querySelector('[data-testid="skill-detail"]');
    expect(detail).not.toBeNull();

    const removeButton = Array.from(detail!.querySelectorAll('button')).find(
      el => el.textContent === "Remove" && el.classList.contains("btn")
    ) as HTMLButtonElement;
    expect(removeButton).not.toBeNull();
    expect(removeButton.disabled).toBe(false);

    await act(async () => {
      removeButton.click();
    });

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("Remove Test Skill?");
    expect(dialog?.textContent).toContain("This removes Test Skill from your library");

    const confirmButton = Array.from(document.querySelectorAll('button.btn.bad')).find(
      el => el.textContent === "Remove"
    ) as HTMLButtonElement;
    expect(confirmButton).not.toBeNull();

    await act(async () => {
      confirmButton.click();
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    expect(mockEngine.request).toHaveBeenCalledWith(
      "skills.library.mutate",
      {
        skillId: "skill-id-123",
        expectedRevision: "abc123def456",
        action: "remove",
      },
    );
  });

  it("shows Remove disabled with reason for built-in skill", async () => {
    const builtInSkill = {
      skillKey: "builtin-skill",
      name: "Built-in Skill",
      description: "A built-in skill",
      bundled: true,
      source: null,
      clawhub: false,
      disabled: false,
      eligible: true,
      missing: {},
      install: [],
      always: false,
      userInvocable: true,
      filePath: "/path/to/builtin",
      modelVisible: true,
      blockedByAgentFilter: false,
    };

    const skillsData = { skills: [builtInSkill] };
    const libraryData = { entries: [] };

    mockEngine.resource.mockImplementation((method: string) => {
      if (method === "skills.library.list") {
        return { data: libraryData, loading: false, error: null, reload: vi.fn() };
      }
      if (method === "skills.proposals.list") {
        return { data: { proposals: [] }, loading: false, error: null, reload: vi.fn() };
      }
      return { data: null, loading: false, error: null, reload: vi.fn() };
    });

    mockEngine.request.mockImplementation((method: string) => {
      if (method === "skills.library.list") {
        return Promise.resolve(libraryData);
      }
      if (method === "skills.proposals.list") {
        return Promise.resolve({ proposals: [] });
      }
      return Promise.resolve(null);
    });

    const ctx = createMockCtx();
    ctx.skills.data = skillsData;
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root!.render(<Skills ctx={ctx} />);
    });

    const skillRow = Array.from(document.querySelectorAll('.t9-item')).find(
      el => el.textContent?.includes("Built-in Skill")
    ) as HTMLButtonElement;
    expect(skillRow).not.toBeNull();

    await act(async () => {
      skillRow.click();
    });

    const detail = document.querySelector('[data-testid="skill-detail"]');
    expect(detail).not.toBeNull();

    const removeButton = Array.from(detail!.querySelectorAll('button')).find(
      el => el.textContent === "Remove"
    ) as HTMLButtonElement;
    expect(removeButton).not.toBeNull();
    expect(removeButton.disabled).toBe(true);
    expect(removeButton.getAttribute("title")).toBe(
      "Built-in skills can't be removed; turn it off instead."
    );
  });

  it("shows engine error when remove fails", async () => {
    const librarySkill = {
      skillKey: "error-skill",
      name: "Error Skill",
      description: "A skill that will error",
      bundled: false,
      source: null,
      clawhub: true,
      disabled: false,
      eligible: true,
      missing: {},
      install: [],
      always: false,
      userInvocable: true,
      filePath: "/path/to/skill",
      modelVisible: true,
      blockedByAgentFilter: false,
    };

    const libraryEntry = {
      skillId: "skill-id-error",
      slug: "error-skill",
      name: "Error Skill",
      revision: "def456abc789",
      enabled: true,
    };

    const skillsData = { skills: [librarySkill] };
    const libraryData = { entries: [libraryEntry] };

    mockEngine.resource.mockImplementation((method: string) => {
      if (method === "skills.library.list") {
        return { data: libraryData, loading: false, error: null, reload: vi.fn() };
      }
      if (method === "skills.proposals.list") {
        return { data: { proposals: [] }, loading: false, error: null, reload: vi.fn() };
      }
      return { data: null, loading: false, error: null, reload: vi.fn() };
    });

    mockEngine.request.mockImplementation((method: string) => {
      if (method === "skills.library.list") {
        return Promise.resolve(libraryData);
      }
      if (method === "skills.proposals.list") {
        return Promise.resolve({ proposals: [] });
      }
      if (method === "skills.library.mutate") {
        return Promise.reject(new Error("Failed to remove skill"));
      }
      return Promise.resolve(null);
    });

    mockEngine.call.mockResolvedValue([false, { message: "Failed to remove skill" }]);

    const ctx = createMockCtx();
    ctx.skills.data = skillsData;
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root!.render(<Skills ctx={ctx} />);
    });

    const skillRow = Array.from(document.querySelectorAll('.t9-item')).find(
      el => el.textContent?.includes("Error Skill")
    ) as HTMLButtonElement;
    expect(skillRow).not.toBeNull();

    await act(async () => {
      skillRow.click();
    });

    const detail = document.querySelector('[data-testid="skill-detail"]');
    const removeButton = Array.from(detail!.querySelectorAll('button')).find(
      el => el.textContent === "Remove" && el.classList.contains("btn")
    ) as HTMLButtonElement;

    await act(async () => {
      removeButton.click();
    });

    const confirmButton = Array.from(document.querySelectorAll('button.btn.bad')).find(
      el => el.textContent === "Remove"
    ) as HTMLButtonElement;

    await act(async () => {
      confirmButton.click();
      await new Promise(resolve => setTimeout(resolve, 200));
    });

    const errorElement = document.querySelector('[role="alert"]');
    expect(errorElement).not.toBeNull();
    expect(errorElement?.textContent).toBe("Failed to remove skill");
  });
});


