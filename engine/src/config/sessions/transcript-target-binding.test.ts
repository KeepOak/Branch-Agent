import path from "node:path";
import { expect, it } from "vitest";
import { captureSessionTranscriptStorageEnvironment } from "./transcript-target-binding.js";

it.each([
  ["linux", "BRANCH_STATE_DIR"],
  ["win32", "BRANCH_STATE_DIR"],
  ["win32", "branch_state_dir"],
] as const)("captures storage facts without reading unrelated values (%s, %s)", (platform, key) => {
  const stateDir = path.resolve("synthetic-state");
  const source: NodeJS.ProcessEnv = {
    branch_state_dir: path.resolve("decoy-state"),
    [key]: stateDir,
    Branch_Supervisor_Mode: "external",
  };
  Object.defineProperty(source, "UNRELATED_VALUE", {
    enumerable: true,
    get() {
      throw new Error("Storage capture must not read unrelated environment values");
    },
  });
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { value: platform });
  try {
    expect(structuredClone(captureSessionTranscriptStorageEnvironment(source))).toEqual({
      BRANCH_STATE_DIR: stateDir,
      ...(platform === "win32" ? { BRANCH_SUPERVISOR_MODE: "external" } : {}),
    });
  } finally {
    Object.defineProperty(process, "platform", descriptor);
  }
});
