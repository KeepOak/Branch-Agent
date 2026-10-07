import { describe, expect, it } from "vitest";
import { parseRelayDescriptor, relaySupportsOp, relayTextLength, splitRelayText } from "./descriptor.js";

const descriptor = {
  contract_version: 1,
  platform: "discord",
  label: "Discord",
  max_message_length: 2000,
  supports_draft_streaming: false,
  supports_edit: true,
  supports_threads: true,
  markdown_dialect: "discord",
  len_unit: "utf16",
};

describe("Hermes relay capability descriptor", () => {
  it("advertises descriptor max length and counts UTF-16 units", () => {
    const parsed = parseRelayDescriptor(descriptor);
    expect(parsed.maxMessageLength).toBe(2000);
    expect(relayTextLength(parsed, "🚀")).toBe(2);
  });

  it("uses Hermes 4096 fallback and legacy ops for malformed optional fields", () => {
    const parsed = parseRelayDescriptor({ ...descriptor, max_message_length: "no limit", supported_ops: false, future_bit: true });
    expect(parsed.maxMessageLength).toBe(4096);
    expect(relaySupportsOp(parsed, "send")).toBe(true);
    expect(relaySupportsOp(parsed, "delete")).toBe(false);
  });

  it("uses advertised ops when present", () => {
    const parsed = parseRelayDescriptor({ ...descriptor, supported_ops: ["send", "typing", "", 12] });
    expect(parsed.supportedOps).toEqual(["send", "typing"]);
    expect(relaySupportsOp(parsed, "edit")).toBe(false);
  });

  it("chunks by the negotiated unit without splitting an emoji surrogate pair", () => {
    const utf16 = parseRelayDescriptor({ ...descriptor, max_message_length: 3 });
    expect(splitRelayText(utf16, "A🚀B")).toEqual(["A🚀", "B"]);
    const chars = parseRelayDescriptor({ ...descriptor, max_message_length: 2, len_unit: "chars" });
    expect(splitRelayText(chars, "A🚀B")).toEqual(["A🚀", "B"]);
  });
});
