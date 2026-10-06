/** Send-first transports for services without a bundled inbound channel.
 * Wire formats follow the providers' published send-message APIs. */
export type LongtailProvider = "rocket-chat" | "zulip" | "webex" | "gotify" | "pushover" | "ntfy";

export type LongtailAccount = {
  accountId: string;
  enabled: boolean;
  provider: LongtailProvider | "";
  baseUrl: string;
  token: string;
  userId: string;
  email: string;
  defaultTo: string;
  title: string;
};

type SendOptions = {
  account: LongtailAccount;
  to: string;
  text: string;
  onPlatformSendDispatch?: () => void | Promise<void>;
  fetcher?: typeof fetch;
};

function endpoint(baseUrl: string, path: string): string {
  const base = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  if (base.protocol !== "https:" && base.protocol !== "http:") {
    throw new Error("Long-tail account baseUrl must use HTTP or HTTPS");
  }
  return new URL(path.replace(/^\//, ""), base).toString();
}

function required(value: string, label: string): string {
  if (!value.trim()) {
    throw new Error(`Long-tail account requires ${label}`);
  }
  return value.trim();
}

async function request(
  url: string,
  init: RequestInit,
  options: SendOptions,
): Promise<Record<string, unknown>> {
  await options.onPlatformSendDispatch?.();
  const response = await (options.fetcher ?? fetch)(url, {
    ...init,
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.text();
  let parsed: Record<string, unknown> = {};
  if (body) {
    try {
      const value: unknown = JSON.parse(body);
      if (value && typeof value === "object" && !Array.isArray(value)) {
        parsed = value as Record<string, unknown>;
      }
    } catch {
      // ntfy may be configured to return a non-JSON acknowledgment.
    }
  }
  if (!response.ok) {
    throw new Error(`Long-tail ${options.account.provider} send failed (HTTP ${response.status})`);
  }
  return parsed;
}

function messageId(result: Record<string, unknown>): string {
  const value = result.id ?? result.message_id;
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

/** Returns a platform-assigned ID only; never fabricates one from the target. */
export async function sendLongtailText(options: SendOptions): Promise<string> {
  const { account, text } = options;
  const to = required(options.to || account.defaultTo, "a target");
  switch (account.provider) {
    case "rocket-chat": {
      const token = required(account.token, "token");
      const result = await request(
        endpoint(required(account.baseUrl, "baseUrl"), "api/v1/chat.postMessage"),
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-Auth-Token": token,
            "X-User-Id": required(account.userId, "userId"),
          },
          body: JSON.stringify({ roomId: to, text }),
        },
        options,
      );
      if (result.success !== true) {
        throw new Error("Rocket.Chat did not acknowledge the message");
      }
      const message = result.message;
      return message && typeof message === "object" && !Array.isArray(message)
        ? messageId({ id: (message as Record<string, unknown>)._id })
        : "";
    }
    case "zulip": {
      const token = required(account.token, "token");
      const [kind, destination, ...topicParts] = to.split("/");
      if (!destination || (kind !== "stream" && kind !== "dm")) {
        throw new Error("Zulip target must be stream/<name>/<topic> or dm/<email-or-id>");
      }
      const form = new URLSearchParams({ content: text });
      if (kind === "stream") {
        const topic = topicParts.join("/");
        if (!topic) {
          throw new Error("Zulip stream target requires a topic");
        }
        form.set("type", "stream");
        form.set("to", destination);
        form.set("topic", topic);
      } else {
        form.set("type", "direct");
        form.set("to", JSON.stringify([/^\d+$/.test(destination) ? Number(destination) : destination]));
      }
      const result = await request(
        endpoint(required(account.baseUrl, "baseUrl"), "api/v1/messages"),
        {
          method: "POST",
          headers: {
            authorization: `Basic ${Buffer.from(`${required(account.email, "email")}:${token}`).toString("base64")}`,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: form,
        },
        options,
      );
      if (result.result !== "success") {
        throw new Error("Zulip did not acknowledge the message");
      }
      return messageId(result);
    }
    case "webex": {
      const token = required(account.token, "token");
      const [kind, ...parts] = to.split("/");
      const destination = parts.join("/");
      if (!destination || (kind !== "room" && kind !== "person")) {
        throw new Error("Webex target must be room/<id> or person/<email>");
      }
      const result = await request(
        endpoint(account.baseUrl || "https://webexapis.com/", "v1/messages"),
        {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ [kind === "room" ? "roomId" : "toPersonEmail"]: destination, markdown: text }),
        },
        options,
      );
      return messageId(result);
    }
    case "gotify": {
      const token = required(account.token, "token");
      if (to !== "default") {
        throw new Error("Gotify target must be default (the configured application)");
      }
      const result = await request(
        endpoint(required(account.baseUrl, "baseUrl"), "message"),
        {
          method: "POST",
          headers: { "X-Gotify-Key": token, "content-type": "application/json" },
          body: JSON.stringify({ message: text, ...(account.title ? { title: account.title } : {}) }),
        },
        options,
      );
      return messageId(result);
    }
    case "pushover": {
      const token = required(account.token, "token");
      const form = new URLSearchParams({ token, user: to, message: text });
      if (account.title) {
        form.set("title", account.title);
      }
      const result = await request(
        "https://api.pushover.net/1/messages.json",
        { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form },
        options,
      );
      if (result.status !== 1) {
        throw new Error("Pushover did not acknowledge the message");
      }
      return "";
    }
    case "ntfy": {
      if (to.includes("/") || to.includes("?") || to.includes("#")) {
        throw new Error("ntfy target must be a single topic name");
      }
      const result = await request(
        endpoint(account.baseUrl || "https://ntfy.sh/", encodeURIComponent(to)),
        {
          method: "POST",
          headers: { ...(account.token ? { authorization: `Bearer ${account.token}` } : {}), ...(account.title ? { title: account.title } : {}) },
          body: text,
        },
        options,
      );
      return messageId(result);
    }
    default:
      throw new Error("Long-tail account provider is not configured");
  }
}
