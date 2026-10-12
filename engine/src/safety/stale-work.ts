// Stale work never acts: phase boundaries, external server starts, streams, publishing and sign-ins
// re-check through authority-revision before each effect (atlas SAFETY-0193).
import { RunGenerations, StaleAuthorityError, type RunTicket } from "./authority-revision.js";

export type PhaseResult<T> =
  | { status: "applied"; value: T }
  | { status: "paused"; atPhase: string; reason: string };

export type CheckedPhase = { name: string; run: () => Promise<void> };

/** Background work: re-check before every phase and before applying the result; pause, never act stale. */
export async function runCheckedPhases<T>(params: {
  phases: readonly CheckedPhase[];
  recheck: () => void;
  produce: () => Promise<T>;
  apply: (value: T) => Promise<void>;
}): Promise<PhaseResult<T>> {
  let at = "start";
  try {
    for (const phase of params.phases) {
      at = phase.name;
      params.recheck();
      await phase.run();
    }
    at = "result";
    params.recheck();
    const value = await params.produce();
    at = "apply";
    params.recheck();
    await params.apply(value);
    return { status: "applied", value };
  } catch (error) {
    if (error instanceof StaleAuthorityError) {
      return { status: "paused", atPhase: at, reason: error.reason };
    }
    throw error;
  }
}

/**
 * One start of an external server. After the open it checks it is still the latest start and the saved launch
 * is unchanged; otherwise it closes only what it opened and returns nothing.
 */
export async function guardedServerStart<H>(params: {
  generations: RunGenerations;
  scope: string;
  launchKey: string;
  currentLaunchKey: () => string | undefined;
  open: (ticket: RunTicket) => Promise<H>;
  close: (handle: H) => Promise<void>;
}): Promise<H | undefined> {
  const ticket = params.generations.begin(params.scope);
  const handle = await params.open(ticket);
  if (params.generations.isCurrent(ticket) && params.currentLaunchKey() === params.launchKey) {
    return handle;
  }
  await params.close(handle);
  return undefined;
}

/** Remote effects pinned to exactly what was reviewed: every pinned field must still match, none may vanish. */
export function assertPinnedUnchanged(
  pinned: Readonly<Record<string, string>>,
  current: Readonly<Record<string, string | undefined>>,
): void {
  for (const [field, value] of Object.entries(pinned)) {
    if (current[field] !== value) {
      throw new StaleAuthorityError(`${field} changed since it was reviewed`);
    }
  }
}

export type ElevatedStepState = {
  switchOn: boolean;
  lockdown: boolean;
  accountMarked: boolean;
  touchedOtherProgram: boolean;
};

/** Elevated authority for the owner's verified chat, re-evaluated at every step. Once ended it stays ended. */
export class ElevatedChain {
  private ended = false;

  step(state: ElevatedStepState): boolean {
    const ok =
      !this.ended &&
      state.switchOn &&
      !state.lockdown &&
      state.accountMarked &&
      !state.touchedOtherProgram;
    if (!ok) {
      this.ended = true;
    }
    return ok;
  }
}

/** Open streams and sockets: re-check scope before every poll or event; a profile change ends the stream. */
export function makeStreamGuard(params: {
  profileId: string;
  currentProfileId: () => string | undefined;
  hasScope: () => boolean;
}): () => "continue" | "end" {
  let ended = false;
  return () => {
    if (ended || params.currentProfileId() !== params.profileId || !params.hasScope()) {
      ended = true;
      return "end";
    }
    return "continue";
  };
}

/** Sign-in endpoints are fixed by policy: https, an exact pinned origin, and never a redirect. */
export function assertPinnedSignInResponse(params: {
  url: string;
  pinnedOrigins: readonly string[];
  redirected: boolean;
  status: number;
}): void {
  let origin: string;
  try {
    const parsed = new URL(params.url);
    origin = parsed.protocol === "https:" ? parsed.origin : "";
  } catch {
    origin = "";
  }
  if (!origin || !params.pinnedOrigins.includes(origin)) {
    throw new StaleAuthorityError("the sign-in address is not the one policy allows");
  }
  if (params.redirected || (params.status >= 300 && params.status < 400)) {
    throw new StaleAuthorityError("the sign-in server tried to redirect");
  }
}
