// Always on (Private #454 D): honest /health while an agent database isn't admitting. The probe runs on a loopback
// server; nothing here touches a real gateway.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import type { ResolvedGatewayAuth } from "./auth.js";
import { handleGatewayProbeRequest } from "./server-http-probes.js";
import type { ReadinessChecker } from "./server/readiness.js";

async function probe(pathname: string, getReadiness?: ReadinessChecker) {
  const server = http.createServer((req, res) => {
    void handleGatewayProbeRequest(
      req,
      res,
      pathname,
      { mode: "none" } as ResolvedGatewayAuth,
      [],
      false,
      undefined,
      getReadiness,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}${pathname}`);
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const readiness =
  (agentDatabases: unknown[]): ReadinessChecker =>
  () =>
    ({ ready: agentDatabases.length === 0, failing: [], uptimeMs: 1, agentDatabases }) as ReturnType<ReadinessChecker>;

describe("honest health", () => {
  it("says degraded with the agent and its reason while an agent database is not admitting", async () => {
    const getReadiness = readiness([
      {
        agentId: "trunk-a",
        code: "agent-database-ownership-mismatch",
        embeddedOwnerId: "other",
        paths: ["/state/agents/trunk-a.sqlite"],
        reason: "the database belongs to another install",
        repairHint: "branch doctor --fix",
      },
    ]);
    for (const pathname of ["/health", "/healthz"]) {
      const { status, body } = await probe(pathname, getReadiness);
      // Alive, so a service manager never restarts it, but never OK.
      expect(status).toBe(200);
      expect(body.ok).toBe(false);
      expect(body.status).toBe("degraded");
      expect(String(body.reason)).toContain("trunk-a");
      expect(String(body.reason)).toContain("the database belongs to another install");
    }
  });

  it("counts an agent still being checked as not answering yet", async () => {
    const { body } = await probe(
      "/health",
      readiness([
        {
          agentId: "trunk-b",
          code: "agent-database-inspection-pending",
          paths: [],
          reason: "pending",
          repairHint: "",
        },
      ]),
    );
    expect(body).toMatchObject({ ok: false, status: "degraded" });
    expect(String(body.reason)).toContain("trunk-b (its database is still being checked)");
  });

  it("says degraded while the state database is down", async () => {
    const { body } = await probe("/health", () => ({
      ready: false,
      failing: ["state-database"],
      stateDatabase: { reason: "disk full" },
      uptimeMs: 1,
    }));
    expect(body).toMatchObject({ ok: false, status: "degraded" });
    expect(String(body.reason)).toContain("disk full");
  });

  it("stays OK when every agent is admitted", async () => {
    expect((await probe("/health", readiness([]))).body).toEqual({ ok: true, status: "live" });
    expect((await probe("/health")).body).toEqual({ ok: true, status: "live" });
  });
});
