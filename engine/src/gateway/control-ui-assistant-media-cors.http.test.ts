// The Branch window is served from its own local origin. It reads a picture's availability and media ticket from
// this route with fetch and an Authorization header, then loads the picture with the ticket alone. These requests go
// through a real gateway HTTP server, so the route's place in the server's request chain is checked too.
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { installGatewayTestHooks, testState, withGatewayServer } from "./test-helpers.js";

installGatewayTestHooks({ scope: "suite" });

const TOKEN = "test-gateway-token-cors-1234567890";
const WINDOW = "http://127.0.0.1:19032";

async function picture(): Promise<string> {
  const stateDir = process.env.BRANCH_STATE_DIR;
  if (!stateDir) {
    throw new Error("BRANCH_STATE_DIR is required for gateway media fixtures");
  }
  const dir = path.join(stateDir, "media", "assistant-media-cors");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, "shot.png");
  await fs.writeFile(file, "png-bytes");
  return file;
}

describe("assistant media for the Branch window (CORS, real server)", () => {
  it("answers the window's preflight, gives it a ticket with a Bearer header, serves the picture to the ticket alone, and refuses other pages", async () => {
    testState.gatewayAuth = { mode: "token", token: TOKEN };
    const source = await picture();
    await withGatewayServer(async ({ port }) => {
      const route = `http://127.0.0.1:${port}/__branch__/assistant-media`;
      const metaUrl = `${route}?${new URLSearchParams({ meta: "1", source })}`;

      const preflight = await fetch(metaUrl, {
        method: "OPTIONS",
        headers: {
          Origin: WINDOW,
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "authorization",
        },
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("access-control-allow-origin")).toBe(WINDOW);
      expect(preflight.headers.get("access-control-allow-headers")).toBe("Authorization");

      const meta = await fetch(metaUrl, {
        headers: { Origin: WINDOW, Authorization: `Bearer ${TOKEN}` },
      });
      expect(meta.status).toBe(200);
      expect(meta.headers.get("access-control-allow-origin")).toBe(WINDOW);
      const answer = (await meta.json()) as { available?: boolean; mediaTicket?: string };
      expect(answer.available).toBe(true);
      expect(answer.mediaTicket).toMatch(/^v1\./);

      const shown = await fetch(
        `${route}?${new URLSearchParams({ source, mediaTicket: answer.mediaTicket ?? "" })}`,
        {
          headers: { Origin: WINDOW },
        },
      );
      expect(shown.status).toBe(200);
      expect(await shown.text()).toBe("png-bytes");

      // A page the gateway doesn't allow gets no CORS answer (one server start for both: it is the slow part).
      const refused = await fetch(metaUrl, {
        method: "OPTIONS",
        headers: {
          Origin: "https://evil.example",
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "authorization",
        },
      });
      expect(refused.status).toBe(403);
      expect(refused.headers.get("access-control-allow-origin")).toBeNull();
    });
  });
});
