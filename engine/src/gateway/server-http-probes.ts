import type { IncomingMessage, ServerResponse } from "node:http";
import { resolveRuntimeServiceVersion } from "../version.js";
import type { AuthRateLimiter } from "./auth-rate-limit.js";
import { authorizeHttpGatewayConnect } from "./auth.js";
import type { ResolvedGatewayAuth } from "./auth.js";
import { classifyGatewayProbePath } from "./gateway-http-route-contracts.js";
import { readPreparedGatewayIngressAttribution } from "./ingress-attribution.js";
import { isLocalDirectRequest } from "./net.js";
import { getHttpAuthUtilsModule } from "./server-http-modules.js";
import type { ReadinessChecker, StartupChecker, StartupResult } from "./server/readiness.js";

async function shouldIncludeGatewayProbeDetails(params: {
  req: IncomingMessage;
  resolvedAuth: ResolvedGatewayAuth;
  trustedProxies: string[];
  allowRealIpFallback: boolean;
  rateLimiter?: AuthRateLimiter;
}): Promise<boolean> {
  if (
    readPreparedGatewayIngressAttribution(params.req)?.kind === "direct-local" ||
    (!readPreparedGatewayIngressAttribution(params.req) && isLocalDirectRequest(params.req))
  ) {
    return true;
  }
  if (params.resolvedAuth.mode === "none") {
    return false;
  }
  const { getBearerToken, resolveHttpBrowserOriginPolicy } = await getHttpAuthUtilsModule();
  const bearerToken = getBearerToken(params.req);
  return (
    await authorizeHttpGatewayConnect({
      auth: params.resolvedAuth,
      connectAuth: bearerToken ? { token: bearerToken, password: bearerToken } : null,
      req: params.req,
      trustedProxies: params.trustedProxies,
      allowRealIpFallback: params.allowRealIpFallback,
      rateLimiter: params.rateLimiter,
      browserOriginPolicy: resolveHttpBrowserOriginPolicy(params.req),
    })
  ).ok;
}

/**
 * Honest health (Private #454 D): why the gateway can't answer for an agent, or undefined when it can. The liveness
 * probes keep HTTP 200 (the process is alive, so a supervisor must not restart it), but their body says `degraded`
 * with this reason instead of OK while an agent database is not admitting work (or the state database is down).
 * `summary` is for callers that don't get details; `detail` names the agents and their reasons.
 */
export function readGatewayDegradedReason(
  getReadiness?: ReadinessChecker,
): { summary: string; detail: string } | undefined {
  if (!getReadiness) {
    return undefined;
  }
  let result: ReturnType<ReadinessChecker>;
  try {
    result = getReadiness();
  } catch {
    return undefined;
  }
  if (result.stateDatabase) {
    const summary = "the state database is not answering";
    return { summary, detail: `${summary}: ${result.stateDatabase.reason}` };
  }
  const refused = result.agentDatabases ?? [];
  if (refused.length === 0) {
    return undefined;
  }
  const summary =
    refused.length === 1
      ? "an agent's database is not admitting work"
      : `${refused.length} agents' databases are not admitting work`;
  const each = refused.map((refusal) =>
    refusal.code === "agent-database-inspection-pending"
      ? `${refusal.agentId} (its database is still being checked)`
      : `${refusal.agentId} (${refusal.reason})`,
  );
  return { summary, detail: `${summary}: ${each.join("; ")}` };
}

function startupProbeBody(result: StartupResult, includeDetails: boolean): string {
  if (!includeDetails) {
    return JSON.stringify({ ok: result.ok, status: result.status });
  }
  return JSON.stringify({
    ok: result.ok,
    status: result.status,
    version: resolveRuntimeServiceVersion(process.env),
    uptimeMs: result.uptimeMs,
    ...(result.status === "starting" ? { pendingReason: result.pendingReason } : {}),
  });
}

/** Handles live/ready/startup probe endpoints before normal gateway routing. */
export async function handleGatewayProbeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  requestPath: string,
  resolvedAuth: ResolvedGatewayAuth,
  trustedProxies: string[],
  allowRealIpFallback: boolean,
  rateLimiter?: AuthRateLimiter,
  getReadiness?: ReadinessChecker,
  getStartup?: StartupChecker,
): Promise<boolean> {
  const status = classifyGatewayProbePath(requestPath);
  if (status === "namespace" || status === "outside") {
    return false;
  }

  const method = (req.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, HEAD");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Method Not Allowed");
    return true;
  }

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  let statusCode: number;
  let body: string;
  if (status === "ready" && getReadiness) {
    // Readiness details expose subsystem names, so only local direct or authenticated
    // callers receive them; unauthenticated remote probes get the aggregate boolean.
    const includeDetails = await shouldIncludeGatewayProbeDetails({
      req,
      resolvedAuth,
      trustedProxies,
      allowRealIpFallback,
      rateLimiter,
    });
    try {
      const result = getReadiness();
      statusCode = result.ready ? 200 : 503;
      body = JSON.stringify(includeDetails ? result : { ready: result.ready });
    } catch {
      statusCode = 503;
      body = JSON.stringify(
        includeDetails ? { ready: false, failing: ["internal"], uptimeMs: 0 } : { ready: false },
      );
    }
  } else if (status === "startup") {
    const includeDetails = await shouldIncludeGatewayProbeDetails({
      req,
      resolvedAuth,
      trustedProxies,
      allowRealIpFallback,
      rateLimiter,
    });
    try {
      const result = getStartup?.() ?? { ok: true, status: "started", uptimeMs: 0 };
      statusCode = result.ok ? 200 : 503;
      body = startupProbeBody(result, includeDetails);
    } catch {
      const result: StartupResult = {
        ok: false,
        status: "starting",
        uptimeMs: 0,
        pendingReason: "internal",
      };
      statusCode = 503;
      body = startupProbeBody(result, includeDetails);
    }
  } else {
    statusCode = 200;
    const degraded = status === "live" ? readGatewayDegradedReason(getReadiness) : undefined;
    if (degraded) {
      // Agent names are details: only local direct or authenticated callers get them.
      const includeDetails = await shouldIncludeGatewayProbeDetails({
        req,
        resolvedAuth,
        trustedProxies,
        allowRealIpFallback,
        rateLimiter,
      });
      body = JSON.stringify({
        ok: false,
        status: "degraded",
        reason: includeDetails ? degraded.detail : degraded.summary,
      });
    } else {
      body = JSON.stringify({ ok: true, status });
    }
  }
  res.statusCode = statusCode;
  // Node suppresses the HEAD body but never synthesizes Content-Length; set it
  // explicitly so probes keep GET/HEAD header parity (RFC 9110 §8.6).
  res.setHeader("Content-Length", String(Buffer.byteLength(body)));
  res.end(method === "HEAD" ? undefined : body);
  return true;
}
