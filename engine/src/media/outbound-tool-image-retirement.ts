// Source: Hermes18d125cc context_compressor.py send-path image retirement helpers.
import { outboundImageRetireCount } from "./image-eviction-policy.ts";
type Message = Record<string, unknown>;
function record(value: unknown): value is Message {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function imagePart(part: unknown): part is Message {
  return record(part) && ["image_url", "input_image", "image"].includes(String(part.type));
}
function parts(content: unknown): unknown {
  return record(content) && content._multimodal ? content.content : content;
}
function payload(message: Message): [number, number] {
  const content = parts(message.content);
  if (!Array.isArray(content)) { return [0, 0]; }
  let blocks = 0; let bytes = 0;
  for (const part of content) {
    if (!imagePart(part)) { continue; }
    blocks++;
    const imageUrl = part.image_url;
    const source = part.source;
    const data = (record(imageUrl) ? imageUrl.url : imageUrl) || (record(source) ? source.data : null) || "";
    bytes += typeof data === "string" ? data.length : 0;
  }
  return [blocks, bytes];
}
function strip(message: Message): Message | null {
  const content = message.content;
  let next: unknown;
  if (record(content) && content._multimodal) {
    next = `[screenshot removed] ${String(content.text_summary || "[screenshot removed to save context]").slice(0, 200)}`;
  } else if (Array.isArray(content) && content.some(imagePart)) {
    next = content.map((part) => imagePart(part) ? { type: "text", text: "[screenshot removed to save context]" } : part);
  } else { return null; }
  const rewritten: Message = { ...message, content: next };
  delete rewritten.api_content;
  return rewritten;
}
/** Source OpenAI-shaped send list only. Makes a fresh list and changed message copies;
 * never changes persisted history. Unchanged message/part objects retain identity. */
export function retireOutboundToolImages(messages: readonly Message[]): { messages: Message[]; retired: number } {
  const carriers: { index: number; blocks: number; bytes: number }[] = [];
  let reservedBlocks = 0; let reservedBytes = 0;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    const [blocks, bytes] = payload(message);
    if (!blocks) { continue; }
    if (message.role === "tool") { carriers.push({ index, blocks, bytes }); }
    else { reservedBlocks += blocks; reservedBytes += bytes; }
  }
  const retire = outboundImageRetireCount(carriers.map((carrier) => carrier.blocks), reservedBlocks,
    { carrierBytesNewestFirst: carriers.map((carrier) => carrier.bytes), reservedBytes });
  const output = [...messages]; let retired = 0;
  for (const carrier of carriers.slice(carriers.length - retire)) {
    const rewritten = strip(messages[carrier.index]!);
    if (rewritten) { output[carrier.index] = rewritten; retired++; }
  }
  return { messages: output, retired };
}
