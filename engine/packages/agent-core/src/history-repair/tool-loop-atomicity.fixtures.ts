// From OpenHands/software-agent-sdk@0a9abc87641ad7ffe02e2dadf5e2cb3976b35217:tests/sdk/context/view/properties/test_tool_loop_atomicity.py (atlas AGENT-LOOP-0093). Pinned inputs and complete invariant outputs from the passing upstream tests.
import type { Fixture } from "./view.test-support.js";
export const fixtures: Fixture[] = [
  {
    "name": "TestToolLoopAtomicityPropertyEnforcement::test_partial_tool_loop_forgotten",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "action_2",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_2",
        "llmResponseId": "resp_2",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "obs_2",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_2",
        "source": "environment"
      }
    ],
    "all": [
      {
        "id": "action_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_1",
        "llmResponseId": "resp_1",
        "thinking": true,
        "source": "agent"
      },
      {
        "id": "obs_1",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1",
        "source": "environment"
      },
      {
        "id": "action_2",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_2",
        "llmResponseId": "resp_2",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "obs_2",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_2",
        "source": "environment"
      }
    ],
    "expected": [
      "action_2",
      "obs_2"
    ]
  },
  {
    "name": "TestToolLoopAtomicityPropertyEnforcement::test_complete_tool_loop_forgotten",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [],
    "all": [
      {
        "id": "action_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_1",
        "llmResponseId": "resp_1",
        "thinking": true,
        "source": "agent"
      },
      {
        "id": "obs_1",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1",
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "TestToolLoopAtomicityPropertyEnforcement::test_no_forgetting_preserves_tool_loop",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "action_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_1",
        "llmResponseId": "resp_1",
        "thinking": true,
        "source": "agent"
      },
      {
        "id": "obs_1",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1",
        "source": "environment"
      },
      {
        "id": "action_2",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_2",
        "llmResponseId": "resp_2",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "obs_2",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_2",
        "source": "environment"
      }
    ],
    "all": [
      {
        "id": "action_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_1",
        "llmResponseId": "resp_1",
        "thinking": true,
        "source": "agent"
      },
      {
        "id": "obs_1",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1",
        "source": "environment"
      },
      {
        "id": "action_2",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_2",
        "llmResponseId": "resp_2",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "obs_2",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_2",
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "TestToolLoopAtomicityPropertyEnforcement::test_tool_loop_between_non_tool_loop_events",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "obs_1",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1",
        "source": "environment"
      },
      {
        "id": "action_2",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_2",
        "llmResponseId": "resp_2",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "obs_2",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_2",
        "source": "environment"
      },
      {
        "id": "msg_2",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Another user message"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      }
    ],
    "all": [
      {
        "id": "msg_1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "User message"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "action_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_1",
        "llmResponseId": "resp_1",
        "thinking": true,
        "source": "agent"
      },
      {
        "id": "obs_1",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1",
        "source": "environment"
      },
      {
        "id": "action_2",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_2",
        "llmResponseId": "resp_2",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "obs_2",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_2",
        "source": "environment"
      },
      {
        "id": "msg_2",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Another user message"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      }
    ],
    "expected": [
      "action_2",
      "obs_1",
      "obs_2"
    ]
  },
  {
    "name": "TestToolLoopAtomicityPropertyEnforcement::test_first_event_of_tool_loop_forgotten",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "obs_1",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1",
        "source": "environment"
      },
      {
        "id": "action_2",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_2",
        "llmResponseId": "resp_2",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "obs_2",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_2",
        "source": "environment"
      }
    ],
    "all": [
      {
        "id": "action_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_1",
        "llmResponseId": "resp_1",
        "thinking": true,
        "source": "agent"
      },
      {
        "id": "obs_1",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1",
        "source": "environment"
      },
      {
        "id": "action_2",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_2",
        "llmResponseId": "resp_2",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "obs_2",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_2",
        "source": "environment"
      }
    ],
    "expected": [
      "action_2",
      "obs_1",
      "obs_2"
    ]
  },
  {
    "name": "TestToolLoopAtomicityPropertyEnforcement::test_middle_event_of_tool_loop_forgotten",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "action_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_1",
        "llmResponseId": "resp_1",
        "thinking": true,
        "source": "agent"
      },
      {
        "id": "action_2",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_2",
        "llmResponseId": "resp_2",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "obs_2",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_2",
        "source": "environment"
      }
    ],
    "all": [
      {
        "id": "action_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_1",
        "llmResponseId": "resp_1",
        "thinking": true,
        "source": "agent"
      },
      {
        "id": "obs_1",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1",
        "source": "environment"
      },
      {
        "id": "action_2",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_2",
        "llmResponseId": "resp_2",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "obs_2",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_2",
        "source": "environment"
      }
    ],
    "expected": [
      "action_1",
      "action_2",
      "obs_2"
    ]
  },
  {
    "name": "TestToolLoopAtomicityPropertyEnforcement::test_multiple_separate_tool_loops",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "action_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_1",
        "llmResponseId": "resp_1",
        "thinking": true,
        "source": "agent"
      },
      {
        "id": "obs_1",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1",
        "source": "environment"
      },
      {
        "id": "msg_1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "User message"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "obs_2",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_2",
        "source": "environment"
      }
    ],
    "all": [
      {
        "id": "action_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_1",
        "llmResponseId": "resp_1",
        "thinking": true,
        "source": "agent"
      },
      {
        "id": "obs_1",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1",
        "source": "environment"
      },
      {
        "id": "msg_1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "User message"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "action_2",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_2",
        "llmResponseId": "resp_2",
        "thinking": true,
        "source": "agent"
      },
      {
        "id": "obs_2",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_2",
        "source": "environment"
      }
    ],
    "expected": [
      "obs_2"
    ]
  },
  {
    "name": "TestToolLoopAtomicityPropertyEnforcement::test_single_action_observation_pair",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "action_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_1",
        "llmResponseId": "resp_1",
        "thinking": true,
        "source": "agent"
      },
      {
        "id": "obs_1",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1",
        "source": "environment"
      }
    ],
    "all": [
      {
        "id": "action_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_1",
        "llmResponseId": "resp_1",
        "thinking": true,
        "source": "agent"
      },
      {
        "id": "obs_1",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1",
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "TestToolLoopAtomicityPropertyEnforcement::test_single_action_forgotten",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [],
    "all": [
      {
        "id": "action_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_1",
        "llmResponseId": "resp_1",
        "thinking": true,
        "source": "agent"
      },
      {
        "id": "obs_1",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1",
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "TestToolLoopAtomicityPropertyEnforcement::test_actions_without_thinking_are_not_tool_loops",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "action_2",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_2",
        "llmResponseId": "resp_2",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "obs_2",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_2",
        "source": "environment"
      }
    ],
    "all": [
      {
        "id": "action_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_1",
        "llmResponseId": "resp_1",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "obs_1",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1",
        "source": "environment"
      },
      {
        "id": "action_2",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_2",
        "llmResponseId": "resp_2",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "obs_2",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_2",
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "TestToolLoopAtomicityPropertyManipulationIndices::test_no_manipulation_within_tool_loop",
    "op": "manipulation_indices",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "action_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_1",
        "llmResponseId": "resp_1",
        "thinking": true,
        "source": "agent"
      },
      {
        "id": "obs_1",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1",
        "source": "environment"
      },
      {
        "id": "action_2",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_2",
        "llmResponseId": "resp_2",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "obs_2",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_2",
        "source": "environment"
      }
    ],
    "all": null,
    "expected": [
      0,
      4
    ]
  },
  {
    "name": "TestToolLoopAtomicityPropertyManipulationIndices::test_manipulation_allowed_between_tool_loops",
    "op": "manipulation_indices",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "action_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_1",
        "llmResponseId": "resp_1",
        "thinking": true,
        "source": "agent"
      },
      {
        "id": "obs_1",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1",
        "source": "environment"
      },
      {
        "id": "msg_1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "User message"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "action_2",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_2",
        "llmResponseId": "resp_2",
        "thinking": true,
        "source": "agent"
      },
      {
        "id": "obs_2",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_2",
        "source": "environment"
      }
    ],
    "all": null,
    "expected": [
      0,
      2,
      3,
      5
    ]
  },
  {
    "name": "TestToolLoopAtomicityPropertyManipulationIndices::test_manipulation_allowed_before_first_tool_loop",
    "op": "manipulation_indices",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "msg_1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "User message"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "action_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_1",
        "llmResponseId": "resp_1",
        "thinking": true,
        "source": "agent"
      },
      {
        "id": "obs_1",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1",
        "source": "environment"
      }
    ],
    "all": null,
    "expected": [
      0,
      1,
      3
    ]
  },
  {
    "name": "TestToolLoopAtomicityPropertyManipulationIndices::test_single_event_complete_indices",
    "op": "manipulation_indices",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "msg_1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "User message"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      }
    ],
    "all": null,
    "expected": [
      0,
      1
    ]
  },
  {
    "name": "TestToolLoopAtomicityPropertyManipulationIndices::test_empty_events_complete_indices",
    "op": "manipulation_indices",
    "property": "ToolLoopAtomicityProperty",
    "input": [],
    "all": null,
    "expected": [
      0
    ]
  },
  {
    "name": "TestToolLoopAtomicityPropertyManipulationIndices::test_tool_loop_with_message_breaks_at_boundary",
    "op": "manipulation_indices",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "action_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_1",
        "llmResponseId": "resp_1",
        "thinking": true,
        "source": "agent"
      },
      {
        "id": "obs_1",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1",
        "source": "environment"
      },
      {
        "id": "msg_1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "User message"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "action_2",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_2",
        "llmResponseId": "resp_2",
        "thinking": true,
        "source": "agent"
      },
      {
        "id": "obs_2",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_2",
        "source": "environment"
      }
    ],
    "all": null,
    "expected": [
      0,
      2,
      3,
      5
    ]
  },
  {
    "name": "TestToolLoopAtomicityPropertyManipulationIndices::test_parallel_actions_in_tool_loop",
    "op": "manipulation_indices",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "action_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_1a",
        "llmResponseId": "resp_1",
        "thinking": true,
        "source": "agent"
      },
      {
        "id": "action_1b",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_1b",
        "llmResponseId": "resp_1",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "obs_1a",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1a",
        "source": "environment"
      },
      {
        "id": "obs_1b",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1b",
        "source": "environment"
      }
    ],
    "all": null,
    "expected": [
      0,
      4
    ]
  },
  {
    "name": "TestToolLoopAtomicityPropertyManipulationIndices::test_no_tool_loop_without_thinking_blocks",
    "op": "manipulation_indices",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "action_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_1",
        "llmResponseId": "resp_1",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "obs_1",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1",
        "source": "environment"
      },
      {
        "id": "action_2",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_2",
        "llmResponseId": "resp_2",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "obs_2",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_2",
        "source": "environment"
      }
    ],
    "all": null,
    "expected": [
      0,
      1,
      2,
      3,
      4
    ]
  }
];
