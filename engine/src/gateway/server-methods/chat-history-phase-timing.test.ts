import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatHistoryPhaseTimer } from "./chat-history-phase-timing.js";

function clock(start = 0) {
  let now = start;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  return {
    advance(ms: number) {
      now += ms;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("chat history phase timer", () => {
  it("logs one breakdown line for a request slower than five seconds", () => {
    const time = clock();
    const log = { warn: vi.fn() };
    const timer = new ChatHistoryPhaseTimer();
    time.advance(1_200);
    timer.mark("lookup");
    time.advance(300);
    timer.mark("resolve");
    time.advance(3_000);
    timer.mark("dbRead");
    time.advance(400);
    timer.mark("projection");
    time.advance(200);
    timer.mark("sessionRows");
    timer.report(log, "chat.history");

    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      "slow chat history request method=chat.history totalMs=5100 lookupMs=1200 resolveMs=300 dbReadMs=3000 projectionMs=400 sessionRowsMs=200 respondMs=0 unattributedMs=0",
    );
  });

  it("logs nothing for a request at or under the five second threshold", () => {
    const time = clock();
    const log = { warn: vi.fn() };
    const timer = new ChatHistoryPhaseTimer();
    time.advance(120);
    timer.mark("lookup");
    time.advance(4_880);
    timer.mark("dbRead");
    time.advance(0);
    timer.report(log, "chat.history");

    expect(log.warn).not.toHaveBeenCalled();
  });

  it("keeps respond time out of the marks around it and reports it on its own", () => {
    const time = clock();
    const log = { warn: vi.fn() };
    const timer = new ChatHistoryPhaseTimer();
    const respond = timer.wrapRespond(
      vi.fn((_ok: boolean, _payload: unknown) => {
        time.advance(2_000);
      }),
    );
    time.advance(1_000);
    timer.mark("dbRead");
    respond(true, { messages: [] });
    time.advance(2_500);
    timer.mark("projection");
    timer.report(log, "chat.history");

    expect(log.warn).toHaveBeenCalledWith(
      "slow chat history request method=chat.history totalMs=5500 lookupMs=0 resolveMs=0 dbReadMs=1000 projectionMs=2500 sessionRowsMs=0 respondMs=2000 unattributedMs=0",
    );
  });

  it("passes the wrapped respond arguments through unchanged", () => {
    clock();
    const timer = new ChatHistoryPhaseTimer();
    const respond = vi.fn();
    timer.wrapRespond(respond)(false, undefined, { code: "INVALID_REQUEST" });
    expect(respond).toHaveBeenCalledWith(false, undefined, { code: "INVALID_REQUEST" });
  });
});
