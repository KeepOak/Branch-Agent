// Copied from elizaOS/eliza@3f38e54495ba5518f84bcf9cc1e84e0dc3d60bbf:plugins/plugin-calendar/src/ics/parser.ts (atlas INTEGRATIONS-0069)

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
