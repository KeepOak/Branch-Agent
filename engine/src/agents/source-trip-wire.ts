// mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421 packages/core/src/agent/trip-wire.ts
/**
 * Options for TripWire that control how the tripwire should be handled
 */
export interface TripWireOptions<TMetadata = unknown> {
  /**
   * If true, the agent should retry with the tripwire reason as feedback.
   * The failed response will be added to message history along with the reason.
   */
  retry?: boolean;
  /**
   * Strongly typed metadata from the processor.
   * This allows processors to pass structured information about what triggered the tripwire.
   */
  metadata?: TMetadata;
}

/**
 * TripWire is a custom Error class for aborting processing with optional retry and metadata.
 *
 * When thrown from a processor, it signals that processing should stop.
 * The `options` field controls how the tripwire should be handled:
 * - `retry: true` - The agent will retry with the reason as feedback
 * - `metadata` - Strongly typed data about what triggered the tripwire
 */
export class TripWire<TMetadata = unknown> extends Error {
  public readonly options: TripWireOptions<TMetadata>;
  public readonly processorId?: string;

  constructor(reason: string, options: TripWireOptions<TMetadata> = {}, processorId?: string) {
    super(reason);
    this.options = options;
    this.processorId = processorId;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Tripwire data passed to getModelOutputForTripwire
 */
export interface TripwireData<TMetadata = unknown> {
  reason: string;
  retry?: boolean;
  metadata?: TMetadata;
  processorId?: string;
}
