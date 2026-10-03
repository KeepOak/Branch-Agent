/** Adapted from google-gemini/gemini-cli@c6bccb7ecbf6d8368d995455dd725ed34466faad,
 * packages/core/src/tools/mcp-compliance-transport.ts. */
import type {
  Transport,
  TransportSendOptions,
} from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

/** Repair legacy servers before SDK output-schema validation, retaining the owning transport. */
export class McpComplianceTransport implements Transport {
  onclose?: Transport["onclose"];
  onerror?: Transport["onerror"];
  onmessage?: Transport["onmessage"];

  constructor(readonly transport: Transport) {
    const previousMessage = transport.onmessage;
    const previousClose = transport.onclose;
    const previousError = transport.onerror;
    transport.onmessage = (message, extra) => {
      repairMcpStructuredContent(message);
      previousMessage?.(message, extra);
      this.onmessage?.(message, extra);
    };
    transport.onclose = () => {
      previousClose?.();
      this.onclose?.();
    };
    transport.onerror = (error) => {
      previousError?.(error);
      this.onerror?.(error);
    };
  }

  get sessionId(): string | undefined {
    return this.transport.sessionId;
  }
  setProtocolVersion(version: string): void {
    this.transport.setProtocolVersion?.(version);
  }
  async start(): Promise<void> {
    await this.transport.start();
  }
  async close(): Promise<void> {
    await this.transport.close();
  }
  async send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    await this.transport.send(message, options);
  }
}

export function repairMcpStructuredContent(message: JSONRPCMessage): void {
  if (!("result" in message)) return;
  const result = message.result;
  if (!result || typeof result !== "object" || Array.isArray(result)) return;
  if (result.structuredContent) return;
  const content = result.content;
  if (!Array.isArray(content) || content.length === 0) return;
  const first: unknown = content[0];
  if (
    !first ||
    typeof first !== "object" ||
    !("type" in first) ||
    first.type !== "text" ||
    !("text" in first) ||
    typeof first.text !== "string"
  )
    return;
  try {
    result.structuredContent = JSON.parse(first.text);
  } catch {
    // Plain text remains plain text, matching the source repair behavior.
  }
}
