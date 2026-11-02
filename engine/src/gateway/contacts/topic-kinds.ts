import { parseAgentSessionKey, parseSessionDeliveryRoute } from "../../routing/session-key.js";

/**
 * Every rest-prefix kind the engine writes under `agent:<id>:…`.
 * A new builder must add a row here: leftover is only for unrecognized rest
 * such as leftover script-made keys, never for a production prefix.
 */
export const CONTACT_TOPIC_SESSION_KINDS = {
  main: "hidden",
  global: "hidden",
  window: "openable",
  background: "openable",
  dashboard: "openable",
  tui: "openable",
  ios: "openable",
  "node-device": "openable",
  voice: "openable",
  delivery: "openable",
  a2a: "openable",
  trunk: "openable",
  cron: "hidden",
  room: "hidden",
  system: "hidden",
  subagent: "hidden",
  acp: "hidden",
  "acp-bridge": "hidden",
  hook: "hidden",
  harness: "hidden",
  helper: "hidden",
  graft: "hidden",
  "catalog-import": "hidden",
  plugin: "hidden",
  "update-repair": "hidden",
  queue: "hidden",
  explicit: "hidden",
  rings: "hidden",
  heartbeat: "hidden",
  "internal-effects": "hidden",
  boot: "hidden",
  "node-host": "hidden",
  leftover: "hidden",
} as const;

export type ContactTopicSessionKind = keyof typeof CONTACT_TOPIC_SESSION_KINDS;
export type ContactTopicVisibility = (typeof CONTACT_TOPIC_SESSION_KINDS)[ContactTopicSessionKind];

export type ClassifiedContactTopicKind = {
  kind: ContactTopicSessionKind;
  visibility: ContactTopicVisibility;
};

type KindRule = {
  kind: Exclude<ContactTopicSessionKind, "leftover">;
  isKind: (rest: string) => boolean;
};

const KIND_RULES: readonly KindRule[] = [
  { kind: "cron", isKind: (rest) => rest.startsWith("cron:") || rest.includes(":cron:") },
  { kind: "room", isKind: (rest) => rest.startsWith("room:") },
  { kind: "system", isKind: (rest) => rest.startsWith("system:") },
  { kind: "subagent", isKind: (rest) => rest.startsWith("subagent:") || rest.includes(":subagent:") },
  { kind: "acp-bridge", isKind: (rest) => rest.startsWith("acp-bridge:") },
  { kind: "acp", isKind: (rest) => rest.startsWith("acp:") },
  { kind: "hook", isKind: (rest) => rest.startsWith("hook:") },
  { kind: "harness", isKind: (rest) => rest.startsWith("harness:") },
  { kind: "helper", isKind: (rest) => rest.startsWith("helper:") },
  { kind: "graft", isKind: (rest) => rest.startsWith("graft:") },
  { kind: "catalog-import", isKind: (rest) => rest.startsWith("catalog-import:") },
  { kind: "plugin", isKind: (rest) => rest.startsWith("plugin:") || rest.startsWith("plugin-binding:") },
  { kind: "update-repair", isKind: (rest) => rest.startsWith("update-repair:") },
  { kind: "queue", isKind: (rest) => rest.startsWith("queue-") },
  { kind: "explicit", isKind: (rest) => rest.startsWith("explicit:") },
  { kind: "rings", isKind: (rest) => rest.startsWith("rings-narrative-") },
  {
    kind: "heartbeat",
    isKind: (rest) => rest === "heartbeat" || rest.endsWith(":heartbeat") || rest.includes(":heartbeat:"),
  },
  { kind: "internal-effects", isKind: (rest) => rest.startsWith("internal-session-effects:") },
  { kind: "boot", isKind: (rest) => rest === "boot" || rest.startsWith("boot:") },
  { kind: "node-host", isKind: (rest) => rest.startsWith("node:") },
  { kind: "window", isKind: (rest) => rest.startsWith("window:") },
  { kind: "background", isKind: (rest) => rest.startsWith("background:") },
  { kind: "dashboard", isKind: (rest) => rest.startsWith("dashboard:") },
  { kind: "tui", isKind: (rest) => rest.startsWith("tui-") },
  { kind: "ios", isKind: (rest) => rest.startsWith("ios-") },
  { kind: "node-device", isKind: (rest) => rest.startsWith("node-") },
  { kind: "voice", isKind: (rest) => rest.startsWith("voice:") },
  { kind: "a2a", isKind: (rest) => rest.startsWith("a2a:") },
  { kind: "trunk", isKind: (rest) => rest.startsWith("trunk:") },
  { kind: "main", isKind: (rest) => rest === "main" },
  { kind: "global", isKind: (rest) => rest === "global" },
];

/** One sample key per kind the engine creates. Leftover is only unrecognized rest. */
export const CONTACT_TOPIC_KIND_SAMPLES: Record<ContactTopicSessionKind, string> = {
  main: "agent:scout:main",
  global: "agent:scout:global",
  window: "agent:scout:window:lisbon",
  background: "agent:scout:background:job",
  dashboard: "agent:scout:dashboard:4f1c",
  tui: "agent:scout:tui-01234567-89ab-cdef-0123-456789abcdef",
  ios: "agent:scout:ios-7f3a9c2b1d0e",
  "node-device": "agent:scout:node-device",
  voice: "agent:scout:voice:call:123",
  delivery: "agent:scout:telegram:direct:alice",
  a2a: "agent:scout:a2a:remote:direct:peer:context",
  trunk: "agent:scout:trunk:maple",
  cron: "agent:scout:cron:nightly:run:one",
  room: "agent:scout:room:123",
  system: "agent:scout:system:maintenance",
  subagent: "agent:scout:subagent:reader",
  acp: "agent:scout:acp:binding:discord:main:hash",
  "acp-bridge": "agent:scout:acp-bridge:session-1",
  hook: "agent:scout:hook:gmail:thread-1",
  harness: "agent:scout:harness:codex:supervision:thread",
  helper: "agent:scout:helper:incognito-slug",
  graft: "agent:scout:graft:job-1",
  "catalog-import": "agent:scout:catalog-import:deadbeef",
  plugin: "agent:scout:plugin:opencode:catalog-adopt:source",
  "update-repair": "agent:scout:update-repair:run-1",
  queue: "agent:scout:queue-job-claim12",
  explicit: "agent:scout:explicit:model-run-123e4567-e89b-12d3-a456-426614174000",
  rings: "agent:scout:rings-narrative-rem-workspace",
  heartbeat: "agent:scout:main:heartbeat",
  "internal-effects": "agent:scout:internal-session-effects:incognito-auto-capture",
  boot: "agent:scout:boot:startup-run",
  "node-host": "agent:scout:node:device-1",
  leftover: "agent:scout:script-test-1",
};

export function classifyContactTopicKind(sessionKey: string): ClassifiedContactTopicKind {
  const parsed = parseAgentSessionKey(sessionKey);
  if (!parsed) {
    return { kind: "leftover", visibility: CONTACT_TOPIC_SESSION_KINDS.leftover };
  }
  const rest = parsed.rest.toLowerCase();
  for (const rule of KIND_RULES) {
    if (rule.isKind(rest)) {
      return { kind: rule.kind, visibility: CONTACT_TOPIC_SESSION_KINDS[rule.kind] };
    }
  }
  if (parseSessionDeliveryRoute(sessionKey) !== null) {
    return { kind: "delivery", visibility: CONTACT_TOPIC_SESSION_KINDS.delivery };
  }
  return { kind: "leftover", visibility: CONTACT_TOPIC_SESSION_KINDS.leftover };
}
