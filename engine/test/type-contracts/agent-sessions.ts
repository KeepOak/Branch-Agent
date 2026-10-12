import type { SessionManager } from "branch/plugin-sdk/agent-sessions";
import { expectTypeOf } from "vitest";

// agent sessions SDK
// keeps SessionManager.persist public
expectTypeOf<SessionManager["persist"]>().toBeFunction();

// keeps tool-result preparation internal
expectTypeOf<SessionManager>().not.toHaveProperty("prepareModelVisibleToolText");
expectTypeOf<typeof import("branch/plugin-sdk/agent-sessions")>().not.toHaveProperty(
  "prepareSessionToolResult",
);
expectTypeOf<typeof import("branch/plugin-sdk/agent-sessions")>().not.toHaveProperty(
  "setSessionToolTextPreparer",
);
