import { normalizeAgentId } from "@branch/normalization-core/agent-id";
import { normalizeOptionalString } from "@branch/normalization-core/string-coerce";
import { z } from "zod";
import { isBlockedObjectKey } from "../infra/prototype-keys.js";
import { AgentDefaultsSchema } from "./zod-schema.agent-defaults.js";
import { AgentEntrySchema } from "./zod-schema.agent-runtime.js";

export { BroadcastSchema } from "./zod-schema.messages.js";

const AgentEntryConfigSchema = z.preprocess(
  (value, ctx) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const key of Object.getOwnPropertyNames(value)) {
        if (!isBlockedObjectKey(key)) {
          continue;
        }
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: "agent entries must not contain blocked object keys",
        });
        return z.NEVER;
      }
    }
    return value;
  },
  AgentEntrySchema.omit({ id: true }).extend({ default: z.boolean().optional() }),
);

export const AgentsSchema = z
  .strictObject({
    ownership: z.literal("explicit").optional(),
    characterAssignmentVersion: z.literal(1).optional(),
    defaultId: z
      .string()
      .regex(/^[a-z0-9_][a-z0-9_-]{0,63}$/i, "Invalid agent id")
      .optional(),
    defaults: z.lazy(() => AgentDefaultsSchema).optional(),
    entries: z
      .record(
        z.string().regex(/^[a-z0-9_][a-z0-9_-]{0,63}$/i, "Invalid agent id"),
        AgentEntryConfigSchema,
      )
      .optional(),
    trunkQueue: z
      .strictObject({
        enabled: z.boolean().optional(),
        agents: z.array(z.string().min(1).max(64)).optional(),
      })
      .optional(),
    gardener: z
      .strictObject({
        enabled: z.boolean().optional(),
        repo: z
          .string()
          .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "Repo must be owner/name")
          .max(200)
          .optional(),
      })
      .optional(),
    signalWakes: z
      .strictObject({
        repos: z
          .array(z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "Expected owner/name"))
          .optional(),
      })
      .optional(),
    teamMemory: z
      .strictObject({
        agents: z.array(z.string().min(1).max(64)).optional(),
      })
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.gardener?.enabled === true && !value.gardener.repo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["gardener", "repo"],
        message: "agents.gardener.repo is required when agents.gardener.enabled is true",
      });
    }
    const entries = Object.entries(value.entries ?? {});
    if (
      value.defaultId &&
      !entries.some(([id]) => normalizeAgentId(id) === normalizeAgentId(value.defaultId!))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["defaultId"],
        message: "agents.defaultId must name a configured Trunk",
      });
    }
    if (entries.length === 0 && !(value.ownership === "explicit" && value.entries === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["entries"],
        message: "agents.entries must contain at least one configured agent",
      });
    }
    const firstKeyByAgentId = new Map<string, string>();
    for (const [key] of entries) {
      const agentId = normalizeAgentId(key);
      const firstKey = firstKeyByAgentId.get(agentId);
      if (!firstKey) {
        firstKeyByAgentId.set(agentId, key);
        continue;
      }
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["entries", key],
        message: `agents.entries keys "${firstKey}" and "${key}" resolve to the same agent id "${agentId}"; rename one key so each agent has a unique id`,
      });
    }
    const marked = entries.filter(([, entry]) => entry.default === true);
    if (marked.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["entries"],
        message: `agents.entries must contain at most one default=true entry (found ${marked.length})`,
      });
    }
    if (value.ownership === "explicit" && marked.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ownership"],
        message: "agents.ownership=explicit cannot be combined with a legacy default=true marker",
      });
    }
    if (
      entries.length > 1 &&
      marked.length === 0 &&
      !value.defaultId &&
      value.ownership !== "explicit"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ownership"],
        message:
          'multi-agent rosters require agents.defaultId, agents.ownership="explicit", or one legacy default=true marker; select a default Trunk or run branch doctor',
      });
    }
  })
  .optional();

const BindingMatchSchema = z.strictObject({
  channel: z.string(),
  /**
   * Channel account to match.
   * - Omitted/empty: matches only the channel default account.
   * - "*": matches every account on the channel.
   * - Any other string: matches that specific account id.
   */
  accountId: z.string().optional(),
  peer: z
    .strictObject({
      kind: z.union([z.literal("direct"), z.literal("group"), z.literal("channel")]),
      id: z.string(),
    })
    .optional(),
  guildId: z.string().optional(),
  teamId: z.string().optional(),
  /** Discord role IDs used for role-based routing. */
  roles: z.array(z.string()).optional(),
});

const BindingSessionSchema = z.strictObject({
  /** Optional session scoping override for conversations matched by this binding. */
  dmScope: z.enum(["main", "per-peer", "per-channel-peer", "per-account-channel-peer"]).optional(),
  groupScope: z.enum(["main", "per-group"]).optional(),
});

const RouteBindingSchema = z.strictObject({
  /** Missing type is interpreted as route for backward compatibility. */
  type: z.literal("route").optional(),
  agentId: z.string(),
  comment: z.string().optional(),
  match: BindingMatchSchema,
  session: BindingSessionSchema.optional(),
});

const AcpBindingSchema = z
  .strictObject({
    type: z.literal("acp"),
    agentId: z.string(),
    comment: z.string().optional(),
    match: BindingMatchSchema,
    acp: z
      .strictObject({
        mode: z.enum(["persistent", "oneshot"]).optional(),
        label: z.string().optional(),
        cwd: z.string().optional(),
        backend: z.string().optional(),
      })
      .optional(),
  })
  .superRefine((value, ctx) => {
    const peerId = normalizeOptionalString(value.match.peer?.id) ?? "";
    if (!peerId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["match", "peer"],
        message: "ACP bindings require match.peer.id to target a concrete conversation.",
      });
    }
  });

export const BindingsSchema = z.array(z.union([RouteBindingSchema, AcpBindingSchema])).optional();
