// The Branch window is served from its own local origin. It reads a picture's availability and media ticket from
// this route with fetch and an Authorization header, then loads the picture with the ticket alone.
import fs from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { saveMediaBuffer } from "../media/store.js";
import { handleControlUiAssistantMediaRequest } from "./control-ui.js";
import { makeMockHttpResponse } from "./test-http-response.js";

const AUTH = { auth: { mode: "token" as const, token: "test-token", allowTailscale: false } };
const WINDOW = "http://127.0.0.1:19032";

function request(
  url: string,
  method: string,
  headers: Record<string, string>,
  remoteAddress = "127.0.0.1",
): IncomingMessage {
  return {
    url,
    method,
    headers: { host: "127.0.0.1:19031", ...headers },
    headersDistinct: {},
    socket: { remoteAddress },
  } as unknown as IncomingMessage;
}

async function body(res: ReturnType<typeof makeMockHttpResponse>["res"]): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of res as unknown as AsyncIterable<Buffer>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

describe("assistant media for the Branch window (CORS)", () => {
  it("answers the preflight for the window on this computer, with Authorization allowed", async () => {
    const { res, setHeader } = makeMockHttpResponse();
    const handled = await handleControlUiAssistantMediaRequest(
      request("/__branch__/assistant-media?meta=1&source=x", "OPTIONS", {
        origin: WINDOW,
        "access-control-request-headers": "authorization",
      }),
      res,
      AUTH,
    );
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(204);
    expect(setHeader).toHaveBeenCalledWith("Access-Control-Allow-Origin", WINDOW);
    expect(setHeader).toHaveBeenCalledWith("Access-Control-Allow-Headers", "Authorization");
  });

  it("refuses a page from another computer the gateway doesn't allow", async () => {
    const { res, setHeader } = makeMockHttpResponse();
    await handleControlUiAssistantMediaRequest(
      request(
        "/__branch__/assistant-media?meta=1&source=x",
        "OPTIONS",
        { origin: "https://evil.example" },
        "203.0.113.9",
      ),
      res,
      AUTH,
    );
    expect(res.statusCode).toBe(403);
    expect(setHeader).not.toHaveBeenCalledWith("Access-Control-Allow-Origin", expect.anything());
  });

  it("gives the window a media ticket with a Bearer header, then serves the picture to the ticket alone", async () => {
    const saved = await saveMediaBuffer(
      Buffer.from("png-bytes"),
      "image/png",
      "inbound",
      undefined,
      "shot.png",
    );
    const source = `media://inbound/${saved.id}`;
    try {
      const meta = makeMockHttpResponse();
      await handleControlUiAssistantMediaRequest(
        request(
          `/__branch__/assistant-media?${new URLSearchParams({ meta: "1", source })}`,
          "GET",
          { origin: WINDOW, authorization: "Bearer test-token" },
        ),
        meta.res,
        AUTH,
      );
      expect(meta.res.statusCode).toBe(200);
      expect(meta.setHeader).toHaveBeenCalledWith("Access-Control-Allow-Origin", WINDOW);
      const answer = JSON.parse(await body(meta.res)) as {
        available: boolean;
        mediaTicket?: string;
      };
      expect(answer.available).toBe(true);
      expect(answer.mediaTicket).toMatch(/^v1\./);

      const picture = makeMockHttpResponse();
      await handleControlUiAssistantMediaRequest(
        request(
          `/__branch__/assistant-media?${new URLSearchParams({ source, mediaTicket: answer.mediaTicket! })}`,
          "GET",
          {},
        ),
        picture.res,
        AUTH,
      );
      expect(picture.res.statusCode).toBe(200);
      expect(await body(picture.res)).toBe("png-bytes");
    } finally {
      await fs.rm(saved.path, { force: true });
    }
  });
});
