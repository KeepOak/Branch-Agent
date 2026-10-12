// Branch-original shared safety piece (atlas SAFETY-0196, G-1739 and G-1719): personas propose, they never grant.

/** A Trunk's own personality and instruction files. */
export const PERSONA_FILES: ReadonlySet<string> = new Set([
  "SOUL.md",
  "IDENTITY.md",
  "AGENTS.md",
  "USER.md",
  "TOOLS.md",
  "HEARTBEAT.md",
]);

export type PersonaWriteDecision =
  | { kind: "propose"; agentId: string; file: string }
  | { kind: "refuse"; reason: "other-agent" | "not-persona-file" };

const baseName = (file: string): string => file.replace(/\\/g, "/").split("/").pop() ?? file;

/** G-1739: a persona may only propose changes to its own persona files; nothing applies by itself. */
export function decidePersonaWrite(params: {
  writerAgentId: string;
  targetAgentId: string;
  file: string;
}): PersonaWriteDecision {
  if (params.writerAgentId !== params.targetAgentId) {
    return { kind: "refuse", reason: "other-agent" };
  }
  const file = baseName(params.file);
  if (!PERSONA_FILES.has(file)) {
    return { kind: "refuse", reason: "not-persona-file" };
  }
  return { kind: "propose", agentId: params.targetAgentId, file };
}

/** Markers only first-run setup may write. Edit routes refuse them and restore strips them. */
export const SETUP_ONLY_MARKERS: ReadonlySet<string> = new Set(["ownerReachDefault", "setupCreated"]);

export type PersonaRecord = Readonly<Record<string, unknown> & { id: string }>;

/** G-1719: owner reach goes only to the persona the owner explicitly designated and persisted. */
export function resolveOwnerReachPersona(params: {
  designatedPersonaId: string | undefined;
  personas: readonly PersonaRecord[];
}): PersonaRecord | undefined {
  const id = params.designatedPersonaId?.trim();
  return id ? params.personas.find((persona) => persona.id === id) : undefined;
}

/** G-1719: an edit that tries to set a setup-only marker is refused. */
export function refuseSetupOnlyMarkerEdit(patch: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(patch).filter((key) => SETUP_ONLY_MARKERS.has(key));
}

/** G-1719: restoring a persona from a backup drops setup-only markers. */
export function stripSetupOnlyMarkers(record: PersonaRecord): PersonaRecord {
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => !SETUP_ONLY_MARKERS.has(key)),
  ) as PersonaRecord;
}
