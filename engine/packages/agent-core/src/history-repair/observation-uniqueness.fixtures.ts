// From OpenHands/software-agent-sdk@0a9abc87641ad7ffe02e2dadf5e2cb3976b35217:tests/sdk/context/view/properties/test_observation_uniqueness.py (atlas AGENT-LOOP-0093). Pinned inputs and complete invariant outputs from the passing upstream tests.
import type { Fixture } from "./view.test-support.js";
export const fixtures: Fixture[] = [
  {
    "name": "test_enforce_drops_late_observation_after_agent_error",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "action_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_1",
        "llmResponseId": "",
        "thinking": false
      },
      {
        "id": "133b3ffa-f4ac-4c7d-9208-ac1a7e981c25",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1",
        "source": "agent"
      },
      {
        "id": "obs_late",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1"
      }
    ],
    "all": [
      {
        "id": "action_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_1",
        "llmResponseId": "",
        "thinking": false
      },
      {
        "id": "133b3ffa-f4ac-4c7d-9208-ac1a7e981c25",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1",
        "source": "agent"
      },
      {
        "id": "obs_late",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1"
      }
    ],
    "expected": [
      "obs_late"
    ]
  },
  {
    "name": "test_enforce_no_duplicates_returns_empty",
    "op": "enforce",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "action_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_1",
        "llmResponseId": "",
        "thinking": false
      },
      {
        "id": "obs_1",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1"
      }
    ],
    "all": [
      {
        "id": "action_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_1",
        "llmResponseId": "",
        "thinking": false
      },
      {
        "id": "obs_1",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1"
      }
    ],
    "expected": []
  },
  {
    "name": "test_manipulation_indices_returns_complete_for_well_formed_view",
    "op": "manipulation_indices",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "action_1",
        "kind": "action",
        "convertible": true,
        "toolCallId": "call_1",
        "llmResponseId": "",
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
      1,
      2
    ]
  },
  {
    "name": "test_manipulation_indices_warns_but_does_not_crash_on_duplicates",
    "op": "manipulation_indices",
    "property": "ObservationUniquenessProperty",
    "input": [
      {
        "id": "obs_a",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1"
      },
      {
        "id": "obs_b",
        "kind": "observation",
        "convertible": true,
        "toolCallId": "call_1"
      }
    ],
    "all": null,
    "expected": [
      0,
      1,
      2
    ]
  }
];
