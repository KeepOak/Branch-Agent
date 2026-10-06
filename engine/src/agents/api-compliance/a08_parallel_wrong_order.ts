// From OpenHands/software-agent-sdk@0a9abc87641ad7ffe02e2dadf5e2cb3976b35217:tests/integration/tests/a08_parallel_wrong_order.py (atlas AGENT-LOOP-0094). Converted to strict TypeScript; uses the native OpenAI-compatible diagnostic transport.
import type { CompliancePattern } from "./base.js";
export const ParallelWrongOrderTest: CompliancePattern = {
  pattern_name: "parallel_wrong_order",
  pattern_description:
    "\nSends a conversation where tool_results appear before the assistant message\nthat contains the corresponding tool_calls. This is a severe ordering violation.\n\nThis pattern might occur with:\n- Severe event ordering bugs\n- Manual conversation manipulation\n- Corrupted event stream\n",
  buildMalformedMessages: () => [
    {
      role: "system",
      content: "You are a helpful assistant.",
    },
    {
      role: "user",
      content: "Check the weather in SF and Tokyo.",
    },
    {
      role: "tool",
      content: "San Francisco: 65\u00b0F, Sunny",
      tool_call_id: "call_sf",
    },
    {
      role: "tool",
      content: "Tokyo: 72\u00b0F, Cloudy",
      tool_call_id: "call_tokyo",
    },
    {
      role: "assistant",
      content: "I'll check both cities.",
      tool_calls: [
        {
          id: "call_sf",
          type: "function",
          function: {
            name: "terminal",
            arguments: '{"command": "weather sf"}',
          },
        },
        {
          id: "call_tokyo",
          type: "function",
          function: {
            name: "terminal",
            arguments: '{"command": "weather tokyo"}',
          },
        },
      ],
    },
  ],
};
