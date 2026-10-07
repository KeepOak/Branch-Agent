// From bytedance/deer-flow@f840e843d3e2db1485cb65ceae73a5525aa80193:backend/tests/test_tool_call_metadata.py (atlas AGENT-LOOP-0092). Complete clone outputs from all 16 passing pinned upstream scenarios.
import type { ReplayMessage, Call } from "./dangling-tool-call.js";
export const fixtures: { name: string; input: ReplayMessage; calls: Call[]; content: unknown; expected: ReplayMessage; sameContent: boolean }[] = [
  {
    "name": "test_drops_anthropic_tool_use_blocks_for_removed_calls",
    "input": {
      "type": "ai",
      "content": [
        {
          "type": "text",
          "text": "running"
        },
        {
          "type": "tool_use",
          "id": "a",
          "name": "bash",
          "input": {}
        },
        {
          "type": "tool_use",
          "id": "b",
          "name": "bash",
          "input": {}
        }
      ],
      "tool_calls": [
        {
          "name": "bash",
          "args": {},
          "id": "a",
          "type": "tool_call"
        },
        {
          "name": "bash",
          "args": {},
          "id": "b",
          "type": "tool_call"
        }
      ],
      "invalid_tool_calls": [],
      "additional_kwargs": {},
      "response_metadata": {},
      "name": null
    },
    "calls": [
      {
        "id": "a",
        "name": "bash",
        "args": {}
      }
    ],
    "content": null,
    "expected": {
      "type": "ai",
      "content": [
        {
          "type": "text",
          "text": "running"
        },
        {
          "type": "tool_use",
          "id": "a",
          "name": "bash",
          "input": {}
        }
      ],
      "tool_calls": [
        {
          "id": "a",
          "name": "bash",
          "args": {}
        }
      ],
      "invalid_tool_calls": [],
      "additional_kwargs": {},
      "response_metadata": {},
      "name": null
    },
    "sameContent": false
  },
  {
    "name": "test_clearing_every_call_keeps_non_tool_call_blocks",
    "input": {
      "type": "ai",
      "content": [
        {
          "type": "thinking",
          "thinking": "hmm",
          "signature": "sig"
        },
        {
          "type": "server_tool_use",
          "id": "srvtoolu_1",
          "name": "web_search",
          "input": {}
        },
        {
          "type": "tool_use",
          "id": "a",
          "name": "bash",
          "input": {}
        }
      ],
      "tool_calls": [
        {
          "name": "bash",
          "args": {},
          "id": "a",
          "type": "tool_call"
        }
      ],
      "invalid_tool_calls": [],
      "additional_kwargs": {},
      "response_metadata": {},
      "name": null
    },
    "calls": [],
    "content": null,
    "expected": {
      "type": "ai",
      "content": [
        {
          "type": "thinking",
          "thinking": "hmm",
          "signature": "sig"
        },
        {
          "type": "server_tool_use",
          "id": "srvtoolu_1",
          "name": "web_search",
          "input": {}
        }
      ],
      "tool_calls": [],
      "invalid_tool_calls": [],
      "additional_kwargs": {},
      "response_metadata": {},
      "name": null
    },
    "sameContent": false
  },
  {
    "name": "test_filters_caller_supplied_content",
    "input": {
      "type": "ai",
      "content": [
        {
          "type": "tool_use",
          "id": "a",
          "name": "bash",
          "input": {}
        }
      ],
      "tool_calls": [
        {
          "name": "bash",
          "args": {},
          "id": "a",
          "type": "tool_call"
        }
      ],
      "invalid_tool_calls": [],
      "additional_kwargs": {},
      "response_metadata": {},
      "name": null
    },
    "calls": [],
    "content": [
      {
        "type": "tool_use",
        "id": "a",
        "name": "bash",
        "input": {}
      },
      {
        "type": "text",
        "text": "stopped"
      }
    ],
    "expected": {
      "type": "ai",
      "content": [
        {
          "type": "text",
          "text": "stopped"
        }
      ],
      "tool_calls": [],
      "invalid_tool_calls": [],
      "additional_kwargs": {},
      "response_metadata": {},
      "name": null
    },
    "sameContent": false
  },
  {
    "name": "test_openai_responses_blocks_match_by_call_id_not_item_id",
    "input": {
      "type": "ai",
      "content": [
        {
          "type": "function_call",
          "id": "fc_1",
          "call_id": "a",
          "name": "bash",
          "arguments": "{}"
        },
        {
          "type": "function_call",
          "id": "fc_2",
          "call_id": "b",
          "name": "bash",
          "arguments": "{}"
        },
        {
          "type": "custom_tool_call",
          "id": "ctc_3",
          "call_id": "c",
          "name": "patch",
          "input": "x"
        }
      ],
      "tool_calls": [
        {
          "name": "bash",
          "args": {},
          "id": "a",
          "type": "tool_call"
        },
        {
          "name": "bash",
          "args": {},
          "id": "b",
          "type": "tool_call"
        },
        {
          "name": "patch",
          "args": {},
          "id": "c",
          "type": "tool_call"
        }
      ],
      "invalid_tool_calls": [],
      "additional_kwargs": {},
      "response_metadata": {},
      "name": null
    },
    "calls": [
      {
        "id": "a",
        "name": "bash",
        "args": {}
      }
    ],
    "content": null,
    "expected": {
      "type": "ai",
      "content": [
        {
          "type": "function_call",
          "id": "fc_1",
          "call_id": "a",
          "name": "bash",
          "arguments": "{}"
        }
      ],
      "tool_calls": [
        {
          "id": "a",
          "name": "bash",
          "args": {}
        }
      ],
      "invalid_tool_calls": [],
      "additional_kwargs": {},
      "response_metadata": {},
      "name": null
    },
    "sameContent": false
  },
  {
    "name": "test_langchain_standard_tool_call_blocks_match_by_id",
    "input": {
      "type": "ai",
      "content": [
        {
          "type": "tool_call",
          "id": "a",
          "name": "bash",
          "args": {}
        },
        {
          "type": "tool_call",
          "id": "b",
          "name": "bash",
          "args": {}
        },
        {
          "type": "tool_call_chunk",
          "id": "c",
          "name": "bash",
          "args": "{}",
          "index": 2
        }
      ],
      "tool_calls": [
        {
          "name": "bash",
          "args": {},
          "id": "a",
          "type": "tool_call"
        },
        {
          "name": "bash",
          "args": {},
          "id": "b",
          "type": "tool_call"
        },
        {
          "name": "bash",
          "args": {},
          "id": "c",
          "type": "tool_call"
        }
      ],
      "invalid_tool_calls": [],
      "additional_kwargs": {},
      "response_metadata": {},
      "name": null
    },
    "calls": [
      {
        "id": "a",
        "name": "bash",
        "args": {}
      }
    ],
    "content": null,
    "expected": {
      "type": "ai",
      "content": [
        {
          "type": "tool_call",
          "id": "a",
          "name": "bash",
          "args": {}
        }
      ],
      "tool_calls": [
        {
          "id": "a",
          "name": "bash",
          "args": {}
        }
      ],
      "invalid_tool_calls": [],
      "additional_kwargs": {},
      "response_metadata": {},
      "name": null
    },
    "sameContent": false
  },
  {
    "name": "test_google_genai_function_call_blocks_match_by_id",
    "input": {
      "type": "ai",
      "content": [
        {
          "type": "function_call",
          "id": "a",
          "name": "bash",
          "args": {}
        },
        {
          "type": "function_call",
          "id": "b",
          "name": "bash",
          "args": {}
        }
      ],
      "tool_calls": [
        {
          "name": "bash",
          "args": {},
          "id": "a",
          "type": "tool_call"
        },
        {
          "name": "bash",
          "args": {},
          "id": "b",
          "type": "tool_call"
        }
      ],
      "invalid_tool_calls": [],
      "additional_kwargs": {},
      "response_metadata": {},
      "name": null
    },
    "calls": [
      {
        "id": "b",
        "name": "bash",
        "args": {}
      }
    ],
    "content": null,
    "expected": {
      "type": "ai",
      "content": [
        {
          "type": "function_call",
          "id": "b",
          "name": "bash",
          "args": {}
        }
      ],
      "tool_calls": [
        {
          "id": "b",
          "name": "bash",
          "args": {}
        }
      ],
      "invalid_tool_calls": [],
      "additional_kwargs": {},
      "response_metadata": {},
      "name": null
    },
    "sameContent": false
  },
  {
    "name": "test_idless_blocks_keep_only_as_many_per_name_as_retained_calls",
    "input": {
      "type": "ai",
      "content": [
        {
          "type": "function_call",
          "name": "task",
          "args": {
            "n": 0
          }
        },
        {
          "type": "function_call",
          "name": "task",
          "args": {
            "n": 1
          }
        },
        {
          "type": "function_call",
          "name": "task",
          "args": {
            "n": 2
          }
        },
        {
          "type": "function_call",
          "name": "task",
          "args": {
            "n": 3
          }
        }
      ],
      "tool_calls": [
        {
          "name": "task",
          "args": {},
          "id": "t0",
          "type": "tool_call"
        },
        {
          "name": "task",
          "args": {},
          "id": "t1",
          "type": "tool_call"
        },
        {
          "name": "task",
          "args": {},
          "id": "t2",
          "type": "tool_call"
        },
        {
          "name": "task",
          "args": {},
          "id": "t3",
          "type": "tool_call"
        }
      ],
      "invalid_tool_calls": [],
      "additional_kwargs": {},
      "response_metadata": {},
      "name": null
    },
    "calls": [
      {
        "id": "t0",
        "name": "task",
        "args": {}
      },
      {
        "id": "t1",
        "name": "task",
        "args": {}
      },
      {
        "id": "t2",
        "name": "task",
        "args": {}
      }
    ],
    "content": null,
    "expected": {
      "type": "ai",
      "content": [
        {
          "type": "function_call",
          "name": "task",
          "args": {
            "n": 0
          }
        },
        {
          "type": "function_call",
          "name": "task",
          "args": {
            "n": 1
          }
        },
        {
          "type": "function_call",
          "name": "task",
          "args": {
            "n": 2
          }
        }
      ],
      "tool_calls": [
        {
          "id": "t0",
          "name": "task",
          "args": {}
        },
        {
          "id": "t1",
          "name": "task",
          "args": {}
        },
        {
          "id": "t2",
          "name": "task",
          "args": {}
        }
      ],
      "invalid_tool_calls": [],
      "additional_kwargs": {},
      "response_metadata": {},
      "name": null
    },
    "sameContent": false
  },
  {
    "name": "test_idless_budget_skips_calls_already_paired_by_id",
    "input": {
      "type": "ai",
      "content": [
        {
          "type": "function_call",
          "id": "a",
          "name": "bash",
          "args": {}
        },
        {
          "type": "function_call",
          "name": "bash",
          "args": {}
        }
      ],
      "tool_calls": [
        {
          "name": "bash",
          "args": {},
          "id": "a",
          "type": "tool_call"
        },
        {
          "name": "bash",
          "args": {},
          "id": "b",
          "type": "tool_call"
        }
      ],
      "invalid_tool_calls": [],
      "additional_kwargs": {},
      "response_metadata": {},
      "name": null
    },
    "calls": [
      {
        "id": "a",
        "name": "bash",
        "args": {}
      }
    ],
    "content": null,
    "expected": {
      "type": "ai",
      "content": [
        {
          "type": "function_call",
          "id": "a",
          "name": "bash",
          "args": {}
        }
      ],
      "tool_calls": [
        {
          "id": "a",
          "name": "bash",
          "args": {}
        }
      ],
      "invalid_tool_calls": [],
      "additional_kwargs": {},
      "response_metadata": {},
      "name": null
    },
    "sameContent": false
  },
  {
    "name": "test_idless_budget_skips_calls_already_paired_by_id",
    "input": {
      "type": "ai",
      "content": [
        {
          "type": "function_call",
          "id": "a",
          "name": "bash",
          "args": {}
        },
        {
          "type": "function_call",
          "name": "bash",
          "args": {}
        }
      ],
      "tool_calls": [
        {
          "name": "bash",
          "args": {},
          "id": "a",
          "type": "tool_call"
        },
        {
          "name": "bash",
          "args": {},
          "id": "b",
          "type": "tool_call"
        }
      ],
      "invalid_tool_calls": [],
      "additional_kwargs": {},
      "response_metadata": {},
      "name": null
    },
    "calls": [
      {
        "id": "a",
        "name": "bash",
        "args": {}
      },
      {
        "id": "b",
        "name": "bash",
        "args": {}
      }
    ],
    "content": null,
    "expected": {
      "type": "ai",
      "content": [
        {
          "type": "function_call",
          "id": "a",
          "name": "bash",
          "args": {}
        },
        {
          "type": "function_call",
          "name": "bash",
          "args": {}
        }
      ],
      "tool_calls": [
        {
          "id": "a",
          "name": "bash",
          "args": {}
        },
        {
          "id": "b",
          "name": "bash",
          "args": {}
        }
      ],
      "invalid_tool_calls": [],
      "additional_kwargs": {},
      "response_metadata": {},
      "name": null
    },
    "sameContent": true
  },
  {
    "name": "test_keeps_blocks_for_calls_that_remain_invalid_tool_calls",
    "input": {
      "type": "ai",
      "content": [
        {
          "type": "tool_use",
          "id": "bad",
          "name": "bash",
          "input": {}
        },
        {
          "type": "tool_use",
          "id": "a",
          "name": "bash",
          "input": {}
        }
      ],
      "tool_calls": [
        {
          "name": "bash",
          "args": {},
          "id": "a",
          "type": "tool_call"
        }
      ],
      "invalid_tool_calls": [
        {
          "type": "invalid_tool_call",
          "id": "bad",
          "name": "bash",
          "args": "{",
          "error": "parse"
        }
      ],
      "additional_kwargs": {},
      "response_metadata": {},
      "name": null
    },
    "calls": [],
    "content": null,
    "expected": {
      "type": "ai",
      "content": [
        {
          "type": "tool_use",
          "id": "bad",
          "name": "bash",
          "input": {}
        }
      ],
      "tool_calls": [],
      "invalid_tool_calls": [
        {
          "type": "invalid_tool_call",
          "id": "bad",
          "name": "bash",
          "args": "{",
          "error": "parse"
        }
      ],
      "additional_kwargs": {},
      "response_metadata": {},
      "name": null
    },
    "sameContent": false
  },
  {
    "name": "test_leaves_content_untouched_when_every_block_is_still_paired",
    "input": {
      "type": "ai",
      "content": [
        {
          "type": "text",
          "text": "hi"
        },
        {
          "type": "tool_use",
          "id": "a",
          "name": "bash",
          "input": {}
        }
      ],
      "tool_calls": [
        {
          "name": "bash",
          "args": {},
          "id": "a",
          "type": "tool_call"
        }
      ],
      "invalid_tool_calls": [],
      "additional_kwargs": {},
      "response_metadata": {},
      "name": null
    },
    "calls": [
      {
        "id": "a",
        "name": "bash",
        "args": {}
      }
    ],
    "content": null,
    "expected": {
      "type": "ai",
      "content": [
        {
          "type": "text",
          "text": "hi"
        },
        {
          "type": "tool_use",
          "id": "a",
          "name": "bash",
          "input": {}
        }
      ],
      "tool_calls": [
        {
          "id": "a",
          "name": "bash",
          "args": {}
        }
      ],
      "invalid_tool_calls": [],
      "additional_kwargs": {},
      "response_metadata": {},
      "name": null
    },
    "sameContent": true
  },
  {
    "name": "test_string_content_is_unchanged",
    "input": {
      "type": "ai",
      "content": "plain",
      "tool_calls": [
        {
          "name": "bash",
          "args": {},
          "id": "a",
          "type": "tool_call"
        }
      ],
      "invalid_tool_calls": [],
      "additional_kwargs": {},
      "response_metadata": {},
      "name": null
    },
    "calls": [],
    "content": null,
    "expected": {
      "type": "ai",
      "content": "plain",
      "tool_calls": [],
      "invalid_tool_calls": [],
      "additional_kwargs": {},
      "response_metadata": {},
      "name": null
    },
    "sameContent": true
  },
  {
    "name": "test_anthropic_request_pairs_every_tool_use_after_calls_are_cleared[ChatAnthropic]",
    "input": {
      "type": "ai",
      "content": [
        {
          "type": "text",
          "text": "reading"
        },
        {
          "type": "tool_use",
          "id": "toolu_a",
          "name": "bash",
          "input": {}
        }
      ],
      "tool_calls": [
        {
          "name": "bash",
          "args": {},
          "id": "toolu_a",
          "type": "tool_call"
        }
      ],
      "invalid_tool_calls": [],
      "additional_kwargs": {},
      "response_metadata": {
        "model_provider": "anthropic"
      },
      "name": null
    },
    "calls": [],
    "content": [
      {
        "type": "text",
        "text": "reading"
      },
      {
        "type": "tool_use",
        "id": "toolu_a",
        "name": "bash",
        "input": {}
      },
      {
        "type": "text",
        "text": "stopped"
      }
    ],
    "expected": {
      "type": "ai",
      "content": [
        {
          "type": "text",
          "text": "reading"
        },
        {
          "type": "text",
          "text": "stopped"
        }
      ],
      "tool_calls": [],
      "invalid_tool_calls": [],
      "additional_kwargs": {},
      "response_metadata": {
        "model_provider": "anthropic"
      },
      "name": null
    },
    "sameContent": false
  },
  {
    "name": "test_anthropic_request_pairs_every_tool_use_after_calls_are_cleared[ClaudeChatModel]",
    "input": {
      "type": "ai",
      "content": [
        {
          "type": "text",
          "text": "reading"
        },
        {
          "type": "tool_use",
          "id": "toolu_a",
          "name": "bash",
          "input": {}
        }
      ],
      "tool_calls": [
        {
          "name": "bash",
          "args": {},
          "id": "toolu_a",
          "type": "tool_call"
        }
      ],
      "invalid_tool_calls": [],
      "additional_kwargs": {},
      "response_metadata": {
        "model_provider": "anthropic"
      },
      "name": null
    },
    "calls": [],
    "content": [
      {
        "type": "text",
        "text": "reading"
      },
      {
        "type": "tool_use",
        "id": "toolu_a",
        "name": "bash",
        "input": {}
      },
      {
        "type": "text",
        "text": "stopped"
      }
    ],
    "expected": {
      "type": "ai",
      "content": [
        {
          "type": "text",
          "text": "reading"
        },
        {
          "type": "text",
          "text": "stopped"
        }
      ],
      "tool_calls": [],
      "invalid_tool_calls": [],
      "additional_kwargs": {},
      "response_metadata": {
        "model_provider": "anthropic"
      },
      "name": null
    },
    "sameContent": false
  },
  {
    "name": "test_anthropic_request_pairs_every_tool_use_after_calls_are_truncated[ChatAnthropic]",
    "input": {
      "type": "ai",
      "content": [
        {
          "type": "tool_use",
          "id": "toolu_0",
          "name": "task",
          "input": {}
        },
        {
          "type": "tool_use",
          "id": "toolu_1",
          "name": "task",
          "input": {}
        },
        {
          "type": "tool_use",
          "id": "toolu_2",
          "name": "task",
          "input": {}
        }
      ],
      "tool_calls": [
        {
          "name": "task",
          "args": {},
          "id": "toolu_0",
          "type": "tool_call"
        },
        {
          "name": "task",
          "args": {},
          "id": "toolu_1",
          "type": "tool_call"
        },
        {
          "name": "task",
          "args": {},
          "id": "toolu_2",
          "type": "tool_call"
        }
      ],
      "invalid_tool_calls": [],
      "additional_kwargs": {},
      "response_metadata": {
        "model_provider": "anthropic"
      },
      "name": null
    },
    "calls": [
      {
        "id": "toolu_0",
        "name": "task",
        "args": {}
      },
      {
        "id": "toolu_1",
        "name": "task",
        "args": {}
      }
    ],
    "content": null,
    "expected": {
      "type": "ai",
      "content": [
        {
          "type": "tool_use",
          "id": "toolu_0",
          "name": "task",
          "input": {}
        },
        {
          "type": "tool_use",
          "id": "toolu_1",
          "name": "task",
          "input": {}
        }
      ],
      "tool_calls": [
        {
          "id": "toolu_0",
          "name": "task",
          "args": {}
        },
        {
          "id": "toolu_1",
          "name": "task",
          "args": {}
        }
      ],
      "invalid_tool_calls": [],
      "additional_kwargs": {},
      "response_metadata": {
        "model_provider": "anthropic"
      },
      "name": null
    },
    "sameContent": false
  },
  {
    "name": "test_anthropic_request_pairs_every_tool_use_after_calls_are_truncated[ClaudeChatModel]",
    "input": {
      "type": "ai",
      "content": [
        {
          "type": "tool_use",
          "id": "toolu_0",
          "name": "task",
          "input": {}
        },
        {
          "type": "tool_use",
          "id": "toolu_1",
          "name": "task",
          "input": {}
        },
        {
          "type": "tool_use",
          "id": "toolu_2",
          "name": "task",
          "input": {}
        }
      ],
      "tool_calls": [
        {
          "name": "task",
          "args": {},
          "id": "toolu_0",
          "type": "tool_call"
        },
        {
          "name": "task",
          "args": {},
          "id": "toolu_1",
          "type": "tool_call"
        },
        {
          "name": "task",
          "args": {},
          "id": "toolu_2",
          "type": "tool_call"
        }
      ],
      "invalid_tool_calls": [],
      "additional_kwargs": {},
      "response_metadata": {
        "model_provider": "anthropic"
      },
      "name": null
    },
    "calls": [
      {
        "id": "toolu_0",
        "name": "task",
        "args": {}
      },
      {
        "id": "toolu_1",
        "name": "task",
        "args": {}
      }
    ],
    "content": null,
    "expected": {
      "type": "ai",
      "content": [
        {
          "type": "tool_use",
          "id": "toolu_0",
          "name": "task",
          "input": {}
        },
        {
          "type": "tool_use",
          "id": "toolu_1",
          "name": "task",
          "input": {}
        }
      ],
      "tool_calls": [
        {
          "id": "toolu_0",
          "name": "task",
          "args": {}
        },
        {
          "id": "toolu_1",
          "name": "task",
          "args": {}
        }
      ],
      "invalid_tool_calls": [],
      "additional_kwargs": {},
      "response_metadata": {
        "model_provider": "anthropic"
      },
      "name": null
    },
    "sameContent": false
  },
  {
    "name": "test_openai_responses_request_drops_function_call_after_calls_are_cleared",
    "input": {
      "type": "ai",
      "content": [
        {
          "type": "function_call",
          "id": "fc_1",
          "call_id": "call_a",
          "name": "bash",
          "arguments": "{}"
        }
      ],
      "tool_calls": [
        {
          "name": "bash",
          "args": {},
          "id": "call_a",
          "type": "tool_call"
        }
      ],
      "invalid_tool_calls": [],
      "additional_kwargs": {},
      "response_metadata": {
        "model_provider": "openai"
      },
      "name": null
    },
    "calls": [],
    "content": [
      {
        "type": "function_call",
        "id": "fc_1",
        "call_id": "call_a",
        "name": "bash",
        "arguments": "{}"
      },
      {
        "type": "text",
        "text": "stopped"
      }
    ],
    "expected": {
      "type": "ai",
      "content": [
        {
          "type": "text",
          "text": "stopped"
        }
      ],
      "tool_calls": [],
      "invalid_tool_calls": [],
      "additional_kwargs": {},
      "response_metadata": {
        "model_provider": "openai"
      },
      "name": null
    },
    "sameContent": false
  }
];
