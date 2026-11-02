import { once } from "node:events";
import { createServer, request, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  admitControlUiNetworkRequest,
  CONTROL_UI_SESSION_COOKIE,
  resetControlUiSessionsForTest,
  stripTokenFromRequestUrl,
} from "./control-ui-network-session.js";

const TOKEN = "synthetic-dashboard-token";
let auth = { mode: "token" as const, token: TOKEN };

// Stand-in for the gateway credential check: accepts the bearer or ?token= value, else replies 401 JSON.
async function authorize(req: IncomingMessage, res: import("node:http").ServerResponse) {
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "")?.[1];
  const query = new URL(req.url ?? "/", "http://localhost").searchParams.get("token");
  if ((bearer ?? query) === auth.token) {
    return true;
  }
  res.statusCode = 401;
  res.setHeader("Content-Type", "application/json");
  res.end('{"error":"unauthorized"}');
  return false;
}

type Reply = { status: number; headers: IncomingMessage["headers"]; body: string };

function get(port: number, path: string, headers: Record<string, string> = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

function sessionCookie(reply: Reply): string {
  const cookie = (reply.headers["set-cookie"] ?? []).find((value) =>
    value.startsWith(`${CONTROL_UI_SESSION_COOKIE}=`),
  );
  expect(cookie).toBeDefined();
  return cookie!.split(";")[0]!;
}

describe("Control UI network session (HTTP)", () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    server = createServer(async (req, res) => {
      const admission = await admitControlUiNetworkRequest({
        req,
        res,
        auth,
        authorize: () => authorize(req, res),
      });
      if (admission === "continue") {
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/html");
        res.end("<!doctype html><title>dashboard</title>");
      }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    server.close();
    await once(server, "close");
  });

  beforeEach(() => {
    auth = { mode: "token", token: TOKEN };
    resetControlUiSessionsForTest();
  });

  it("returns a clear 401 HTML page without a token", async () => {
    const reply = await get(port, "/");
    expect(reply.status).toBe(401);
    expect(reply.headers["content-type"]).toContain("text/html");
    expect(reply.body).toContain("Sign in required");
    expect(reply.headers["set-cookie"]).toBeUndefined();
  });

  it("rejects a wrong token", async () => {
    const reply = await get(port, "/?token=wrong");
    expect(reply.status).toBe(401);
    expect(reply.headers["set-cookie"]).toBeUndefined();
  });

  it("redirects a ?token= login to the same path without the token and sets a strict session cookie", async () => {
    const reply = await get(port, `/chat/thread?view=1&token=${TOKEN}`);
    expect(reply.status).toBe(303);
    expect(reply.headers.location).toBe("/chat/thread?view=1");
    const raw = (reply.headers["set-cookie"] ?? []).join("\n");
    expect(raw).toContain("HttpOnly");
    expect(raw).toContain("SameSite=Strict");
    expect(raw).toContain("Path=/");

    const followUp = await get(port, "/chat/thread?view=1", { cookie: sessionCookie(reply) });
    expect(followUp.status).toBe(200);
  });

  it("serves 200 with a bearer token and issues the cookie", async () => {
    const reply = await get(port, "/", { authorization: `Bearer ${TOKEN}` });
    expect(reply.status).toBe(200);
    const next = await get(port, "/settings", { cookie: sessionCookie(reply) });
    expect(next.status).toBe(200);
  });

  it("ignores an unknown cookie and ends sessions when the token rotates", async () => {
    expect((await get(port, "/", { cookie: `${CONTROL_UI_SESSION_COOKIE}=forged` })).status).toBe(401);
    const login = await get(port, "/", { authorization: `Bearer ${TOKEN}` });
    const cookie = sessionCookie(login);
    auth = { mode: "token", token: "rotated-synthetic-token" };
    expect((await get(port, "/", { cookie })).status).toBe(401);
  });
});

describe("stripTokenFromRequestUrl", () => {
  it("removes only the token and keeps the path", () => {
    expect(stripTokenFromRequestUrl("/a?token=x&b=2")).toBe("/a?b=2");
    expect(stripTokenFromRequestUrl("/?token=x")).toBe("/");
    expect(stripTokenFromRequestUrl("/a?b=2")).toBeUndefined();
  });

  it("never produces a protocol-relative redirect", () => {
    expect(stripTokenFromRequestUrl("//evil.example/?token=x")).toBe("/");
  });
});
