// Who this `branch mcp serve` speaks for, and whether Branch still lets it in (Settings › Grafts).
// Every connected MCP client is its own identity: its display name plus a short tag for this computer and the
// folder it works in, so ten Claude Code sessions in ten projects are ten contacts, and each one keeps its id
// across restarts. It says hello every minute (online dot, last seen) and when it starts something (activity).
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { OutsideAgentIdentity } from "./trunk-tools.js";

export const HELLO_INTERVAL_MS = 60_000;
const ACTIVITY_MIN_INTERVAL_MS = 3_000;
/** How long a tool waits for the first hello before acting on what is known (a slow gateway must not hang tools). */
const FIRST_HELLO_WAIT_MS = 5_000;

/** MCP clientInfo names some clients send without a title. */
const KNOWN_CLIENTS: [RegExp, string][] = [
  [/^claude[-_ ]?code|^claude-ai|^claude$/i, "Claude Code"],
  [/^codex/i, "Codex"],
  [/^gemini/i, "Gemini CLI"],
  [/^hermes/i, "Hermes Agent"],
  [/^cursor/i, "Cursor"],
];

export function displayName(client: { name?: string; title?: string }): string {
  const name = (client.name ?? "").trim();
  const known = KNOWN_CLIENTS.find(([pattern]) => pattern.test(name))?.[1];
  const title = (client.title ?? "").trim();
  return (title && title !== name ? title : known || title || name).slice(0, 100);
}

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** The connected MCP client as an outside agent: name, version, this computer and its working folder. */
export function outsideAgentFromClient(
  client: { name?: string; title?: string; version?: string } | undefined,
  where: string = os.hostname(),
  cwd: string = process.cwd(),
): OutsideAgentIdentity | undefined {
  const name = client ? displayName(client) : "";
  if (!name) return undefined;
  const tag = createHash("sha256")
    .update(`${where}\n${path.resolve(cwd)}`)
    .digest("hex")
    .slice(0, 6);
  const base = slug(name).slice(0, 56) || "outside-agent";
  const project = path.basename(path.resolve(cwd));
  return {
    id: `${base}-${tag}`,
    name,
    ...(client?.version ? { version: client.version.slice(0, 64) } : {}),
    ...(where ? { where: where.slice(0, 255) } : {}),
    ...(project ? { project: project.slice(0, 255) } : {}),
  };
}

type Hello = (agent: OutsideAgentIdentity) => Promise<Record<string, unknown>>;

export class OutsidePresence {
  private agent: OutsideAgentIdentity | undefined;
  private first: Promise<void> = Promise.resolve();
  private refusal: string | undefined;
  private driveWindow = false;
  private timer: NodeJS.Timeout | undefined;
  private lastActivityAt = 0;
  private known = false;
  private pendingHello: Promise<void> | undefined;

  constructor(
    private readonly hello: Hello,
    private readonly log: (line: string) => void = () => undefined,
    private readonly goodbye?: (agent: OutsideAgentIdentity) => Promise<unknown>,
  ) {}

  start(agent: OutsideAgentIdentity | undefined): void {
    if (!agent) return;
    // The instance tag lets Branch tell two sessions with the same name, computer and folder apart.
    this.agent = { ...agent, instance: randomUUID().slice(0, 12) };
    this.first = this.say();
    this.timer = setInterval(() => void this.say(), HELLO_INTERVAL_MS);
    this.timer.unref();
  }

  /** The identity to send as. Throws when Branch has turned this agent away. */
  async identity(): Promise<OutsideAgentIdentity | undefined> {
    // A transient connection failure is not an old gateway. Retry on the next tool,
    // without overlapping a hello that is still in flight or changing its wait budget.
    if (this.agent && !this.known && !this.refusal) {
      this.first = this.say();
    }
    await this.firstHello();
    await this.assertAllowed();
    return this.known ? this.agent : undefined;
  }

  /** Every tool calls this first: it throws once a hello was refused (hellos run at connect, every minute and on
   *  activity). It never waits, so no tool hangs on a slow gateway. */
  async assertAllowed(): Promise<void> {
    if (this.refusal) {
      throw new Error(
        `${this.refusal} Ask the owner to allow this agent in Settings › Grafts, then reconnect Graft.`,
      );
    }
  }

  /** Whether the owner let this agent drive their own window (Settings › Grafts). */
  mayDriveWindow(): boolean {
    return this.driveWindow;
  }

  /** Tell Branch what this agent is doing now (shown in Settings › Grafts). */
  activity(text: string): void {
    const now = Date.now();
    if (!this.agent || now - this.lastActivityAt < ACTIVITY_MIN_INTERVAL_MS) return;
    this.lastActivityAt = now;
    void this.say(text.slice(0, 200));
  }

  private async firstHello(): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      this.first,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, FIRST_HELLO_WAIT_MS);
        timer.unref();
      }),
    ]);
    clearTimeout(timer);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Say goodbye as the client exits, so its next session (often a short-lived one) gets the same id back. */
  async leave(): Promise<void> {
    this.stop();
    if (!this.agent || !this.known || this.refusal) return;
    // Bounded: shutting down must never wait on a slow gateway.
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      this.goodbye?.(this.agent).catch(() => undefined),
      new Promise((resolve) => {
        timer = setTimeout(resolve, 2_000);
        timer.unref();
      }),
    ]);
    clearTimeout(timer);
  }

  private say(activity?: string): Promise<void> {
    if (this.pendingHello) {
      return this.pendingHello;
    }
    this.pendingHello = this.sayHello(activity).finally(() => {
      this.pendingHello = undefined;
    });
    return this.pendingHello;
  }

  private async sayHello(activity?: string): Promise<void> {
    if (!this.agent) return;
    try {
      const full = { ...this.agent, ...(activity ? { activity } : {}) };
      // A Branch from before Settings › Grafts knows only id, name, version and where; on its
      // "invalid params" the hello goes again in that shape instead of falling back to owner messages.
      const result = await this.hello(full).catch(async (error: unknown) => {
        if (!/invalid contacts\.outside\.hello params|INVALID_REQUEST/i.test(String(error)))
          throw error;
        const { id, name, version, where } = this.agent!;
        return await this.hello({
          id,
          name,
          ...(version ? { version } : {}),
          ...(where ? { where } : {}),
        });
      });
      // Branch may give this process its own id (<id>-2) when another session already holds the stable one.
      const assigned = String((result.contact as { id?: unknown } | undefined)?.id ?? "").replace(
        /^a2a:/,
        "",
      );
      if (assigned) this.agent = { ...this.agent, id: assigned };
      this.known = true;
      this.refusal = undefined;
      this.driveWindow = result.mayDriveWindow === true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A gateway without contacts.outside.hello keeps plain messages; a refusal stops this agent.
      // "Connected agents" is the page's name on Branches from before it was called Grafts.
      if (/Settings › (Grafts|Connected agents)/.test(message)) this.refusal = message;
      this.log(`outside-agent hello failed: ${message}`);
    }
  }
}
