import { formatErrorMessage } from "branch/plugin-sdk/error-runtime";
import { asOptionalRecord, normalizeOptionalString } from "branch/plugin-sdk/string-coerce-runtime";

// Quota and credential failures do not clear on their own. Retrying them on
// every watch or transcript event only repeats the same provider error, so
// automatic embedding work pauses for a window that grows while the failure
// persists and resets as soon as one embedding request succeeds.
export const MEMORY_EMBEDDING_ACCOUNT_BACKOFF_INITIAL_MS = 5 * 60_000;
export const MEMORY_EMBEDDING_ACCOUNT_BACKOFF_MAX_MS = 60 * 60_000;

const ACCOUNT_FAILURE_CODES = new Set([
  "insufficient_quota",
  "quota_exceeded",
  "credit_balance_exhausted",
  "billing_hard_limit_reached",
  "invalid_api_key",
  "authentication_error",
  "permission_denied",
  "unauthenticated",
]);

const ACCOUNT_FAILURE_MESSAGE_RE =
  /(insufficient_quota|credit_balance_exhausted|no credits remaining|exceeded your current quota|billing_hard_limit_reached|quota[_ ]exceeded|invalid[_ ]api[_ ]key|incorrect api key|\((?:401|403)\)|\bHTTP (?:401|403)\b)/i;

function readStatus(fields: Record<string, unknown> | undefined): number | undefined {
  return [fields?.status, fields?.statusCode].find(
    (value): value is number => typeof value === "number" && Number.isInteger(value),
  );
}

/**
 * True when an embedding failure comes from the provider account (quota,
 * billing or credentials) rather than from the request or the network.
 */
export function isMemoryEmbeddingAccountFailure(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    const fields = asOptionalRecord(current);
    const status = readStatus(fields);
    if (status === 401 || status === 403) {
      return true;
    }
    const codes = [fields?.code, fields?.errorCode, fields?.errorType, fields?.type];
    if (
      codes.some((value) => {
        const code = normalizeOptionalString(value)?.toLowerCase();
        return code !== undefined && ACCOUNT_FAILURE_CODES.has(code);
      })
    ) {
      return true;
    }
    if (ACCOUNT_FAILURE_MESSAGE_RE.test(formatErrorMessage(current))) {
      return true;
    }
    current = fields?.cause;
  }
  return false;
}

type BackoffWindow = {
  until: number;
  windowMs: number;
  logged: boolean;
};

export class MemoryEmbeddingAccountBackoff {
  private window: BackoffWindow | undefined;
  private lastWindowMs = 0;

  constructor(private readonly now: () => number = Date.now) {}

  /** True while automatic embedding work should wait for the provider account. */
  isActive(): boolean {
    return this.window !== undefined && this.now() < this.window.until;
  }

  /**
   * Opens a window for an account failure. An open window is never extended,
   * so each window ends with exactly one retry attempt.
   * Returns true when the error is an account failure.
   */
  recordFailure(error: unknown): boolean {
    if (!isMemoryEmbeddingAccountFailure(error)) {
      return false;
    }
    if (this.isActive()) {
      return true;
    }
    const windowMs =
      this.lastWindowMs > 0
        ? Math.min(this.lastWindowMs * 2, MEMORY_EMBEDDING_ACCOUNT_BACKOFF_MAX_MS)
        : MEMORY_EMBEDDING_ACCOUNT_BACKOFF_INITIAL_MS;
    this.lastWindowMs = windowMs;
    this.window = { until: this.now() + windowMs, windowMs, logged: false };
    return true;
  }

  /** Clears the backoff after any successful embedding request. */
  recordSuccess(): void {
    this.window = undefined;
    this.lastWindowMs = 0;
  }

  /**
   * Decides whether a failure is logged as a warning. Account failures log
   * once per window; every other failure always logs.
   */
  claimLog(error: unknown): boolean {
    if (!this.recordFailure(error) || !this.window) {
      return true;
    }
    if (this.window.logged) {
      return false;
    }
    this.window.logged = true;
    return true;
  }

  /** Suffix for the one warning logged per window. */
  describeWindow(): string {
    const minutes = Math.max(1, Math.round((this.window?.windowMs ?? 0) / 60_000));
    return (
      "the embedding provider rejected the account (quota, billing or credentials); " +
      `automatic memory indexing pauses for ${minutes} min and memory search uses the existing index. ` +
      "Further repeats are suppressed until then."
    );
  }
}
