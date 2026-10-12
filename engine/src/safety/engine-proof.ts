// Branch-original shared safety piece (atlas SAFETY-0194, G-1689): the window proves it reached the real engine.
// The window sends a fresh nonce; the engine answers with an HMAC over the nonce, its port and its process id,
// keyed by the window key both already hold. The window never sends that key: after the proof checks out it
// sends a per-connection token derived from the same nonce, useless to anyone who grabbed the port.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const PROOF_LABEL = "branch-engine-proof/v1";
const TOKEN_LABEL = "branch-window-connection/v1";
export const ENGINE_CHALLENGE_TTL_MS = 30_000;

export type EngineEndpoint = Readonly<{ port: number; pid: number }>;

export function createEngineChallengeNonce(): string {
  return randomBytes(32).toString("base64url");
}

function mac(key: string, parts: readonly (string | number)[]): string {
  return createHmac("sha256", key).update(parts.join("\n")).digest("base64url");
}

function equalText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Engine side: answer a window challenge for this exact port and process. */
export function answerEngineChallenge(key: string, nonce: string, endpoint: EngineEndpoint): string {
  return mac(key, [PROOF_LABEL, nonce, endpoint.port, endpoint.pid]);
}

/** Window side: the answer must match the nonce it sent and the port and process it expected. */
export function verifyEngineProof(params: {
  key: string;
  nonce: string;
  endpoint: EngineEndpoint;
  proof: string;
}): boolean {
  return equalText(answerEngineChallenge(params.key, params.nonce, params.endpoint), params.proof);
}

/** Window side, after a good proof: the per-connection credential it sends instead of the window key. */
export function deriveWindowConnectionToken(key: string, nonce: string, endpoint: EngineEndpoint): string {
  return mac(key, [TOKEN_LABEL, nonce, endpoint.port, endpoint.pid]);
}

/**
 * Engine side: nonces it answered, each usable for exactly one connection and only while fresh. A consumed nonce
 * stays recorded until it expires, so it can be neither answered nor accepted again.
 */
export class EngineChallengeLedger {
  private readonly answered = new Map<string, { expiresAt: number; consumed: boolean }>();

  constructor(
    private readonly key: string,
    private readonly endpoint: EngineEndpoint,
    private readonly now: () => number = Date.now,
  ) {}

  answer(nonce: string): string | undefined {
    if (nonce.length < 32 || this.answered.has(nonce)) {
      return undefined;
    }
    this.prune();
    this.answered.set(nonce, { expiresAt: this.now() + ENGINE_CHALLENGE_TTL_MS, consumed: false });
    return answerEngineChallenge(this.key, nonce, this.endpoint);
  }

  /** Accept a derived connection token once. The raw window key is never accepted here. */
  acceptConnectionToken(nonce: string, token: string): boolean {
    const entry = this.answered.get(nonce);
    if (!entry || entry.consumed || this.now() > entry.expiresAt || equalText(token, this.key)) {
      return false;
    }
    entry.consumed = true;
    return equalText(deriveWindowConnectionToken(this.key, nonce, this.endpoint), token);
  }

  private prune(): void {
    const now = this.now();
    for (const [nonce, entry] of this.answered) {
      if (now > entry.expiresAt) {
        this.answered.delete(nonce);
      }
    }
  }
}
