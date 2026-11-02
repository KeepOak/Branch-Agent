// Dashboard session for clients that reach the Control UI through a network (non-loopback) listener.
// After one valid ?token= or bearer login the browser gets an HttpOnly, SameSite=Strict cookie, the
// token is stripped from the address bar, and later requests work without repeating the token.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ResolvedGatewayAuth } from "./auth.js";

export const CONTROL_UI_SESSION_COOKIE = "branch_dashboard_session";
export const CONTROL_UI_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_SESSIONS = 256;

type Session = { binding: string; expiresAt: number };

const processKey = randomBytes(32);
const sessions = new Map<string, Session>();

/** Ties a session to the current shared secret, so rotating the token or password ends it. */
function credentialBinding(auth: Pick<ResolvedGatewayAuth, "mode" | "token" | "password">): string | undefined {
  const secret = auth.mode === "token" ? auth.token : auth.mode === "password" ? auth.password : undefined;
  if (!secret) {
    return undefined;
  }
  return createHmac("sha256", processKey).update(`${auth.mode}\0${secret}`).digest("hex");
}

function readCookie(req: IncomingMessage, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) {
    return undefined;
  }
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name) {
      return part.slice(index + 1).trim();
    }
  }
  return undefined;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function hasValidControlUiSession(
  req: IncomingMessage,
  auth: Pick<ResolvedGatewayAuth, "mode" | "token" | "password">,
  now = Date.now(),
): boolean {
  const id = readCookie(req, CONTROL_UI_SESSION_COOKIE);
  const binding = credentialBinding(auth);
  if (!id || !binding) {
    return false;
  }
  const session = sessions.get(id);
  if (!session) {
    return false;
  }
  if (session.expiresAt <= now || !safeEqual(session.binding, binding)) {
    sessions.delete(id);
    return false;
  }
  return true;
}

function appendSetCookie(res: ServerResponse, cookie: string): void {
  const existing = res.getHeader("Set-Cookie");
  const list = existing === undefined ? [] : Array.isArray(existing) ? existing : [String(existing)];
  res.setHeader("Set-Cookie", [...list, cookie]);
}

/** Starts a session after a successful login. Returns false when the auth mode has no shared secret. */
export function issueControlUiSession(
  req: IncomingMessage,
  res: ServerResponse,
  auth: Pick<ResolvedGatewayAuth, "mode" | "token" | "password">,
  now = Date.now(),
): boolean {
  const binding = credentialBinding(auth);
  if (!binding) {
    return false;
  }
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) {
      sessions.delete(id);
    }
  }
  while (sessions.size >= MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    sessions.delete(oldest);
  }
  const id = randomBytes(32).toString("base64url");
  sessions.set(id, { binding, expiresAt: now + CONTROL_UI_SESSION_TTL_MS });
  const secure = (req.socket as { encrypted?: boolean }).encrypted === true ? "; Secure" : "";
  appendSetCookie(
    res,
    `${CONTROL_UI_SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(
      CONTROL_UI_SESSION_TTL_MS / 1000,
    )}${secure}`,
  );
  return true;
}

/** The request path and query with any `token` parameter removed, or undefined when there was none. */
export function stripTokenFromRequestUrl(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(rawUrl, "http://localhost");
  } catch {
    return undefined;
  }
  if (!url.searchParams.has("token")) {
    return undefined;
  }
  url.searchParams.delete("token");
  const search = url.searchParams.toString();
  // Collapse leading slashes so the Location header can never become protocol-relative.
  const pathname = `/${url.pathname.replace(/^\/+/, "")}`;
  return `${pathname}${search ? `?${search}` : ""}${url.hash}`;
}

function hasPresentedCredential(req: IncomingMessage): boolean {
  const authorization = req.headers.authorization;
  if (typeof authorization === "string" && /^bearer\s+\S/i.test(authorization)) {
    return true;
  }
  try {
    return Boolean(new URL(req.url ?? "/", "http://localhost").searchParams.get("token")?.trim());
  } catch {
    return false;
  }
}

const UNAUTHORIZED_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in required - Branch</title>
<style>body{font-family:system-ui,sans-serif;max-width:34rem;margin:4rem auto;padding:0 1rem;line-height:1.5;color:#222}code{background:#f2f2f2;padding:.1rem .3rem;border-radius:3px}</style>
</head><body>
<h1>Sign in required</h1>
<p>This Branch dashboard was opened from another device on the network, so it needs the gateway token.</p>
<p>Open the dashboard link that includes <code>?token=</code> once from the computer running Branch. This browser then stays signed in and the token is removed from the address bar.</p>
<p>If you only use Branch on this computer, set <code>gateway.bind</code> to <code>loopback</code>.</p>
</body></html>
`;

export function sendControlUiUnauthorizedPage(res: ServerResponse): void {
  res.statusCode = 401;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("WWW-Authenticate", 'Bearer realm="branch-gateway"');
  res.end(UNAUTHORIZED_PAGE);
}

/**
 * Admits a Control UI request that arrived on a network listener.
 * "continue": serve the request. "handled": a response (401 page, auth failure, or redirect) was sent.
 * `authorize` runs the gateway's own credential check and replies on failure.
 */
export async function admitControlUiNetworkRequest(params: {
  req: IncomingMessage;
  res: ServerResponse;
  auth: Pick<ResolvedGatewayAuth, "mode" | "token" | "password">;
  authorize: () => Promise<boolean>;
}): Promise<"continue" | "handled"> {
  const { req, res, auth } = params;
  const stripped = stripTokenFromRequestUrl(req.url);
  if (hasValidControlUiSession(req, auth)) {
    if (stripped !== undefined && (req.method === "GET" || req.method === "HEAD")) {
      redirect(res, stripped);
      return "handled";
    }
    return "continue";
  }
  const sharedSecretMode = auth.mode === "token" || auth.mode === "password";
  if (sharedSecretMode && !hasPresentedCredential(req)) {
    sendControlUiUnauthorizedPage(res);
    return "handled";
  }
  if (!(await params.authorize())) {
    return "handled";
  }
  issueControlUiSession(req, res, auth);
  if (stripped !== undefined && (req.method === "GET" || req.method === "HEAD")) {
    redirect(res, stripped);
    return "handled";
  }
  return "continue";
}

function redirect(res: ServerResponse, location: string): void {
  res.statusCode = 303;
  res.setHeader("Location", location);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.end();
}

/** Test hook. */
export function resetControlUiSessionsForTest(): void {
  sessions.clear();
}
