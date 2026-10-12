// Behaviour tests for atlas SAFETY-0194 (G-1689): the window proves it reached the real engine.
import { describe, expect, it } from "vitest";
import {
  answerEngineChallenge,
  createEngineChallengeNonce,
  deriveWindowConnectionToken,
  ENGINE_CHALLENGE_TTL_MS,
  EngineChallengeLedger,
  verifyEngineProof,
} from "./engine-proof.js";

const key = "window-key-0123456789abcdef";
const endpoint = { port: 41001, pid: 4242 };

describe("G-1689 engine proof", () => {
  it("G-1689: the window accepts only a proof bound to its key, the port and the engine process", () => {
    const nonce = createEngineChallengeNonce();
    const proof = answerEngineChallenge(key, nonce, endpoint);
    expect(verifyEngineProof({ key, nonce, endpoint, proof })).toBe(true);
    expect(verifyEngineProof({ key, nonce, endpoint: { ...endpoint, pid: 9 }, proof })).toBe(false);
    expect(verifyEngineProof({ key, nonce, endpoint: { ...endpoint, port: 41002 }, proof })).toBe(false);
    expect(verifyEngineProof({ key: "other-key", nonce, endpoint, proof })).toBe(false);
    expect(verifyEngineProof({ key, nonce: createEngineChallengeNonce(), endpoint, proof })).toBe(false);
  });

  it("G-1689: a program that grabbed the port gets nothing usable: no key, and a token for one connection only", () => {
    let now = 1_000;
    const ledger = new EngineChallengeLedger(key, endpoint, () => now);
    const nonce = createEngineChallengeNonce();
    const proof = ledger.answer(nonce);
    expect(proof && verifyEngineProof({ key, nonce, endpoint, proof })).toBe(true);
    const token = deriveWindowConnectionToken(key, nonce, endpoint);
    expect(token).not.toContain(key);
    expect(ledger.acceptConnectionToken(nonce, token)).toBe(true);
    expect(ledger.acceptConnectionToken(nonce, token)).toBe(false);
    expect(ledger.answer(nonce)).toBeUndefined();

    const second = createEngineChallengeNonce();
    ledger.answer(second);
    expect(ledger.acceptConnectionToken(second, key)).toBe(false);

    const late = createEngineChallengeNonce();
    ledger.answer(late);
    now += ENGINE_CHALLENGE_TTL_MS + 1;
    expect(ledger.acceptConnectionToken(late, deriveWindowConnectionToken(key, late, endpoint))).toBe(false);
  });
});
