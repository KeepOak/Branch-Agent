import { afterEach, describe, expect, it } from "vitest";
import { LockdownError } from "../../config/lockdown.js";
import {
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../../config/runtime-snapshot.js";
import { executePreparedCliRun } from "./execute.js";
import type { PreparedCliRunContext } from "./types.js";

describe("CLI model runs under Lockdown", () => {
  afterEach(() => clearRuntimeConfigSnapshot());

  // Side chat (sessions.companion.ask) and /btw call executePreparedCliRun directly, not runCliAgent.
  it("refuses before reading the prepared run, so nothing is spawned or spent", async () => {
    setRuntimeConfigSnapshot({ security: { lockdown: true } });
    const prepared = new Proxy(
      {},
      {
        get: () => {
          throw new Error("the prepared run was read");
        },
      },
    ) as PreparedCliRunContext;
    await expect(executePreparedCliRun(prepared)).rejects.toBeInstanceOf(LockdownError);
  });
});
