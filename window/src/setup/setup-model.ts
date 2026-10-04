// The 11-step setup (DESIGN-SPEC §4.8.1): its steps, choices, and the readers for what the engine detects.
// Engine: branch.setup.detect / verify / activate (gateway-protocol schema/branch.ts), config wizard.* for the record.

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(rec) : []);

/** The 11 steps, in order, with the spec's names (§4.8.1 rule 1). */
export const STEPS = [
  "Welcome",
  "Where Branch runs",
  "Models",
  "Make it yours",
  "Your first Trunks",
  "Reach it anywhere",
  "Tools",
  "Keep it running",
  "People",
  "Two more things",
  "Health check",
] as const;
export const LAST = STEPS.length - 1;

export type Where = "this" | "remote" | "keepoak" | "later";
export type Look = "system" | "light" | "dark";

/** The six starting jobs (§4.8.1.5, the job list in §4.6.6). */
export const JOBS = [
  { name: "Inbox Manager", line: "Clears your inbox and drafts replies in your voice", colour: "#4F6FA8" },
  { name: "Expense Manager", line: "Files receipts and builds monthly reports", colour: "#1785AF" },
  { name: "Researcher", line: "Reads the web and writes short briefs with sources", colour: "#2F8C86" },
  { name: "Chief of Staff", line: "Plans your week and chases loose ends", colour: "#56616B" },
  { name: "Bug Reproduction", line: "Turns a bug report into exact steps", colour: "#B84A6B" },
  { name: "Trip Planner", line: "Finds and books refundable travel", colour: "#8A5AA8" },
] as const;

export type SetupChoices = {
  promise: boolean;
  where: Where;
  look: Look;
  /** Detected connections left out on the Models step, by candidate key. */
  modelsOff: string[];
  jobs: number[];
  people: number | null;
};

/** What setup starts with (§4.8.1: "This computer", "Match Windows", jobs 2 and 3, nothing for People). */
export function freshChoices(look: Look): SetupChoices {
  return { promise: false, where: "this", look, modelsOff: [], jobs: [1, 2], people: null };
}

export type Candidate = { key: string; kind: string; modelRef: string; label: string; detail: string; recommended: boolean; signedOut: boolean };
export type AuthOption = { id: string; label: string; hint: string };
export type Detected = { candidates: Candidate[]; configuredModel: string | null; setupComplete: boolean; unavailable: { label: string; reason: string }[]; authOptions: AuthOption[] };

/** branch.setup.detect: the connections Branch really found (§4.8.1.3 rule 1). */
export function readDetected(result: unknown): Detected {
  const r = rec(result);
  return {
    candidates: list(r.candidates).map((c) => ({
      key: `${str(c.kind)}|${str(c.modelRef)}`,
      kind: str(c.kind),
      modelRef: str(c.modelRef),
      label: str(c.label),
      detail: str(c.detail),
      recommended: c.recommended === true,
      signedOut: c.credentials === false,
    })),
    configuredModel: str(r.configuredModel) || null,
    setupComplete: r.setupComplete === true,
    unavailable: list(r.unavailableCandidates).map((u) => ({ label: str(u.label), reason: str(u.reason) })),
    // Featured sign-ins first, as the Control UI's provider picker orders them.
    authOptions: list(r.authOptions)
      .sort((a, b) => Number(b.featured === true) - Number(a.featured === true))
      .map((o) => ({ id: str(o.id), label: [str(o.groupLabel), str(o.label)].filter(Boolean).join(" · "), hint: str(o.hint) })),
  };
}

/** The connection "Say hello to test it" uses: the first switched-on one that isn't signed out. */
export function firstOn(detected: Detected, off: string[]): Candidate | null {
  return detected.candidates.find((c) => !off.includes(c.key) && !c.signedOut) ?? null;
}

export type TestResult = { ok: true; seconds: string; modelRef: string; madeDefault?: boolean } | { ok: false; error: string };

/** branch.setup.activate or branch.setup.verify: "It answered in N s · <model>", or what the provider said. */
export function readTest(result: unknown): TestResult {
  const r = rec(result);
  if (r.ok === true) {
    const ms = typeof r.latencyMs === "number" ? r.latencyMs : 0;
    return { ok: true, seconds: (ms / 1000).toFixed(1), modelRef: str(r.modelRef) };
  }
  return { ok: false, error: str(r.error) || str(r.status) || "The model didn't answer." };
}

/** The setup record in config (wizard.*, engine config zod-schema.root-shape.ts); written on finish or skip. */
export function setupRecord(choices: SetupChoices, version: string, now = new Date()): Record<string, unknown> {
  return {
    "wizard.lastRunAt": now.toISOString(),
    ...(version ? { "wizard.lastRunVersion": version } : {}),
    "wizard.lastRunCommand": "window",
    "wizard.lastRunMode": choices.where === "remote" ? "remote" : "local",
    ...(choices.promise ? { "wizard.securityAcknowledgedAt": now.toISOString() } : {}),
  };
}

/** Setup opens by itself only when it was never finished or skipped (§4.8.1 rule 2). */
export function setupDone(config: unknown): boolean {
  return Boolean(str(rec(rec(rec(config).config).wizard).lastRunAt));
}

/** A fresh bootstrap owner is not yet the person's chosen contact. Existing setups stay intact. */
export function needsFirstContact(config: unknown): boolean {
  return !setupDone(config) && !str(rec(rec(rec(config).config).agents).defaultId);
}

/** The Trunk id agents.create gets for a picked job: lower case, dashes. */
export function jobId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export type Check = { name: string; state: "checking" | "ok" | "bad"; line: string; fix?: number };

export type Known = {
  /** The safety promise was ticked before (wizard.securityAcknowledgedAt). */
  promise: boolean;
  /** The default model already set up (agents.defaults.model, or what detect says is configured). */
  model: string | null;
  /** The starting jobs that already exist as Trunks. */
  jobs: number[];
  /** update.auto.enabled as the config has it, or null when unset. */
  autoUpdate: boolean | null;
};

/** What an already set-up Branch has, so setup prefills it and marks those steps done instead of asking again. */
export function knownSetup(config: unknown, detected: Detected | null, trunkNames: string[]): Known {
  const c = rec(rec(config).config);
  const wizard = rec(c.wizard);
  const modelCfg = rec(rec(c.agents).defaults).model;
  const model = (typeof modelCfg === "string" ? modelCfg : str(rec(modelCfg).primary)) || detected?.configuredModel || null;
  const auto = rec(rec(c.update).auto).enabled;
  return {
    promise: Boolean(str(wizard.securityAcknowledgedAt)),
    model,
    jobs: JOBS.flatMap((j, i) => (trunkNames.includes(j.name) ? [i] : [])),
    autoUpdate: typeof auto === "boolean" ? auto : null,
  };
}

/** The steps an already set-up Branch has done: Welcome (promise), Where (this window is connected), Models (a
 *  default model), Your first Trunks (a job Trunk exists), Reach (a chat app is connected). */
export function doneSteps(known: Known, chatConnected: boolean): Set<number> {
  const done = new Set<number>([1]);
  if (known.promise) done.add(0);
  if (known.model) done.add(2);
  if (known.jobs.length) done.add(4);
  if (chatConnected) done.add(5);
  return done;
}
