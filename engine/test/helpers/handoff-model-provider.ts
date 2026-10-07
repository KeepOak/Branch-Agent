// A local OpenAI Responses provider for engine handoff tests. A turn whose prompt carries HOLD_RUN waits until the
// test releases it, so a run can be in flight across a handoff; every other request answers at once. Each reply
// names the marker of the turn it answers (MARK_<word>), so a transcript shows which turn ran where and in what order.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { writeOpenAiResponsesText } from "./openai-responses-sse.js";

export const HOLD_MARKER = "HOLD_RUN";

type Held = { marker: string; release: () => void };

export type HandoffModelProvider = {
  baseUrl: string;
  /** Markers of the turns the provider has answered, in order (held ones once released). */
  readonly answered: string[];
  /** Resolves once a turn carrying HOLD_RUN with `marker` is being held. */
  waitForHeld(marker: string, timeoutMs: number): Promise<void>;
  release(marker: string): void;
  close(): Promise<void>;
};

function readMarker(text: string): string {
  return /MARK_([A-Za-z0-9]+)/.exec(text)?.[1] ?? "none";
}

/** A turn request carries tools; title and other housekeeping requests do not. */
function isTurnRequest(body: Record<string, unknown>): boolean {
  return Array.isArray(body.tools) && body.tools.length > 0;
}

export async function startHandoffModelProvider(): Promise<HandoffModelProvider> {
  const held = new Map<string, Held>();
  const heldWaiters = new Map<string, Array<() => void>>();
  const answered: string[] = [];
  const responseMarkers = new Map<string, string>();
  let ordinal = 0;

  const reply = (response: ServerResponse, body: Record<string, unknown>, text: string) => {
    ordinal += 1;
    const responseId = `resp_${ordinal}`;
    if (body.stream === false) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: responseId,
          object: "response",
          status: "completed",
          output: [
            {
              type: "message",
              id: `msg_${ordinal}`,
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text, annotations: [] }],
            },
          ],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        }),
      );
      return responseId;
    }
    writeOpenAiResponsesText(response, {
      text,
      messageId: `msg_${ordinal}`,
      responseId,
    });
    return responseId;
  };

  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString("utf8");
    const body = JSON.parse(text) as Record<string, unknown>;
    if (request.url !== "/v1/responses" || !isTurnRequest(body)) {
      reply(response, body, "Handoff test");
      return;
    }
    // A continuation can carry tool output as its newest user item. Keep the most recent marked user input, or the
    // marker of the previous Responses result when only incremental input is sent.
    const input = Array.isArray(body.input) ? body.input : [];
    const markedUser = [...input]
      .toReversed()
      .filter((item) => (item as { role?: unknown })?.role === "user")
      .map((item) => readMarker(JSON.stringify(item)))
      .find((candidate) => candidate !== "none");
    const previousId =
      typeof body.previous_response_id === "string" ? body.previous_response_id : undefined;
    const marker = markedUser ?? responseMarkers.get(previousId ?? "") ?? "none";
    const prompt = JSON.stringify(input.at(-1) ?? body.input ?? "");
    if (marker === "none") {
      console.info(
        `[handoff-provider] unmarked turn previous=${previousId ?? "none"} roles=${JSON.stringify(input.map((item) => (item as { role?: unknown })?.role ?? null))}`,
      );
    }
    if (prompt.includes(HOLD_MARKER) && !held.has(marker)) {
      await new Promise<void>((release) => {
        held.set(marker, { marker, release });
        for (const wake of heldWaiters.get(marker) ?? []) wake();
        heldWaiters.delete(marker);
      });
    }
    answered.push(marker);
    responseMarkers.set(reply(response, body, `REPLY_${marker}`), marker);
  };

  const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      if (!response.headersSent) response.writeHead(500);
      response.end(String(error));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    answered,
    waitForHeld(marker, timeoutMs) {
      if (held.has(marker)) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`the model never received the held turn MARK_${marker}`)),
          timeoutMs,
        );
        const waiters = heldWaiters.get(marker) ?? [];
        waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
        heldWaiters.set(marker, waiters);
      });
    },
    release(marker) {
      held.get(marker)?.release();
    },
    async close() {
      for (const entry of held.values()) entry.release();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
