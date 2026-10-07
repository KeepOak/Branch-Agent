// From OpenHands/software-agent-sdk@0a9abc87641ad7ffe02e2dadf5e2cb3976b35217:tests/sdk/context/view/properties/test_batch_atomicity.py (atlas AGENT-LOOP-0093). Pinned inputs and complete invariant outputs from the passing upstream tests.
import type { Fixture } from "./view.test-support.js";
export const fixtures: Fixture[] = [
  {
    "name": "TestBatchAtomicityPropertyEnforcement::test_partial_batch_forgotten",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "action_4",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_4",
        "llmResponseId": "response_1",
        "thinking": false,
        "source": "agent"
      }
    ],
    "all": [
      {
        "id": "action_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_1",
        "llmResponseId": "response_1",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "action_2",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_2",
        "llmResponseId": "response_1",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "action_3",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_3",
        "llmResponseId": "response_1",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "action_4",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_4",
        "llmResponseId": "response_1",
        "thinking": false,
        "source": "agent"
      }
    ],
    "expected": [
      "action_4"
    ]
  },
  {
    "name": "TestBatchAtomicityPropertyEnforcement::test_complete_batch_forgotten",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [],
    "all": [
      {
        "id": "action_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_1",
        "llmResponseId": "response_1",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "action_2",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_2",
        "llmResponseId": "response_1",
        "thinking": false,
        "source": "agent"
      }
    ],
    "expected": []
  },
  {
    "name": "TestBatchAtomicityPropertyEnforcement::test_no_forgetting_preserves_batch",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "action_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_1",
        "llmResponseId": "response_1",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "action_2",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_2",
        "llmResponseId": "response_1",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "action_3",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_3",
        "llmResponseId": "response_1",
        "thinking": false,
        "source": "agent"
      }
    ],
    "all": [
      {
        "id": "action_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_1",
        "llmResponseId": "response_1",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "action_2",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_2",
        "llmResponseId": "response_1",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "action_3",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_3",
        "llmResponseId": "response_1",
        "thinking": false,
        "source": "agent"
      }
    ],
    "expected": []
  },
  {
    "name": "TestBatchAtomicityPropertyEnforcement::test_multiple_batches",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "action_1_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_1",
        "llmResponseId": "response_1",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "action_2_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_3",
        "llmResponseId": "response_2",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "action_2_2",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_4",
        "llmResponseId": "response_2",
        "thinking": false,
        "source": "agent"
      }
    ],
    "all": [
      {
        "id": "action_1_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_1",
        "llmResponseId": "response_1",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "action_1_2",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_2",
        "llmResponseId": "response_1",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "action_2_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_3",
        "llmResponseId": "response_2",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "action_2_2",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_4",
        "llmResponseId": "response_2",
        "thinking": false,
        "source": "agent"
      }
    ],
    "expected": [
      "action_1_1"
    ]
  },
  {
    "name": "TestBatchAtomicityPropertyEnforcement::test_first_action_of_batch_forgotten",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "action_2",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_2",
        "llmResponseId": "response_1",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "action_3",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_3",
        "llmResponseId": "response_1",
        "thinking": false,
        "source": "agent"
      }
    ],
    "all": [
      {
        "id": "action_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_1",
        "llmResponseId": "response_1",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "action_2",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_2",
        "llmResponseId": "response_1",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "action_3",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_3",
        "llmResponseId": "response_1",
        "thinking": false,
        "source": "agent"
      }
    ],
    "expected": [
      "action_2",
      "action_3"
    ]
  },
  {
    "name": "TestBatchAtomicityPropertyEnforcement::test_middle_action_of_batch_forgotten",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "action_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_1",
        "llmResponseId": "response_1",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "action_3",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_3",
        "llmResponseId": "response_1",
        "thinking": false,
        "source": "agent"
      }
    ],
    "all": [
      {
        "id": "action_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_1",
        "llmResponseId": "response_1",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "action_2",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_2",
        "llmResponseId": "response_1",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "action_3",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_3",
        "llmResponseId": "response_1",
        "thinking": false,
        "source": "agent"
      }
    ],
    "expected": [
      "action_1",
      "action_3"
    ]
  },
  {
    "name": "TestBatchAtomicityPropertyEnforcement::test_different_batches_independent",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "action_1_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_1",
        "llmResponseId": "response_1",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "action_1_2",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_2",
        "llmResponseId": "response_1",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "action_2_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_3",
        "llmResponseId": "response_2",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "action_2_2",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_4",
        "llmResponseId": "response_2",
        "thinking": false,
        "source": "agent"
      }
    ],
    "all": [
      {
        "id": "action_1_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_1",
        "llmResponseId": "response_1",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "action_1_2",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_2",
        "llmResponseId": "response_1",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "action_2_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_3",
        "llmResponseId": "response_2",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "action_2_2",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_4",
        "llmResponseId": "response_2",
        "thinking": false,
        "source": "agent"
      }
    ],
    "expected": []
  },
  {
    "name": "TestBatchAtomicityPropertyEnforcement::test_single_action_batch",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "action_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_1",
        "llmResponseId": "response_1",
        "thinking": false,
        "source": "agent"
      }
    ],
    "all": [
      {
        "id": "action_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_1",
        "llmResponseId": "response_1",
        "thinking": false,
        "source": "agent"
      }
    ],
    "expected": []
  },
  {
    "name": "TestBatchAtomicityPropertyEnforcement::test_single_action_forgotten",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [],
    "all": [
      {
        "id": "action_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_1",
        "llmResponseId": "response_1",
        "thinking": false,
        "source": "agent"
      }
    ],
    "expected": []
  },
  {
    "name": "TestBatchAtomicityPropertyEnforcement::test_partial_batch_across_batches",
    "op": "enforce",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "action_1_2",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_2",
        "llmResponseId": "response_1",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "action_2_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_3",
        "llmResponseId": "response_2",
        "thinking": false,
        "source": "agent"
      }
    ],
    "all": [
      {
        "id": "action_1_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_1",
        "llmResponseId": "response_1",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "action_1_2",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_2",
        "llmResponseId": "response_1",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "action_2_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_3",
        "llmResponseId": "response_2",
        "thinking": false,
        "source": "agent"
      }
    ],
    "expected": [
      "action_1_2"
    ]
  },
  {
    "name": "TestBatchAtomicityPropertyManipulationIndices::test_same_batch_no_manipulation_index",
    "op": "manipulation_indices",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "action_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_1",
        "llmResponseId": "response_1",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "action_2",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_2",
        "llmResponseId": "response_1",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "action_3",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_3",
        "llmResponseId": "response_1",
        "thinking": false,
        "source": "agent"
      }
    ],
    "all": null,
    "expected": [
      0,
      3
    ]
  },
  {
    "name": "TestBatchAtomicityPropertyManipulationIndices::test_different_batches_allow_manipulation",
    "op": "manipulation_indices",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "action_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_1",
        "llmResponseId": "response_1",
        "thinking": false,
        "source": "agent"
      },
      {
        "id": "action_2",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_2",
        "llmResponseId": "response_2",
        "thinking": false,
        "source": "agent"
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
    "name": "TestBatchAtomicityPropertyManipulationIndices::test_single_event_complete_indices",
    "op": "manipulation_indices",
    "property": "BatchAtomicityProperty",
    "input": [
      {
        "id": "action_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "tool_call_1",
        "llmResponseId": "response_1",
        "thinking": false,
        "source": "agent"
      }
    ],
    "all": null,
    "expected": [
      0,
      1
    ]
  },
  {
    "name": "TestBatchAtomicityPropertyManipulationIndices::test_empty_events_complete_indices",
    "op": "manipulation_indices",
    "property": "BatchAtomicityProperty",
    "input": [],
    "all": null,
    "expected": [
      0
    ]
  }
];
