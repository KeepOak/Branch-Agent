/** The current kernel cannot safely resume serving after a failed handoff. */
const fatalHandoff = Symbol.for("branch.gateway.handoff-fatal");

export class GatewayHandoffFatalError extends Error {
  readonly [fatalHandoff] = true;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GatewayHandoffFatalError";
  }
}

export function isGatewayHandoffFatalError(error: unknown): error is GatewayHandoffFatalError {
  return Boolean(error && typeof error === "object" && fatalHandoff in error);
}
