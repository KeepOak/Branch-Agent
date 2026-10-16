// Gateway RPCs for the first-run contract of day-one templates (board card #463, GOD decision on #820):
// the Chief's starter offer, Start and Stop for a new teammate's paused routines, and the Overview cards.
// Routines are only ever turned on here, by an explicit owner Start; trunks.template.create adds them off.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ErrorCodes,
  errorShape,
  validateTrunkTemplateCardsParams,
  validateTrunkTemplateFirstRunParams,
  validateTrunkTemplateStartersParams,
} from "../../../packages/gateway-protocol/src/index.js";
import { listAgentIds } from "../../agents/agent-roster.js";
import { tryResolveAmbientOwnerAgentId } from "../../agents/agent-scope-config.js";
import { resolveStateDir } from "../../config/state-dir.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import {
  type FirstRunQuestion,
  machineTimeZone,
  pickStarterTeammates,
  type TrunkTemplateStarter,
} from "../../trunks/trunk-template-first-run.js";
import { cronHandlers } from "./cron.js";
import type { GatewayRequestHandlerOptions } from "./shared-types.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";
import { assertValidParams } from "./validation.js";

/** What trunks.template.create remembers about a teammate it made from a first-run template. */
export type FirstRunState = {
  agentId: string;
  name: string;
  templateName: string;
  routineIds: string[];
  result: { title: string; summary: string };
  answers: Record<string, string>;
  timezone: string;
  createdAt: number;
  startedAt?: number;
  stoppedAt?: number;
};

/** One bundled starter as the Chief offers it: the pitch, the questions with defaults, and its routines. */
export type StarterOffer = {
  id: string;
  name: string;
  description: string;
  pitch: string;
  questions: FirstRunQuestion[];
  routines: Array<{ name: string; cron: string }>;
  starter: TrunkTemplateStarter;
};

export type FirstRunRoutine = { id: string; name: string; enabled: boolean; nextRunAtMs?: number };

/** The Overview card: what the teammate does, whether it was started, and when it runs next. */
export type FirstRunCard = {
  agentId: string;
  name: string;
  title: string;
  summary: string;
  started: boolean;
  timezone: string;
  routines: FirstRunRoutine[];
  nextRunAtMs?: number;
};

export type FirstRunDeps = {
  listRoutines: (options: GatewayRequestHandlerOptions, agentId: string) => Promise<unknown[]>;
  listStarters: () => Promise<StarterOffer[]>;
};

const STATE_SUFFIX = ".first-run.json";
const SAFE_AGENT_FILE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const NOT_MAIN = "Only the main Trunk offers starter teammates.";
const NOTHING_WAITING =
  "This Trunk has no first-run setup. Only Trunks made from a starter template have one.";

function firstRunDir(): string {
  return path.join(resolveStateDir(), "trunk-templates", "first-run");
}

function stateFile(agentId: string): string | undefined {
  const id = normalizeAgentId(agentId);
  return SAFE_AGENT_FILE.test(id) ? path.join(firstRunDir(), id + STATE_SUFFIX) : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function saveFirstRunState(state: FirstRunState): Promise<void> {
  const file = stateFile(state.agentId);
  if (!file) {
    throw new Error("The new Trunk's id cannot name a first-run file.");
  }
  await mkdir(firstRunDir(), { recursive: true });
  await writeFile(file, JSON.stringify(state, null, 2) + "\n", "utf8");
}

function parseState(text: string): FirstRunState | undefined {
  try {
    const value = record(JSON.parse(text) as unknown);
    const result = record(value.result);
    if (
      typeof value.agentId !== "string" ||
      typeof value.name !== "string" ||
      !Array.isArray(value.routineIds) ||
      typeof result.title !== "string" ||
      typeof result.summary !== "string"
    ) {
      return undefined;
    }
    return value as unknown as FirstRunState;
  } catch {
    return undefined;
  }
}

export async function readFirstRunState(agentId: string): Promise<FirstRunState | undefined> {
  const file = stateFile(agentId);
  const text = file ? await readFile(file, "utf8").catch(() => undefined) : undefined;
  return text === undefined ? undefined : parseState(text);
}

async function listFirstRunStates(): Promise<FirstRunState[]> {
  const names = await readdir(firstRunDir()).catch(() => [] as string[]);
  const states = await Promise.all(
    names
      .filter((name) => name.endsWith(STATE_SUFFIX))
      .map(async (name) => {
        const text = await readFile(path.join(firstRunDir(), name), "utf8").catch(() => undefined);
        return text === undefined ? undefined : parseState(text);
      }),
  );
  return states
    .filter((state): state is FirstRunState => state !== undefined)
    .toSorted((a, b) => b.createdAt - a.createdAt);
}

/** Turns each routine on or off through cron.update, so the cron service's own checks apply. */
async function setRoutinesEnabled(
  options: GatewayRequestHandlerOptions,
  ids: readonly string[],
  enabled: boolean,
): Promise<string[]> {
  const update = cronHandlers["cron.update"];
  const failures: string[] = [];
  for (const id of ids) {
    let failure = update
      ? "cron.update did not answer."
      : "Automations are not available on this engine.";
    let done = false;
    if (update) {
      try {
        await update({
          ...options,
          params: { id, patch: { enabled } },
          respond: (ok, _payload, error) => {
            done = ok;
            failure = ok ? "" : (error?.message ?? "cron.update refused it.");
          },
        });
      } catch (error) {
        failure = messageOf(error);
      }
    }
    if (!done) {
      failures.push(
        "Routine " + id + " could not be turned " + (enabled ? "on" : "off") + ": " + failure,
      );
    }
  }
  return failures;
}

async function cardFor(
  options: GatewayRequestHandlerOptions,
  deps: FirstRunDeps,
  state: FirstRunState,
): Promise<FirstRunCard> {
  const jobs = state.routineIds.length
    ? await deps.listRoutines(options, state.agentId).catch(() => [] as unknown[])
    : [];
  const byId = new Map(jobs.map((job) => [record(job).id, record(job)]));
  const routines = state.routineIds.flatMap((id): FirstRunRoutine[] => {
    const job = byId.get(id);
    if (!job) {
      return [];
    }
    const next = record(job.state).nextRunAtMs;
    return [
      {
        id,
        name: typeof job.name === "string" ? job.name : id,
        enabled: job.enabled === true,
        ...(typeof next === "number" && job.enabled === true ? { nextRunAtMs: next } : {}),
      },
    ];
  });
  const nexts = routines.flatMap((routine) =>
    routine.nextRunAtMs === undefined ? [] : [routine.nextRunAtMs],
  );
  return {
    agentId: state.agentId,
    name: state.name,
    title: state.result.title,
    summary: state.result.summary,
    started: state.startedAt !== undefined && state.stoppedAt === undefined,
    timezone: state.timezone,
    routines,
    ...(nexts.length ? { nextRunAtMs: Math.min(...nexts) } : {}),
  };
}

function onceRespond(respond: RespondFn): RespondFn {
  let sent = false;
  return (ok, payload, error) => {
    if (!sent) {
      sent = true;
      respond(ok, payload, error);
    }
  };
}

function startOrStop(deps: FirstRunDeps, enabled: boolean) {
  const method = enabled ? "trunks.template.start" : "trunks.template.stop";
  return async (options: GatewayRequestHandlerOptions) => {
    const respond = onceRespond(options.respond);
    const { params } = options;
    if (!assertValidParams(params, validateTrunkTemplateFirstRunParams, method, respond)) {
      return;
    }
    try {
      const state = await readFirstRunState(params.agentId);
      if (!state) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, NOTHING_WAITING));
        return;
      }
      const warnings = await setRoutinesEnabled(options, state.routineIds, enabled);
      const now = Date.now();
      const next: FirstRunState = enabled
        ? { ...state, startedAt: now, stoppedAt: undefined }
        : { ...state, stoppedAt: now };
      await saveFirstRunState(next);
      respond(true, { card: await cardFor(options, deps, next), warnings }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, messageOf(error)));
    }
  };
}

export function createFirstRunHandlers(deps: FirstRunDeps): GatewayRequestHandlers {
  return {
    "trunks.template.starters": async (options) => {
      const respond = onceRespond(options.respond);
      const { params } = options;
      if (
        !assertValidParams(
          params,
          validateTrunkTemplateStartersParams,
          "trunks.template.starters",
          respond,
        )
      ) {
        return;
      }
      try {
        // The main Trunk is the configured system agent or the only Trunk. A Trunk made from a template
        // never offers, even before the roster has a clear main, so a new teammate cannot recruit more.
        const mainId = tryResolveAmbientOwnerAgentId(options.context.getRuntimeConfig());
        const asker = params.agentId ? normalizeAgentId(params.agentId) : undefined;
        if (asker && (asker !== mainId || (await readFirstRunState(asker)))) {
          respond(true, { timezone: machineTimeZone(), offer: [], reason: NOT_MAIN }, undefined);
          return;
        }
        const offer = pickStarterTeammates(await deps.listStarters(), params.goal);
        respond(true, { timezone: machineTimeZone(), offer }, undefined);
      } catch (error) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, messageOf(error)));
      }
    },
    "trunks.template.start": startOrStop(deps, true),
    "trunks.template.stop": startOrStop(deps, false),
    "trunks.template.cards": async (options) => {
      const respond = onceRespond(options.respond);
      if (
        !assertValidParams(
          options.params,
          validateTrunkTemplateCardsParams,
          "trunks.template.cards",
          respond,
        )
      ) {
        return;
      }
      try {
        const known = new Set(
          listAgentIds(options.context.getRuntimeConfig()).map((id) => normalizeAgentId(id)),
        );
        const states = (await listFirstRunStates()).filter((state) =>
          known.has(normalizeAgentId(state.agentId)),
        );
        respond(
          true,
          { cards: await Promise.all(states.map((state) => cardFor(options, deps, state))) },
          undefined,
        );
      } catch (error) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, messageOf(error)));
      }
    },
  };
}
