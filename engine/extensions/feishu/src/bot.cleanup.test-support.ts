import { closeBranchStateDatabaseAsync } from "branch/plugin-sdk/sqlite-runtime-testing";
import { afterAll, afterEach, vi } from "vitest";

afterEach(async () => {
  await closeBranchStateDatabaseAsync();
});

afterAll(() => {
  vi.doUnmock("./reply-dispatcher.js");
  vi.doUnmock("./reasoning-preview.js");
  vi.doUnmock("./send.js");
  vi.doUnmock("./media.js");
  vi.doUnmock("branch/plugin-sdk/media-runtime");
  vi.doUnmock("./client.js");
  vi.doUnmock("./bot-name.js");
  vi.doUnmock("branch/plugin-sdk/conversation-runtime");
  vi.resetModules();
});
