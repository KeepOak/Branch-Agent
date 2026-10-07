// From OpenHands/software-agent-sdk@0a9abc87641ad7ffe02e2dadf5e2cb3976b35217:tests/sdk/context/view/test_view.py (atlas AGENT-LOOP-0093). Pinned inputs and complete invariant outputs from the passing upstream tests.
import type { Fixture } from "./view.test-support.js";
export const fixtures: Fixture[] = [
  {
    "name": "test_view_preserves_uncondensed_lists",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "6afcf944-6de9-4540-af1a-267b0274f973",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "84d884b9-f429-4e1c-9427-5d226b9af2c3",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "45206e07-9e2c-44aa-a7e7-54671a651768",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "06dceff6-adb2-4028-9db4-0c847a1f3642",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "03e14039-6470-4f16-a317-1403f6e16b4b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "6afcf944-6de9-4540-af1a-267b0274f973",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "84d884b9-f429-4e1c-9427-5d226b9af2c3",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "45206e07-9e2c-44aa-a7e7-54671a651768",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "06dceff6-adb2-4028-9db4-0c847a1f3642",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "03e14039-6470-4f16-a317-1403f6e16b4b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
    "name": "test_view_preserves_uncondensed_lists",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "6afcf944-6de9-4540-af1a-267b0274f973",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "84d884b9-f429-4e1c-9427-5d226b9af2c3",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "45206e07-9e2c-44aa-a7e7-54671a651768",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "06dceff6-adb2-4028-9db4-0c847a1f3642",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "03e14039-6470-4f16-a317-1403f6e16b4b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "6afcf944-6de9-4540-af1a-267b0274f973",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "84d884b9-f429-4e1c-9427-5d226b9af2c3",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "45206e07-9e2c-44aa-a7e7-54671a651768",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "06dceff6-adb2-4028-9db4-0c847a1f3642",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "03e14039-6470-4f16-a317-1403f6e16b4b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
    "name": "test_view_preserves_uncondensed_lists",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "6afcf944-6de9-4540-af1a-267b0274f973",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "84d884b9-f429-4e1c-9427-5d226b9af2c3",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "45206e07-9e2c-44aa-a7e7-54671a651768",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "06dceff6-adb2-4028-9db4-0c847a1f3642",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "03e14039-6470-4f16-a317-1403f6e16b4b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "6afcf944-6de9-4540-af1a-267b0274f973",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "84d884b9-f429-4e1c-9427-5d226b9af2c3",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "45206e07-9e2c-44aa-a7e7-54671a651768",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "06dceff6-adb2-4028-9db4-0c847a1f3642",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "03e14039-6470-4f16-a317-1403f6e16b4b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
    "name": "test_view_preserves_uncondensed_lists",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "6afcf944-6de9-4540-af1a-267b0274f973",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "84d884b9-f429-4e1c-9427-5d226b9af2c3",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "45206e07-9e2c-44aa-a7e7-54671a651768",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "06dceff6-adb2-4028-9db4-0c847a1f3642",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "03e14039-6470-4f16-a317-1403f6e16b4b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "6afcf944-6de9-4540-af1a-267b0274f973",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "84d884b9-f429-4e1c-9427-5d226b9af2c3",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "45206e07-9e2c-44aa-a7e7-54671a651768",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "06dceff6-adb2-4028-9db4-0c847a1f3642",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "03e14039-6470-4f16-a317-1403f6e16b4b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
    "name": "test_view_preserves_uncondensed_lists",
    "op": "from_events",
    "input": [
      {
        "id": "6afcf944-6de9-4540-af1a-267b0274f973",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "84d884b9-f429-4e1c-9427-5d226b9af2c3",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "45206e07-9e2c-44aa-a7e7-54671a651768",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "06dceff6-adb2-4028-9db4-0c847a1f3642",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "03e14039-6470-4f16-a317-1403f6e16b4b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
      {
        "id": "6afcf944-6de9-4540-af1a-267b0274f973",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "84d884b9-f429-4e1c-9427-5d226b9af2c3",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "45206e07-9e2c-44aa-a7e7-54671a651768",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "06dceff6-adb2-4028-9db4-0c847a1f3642",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "03e14039-6470-4f16-a317-1403f6e16b4b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
    "unhandled": false
  },
  {
    "name": "test_view_forgets_events",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [],
    "all": [
      {
        "id": "8da985fb-0e11-4292-8e74-415d6e4dd218",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "07135f22-a0bc-4ee9-945f-8aacbc2bd55b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "9180eed8-03ce-4aef-8474-d9be85232f49",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "06e61c2e-1e4f-47fc-bf3a-bafae6eb53d2",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "18fb0762-77c4-417a-8bd7-0de65201683b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "25857d89-365b-4ffb-86d7-b131ed5a365b",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "06e61c2e-1e4f-47fc-bf3a-bafae6eb53d2",
          "07135f22-a0bc-4ee9-945f-8aacbc2bd55b",
          "18fb0762-77c4-417a-8bd7-0de65201683b",
          "8da985fb-0e11-4292-8e74-415d6e4dd218",
          "9180eed8-03ce-4aef-8474-d9be85232f49"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_view_forgets_events",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [],
    "all": [
      {
        "id": "8da985fb-0e11-4292-8e74-415d6e4dd218",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "07135f22-a0bc-4ee9-945f-8aacbc2bd55b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "9180eed8-03ce-4aef-8474-d9be85232f49",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "06e61c2e-1e4f-47fc-bf3a-bafae6eb53d2",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "18fb0762-77c4-417a-8bd7-0de65201683b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "25857d89-365b-4ffb-86d7-b131ed5a365b",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "06e61c2e-1e4f-47fc-bf3a-bafae6eb53d2",
          "07135f22-a0bc-4ee9-945f-8aacbc2bd55b",
          "18fb0762-77c4-417a-8bd7-0de65201683b",
          "8da985fb-0e11-4292-8e74-415d6e4dd218",
          "9180eed8-03ce-4aef-8474-d9be85232f49"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_view_forgets_events",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [],
    "all": [
      {
        "id": "8da985fb-0e11-4292-8e74-415d6e4dd218",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "07135f22-a0bc-4ee9-945f-8aacbc2bd55b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "9180eed8-03ce-4aef-8474-d9be85232f49",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "06e61c2e-1e4f-47fc-bf3a-bafae6eb53d2",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "18fb0762-77c4-417a-8bd7-0de65201683b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "25857d89-365b-4ffb-86d7-b131ed5a365b",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "06e61c2e-1e4f-47fc-bf3a-bafae6eb53d2",
          "07135f22-a0bc-4ee9-945f-8aacbc2bd55b",
          "18fb0762-77c4-417a-8bd7-0de65201683b",
          "8da985fb-0e11-4292-8e74-415d6e4dd218",
          "9180eed8-03ce-4aef-8474-d9be85232f49"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_view_forgets_events",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [],
    "all": [
      {
        "id": "8da985fb-0e11-4292-8e74-415d6e4dd218",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "07135f22-a0bc-4ee9-945f-8aacbc2bd55b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "9180eed8-03ce-4aef-8474-d9be85232f49",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "06e61c2e-1e4f-47fc-bf3a-bafae6eb53d2",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "18fb0762-77c4-417a-8bd7-0de65201683b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "25857d89-365b-4ffb-86d7-b131ed5a365b",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "06e61c2e-1e4f-47fc-bf3a-bafae6eb53d2",
          "07135f22-a0bc-4ee9-945f-8aacbc2bd55b",
          "18fb0762-77c4-417a-8bd7-0de65201683b",
          "8da985fb-0e11-4292-8e74-415d6e4dd218",
          "9180eed8-03ce-4aef-8474-d9be85232f49"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_view_forgets_events",
    "op": "from_events",
    "input": [
      {
        "id": "8da985fb-0e11-4292-8e74-415d6e4dd218",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "07135f22-a0bc-4ee9-945f-8aacbc2bd55b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "9180eed8-03ce-4aef-8474-d9be85232f49",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "06e61c2e-1e4f-47fc-bf3a-bafae6eb53d2",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "18fb0762-77c4-417a-8bd7-0de65201683b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "25857d89-365b-4ffb-86d7-b131ed5a365b",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "06e61c2e-1e4f-47fc-bf3a-bafae6eb53d2",
          "07135f22-a0bc-4ee9-945f-8aacbc2bd55b",
          "18fb0762-77c4-417a-8bd7-0de65201683b",
          "8da985fb-0e11-4292-8e74-415d6e4dd218",
          "9180eed8-03ce-4aef-8474-d9be85232f49"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": [],
    "unhandled": false
  },
  {
    "name": "test_view_keeps_non_forgotten_events",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "dadf412a-fd6f-4b8a-8869-80be6c7a0a90",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "7dd08c12-6a6d-46e4-b865-763095077738",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "a51c4f47-8ea6-482d-9f95-24b39f648772",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "dadf412a-fd6f-4b8a-8869-80be6c7a0a90",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "7dd08c12-6a6d-46e4-b865-763095077738",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "a51c4f47-8ea6-482d-9f95-24b39f648772",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "57421f32-cfb2-4880-b32b-ad66f88b8354",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_view_keeps_non_forgotten_events",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "dadf412a-fd6f-4b8a-8869-80be6c7a0a90",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "7dd08c12-6a6d-46e4-b865-763095077738",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "a51c4f47-8ea6-482d-9f95-24b39f648772",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "dadf412a-fd6f-4b8a-8869-80be6c7a0a90",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "7dd08c12-6a6d-46e4-b865-763095077738",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "a51c4f47-8ea6-482d-9f95-24b39f648772",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "57421f32-cfb2-4880-b32b-ad66f88b8354",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_view_keeps_non_forgotten_events",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "dadf412a-fd6f-4b8a-8869-80be6c7a0a90",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "7dd08c12-6a6d-46e4-b865-763095077738",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "a51c4f47-8ea6-482d-9f95-24b39f648772",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "dadf412a-fd6f-4b8a-8869-80be6c7a0a90",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "7dd08c12-6a6d-46e4-b865-763095077738",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "a51c4f47-8ea6-482d-9f95-24b39f648772",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "57421f32-cfb2-4880-b32b-ad66f88b8354",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_view_keeps_non_forgotten_events",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "dadf412a-fd6f-4b8a-8869-80be6c7a0a90",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "7dd08c12-6a6d-46e4-b865-763095077738",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "a51c4f47-8ea6-482d-9f95-24b39f648772",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "dadf412a-fd6f-4b8a-8869-80be6c7a0a90",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "7dd08c12-6a6d-46e4-b865-763095077738",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "a51c4f47-8ea6-482d-9f95-24b39f648772",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "57421f32-cfb2-4880-b32b-ad66f88b8354",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_view_keeps_non_forgotten_events",
    "op": "from_events",
    "input": [
      {
        "id": "dadf412a-fd6f-4b8a-8869-80be6c7a0a90",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "7dd08c12-6a6d-46e4-b865-763095077738",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "a51c4f47-8ea6-482d-9f95-24b39f648772",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "57421f32-cfb2-4880-b32b-ad66f88b8354",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": [
      {
        "id": "dadf412a-fd6f-4b8a-8869-80be6c7a0a90",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "7dd08c12-6a6d-46e4-b865-763095077738",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "a51c4f47-8ea6-482d-9f95-24b39f648772",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
    "unhandled": false
  },
  {
    "name": "test_view_keeps_non_forgotten_events",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "dadf412a-fd6f-4b8a-8869-80be6c7a0a90",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "7dd08c12-6a6d-46e4-b865-763095077738",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "a51c4f47-8ea6-482d-9f95-24b39f648772",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "dadf412a-fd6f-4b8a-8869-80be6c7a0a90",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "7dd08c12-6a6d-46e4-b865-763095077738",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "a51c4f47-8ea6-482d-9f95-24b39f648772",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "29acaaad-0544-4900-b91b-d39c9267df57",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_view_keeps_non_forgotten_events",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "dadf412a-fd6f-4b8a-8869-80be6c7a0a90",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "7dd08c12-6a6d-46e4-b865-763095077738",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "a51c4f47-8ea6-482d-9f95-24b39f648772",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "dadf412a-fd6f-4b8a-8869-80be6c7a0a90",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "7dd08c12-6a6d-46e4-b865-763095077738",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "a51c4f47-8ea6-482d-9f95-24b39f648772",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "29acaaad-0544-4900-b91b-d39c9267df57",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_view_keeps_non_forgotten_events",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "dadf412a-fd6f-4b8a-8869-80be6c7a0a90",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "7dd08c12-6a6d-46e4-b865-763095077738",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "a51c4f47-8ea6-482d-9f95-24b39f648772",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "dadf412a-fd6f-4b8a-8869-80be6c7a0a90",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "7dd08c12-6a6d-46e4-b865-763095077738",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "a51c4f47-8ea6-482d-9f95-24b39f648772",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "29acaaad-0544-4900-b91b-d39c9267df57",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_view_keeps_non_forgotten_events",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "dadf412a-fd6f-4b8a-8869-80be6c7a0a90",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "7dd08c12-6a6d-46e4-b865-763095077738",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "a51c4f47-8ea6-482d-9f95-24b39f648772",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "dadf412a-fd6f-4b8a-8869-80be6c7a0a90",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "7dd08c12-6a6d-46e4-b865-763095077738",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "a51c4f47-8ea6-482d-9f95-24b39f648772",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "29acaaad-0544-4900-b91b-d39c9267df57",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_view_keeps_non_forgotten_events",
    "op": "from_events",
    "input": [
      {
        "id": "dadf412a-fd6f-4b8a-8869-80be6c7a0a90",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "7dd08c12-6a6d-46e4-b865-763095077738",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "a51c4f47-8ea6-482d-9f95-24b39f648772",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "29acaaad-0544-4900-b91b-d39c9267df57",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": [
      {
        "id": "dadf412a-fd6f-4b8a-8869-80be6c7a0a90",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "7dd08c12-6a6d-46e4-b865-763095077738",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "a51c4f47-8ea6-482d-9f95-24b39f648772",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
    "unhandled": false
  },
  {
    "name": "test_view_keeps_non_forgotten_events",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "7dd08c12-6a6d-46e4-b865-763095077738",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "a51c4f47-8ea6-482d-9f95-24b39f648772",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "dadf412a-fd6f-4b8a-8869-80be6c7a0a90",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "7dd08c12-6a6d-46e4-b865-763095077738",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "a51c4f47-8ea6-482d-9f95-24b39f648772",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "78d14bf1-fdad-4b59-bae5-2f050256bc56",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "dadf412a-fd6f-4b8a-8869-80be6c7a0a90"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_view_keeps_non_forgotten_events",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "7dd08c12-6a6d-46e4-b865-763095077738",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "a51c4f47-8ea6-482d-9f95-24b39f648772",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "dadf412a-fd6f-4b8a-8869-80be6c7a0a90",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "7dd08c12-6a6d-46e4-b865-763095077738",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "a51c4f47-8ea6-482d-9f95-24b39f648772",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "78d14bf1-fdad-4b59-bae5-2f050256bc56",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "dadf412a-fd6f-4b8a-8869-80be6c7a0a90"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_view_keeps_non_forgotten_events",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "7dd08c12-6a6d-46e4-b865-763095077738",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "a51c4f47-8ea6-482d-9f95-24b39f648772",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "dadf412a-fd6f-4b8a-8869-80be6c7a0a90",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "7dd08c12-6a6d-46e4-b865-763095077738",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "a51c4f47-8ea6-482d-9f95-24b39f648772",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "78d14bf1-fdad-4b59-bae5-2f050256bc56",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "dadf412a-fd6f-4b8a-8869-80be6c7a0a90"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_view_keeps_non_forgotten_events",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "7dd08c12-6a6d-46e4-b865-763095077738",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "a51c4f47-8ea6-482d-9f95-24b39f648772",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "dadf412a-fd6f-4b8a-8869-80be6c7a0a90",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "7dd08c12-6a6d-46e4-b865-763095077738",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "a51c4f47-8ea6-482d-9f95-24b39f648772",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "78d14bf1-fdad-4b59-bae5-2f050256bc56",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "dadf412a-fd6f-4b8a-8869-80be6c7a0a90"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_view_keeps_non_forgotten_events",
    "op": "from_events",
    "input": [
      {
        "id": "dadf412a-fd6f-4b8a-8869-80be6c7a0a90",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "7dd08c12-6a6d-46e4-b865-763095077738",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "a51c4f47-8ea6-482d-9f95-24b39f648772",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "78d14bf1-fdad-4b59-bae5-2f050256bc56",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "dadf412a-fd6f-4b8a-8869-80be6c7a0a90"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": [
      {
        "id": "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "7dd08c12-6a6d-46e4-b865-763095077738",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "a51c4f47-8ea6-482d-9f95-24b39f648772",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
    "unhandled": false
  },
  {
    "name": "test_view_keeps_non_forgotten_events",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "dadf412a-fd6f-4b8a-8869-80be6c7a0a90",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "7dd08c12-6a6d-46e4-b865-763095077738",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "dadf412a-fd6f-4b8a-8869-80be6c7a0a90",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "7dd08c12-6a6d-46e4-b865-763095077738",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "a51c4f47-8ea6-482d-9f95-24b39f648772",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "d43e5d83-e3a9-499d-a114-1827bbd3e315",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "a51c4f47-8ea6-482d-9f95-24b39f648772"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_view_keeps_non_forgotten_events",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "dadf412a-fd6f-4b8a-8869-80be6c7a0a90",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "7dd08c12-6a6d-46e4-b865-763095077738",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "dadf412a-fd6f-4b8a-8869-80be6c7a0a90",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "7dd08c12-6a6d-46e4-b865-763095077738",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "a51c4f47-8ea6-482d-9f95-24b39f648772",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "d43e5d83-e3a9-499d-a114-1827bbd3e315",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "a51c4f47-8ea6-482d-9f95-24b39f648772"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_view_keeps_non_forgotten_events",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "dadf412a-fd6f-4b8a-8869-80be6c7a0a90",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "7dd08c12-6a6d-46e4-b865-763095077738",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "dadf412a-fd6f-4b8a-8869-80be6c7a0a90",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "7dd08c12-6a6d-46e4-b865-763095077738",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "a51c4f47-8ea6-482d-9f95-24b39f648772",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "d43e5d83-e3a9-499d-a114-1827bbd3e315",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "a51c4f47-8ea6-482d-9f95-24b39f648772"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_view_keeps_non_forgotten_events",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "dadf412a-fd6f-4b8a-8869-80be6c7a0a90",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "7dd08c12-6a6d-46e4-b865-763095077738",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "dadf412a-fd6f-4b8a-8869-80be6c7a0a90",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "7dd08c12-6a6d-46e4-b865-763095077738",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "a51c4f47-8ea6-482d-9f95-24b39f648772",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "d43e5d83-e3a9-499d-a114-1827bbd3e315",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "a51c4f47-8ea6-482d-9f95-24b39f648772"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_view_keeps_non_forgotten_events",
    "op": "from_events",
    "input": [
      {
        "id": "dadf412a-fd6f-4b8a-8869-80be6c7a0a90",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "7dd08c12-6a6d-46e4-b865-763095077738",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "a51c4f47-8ea6-482d-9f95-24b39f648772",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "d43e5d83-e3a9-499d-a114-1827bbd3e315",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "a51c4f47-8ea6-482d-9f95-24b39f648772"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": [
      {
        "id": "dadf412a-fd6f-4b8a-8869-80be6c7a0a90",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "7dd08c12-6a6d-46e4-b865-763095077738",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
    "unhandled": false
  },
  {
    "name": "test_view_keeps_non_forgotten_events",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "dadf412a-fd6f-4b8a-8869-80be6c7a0a90",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "a51c4f47-8ea6-482d-9f95-24b39f648772",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "dadf412a-fd6f-4b8a-8869-80be6c7a0a90",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "7dd08c12-6a6d-46e4-b865-763095077738",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "a51c4f47-8ea6-482d-9f95-24b39f648772",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "3e39a0af-70a6-4a9f-9d72-ebee3f7be17c",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "7dd08c12-6a6d-46e4-b865-763095077738"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_view_keeps_non_forgotten_events",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "dadf412a-fd6f-4b8a-8869-80be6c7a0a90",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "a51c4f47-8ea6-482d-9f95-24b39f648772",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "dadf412a-fd6f-4b8a-8869-80be6c7a0a90",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "7dd08c12-6a6d-46e4-b865-763095077738",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "a51c4f47-8ea6-482d-9f95-24b39f648772",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "3e39a0af-70a6-4a9f-9d72-ebee3f7be17c",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "7dd08c12-6a6d-46e4-b865-763095077738"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_view_keeps_non_forgotten_events",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "dadf412a-fd6f-4b8a-8869-80be6c7a0a90",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "a51c4f47-8ea6-482d-9f95-24b39f648772",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "dadf412a-fd6f-4b8a-8869-80be6c7a0a90",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "7dd08c12-6a6d-46e4-b865-763095077738",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "a51c4f47-8ea6-482d-9f95-24b39f648772",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "3e39a0af-70a6-4a9f-9d72-ebee3f7be17c",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "7dd08c12-6a6d-46e4-b865-763095077738"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_view_keeps_non_forgotten_events",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "dadf412a-fd6f-4b8a-8869-80be6c7a0a90",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "a51c4f47-8ea6-482d-9f95-24b39f648772",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "dadf412a-fd6f-4b8a-8869-80be6c7a0a90",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "7dd08c12-6a6d-46e4-b865-763095077738",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "a51c4f47-8ea6-482d-9f95-24b39f648772",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "3e39a0af-70a6-4a9f-9d72-ebee3f7be17c",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "7dd08c12-6a6d-46e4-b865-763095077738"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_view_keeps_non_forgotten_events",
    "op": "from_events",
    "input": [
      {
        "id": "dadf412a-fd6f-4b8a-8869-80be6c7a0a90",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "7dd08c12-6a6d-46e4-b865-763095077738",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "a51c4f47-8ea6-482d-9f95-24b39f648772",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "3e39a0af-70a6-4a9f-9d72-ebee3f7be17c",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "7dd08c12-6a6d-46e4-b865-763095077738"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": [
      {
        "id": "dadf412a-fd6f-4b8a-8869-80be6c7a0a90",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d9ee6d3a-9ec1-4be8-ac8e-981f1a4fb9ca",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "a51c4f47-8ea6-482d-9f95-24b39f648772",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "c48bbad4-eb5d-4aa4-a7ea-d62910c303f1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
    "unhandled": false
  },
  {
    "name": "test_view_inserts_summary",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "7acd475b-1b95-4fff-a32f-c5171972f9ff-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "My Summary",
        "source": "environment"
      },
      {
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "7acd475b-1b95-4fff-a32f-c5171972f9ff",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "My Summary",
        "offset": 0,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_view_inserts_summary",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "7acd475b-1b95-4fff-a32f-c5171972f9ff-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "My Summary",
        "source": "environment"
      },
      {
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "7acd475b-1b95-4fff-a32f-c5171972f9ff",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "My Summary",
        "offset": 0,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_view_inserts_summary",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "7acd475b-1b95-4fff-a32f-c5171972f9ff-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "My Summary",
        "source": "environment"
      },
      {
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "7acd475b-1b95-4fff-a32f-c5171972f9ff",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "My Summary",
        "offset": 0,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_view_inserts_summary",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "7acd475b-1b95-4fff-a32f-c5171972f9ff-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "My Summary",
        "source": "environment"
      },
      {
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "7acd475b-1b95-4fff-a32f-c5171972f9ff",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "My Summary",
        "offset": 0,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_view_inserts_summary",
    "op": "from_events",
    "input": [
      {
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "7acd475b-1b95-4fff-a32f-c5171972f9ff",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "My Summary",
        "offset": 0,
        "source": "environment"
      }
    ],
    "expected": [
      {
        "id": "7acd475b-1b95-4fff-a32f-c5171972f9ff-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "My Summary",
        "source": "environment"
      },
      {
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
    "unhandled": false
  },
  {
    "name": "test_view_inserts_summary",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "89a1eaa1-5ff0-4e6a-bbf2-6f198a93bec3-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "My Summary",
        "source": "environment"
      },
      {
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "89a1eaa1-5ff0-4e6a-bbf2-6f198a93bec3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "My Summary",
        "offset": 1,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_view_inserts_summary",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "89a1eaa1-5ff0-4e6a-bbf2-6f198a93bec3-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "My Summary",
        "source": "environment"
      },
      {
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "89a1eaa1-5ff0-4e6a-bbf2-6f198a93bec3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "My Summary",
        "offset": 1,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_view_inserts_summary",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "89a1eaa1-5ff0-4e6a-bbf2-6f198a93bec3-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "My Summary",
        "source": "environment"
      },
      {
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "89a1eaa1-5ff0-4e6a-bbf2-6f198a93bec3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "My Summary",
        "offset": 1,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_view_inserts_summary",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "89a1eaa1-5ff0-4e6a-bbf2-6f198a93bec3-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "My Summary",
        "source": "environment"
      },
      {
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "89a1eaa1-5ff0-4e6a-bbf2-6f198a93bec3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "My Summary",
        "offset": 1,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_view_inserts_summary",
    "op": "from_events",
    "input": [
      {
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "89a1eaa1-5ff0-4e6a-bbf2-6f198a93bec3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "My Summary",
        "offset": 1,
        "source": "environment"
      }
    ],
    "expected": [
      {
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "89a1eaa1-5ff0-4e6a-bbf2-6f198a93bec3-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "My Summary",
        "source": "environment"
      },
      {
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
    "unhandled": false
  },
  {
    "name": "test_view_inserts_summary",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "3e3f0f8c-5be5-4e7c-bc55-89704872c092-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "My Summary",
        "source": "environment"
      },
      {
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "3e3f0f8c-5be5-4e7c-bc55-89704872c092",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "My Summary",
        "offset": 2,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_view_inserts_summary",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "3e3f0f8c-5be5-4e7c-bc55-89704872c092-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "My Summary",
        "source": "environment"
      },
      {
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "3e3f0f8c-5be5-4e7c-bc55-89704872c092",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "My Summary",
        "offset": 2,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_view_inserts_summary",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "3e3f0f8c-5be5-4e7c-bc55-89704872c092-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "My Summary",
        "source": "environment"
      },
      {
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "3e3f0f8c-5be5-4e7c-bc55-89704872c092",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "My Summary",
        "offset": 2,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_view_inserts_summary",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "3e3f0f8c-5be5-4e7c-bc55-89704872c092-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "My Summary",
        "source": "environment"
      },
      {
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "3e3f0f8c-5be5-4e7c-bc55-89704872c092",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "My Summary",
        "offset": 2,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_view_inserts_summary",
    "op": "from_events",
    "input": [
      {
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "3e3f0f8c-5be5-4e7c-bc55-89704872c092",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "My Summary",
        "offset": 2,
        "source": "environment"
      }
    ],
    "expected": [
      {
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "3e3f0f8c-5be5-4e7c-bc55-89704872c092-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "My Summary",
        "source": "environment"
      },
      {
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
    "unhandled": false
  },
  {
    "name": "test_view_inserts_summary",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "bfdb1aa9-a06a-4755-a33a-cd46befc9684-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "My Summary",
        "source": "environment"
      },
      {
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "bfdb1aa9-a06a-4755-a33a-cd46befc9684",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "My Summary",
        "offset": 3,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_view_inserts_summary",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "bfdb1aa9-a06a-4755-a33a-cd46befc9684-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "My Summary",
        "source": "environment"
      },
      {
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "bfdb1aa9-a06a-4755-a33a-cd46befc9684",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "My Summary",
        "offset": 3,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_view_inserts_summary",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "bfdb1aa9-a06a-4755-a33a-cd46befc9684-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "My Summary",
        "source": "environment"
      },
      {
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "bfdb1aa9-a06a-4755-a33a-cd46befc9684",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "My Summary",
        "offset": 3,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_view_inserts_summary",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "bfdb1aa9-a06a-4755-a33a-cd46befc9684-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "My Summary",
        "source": "environment"
      },
      {
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "bfdb1aa9-a06a-4755-a33a-cd46befc9684",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "My Summary",
        "offset": 3,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_view_inserts_summary",
    "op": "from_events",
    "input": [
      {
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "bfdb1aa9-a06a-4755-a33a-cd46befc9684",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "My Summary",
        "offset": 3,
        "source": "environment"
      }
    ],
    "expected": [
      {
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "bfdb1aa9-a06a-4755-a33a-cd46befc9684-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "My Summary",
        "source": "environment"
      },
      {
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
    "unhandled": false
  },
  {
    "name": "test_view_inserts_summary",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "d6e12e9f-2d3e-4b1e-84b7-bb3fed417fde-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "My Summary",
        "source": "environment"
      },
      {
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "d6e12e9f-2d3e-4b1e-84b7-bb3fed417fde",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "My Summary",
        "offset": 4,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_view_inserts_summary",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "d6e12e9f-2d3e-4b1e-84b7-bb3fed417fde-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "My Summary",
        "source": "environment"
      },
      {
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "d6e12e9f-2d3e-4b1e-84b7-bb3fed417fde",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "My Summary",
        "offset": 4,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_view_inserts_summary",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "d6e12e9f-2d3e-4b1e-84b7-bb3fed417fde-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "My Summary",
        "source": "environment"
      },
      {
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "d6e12e9f-2d3e-4b1e-84b7-bb3fed417fde",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "My Summary",
        "offset": 4,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_view_inserts_summary",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "d6e12e9f-2d3e-4b1e-84b7-bb3fed417fde-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "My Summary",
        "source": "environment"
      },
      {
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "d6e12e9f-2d3e-4b1e-84b7-bb3fed417fde",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "My Summary",
        "offset": 4,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_view_inserts_summary",
    "op": "from_events",
    "input": [
      {
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
        "id": "d6e12e9f-2d3e-4b1e-84b7-bb3fed417fde",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "My Summary",
        "offset": 4,
        "source": "environment"
      }
    ],
    "expected": [
      {
        "id": "d946ef7b-9565-49ea-b995-331673f2ecb0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "338728ad-5034-401b-b41d-f32e61ee7b11",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "90610f09-64d4-478d-8f52-d3986fbeec8f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "78f1100e-95b5-490d-8fcf-c6567991b4bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "d6e12e9f-2d3e-4b1e-84b7-bb3fed417fde-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "My Summary",
        "source": "environment"
      },
      {
        "id": "9f46a53f-d4de-41c2-bc38-f8c327ead6da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 4"
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
    "unhandled": false
  },
  {
    "name": "test_no_condensation_action_in_view",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "a1a15f7a-84f3-4995-a41e-976fb3b6a104",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "ee2bf042-12ac-4c7b-8430-50d4c45f958c",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "c33e910b-8222-4aab-8b19-f02d3e85e48a",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "5f4fe6c8-83b0-4fac-82c5-c8788e6a7b09",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "a1a15f7a-84f3-4995-a41e-976fb3b6a104",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "38f97e99-565d-42a2-a8fd-d7091c7005be",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "5f4fe6c8-83b0-4fac-82c5-c8788e6a7b09"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      },
      {
        "id": "ee2bf042-12ac-4c7b-8430-50d4c45f958c",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "c33e910b-8222-4aab-8b19-f02d3e85e48a",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
    "name": "test_no_condensation_action_in_view",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "a1a15f7a-84f3-4995-a41e-976fb3b6a104",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "ee2bf042-12ac-4c7b-8430-50d4c45f958c",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "c33e910b-8222-4aab-8b19-f02d3e85e48a",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "5f4fe6c8-83b0-4fac-82c5-c8788e6a7b09",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "a1a15f7a-84f3-4995-a41e-976fb3b6a104",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "38f97e99-565d-42a2-a8fd-d7091c7005be",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "5f4fe6c8-83b0-4fac-82c5-c8788e6a7b09"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      },
      {
        "id": "ee2bf042-12ac-4c7b-8430-50d4c45f958c",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "c33e910b-8222-4aab-8b19-f02d3e85e48a",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
    "name": "test_no_condensation_action_in_view",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "a1a15f7a-84f3-4995-a41e-976fb3b6a104",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "ee2bf042-12ac-4c7b-8430-50d4c45f958c",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "c33e910b-8222-4aab-8b19-f02d3e85e48a",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "5f4fe6c8-83b0-4fac-82c5-c8788e6a7b09",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "a1a15f7a-84f3-4995-a41e-976fb3b6a104",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "38f97e99-565d-42a2-a8fd-d7091c7005be",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "5f4fe6c8-83b0-4fac-82c5-c8788e6a7b09"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      },
      {
        "id": "ee2bf042-12ac-4c7b-8430-50d4c45f958c",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "c33e910b-8222-4aab-8b19-f02d3e85e48a",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
    "name": "test_no_condensation_action_in_view",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "a1a15f7a-84f3-4995-a41e-976fb3b6a104",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "ee2bf042-12ac-4c7b-8430-50d4c45f958c",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "c33e910b-8222-4aab-8b19-f02d3e85e48a",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "5f4fe6c8-83b0-4fac-82c5-c8788e6a7b09",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "a1a15f7a-84f3-4995-a41e-976fb3b6a104",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "38f97e99-565d-42a2-a8fd-d7091c7005be",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "5f4fe6c8-83b0-4fac-82c5-c8788e6a7b09"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      },
      {
        "id": "ee2bf042-12ac-4c7b-8430-50d4c45f958c",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "c33e910b-8222-4aab-8b19-f02d3e85e48a",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
    "name": "test_no_condensation_action_in_view",
    "op": "from_events",
    "input": [
      {
        "id": "5f4fe6c8-83b0-4fac-82c5-c8788e6a7b09",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "a1a15f7a-84f3-4995-a41e-976fb3b6a104",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "38f97e99-565d-42a2-a8fd-d7091c7005be",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "5f4fe6c8-83b0-4fac-82c5-c8788e6a7b09"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      },
      {
        "id": "ee2bf042-12ac-4c7b-8430-50d4c45f958c",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "c33e910b-8222-4aab-8b19-f02d3e85e48a",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
      {
        "id": "a1a15f7a-84f3-4995-a41e-976fb3b6a104",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "ee2bf042-12ac-4c7b-8430-50d4c45f958c",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "c33e910b-8222-4aab-8b19-f02d3e85e48a",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
    "unhandled": false
  },
  {
    "name": "test_unhandled_condensation_request_with_no_condensation",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "a60936c2-0022-4d4a-8cfb-58f46388354b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "b08ac17b-57b2-4417-8b8f-d5cbbffee496",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "d21f3ae8-5c1e-4ff4-a23d-8b5924b31502",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "a60936c2-0022-4d4a-8cfb-58f46388354b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "b08ac17b-57b2-4417-8b8f-d5cbbffee496",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "92f87a52-d9e8-4ca8-98a8-464d40f07a25",
        "kind": "request",
        "convertible": false,
        "source": "environment"
      },
      {
        "id": "d21f3ae8-5c1e-4ff4-a23d-8b5924b31502",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
    "name": "test_unhandled_condensation_request_with_no_condensation",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "a60936c2-0022-4d4a-8cfb-58f46388354b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "b08ac17b-57b2-4417-8b8f-d5cbbffee496",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "d21f3ae8-5c1e-4ff4-a23d-8b5924b31502",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "a60936c2-0022-4d4a-8cfb-58f46388354b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "b08ac17b-57b2-4417-8b8f-d5cbbffee496",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "92f87a52-d9e8-4ca8-98a8-464d40f07a25",
        "kind": "request",
        "convertible": false,
        "source": "environment"
      },
      {
        "id": "d21f3ae8-5c1e-4ff4-a23d-8b5924b31502",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
    "name": "test_unhandled_condensation_request_with_no_condensation",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "a60936c2-0022-4d4a-8cfb-58f46388354b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "b08ac17b-57b2-4417-8b8f-d5cbbffee496",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "d21f3ae8-5c1e-4ff4-a23d-8b5924b31502",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "a60936c2-0022-4d4a-8cfb-58f46388354b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "b08ac17b-57b2-4417-8b8f-d5cbbffee496",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "92f87a52-d9e8-4ca8-98a8-464d40f07a25",
        "kind": "request",
        "convertible": false,
        "source": "environment"
      },
      {
        "id": "d21f3ae8-5c1e-4ff4-a23d-8b5924b31502",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
    "name": "test_unhandled_condensation_request_with_no_condensation",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "a60936c2-0022-4d4a-8cfb-58f46388354b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "b08ac17b-57b2-4417-8b8f-d5cbbffee496",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "d21f3ae8-5c1e-4ff4-a23d-8b5924b31502",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "a60936c2-0022-4d4a-8cfb-58f46388354b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "b08ac17b-57b2-4417-8b8f-d5cbbffee496",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "92f87a52-d9e8-4ca8-98a8-464d40f07a25",
        "kind": "request",
        "convertible": false,
        "source": "environment"
      },
      {
        "id": "d21f3ae8-5c1e-4ff4-a23d-8b5924b31502",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
    "name": "test_unhandled_condensation_request_with_no_condensation",
    "op": "from_events",
    "input": [
      {
        "id": "a60936c2-0022-4d4a-8cfb-58f46388354b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "b08ac17b-57b2-4417-8b8f-d5cbbffee496",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "92f87a52-d9e8-4ca8-98a8-464d40f07a25",
        "kind": "request",
        "convertible": false,
        "source": "environment"
      },
      {
        "id": "d21f3ae8-5c1e-4ff4-a23d-8b5924b31502",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
      {
        "id": "a60936c2-0022-4d4a-8cfb-58f46388354b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "b08ac17b-57b2-4417-8b8f-d5cbbffee496",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "d21f3ae8-5c1e-4ff4-a23d-8b5924b31502",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
    "unhandled": true
  },
  {
    "name": "test_handled_condensation_request_with_condensation_action",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "23cddd2c-7747-4f57-a2ae-60e938ecc862",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "7f3fd04a-09ca-412c-92be-0b1a92ad2816",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "de8622af-bf16-4dc6-babf-ba2950d67a0a",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "00455561-d8a4-4f14-b55c-198a882eac4f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "de59d337-d194-4692-9603-94731e533edc",
        "kind": "request",
        "convertible": false,
        "source": "environment"
      },
      {
        "id": "23cddd2c-7747-4f57-a2ae-60e938ecc862",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "61cfe876-ee45-4c48-a366-05927fce9cf6",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "00455561-d8a4-4f14-b55c-198a882eac4f",
          "de8622af-bf16-4dc6-babf-ba2950d67a0a"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      },
      {
        "id": "7f3fd04a-09ca-412c-92be-0b1a92ad2816",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
    "name": "test_handled_condensation_request_with_condensation_action",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "23cddd2c-7747-4f57-a2ae-60e938ecc862",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "7f3fd04a-09ca-412c-92be-0b1a92ad2816",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "de8622af-bf16-4dc6-babf-ba2950d67a0a",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "00455561-d8a4-4f14-b55c-198a882eac4f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "de59d337-d194-4692-9603-94731e533edc",
        "kind": "request",
        "convertible": false,
        "source": "environment"
      },
      {
        "id": "23cddd2c-7747-4f57-a2ae-60e938ecc862",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "61cfe876-ee45-4c48-a366-05927fce9cf6",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "00455561-d8a4-4f14-b55c-198a882eac4f",
          "de8622af-bf16-4dc6-babf-ba2950d67a0a"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      },
      {
        "id": "7f3fd04a-09ca-412c-92be-0b1a92ad2816",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
    "name": "test_handled_condensation_request_with_condensation_action",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "23cddd2c-7747-4f57-a2ae-60e938ecc862",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "7f3fd04a-09ca-412c-92be-0b1a92ad2816",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "de8622af-bf16-4dc6-babf-ba2950d67a0a",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "00455561-d8a4-4f14-b55c-198a882eac4f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "de59d337-d194-4692-9603-94731e533edc",
        "kind": "request",
        "convertible": false,
        "source": "environment"
      },
      {
        "id": "23cddd2c-7747-4f57-a2ae-60e938ecc862",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "61cfe876-ee45-4c48-a366-05927fce9cf6",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "00455561-d8a4-4f14-b55c-198a882eac4f",
          "de8622af-bf16-4dc6-babf-ba2950d67a0a"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      },
      {
        "id": "7f3fd04a-09ca-412c-92be-0b1a92ad2816",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
    "name": "test_handled_condensation_request_with_condensation_action",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "23cddd2c-7747-4f57-a2ae-60e938ecc862",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "7f3fd04a-09ca-412c-92be-0b1a92ad2816",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "de8622af-bf16-4dc6-babf-ba2950d67a0a",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "00455561-d8a4-4f14-b55c-198a882eac4f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "de59d337-d194-4692-9603-94731e533edc",
        "kind": "request",
        "convertible": false,
        "source": "environment"
      },
      {
        "id": "23cddd2c-7747-4f57-a2ae-60e938ecc862",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "61cfe876-ee45-4c48-a366-05927fce9cf6",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "00455561-d8a4-4f14-b55c-198a882eac4f",
          "de8622af-bf16-4dc6-babf-ba2950d67a0a"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      },
      {
        "id": "7f3fd04a-09ca-412c-92be-0b1a92ad2816",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
    "name": "test_handled_condensation_request_with_condensation_action",
    "op": "from_events",
    "input": [
      {
        "id": "de8622af-bf16-4dc6-babf-ba2950d67a0a",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "00455561-d8a4-4f14-b55c-198a882eac4f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "de59d337-d194-4692-9603-94731e533edc",
        "kind": "request",
        "convertible": false,
        "source": "environment"
      },
      {
        "id": "23cddd2c-7747-4f57-a2ae-60e938ecc862",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "61cfe876-ee45-4c48-a366-05927fce9cf6",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "00455561-d8a4-4f14-b55c-198a882eac4f",
          "de8622af-bf16-4dc6-babf-ba2950d67a0a"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      },
      {
        "id": "7f3fd04a-09ca-412c-92be-0b1a92ad2816",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
      {
        "id": "23cddd2c-7747-4f57-a2ae-60e938ecc862",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "7f3fd04a-09ca-412c-92be-0b1a92ad2816",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
    "unhandled": false
  },
  {
    "name": "test_multiple_condensation_requests_pattern",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "b240b859-3aa8-4a53-aa28-39e032cfc93b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "5ace2b25-83c2-4970-94c6-befeea575f24",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "ec0a208c-0559-45bc-aae9-42c7596e7e1f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "85e5adb5-cc29-42b2-8d04-abf3bbf2bd2b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "b240b859-3aa8-4a53-aa28-39e032cfc93b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "13c75e6c-9ba6-49e2-b526-c184d8fef834",
        "kind": "request",
        "convertible": false,
        "source": "environment"
      },
      {
        "id": "5ace2b25-83c2-4970-94c6-befeea575f24",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "0386c09a-764a-4b9c-9321-ec5b0b4b6e31",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": null,
        "offset": null,
        "source": "environment"
      },
      {
        "id": "ec0a208c-0559-45bc-aae9-42c7596e7e1f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "4d4b39fd-b50e-4110-8c71-20c896e93591",
        "kind": "request",
        "convertible": false,
        "source": "environment"
      },
      {
        "id": "85e5adb5-cc29-42b2-8d04-abf3bbf2bd2b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
    "name": "test_multiple_condensation_requests_pattern",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "b240b859-3aa8-4a53-aa28-39e032cfc93b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "5ace2b25-83c2-4970-94c6-befeea575f24",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "ec0a208c-0559-45bc-aae9-42c7596e7e1f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "85e5adb5-cc29-42b2-8d04-abf3bbf2bd2b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "b240b859-3aa8-4a53-aa28-39e032cfc93b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "13c75e6c-9ba6-49e2-b526-c184d8fef834",
        "kind": "request",
        "convertible": false,
        "source": "environment"
      },
      {
        "id": "5ace2b25-83c2-4970-94c6-befeea575f24",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "0386c09a-764a-4b9c-9321-ec5b0b4b6e31",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": null,
        "offset": null,
        "source": "environment"
      },
      {
        "id": "ec0a208c-0559-45bc-aae9-42c7596e7e1f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "4d4b39fd-b50e-4110-8c71-20c896e93591",
        "kind": "request",
        "convertible": false,
        "source": "environment"
      },
      {
        "id": "85e5adb5-cc29-42b2-8d04-abf3bbf2bd2b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
    "name": "test_multiple_condensation_requests_pattern",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "b240b859-3aa8-4a53-aa28-39e032cfc93b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "5ace2b25-83c2-4970-94c6-befeea575f24",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "ec0a208c-0559-45bc-aae9-42c7596e7e1f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "85e5adb5-cc29-42b2-8d04-abf3bbf2bd2b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "b240b859-3aa8-4a53-aa28-39e032cfc93b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "13c75e6c-9ba6-49e2-b526-c184d8fef834",
        "kind": "request",
        "convertible": false,
        "source": "environment"
      },
      {
        "id": "5ace2b25-83c2-4970-94c6-befeea575f24",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "0386c09a-764a-4b9c-9321-ec5b0b4b6e31",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": null,
        "offset": null,
        "source": "environment"
      },
      {
        "id": "ec0a208c-0559-45bc-aae9-42c7596e7e1f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "4d4b39fd-b50e-4110-8c71-20c896e93591",
        "kind": "request",
        "convertible": false,
        "source": "environment"
      },
      {
        "id": "85e5adb5-cc29-42b2-8d04-abf3bbf2bd2b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
    "name": "test_multiple_condensation_requests_pattern",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "b240b859-3aa8-4a53-aa28-39e032cfc93b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "5ace2b25-83c2-4970-94c6-befeea575f24",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "ec0a208c-0559-45bc-aae9-42c7596e7e1f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "85e5adb5-cc29-42b2-8d04-abf3bbf2bd2b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
        "id": "b240b859-3aa8-4a53-aa28-39e032cfc93b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "13c75e6c-9ba6-49e2-b526-c184d8fef834",
        "kind": "request",
        "convertible": false,
        "source": "environment"
      },
      {
        "id": "5ace2b25-83c2-4970-94c6-befeea575f24",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "0386c09a-764a-4b9c-9321-ec5b0b4b6e31",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": null,
        "offset": null,
        "source": "environment"
      },
      {
        "id": "ec0a208c-0559-45bc-aae9-42c7596e7e1f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "4d4b39fd-b50e-4110-8c71-20c896e93591",
        "kind": "request",
        "convertible": false,
        "source": "environment"
      },
      {
        "id": "85e5adb5-cc29-42b2-8d04-abf3bbf2bd2b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
    "name": "test_multiple_condensation_requests_pattern",
    "op": "from_events",
    "input": [
      {
        "id": "b240b859-3aa8-4a53-aa28-39e032cfc93b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "13c75e6c-9ba6-49e2-b526-c184d8fef834",
        "kind": "request",
        "convertible": false,
        "source": "environment"
      },
      {
        "id": "5ace2b25-83c2-4970-94c6-befeea575f24",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "0386c09a-764a-4b9c-9321-ec5b0b4b6e31",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": null,
        "offset": null,
        "source": "environment"
      },
      {
        "id": "ec0a208c-0559-45bc-aae9-42c7596e7e1f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "4d4b39fd-b50e-4110-8c71-20c896e93591",
        "kind": "request",
        "convertible": false,
        "source": "environment"
      },
      {
        "id": "85e5adb5-cc29-42b2-8d04-abf3bbf2bd2b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
      {
        "id": "b240b859-3aa8-4a53-aa28-39e032cfc93b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "5ace2b25-83c2-4970-94c6-befeea575f24",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "ec0a208c-0559-45bc-aae9-42c7596e7e1f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "85e5adb5-cc29-42b2-8d04-abf3bbf2bd2b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 3"
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
    "unhandled": true
  },
  {
    "name": "test_condensation_action_before_request",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "bf4e7a8e-fc96-4304-b97a-a9947277f38e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d7ecdf51-6265-41cb-b344-8f09bfc0b41a",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "eb24af92-594e-4090-98c7-e789987aaa05",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "bf4e7a8e-fc96-4304-b97a-a9947277f38e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "c3e8f724-f4fe-42bf-83dc-1ca9475a485b",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": null,
        "offset": null,
        "source": "environment"
      },
      {
        "id": "d7ecdf51-6265-41cb-b344-8f09bfc0b41a",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "affed566-e769-496d-bd25-eebe43a792a5",
        "kind": "request",
        "convertible": false,
        "source": "environment"
      },
      {
        "id": "eb24af92-594e-4090-98c7-e789987aaa05",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
    "name": "test_condensation_action_before_request",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "bf4e7a8e-fc96-4304-b97a-a9947277f38e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d7ecdf51-6265-41cb-b344-8f09bfc0b41a",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "eb24af92-594e-4090-98c7-e789987aaa05",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "bf4e7a8e-fc96-4304-b97a-a9947277f38e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "c3e8f724-f4fe-42bf-83dc-1ca9475a485b",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": null,
        "offset": null,
        "source": "environment"
      },
      {
        "id": "d7ecdf51-6265-41cb-b344-8f09bfc0b41a",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "affed566-e769-496d-bd25-eebe43a792a5",
        "kind": "request",
        "convertible": false,
        "source": "environment"
      },
      {
        "id": "eb24af92-594e-4090-98c7-e789987aaa05",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
    "name": "test_condensation_action_before_request",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "bf4e7a8e-fc96-4304-b97a-a9947277f38e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d7ecdf51-6265-41cb-b344-8f09bfc0b41a",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "eb24af92-594e-4090-98c7-e789987aaa05",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "bf4e7a8e-fc96-4304-b97a-a9947277f38e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "c3e8f724-f4fe-42bf-83dc-1ca9475a485b",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": null,
        "offset": null,
        "source": "environment"
      },
      {
        "id": "d7ecdf51-6265-41cb-b344-8f09bfc0b41a",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "affed566-e769-496d-bd25-eebe43a792a5",
        "kind": "request",
        "convertible": false,
        "source": "environment"
      },
      {
        "id": "eb24af92-594e-4090-98c7-e789987aaa05",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
    "name": "test_condensation_action_before_request",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "bf4e7a8e-fc96-4304-b97a-a9947277f38e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d7ecdf51-6265-41cb-b344-8f09bfc0b41a",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "eb24af92-594e-4090-98c7-e789987aaa05",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "bf4e7a8e-fc96-4304-b97a-a9947277f38e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "c3e8f724-f4fe-42bf-83dc-1ca9475a485b",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": null,
        "offset": null,
        "source": "environment"
      },
      {
        "id": "d7ecdf51-6265-41cb-b344-8f09bfc0b41a",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "affed566-e769-496d-bd25-eebe43a792a5",
        "kind": "request",
        "convertible": false,
        "source": "environment"
      },
      {
        "id": "eb24af92-594e-4090-98c7-e789987aaa05",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
    "name": "test_condensation_action_before_request",
    "op": "from_events",
    "input": [
      {
        "id": "bf4e7a8e-fc96-4304-b97a-a9947277f38e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "c3e8f724-f4fe-42bf-83dc-1ca9475a485b",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": null,
        "offset": null,
        "source": "environment"
      },
      {
        "id": "d7ecdf51-6265-41cb-b344-8f09bfc0b41a",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "affed566-e769-496d-bd25-eebe43a792a5",
        "kind": "request",
        "convertible": false,
        "source": "environment"
      },
      {
        "id": "eb24af92-594e-4090-98c7-e789987aaa05",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
      {
        "id": "bf4e7a8e-fc96-4304-b97a-a9947277f38e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d7ecdf51-6265-41cb-b344-8f09bfc0b41a",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "eb24af92-594e-4090-98c7-e789987aaa05",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
    "unhandled": true
  },
  {
    "name": "test_no_condensation_events",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "c058270c-0d64-4f01-911d-979ee12a08ae",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d0afd0da-cfb3-43ed-b67e-fdb7561dc353",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "4d927e37-9d17-43af-b35b-08cdf32c4665",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "c058270c-0d64-4f01-911d-979ee12a08ae",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d0afd0da-cfb3-43ed-b67e-fdb7561dc353",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "4d927e37-9d17-43af-b35b-08cdf32c4665",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
    "name": "test_no_condensation_events",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "c058270c-0d64-4f01-911d-979ee12a08ae",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d0afd0da-cfb3-43ed-b67e-fdb7561dc353",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "4d927e37-9d17-43af-b35b-08cdf32c4665",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "c058270c-0d64-4f01-911d-979ee12a08ae",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d0afd0da-cfb3-43ed-b67e-fdb7561dc353",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "4d927e37-9d17-43af-b35b-08cdf32c4665",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
    "name": "test_no_condensation_events",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "c058270c-0d64-4f01-911d-979ee12a08ae",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d0afd0da-cfb3-43ed-b67e-fdb7561dc353",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "4d927e37-9d17-43af-b35b-08cdf32c4665",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "c058270c-0d64-4f01-911d-979ee12a08ae",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d0afd0da-cfb3-43ed-b67e-fdb7561dc353",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "4d927e37-9d17-43af-b35b-08cdf32c4665",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
    "name": "test_no_condensation_events",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "c058270c-0d64-4f01-911d-979ee12a08ae",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d0afd0da-cfb3-43ed-b67e-fdb7561dc353",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "4d927e37-9d17-43af-b35b-08cdf32c4665",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "c058270c-0d64-4f01-911d-979ee12a08ae",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d0afd0da-cfb3-43ed-b67e-fdb7561dc353",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "4d927e37-9d17-43af-b35b-08cdf32c4665",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
    "name": "test_no_condensation_events",
    "op": "from_events",
    "input": [
      {
        "id": "c058270c-0d64-4f01-911d-979ee12a08ae",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d0afd0da-cfb3-43ed-b67e-fdb7561dc353",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "4d927e37-9d17-43af-b35b-08cdf32c4665",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
      {
        "id": "c058270c-0d64-4f01-911d-979ee12a08ae",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "d0afd0da-cfb3-43ed-b67e-fdb7561dc353",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "4d927e37-9d17-43af-b35b-08cdf32c4665",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
    "unhandled": false
  },
  {
    "name": "test_condensation_request_always_removed_from_view",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "c80a41fe-05cc-4092-90ad-d6e6ef738778",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "b12e3420-d0be-4940-90c9-29c2c8437bb4",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "c80a41fe-05cc-4092-90ad-d6e6ef738778",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "5f9da571-bff3-4668-aa36-17493b09d67a",
        "kind": "request",
        "convertible": false,
        "source": "environment"
      },
      {
        "id": "b12e3420-d0be-4940-90c9-29c2c8437bb4",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
    "name": "test_condensation_request_always_removed_from_view",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "c80a41fe-05cc-4092-90ad-d6e6ef738778",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "b12e3420-d0be-4940-90c9-29c2c8437bb4",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "c80a41fe-05cc-4092-90ad-d6e6ef738778",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "5f9da571-bff3-4668-aa36-17493b09d67a",
        "kind": "request",
        "convertible": false,
        "source": "environment"
      },
      {
        "id": "b12e3420-d0be-4940-90c9-29c2c8437bb4",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
    "name": "test_condensation_request_always_removed_from_view",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "c80a41fe-05cc-4092-90ad-d6e6ef738778",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "b12e3420-d0be-4940-90c9-29c2c8437bb4",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "c80a41fe-05cc-4092-90ad-d6e6ef738778",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "5f9da571-bff3-4668-aa36-17493b09d67a",
        "kind": "request",
        "convertible": false,
        "source": "environment"
      },
      {
        "id": "b12e3420-d0be-4940-90c9-29c2c8437bb4",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
    "name": "test_condensation_request_always_removed_from_view",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "c80a41fe-05cc-4092-90ad-d6e6ef738778",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "b12e3420-d0be-4940-90c9-29c2c8437bb4",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "c80a41fe-05cc-4092-90ad-d6e6ef738778",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "5f9da571-bff3-4668-aa36-17493b09d67a",
        "kind": "request",
        "convertible": false,
        "source": "environment"
      },
      {
        "id": "b12e3420-d0be-4940-90c9-29c2c8437bb4",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
    "name": "test_condensation_request_always_removed_from_view",
    "op": "from_events",
    "input": [
      {
        "id": "c80a41fe-05cc-4092-90ad-d6e6ef738778",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "5f9da571-bff3-4668-aa36-17493b09d67a",
        "kind": "request",
        "convertible": false,
        "source": "environment"
      },
      {
        "id": "b12e3420-d0be-4940-90c9-29c2c8437bb4",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
      {
        "id": "c80a41fe-05cc-4092-90ad-d6e6ef738778",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "b12e3420-d0be-4940-90c9-29c2c8437bb4",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
    "unhandled": true
  },
  {
    "name": "test_condensation_request_always_removed_from_view",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "220c4362-a65a-47f5-90f8-810a62912cfa",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "7753ecfc-1993-4c14-b24a-33a454259e56",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "98241ee6-9758-4502-bb85-2080bdfc47d1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "220c4362-a65a-47f5-90f8-810a62912cfa",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "566a0371-f6e9-470d-91c9-e2b6191d5310",
        "kind": "request",
        "convertible": false,
        "source": "environment"
      },
      {
        "id": "7753ecfc-1993-4c14-b24a-33a454259e56",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "2bef5137-d8bf-405c-a98a-716622858abd",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": null,
        "offset": null,
        "source": "environment"
      },
      {
        "id": "98241ee6-9758-4502-bb85-2080bdfc47d1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
    "name": "test_condensation_request_always_removed_from_view",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "220c4362-a65a-47f5-90f8-810a62912cfa",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "7753ecfc-1993-4c14-b24a-33a454259e56",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "98241ee6-9758-4502-bb85-2080bdfc47d1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "220c4362-a65a-47f5-90f8-810a62912cfa",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "566a0371-f6e9-470d-91c9-e2b6191d5310",
        "kind": "request",
        "convertible": false,
        "source": "environment"
      },
      {
        "id": "7753ecfc-1993-4c14-b24a-33a454259e56",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "2bef5137-d8bf-405c-a98a-716622858abd",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": null,
        "offset": null,
        "source": "environment"
      },
      {
        "id": "98241ee6-9758-4502-bb85-2080bdfc47d1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
    "name": "test_condensation_request_always_removed_from_view",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "220c4362-a65a-47f5-90f8-810a62912cfa",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "7753ecfc-1993-4c14-b24a-33a454259e56",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "98241ee6-9758-4502-bb85-2080bdfc47d1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "220c4362-a65a-47f5-90f8-810a62912cfa",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "566a0371-f6e9-470d-91c9-e2b6191d5310",
        "kind": "request",
        "convertible": false,
        "source": "environment"
      },
      {
        "id": "7753ecfc-1993-4c14-b24a-33a454259e56",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "2bef5137-d8bf-405c-a98a-716622858abd",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": null,
        "offset": null,
        "source": "environment"
      },
      {
        "id": "98241ee6-9758-4502-bb85-2080bdfc47d1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
    "name": "test_condensation_request_always_removed_from_view",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "220c4362-a65a-47f5-90f8-810a62912cfa",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "7753ecfc-1993-4c14-b24a-33a454259e56",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "98241ee6-9758-4502-bb85-2080bdfc47d1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
        "id": "220c4362-a65a-47f5-90f8-810a62912cfa",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "566a0371-f6e9-470d-91c9-e2b6191d5310",
        "kind": "request",
        "convertible": false,
        "source": "environment"
      },
      {
        "id": "7753ecfc-1993-4c14-b24a-33a454259e56",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "2bef5137-d8bf-405c-a98a-716622858abd",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": null,
        "offset": null,
        "source": "environment"
      },
      {
        "id": "98241ee6-9758-4502-bb85-2080bdfc47d1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
    "name": "test_condensation_request_always_removed_from_view",
    "op": "from_events",
    "input": [
      {
        "id": "220c4362-a65a-47f5-90f8-810a62912cfa",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "566a0371-f6e9-470d-91c9-e2b6191d5310",
        "kind": "request",
        "convertible": false,
        "source": "environment"
      },
      {
        "id": "7753ecfc-1993-4c14-b24a-33a454259e56",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "2bef5137-d8bf-405c-a98a-716622858abd",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": null,
        "offset": null,
        "source": "environment"
      },
      {
        "id": "98241ee6-9758-4502-bb85-2080bdfc47d1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
      {
        "id": "220c4362-a65a-47f5-90f8-810a62912cfa",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 0"
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
        "id": "7753ecfc-1993-4c14-b24a-33a454259e56",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 1"
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
        "id": "98241ee6-9758-4502-bb85-2080bdfc47d1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 2"
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
    "unhandled": false
  }
];
