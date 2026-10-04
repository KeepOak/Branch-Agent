import { fetchWithSsrFGuard } from "branch/plugin-sdk/ssrf-runtime";
import type { A2aPushNotificationConfig, A2aTaskRecord } from "./protocol.js";

// Ported from the A2A JS SDK's DefaultPushNotificationSender (the request
// handler gemini-cli's a2a-server mounts): per-task ordered delivery, a 5 s
// timeout and the token in `X-A2A-Notification-Token`. A2A 1.0 delivers a
// StreamResponse body and adds the configured `authentication` header.
const A2A_PUSH_TIMEOUT_MS = 5_000;
const A2A_PUSH_TOKEN_HEADER = "X-A2A-Notification-Token";

type A2aPushFetch = typeof fetchWithSsrFGuard;

type A2aPushSenderOptions = {
  fetchGuard?: A2aPushFetch;
  timeoutMs?: number;
  onError?: (error: unknown, config: A2aPushNotificationConfig) => void;
};

export class A2aPushNotificationSender {
  readonly #notificationChain = new Map<string, Promise<void>>();
  readonly #fetchGuard: A2aPushFetch;
  readonly #timeoutMs: number;
  readonly #onError: NonNullable<A2aPushSenderOptions["onError"]>;

  constructor(options: A2aPushSenderOptions = {}) {
    this.#fetchGuard = options.fetchGuard ?? fetchWithSsrFGuard;
    this.#timeoutMs = options.timeoutMs ?? A2A_PUSH_TIMEOUT_MS;
    this.#onError = options.onError ?? (() => {});
  }

  send(task: A2aTaskRecord, configs: readonly A2aPushNotificationConfig[]): Promise<void> {
    if (configs.length === 0) {
      return Promise.resolve();
    }
    // Snapshot the task: later transitions must not rewrite a queued notification.
    const snapshot = structuredClone(task);
    const lastPromise = this.#notificationChain.get(task.id) ?? Promise.resolve();
    const newPromise = lastPromise.then(async () => {
      await Promise.all(
        configs.map(async (config) => {
          try {
            await this.#dispatchNotification(snapshot, config);
          } catch (error) {
            this.#onError(error, config);
          }
        }),
      );
    });
    this.#notificationChain.set(task.id, newPromise);
    void newPromise.finally(() => {
      if (this.#notificationChain.get(task.id) === newPromise) {
        this.#notificationChain.delete(task.id);
      }
    });
    return newPromise;
  }

  async #dispatchNotification(
    task: A2aTaskRecord,
    config: A2aPushNotificationConfig,
  ): Promise<void> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (config.token) {
      headers[A2A_PUSH_TOKEN_HEADER] = config.token;
    }
    if (config.authentication?.scheme) {
      headers.authorization = config.authentication.credentials
        ? `${config.authentication.scheme} ${config.authentication.credentials}`
        : config.authentication.scheme;
    }
    // Push URLs come from peers, so egress stays on the default public-network policy.
    const { response, release } = await this.#fetchGuard({
      url: config.url,
      timeoutMs: this.#timeoutMs,
      auditContext: "a2a.push_notification",
      maxRedirects: 0,
      init: { method: "POST", headers, body: JSON.stringify({ task }) },
    });
    try {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
    } finally {
      await release();
    }
  }
}
