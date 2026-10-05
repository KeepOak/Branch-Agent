import { expect, it, vi } from "vitest";
import { agentsHandlers } from "./agents.js";

it.each([
  { config: { agents: { entries: { main: {} } } }, defaultId: "main" },
  { config: { agents: { defaultId: "tk", entries: { main: {}, tk: {} } } }, defaultId: "tk" },
])("refuses to delete effective default $defaultId before any cleanup", async ({ config, defaultId }) => {
  const respond = vi.fn();
  await agentsHandlers["agents.delete"]({
    params: { agentId: defaultId },
    respond,
    context: { getRuntimeConfig: () => config },
  } as never);
  expect(respond).toHaveBeenCalledWith(false, undefined, expect.objectContaining({
    message: expect.stringContaining("cannot be deleted"),
  }));
});
