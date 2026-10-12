import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createDeferredCore } from "../shared/deferred.js";
import { createChannelMcpRuntime } from "./channel-server-runtime.js";

type BranchMcpServeOptions = NonNullable<Parameters<typeof createChannelMcpRuntime>[0]>;
type BranchMcpServer = Awaited<ReturnType<typeof createChannelMcpRuntime>>["server"];

const INITIALIZE_GRACE_MS = 2_000;

/** Resolves when the client has finished the MCP handshake, or after `ms` if it never says so. */
export function untilInitialized(server: BranchMcpServer, ms: number): Promise<void> {
  const previous = server.server.oninitialized;
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    timer.unref?.();
    function done() {
      clearTimeout(timer);
      server.server.oninitialized = previous;
      resolve();
    }
    server.server.oninitialized = () => {
      previous?.();
      done();
    };
  });
}

/** Serve the channel MCP server over stdio until transport or process shutdown. */
export async function serveBranchChannelMcp(opts: BranchMcpServeOptions = {}): Promise<void> {
  const { server, start, close } = await createChannelMcpRuntime(opts);
  const transport = new StdioServerTransport();

  let shuttingDown = false;
  let closePromise: Promise<void> | undefined;
  const { promise: closed, resolve: resolveClosed } = createDeferredCore();

  const shutdown = () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    process.stdin.off("end", shutdown);
    process.stdin.off("close", shutdown);
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
    // Assign before cleanup starts so SDK transport-close reentry observes the same owner promise.
    closePromise = Promise.resolve().then(close);
    void closePromise.then(resolveClosed, resolveClosed);
  };

  transport["onclose"] = shutdown;
  process.stdin.once("end", shutdown);
  process.stdin.once("close", shutdown);
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  try {
    await server.connect(transport);
    // Answer the client's initialize before loading the Gateway client: that load (device identity, state
    // owner checks) blocks the event loop for seconds, and MCP clients give a server about 30 s to answer.
    // Tools wait for the Gateway anyway, so nothing is lost by starting it a moment later.
    await untilInitialized(server, INITIALIZE_GRACE_MS);
    await start();
    await closed;
    await closePromise;
  } finally {
    shutdown();
    await closed;
    await closePromise;
  }
}
