// Written by Branch for atlas OPS-0196 from openclaw/openclaw@57e0aaa1c190f1abe16e597008fbcc14f5e609e3:src/config/env-substitution.ts and config documentation; not copied.
import { expect, it } from "vitest";
import { MissingEnvVarError, resolveConfigEnvVars } from "./env-substitution.js";

it("resolves nested templates and empty-value defaults without mutating authored config", () => {
  const authored = {
    gateway: { auth: { token: "${TOKEN}" } },
    models: [{ endpoint: "https://${HOST:-localhost}:${PORT:-8080}", literal: "$${TOKEN}" }],
    count: 2,
    enabled: true,
  };
  const env = { TOKEN: "fixture-token", HOST: "example.test", PORT: "" };
  expect(resolveConfigEnvVars(authored, env)).toEqual({
    gateway: { auth: { token: "fixture-token" } },
    models: [{ endpoint: "https://example.test:8080", literal: "${TOKEN}" }],
    count: 2,
    enabled: true,
  });
  expect(authored.gateway.auth.token).toBe("${TOKEN}");
  expect(authored.models[0]?.literal).toBe("$${TOKEN}");
  expect(env).toEqual({ TOKEN: "fixture-token", HOST: "example.test", PORT: "" });
});

it("reports missing required variables at the exact nested config path", () => {
  try {
    resolveConfigEnvVars({ models: [{ apiKey: "${REQUIRED}" }] }, {});
    expect.fail("a missing required variable must throw");
  } catch (error) {
    expect(error).toBeInstanceOf(MissingEnvVarError);
    expect(error).toMatchObject({ varName: "REQUIRED", configPath: "models[0].apiKey" });
  }
});
