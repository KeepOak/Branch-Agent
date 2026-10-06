// From OpenHands/software-agent-sdk@0a9abc87641ad7ffe02e2dadf5e2cb3976b35217:tests/sdk/context/view/properties/test_tool_call_matching.py (atlas AGENT-LOOP-0093). Pinned inputs and complete invariant outputs from the passing upstream tests.
import type { Fixture } from "./view.test-support.js";
export const fixtures: Fixture[] = [
  {
    "name": "TestToolCallMatchingPropertyEnforcement::test_empty_list",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [],
    "all": [],
    "expected": []
  },
  {
    "name": "TestToolCallMatchingPropertyEnforcement::test_no_tool_events",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "6ddd1631-f3e0-4361-b974-a465a88305d0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "First message"
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
        "id": "4d9cd9cf-d7f1-4232-82ac-c90ee605e698",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Second message"
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
        "id": "6ddd1631-f3e0-4361-b974-a465a88305d0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "First message"
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
        "id": "4d9cd9cf-d7f1-4232-82ac-c90ee605e698",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Second message"
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
    "expected": []
  },
  {
    "name": "TestToolCallMatchingPropertyEnforcement::test_matched_pairs",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "ba73a835-1876-4306-87de-7f2f3dee7c41",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Test message"
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
        "llmResponseId": "response_1",
        "thinking": false
      },
      {
        "id": "obs_1",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1"
      },
      {
        "id": "action_2",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_2",
        "llmResponseId": "response_2",
        "thinking": false
      },
      {
        "id": "obs_2",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_2"
      }
    ],
    "all": [
      {
        "id": "ba73a835-1876-4306-87de-7f2f3dee7c41",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Test message"
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
        "llmResponseId": "response_1",
        "thinking": false
      },
      {
        "id": "obs_1",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1"
      },
      {
        "id": "action_2",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_2",
        "llmResponseId": "response_2",
        "thinking": false
      },
      {
        "id": "obs_2",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_2"
      }
    ],
    "expected": []
  },
  {
    "name": "TestToolCallMatchingPropertyEnforcement::test_unmatched_action",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "6536b9be-04cf-4e2c-a4cb-746f7ca379f5",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Test message"
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
        "llmResponseId": "response_1",
        "thinking": false
      },
      {
        "id": "obs_1",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1"
      },
      {
        "id": "action_2",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_2",
        "llmResponseId": "response_2",
        "thinking": false
      }
    ],
    "all": [
      {
        "id": "6536b9be-04cf-4e2c-a4cb-746f7ca379f5",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Test message"
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
        "llmResponseId": "response_1",
        "thinking": false
      },
      {
        "id": "obs_1",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1"
      },
      {
        "id": "action_2",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_2",
        "llmResponseId": "response_2",
        "thinking": false
      }
    ],
    "expected": [
      "action_2"
    ]
  },
  {
    "name": "TestToolCallMatchingPropertyEnforcement::test_unmatched_observation",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "e1cf11ed-c5da-4610-9983-e814bc06a61f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Test message"
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
        "llmResponseId": "response_1",
        "thinking": false
      },
      {
        "id": "obs_1",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1"
      },
      {
        "id": "obs_2",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_2"
      }
    ],
    "all": [
      {
        "id": "e1cf11ed-c5da-4610-9983-e814bc06a61f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Test message"
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
        "llmResponseId": "response_1",
        "thinking": false
      },
      {
        "id": "obs_1",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1"
      },
      {
        "id": "obs_2",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_2"
      }
    ],
    "expected": [
      "obs_2"
    ]
  },
  {
    "name": "TestToolCallMatchingPropertyEnforcement::test_mixed_scenario",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "c1f0fb35-7544-4132-959a-d8878e062106",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Message 1"
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
        "llmResponseId": "response_1",
        "thinking": false
      },
      {
        "id": "obs_1",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1"
      },
      {
        "id": "action_unmatched",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_2",
        "llmResponseId": "response_2",
        "thinking": false
      },
      {
        "id": "obs_unmatched",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_3"
      },
      {
        "id": "afb2a4ef-19e5-4456-a690-3c2664af1f80",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Message 2"
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
        "toolCallId": "call_4",
        "llmResponseId": "response_3",
        "thinking": false
      },
      {
        "id": "obs_2",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_4"
      }
    ],
    "all": [
      {
        "id": "c1f0fb35-7544-4132-959a-d8878e062106",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Message 1"
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
        "llmResponseId": "response_1",
        "thinking": false
      },
      {
        "id": "obs_1",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1"
      },
      {
        "id": "action_unmatched",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_2",
        "llmResponseId": "response_2",
        "thinking": false
      },
      {
        "id": "obs_unmatched",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_3"
      },
      {
        "id": "afb2a4ef-19e5-4456-a690-3c2664af1f80",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Message 2"
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
        "toolCallId": "call_4",
        "llmResponseId": "response_3",
        "thinking": false
      },
      {
        "id": "obs_2",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_4"
      }
    ],
    "expected": [
      "action_unmatched",
      "obs_unmatched"
    ]
  },
  {
    "name": "TestToolCallMatchingPropertyEnforcement::test_with_user_reject_observation",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "5e02004e-1aa3-4b1d-abd4-34b6aad8ec49",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "First message"
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
        "llmResponseId": "response_1",
        "thinking": false
      },
      {
        "id": "902ab6dc-433f-4f61-969a-2caf3bc9b425",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1",
        "source": "environment"
      },
      {
        "id": "d64b028b-23ab-412a-909a-d6cc392f4ee4",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Second message"
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
        "id": "5e02004e-1aa3-4b1d-abd4-34b6aad8ec49",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "First message"
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
        "llmResponseId": "response_1",
        "thinking": false
      },
      {
        "id": "902ab6dc-433f-4f61-969a-2caf3bc9b425",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1",
        "source": "environment"
      },
      {
        "id": "d64b028b-23ab-412a-909a-d6cc392f4ee4",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Second message"
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
    "expected": []
  },
  {
    "name": "TestToolCallMatchingPropertyEnforcement::test_with_agent_error_event",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "bf4f1acd-ed45-4b6a-b476-62523f10e10b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "First message"
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
        "llmResponseId": "response_1",
        "thinking": false
      },
      {
        "id": "5938ee7c-7806-4062-9ec6-53005eb4866e",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1",
        "source": "agent"
      },
      {
        "id": "99e11443-2ba3-4882-ade9-318527aa285b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Second message"
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
        "id": "bf4f1acd-ed45-4b6a-b476-62523f10e10b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "First message"
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
        "llmResponseId": "response_1",
        "thinking": false
      },
      {
        "id": "5938ee7c-7806-4062-9ec6-53005eb4866e",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1",
        "source": "agent"
      },
      {
        "id": "99e11443-2ba3-4882-ade9-318527aa285b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Second message"
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
    "expected": []
  },
  {
    "name": "TestToolCallMatchingPropertyEnforcement::test_mixed_observation_types",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "e1290985-ae28-4121-98cd-297d9a5a4301",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Start"
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
        "llmResponseId": "response_1",
        "thinking": false
      },
      {
        "id": "obs_1",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1"
      },
      {
        "id": "action_2",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_2",
        "llmResponseId": "response_2",
        "thinking": false
      },
      {
        "id": "aa0b3445-f13a-4191-922d-6c645bd47b88",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_2",
        "source": "environment"
      },
      {
        "id": "action_3",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_3",
        "llmResponseId": "response_3",
        "thinking": false
      },
      {
        "id": "d7fd28e7-2918-459b-9926-49666c1d05e3",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_3",
        "source": "agent"
      },
      {
        "id": "bb5085aa-51db-4f01-935b-81b0b62b825c",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "End"
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
        "id": "e1290985-ae28-4121-98cd-297d9a5a4301",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Start"
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
        "llmResponseId": "response_1",
        "thinking": false
      },
      {
        "id": "obs_1",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1"
      },
      {
        "id": "action_2",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_2",
        "llmResponseId": "response_2",
        "thinking": false
      },
      {
        "id": "aa0b3445-f13a-4191-922d-6c645bd47b88",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_2",
        "source": "environment"
      },
      {
        "id": "action_3",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_3",
        "llmResponseId": "response_3",
        "thinking": false
      },
      {
        "id": "d7fd28e7-2918-459b-9926-49666c1d05e3",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_3",
        "source": "agent"
      },
      {
        "id": "bb5085aa-51db-4f01-935b-81b0b62b825c",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "End"
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
    "expected": []
  },
  {
    "name": "TestToolCallMatchingPropertyEnforcement::test_action_with_none_action_matched_by_agent_error",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "49b0f791-7ea1-4302-a180-53bce61a6bad",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "hi"
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
        "toolCallId": "call_keep_me",
        "llmResponseId": "resp_1",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "89060217-6035-4143-84e2-0a86d9146527",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_keep_me",
        "source": "agent"
      },
      {
        "id": "b69778fe-e46e-4033-9997-072e5ca42192",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "bye"
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
        "id": "49b0f791-7ea1-4302-a180-53bce61a6bad",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "hi"
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
        "toolCallId": "call_keep_me",
        "llmResponseId": "resp_1",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "89060217-6035-4143-84e2-0a86d9146527",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_keep_me",
        "source": "agent"
      },
      {
        "id": "b69778fe-e46e-4033-9997-072e5ca42192",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "bye"
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
    "expected": []
  },
  {
    "name": "TestToolCallMatchingPropertyManipulationIndices::test_single_event_complete_indices",
    "op": "manipulation_indices",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "55459647-7a52-43e2-a1b7-629ae2554960",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Test"
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
    "name": "TestToolCallMatchingPropertyManipulationIndices::test_matched_pair_no_index_between",
    "op": "manipulation_indices",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "action_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_1",
        "llmResponseId": "response_1",
        "thinking": false
      },
      {
        "id": "obs_1",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1"
      }
    ],
    "all": null,
    "expected": [
      0,
      2
    ]
  },
  {
    "name": "TestToolCallMatchingPropertyManipulationIndices::test_allow_index_between_pairs",
    "op": "manipulation_indices",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "action_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_1",
        "llmResponseId": "response_1",
        "thinking": false
      },
      {
        "id": "obs_1",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1"
      },
      {
        "id": "action_2",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_2",
        "llmResponseId": "response_2",
        "thinking": false
      },
      {
        "id": "obs_2",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_2"
      }
    ],
    "all": null,
    "expected": [
      0,
      2,
      4
    ]
  },
  {
    "name": "TestToolCallMatchingPropertyManipulationIndices::test_empty_events",
    "op": "manipulation_indices",
    "property": "ToolCallMatchingProperty",
    "input": [],
    "all": null,
    "expected": [
      0
    ]
  },
  {
    "name": "TestToolCallMatchingPropertyManipulationIndices::test_view_tolerates_orphaned_agent_error",
    "op": "manipulation_indices",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "5be84a78-ab0b-4c5f-8717-d5c9b41f034b",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "orphaned_call",
        "source": "agent"
      },
      {
        "id": "8c34e642-c32d-4777-8342-53ff51a9d620",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Continue"
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
      1,
      2
    ]
  },
  {
    "name": "TestToolCallMatchingPropertyManipulationIndices::test_view_tolerates_orphaned_agent_error",
    "op": "manipulation_indices",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "5be84a78-ab0b-4c5f-8717-d5c9b41f034b",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "orphaned_call",
        "source": "agent"
      },
      {
        "id": "8c34e642-c32d-4777-8342-53ff51a9d620",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Continue"
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
      1,
      2
    ]
  },
  {
    "name": "TestToolCallMatchingPropertyManipulationIndices::test_view_tolerates_orphaned_agent_error",
    "op": "manipulation_indices",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "5be84a78-ab0b-4c5f-8717-d5c9b41f034b",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "orphaned_call",
        "source": "agent"
      },
      {
        "id": "8c34e642-c32d-4777-8342-53ff51a9d620",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Continue"
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
      1,
      2
    ]
  },
  {
    "name": "TestToolCallMatchingPropertyManipulationIndices::test_view_tolerates_orphaned_agent_error",
    "op": "manipulation_indices",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "5be84a78-ab0b-4c5f-8717-d5c9b41f034b",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "orphaned_call",
        "source": "agent"
      },
      {
        "id": "8c34e642-c32d-4777-8342-53ff51a9d620",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Continue"
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
      1,
      2
    ]
  },
  {
    "name": "TestToolCallMatchingPropertyManipulationIndices::test_orphan_does_not_resolve_another_pending_action",
    "op": "manipulation_indices",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "d5fb5ede-2374-403d-ad80-f06f841fb7ab",
        "kind": "action",
        "convertible": true,
        "toolCallId": "pending_call",
        "llmResponseId": "response",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "915fe272-302b-4826-8977-544fbb44b6e0",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "orphaned_call",
        "source": "agent"
      },
      {
        "id": "4ad09059-0235-43ca-8114-27e8960ae367",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "pending_call",
        "source": "environment"
      }
    ],
    "all": null,
    "expected": [
      0,
      1,
      2,
      3
    ]
  },
  {
    "name": "TestToolCallMatchingPropertyManipulationIndices::test_orphan_does_not_resolve_another_pending_action",
    "op": "manipulation_indices",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "d5fb5ede-2374-403d-ad80-f06f841fb7ab",
        "kind": "action",
        "convertible": true,
        "toolCallId": "pending_call",
        "llmResponseId": "response",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "915fe272-302b-4826-8977-544fbb44b6e0",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "orphaned_call",
        "source": "agent"
      },
      {
        "id": "4ad09059-0235-43ca-8114-27e8960ae367",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "pending_call",
        "source": "environment"
      }
    ],
    "all": null,
    "expected": [
      0,
      1,
      2,
      3
    ]
  },
  {
    "name": "TestToolCallMatchingPropertyManipulationIndices::test_orphan_does_not_resolve_another_pending_action",
    "op": "manipulation_indices",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "d5fb5ede-2374-403d-ad80-f06f841fb7ab",
        "kind": "action",
        "convertible": true,
        "toolCallId": "pending_call",
        "llmResponseId": "response",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "915fe272-302b-4826-8977-544fbb44b6e0",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "orphaned_call",
        "source": "agent"
      },
      {
        "id": "4ad09059-0235-43ca-8114-27e8960ae367",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "pending_call",
        "source": "environment"
      }
    ],
    "all": null,
    "expected": [
      0,
      3
    ]
  },
  {
    "name": "TestToolCallMatchingPropertyManipulationIndices::test_orphan_does_not_resolve_another_pending_action",
    "op": "manipulation_indices",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "d5fb5ede-2374-403d-ad80-f06f841fb7ab",
        "kind": "action",
        "convertible": true,
        "toolCallId": "pending_call",
        "llmResponseId": "response",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "915fe272-302b-4826-8977-544fbb44b6e0",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "orphaned_call",
        "source": "agent"
      },
      {
        "id": "4ad09059-0235-43ca-8114-27e8960ae367",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "pending_call",
        "source": "environment"
      }
    ],
    "all": null,
    "expected": [
      0,
      1,
      2,
      3
    ]
  },
  {
    "name": "TestToolCallMatchingPropertyManipulationIndices::test_duplicate_observation_does_not_crash_manipulation_indices",
    "op": "manipulation_indices",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "109a923e-4c72-4a41-aed4-75b437b2eff9",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call",
        "llmResponseId": "response",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "fbfb0be0-c448-4d5a-8efb-e22fd6f2c1a9",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call",
        "source": "environment"
      },
      {
        "id": "add26986-f751-4526-830d-6043c5293296",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call",
        "source": "environment"
      }
    ],
    "all": null,
    "expected": [
      0,
      1,
      2,
      3
    ]
  },
  {
    "name": "TestToolCallMatchingPropertyManipulationIndices::test_duplicate_observation_does_not_crash_manipulation_indices",
    "op": "manipulation_indices",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "109a923e-4c72-4a41-aed4-75b437b2eff9",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call",
        "llmResponseId": "response",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "fbfb0be0-c448-4d5a-8efb-e22fd6f2c1a9",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call",
        "source": "environment"
      },
      {
        "id": "add26986-f751-4526-830d-6043c5293296",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call",
        "source": "environment"
      }
    ],
    "all": null,
    "expected": [
      0,
      1,
      2,
      3
    ]
  },
  {
    "name": "TestToolCallMatchingPropertyManipulationIndices::test_duplicate_observation_does_not_crash_manipulation_indices",
    "op": "manipulation_indices",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "109a923e-4c72-4a41-aed4-75b437b2eff9",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call",
        "llmResponseId": "response",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "fbfb0be0-c448-4d5a-8efb-e22fd6f2c1a9",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call",
        "source": "environment"
      },
      {
        "id": "add26986-f751-4526-830d-6043c5293296",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call",
        "source": "environment"
      }
    ],
    "all": null,
    "expected": [
      0,
      2,
      3
    ]
  },
  {
    "name": "TestToolCallMatchingPropertyManipulationIndices::test_duplicate_observation_does_not_crash_manipulation_indices",
    "op": "manipulation_indices",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "109a923e-4c72-4a41-aed4-75b437b2eff9",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call",
        "llmResponseId": "response",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "fbfb0be0-c448-4d5a-8efb-e22fd6f2c1a9",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call",
        "source": "environment"
      },
      {
        "id": "add26986-f751-4526-830d-6043c5293296",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call",
        "source": "environment"
      }
    ],
    "all": null,
    "expected": [
      0,
      1,
      2,
      3
    ]
  },
  {
    "name": "TestToolCallMatchingPropertyManipulationIndices::test_duplicate_observation_does_not_crash_manipulation_indices",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "109a923e-4c72-4a41-aed4-75b437b2eff9",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call",
        "llmResponseId": "response",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "fbfb0be0-c448-4d5a-8efb-e22fd6f2c1a9",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call",
        "source": "environment"
      },
      {
        "id": "add26986-f751-4526-830d-6043c5293296",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call",
        "source": "environment"
      }
    ],
    "all": [
      {
        "id": "109a923e-4c72-4a41-aed4-75b437b2eff9",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call",
        "llmResponseId": "response",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "fbfb0be0-c448-4d5a-8efb-e22fd6f2c1a9",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call",
        "source": "environment"
      },
      {
        "id": "add26986-f751-4526-830d-6043c5293296",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call",
        "source": "environment"
      }
    ],
    "expected": [
      "add26986-f751-4526-830d-6043c5293296"
    ]
  },
  {
    "name": "TestToolCallMatchingPropertyManipulationIndices::test_duplicate_observation_does_not_crash_manipulation_indices",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "109a923e-4c72-4a41-aed4-75b437b2eff9",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call",
        "llmResponseId": "response",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "fbfb0be0-c448-4d5a-8efb-e22fd6f2c1a9",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call",
        "source": "environment"
      }
    ],
    "all": [
      {
        "id": "109a923e-4c72-4a41-aed4-75b437b2eff9",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call",
        "llmResponseId": "response",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "fbfb0be0-c448-4d5a-8efb-e22fd6f2c1a9",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call",
        "source": "environment"
      },
      {
        "id": "add26986-f751-4526-830d-6043c5293296",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call",
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "TestToolCallMatchingPropertyManipulationIndices::test_duplicate_observation_does_not_crash_manipulation_indices",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "109a923e-4c72-4a41-aed4-75b437b2eff9",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call",
        "llmResponseId": "response",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "fbfb0be0-c448-4d5a-8efb-e22fd6f2c1a9",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call",
        "source": "environment"
      }
    ],
    "all": [
      {
        "id": "109a923e-4c72-4a41-aed4-75b437b2eff9",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call",
        "llmResponseId": "response",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "fbfb0be0-c448-4d5a-8efb-e22fd6f2c1a9",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call",
        "source": "environment"
      },
      {
        "id": "add26986-f751-4526-830d-6043c5293296",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call",
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "TestToolCallMatchingPropertyManipulationIndices::test_duplicate_observation_does_not_crash_manipulation_indices",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "109a923e-4c72-4a41-aed4-75b437b2eff9",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call",
        "llmResponseId": "response",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "fbfb0be0-c448-4d5a-8efb-e22fd6f2c1a9",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call",
        "source": "environment"
      }
    ],
    "all": [
      {
        "id": "109a923e-4c72-4a41-aed4-75b437b2eff9",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call",
        "llmResponseId": "response",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "fbfb0be0-c448-4d5a-8efb-e22fd6f2c1a9",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call",
        "source": "environment"
      },
      {
        "id": "add26986-f751-4526-830d-6043c5293296",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call",
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "TestToolCallMatchingPropertyManipulationIndices::test_duplicate_observation_does_not_crash_manipulation_indices",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "109a923e-4c72-4a41-aed4-75b437b2eff9",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call",
        "llmResponseId": "response",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "fbfb0be0-c448-4d5a-8efb-e22fd6f2c1a9",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call",
        "source": "environment"
      }
    ],
    "all": [
      {
        "id": "109a923e-4c72-4a41-aed4-75b437b2eff9",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call",
        "llmResponseId": "response",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "fbfb0be0-c448-4d5a-8efb-e22fd6f2c1a9",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call",
        "source": "environment"
      },
      {
        "id": "add26986-f751-4526-830d-6043c5293296",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call",
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "TestToolCallMatchingPropertyManipulationIndices::test_duplicate_observation_does_not_crash_manipulation_indices",
    "op": "from_events",
    "input": [
      {
        "id": "109a923e-4c72-4a41-aed4-75b437b2eff9",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call",
        "llmResponseId": "response",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "fbfb0be0-c448-4d5a-8efb-e22fd6f2c1a9",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call",
        "source": "environment"
      },
      {
        "id": "add26986-f751-4526-830d-6043c5293296",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call",
        "source": "environment"
      }
    ],
    "expected": [
      {
        "id": "109a923e-4c72-4a41-aed4-75b437b2eff9",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call",
        "llmResponseId": "response",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "fbfb0be0-c448-4d5a-8efb-e22fd6f2c1a9",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call",
        "source": "environment"
      }
    ],
    "unhandled": false
  }
];
