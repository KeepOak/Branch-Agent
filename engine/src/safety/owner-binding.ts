// elizaOS/eliza@3f38e54495ba5518f84bcf9cc1e84e0dc3d60bbf:packages/agent/src/services/owner-binding.ts
// (atlas SAFETY-0118; owner request G-1680). The owner links a chat account with a one-time code; only that account
// counts as the owner. Eliza's invariants are kept: 6 crypto-random digits, hashed at rest, single use, 5-minute
// expiry, 5 attempts, constant-time compare, process-local (a restart voids codes), and failures never say whether
// a code is pending for another channel. Branch's "canonical owner" is the owner at the local window, so only that
// caller may issue a code; the verified account is written with pairing/command-owner.ts.
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import type { GatewayCaller } from "./caller-identity.js";

export const OWNER_BIND_CODE_TTL_MS = 5 * 60_000;
export const OWNER_BIND_MAX_ATTEMPTS = 5;

export type OwnerBindVerifyParams = {
  channel: string;
  /** Stable platform user id. */
  externalId: string;
  displayHandle: string;
  code: string;
};

export type OwnerBindVerifyResult = { success: true } | { success: false; error: string };

export type OwnerBindIssueResult = { channel: string; code: string; expiresAt: number };

type PendingBind = { codeHash: Buffer; expiresAt: number; attemptsRemaining: number };

export type OwnerAccountWriter = (account: { channel: string; id: string; displayHandle: string }) => Promise<void>;

function hashCode(code: string): Buffer {
  return createHash("sha256").update(code, "utf8").digest();
}

const normalizeChannel = (channel: string): string => channel.trim().toLowerCase();

export class OwnerBindingCodes {
  private readonly pending = new Map<string, PendingBind>();

  constructor(
    private readonly writeOwnerAccount: OwnerAccountWriter,
    private readonly now: () => number = Date.now,
  ) {}

  /** Issue a code for a channel, replacing any pending one. Only the owner at the local window may. */
  begin(params: { channel: string; issuer: GatewayCaller }): OwnerBindIssueResult {
    if (params.issuer.kind !== "owner-window") {
      throw new Error("Only the owner at the window on this computer can link an owner chat account.");
    }
    const channel = normalizeChannel(params.channel);
    if (!channel) {
      throw new Error("Unsupported owner-pairing channel");
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const expiresAt = this.now() + OWNER_BIND_CODE_TTL_MS;
    this.pending.set(channel, {
      codeHash: hashCode(code),
      expiresAt,
      attemptsRemaining: OWNER_BIND_MAX_ATTEMPTS,
    });
    return { channel, code, expiresAt };
  }

  /** Verify a code relayed from chat. Resolves to a result, never throws. */
  async verify(params: OwnerBindVerifyParams): Promise<OwnerBindVerifyResult> {
    const fail = (error: string): OwnerBindVerifyResult => ({ success: false, error });
    const channel = normalizeChannel(params.channel);
    if (!channel) {
      return fail("invalid_connector");
    }
    if (typeof params.externalId !== "string" || params.externalId.trim().length === 0) {
      return fail("invalid_external_id");
    }
    if (typeof params.code !== "string" || !/^\d{6}$/.test(params.code.trim())) {
      return fail("invalid_code_format");
    }
    const bind = this.pending.get(channel);
    if (!bind) {
      return fail("no_pending_bind");
    }
    if (this.now() > bind.expiresAt) {
      this.pending.delete(channel);
      return fail("code_expired");
    }
    bind.attemptsRemaining -= 1;
    const candidate = hashCode(params.code.trim());
    if (!(candidate.length === bind.codeHash.length && timingSafeEqual(candidate, bind.codeHash))) {
      if (bind.attemptsRemaining <= 0) {
        this.pending.delete(channel);
        return fail("too_many_attempts");
      }
      return fail("invalid_code");
    }
    // Single use: consume before the write so a repeated submission can never bind twice.
    this.pending.delete(channel);
    return await this.write(channel, params);
  }

  private async write(channel: string, params: OwnerBindVerifyParams): Promise<OwnerBindVerifyResult> {
    const id = params.externalId.trim();
    const handle = params.displayHandle?.trim() || id;
    try {
      await this.writeOwnerAccount({ channel, id, displayHandle: handle });
    } catch {
      return { success: false, error: "binding_write_failed" };
    }
    return { success: true };
  }

  stop(): void {
    this.pending.clear();
  }
}
