// From OpenHands/software-agent-sdk@0a9abc87641ad7ffe02e2dadf5e2cb3976b35217:tests/integration/tests/a01_unmatched_tool_use.py (atlas AGENT-LOOP-0094). Converted to strict TypeScript; uses the native OpenAI-compatible diagnostic transport.
import type { CompliancePattern } from "./base.js";
export const UnmatchedToolUseTest: CompliancePattern = {
  pattern_name: "unmatched_tool_use",
  pattern_description:
    "\nSends a conversation where an assistant message contains a tool_use (tool_calls),\nbut no tool_result (tool message) follows before the next user message.\n\nThis pattern can occur when:\n- ObservationEvent is delayed or lost\n- User message arrives before observation is recorded\n- Event sync issues during conversation resume\n",
  buildMalformedMessages: () => [
    {
      role: "system",
      content: "You are a helpful assistant.",
    },
    {
      role: "user",
      content: "List the files in the current directory.",
    },
    {
      role: "assistant",
      content: "I'll list the files for you.",
      tool_calls: [
        {
          id: "call_abc123",
          type: "function",
          function: {
            name: "terminal",
            arguments: '{"command": "ls -la"}',
          },
        },
      ],
    },
    {
      role: "user",
      content: "What was the result?",
    },
  ],
};
