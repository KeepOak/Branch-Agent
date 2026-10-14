export type IcsErrorSeverity = "ephemeral" | "fatal";

/** Coded ICS failure. Context never carries the capability-bearing feed URL. */
export class IcsError extends Error {
  readonly code: string;
  readonly context: Record<string, unknown> | undefined;
  readonly severity: IcsErrorSeverity;

  constructor(
    message: string,
    options: {
      code: string;
      context?: Record<string, unknown>;
      severity: IcsErrorSeverity;
      cause?: unknown;
    },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "IcsError";
    this.code = options.code;
    this.context = options.context;
    this.severity = options.severity;
  }
}
