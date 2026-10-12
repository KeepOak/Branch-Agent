import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDeferred, withTestTimeout } from "../../test/helpers/promise.js";
import { withEnv } from "../test-utils/env.js";
import {
  isFastTestRuntimeEnv,
  isTruthyEnvValue,
  isVitestRuntimeEnv,
  logAcceptedEnvOption,
  normalizeEnv,
  normalizeZaiEnv,
} from "./env.js";

const loggerMocks = vi.hoisted(() => ({
  info: vi.fn(),
}));

vi.mock("../logging/subsystem.js", () => ({
  createSubsystemLogger: () => ({
    info: loggerMocks.info,
  }),
}));

beforeEach(() => {
  loggerMocks.info.mockReset();
});

function waitForNextLog(): Promise<void> {
  const logged = createDeferred();
  loggerMocks.info.mockImplementationOnce(() => logged.resolve());
  return logged.promise;
}

describe("normalizeZaiEnv", () => {
  it("does not override existing ZAI_API_KEY", () => {
    withEnv({ ZAI_API_KEY: "zai-current", Z_AI_API_KEY: "zai-legacy" }, () => {
      normalizeZaiEnv();
      expect(process.env.ZAI_API_KEY).toBe("zai-current");
    });
  });

  it("ignores blank legacy Z_AI_API_KEY values", () => {
    withEnv({ ZAI_API_KEY: "", Z_AI_API_KEY: "   " }, () => {
      normalizeZaiEnv();
      expect(process.env.ZAI_API_KEY).toBe("");
    });
  });

  it("does not copy when legacy Z_AI_API_KEY is unset", () => {
    withEnv({ ZAI_API_KEY: "", Z_AI_API_KEY: undefined }, () => {
      normalizeZaiEnv();
      expect(process.env.ZAI_API_KEY).toBe("");
    });
  });
});

describe("isTruthyEnvValue", () => {
  it("accepts common truthy values", () => {
    expect(isTruthyEnvValue("1")).toBe(true);
    expect(isTruthyEnvValue("true")).toBe(true);
    expect(isTruthyEnvValue(" yes ")).toBe(true);
    expect(isTruthyEnvValue("ON")).toBe(true);
  });

  it("rejects other values", () => {
    expect(isTruthyEnvValue("0")).toBe(false);
    expect(isTruthyEnvValue("false")).toBe(false);
    expect(isTruthyEnvValue("")).toBe(false);
    expect(isTruthyEnvValue(undefined)).toBe(false);
  });
});

describe("isVitestRuntimeEnv", () => {
  it.each([
    { VITEST: "true" },
    { VITEST: "1" },
    { VITEST_POOL_ID: "" },
    { VITEST_WORKER_ID: "0" },
    { NODE_ENV: "test" },
  ])("detects %j and observes subsequent env changes", (marker) => {
    withEnv(
      {
        VITEST: undefined,
        VITEST_POOL_ID: undefined,
        VITEST_WORKER_ID: undefined,
        NODE_ENV: "production",
      },
      () => {
        expect(isVitestRuntimeEnv()).toBe(false);
        expect(isVitestRuntimeEnv(marker)).toBe(true);
        withEnv(marker, () => expect(isVitestRuntimeEnv()).toBe(true));
        expect(isVitestRuntimeEnv()).toBe(false);
      },
    );
  });
});

describe("isFastTestRuntimeEnv", () => {
  it("ignores BRANCH_TEST_FAST outside a test runtime", () => {
    withEnv(
      {
        NODE_ENV: "production",
        VITEST: undefined,
        VITEST_POOL_ID: undefined,
        VITEST_WORKER_ID: undefined,
        BRANCH_TEST_FAST: "1",
      },
      () => {
        expect(isFastTestRuntimeEnv()).toBe(false);
      },
    );
  });

  it("honors BRANCH_TEST_FAST inside a detected test runtime", () => {
    expect(isFastTestRuntimeEnv({ VITEST: "1", BRANCH_TEST_FAST: "1" })).toBe(true);
  });

  it.each([undefined, "0", "true", "1"])(
    "uses the caller's fast flag (%j) when the process supplies the test marker",
    (fastFlag) => {
      withEnv({ VITEST: "true", BRANCH_TEST_FAST: "1" }, () => {
        expect(isFastTestRuntimeEnv({ BRANCH_TEST_FAST: fastFlag })).toBe(fastFlag === "1");
      });
    },
  );
});

describe("logAcceptedEnvOption", () => {
  it("logs accepted env options once with redaction and formatting", async () => {
    const logged = waitForNextLog();

    withEnv(
      {
        VITEST: "",
        NODE_ENV: "development",
        BRANCH_TEST_ENV: "  line one\nline two  ",
      },
      () => {
        logAcceptedEnvOption({
          key: "BRANCH_TEST_ENV",
          description: "test option",
          redact: true,
        });
        logAcceptedEnvOption({
          key: "BRANCH_TEST_ENV",
          description: "test option",
          redact: true,
        });
      },
    );

    await withTestTimeout(logged, 1_000, "redacted accepted env option did not log");
    expect(loggerMocks.info).toHaveBeenCalledTimes(1);
    expect(loggerMocks.info).toHaveBeenCalledWith(
      "env: BRANCH_TEST_ENV=<redacted> (test option)",
    );
  });

  it("skips blank values and test-mode logging", () => {
    withEnv(
      {
        VITEST: "1",
        NODE_ENV: "development",
        BRANCH_BLANK_ENV: "value",
      },
      () => {
        logAcceptedEnvOption({
          key: "BRANCH_BLANK_ENV",
          description: "skipped in vitest",
        });
      },
    );

    withEnv(
      {
        VITEST: "",
        NODE_ENV: "development",
        BRANCH_BLANK_ENV: "   ",
      },
      () => {
        logAcceptedEnvOption({
          key: "BRANCH_BLANK_ENV",
          description: "blank value",
        });
      },
    );

    expect(loggerMocks.info).not.toHaveBeenCalled();
  });

  it("keeps bounded non-secret values UTF-16 well-formed", async () => {
    const logged = waitForNextLog();
    withEnv(
      {
        VITEST: "",
        NODE_ENV: "development",
        BRANCH_UTF16_TEST_ENV: `${"x".repeat(159)}🚀tail`,
      },
      () => {
        logAcceptedEnvOption({
          key: "BRANCH_UTF16_TEST_ENV",
          description: "UTF-16 test",
        });
      },
    );

    await withTestTimeout(logged, 1_000, "UTF-16 accepted env option did not log");
    expect(loggerMocks.info).toHaveBeenCalledTimes(1);
    expect(loggerMocks.info).toHaveBeenCalledWith(
      `env: BRANCH_UTF16_TEST_ENV=${"x".repeat(159)}… (UTF-16 test)`,
    );
  });
});

describe("normalizeEnv", () => {
  it("normalizes the legacy ZAI env alias", () => {
    withEnv({ ZAI_API_KEY: "", Z_AI_API_KEY: "zai-legacy" }, () => {
      normalizeEnv();
      expect(process.env.ZAI_API_KEY).toBe("zai-legacy");
    });
  });
});
