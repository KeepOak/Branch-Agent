// From OpenHands/software-agent-sdk@0a9abc87641ad7ffe02e2dadf5e2cb3976b35217:tests/sdk/context/view/test_view_multi_summary.py (atlas AGENT-LOOP-0093). Pinned inputs and complete invariant outputs from the passing upstream tests.
import type { Fixture } from "./view.test-support.js";
export const fixtures: Fixture[] = [
  {
    "name": "test_multiple_summaries_at_different_offsets",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "condensation-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary of event 0",
        "source": "environment"
      },
      {
        "id": "595488b7-dbf4-4243-b03d-b008a3a9bb80",
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
        "id": "condensation-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary of event 2",
        "source": "environment"
      },
      {
        "id": "ed330c0d-4445-4fd1-93d4-73a78e8c1fc3",
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
        "id": "5fd9e315-3ecb-4ba8-84eb-f794d7e5deed",
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
        "id": "a103c01f-450c-422e-8cb6-2f49dedca58a",
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
        "id": "595488b7-dbf4-4243-b03d-b008a3a9bb80",
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
        "id": "condensation-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "a103c01f-450c-422e-8cb6-2f49dedca58a"
        ],
        "summary": "Summary of event 0",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "1577c43d-22ea-4cb2-abf6-c57bc2775eb7",
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
        "id": "ed330c0d-4445-4fd1-93d4-73a78e8c1fc3",
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
        "id": "condensation-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "1577c43d-22ea-4cb2-abf6-c57bc2775eb7"
        ],
        "summary": "Summary of event 2",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "5fd9e315-3ecb-4ba8-84eb-f794d7e5deed",
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
    "name": "test_multiple_summaries_at_different_offsets",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "condensation-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary of event 0",
        "source": "environment"
      },
      {
        "id": "595488b7-dbf4-4243-b03d-b008a3a9bb80",
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
        "id": "condensation-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary of event 2",
        "source": "environment"
      },
      {
        "id": "ed330c0d-4445-4fd1-93d4-73a78e8c1fc3",
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
        "id": "5fd9e315-3ecb-4ba8-84eb-f794d7e5deed",
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
        "id": "a103c01f-450c-422e-8cb6-2f49dedca58a",
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
        "id": "595488b7-dbf4-4243-b03d-b008a3a9bb80",
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
        "id": "condensation-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "a103c01f-450c-422e-8cb6-2f49dedca58a"
        ],
        "summary": "Summary of event 0",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "1577c43d-22ea-4cb2-abf6-c57bc2775eb7",
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
        "id": "ed330c0d-4445-4fd1-93d4-73a78e8c1fc3",
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
        "id": "condensation-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "1577c43d-22ea-4cb2-abf6-c57bc2775eb7"
        ],
        "summary": "Summary of event 2",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "5fd9e315-3ecb-4ba8-84eb-f794d7e5deed",
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
    "name": "test_multiple_summaries_at_different_offsets",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "condensation-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary of event 0",
        "source": "environment"
      },
      {
        "id": "595488b7-dbf4-4243-b03d-b008a3a9bb80",
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
        "id": "condensation-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary of event 2",
        "source": "environment"
      },
      {
        "id": "ed330c0d-4445-4fd1-93d4-73a78e8c1fc3",
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
        "id": "5fd9e315-3ecb-4ba8-84eb-f794d7e5deed",
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
        "id": "a103c01f-450c-422e-8cb6-2f49dedca58a",
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
        "id": "595488b7-dbf4-4243-b03d-b008a3a9bb80",
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
        "id": "condensation-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "a103c01f-450c-422e-8cb6-2f49dedca58a"
        ],
        "summary": "Summary of event 0",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "1577c43d-22ea-4cb2-abf6-c57bc2775eb7",
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
        "id": "ed330c0d-4445-4fd1-93d4-73a78e8c1fc3",
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
        "id": "condensation-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "1577c43d-22ea-4cb2-abf6-c57bc2775eb7"
        ],
        "summary": "Summary of event 2",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "5fd9e315-3ecb-4ba8-84eb-f794d7e5deed",
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
    "name": "test_multiple_summaries_at_different_offsets",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "condensation-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary of event 0",
        "source": "environment"
      },
      {
        "id": "595488b7-dbf4-4243-b03d-b008a3a9bb80",
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
        "id": "condensation-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary of event 2",
        "source": "environment"
      },
      {
        "id": "ed330c0d-4445-4fd1-93d4-73a78e8c1fc3",
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
        "id": "5fd9e315-3ecb-4ba8-84eb-f794d7e5deed",
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
        "id": "a103c01f-450c-422e-8cb6-2f49dedca58a",
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
        "id": "595488b7-dbf4-4243-b03d-b008a3a9bb80",
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
        "id": "condensation-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "a103c01f-450c-422e-8cb6-2f49dedca58a"
        ],
        "summary": "Summary of event 0",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "1577c43d-22ea-4cb2-abf6-c57bc2775eb7",
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
        "id": "ed330c0d-4445-4fd1-93d4-73a78e8c1fc3",
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
        "id": "condensation-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "1577c43d-22ea-4cb2-abf6-c57bc2775eb7"
        ],
        "summary": "Summary of event 2",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "5fd9e315-3ecb-4ba8-84eb-f794d7e5deed",
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
    "name": "test_multiple_summaries_at_different_offsets",
    "op": "from_events",
    "input": [
      {
        "id": "a103c01f-450c-422e-8cb6-2f49dedca58a",
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
        "id": "595488b7-dbf4-4243-b03d-b008a3a9bb80",
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
        "id": "condensation-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "a103c01f-450c-422e-8cb6-2f49dedca58a"
        ],
        "summary": "Summary of event 0",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "1577c43d-22ea-4cb2-abf6-c57bc2775eb7",
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
        "id": "ed330c0d-4445-4fd1-93d4-73a78e8c1fc3",
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
        "id": "condensation-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "1577c43d-22ea-4cb2-abf6-c57bc2775eb7"
        ],
        "summary": "Summary of event 2",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "5fd9e315-3ecb-4ba8-84eb-f794d7e5deed",
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
        "id": "condensation-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary of event 0",
        "source": "environment"
      },
      {
        "id": "595488b7-dbf4-4243-b03d-b008a3a9bb80",
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
        "id": "condensation-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary of event 2",
        "source": "environment"
      },
      {
        "id": "ed330c0d-4445-4fd1-93d4-73a78e8c1fc3",
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
        "id": "5fd9e315-3ecb-4ba8-84eb-f794d7e5deed",
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
    "name": "test_multiple_summaries_from_sequential_condensations",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "condensation-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "First summary",
        "source": "environment"
      },
      {
        "id": "37469fe5-4d8a-4cdc-9063-4fbf8cda5475",
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
        "id": "2e6a0c97-0f99-4693-87a3-160f351e7d1a",
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
        "id": "condensation-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Second summary",
        "source": "environment"
      },
      {
        "id": "22af7648-27d8-4d2d-a1f6-bb6480dfd66e",
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
        "id": "condensation-3-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Third summary",
        "source": "environment"
      },
      {
        "id": "53eab7d4-b52a-47d6-8735-cd16670998bd",
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
        "id": "295b530a-ea55-45fc-bd59-1e2bfcb45091",
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
        "id": "85fb2603-2592-424e-bc22-619f68f612c9",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 5"
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
        "id": "37469fe5-4d8a-4cdc-9063-4fbf8cda5475",
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
        "id": "condensation-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "First summary",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "2e6a0c97-0f99-4693-87a3-160f351e7d1a",
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
        "id": "22af7648-27d8-4d2d-a1f6-bb6480dfd66e",
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
        "id": "condensation-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Second summary",
        "offset": 3,
        "source": "environment"
      },
      {
        "id": "53eab7d4-b52a-47d6-8735-cd16670998bd",
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
        "id": "condensation-3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Third summary",
        "offset": 5,
        "source": "environment"
      },
      {
        "id": "295b530a-ea55-45fc-bd59-1e2bfcb45091",
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
        "id": "85fb2603-2592-424e-bc22-619f68f612c9",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 5"
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
    "name": "test_multiple_summaries_from_sequential_condensations",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "condensation-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "First summary",
        "source": "environment"
      },
      {
        "id": "37469fe5-4d8a-4cdc-9063-4fbf8cda5475",
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
        "id": "2e6a0c97-0f99-4693-87a3-160f351e7d1a",
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
        "id": "condensation-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Second summary",
        "source": "environment"
      },
      {
        "id": "22af7648-27d8-4d2d-a1f6-bb6480dfd66e",
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
        "id": "condensation-3-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Third summary",
        "source": "environment"
      },
      {
        "id": "53eab7d4-b52a-47d6-8735-cd16670998bd",
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
        "id": "295b530a-ea55-45fc-bd59-1e2bfcb45091",
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
        "id": "85fb2603-2592-424e-bc22-619f68f612c9",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 5"
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
        "id": "37469fe5-4d8a-4cdc-9063-4fbf8cda5475",
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
        "id": "condensation-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "First summary",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "2e6a0c97-0f99-4693-87a3-160f351e7d1a",
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
        "id": "22af7648-27d8-4d2d-a1f6-bb6480dfd66e",
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
        "id": "condensation-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Second summary",
        "offset": 3,
        "source": "environment"
      },
      {
        "id": "53eab7d4-b52a-47d6-8735-cd16670998bd",
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
        "id": "condensation-3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Third summary",
        "offset": 5,
        "source": "environment"
      },
      {
        "id": "295b530a-ea55-45fc-bd59-1e2bfcb45091",
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
        "id": "85fb2603-2592-424e-bc22-619f68f612c9",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 5"
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
    "name": "test_multiple_summaries_from_sequential_condensations",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "condensation-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "First summary",
        "source": "environment"
      },
      {
        "id": "37469fe5-4d8a-4cdc-9063-4fbf8cda5475",
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
        "id": "2e6a0c97-0f99-4693-87a3-160f351e7d1a",
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
        "id": "condensation-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Second summary",
        "source": "environment"
      },
      {
        "id": "22af7648-27d8-4d2d-a1f6-bb6480dfd66e",
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
        "id": "condensation-3-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Third summary",
        "source": "environment"
      },
      {
        "id": "53eab7d4-b52a-47d6-8735-cd16670998bd",
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
        "id": "295b530a-ea55-45fc-bd59-1e2bfcb45091",
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
        "id": "85fb2603-2592-424e-bc22-619f68f612c9",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 5"
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
        "id": "37469fe5-4d8a-4cdc-9063-4fbf8cda5475",
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
        "id": "condensation-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "First summary",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "2e6a0c97-0f99-4693-87a3-160f351e7d1a",
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
        "id": "22af7648-27d8-4d2d-a1f6-bb6480dfd66e",
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
        "id": "condensation-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Second summary",
        "offset": 3,
        "source": "environment"
      },
      {
        "id": "53eab7d4-b52a-47d6-8735-cd16670998bd",
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
        "id": "condensation-3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Third summary",
        "offset": 5,
        "source": "environment"
      },
      {
        "id": "295b530a-ea55-45fc-bd59-1e2bfcb45091",
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
        "id": "85fb2603-2592-424e-bc22-619f68f612c9",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 5"
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
    "name": "test_multiple_summaries_from_sequential_condensations",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "condensation-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "First summary",
        "source": "environment"
      },
      {
        "id": "37469fe5-4d8a-4cdc-9063-4fbf8cda5475",
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
        "id": "2e6a0c97-0f99-4693-87a3-160f351e7d1a",
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
        "id": "condensation-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Second summary",
        "source": "environment"
      },
      {
        "id": "22af7648-27d8-4d2d-a1f6-bb6480dfd66e",
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
        "id": "condensation-3-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Third summary",
        "source": "environment"
      },
      {
        "id": "53eab7d4-b52a-47d6-8735-cd16670998bd",
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
        "id": "295b530a-ea55-45fc-bd59-1e2bfcb45091",
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
        "id": "85fb2603-2592-424e-bc22-619f68f612c9",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 5"
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
        "id": "37469fe5-4d8a-4cdc-9063-4fbf8cda5475",
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
        "id": "condensation-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "First summary",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "2e6a0c97-0f99-4693-87a3-160f351e7d1a",
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
        "id": "22af7648-27d8-4d2d-a1f6-bb6480dfd66e",
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
        "id": "condensation-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Second summary",
        "offset": 3,
        "source": "environment"
      },
      {
        "id": "53eab7d4-b52a-47d6-8735-cd16670998bd",
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
        "id": "condensation-3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Third summary",
        "offset": 5,
        "source": "environment"
      },
      {
        "id": "295b530a-ea55-45fc-bd59-1e2bfcb45091",
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
        "id": "85fb2603-2592-424e-bc22-619f68f612c9",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 5"
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
    "name": "test_multiple_summaries_from_sequential_condensations",
    "op": "from_events",
    "input": [
      {
        "id": "37469fe5-4d8a-4cdc-9063-4fbf8cda5475",
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
        "id": "condensation-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "First summary",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "2e6a0c97-0f99-4693-87a3-160f351e7d1a",
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
        "id": "22af7648-27d8-4d2d-a1f6-bb6480dfd66e",
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
        "id": "condensation-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Second summary",
        "offset": 3,
        "source": "environment"
      },
      {
        "id": "53eab7d4-b52a-47d6-8735-cd16670998bd",
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
        "id": "condensation-3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Third summary",
        "offset": 5,
        "source": "environment"
      },
      {
        "id": "295b530a-ea55-45fc-bd59-1e2bfcb45091",
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
        "id": "85fb2603-2592-424e-bc22-619f68f612c9",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 5"
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
        "id": "condensation-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "First summary",
        "source": "environment"
      },
      {
        "id": "37469fe5-4d8a-4cdc-9063-4fbf8cda5475",
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
        "id": "2e6a0c97-0f99-4693-87a3-160f351e7d1a",
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
        "id": "condensation-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Second summary",
        "source": "environment"
      },
      {
        "id": "22af7648-27d8-4d2d-a1f6-bb6480dfd66e",
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
        "id": "condensation-3-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Third summary",
        "source": "environment"
      },
      {
        "id": "53eab7d4-b52a-47d6-8735-cd16670998bd",
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
        "id": "295b530a-ea55-45fc-bd59-1e2bfcb45091",
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
        "id": "85fb2603-2592-424e-bc22-619f68f612c9",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Event 5"
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
    "name": "test_summaries_preserve_order_and_content",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary A",
        "source": "environment"
      },
      {
        "id": "6bb320ef-756b-4554-b08f-bd14e6a2aed9",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary B",
        "source": "environment"
      },
      {
        "id": "4a7b49f6-da52-48fd-a6dd-6b10af2838cb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
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
        "id": "10d2586c-fef1-4da7-a67b-20c1c2a8a7bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "10d2586c-fef1-4da7-a67b-20c1c2a8a7bb"
        ],
        "summary": "Summary A",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "6bb320ef-756b-4554-b08f-bd14e6a2aed9",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "2fdafe4f-b955-4325-8c6b-f79d17e5d47a",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "2fdafe4f-b955-4325-8c6b-f79d17e5d47a"
        ],
        "summary": "Summary B",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "4a7b49f6-da52-48fd-a6dd-6b10af2838cb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
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
    "name": "test_summaries_preserve_order_and_content",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary A",
        "source": "environment"
      },
      {
        "id": "6bb320ef-756b-4554-b08f-bd14e6a2aed9",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary B",
        "source": "environment"
      },
      {
        "id": "4a7b49f6-da52-48fd-a6dd-6b10af2838cb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
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
        "id": "10d2586c-fef1-4da7-a67b-20c1c2a8a7bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "10d2586c-fef1-4da7-a67b-20c1c2a8a7bb"
        ],
        "summary": "Summary A",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "6bb320ef-756b-4554-b08f-bd14e6a2aed9",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "2fdafe4f-b955-4325-8c6b-f79d17e5d47a",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "2fdafe4f-b955-4325-8c6b-f79d17e5d47a"
        ],
        "summary": "Summary B",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "4a7b49f6-da52-48fd-a6dd-6b10af2838cb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
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
    "name": "test_summaries_preserve_order_and_content",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary A",
        "source": "environment"
      },
      {
        "id": "6bb320ef-756b-4554-b08f-bd14e6a2aed9",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary B",
        "source": "environment"
      },
      {
        "id": "4a7b49f6-da52-48fd-a6dd-6b10af2838cb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
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
        "id": "10d2586c-fef1-4da7-a67b-20c1c2a8a7bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "10d2586c-fef1-4da7-a67b-20c1c2a8a7bb"
        ],
        "summary": "Summary A",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "6bb320ef-756b-4554-b08f-bd14e6a2aed9",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "2fdafe4f-b955-4325-8c6b-f79d17e5d47a",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "2fdafe4f-b955-4325-8c6b-f79d17e5d47a"
        ],
        "summary": "Summary B",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "4a7b49f6-da52-48fd-a6dd-6b10af2838cb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
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
    "name": "test_summaries_preserve_order_and_content",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary A",
        "source": "environment"
      },
      {
        "id": "6bb320ef-756b-4554-b08f-bd14e6a2aed9",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary B",
        "source": "environment"
      },
      {
        "id": "4a7b49f6-da52-48fd-a6dd-6b10af2838cb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
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
        "id": "10d2586c-fef1-4da7-a67b-20c1c2a8a7bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "10d2586c-fef1-4da7-a67b-20c1c2a8a7bb"
        ],
        "summary": "Summary A",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "6bb320ef-756b-4554-b08f-bd14e6a2aed9",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "2fdafe4f-b955-4325-8c6b-f79d17e5d47a",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "2fdafe4f-b955-4325-8c6b-f79d17e5d47a"
        ],
        "summary": "Summary B",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "4a7b49f6-da52-48fd-a6dd-6b10af2838cb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
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
    "name": "test_summaries_preserve_order_and_content",
    "op": "from_events",
    "input": [
      {
        "id": "10d2586c-fef1-4da7-a67b-20c1c2a8a7bb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "10d2586c-fef1-4da7-a67b-20c1c2a8a7bb"
        ],
        "summary": "Summary A",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "6bb320ef-756b-4554-b08f-bd14e6a2aed9",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "2fdafe4f-b955-4325-8c6b-f79d17e5d47a",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "2fdafe4f-b955-4325-8c6b-f79d17e5d47a"
        ],
        "summary": "Summary B",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "4a7b49f6-da52-48fd-a6dd-6b10af2838cb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
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
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary A",
        "source": "environment"
      },
      {
        "id": "6bb320ef-756b-4554-b08f-bd14e6a2aed9",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary B",
        "source": "environment"
      },
      {
        "id": "4a7b49f6-da52-48fd-a6dd-6b10af2838cb",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
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
    "name": "test_forget_first_summary_keeps_second",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "547bed8b-c10d-4de3-b5ff-96b78a1ff006",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary B",
        "source": "environment"
      },
      {
        "id": "30706f71-de97-4a74-8310-47d0d4e66871",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "a41387ea-7014-47b6-869c-403d3aa75231",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
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
        "id": "547bed8b-c10d-4de3-b5ff-96b78a1ff006",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary A",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "30706f71-de97-4a74-8310-47d0d4e66871",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary B",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "a41387ea-7014-47b6-869c-403d3aa75231",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "cond-1-summary"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_forget_first_summary_keeps_second",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "547bed8b-c10d-4de3-b5ff-96b78a1ff006",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary B",
        "source": "environment"
      },
      {
        "id": "30706f71-de97-4a74-8310-47d0d4e66871",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "a41387ea-7014-47b6-869c-403d3aa75231",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
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
        "id": "547bed8b-c10d-4de3-b5ff-96b78a1ff006",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary A",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "30706f71-de97-4a74-8310-47d0d4e66871",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary B",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "a41387ea-7014-47b6-869c-403d3aa75231",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "cond-1-summary"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_forget_first_summary_keeps_second",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "547bed8b-c10d-4de3-b5ff-96b78a1ff006",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary B",
        "source": "environment"
      },
      {
        "id": "30706f71-de97-4a74-8310-47d0d4e66871",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "a41387ea-7014-47b6-869c-403d3aa75231",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
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
        "id": "547bed8b-c10d-4de3-b5ff-96b78a1ff006",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary A",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "30706f71-de97-4a74-8310-47d0d4e66871",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary B",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "a41387ea-7014-47b6-869c-403d3aa75231",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "cond-1-summary"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_forget_first_summary_keeps_second",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "547bed8b-c10d-4de3-b5ff-96b78a1ff006",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary B",
        "source": "environment"
      },
      {
        "id": "30706f71-de97-4a74-8310-47d0d4e66871",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "a41387ea-7014-47b6-869c-403d3aa75231",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
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
        "id": "547bed8b-c10d-4de3-b5ff-96b78a1ff006",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary A",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "30706f71-de97-4a74-8310-47d0d4e66871",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary B",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "a41387ea-7014-47b6-869c-403d3aa75231",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "cond-1-summary"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_forget_first_summary_keeps_second",
    "op": "from_events",
    "input": [
      {
        "id": "547bed8b-c10d-4de3-b5ff-96b78a1ff006",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary A",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "30706f71-de97-4a74-8310-47d0d4e66871",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary B",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "a41387ea-7014-47b6-869c-403d3aa75231",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "cond-1-summary"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": [
      {
        "id": "547bed8b-c10d-4de3-b5ff-96b78a1ff006",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary B",
        "source": "environment"
      },
      {
        "id": "30706f71-de97-4a74-8310-47d0d4e66871",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "a41387ea-7014-47b6-869c-403d3aa75231",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
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
    "name": "test_forget_middle_summary_keeps_others",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary A",
        "source": "environment"
      },
      {
        "id": "dcb1889b-164b-409f-8d7f-139adbf97d9e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "5f4d542e-868a-4a24-a64e-50e047651c76",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-3-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary C",
        "source": "environment"
      },
      {
        "id": "6f1536eb-8892-4923-a1d5-2df2b99eb51f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "d7b8f7dd-583d-49fb-af6d-cafcd3275897",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
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
        "id": "dcb1889b-164b-409f-8d7f-139adbf97d9e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary A",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "5f4d542e-868a-4a24-a64e-50e047651c76",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary B",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "6f1536eb-8892-4923-a1d5-2df2b99eb51f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary C",
        "offset": 4,
        "source": "environment"
      },
      {
        "id": "d7b8f7dd-583d-49fb-af6d-cafcd3275897",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-4",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "cond-2-summary"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_forget_middle_summary_keeps_others",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary A",
        "source": "environment"
      },
      {
        "id": "dcb1889b-164b-409f-8d7f-139adbf97d9e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "5f4d542e-868a-4a24-a64e-50e047651c76",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-3-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary C",
        "source": "environment"
      },
      {
        "id": "6f1536eb-8892-4923-a1d5-2df2b99eb51f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "d7b8f7dd-583d-49fb-af6d-cafcd3275897",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
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
        "id": "dcb1889b-164b-409f-8d7f-139adbf97d9e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary A",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "5f4d542e-868a-4a24-a64e-50e047651c76",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary B",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "6f1536eb-8892-4923-a1d5-2df2b99eb51f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary C",
        "offset": 4,
        "source": "environment"
      },
      {
        "id": "d7b8f7dd-583d-49fb-af6d-cafcd3275897",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-4",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "cond-2-summary"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_forget_middle_summary_keeps_others",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary A",
        "source": "environment"
      },
      {
        "id": "dcb1889b-164b-409f-8d7f-139adbf97d9e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "5f4d542e-868a-4a24-a64e-50e047651c76",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-3-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary C",
        "source": "environment"
      },
      {
        "id": "6f1536eb-8892-4923-a1d5-2df2b99eb51f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "d7b8f7dd-583d-49fb-af6d-cafcd3275897",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
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
        "id": "dcb1889b-164b-409f-8d7f-139adbf97d9e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary A",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "5f4d542e-868a-4a24-a64e-50e047651c76",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary B",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "6f1536eb-8892-4923-a1d5-2df2b99eb51f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary C",
        "offset": 4,
        "source": "environment"
      },
      {
        "id": "d7b8f7dd-583d-49fb-af6d-cafcd3275897",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-4",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "cond-2-summary"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_forget_middle_summary_keeps_others",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary A",
        "source": "environment"
      },
      {
        "id": "dcb1889b-164b-409f-8d7f-139adbf97d9e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "5f4d542e-868a-4a24-a64e-50e047651c76",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-3-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary C",
        "source": "environment"
      },
      {
        "id": "6f1536eb-8892-4923-a1d5-2df2b99eb51f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "d7b8f7dd-583d-49fb-af6d-cafcd3275897",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
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
        "id": "dcb1889b-164b-409f-8d7f-139adbf97d9e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary A",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "5f4d542e-868a-4a24-a64e-50e047651c76",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary B",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "6f1536eb-8892-4923-a1d5-2df2b99eb51f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary C",
        "offset": 4,
        "source": "environment"
      },
      {
        "id": "d7b8f7dd-583d-49fb-af6d-cafcd3275897",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-4",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "cond-2-summary"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_forget_middle_summary_keeps_others",
    "op": "from_events",
    "input": [
      {
        "id": "dcb1889b-164b-409f-8d7f-139adbf97d9e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary A",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "5f4d542e-868a-4a24-a64e-50e047651c76",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary B",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "6f1536eb-8892-4923-a1d5-2df2b99eb51f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary C",
        "offset": 4,
        "source": "environment"
      },
      {
        "id": "d7b8f7dd-583d-49fb-af6d-cafcd3275897",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-4",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "cond-2-summary"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": [
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary A",
        "source": "environment"
      },
      {
        "id": "dcb1889b-164b-409f-8d7f-139adbf97d9e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "5f4d542e-868a-4a24-a64e-50e047651c76",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-3-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary C",
        "source": "environment"
      },
      {
        "id": "6f1536eb-8892-4923-a1d5-2df2b99eb51f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "d7b8f7dd-583d-49fb-af6d-cafcd3275897",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
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
    "name": "test_forget_most_recent_summary",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary A",
        "source": "environment"
      },
      {
        "id": "d60f2ec7-3ed1-4c90-b6d2-cc9aec2f3a6f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "8c9ca90a-4edf-4a11-be39-ff29a8853f01",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
        "id": "d60f2ec7-3ed1-4c90-b6d2-cc9aec2f3a6f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary A",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "8c9ca90a-4edf-4a11-be39-ff29a8853f01",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary B",
        "offset": 1,
        "source": "environment"
      },
      {
        "id": "cond-3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "cond-2-summary"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_forget_most_recent_summary",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary A",
        "source": "environment"
      },
      {
        "id": "d60f2ec7-3ed1-4c90-b6d2-cc9aec2f3a6f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "8c9ca90a-4edf-4a11-be39-ff29a8853f01",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
        "id": "d60f2ec7-3ed1-4c90-b6d2-cc9aec2f3a6f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary A",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "8c9ca90a-4edf-4a11-be39-ff29a8853f01",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary B",
        "offset": 1,
        "source": "environment"
      },
      {
        "id": "cond-3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "cond-2-summary"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_forget_most_recent_summary",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary A",
        "source": "environment"
      },
      {
        "id": "d60f2ec7-3ed1-4c90-b6d2-cc9aec2f3a6f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "8c9ca90a-4edf-4a11-be39-ff29a8853f01",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
        "id": "d60f2ec7-3ed1-4c90-b6d2-cc9aec2f3a6f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary A",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "8c9ca90a-4edf-4a11-be39-ff29a8853f01",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary B",
        "offset": 1,
        "source": "environment"
      },
      {
        "id": "cond-3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "cond-2-summary"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_forget_most_recent_summary",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary A",
        "source": "environment"
      },
      {
        "id": "d60f2ec7-3ed1-4c90-b6d2-cc9aec2f3a6f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "8c9ca90a-4edf-4a11-be39-ff29a8853f01",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
        "id": "d60f2ec7-3ed1-4c90-b6d2-cc9aec2f3a6f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary A",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "8c9ca90a-4edf-4a11-be39-ff29a8853f01",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary B",
        "offset": 1,
        "source": "environment"
      },
      {
        "id": "cond-3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "cond-2-summary"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_forget_most_recent_summary",
    "op": "from_events",
    "input": [
      {
        "id": "d60f2ec7-3ed1-4c90-b6d2-cc9aec2f3a6f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary A",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "8c9ca90a-4edf-4a11-be39-ff29a8853f01",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary B",
        "offset": 1,
        "source": "environment"
      },
      {
        "id": "cond-3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "cond-2-summary"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": [
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary A",
        "source": "environment"
      },
      {
        "id": "d60f2ec7-3ed1-4c90-b6d2-cc9aec2f3a6f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "8c9ca90a-4edf-4a11-be39-ff29a8853f01",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
    "name": "test_forget_summary_adjusts_later_summary_positions",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "dfc7fdd3-12ea-470b-bc92-0c46c310a849",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary at position 2",
        "source": "environment"
      },
      {
        "id": "03f88335-fcb0-47fc-8783-6376071f3278",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "3ae88296-d10f-4754-aecb-9b9e307d9c00",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
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
        "id": "dfc7fdd3-12ea-470b-bc92-0c46c310a849",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary at position 0",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "03f88335-fcb0-47fc-8783-6376071f3278",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary at position 2",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "3ae88296-d10f-4754-aecb-9b9e307d9c00",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "cond-1-summary"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_forget_summary_adjusts_later_summary_positions",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "dfc7fdd3-12ea-470b-bc92-0c46c310a849",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary at position 2",
        "source": "environment"
      },
      {
        "id": "03f88335-fcb0-47fc-8783-6376071f3278",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "3ae88296-d10f-4754-aecb-9b9e307d9c00",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
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
        "id": "dfc7fdd3-12ea-470b-bc92-0c46c310a849",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary at position 0",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "03f88335-fcb0-47fc-8783-6376071f3278",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary at position 2",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "3ae88296-d10f-4754-aecb-9b9e307d9c00",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "cond-1-summary"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_forget_summary_adjusts_later_summary_positions",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "dfc7fdd3-12ea-470b-bc92-0c46c310a849",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary at position 2",
        "source": "environment"
      },
      {
        "id": "03f88335-fcb0-47fc-8783-6376071f3278",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "3ae88296-d10f-4754-aecb-9b9e307d9c00",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
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
        "id": "dfc7fdd3-12ea-470b-bc92-0c46c310a849",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary at position 0",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "03f88335-fcb0-47fc-8783-6376071f3278",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary at position 2",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "3ae88296-d10f-4754-aecb-9b9e307d9c00",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "cond-1-summary"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_forget_summary_adjusts_later_summary_positions",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "dfc7fdd3-12ea-470b-bc92-0c46c310a849",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary at position 2",
        "source": "environment"
      },
      {
        "id": "03f88335-fcb0-47fc-8783-6376071f3278",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "3ae88296-d10f-4754-aecb-9b9e307d9c00",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
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
        "id": "dfc7fdd3-12ea-470b-bc92-0c46c310a849",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary at position 0",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "03f88335-fcb0-47fc-8783-6376071f3278",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary at position 2",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "3ae88296-d10f-4754-aecb-9b9e307d9c00",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "cond-1-summary"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_forget_summary_adjusts_later_summary_positions",
    "op": "from_events",
    "input": [
      {
        "id": "dfc7fdd3-12ea-470b-bc92-0c46c310a849",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary at position 0",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "03f88335-fcb0-47fc-8783-6376071f3278",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary at position 2",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "3ae88296-d10f-4754-aecb-9b9e307d9c00",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "cond-1-summary"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": [
      {
        "id": "dfc7fdd3-12ea-470b-bc92-0c46c310a849",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary at position 2",
        "source": "environment"
      },
      {
        "id": "03f88335-fcb0-47fc-8783-6376071f3278",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "3ae88296-d10f-4754-aecb-9b9e307d9c00",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
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
    "name": "test_forget_multiple_summaries_simultaneously",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "0c3f8253-9a6c-4b96-a139-033ccb26e7ae",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary B",
        "source": "environment"
      },
      {
        "id": "40f77081-ad83-4cd8-83eb-e7875a1fd136",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "2c7c29b9-4be2-4bc1-a2fc-cbee7e52bfe6",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "8ba8cc0a-e3f3-4f8f-b1e1-af85247197c6",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
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
        "id": "0c3f8253-9a6c-4b96-a139-033ccb26e7ae",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary A",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "40f77081-ad83-4cd8-83eb-e7875a1fd136",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary B",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "2c7c29b9-4be2-4bc1-a2fc-cbee7e52bfe6",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary C",
        "offset": 4,
        "source": "environment"
      },
      {
        "id": "8ba8cc0a-e3f3-4f8f-b1e1-af85247197c6",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-4",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "cond-1-summary",
          "cond-3-summary"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_forget_multiple_summaries_simultaneously",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "0c3f8253-9a6c-4b96-a139-033ccb26e7ae",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary B",
        "source": "environment"
      },
      {
        "id": "40f77081-ad83-4cd8-83eb-e7875a1fd136",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "2c7c29b9-4be2-4bc1-a2fc-cbee7e52bfe6",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "8ba8cc0a-e3f3-4f8f-b1e1-af85247197c6",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
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
        "id": "0c3f8253-9a6c-4b96-a139-033ccb26e7ae",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary A",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "40f77081-ad83-4cd8-83eb-e7875a1fd136",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary B",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "2c7c29b9-4be2-4bc1-a2fc-cbee7e52bfe6",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary C",
        "offset": 4,
        "source": "environment"
      },
      {
        "id": "8ba8cc0a-e3f3-4f8f-b1e1-af85247197c6",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-4",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "cond-1-summary",
          "cond-3-summary"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_forget_multiple_summaries_simultaneously",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "0c3f8253-9a6c-4b96-a139-033ccb26e7ae",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary B",
        "source": "environment"
      },
      {
        "id": "40f77081-ad83-4cd8-83eb-e7875a1fd136",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "2c7c29b9-4be2-4bc1-a2fc-cbee7e52bfe6",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "8ba8cc0a-e3f3-4f8f-b1e1-af85247197c6",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
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
        "id": "0c3f8253-9a6c-4b96-a139-033ccb26e7ae",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary A",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "40f77081-ad83-4cd8-83eb-e7875a1fd136",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary B",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "2c7c29b9-4be2-4bc1-a2fc-cbee7e52bfe6",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary C",
        "offset": 4,
        "source": "environment"
      },
      {
        "id": "8ba8cc0a-e3f3-4f8f-b1e1-af85247197c6",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-4",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "cond-1-summary",
          "cond-3-summary"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_forget_multiple_summaries_simultaneously",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "0c3f8253-9a6c-4b96-a139-033ccb26e7ae",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary B",
        "source": "environment"
      },
      {
        "id": "40f77081-ad83-4cd8-83eb-e7875a1fd136",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "2c7c29b9-4be2-4bc1-a2fc-cbee7e52bfe6",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "8ba8cc0a-e3f3-4f8f-b1e1-af85247197c6",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
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
        "id": "0c3f8253-9a6c-4b96-a139-033ccb26e7ae",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary A",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "40f77081-ad83-4cd8-83eb-e7875a1fd136",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary B",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "2c7c29b9-4be2-4bc1-a2fc-cbee7e52bfe6",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary C",
        "offset": 4,
        "source": "environment"
      },
      {
        "id": "8ba8cc0a-e3f3-4f8f-b1e1-af85247197c6",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-4",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "cond-1-summary",
          "cond-3-summary"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_forget_multiple_summaries_simultaneously",
    "op": "from_events",
    "input": [
      {
        "id": "0c3f8253-9a6c-4b96-a139-033ccb26e7ae",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary A",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "40f77081-ad83-4cd8-83eb-e7875a1fd136",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary B",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "2c7c29b9-4be2-4bc1-a2fc-cbee7e52bfe6",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary C",
        "offset": 4,
        "source": "environment"
      },
      {
        "id": "8ba8cc0a-e3f3-4f8f-b1e1-af85247197c6",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-4",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "cond-1-summary",
          "cond-3-summary"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": [
      {
        "id": "0c3f8253-9a6c-4b96-a139-033ccb26e7ae",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary B",
        "source": "environment"
      },
      {
        "id": "40f77081-ad83-4cd8-83eb-e7875a1fd136",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "2c7c29b9-4be2-4bc1-a2fc-cbee7e52bfe6",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "8ba8cc0a-e3f3-4f8f-b1e1-af85247197c6",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
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
    "name": "test_forget_all_summaries",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "0a0f4998-231b-4512-8957-dc0c4d659e6e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "a92362b9-b592-469e-94bb-55cee4277e75",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "9a8fedb6-b573-4bb6-99fd-1e3ac50f1ef3",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
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
        "id": "0a0f4998-231b-4512-8957-dc0c4d659e6e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary A",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "a92362b9-b592-469e-94bb-55cee4277e75",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary B",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "9a8fedb6-b573-4bb6-99fd-1e3ac50f1ef3",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "cond-1-summary",
          "cond-2-summary"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_forget_all_summaries",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "0a0f4998-231b-4512-8957-dc0c4d659e6e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "a92362b9-b592-469e-94bb-55cee4277e75",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "9a8fedb6-b573-4bb6-99fd-1e3ac50f1ef3",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
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
        "id": "0a0f4998-231b-4512-8957-dc0c4d659e6e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary A",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "a92362b9-b592-469e-94bb-55cee4277e75",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary B",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "9a8fedb6-b573-4bb6-99fd-1e3ac50f1ef3",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "cond-1-summary",
          "cond-2-summary"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_forget_all_summaries",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "0a0f4998-231b-4512-8957-dc0c4d659e6e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "a92362b9-b592-469e-94bb-55cee4277e75",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "9a8fedb6-b573-4bb6-99fd-1e3ac50f1ef3",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
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
        "id": "0a0f4998-231b-4512-8957-dc0c4d659e6e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary A",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "a92362b9-b592-469e-94bb-55cee4277e75",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary B",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "9a8fedb6-b573-4bb6-99fd-1e3ac50f1ef3",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "cond-1-summary",
          "cond-2-summary"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_forget_all_summaries",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "0a0f4998-231b-4512-8957-dc0c4d659e6e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "a92362b9-b592-469e-94bb-55cee4277e75",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "9a8fedb6-b573-4bb6-99fd-1e3ac50f1ef3",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
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
        "id": "0a0f4998-231b-4512-8957-dc0c4d659e6e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary A",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "a92362b9-b592-469e-94bb-55cee4277e75",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary B",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "9a8fedb6-b573-4bb6-99fd-1e3ac50f1ef3",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "cond-1-summary",
          "cond-2-summary"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_forget_all_summaries",
    "op": "from_events",
    "input": [
      {
        "id": "0a0f4998-231b-4512-8957-dc0c4d659e6e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary A",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "a92362b9-b592-469e-94bb-55cee4277e75",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary B",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "9a8fedb6-b573-4bb6-99fd-1e3ac50f1ef3",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "cond-1-summary",
          "cond-2-summary"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": [
      {
        "id": "0a0f4998-231b-4512-8957-dc0c4d659e6e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "a92362b9-b592-469e-94bb-55cee4277e75",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "9a8fedb6-b573-4bb6-99fd-1e3ac50f1ef3",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
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
    "name": "test_sequential_condensations_each_forget_summary",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "d483f67a-5111-4e62-be2f-b221797e2d24",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "5f835aa7-8073-4e11-96f5-0ac2bef07e9c",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-3-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary 3",
        "source": "environment"
      },
      {
        "id": "d6c5c73d-9d95-407e-8b98-3beeeccfaf7f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "0f921487-e426-4290-ad39-8a9164640977",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
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
        "id": "d483f67a-5111-4e62-be2f-b221797e2d24",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary 1",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "5f835aa7-8073-4e11-96f5-0ac2bef07e9c",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary 2",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "d6c5c73d-9d95-407e-8b98-3beeeccfaf7f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary 3",
        "offset": 4,
        "source": "environment"
      },
      {
        "id": "0f921487-e426-4290-ad39-8a9164640977",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-4",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "cond-1-summary"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      },
      {
        "id": "cond-5",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "cond-2-summary"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_sequential_condensations_each_forget_summary",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "d483f67a-5111-4e62-be2f-b221797e2d24",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "5f835aa7-8073-4e11-96f5-0ac2bef07e9c",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-3-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary 3",
        "source": "environment"
      },
      {
        "id": "d6c5c73d-9d95-407e-8b98-3beeeccfaf7f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "0f921487-e426-4290-ad39-8a9164640977",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
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
        "id": "d483f67a-5111-4e62-be2f-b221797e2d24",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary 1",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "5f835aa7-8073-4e11-96f5-0ac2bef07e9c",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary 2",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "d6c5c73d-9d95-407e-8b98-3beeeccfaf7f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary 3",
        "offset": 4,
        "source": "environment"
      },
      {
        "id": "0f921487-e426-4290-ad39-8a9164640977",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-4",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "cond-1-summary"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      },
      {
        "id": "cond-5",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "cond-2-summary"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_sequential_condensations_each_forget_summary",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "d483f67a-5111-4e62-be2f-b221797e2d24",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "5f835aa7-8073-4e11-96f5-0ac2bef07e9c",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-3-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary 3",
        "source": "environment"
      },
      {
        "id": "d6c5c73d-9d95-407e-8b98-3beeeccfaf7f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "0f921487-e426-4290-ad39-8a9164640977",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
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
        "id": "d483f67a-5111-4e62-be2f-b221797e2d24",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary 1",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "5f835aa7-8073-4e11-96f5-0ac2bef07e9c",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary 2",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "d6c5c73d-9d95-407e-8b98-3beeeccfaf7f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary 3",
        "offset": 4,
        "source": "environment"
      },
      {
        "id": "0f921487-e426-4290-ad39-8a9164640977",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-4",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "cond-1-summary"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      },
      {
        "id": "cond-5",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "cond-2-summary"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_sequential_condensations_each_forget_summary",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "d483f67a-5111-4e62-be2f-b221797e2d24",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "5f835aa7-8073-4e11-96f5-0ac2bef07e9c",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-3-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary 3",
        "source": "environment"
      },
      {
        "id": "d6c5c73d-9d95-407e-8b98-3beeeccfaf7f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "0f921487-e426-4290-ad39-8a9164640977",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
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
        "id": "d483f67a-5111-4e62-be2f-b221797e2d24",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary 1",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "5f835aa7-8073-4e11-96f5-0ac2bef07e9c",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary 2",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "d6c5c73d-9d95-407e-8b98-3beeeccfaf7f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary 3",
        "offset": 4,
        "source": "environment"
      },
      {
        "id": "0f921487-e426-4290-ad39-8a9164640977",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-4",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "cond-1-summary"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      },
      {
        "id": "cond-5",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "cond-2-summary"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_sequential_condensations_each_forget_summary",
    "op": "from_events",
    "input": [
      {
        "id": "d483f67a-5111-4e62-be2f-b221797e2d24",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary 1",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "5f835aa7-8073-4e11-96f5-0ac2bef07e9c",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary 2",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "d6c5c73d-9d95-407e-8b98-3beeeccfaf7f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Summary 3",
        "offset": 4,
        "source": "environment"
      },
      {
        "id": "0f921487-e426-4290-ad39-8a9164640977",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-4",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "cond-1-summary"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      },
      {
        "id": "cond-5",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "cond-2-summary"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": [
      {
        "id": "d483f67a-5111-4e62-be2f-b221797e2d24",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "5f835aa7-8073-4e11-96f5-0ac2bef07e9c",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-3-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary 3",
        "source": "environment"
      },
      {
        "id": "d6c5c73d-9d95-407e-8b98-3beeeccfaf7f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "0f921487-e426-4290-ad39-8a9164640977",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
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
    "name": "test_summary_events_have_stable_identifiers",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "stable-condensation-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Stable summary",
        "source": "environment"
      },
      {
        "id": "c912bc6a-d1bd-4faa-95fd-214df06db202",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cce10c7c-bd63-43fb-a102-2c0f59bd11cc",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
        "id": "c912bc6a-d1bd-4faa-95fd-214df06db202",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "stable-condensation",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Stable summary",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "cce10c7c-bd63-43fb-a102-2c0f59bd11cc",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
    "name": "test_summary_events_have_stable_identifiers",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "stable-condensation-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Stable summary",
        "source": "environment"
      },
      {
        "id": "c912bc6a-d1bd-4faa-95fd-214df06db202",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cce10c7c-bd63-43fb-a102-2c0f59bd11cc",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
        "id": "c912bc6a-d1bd-4faa-95fd-214df06db202",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "stable-condensation",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Stable summary",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "cce10c7c-bd63-43fb-a102-2c0f59bd11cc",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
    "name": "test_summary_events_have_stable_identifiers",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "stable-condensation-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Stable summary",
        "source": "environment"
      },
      {
        "id": "c912bc6a-d1bd-4faa-95fd-214df06db202",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cce10c7c-bd63-43fb-a102-2c0f59bd11cc",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
        "id": "c912bc6a-d1bd-4faa-95fd-214df06db202",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "stable-condensation",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Stable summary",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "cce10c7c-bd63-43fb-a102-2c0f59bd11cc",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
    "name": "test_summary_events_have_stable_identifiers",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "stable-condensation-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Stable summary",
        "source": "environment"
      },
      {
        "id": "c912bc6a-d1bd-4faa-95fd-214df06db202",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cce10c7c-bd63-43fb-a102-2c0f59bd11cc",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
        "id": "c912bc6a-d1bd-4faa-95fd-214df06db202",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "stable-condensation",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Stable summary",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "cce10c7c-bd63-43fb-a102-2c0f59bd11cc",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
    "name": "test_summary_events_have_stable_identifiers",
    "op": "from_events",
    "input": [
      {
        "id": "c912bc6a-d1bd-4faa-95fd-214df06db202",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "stable-condensation",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Stable summary",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "cce10c7c-bd63-43fb-a102-2c0f59bd11cc",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
        "id": "stable-condensation-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Stable summary",
        "source": "environment"
      },
      {
        "id": "c912bc6a-d1bd-4faa-95fd-214df06db202",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cce10c7c-bd63-43fb-a102-2c0f59bd11cc",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
    "name": "test_summary_events_have_stable_identifiers",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "stable-condensation-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Stable summary",
        "source": "environment"
      },
      {
        "id": "c912bc6a-d1bd-4faa-95fd-214df06db202",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cce10c7c-bd63-43fb-a102-2c0f59bd11cc",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
        "id": "c912bc6a-d1bd-4faa-95fd-214df06db202",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "stable-condensation",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Stable summary",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "cce10c7c-bd63-43fb-a102-2c0f59bd11cc",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
    "name": "test_summary_events_have_stable_identifiers",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "stable-condensation-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Stable summary",
        "source": "environment"
      },
      {
        "id": "c912bc6a-d1bd-4faa-95fd-214df06db202",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cce10c7c-bd63-43fb-a102-2c0f59bd11cc",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
        "id": "c912bc6a-d1bd-4faa-95fd-214df06db202",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "stable-condensation",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Stable summary",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "cce10c7c-bd63-43fb-a102-2c0f59bd11cc",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
    "name": "test_summary_events_have_stable_identifiers",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "stable-condensation-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Stable summary",
        "source": "environment"
      },
      {
        "id": "c912bc6a-d1bd-4faa-95fd-214df06db202",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cce10c7c-bd63-43fb-a102-2c0f59bd11cc",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
        "id": "c912bc6a-d1bd-4faa-95fd-214df06db202",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "stable-condensation",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Stable summary",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "cce10c7c-bd63-43fb-a102-2c0f59bd11cc",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
    "name": "test_summary_events_have_stable_identifiers",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "stable-condensation-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Stable summary",
        "source": "environment"
      },
      {
        "id": "c912bc6a-d1bd-4faa-95fd-214df06db202",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cce10c7c-bd63-43fb-a102-2c0f59bd11cc",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
        "id": "c912bc6a-d1bd-4faa-95fd-214df06db202",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "stable-condensation",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Stable summary",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "cce10c7c-bd63-43fb-a102-2c0f59bd11cc",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
    "name": "test_summary_events_have_stable_identifiers",
    "op": "from_events",
    "input": [
      {
        "id": "c912bc6a-d1bd-4faa-95fd-214df06db202",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "stable-condensation",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Stable summary",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "cce10c7c-bd63-43fb-a102-2c0f59bd11cc",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
        "id": "stable-condensation-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Stable summary",
        "source": "environment"
      },
      {
        "id": "c912bc6a-d1bd-4faa-95fd-214df06db202",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cce10c7c-bd63-43fb-a102-2c0f59bd11cc",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
    "name": "test_condensation_tracks_its_summary_event",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "cond-A-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "First",
        "source": "environment"
      },
      {
        "id": "dba3453c-6983-40fa-a003-d397d2dfbf69",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-B-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Second",
        "source": "environment"
      },
      {
        "id": "a1d8270b-dffb-41fb-abdc-60b710b4c399",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "d95b5d8e-0ad5-403a-ab14-69b5f07154d1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
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
        "id": "dba3453c-6983-40fa-a003-d397d2dfbf69",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-A",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "First",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "a1d8270b-dffb-41fb-abdc-60b710b4c399",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-B",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Second",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "d95b5d8e-0ad5-403a-ab14-69b5f07154d1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
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
    "name": "test_condensation_tracks_its_summary_event",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "cond-A-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "First",
        "source": "environment"
      },
      {
        "id": "dba3453c-6983-40fa-a003-d397d2dfbf69",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-B-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Second",
        "source": "environment"
      },
      {
        "id": "a1d8270b-dffb-41fb-abdc-60b710b4c399",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "d95b5d8e-0ad5-403a-ab14-69b5f07154d1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
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
        "id": "dba3453c-6983-40fa-a003-d397d2dfbf69",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-A",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "First",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "a1d8270b-dffb-41fb-abdc-60b710b4c399",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-B",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Second",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "d95b5d8e-0ad5-403a-ab14-69b5f07154d1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
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
    "name": "test_condensation_tracks_its_summary_event",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "cond-A-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "First",
        "source": "environment"
      },
      {
        "id": "dba3453c-6983-40fa-a003-d397d2dfbf69",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-B-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Second",
        "source": "environment"
      },
      {
        "id": "a1d8270b-dffb-41fb-abdc-60b710b4c399",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "d95b5d8e-0ad5-403a-ab14-69b5f07154d1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
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
        "id": "dba3453c-6983-40fa-a003-d397d2dfbf69",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-A",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "First",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "a1d8270b-dffb-41fb-abdc-60b710b4c399",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-B",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Second",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "d95b5d8e-0ad5-403a-ab14-69b5f07154d1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
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
    "name": "test_condensation_tracks_its_summary_event",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "cond-A-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "First",
        "source": "environment"
      },
      {
        "id": "dba3453c-6983-40fa-a003-d397d2dfbf69",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-B-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Second",
        "source": "environment"
      },
      {
        "id": "a1d8270b-dffb-41fb-abdc-60b710b4c399",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "d95b5d8e-0ad5-403a-ab14-69b5f07154d1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
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
        "id": "dba3453c-6983-40fa-a003-d397d2dfbf69",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-A",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "First",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "a1d8270b-dffb-41fb-abdc-60b710b4c399",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-B",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Second",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "d95b5d8e-0ad5-403a-ab14-69b5f07154d1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
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
    "name": "test_condensation_tracks_its_summary_event",
    "op": "from_events",
    "input": [
      {
        "id": "dba3453c-6983-40fa-a003-d397d2dfbf69",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-A",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "First",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "a1d8270b-dffb-41fb-abdc-60b710b4c399",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-B",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Second",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "d95b5d8e-0ad5-403a-ab14-69b5f07154d1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
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
        "id": "cond-A-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "First",
        "source": "environment"
      },
      {
        "id": "dba3453c-6983-40fa-a003-d397d2dfbf69",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-B-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Second",
        "source": "environment"
      },
      {
        "id": "a1d8270b-dffb-41fb-abdc-60b710b4c399",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "d95b5d8e-0ad5-403a-ab14-69b5f07154d1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
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
    "name": "test_can_reference_summary_from_previous_condensation",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "To be forgotten",
        "source": "environment"
      },
      {
        "id": "8aeb70fa-01e4-48ba-8bb7-5fb29fa5b86e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "724a79b7-193f-408d-a1fe-3faae860bd0f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
        "id": "8aeb70fa-01e4-48ba-8bb7-5fb29fa5b86e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "To be forgotten",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "724a79b7-193f-408d-a1fe-3faae860bd0f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
    "name": "test_can_reference_summary_from_previous_condensation",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "To be forgotten",
        "source": "environment"
      },
      {
        "id": "8aeb70fa-01e4-48ba-8bb7-5fb29fa5b86e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "724a79b7-193f-408d-a1fe-3faae860bd0f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
        "id": "8aeb70fa-01e4-48ba-8bb7-5fb29fa5b86e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "To be forgotten",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "724a79b7-193f-408d-a1fe-3faae860bd0f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
    "name": "test_can_reference_summary_from_previous_condensation",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "To be forgotten",
        "source": "environment"
      },
      {
        "id": "8aeb70fa-01e4-48ba-8bb7-5fb29fa5b86e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "724a79b7-193f-408d-a1fe-3faae860bd0f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
        "id": "8aeb70fa-01e4-48ba-8bb7-5fb29fa5b86e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "To be forgotten",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "724a79b7-193f-408d-a1fe-3faae860bd0f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
    "name": "test_can_reference_summary_from_previous_condensation",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "To be forgotten",
        "source": "environment"
      },
      {
        "id": "8aeb70fa-01e4-48ba-8bb7-5fb29fa5b86e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "724a79b7-193f-408d-a1fe-3faae860bd0f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
        "id": "8aeb70fa-01e4-48ba-8bb7-5fb29fa5b86e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "To be forgotten",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "724a79b7-193f-408d-a1fe-3faae860bd0f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
    "name": "test_can_reference_summary_from_previous_condensation",
    "op": "from_events",
    "input": [
      {
        "id": "8aeb70fa-01e4-48ba-8bb7-5fb29fa5b86e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "To be forgotten",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "724a79b7-193f-408d-a1fe-3faae860bd0f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "To be forgotten",
        "source": "environment"
      },
      {
        "id": "8aeb70fa-01e4-48ba-8bb7-5fb29fa5b86e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "724a79b7-193f-408d-a1fe-3faae860bd0f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
    "name": "test_can_reference_summary_from_previous_condensation",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "cond-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "New summary",
        "source": "environment"
      },
      {
        "id": "8aeb70fa-01e4-48ba-8bb7-5fb29fa5b86e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "724a79b7-193f-408d-a1fe-3faae860bd0f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
        "id": "8aeb70fa-01e4-48ba-8bb7-5fb29fa5b86e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "To be forgotten",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "724a79b7-193f-408d-a1fe-3faae860bd0f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "cond-1-summary"
        ],
        "summary": "New summary",
        "offset": 0,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_can_reference_summary_from_previous_condensation",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "cond-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "New summary",
        "source": "environment"
      },
      {
        "id": "8aeb70fa-01e4-48ba-8bb7-5fb29fa5b86e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "724a79b7-193f-408d-a1fe-3faae860bd0f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
        "id": "8aeb70fa-01e4-48ba-8bb7-5fb29fa5b86e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "To be forgotten",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "724a79b7-193f-408d-a1fe-3faae860bd0f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "cond-1-summary"
        ],
        "summary": "New summary",
        "offset": 0,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_can_reference_summary_from_previous_condensation",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "cond-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "New summary",
        "source": "environment"
      },
      {
        "id": "8aeb70fa-01e4-48ba-8bb7-5fb29fa5b86e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "724a79b7-193f-408d-a1fe-3faae860bd0f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
        "id": "8aeb70fa-01e4-48ba-8bb7-5fb29fa5b86e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "To be forgotten",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "724a79b7-193f-408d-a1fe-3faae860bd0f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "cond-1-summary"
        ],
        "summary": "New summary",
        "offset": 0,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_can_reference_summary_from_previous_condensation",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "cond-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "New summary",
        "source": "environment"
      },
      {
        "id": "8aeb70fa-01e4-48ba-8bb7-5fb29fa5b86e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "724a79b7-193f-408d-a1fe-3faae860bd0f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
        "id": "8aeb70fa-01e4-48ba-8bb7-5fb29fa5b86e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "To be forgotten",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "724a79b7-193f-408d-a1fe-3faae860bd0f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "cond-1-summary"
        ],
        "summary": "New summary",
        "offset": 0,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_can_reference_summary_from_previous_condensation",
    "op": "from_events",
    "input": [
      {
        "id": "8aeb70fa-01e4-48ba-8bb7-5fb29fa5b86e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "To be forgotten",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "724a79b7-193f-408d-a1fe-3faae860bd0f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "cond-1-summary"
        ],
        "summary": "New summary",
        "offset": 0,
        "source": "environment"
      }
    ],
    "expected": [
      {
        "id": "cond-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "New summary",
        "source": "environment"
      },
      {
        "id": "8aeb70fa-01e4-48ba-8bb7-5fb29fa5b86e",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "724a79b7-193f-408d-a1fe-3faae860bd0f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
    "name": "test_summary_offset_is_absolute_in_final_view",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "c0d409a7-10c0-490b-a18b-d52cb4e6f7b9",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary at offset 1",
        "source": "environment"
      },
      {
        "id": "18d21453-e443-42c1-b3ff-09d286d1736f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "ce098612-092b-4a09-8bb7-679cd7881780",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 4"
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
        "id": "c21f5a06-4ae0-4aee-a35f-026ffd3caa99",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "f43e309d-e049-4b66-93ac-65882a8284da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "c0d409a7-10c0-490b-a18b-d52cb4e6f7b9",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "c21f5a06-4ae0-4aee-a35f-026ffd3caa99",
          "f43e309d-e049-4b66-93ac-65882a8284da"
        ],
        "summary": "Summary at offset 1",
        "offset": 1,
        "source": "environment"
      },
      {
        "id": "18d21453-e443-42c1-b3ff-09d286d1736f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "ce098612-092b-4a09-8bb7-679cd7881780",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 4"
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
    "name": "test_summary_offset_is_absolute_in_final_view",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "c0d409a7-10c0-490b-a18b-d52cb4e6f7b9",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary at offset 1",
        "source": "environment"
      },
      {
        "id": "18d21453-e443-42c1-b3ff-09d286d1736f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "ce098612-092b-4a09-8bb7-679cd7881780",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 4"
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
        "id": "c21f5a06-4ae0-4aee-a35f-026ffd3caa99",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "f43e309d-e049-4b66-93ac-65882a8284da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "c0d409a7-10c0-490b-a18b-d52cb4e6f7b9",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "c21f5a06-4ae0-4aee-a35f-026ffd3caa99",
          "f43e309d-e049-4b66-93ac-65882a8284da"
        ],
        "summary": "Summary at offset 1",
        "offset": 1,
        "source": "environment"
      },
      {
        "id": "18d21453-e443-42c1-b3ff-09d286d1736f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "ce098612-092b-4a09-8bb7-679cd7881780",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 4"
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
    "name": "test_summary_offset_is_absolute_in_final_view",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "c0d409a7-10c0-490b-a18b-d52cb4e6f7b9",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary at offset 1",
        "source": "environment"
      },
      {
        "id": "18d21453-e443-42c1-b3ff-09d286d1736f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "ce098612-092b-4a09-8bb7-679cd7881780",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 4"
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
        "id": "c21f5a06-4ae0-4aee-a35f-026ffd3caa99",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "f43e309d-e049-4b66-93ac-65882a8284da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "c0d409a7-10c0-490b-a18b-d52cb4e6f7b9",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "c21f5a06-4ae0-4aee-a35f-026ffd3caa99",
          "f43e309d-e049-4b66-93ac-65882a8284da"
        ],
        "summary": "Summary at offset 1",
        "offset": 1,
        "source": "environment"
      },
      {
        "id": "18d21453-e443-42c1-b3ff-09d286d1736f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "ce098612-092b-4a09-8bb7-679cd7881780",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 4"
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
    "name": "test_summary_offset_is_absolute_in_final_view",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "c0d409a7-10c0-490b-a18b-d52cb4e6f7b9",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary at offset 1",
        "source": "environment"
      },
      {
        "id": "18d21453-e443-42c1-b3ff-09d286d1736f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "ce098612-092b-4a09-8bb7-679cd7881780",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 4"
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
        "id": "c21f5a06-4ae0-4aee-a35f-026ffd3caa99",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "f43e309d-e049-4b66-93ac-65882a8284da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "c0d409a7-10c0-490b-a18b-d52cb4e6f7b9",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "c21f5a06-4ae0-4aee-a35f-026ffd3caa99",
          "f43e309d-e049-4b66-93ac-65882a8284da"
        ],
        "summary": "Summary at offset 1",
        "offset": 1,
        "source": "environment"
      },
      {
        "id": "18d21453-e443-42c1-b3ff-09d286d1736f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "ce098612-092b-4a09-8bb7-679cd7881780",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 4"
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
    "name": "test_summary_offset_is_absolute_in_final_view",
    "op": "from_events",
    "input": [
      {
        "id": "c21f5a06-4ae0-4aee-a35f-026ffd3caa99",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "f43e309d-e049-4b66-93ac-65882a8284da",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "c0d409a7-10c0-490b-a18b-d52cb4e6f7b9",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "c21f5a06-4ae0-4aee-a35f-026ffd3caa99",
          "f43e309d-e049-4b66-93ac-65882a8284da"
        ],
        "summary": "Summary at offset 1",
        "offset": 1,
        "source": "environment"
      },
      {
        "id": "18d21453-e443-42c1-b3ff-09d286d1736f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "ce098612-092b-4a09-8bb7-679cd7881780",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 4"
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
        "id": "c0d409a7-10c0-490b-a18b-d52cb4e6f7b9",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary at offset 1",
        "source": "environment"
      },
      {
        "id": "18d21453-e443-42c1-b3ff-09d286d1736f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "ce098612-092b-4a09-8bb7-679cd7881780",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 4"
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
    "name": "test_summary_offset_zero_inserts_at_beginning",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "At the start",
        "source": "environment"
      },
      {
        "id": "adbd7a0e-5ba0-4a72-ae27-752f11611934",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "13f36858-274a-4ed7-800d-554f469d8ec6",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "7192d494-5eeb-49d1-8f69-6212ee3da65d",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
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
        "id": "adbd7a0e-5ba0-4a72-ae27-752f11611934",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "At the start",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "13f36858-274a-4ed7-800d-554f469d8ec6",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "7192d494-5eeb-49d1-8f69-6212ee3da65d",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
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
    "name": "test_summary_offset_zero_inserts_at_beginning",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "At the start",
        "source": "environment"
      },
      {
        "id": "adbd7a0e-5ba0-4a72-ae27-752f11611934",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "13f36858-274a-4ed7-800d-554f469d8ec6",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "7192d494-5eeb-49d1-8f69-6212ee3da65d",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
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
        "id": "adbd7a0e-5ba0-4a72-ae27-752f11611934",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "At the start",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "13f36858-274a-4ed7-800d-554f469d8ec6",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "7192d494-5eeb-49d1-8f69-6212ee3da65d",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
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
    "name": "test_summary_offset_zero_inserts_at_beginning",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "At the start",
        "source": "environment"
      },
      {
        "id": "adbd7a0e-5ba0-4a72-ae27-752f11611934",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "13f36858-274a-4ed7-800d-554f469d8ec6",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "7192d494-5eeb-49d1-8f69-6212ee3da65d",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
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
        "id": "adbd7a0e-5ba0-4a72-ae27-752f11611934",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "At the start",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "13f36858-274a-4ed7-800d-554f469d8ec6",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "7192d494-5eeb-49d1-8f69-6212ee3da65d",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
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
    "name": "test_summary_offset_zero_inserts_at_beginning",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "At the start",
        "source": "environment"
      },
      {
        "id": "adbd7a0e-5ba0-4a72-ae27-752f11611934",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "13f36858-274a-4ed7-800d-554f469d8ec6",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "7192d494-5eeb-49d1-8f69-6212ee3da65d",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
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
        "id": "adbd7a0e-5ba0-4a72-ae27-752f11611934",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "At the start",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "13f36858-274a-4ed7-800d-554f469d8ec6",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "7192d494-5eeb-49d1-8f69-6212ee3da65d",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
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
    "name": "test_summary_offset_zero_inserts_at_beginning",
    "op": "from_events",
    "input": [
      {
        "id": "adbd7a0e-5ba0-4a72-ae27-752f11611934",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "At the start",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "13f36858-274a-4ed7-800d-554f469d8ec6",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "7192d494-5eeb-49d1-8f69-6212ee3da65d",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
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
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "At the start",
        "source": "environment"
      },
      {
        "id": "adbd7a0e-5ba0-4a72-ae27-752f11611934",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "13f36858-274a-4ed7-800d-554f469d8ec6",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "7192d494-5eeb-49d1-8f69-6212ee3da65d",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
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
    "name": "test_summary_offset_at_end_of_events",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "f609eb1f-144c-4a74-b5bd-d5fb7efc6793",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "ef678702-06fd-4422-b0b7-bd9023a54afa",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "356d17a8-2a6c-47a9-82d8-8b4cdb4f5322",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "At the end",
        "source": "environment"
      }
    ],
    "all": [
      {
        "id": "f609eb1f-144c-4a74-b5bd-d5fb7efc6793",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "ef678702-06fd-4422-b0b7-bd9023a54afa",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "356d17a8-2a6c-47a9-82d8-8b4cdb4f5322",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "At the end",
        "offset": 3,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_summary_offset_at_end_of_events",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "f609eb1f-144c-4a74-b5bd-d5fb7efc6793",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "ef678702-06fd-4422-b0b7-bd9023a54afa",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "356d17a8-2a6c-47a9-82d8-8b4cdb4f5322",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "At the end",
        "source": "environment"
      }
    ],
    "all": [
      {
        "id": "f609eb1f-144c-4a74-b5bd-d5fb7efc6793",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "ef678702-06fd-4422-b0b7-bd9023a54afa",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "356d17a8-2a6c-47a9-82d8-8b4cdb4f5322",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "At the end",
        "offset": 3,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_summary_offset_at_end_of_events",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "f609eb1f-144c-4a74-b5bd-d5fb7efc6793",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "ef678702-06fd-4422-b0b7-bd9023a54afa",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "356d17a8-2a6c-47a9-82d8-8b4cdb4f5322",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "At the end",
        "source": "environment"
      }
    ],
    "all": [
      {
        "id": "f609eb1f-144c-4a74-b5bd-d5fb7efc6793",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "ef678702-06fd-4422-b0b7-bd9023a54afa",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "356d17a8-2a6c-47a9-82d8-8b4cdb4f5322",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "At the end",
        "offset": 3,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_summary_offset_at_end_of_events",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "f609eb1f-144c-4a74-b5bd-d5fb7efc6793",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "ef678702-06fd-4422-b0b7-bd9023a54afa",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "356d17a8-2a6c-47a9-82d8-8b4cdb4f5322",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "At the end",
        "source": "environment"
      }
    ],
    "all": [
      {
        "id": "f609eb1f-144c-4a74-b5bd-d5fb7efc6793",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "ef678702-06fd-4422-b0b7-bd9023a54afa",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "356d17a8-2a6c-47a9-82d8-8b4cdb4f5322",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "At the end",
        "offset": 3,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_summary_offset_at_end_of_events",
    "op": "from_events",
    "input": [
      {
        "id": "f609eb1f-144c-4a74-b5bd-d5fb7efc6793",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "ef678702-06fd-4422-b0b7-bd9023a54afa",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "356d17a8-2a6c-47a9-82d8-8b4cdb4f5322",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "At the end",
        "offset": 3,
        "source": "environment"
      }
    ],
    "expected": [
      {
        "id": "f609eb1f-144c-4a74-b5bd-d5fb7efc6793",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "ef678702-06fd-4422-b0b7-bd9023a54afa",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "356d17a8-2a6c-47a9-82d8-8b4cdb4f5322",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "At the end",
        "source": "environment"
      }
    ],
    "unhandled": false
  },
  {
    "name": "test_multiple_summaries_with_same_offset",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "16ff23b3-013e-43e6-a37d-099d16128d6a",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Second at offset 1",
        "source": "environment"
      },
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "First at offset 1",
        "source": "environment"
      },
      {
        "id": "d64df1e0-583b-4a69-800c-402e00f4f6b0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
        "id": "16ff23b3-013e-43e6-a37d-099d16128d6a",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "First at offset 1",
        "offset": 1,
        "source": "environment"
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Second at offset 1",
        "offset": 1,
        "source": "environment"
      },
      {
        "id": "d64df1e0-583b-4a69-800c-402e00f4f6b0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
    "name": "test_multiple_summaries_with_same_offset",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "16ff23b3-013e-43e6-a37d-099d16128d6a",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Second at offset 1",
        "source": "environment"
      },
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "First at offset 1",
        "source": "environment"
      },
      {
        "id": "d64df1e0-583b-4a69-800c-402e00f4f6b0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
        "id": "16ff23b3-013e-43e6-a37d-099d16128d6a",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "First at offset 1",
        "offset": 1,
        "source": "environment"
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Second at offset 1",
        "offset": 1,
        "source": "environment"
      },
      {
        "id": "d64df1e0-583b-4a69-800c-402e00f4f6b0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
    "name": "test_multiple_summaries_with_same_offset",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "16ff23b3-013e-43e6-a37d-099d16128d6a",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Second at offset 1",
        "source": "environment"
      },
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "First at offset 1",
        "source": "environment"
      },
      {
        "id": "d64df1e0-583b-4a69-800c-402e00f4f6b0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
        "id": "16ff23b3-013e-43e6-a37d-099d16128d6a",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "First at offset 1",
        "offset": 1,
        "source": "environment"
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Second at offset 1",
        "offset": 1,
        "source": "environment"
      },
      {
        "id": "d64df1e0-583b-4a69-800c-402e00f4f6b0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
    "name": "test_multiple_summaries_with_same_offset",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "16ff23b3-013e-43e6-a37d-099d16128d6a",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Second at offset 1",
        "source": "environment"
      },
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "First at offset 1",
        "source": "environment"
      },
      {
        "id": "d64df1e0-583b-4a69-800c-402e00f4f6b0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
        "id": "16ff23b3-013e-43e6-a37d-099d16128d6a",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "First at offset 1",
        "offset": 1,
        "source": "environment"
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Second at offset 1",
        "offset": 1,
        "source": "environment"
      },
      {
        "id": "d64df1e0-583b-4a69-800c-402e00f4f6b0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
    "name": "test_multiple_summaries_with_same_offset",
    "op": "from_events",
    "input": [
      {
        "id": "16ff23b3-013e-43e6-a37d-099d16128d6a",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "First at offset 1",
        "offset": 1,
        "source": "environment"
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Second at offset 1",
        "offset": 1,
        "source": "environment"
      },
      {
        "id": "d64df1e0-583b-4a69-800c-402e00f4f6b0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
        "id": "16ff23b3-013e-43e6-a37d-099d16128d6a",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Second at offset 1",
        "source": "environment"
      },
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "First at offset 1",
        "source": "environment"
      },
      {
        "id": "d64df1e0-583b-4a69-800c-402e00f4f6b0",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
    "name": "test_forget_events_and_summary_together",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "cond-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "New summary",
        "source": "environment"
      },
      {
        "id": "73e2ef51-0ef4-49d7-b670-c3b858bb3916",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "ef9d4841-ae38-4c1a-9252-1608a6ca4a70",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
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
        "id": "8f388c73-d8c2-433b-a567-015d48a9b7f9",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "73e2ef51-0ef4-49d7-b670-c3b858bb3916",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Old summary",
        "offset": 1,
        "source": "environment"
      },
      {
        "id": "d54ef349-0102-4ba0-b796-a18ac952a150",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "ef9d4841-ae38-4c1a-9252-1608a6ca4a70",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "8f388c73-d8c2-433b-a567-015d48a9b7f9",
          "cond-1-summary",
          "d54ef349-0102-4ba0-b796-a18ac952a150"
        ],
        "summary": "New summary",
        "offset": 0,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_forget_events_and_summary_together",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "cond-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "New summary",
        "source": "environment"
      },
      {
        "id": "73e2ef51-0ef4-49d7-b670-c3b858bb3916",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "ef9d4841-ae38-4c1a-9252-1608a6ca4a70",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
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
        "id": "8f388c73-d8c2-433b-a567-015d48a9b7f9",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "73e2ef51-0ef4-49d7-b670-c3b858bb3916",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Old summary",
        "offset": 1,
        "source": "environment"
      },
      {
        "id": "d54ef349-0102-4ba0-b796-a18ac952a150",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "ef9d4841-ae38-4c1a-9252-1608a6ca4a70",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "8f388c73-d8c2-433b-a567-015d48a9b7f9",
          "cond-1-summary",
          "d54ef349-0102-4ba0-b796-a18ac952a150"
        ],
        "summary": "New summary",
        "offset": 0,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_forget_events_and_summary_together",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "cond-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "New summary",
        "source": "environment"
      },
      {
        "id": "73e2ef51-0ef4-49d7-b670-c3b858bb3916",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "ef9d4841-ae38-4c1a-9252-1608a6ca4a70",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
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
        "id": "8f388c73-d8c2-433b-a567-015d48a9b7f9",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "73e2ef51-0ef4-49d7-b670-c3b858bb3916",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Old summary",
        "offset": 1,
        "source": "environment"
      },
      {
        "id": "d54ef349-0102-4ba0-b796-a18ac952a150",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "ef9d4841-ae38-4c1a-9252-1608a6ca4a70",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "8f388c73-d8c2-433b-a567-015d48a9b7f9",
          "cond-1-summary",
          "d54ef349-0102-4ba0-b796-a18ac952a150"
        ],
        "summary": "New summary",
        "offset": 0,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_forget_events_and_summary_together",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "cond-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "New summary",
        "source": "environment"
      },
      {
        "id": "73e2ef51-0ef4-49d7-b670-c3b858bb3916",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "ef9d4841-ae38-4c1a-9252-1608a6ca4a70",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
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
        "id": "8f388c73-d8c2-433b-a567-015d48a9b7f9",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "73e2ef51-0ef4-49d7-b670-c3b858bb3916",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Old summary",
        "offset": 1,
        "source": "environment"
      },
      {
        "id": "d54ef349-0102-4ba0-b796-a18ac952a150",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "ef9d4841-ae38-4c1a-9252-1608a6ca4a70",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "8f388c73-d8c2-433b-a567-015d48a9b7f9",
          "cond-1-summary",
          "d54ef349-0102-4ba0-b796-a18ac952a150"
        ],
        "summary": "New summary",
        "offset": 0,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_forget_events_and_summary_together",
    "op": "from_events",
    "input": [
      {
        "id": "8f388c73-d8c2-433b-a567-015d48a9b7f9",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "73e2ef51-0ef4-49d7-b670-c3b858bb3916",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Old summary",
        "offset": 1,
        "source": "environment"
      },
      {
        "id": "d54ef349-0102-4ba0-b796-a18ac952a150",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "ef9d4841-ae38-4c1a-9252-1608a6ca4a70",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "8f388c73-d8c2-433b-a567-015d48a9b7f9",
          "cond-1-summary",
          "d54ef349-0102-4ba0-b796-a18ac952a150"
        ],
        "summary": "New summary",
        "offset": 0,
        "source": "environment"
      }
    ],
    "expected": [
      {
        "id": "cond-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "New summary",
        "source": "environment"
      },
      {
        "id": "73e2ef51-0ef4-49d7-b670-c3b858bb3916",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "ef9d4841-ae38-4c1a-9252-1608a6ca4a70",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
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
    "name": "test_summary_offset_remains_valid_after_forgetting_events",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "56ea65bd-8947-4782-b1ef-a8771f97166d",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "47513e1e-18d2-4cea-b744-4f7c1eef7d42",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary after forgetting",
        "source": "environment"
      },
      {
        "id": "dc4d96ed-67b2-4a30-9b80-42f581cc3cd7",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 4"
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
        "id": "2bd167db-4900-4af8-93f5-1e4a4844001c",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "d908a729-44e1-415b-8bc8-e9d62c68f635",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "56ea65bd-8947-4782-b1ef-a8771f97166d",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "47513e1e-18d2-4cea-b744-4f7c1eef7d42",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "2bd167db-4900-4af8-93f5-1e4a4844001c",
          "d908a729-44e1-415b-8bc8-e9d62c68f635"
        ],
        "summary": "Summary after forgetting",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "dc4d96ed-67b2-4a30-9b80-42f581cc3cd7",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 4"
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
    "name": "test_summary_offset_remains_valid_after_forgetting_events",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "56ea65bd-8947-4782-b1ef-a8771f97166d",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "47513e1e-18d2-4cea-b744-4f7c1eef7d42",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary after forgetting",
        "source": "environment"
      },
      {
        "id": "dc4d96ed-67b2-4a30-9b80-42f581cc3cd7",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 4"
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
        "id": "2bd167db-4900-4af8-93f5-1e4a4844001c",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "d908a729-44e1-415b-8bc8-e9d62c68f635",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "56ea65bd-8947-4782-b1ef-a8771f97166d",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "47513e1e-18d2-4cea-b744-4f7c1eef7d42",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "2bd167db-4900-4af8-93f5-1e4a4844001c",
          "d908a729-44e1-415b-8bc8-e9d62c68f635"
        ],
        "summary": "Summary after forgetting",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "dc4d96ed-67b2-4a30-9b80-42f581cc3cd7",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 4"
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
    "name": "test_summary_offset_remains_valid_after_forgetting_events",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "56ea65bd-8947-4782-b1ef-a8771f97166d",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "47513e1e-18d2-4cea-b744-4f7c1eef7d42",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary after forgetting",
        "source": "environment"
      },
      {
        "id": "dc4d96ed-67b2-4a30-9b80-42f581cc3cd7",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 4"
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
        "id": "2bd167db-4900-4af8-93f5-1e4a4844001c",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "d908a729-44e1-415b-8bc8-e9d62c68f635",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "56ea65bd-8947-4782-b1ef-a8771f97166d",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "47513e1e-18d2-4cea-b744-4f7c1eef7d42",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "2bd167db-4900-4af8-93f5-1e4a4844001c",
          "d908a729-44e1-415b-8bc8-e9d62c68f635"
        ],
        "summary": "Summary after forgetting",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "dc4d96ed-67b2-4a30-9b80-42f581cc3cd7",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 4"
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
    "name": "test_summary_offset_remains_valid_after_forgetting_events",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "56ea65bd-8947-4782-b1ef-a8771f97166d",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "47513e1e-18d2-4cea-b744-4f7c1eef7d42",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary after forgetting",
        "source": "environment"
      },
      {
        "id": "dc4d96ed-67b2-4a30-9b80-42f581cc3cd7",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 4"
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
        "id": "2bd167db-4900-4af8-93f5-1e4a4844001c",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "d908a729-44e1-415b-8bc8-e9d62c68f635",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "56ea65bd-8947-4782-b1ef-a8771f97166d",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "47513e1e-18d2-4cea-b744-4f7c1eef7d42",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "2bd167db-4900-4af8-93f5-1e4a4844001c",
          "d908a729-44e1-415b-8bc8-e9d62c68f635"
        ],
        "summary": "Summary after forgetting",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "dc4d96ed-67b2-4a30-9b80-42f581cc3cd7",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 4"
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
    "name": "test_summary_offset_remains_valid_after_forgetting_events",
    "op": "from_events",
    "input": [
      {
        "id": "2bd167db-4900-4af8-93f5-1e4a4844001c",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "d908a729-44e1-415b-8bc8-e9d62c68f635",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "56ea65bd-8947-4782-b1ef-a8771f97166d",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "47513e1e-18d2-4cea-b744-4f7c1eef7d42",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "2bd167db-4900-4af8-93f5-1e4a4844001c",
          "d908a729-44e1-415b-8bc8-e9d62c68f635"
        ],
        "summary": "Summary after forgetting",
        "offset": 2,
        "source": "environment"
      },
      {
        "id": "dc4d96ed-67b2-4a30-9b80-42f581cc3cd7",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 4"
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
        "id": "56ea65bd-8947-4782-b1ef-a8771f97166d",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "47513e1e-18d2-4cea-b744-4f7c1eef7d42",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary after forgetting",
        "source": "environment"
      },
      {
        "id": "dc4d96ed-67b2-4a30-9b80-42f581cc3cd7",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 4"
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
    "name": "test_interleaved_events_and_summaries",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "386d801e-e71d-40a9-8590-661af36d464d",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary A",
        "source": "environment"
      },
      {
        "id": "2b428ba4-0c15-4745-b311-7e66ede7e371",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary B",
        "source": "environment"
      },
      {
        "id": "247d69a0-afc6-4ccd-abe0-8daec5b3ab96",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 4"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "f7d7a87a-5e48-4e2c-95f6-6cabb450c7df",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 5"
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
        "id": "386d801e-e71d-40a9-8590-661af36d464d",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "c4430ef0-cd12-4c2f-a354-988bd386fdfa",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "c4430ef0-cd12-4c2f-a354-988bd386fdfa"
        ],
        "summary": "Summary A",
        "offset": 1,
        "source": "environment"
      },
      {
        "id": "2b428ba4-0c15-4745-b311-7e66ede7e371",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "8a7c54f5-7029-4e75-a1bd-a4b4d01eed27",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "8a7c54f5-7029-4e75-a1bd-a4b4d01eed27"
        ],
        "summary": "Summary B",
        "offset": 3,
        "source": "environment"
      },
      {
        "id": "247d69a0-afc6-4ccd-abe0-8daec5b3ab96",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 4"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "f7d7a87a-5e48-4e2c-95f6-6cabb450c7df",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 5"
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
    "name": "test_interleaved_events_and_summaries",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "386d801e-e71d-40a9-8590-661af36d464d",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary A",
        "source": "environment"
      },
      {
        "id": "2b428ba4-0c15-4745-b311-7e66ede7e371",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary B",
        "source": "environment"
      },
      {
        "id": "247d69a0-afc6-4ccd-abe0-8daec5b3ab96",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 4"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "f7d7a87a-5e48-4e2c-95f6-6cabb450c7df",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 5"
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
        "id": "386d801e-e71d-40a9-8590-661af36d464d",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "c4430ef0-cd12-4c2f-a354-988bd386fdfa",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "c4430ef0-cd12-4c2f-a354-988bd386fdfa"
        ],
        "summary": "Summary A",
        "offset": 1,
        "source": "environment"
      },
      {
        "id": "2b428ba4-0c15-4745-b311-7e66ede7e371",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "8a7c54f5-7029-4e75-a1bd-a4b4d01eed27",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "8a7c54f5-7029-4e75-a1bd-a4b4d01eed27"
        ],
        "summary": "Summary B",
        "offset": 3,
        "source": "environment"
      },
      {
        "id": "247d69a0-afc6-4ccd-abe0-8daec5b3ab96",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 4"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "f7d7a87a-5e48-4e2c-95f6-6cabb450c7df",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 5"
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
    "name": "test_interleaved_events_and_summaries",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "386d801e-e71d-40a9-8590-661af36d464d",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary A",
        "source": "environment"
      },
      {
        "id": "2b428ba4-0c15-4745-b311-7e66ede7e371",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary B",
        "source": "environment"
      },
      {
        "id": "247d69a0-afc6-4ccd-abe0-8daec5b3ab96",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 4"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "f7d7a87a-5e48-4e2c-95f6-6cabb450c7df",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 5"
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
        "id": "386d801e-e71d-40a9-8590-661af36d464d",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "c4430ef0-cd12-4c2f-a354-988bd386fdfa",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "c4430ef0-cd12-4c2f-a354-988bd386fdfa"
        ],
        "summary": "Summary A",
        "offset": 1,
        "source": "environment"
      },
      {
        "id": "2b428ba4-0c15-4745-b311-7e66ede7e371",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "8a7c54f5-7029-4e75-a1bd-a4b4d01eed27",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "8a7c54f5-7029-4e75-a1bd-a4b4d01eed27"
        ],
        "summary": "Summary B",
        "offset": 3,
        "source": "environment"
      },
      {
        "id": "247d69a0-afc6-4ccd-abe0-8daec5b3ab96",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 4"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "f7d7a87a-5e48-4e2c-95f6-6cabb450c7df",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 5"
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
    "name": "test_interleaved_events_and_summaries",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "386d801e-e71d-40a9-8590-661af36d464d",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary A",
        "source": "environment"
      },
      {
        "id": "2b428ba4-0c15-4745-b311-7e66ede7e371",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary B",
        "source": "environment"
      },
      {
        "id": "247d69a0-afc6-4ccd-abe0-8daec5b3ab96",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 4"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "f7d7a87a-5e48-4e2c-95f6-6cabb450c7df",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 5"
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
        "id": "386d801e-e71d-40a9-8590-661af36d464d",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "c4430ef0-cd12-4c2f-a354-988bd386fdfa",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "c4430ef0-cd12-4c2f-a354-988bd386fdfa"
        ],
        "summary": "Summary A",
        "offset": 1,
        "source": "environment"
      },
      {
        "id": "2b428ba4-0c15-4745-b311-7e66ede7e371",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "8a7c54f5-7029-4e75-a1bd-a4b4d01eed27",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "8a7c54f5-7029-4e75-a1bd-a4b4d01eed27"
        ],
        "summary": "Summary B",
        "offset": 3,
        "source": "environment"
      },
      {
        "id": "247d69a0-afc6-4ccd-abe0-8daec5b3ab96",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 4"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "f7d7a87a-5e48-4e2c-95f6-6cabb450c7df",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 5"
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
    "name": "test_interleaved_events_and_summaries",
    "op": "from_events",
    "input": [
      {
        "id": "386d801e-e71d-40a9-8590-661af36d464d",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "c4430ef0-cd12-4c2f-a354-988bd386fdfa",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "c4430ef0-cd12-4c2f-a354-988bd386fdfa"
        ],
        "summary": "Summary A",
        "offset": 1,
        "source": "environment"
      },
      {
        "id": "2b428ba4-0c15-4745-b311-7e66ede7e371",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "8a7c54f5-7029-4e75-a1bd-a4b4d01eed27",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 3"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "8a7c54f5-7029-4e75-a1bd-a4b4d01eed27"
        ],
        "summary": "Summary B",
        "offset": 3,
        "source": "environment"
      },
      {
        "id": "247d69a0-afc6-4ccd-abe0-8daec5b3ab96",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 4"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "f7d7a87a-5e48-4e2c-95f6-6cabb450c7df",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 5"
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
        "id": "386d801e-e71d-40a9-8590-661af36d464d",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary A",
        "source": "environment"
      },
      {
        "id": "2b428ba4-0c15-4745-b311-7e66ede7e371",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Summary B",
        "source": "environment"
      },
      {
        "id": "247d69a0-afc6-4ccd-abe0-8daec5b3ab96",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 4"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "f7d7a87a-5e48-4e2c-95f6-6cabb450c7df",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 5"
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
    "name": "test_condensation_without_summary_no_summary_event_created",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "eded973c-375f-4830-8e79-d3df63dd0942",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "fc914a98-471c-4b09-b51a-337973b349d7",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
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
        "id": "eded973c-375f-4830-8e79-d3df63dd0942",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "62e942fb-fe79-4cc7-99b8-be8cc77d298f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "62e942fb-fe79-4cc7-99b8-be8cc77d298f"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      },
      {
        "id": "fc914a98-471c-4b09-b51a-337973b349d7",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
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
    "name": "test_condensation_without_summary_no_summary_event_created",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "eded973c-375f-4830-8e79-d3df63dd0942",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "fc914a98-471c-4b09-b51a-337973b349d7",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
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
        "id": "eded973c-375f-4830-8e79-d3df63dd0942",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "62e942fb-fe79-4cc7-99b8-be8cc77d298f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "62e942fb-fe79-4cc7-99b8-be8cc77d298f"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      },
      {
        "id": "fc914a98-471c-4b09-b51a-337973b349d7",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
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
    "name": "test_condensation_without_summary_no_summary_event_created",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "eded973c-375f-4830-8e79-d3df63dd0942",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "fc914a98-471c-4b09-b51a-337973b349d7",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
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
        "id": "eded973c-375f-4830-8e79-d3df63dd0942",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "62e942fb-fe79-4cc7-99b8-be8cc77d298f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "62e942fb-fe79-4cc7-99b8-be8cc77d298f"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      },
      {
        "id": "fc914a98-471c-4b09-b51a-337973b349d7",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
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
    "name": "test_condensation_without_summary_no_summary_event_created",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "eded973c-375f-4830-8e79-d3df63dd0942",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "fc914a98-471c-4b09-b51a-337973b349d7",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
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
        "id": "eded973c-375f-4830-8e79-d3df63dd0942",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "62e942fb-fe79-4cc7-99b8-be8cc77d298f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "62e942fb-fe79-4cc7-99b8-be8cc77d298f"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      },
      {
        "id": "fc914a98-471c-4b09-b51a-337973b349d7",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
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
    "name": "test_condensation_without_summary_no_summary_event_created",
    "op": "from_events",
    "input": [
      {
        "id": "eded973c-375f-4830-8e79-d3df63dd0942",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "62e942fb-fe79-4cc7-99b8-be8cc77d298f",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "62e942fb-fe79-4cc7-99b8-be8cc77d298f"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      },
      {
        "id": "fc914a98-471c-4b09-b51a-337973b349d7",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
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
        "id": "eded973c-375f-4830-8e79-d3df63dd0942",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "fc914a98-471c-4b09-b51a-337973b349d7",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
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
    "name": "test_empty_view_with_only_summaries",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Only summary remains",
        "source": "environment"
      }
    ],
    "all": [
      {
        "id": "b2e4c376-e37c-4f35-9128-fa32fe5d791b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "8a928c71-39de-49f3-a6e0-2a1143394c2d",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "feeb457f-2972-4e7e-b78c-e9e56a36a257",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "8a928c71-39de-49f3-a6e0-2a1143394c2d",
          "b2e4c376-e37c-4f35-9128-fa32fe5d791b",
          "feeb457f-2972-4e7e-b78c-e9e56a36a257"
        ],
        "summary": "Only summary remains",
        "offset": 0,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_empty_view_with_only_summaries",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Only summary remains",
        "source": "environment"
      }
    ],
    "all": [
      {
        "id": "b2e4c376-e37c-4f35-9128-fa32fe5d791b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "8a928c71-39de-49f3-a6e0-2a1143394c2d",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "feeb457f-2972-4e7e-b78c-e9e56a36a257",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "8a928c71-39de-49f3-a6e0-2a1143394c2d",
          "b2e4c376-e37c-4f35-9128-fa32fe5d791b",
          "feeb457f-2972-4e7e-b78c-e9e56a36a257"
        ],
        "summary": "Only summary remains",
        "offset": 0,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_empty_view_with_only_summaries",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Only summary remains",
        "source": "environment"
      }
    ],
    "all": [
      {
        "id": "b2e4c376-e37c-4f35-9128-fa32fe5d791b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "8a928c71-39de-49f3-a6e0-2a1143394c2d",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "feeb457f-2972-4e7e-b78c-e9e56a36a257",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "8a928c71-39de-49f3-a6e0-2a1143394c2d",
          "b2e4c376-e37c-4f35-9128-fa32fe5d791b",
          "feeb457f-2972-4e7e-b78c-e9e56a36a257"
        ],
        "summary": "Only summary remains",
        "offset": 0,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_empty_view_with_only_summaries",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Only summary remains",
        "source": "environment"
      }
    ],
    "all": [
      {
        "id": "b2e4c376-e37c-4f35-9128-fa32fe5d791b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "8a928c71-39de-49f3-a6e0-2a1143394c2d",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "feeb457f-2972-4e7e-b78c-e9e56a36a257",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "8a928c71-39de-49f3-a6e0-2a1143394c2d",
          "b2e4c376-e37c-4f35-9128-fa32fe5d791b",
          "feeb457f-2972-4e7e-b78c-e9e56a36a257"
        ],
        "summary": "Only summary remains",
        "offset": 0,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_empty_view_with_only_summaries",
    "op": "from_events",
    "input": [
      {
        "id": "b2e4c376-e37c-4f35-9128-fa32fe5d791b",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "8a928c71-39de-49f3-a6e0-2a1143394c2d",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "feeb457f-2972-4e7e-b78c-e9e56a36a257",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 2"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "8a928c71-39de-49f3-a6e0-2a1143394c2d",
          "b2e4c376-e37c-4f35-9128-fa32fe5d791b",
          "feeb457f-2972-4e7e-b78c-e9e56a36a257"
        ],
        "summary": "Only summary remains",
        "offset": 0,
        "source": "environment"
      }
    ],
    "expected": [
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Only summary remains",
        "source": "environment"
      }
    ],
    "unhandled": false
  },
  {
    "name": "test_forget_nonexistent_summary_is_noop",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Existing summary",
        "source": "environment"
      },
      {
        "id": "7111bf2b-901d-4cc2-9cd1-6d1d388f7930",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "d9e5a52c-50c6-4453-b8f7-8d6af571fcc7",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
        "id": "7111bf2b-901d-4cc2-9cd1-6d1d388f7930",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Existing summary",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "d9e5a52c-50c6-4453-b8f7-8d6af571fcc7",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "nonexistent_summary_id"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_forget_nonexistent_summary_is_noop",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Existing summary",
        "source": "environment"
      },
      {
        "id": "7111bf2b-901d-4cc2-9cd1-6d1d388f7930",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "d9e5a52c-50c6-4453-b8f7-8d6af571fcc7",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
        "id": "7111bf2b-901d-4cc2-9cd1-6d1d388f7930",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Existing summary",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "d9e5a52c-50c6-4453-b8f7-8d6af571fcc7",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "nonexistent_summary_id"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_forget_nonexistent_summary_is_noop",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Existing summary",
        "source": "environment"
      },
      {
        "id": "7111bf2b-901d-4cc2-9cd1-6d1d388f7930",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "d9e5a52c-50c6-4453-b8f7-8d6af571fcc7",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
        "id": "7111bf2b-901d-4cc2-9cd1-6d1d388f7930",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Existing summary",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "d9e5a52c-50c6-4453-b8f7-8d6af571fcc7",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "nonexistent_summary_id"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_forget_nonexistent_summary_is_noop",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Existing summary",
        "source": "environment"
      },
      {
        "id": "7111bf2b-901d-4cc2-9cd1-6d1d388f7930",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "d9e5a52c-50c6-4453-b8f7-8d6af571fcc7",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
        "id": "7111bf2b-901d-4cc2-9cd1-6d1d388f7930",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Existing summary",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "d9e5a52c-50c6-4453-b8f7-8d6af571fcc7",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "nonexistent_summary_id"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": []
  },
  {
    "name": "test_forget_nonexistent_summary_is_noop",
    "op": "from_events",
    "input": [
      {
        "id": "7111bf2b-901d-4cc2-9cd1-6d1d388f7930",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Existing summary",
        "offset": 0,
        "source": "environment"
      },
      {
        "id": "d9e5a52c-50c6-4453-b8f7-8d6af571fcc7",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [
          "nonexistent_summary_id"
        ],
        "summary": null,
        "offset": null,
        "source": "environment"
      }
    ],
    "expected": [
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Existing summary",
        "source": "environment"
      },
      {
        "id": "7111bf2b-901d-4cc2-9cd1-6d1d388f7930",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "d9e5a52c-50c6-4453-b8f7-8d6af571fcc7",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
    "name": "test_multiple_condensations_same_summary_offset",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "cfa0a5b3-b913-4e4b-bdb5-b0d3eabe8814",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-3-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Third at 1",
        "source": "environment"
      },
      {
        "id": "cond-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Second at 1",
        "source": "environment"
      },
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "First at 1",
        "source": "environment"
      },
      {
        "id": "6df1f76c-b4cb-43fc-97cd-0812ecf7b4a1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
        "id": "cfa0a5b3-b913-4e4b-bdb5-b0d3eabe8814",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "First at 1",
        "offset": 1,
        "source": "environment"
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Second at 1",
        "offset": 1,
        "source": "environment"
      },
      {
        "id": "cond-3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Third at 1",
        "offset": 1,
        "source": "environment"
      },
      {
        "id": "6df1f76c-b4cb-43fc-97cd-0812ecf7b4a1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
    "name": "test_multiple_condensations_same_summary_offset",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "cfa0a5b3-b913-4e4b-bdb5-b0d3eabe8814",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-3-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Third at 1",
        "source": "environment"
      },
      {
        "id": "cond-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Second at 1",
        "source": "environment"
      },
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "First at 1",
        "source": "environment"
      },
      {
        "id": "6df1f76c-b4cb-43fc-97cd-0812ecf7b4a1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
        "id": "cfa0a5b3-b913-4e4b-bdb5-b0d3eabe8814",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "First at 1",
        "offset": 1,
        "source": "environment"
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Second at 1",
        "offset": 1,
        "source": "environment"
      },
      {
        "id": "cond-3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Third at 1",
        "offset": 1,
        "source": "environment"
      },
      {
        "id": "6df1f76c-b4cb-43fc-97cd-0812ecf7b4a1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
    "name": "test_multiple_condensations_same_summary_offset",
    "op": "enforce",
    "property": "ToolCallMatchingProperty",
    "input": [
      {
        "id": "cfa0a5b3-b913-4e4b-bdb5-b0d3eabe8814",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-3-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Third at 1",
        "source": "environment"
      },
      {
        "id": "cond-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Second at 1",
        "source": "environment"
      },
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "First at 1",
        "source": "environment"
      },
      {
        "id": "6df1f76c-b4cb-43fc-97cd-0812ecf7b4a1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
        "id": "cfa0a5b3-b913-4e4b-bdb5-b0d3eabe8814",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "First at 1",
        "offset": 1,
        "source": "environment"
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Second at 1",
        "offset": 1,
        "source": "environment"
      },
      {
        "id": "cond-3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Third at 1",
        "offset": 1,
        "source": "environment"
      },
      {
        "id": "6df1f76c-b4cb-43fc-97cd-0812ecf7b4a1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
    "name": "test_multiple_condensations_same_summary_offset",
    "op": "enforce",
    "property": "ToolLoopAtomicityProperty",
    "input": [
      {
        "id": "cfa0a5b3-b913-4e4b-bdb5-b0d3eabe8814",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-3-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Third at 1",
        "source": "environment"
      },
      {
        "id": "cond-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Second at 1",
        "source": "environment"
      },
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "First at 1",
        "source": "environment"
      },
      {
        "id": "6df1f76c-b4cb-43fc-97cd-0812ecf7b4a1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
        "id": "cfa0a5b3-b913-4e4b-bdb5-b0d3eabe8814",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "First at 1",
        "offset": 1,
        "source": "environment"
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Second at 1",
        "offset": 1,
        "source": "environment"
      },
      {
        "id": "cond-3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Third at 1",
        "offset": 1,
        "source": "environment"
      },
      {
        "id": "6df1f76c-b4cb-43fc-97cd-0812ecf7b4a1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
    "name": "test_multiple_condensations_same_summary_offset",
    "op": "from_events",
    "input": [
      {
        "id": "cfa0a5b3-b913-4e4b-bdb5-b0d3eabe8814",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-1",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "First at 1",
        "offset": 1,
        "source": "environment"
      },
      {
        "id": "cond-2",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Second at 1",
        "offset": 1,
        "source": "environment"
      },
      {
        "id": "cond-3",
        "kind": "condensation",
        "convertible": false,
        "forgotten": [],
        "summary": "Third at 1",
        "offset": 1,
        "source": "environment"
      },
      {
        "id": "6df1f76c-b4cb-43fc-97cd-0812ecf7b4a1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
        "id": "cfa0a5b3-b913-4e4b-bdb5-b0d3eabe8814",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 0"
            }
          ],
          "tool_calls": null,
          "tool_call_id": null,
          "name": null,
          "reasoning_content": null,
          "thinking_blocks": [],
          "responses_reasoning_item": null
        }
      },
      {
        "id": "cond-3-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Third at 1",
        "source": "environment"
      },
      {
        "id": "cond-2-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "Second at 1",
        "source": "environment"
      },
      {
        "id": "cond-1-summary",
        "kind": "summary",
        "convertible": true,
        "summary": "First at 1",
        "source": "environment"
      },
      {
        "id": "6df1f76c-b4cb-43fc-97cd-0812ecf7b4a1",
        "kind": "message",
        "convertible": true,
        "source": "user",
        "message": {
          "role": "user",
          "content": [
            {
              "cache_prompt": false,
              "type": "text",
              "text": "Msg 1"
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
