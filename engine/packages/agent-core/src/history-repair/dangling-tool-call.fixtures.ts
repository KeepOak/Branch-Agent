// From bytedance/deer-flow@f840e843d3e2db1485cb65ceae73a5525aa80193:backend/tests/test_dangling_tool_call_middleware.py (atlas AGENT-LOOP-0092). Complete input/output fixtures captured from all 66 passing pinned upstream cases.
import type { ReplayMessage } from "./dangling-tool-call.js";
export const fixtures: { name: string; input: ReplayMessage[]; expected: ReplayMessage[] | null }[] = [
  {
    "name": "test_empty_messages",
    "input": [],
    "expected": null
  },
  {
    "name": "test_no_ai_messages",
    "input": [
      {
        "type": "human",
        "content": "hello",
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      }
    ],
    "expected": null
  },
  {
    "name": "test_ai_without_tool_calls",
    "input": [
      {
        "type": "ai",
        "content": "hello",
        "tool_calls": [],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      }
    ],
    "expected": null
  },
  {
    "name": "test_all_tool_calls_responded",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "call_1",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "call_1",
        "name": "bash",
        "status": "success"
      }
    ],
    "expected": null
  },
  {
    "name": "test_valid_tool_call_names_are_sanitization_noop",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "call_1",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {
          "tool_calls": [
            {
              "id": "call_1",
              "type": "function",
              "function": {
                "name": "bash",
                "arguments": "{}"
              }
            }
          ]
        },
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "call_1",
        "name": "bash",
        "status": "success"
      }
    ],
    "expected": null
  },
  {
    "name": "test_single_dangling_call",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "call_1",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "call_1",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "[Tool call was interrupted and did not return a result.]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "call_1",
        "name": "bash",
        "status": "error"
      }
    ]
  },
  {
    "name": "test_multiple_dangling_calls_same_message",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "call_1",
            "type": "tool_call"
          },
          {
            "name": "read",
            "args": {},
            "id": "call_2",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "call_1",
            "type": "tool_call"
          },
          {
            "name": "read",
            "args": {},
            "id": "call_2",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "[Tool call was interrupted and did not return a result.]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "call_1",
        "name": "bash",
        "status": "error"
      },
      {
        "type": "tool",
        "content": "[Tool call was interrupted and did not return a result.]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "call_2",
        "name": "read",
        "status": "error"
      }
    ]
  },
  {
    "name": "test_patch_inserted_after_offending_ai_message",
    "input": [
      {
        "type": "human",
        "content": "hi",
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "call_1",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "human",
        "content": "still here",
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      }
    ],
    "expected": [
      {
        "type": "human",
        "content": "hi",
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "call_1",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "[Tool call was interrupted and did not return a result.]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "call_1",
        "name": "bash",
        "status": "error"
      },
      {
        "type": "human",
        "content": "still here",
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      }
    ]
  },
  {
    "name": "test_mixed_responded_and_dangling",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "call_1",
            "type": "tool_call"
          },
          {
            "name": "read",
            "args": {},
            "id": "call_2",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "call_1",
        "name": "bash",
        "status": "success"
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "call_1",
            "type": "tool_call"
          },
          {
            "name": "read",
            "args": {},
            "id": "call_2",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "call_1",
        "name": "bash",
        "status": "success"
      },
      {
        "type": "tool",
        "content": "[Tool call was interrupted and did not return a result.]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "call_2",
        "name": "read",
        "status": "error"
      }
    ]
  },
  {
    "name": "test_multiple_ai_messages_each_patched",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "call_1",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "human",
        "content": "next turn",
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "read",
            "args": {},
            "id": "call_2",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "call_1",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "[Tool call was interrupted and did not return a result.]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "call_1",
        "name": "bash",
        "status": "error"
      },
      {
        "type": "human",
        "content": "next turn",
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "read",
            "args": {},
            "id": "call_2",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "[Tool call was interrupted and did not return a result.]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "call_2",
        "name": "read",
        "status": "error"
      }
    ]
  },
  {
    "name": "test_synthetic_message_content",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "call_1",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "call_1",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "[Tool call was interrupted and did not return a result.]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "call_1",
        "name": "bash",
        "status": "error"
      }
    ]
  },
  {
    "name": "test_raw_provider_tool_calls_are_patched",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {
              "command": "ls"
            },
            "id": "call_1",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {
          "tool_calls": [
            {
              "id": "call_1",
              "type": "function",
              "function": {
                "name": "bash",
                "arguments": "{\"command\":\"ls\"}"
              }
            }
          ]
        },
        "response_metadata": {},
        "name": null
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {
              "command": "ls"
            },
            "id": "call_1",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {
          "tool_calls": [
            {
              "id": "call_1",
              "type": "function",
              "function": {
                "name": "bash",
                "arguments": "{\"command\":\"ls\"}"
              }
            }
          ]
        },
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "[Tool call was interrupted and did not return a result.]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "call_1",
        "name": "bash",
        "status": "error"
      }
    ]
  },
  {
    "name": "test_empty_structured_tool_call_name_is_sanitized",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "",
            "args": {},
            "id": "empty_name_call",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "unknown_tool",
            "args": {},
            "id": "empty_name_call",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "[Tool call could not be executed because its name was missing or empty. Use one of the available tool names when retrying.]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "empty_name_call",
        "name": "unknown_tool",
        "status": "error"
      }
    ]
  },
  {
    "name": "test_malformed_raw_provider_tool_call_name_is_sanitized[raw_tool_call0]",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [],
        "invalid_tool_calls": [],
        "additional_kwargs": {
          "tool_calls": [
            {
              "id": "missing_name_call",
              "type": "function",
              "function": {
                "arguments": "{}"
              }
            }
          ]
        },
        "response_metadata": {},
        "name": null
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [],
        "invalid_tool_calls": [],
        "additional_kwargs": {
          "tool_calls": [
            {
              "id": "missing_name_call",
              "type": "function",
              "function": {
                "arguments": "{}",
                "name": "unknown_tool"
              }
            }
          ]
        },
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "[Tool call could not be executed because its name was missing or empty. Use one of the available tool names when retrying.]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "missing_name_call",
        "name": "unknown_tool",
        "status": "error"
      }
    ]
  },
  {
    "name": "test_malformed_raw_provider_tool_call_name_is_sanitized[raw_tool_call1]",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [],
        "invalid_tool_calls": [],
        "additional_kwargs": {
          "tool_calls": [
            {
              "id": "non_string_name_call",
              "type": "function",
              "function": {
                "name": 42,
                "arguments": "{}"
              }
            }
          ]
        },
        "response_metadata": {},
        "name": null
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [],
        "invalid_tool_calls": [],
        "additional_kwargs": {
          "tool_calls": [
            {
              "id": "non_string_name_call",
              "type": "function",
              "function": {
                "name": "unknown_tool",
                "arguments": "{}"
              }
            }
          ]
        },
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "[Tool call could not be executed because its name was missing or empty. Use one of the available tool names when retrying.]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "non_string_name_call",
        "name": "unknown_tool",
        "status": "error"
      }
    ]
  },
  {
    "name": "test_raw_fallback_is_skipped_when_invalid_view_carries_the_same_call",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [],
        "invalid_tool_calls": [
          {
            "id": "call_x",
            "name": "read_file",
            "args": null,
            "error": "parse"
          }
        ],
        "additional_kwargs": {
          "tool_calls": [
            {
              "id": "call_x",
              "type": "function",
              "function": {
                "name": "read_file",
                "arguments": "{}"
              }
            }
          ]
        },
        "response_metadata": {},
        "name": null
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [],
        "invalid_tool_calls": [
          {
            "id": "call_x",
            "name": "read_file",
            "args": "{}",
            "error": "parse"
          }
        ],
        "additional_kwargs": {
          "tool_calls": [
            {
              "id": "call_x",
              "type": "function",
              "function": {
                "name": "read_file",
                "arguments": "{}"
              }
            }
          ]
        },
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "[Tool call could not be executed because its arguments were invalid: parse]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "call_x",
        "name": "read_file",
        "status": "error"
      }
    ]
  },
  {
    "name": "test_existing_tool_result_still_sanitizes_empty_structured_tool_call_name",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": " ",
            "args": {},
            "id": "empty_name_call",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "Error: invalid tool",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "empty_name_call",
        "name": "",
        "status": "success"
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "unknown_tool",
            "args": {},
            "id": "empty_name_call",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "Error: invalid tool",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "empty_name_call",
        "name": "unknown_tool",
        "status": "success"
      }
    ]
  },
  {
    "name": "test_raw_provider_tool_call_empty_function_name_is_sanitized",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "",
            "args": {},
            "id": "raw_empty_name_call",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {
          "tool_calls": [
            {
              "id": "raw_empty_name_call",
              "type": "function",
              "function": {
                "name": "",
                "arguments": "{}"
              }
            }
          ]
        },
        "response_metadata": {},
        "name": null
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "unknown_tool",
            "args": {},
            "id": "raw_empty_name_call",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {
          "tool_calls": [
            {
              "id": "raw_empty_name_call",
              "type": "function",
              "function": {
                "name": "unknown_tool",
                "arguments": "{}"
              }
            }
          ]
        },
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "[Tool call could not be executed because its name was missing or empty. Use one of the available tool names when retrying.]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "raw_empty_name_call",
        "name": "unknown_tool",
        "status": "error"
      }
    ]
  },
  {
    "name": "test_valid_structured_call_with_empty_raw_provider_name_is_sanitized",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "id": "call_1",
            "args": {}
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {
          "tool_calls": [
            {
              "id": "call_1",
              "type": "function",
              "function": {
                "name": "",
                "arguments": "{}"
              }
            }
          ]
        },
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "call_1",
        "name": "bash",
        "status": "success"
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "id": "call_1",
            "args": {}
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {
          "tool_calls": [
            {
              "id": "call_1",
              "type": "function",
              "function": {
                "name": "unknown_tool",
                "arguments": "{}"
              }
            }
          ]
        },
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "call_1",
        "name": "bash",
        "status": "success"
      }
    ]
  },
  {
    "name": "test_empty_name_invalid_tool_call_uses_name_recovery_message",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [],
        "invalid_tool_calls": [
          {
            "type": "invalid_tool_call",
            "id": "empty_invalid_call",
            "name": "",
            "args": "{\"description\":\"write report\",\"path\":\"/mnt/user-data/outputs/report.md\",\"content\":\"bad {\"json\"}\"}",
            "error": "Failed to parse tool arguments: malformed JSON"
          }
        ],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [],
        "invalid_tool_calls": [
          {
            "type": "invalid_tool_call",
            "id": "empty_invalid_call",
            "name": "unknown_tool",
            "args": "{}",
            "error": "Failed to parse tool arguments: malformed JSON"
          }
        ],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "[Tool call could not be executed because its name was missing or empty. Use one of the available tool names when retrying.]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "empty_invalid_call",
        "name": "unknown_tool",
        "status": "error"
      }
    ]
  },
  {
    "name": "test_issue_4172_mixed_tool_calls_serialize_with_valid_names_and_arguments",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "read_file",
            "args": {},
            "id": "valid_call",
            "type": "tool_call"
          },
          {
            "name": "",
            "args": {},
            "id": "empty_name_call",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [
          {
            "type": "invalid_tool_call",
            "id": "invalid_args_call",
            "name": "read_file",
            "args": "{\"description\": \"读取CSV数据文件前部内容\", \"path\": \"/mnt/user-data/uploads/test2.csv\"}}",
            "error": null
          }
        ],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "valid_call",
        "name": "read_file",
        "status": "success"
      },
      {
        "type": "tool",
        "content": "Error: invalid tool",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "empty_name_call",
        "name": "",
        "status": "error"
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "read_file",
            "args": {},
            "id": "valid_call",
            "type": "tool_call"
          },
          {
            "name": "unknown_tool",
            "args": {},
            "id": "empty_name_call",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [
          {
            "type": "invalid_tool_call",
            "id": "invalid_args_call",
            "name": "read_file",
            "args": "{}",
            "error": null
          }
        ],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "valid_call",
        "name": "read_file",
        "status": "success"
      },
      {
        "type": "tool",
        "content": "Error: invalid tool",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "empty_name_call",
        "name": "unknown_tool",
        "status": "error"
      },
      {
        "type": "tool",
        "content": "[Tool call could not be executed because its arguments were invalid.]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "invalid_args_call",
        "name": "read_file",
        "status": "error"
      }
    ]
  },
  {
    "name": "test_empty_name_and_malformed_arguments_in_invalid_tool_call_are_sanitized",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [],
        "invalid_tool_calls": [
          {
            "type": "invalid_tool_call",
            "id": "empty_invalid_call",
            "name": "",
            "args": "{\"description\":\"write report\",\"path\":\"/mnt/user-data/outputs/report.md\",\"content\":\"bad {\"json\"}\"}",
            "error": "Failed to parse tool arguments: malformed JSON"
          }
        ],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [],
        "invalid_tool_calls": [
          {
            "type": "invalid_tool_call",
            "id": "empty_invalid_call",
            "name": "unknown_tool",
            "args": "{}",
            "error": "Failed to parse tool arguments: malformed JSON"
          }
        ],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "[Tool call could not be executed because its name was missing or empty. Use one of the available tool names when retrying.]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "empty_invalid_call",
        "name": "unknown_tool",
        "status": "error"
      }
    ]
  },
  {
    "name": "test_raw_provider_tool_call_arguments_are_sanitized[{\"path\":\"/tmp/data.csv\"}}]",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [],
        "invalid_tool_calls": [],
        "additional_kwargs": {
          "tool_calls": [
            {
              "id": "raw_invalid_args_call",
              "type": "function",
              "function": {
                "name": "read_file",
                "arguments": "{\"path\":\"/tmp/data.csv\"}}"
              }
            }
          ]
        },
        "response_metadata": {},
        "name": null
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [],
        "invalid_tool_calls": [],
        "additional_kwargs": {
          "tool_calls": [
            {
              "id": "raw_invalid_args_call",
              "type": "function",
              "function": {
                "name": "read_file",
                "arguments": "{}"
              }
            }
          ]
        },
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "[Tool call was interrupted and did not return a result.]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "raw_invalid_args_call",
        "name": "read_file",
        "status": "error"
      }
    ]
  },
  {
    "name": "test_raw_provider_tool_call_arguments_are_sanitized[None]",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [],
        "invalid_tool_calls": [],
        "additional_kwargs": {
          "tool_calls": [
            {
              "id": "raw_invalid_args_call",
              "type": "function",
              "function": {
                "name": "read_file",
                "arguments": null
              }
            }
          ]
        },
        "response_metadata": {},
        "name": null
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [],
        "invalid_tool_calls": [],
        "additional_kwargs": {
          "tool_calls": [
            {
              "id": "raw_invalid_args_call",
              "type": "function",
              "function": {
                "name": "read_file",
                "arguments": "{}"
              }
            }
          ]
        },
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "[Tool call was interrupted and did not return a result.]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "raw_invalid_args_call",
        "name": "read_file",
        "status": "error"
      }
    ]
  },
  {
    "name": "test_raw_provider_tool_call_arguments_are_sanitized[[\"not\", \"an\", \"object\"]]",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [],
        "invalid_tool_calls": [],
        "additional_kwargs": {
          "tool_calls": [
            {
              "id": "raw_invalid_args_call",
              "type": "function",
              "function": {
                "name": "read_file",
                "arguments": "[\"not\", \"an\", \"object\"]"
              }
            }
          ]
        },
        "response_metadata": {},
        "name": null
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [],
        "invalid_tool_calls": [],
        "additional_kwargs": {
          "tool_calls": [
            {
              "id": "raw_invalid_args_call",
              "type": "function",
              "function": {
                "name": "read_file",
                "arguments": "{}"
              }
            }
          ]
        },
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "[Tool call was interrupted and did not return a result.]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "raw_invalid_args_call",
        "name": "read_file",
        "status": "error"
      }
    ]
  },
  {
    "name": "test_raw_provider_tool_call_arguments_are_sanitized[arguments3]",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [],
        "invalid_tool_calls": [],
        "additional_kwargs": {
          "tool_calls": [
            {
              "id": "raw_invalid_args_call",
              "type": "function",
              "function": {
                "name": "read_file",
                "arguments": {
                  "path": "/tmp/data.csv"
                }
              }
            }
          ]
        },
        "response_metadata": {},
        "name": null
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [],
        "invalid_tool_calls": [],
        "additional_kwargs": {
          "tool_calls": [
            {
              "id": "raw_invalid_args_call",
              "type": "function",
              "function": {
                "name": "read_file",
                "arguments": "{\"path\": \"/tmp/data.csv\"}"
              }
            }
          ]
        },
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "[Tool call was interrupted and did not return a result.]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "raw_invalid_args_call",
        "name": "read_file",
        "status": "error"
      }
    ]
  },
  {
    "name": "test_valid_invalid_tool_call_arguments_are_sanitization_noop",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [],
        "invalid_tool_calls": [
          {
            "type": "invalid_tool_call",
            "id": "valid_args_call",
            "name": "read_file",
            "args": "{\"path\": \"/tmp/data.csv\"}",
            "error": "schema validation failed"
          }
        ],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "valid_args_call",
        "name": "read_file",
        "status": "success"
      }
    ],
    "expected": null
  },
  {
    "name": "test_non_adjacent_tool_result_is_moved_next_to_tool_call",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "call_1",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "human",
        "content": "interruption",
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "call_1",
        "name": "bash",
        "status": "success"
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "call_1",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "call_1",
        "name": "bash",
        "status": "success"
      },
      {
        "type": "human",
        "content": "interruption",
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      }
    ]
  },
  {
    "name": "test_multiple_tool_results_stay_grouped_after_ai_tool_call",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "call_1",
            "type": "tool_call"
          },
          {
            "name": "read",
            "args": {},
            "id": "call_2",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "human",
        "content": "interruption",
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "call_2",
        "name": "read",
        "status": "success"
      },
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "call_1",
        "name": "bash",
        "status": "success"
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "call_1",
            "type": "tool_call"
          },
          {
            "name": "read",
            "args": {},
            "id": "call_2",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "call_1",
        "name": "bash",
        "status": "success"
      },
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "call_2",
        "name": "read",
        "status": "success"
      },
      {
        "type": "human",
        "content": "interruption",
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      }
    ]
  },
  {
    "name": "test_non_tool_message_inserted_between_partial_tool_results_is_regrouped",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "call_1",
            "type": "tool_call"
          },
          {
            "name": "read",
            "args": {},
            "id": "call_2",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "call_1",
        "name": "bash",
        "status": "success"
      },
      {
        "type": "human",
        "content": "interruption",
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "call_2",
        "name": "read",
        "status": "success"
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "call_1",
            "type": "tool_call"
          },
          {
            "name": "read",
            "args": {},
            "id": "call_2",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "call_1",
        "name": "bash",
        "status": "success"
      },
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "call_2",
        "name": "read",
        "status": "success"
      },
      {
        "type": "human",
        "content": "interruption",
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      }
    ]
  },
  {
    "name": "test_valid_adjacent_tool_results_are_unchanged",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "call_1",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "call_1",
        "name": "bash",
        "status": "success"
      },
      {
        "type": "human",
        "content": "next",
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      }
    ],
    "expected": null
  },
  {
    "name": "test_reused_tool_call_ids_across_ai_turns_keep_their_own_tool_results",
    "input": [
      {
        "type": "human",
        "content": "summary",
        "additional_kwargs": {
          "hide_from_ui": true
        },
        "response_metadata": {},
        "name": "summary"
      },
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "web_search",
            "args": {},
            "id": "web_search:11",
            "type": "tool_call"
          },
          {
            "name": "web_search",
            "args": {},
            "id": "web_search:12",
            "type": "tool_call"
          },
          {
            "name": "web_search",
            "args": {},
            "id": "web_search:13",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "web_search:11",
        "name": "web_search",
        "status": "success"
      },
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "web_search:12",
        "name": "web_search",
        "status": "success"
      },
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "web_search:13",
        "name": "web_search",
        "status": "success"
      },
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "web_search",
            "args": {},
            "id": "web_search:9",
            "type": "tool_call"
          },
          {
            "name": "web_search",
            "args": {},
            "id": "web_search:10",
            "type": "tool_call"
          },
          {
            "name": "web_search",
            "args": {},
            "id": "web_search:11",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "web_search:9",
        "name": "web_search",
        "status": "success"
      },
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "web_search:10",
        "name": "web_search",
        "status": "success"
      },
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "web_search:11",
        "name": "web_search",
        "status": "success"
      }
    ],
    "expected": null
  },
  {
    "name": "test_reused_tool_call_id_patches_second_dangling_occurrence",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "web_search",
            "args": {},
            "id": "web_search:11",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "web_search:11",
        "name": "web_search",
        "status": "success"
      },
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "web_search",
            "args": {},
            "id": "web_search:11",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "web_search",
            "args": {},
            "id": "web_search:11",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "web_search:11",
        "name": "web_search",
        "status": "success"
      },
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "web_search",
            "args": {},
            "id": "web_search:11",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "[Tool call was interrupted and did not return a result.]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "web_search:11",
        "name": "web_search",
        "status": "error"
      }
    ]
  },
  {
    "name": "test_reused_tool_call_id_consumes_later_result_for_first_dangling_occurrence",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "web_search",
            "args": {},
            "id": "web_search:11",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "web_search",
            "args": {},
            "id": "web_search:11",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "web_search:11",
        "name": "web_search",
        "status": "success"
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "web_search",
            "args": {},
            "id": "web_search:11",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "web_search:11",
        "name": "web_search",
        "status": "success"
      },
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "web_search",
            "args": {},
            "id": "web_search:11",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "[Tool call was interrupted and did not return a result.]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "web_search:11",
        "name": "web_search",
        "status": "error"
      }
    ]
  },
  {
    "name": "test_tool_results_are_grouped_with_their_own_ai_turn_across_multiple_ai_messages",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "call_1",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "human",
        "content": "interruption",
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "read",
            "args": {},
            "id": "call_2",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "call_1",
        "name": "bash",
        "status": "success"
      },
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "call_2",
        "name": "read",
        "status": "success"
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "call_1",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "call_1",
        "name": "bash",
        "status": "success"
      },
      {
        "type": "human",
        "content": "interruption",
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "read",
            "args": {},
            "id": "call_2",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "call_2",
        "name": "read",
        "status": "success"
      }
    ]
  },
  {
    "name": "test_orphan_tool_message_is_dropped_during_grouping",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "call_1",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "orphan_call",
        "name": "orphan",
        "status": "success"
      },
      {
        "type": "human",
        "content": "interruption",
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "call_1",
        "name": "bash",
        "status": "success"
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "call_1",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "call_1",
        "name": "bash",
        "status": "success"
      },
      {
        "type": "human",
        "content": "interruption",
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      }
    ]
  },
  {
    "name": "test_leading_orphan_tool_message_is_dropped",
    "input": [
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "stale_call",
        "name": "stale",
        "status": "success"
      },
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "call_1",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "call_1",
        "name": "bash",
        "status": "success"
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "call_1",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "call_1",
        "name": "bash",
        "status": "success"
      }
    ]
  },
  {
    "name": "test_tool_call_id_none_orphan_is_dropped",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "call_1",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "ghost",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": null,
        "name": null,
        "status": "success"
      },
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "call_1",
        "name": "bash",
        "status": "success"
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "call_1",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "call_1",
        "name": "bash",
        "status": "success"
      }
    ]
  },
  {
    "name": "test_invalid_tool_call_is_patched",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [],
        "invalid_tool_calls": [
          {
            "type": "invalid_tool_call",
            "id": "write_file:36",
            "name": "write_file",
            "args": "{\"description\":\"write report\",\"path\":\"/mnt/user-data/outputs/report.md\",\"content\":\"bad {\"json\"}\"}",
            "error": "Failed to parse tool arguments: malformed JSON"
          }
        ],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [],
        "invalid_tool_calls": [
          {
            "type": "invalid_tool_call",
            "id": "write_file:36",
            "name": "write_file",
            "args": "{}",
            "error": "Failed to parse tool arguments: malformed JSON"
          }
        ],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "[write_file failed before execution: the tool-call arguments were not valid JSON, so no file was written. This often happens when the model tries to write a very large Markdown file in a single tool call, especially when `content` contains unescaped quotes, inline JSON, backslashes, or code fences. Do not retry the same large `write_file` payload for this artifact; provide the report/content directly as normal assistant text in your next response. If a file write is still needed later, split the file into smaller sections instead of one large payload. Parser error: Failed to parse tool arguments: malformed JSON]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "write_file:36",
        "name": "write_file",
        "status": "error"
      }
    ]
  },
  {
    "name": "test_non_write_file_invalid_tool_call_uses_generic_recovery_message",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [],
        "invalid_tool_calls": [
          {
            "type": "invalid_tool_call",
            "id": "search:1",
            "name": "search",
            "args": "{\"description\":\"write report\",\"path\":\"/mnt/user-data/outputs/report.md\",\"content\":\"bad {\"json\"}\"}",
            "error": "Failed to parse tool arguments: malformed JSON"
          }
        ],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [],
        "invalid_tool_calls": [
          {
            "type": "invalid_tool_call",
            "id": "search:1",
            "name": "search",
            "args": "{}",
            "error": "Failed to parse tool arguments: malformed JSON"
          }
        ],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "[Tool call could not be executed because its arguments were invalid: Failed to parse tool arguments: malformed JSON]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "search:1",
        "name": "search",
        "status": "error"
      }
    ]
  },
  {
    "name": "test_valid_and_invalid_tool_calls_are_both_patched",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "call_1",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [
          {
            "type": "invalid_tool_call",
            "id": "write_file:36",
            "name": "write_file",
            "args": "{\"description\":\"write report\",\"path\":\"/mnt/user-data/outputs/report.md\",\"content\":\"bad {\"json\"}\"}",
            "error": "Failed to parse tool arguments: malformed JSON"
          }
        ],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "call_1",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [
          {
            "type": "invalid_tool_call",
            "id": "write_file:36",
            "name": "write_file",
            "args": "{}",
            "error": "Failed to parse tool arguments: malformed JSON"
          }
        ],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "[Tool call was interrupted and did not return a result.]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "call_1",
        "name": "bash",
        "status": "error"
      },
      {
        "type": "tool",
        "content": "[write_file failed before execution: the tool-call arguments were not valid JSON, so no file was written. This often happens when the model tries to write a very large Markdown file in a single tool call, especially when `content` contains unescaped quotes, inline JSON, backslashes, or code fences. Do not retry the same large `write_file` payload for this artifact; provide the report/content directly as normal assistant text in your next response. If a file write is still needed later, split the file into smaller sections instead of one large payload. Parser error: Failed to parse tool arguments: malformed JSON]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "write_file:36",
        "name": "write_file",
        "status": "error"
      }
    ]
  },
  {
    "name": "test_invalid_tool_call_already_responded_is_sanitized_without_placeholder",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [],
        "invalid_tool_calls": [
          {
            "type": "invalid_tool_call",
            "id": "write_file:36",
            "name": "write_file",
            "args": "{\"description\":\"write report\",\"path\":\"/mnt/user-data/outputs/report.md\",\"content\":\"bad {\"json\"}\"}",
            "error": "Failed to parse tool arguments: malformed JSON"
          }
        ],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "write_file:36",
        "name": "write_file",
        "status": "success"
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [],
        "invalid_tool_calls": [
          {
            "type": "invalid_tool_call",
            "id": "write_file:36",
            "name": "write_file",
            "args": "{}",
            "error": "Failed to parse tool arguments: malformed JSON"
          }
        ],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "write_file:36",
        "name": "write_file",
        "status": "success"
      }
    ]
  },
  {
    "name": "test_malformed_structured_tool_call_id_is_normalized[]",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "deerflow_synthetic_tool_call_0_call_0",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "[Tool call was interrupted and did not return a result.]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "deerflow_synthetic_tool_call_0_call_0",
        "name": "bash",
        "status": "error"
      }
    ]
  },
  {
    "name": "test_malformed_structured_tool_call_id_is_normalized[   ]",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "   ",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "deerflow_synthetic_tool_call_0_call_0",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "[Tool call was interrupted and did not return a result.]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "deerflow_synthetic_tool_call_0_call_0",
        "name": "bash",
        "status": "error"
      }
    ]
  },
  {
    "name": "test_malformed_structured_tool_call_id_is_normalized[None]",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": null,
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "deerflow_synthetic_tool_call_0_call_0",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "[Tool call was interrupted and did not return a result.]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "deerflow_synthetic_tool_call_0_call_0",
        "name": "bash",
        "status": "error"
      }
    ]
  },
  {
    "name": "test_empty_tool_call_id_keeps_its_paired_tool_result",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "REAL RESULT",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "",
        "name": "bash",
        "status": "success"
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "deerflow_synthetic_tool_call_0_call_0",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "REAL RESULT",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "deerflow_synthetic_tool_call_0_call_0",
        "name": "bash",
        "status": "success"
      }
    ]
  },
  {
    "name": "test_multiple_empty_ids_get_distinct_ids_and_pair_in_order",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "",
            "type": "tool_call"
          },
          {
            "name": "ls",
            "args": {},
            "id": "",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "first",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "",
        "name": "bash",
        "status": "success"
      },
      {
        "type": "tool",
        "content": "second",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "",
        "name": "ls",
        "status": "success"
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "deerflow_synthetic_tool_call_0_call_0",
            "type": "tool_call"
          },
          {
            "name": "ls",
            "args": {},
            "id": "deerflow_synthetic_tool_call_0_call_1",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "first",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "deerflow_synthetic_tool_call_0_call_0",
        "name": "bash",
        "status": "success"
      },
      {
        "type": "tool",
        "content": "second",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "deerflow_synthetic_tool_call_0_call_1",
        "name": "ls",
        "status": "success"
      }
    ]
  },
  {
    "name": "test_empty_id_invalid_tool_call_is_normalized",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [],
        "invalid_tool_calls": [
          {
            "type": "invalid_tool_call",
            "id": "",
            "name": "write_file",
            "args": "{\"description\":\"write report\",\"path\":\"/mnt/user-data/outputs/report.md\",\"content\":\"bad {\"json\"}\"}",
            "error": "Failed to parse tool arguments: malformed JSON"
          }
        ],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [],
        "invalid_tool_calls": [
          {
            "type": "invalid_tool_call",
            "id": "deerflow_synthetic_tool_call_0_invalid_0",
            "name": "write_file",
            "args": "{}",
            "error": "Failed to parse tool arguments: malformed JSON"
          }
        ],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "[write_file failed before execution: the tool-call arguments were not valid JSON, so no file was written. This often happens when the model tries to write a very large Markdown file in a single tool call, especially when `content` contains unescaped quotes, inline JSON, backslashes, or code fences. Do not retry the same large `write_file` payload for this artifact; provide the report/content directly as normal assistant text in your next response. If a file write is still needed later, split the file into smaller sections instead of one large payload. Parser error: Failed to parse tool arguments: malformed JSON]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "deerflow_synthetic_tool_call_0_invalid_0",
        "name": "write_file",
        "status": "error"
      }
    ]
  },
  {
    "name": "test_empty_id_raw_provider_tool_call_is_normalized",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [],
        "invalid_tool_calls": [],
        "additional_kwargs": {
          "tool_calls": [
            {
              "id": "",
              "type": "function",
              "function": {
                "name": "bash",
                "arguments": "{}"
              }
            }
          ]
        },
        "response_metadata": {},
        "name": null
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [],
        "invalid_tool_calls": [],
        "additional_kwargs": {
          "tool_calls": [
            {
              "id": "deerflow_synthetic_tool_call_0_raw_0",
              "type": "function",
              "function": {
                "name": "bash",
                "arguments": "{}"
              }
            }
          ]
        },
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "[Tool call was interrupted and did not return a result.]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "deerflow_synthetic_tool_call_0_raw_0",
        "name": "bash",
        "status": "error"
      }
    ]
  },
  {
    "name": "test_only_the_serialized_view_of_a_call_gets_a_recovered_id",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "id": "",
            "args": {}
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {
          "tool_calls": [
            {
              "id": "",
              "type": "function",
              "function": {
                "name": "bash",
                "arguments": "{}"
              }
            }
          ]
        },
        "response_metadata": {},
        "name": null
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "id": "deerflow_synthetic_tool_call_0_call_0",
            "args": {}
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {
          "tool_calls": [
            {
              "id": "",
              "type": "function",
              "function": {
                "name": "bash",
                "arguments": "{}"
              }
            }
          ]
        },
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "[Tool call was interrupted and did not return a result.]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "deerflow_synthetic_tool_call_0_call_0",
        "name": "bash",
        "status": "error"
      }
    ]
  },
  {
    "name": "test_raw_view_shadowed_by_invalid_calls_gets_no_placeholder",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [],
        "invalid_tool_calls": [
          {
            "name": "write_file",
            "args": "{\"path\": \"/mnt/user-data/outputs/report.md\", \"content\": \"## Report {\"",
            "id": "",
            "error": "Unterminated string"
          }
        ],
        "additional_kwargs": {
          "tool_calls": [
            {
              "id": "",
              "type": "function",
              "function": {
                "name": "write_file",
                "arguments": "{\"path\": \"/mnt/user-data/outputs/report.md\", \"content\": \"## Report {\""
              }
            }
          ]
        },
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "REAL RESULT",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "",
        "name": "write_file",
        "status": "success"
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [],
        "invalid_tool_calls": [
          {
            "name": "write_file",
            "args": "{}",
            "id": "deerflow_synthetic_tool_call_0_invalid_0",
            "error": "Unterminated string"
          }
        ],
        "additional_kwargs": {
          "tool_calls": [
            {
              "id": "",
              "type": "function",
              "function": {
                "name": "write_file",
                "arguments": "{}"
              }
            }
          ]
        },
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "REAL RESULT",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "deerflow_synthetic_tool_call_0_invalid_0",
        "name": "write_file",
        "status": "success"
      }
    ]
  },
  {
    "name": "test_none_id_call_reclaims_its_own_none_id_result",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": null,
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "REAL RESULT",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": null,
        "name": null,
        "status": "success"
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "deerflow_synthetic_tool_call_0_call_0",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "REAL RESULT",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "deerflow_synthetic_tool_call_0_call_0",
        "name": null,
        "status": "success"
      }
    ]
  },
  {
    "name": "test_dangling_call_does_not_consume_a_later_turns_result",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "REAL RESULT",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "",
        "name": "bash",
        "status": "success"
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "deerflow_synthetic_tool_call_0_call_0",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "[Tool call was interrupted and did not return a result.]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "deerflow_synthetic_tool_call_0_call_0",
        "name": "bash",
        "status": "error"
      },
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "deerflow_synthetic_tool_call_1_call_0",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "REAL RESULT",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "deerflow_synthetic_tool_call_1_call_0",
        "name": "bash",
        "status": "success"
      }
    ]
  },
  {
    "name": "test_orphan_result_is_not_adopted_by_a_later_malformed_call",
    "input": [
      {
        "type": "tool",
        "content": "STALE ORPHAN",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "",
        "name": "search",
        "status": "success"
      },
      {
        "type": "human",
        "content": "continue",
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "write_file",
            "args": {},
            "id": "",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      }
    ],
    "expected": [
      {
        "type": "human",
        "content": "continue",
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "write_file",
            "args": {},
            "id": "deerflow_synthetic_tool_call_2_call_0",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "[Tool call was interrupted and did not return a result.]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "deerflow_synthetic_tool_call_2_call_0",
        "name": "write_file",
        "status": "error"
      }
    ]
  },
  {
    "name": "test_sibling_call_does_not_consume_its_neighbours_result",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "search",
            "args": {},
            "id": "",
            "type": "tool_call"
          },
          {
            "name": "write_file",
            "args": {},
            "id": "",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "REAL RESULT",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "",
        "name": "write_file",
        "status": "success"
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "search",
            "args": {},
            "id": "deerflow_synthetic_tool_call_0_call_0",
            "type": "tool_call"
          },
          {
            "name": "write_file",
            "args": {},
            "id": "deerflow_synthetic_tool_call_0_call_1",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "[Tool call was interrupted and did not return a result.]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "deerflow_synthetic_tool_call_0_call_0",
        "name": "search",
        "status": "error"
      },
      {
        "type": "tool",
        "content": "REAL RESULT",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "deerflow_synthetic_tool_call_0_call_1",
        "name": "write_file",
        "status": "success"
      }
    ]
  },
  {
    "name": "test_nameless_result_is_dropped_when_several_siblings_are_eligible",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "search",
            "args": {},
            "id": "",
            "type": "tool_call"
          },
          {
            "name": "write_file",
            "args": {},
            "id": "",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "REAL RESULT",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "",
        "name": null,
        "status": "success"
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "search",
            "args": {},
            "id": "deerflow_synthetic_tool_call_0_call_0",
            "type": "tool_call"
          },
          {
            "name": "write_file",
            "args": {},
            "id": "deerflow_synthetic_tool_call_0_call_1",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "[Tool call was interrupted and did not return a result.]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "deerflow_synthetic_tool_call_0_call_0",
        "name": "search",
        "status": "error"
      },
      {
        "type": "tool",
        "content": "[Tool call was interrupted and did not return a result.]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "deerflow_synthetic_tool_call_0_call_1",
        "name": "write_file",
        "status": "error"
      }
    ]
  },
  {
    "name": "test_identical_parallel_calls_pair_with_their_results_in_order",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "",
            "type": "tool_call"
          },
          {
            "name": "bash",
            "args": {},
            "id": "",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "RESULT A",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "",
        "name": "bash",
        "status": "success"
      },
      {
        "type": "tool",
        "content": "RESULT B",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "",
        "name": "bash",
        "status": "success"
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "deerflow_synthetic_tool_call_0_call_0",
            "type": "tool_call"
          },
          {
            "name": "bash",
            "args": {},
            "id": "deerflow_synthetic_tool_call_0_call_1",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "RESULT A",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "deerflow_synthetic_tool_call_0_call_0",
        "name": "bash",
        "status": "success"
      },
      {
        "type": "tool",
        "content": "RESULT B",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "deerflow_synthetic_tool_call_0_call_1",
        "name": "bash",
        "status": "success"
      }
    ]
  },
  {
    "name": "test_identical_parallel_calls_drop_a_lone_ambiguous_result",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "",
            "type": "tool_call"
          },
          {
            "name": "bash",
            "args": {},
            "id": "",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "LONE RESULT",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "",
        "name": "bash",
        "status": "success"
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "deerflow_synthetic_tool_call_0_call_0",
            "type": "tool_call"
          },
          {
            "name": "bash",
            "args": {},
            "id": "deerflow_synthetic_tool_call_0_call_1",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "[Tool call was interrupted and did not return a result.]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "deerflow_synthetic_tool_call_0_call_0",
        "name": "bash",
        "status": "error"
      },
      {
        "type": "tool",
        "content": "[Tool call was interrupted and did not return a result.]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "deerflow_synthetic_tool_call_0_call_1",
        "name": "bash",
        "status": "error"
      }
    ]
  },
  {
    "name": "test_result_naming_no_call_is_dropped_rather_than_misattributed",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "search",
            "args": {},
            "id": "",
            "type": "tool_call"
          },
          {
            "name": "write_file",
            "args": {},
            "id": "",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "RESULT OF NEITHER",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "",
        "name": "grep",
        "status": "success"
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "search",
            "args": {},
            "id": "deerflow_synthetic_tool_call_0_call_0",
            "type": "tool_call"
          },
          {
            "name": "write_file",
            "args": {},
            "id": "deerflow_synthetic_tool_call_0_call_1",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "[Tool call was interrupted and did not return a result.]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "deerflow_synthetic_tool_call_0_call_0",
        "name": "search",
        "status": "error"
      },
      {
        "type": "tool",
        "content": "[Tool call was interrupted and did not return a result.]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "deerflow_synthetic_tool_call_0_call_1",
        "name": "write_file",
        "status": "error"
      }
    ]
  },
  {
    "name": "test_valid_ids_are_left_byte_for_byte_unchanged",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": " call_1 ",
            "type": "tool_call"
          },
          {
            "name": "ls",
            "args": {},
            "id": "",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": " call_1 ",
        "name": "bash",
        "status": "success"
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": " call_1 ",
            "type": "tool_call"
          },
          {
            "name": "ls",
            "args": {},
            "id": "deerflow_synthetic_tool_call_0_call_1",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "result",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": " call_1 ",
        "name": "bash",
        "status": "success"
      },
      {
        "type": "tool",
        "content": "[Tool call was interrupted and did not return a result.]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "deerflow_synthetic_tool_call_0_call_1",
        "name": "ls",
        "status": "error"
      }
    ]
  },
  {
    "name": "test_no_patch_passthrough",
    "input": [
      {
        "type": "ai",
        "content": "hello",
        "tool_calls": [],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      }
    ],
    "expected": null
  },
  {
    "name": "test_patched_request_forwarded",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "call_1",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "call_1",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "[Tool call was interrupted and did not return a result.]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "call_1",
        "name": "bash",
        "status": "error"
      }
    ]
  },
  {
    "name": "test_async_no_patch[asyncio]",
    "input": [
      {
        "type": "ai",
        "content": "hello",
        "tool_calls": [],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      }
    ],
    "expected": null
  },
  {
    "name": "test_async_patched[asyncio]",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "call_1",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "call_1",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "[Tool call was interrupted and did not return a result.]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "call_1",
        "name": "bash",
        "status": "error"
      }
    ]
  },
  {
    "name": "test_async_no_patch[trio]",
    "input": [
      {
        "type": "ai",
        "content": "hello",
        "tool_calls": [],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      }
    ],
    "expected": null
  },
  {
    "name": "test_async_patched[trio]",
    "input": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "call_1",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      }
    ],
    "expected": [
      {
        "type": "ai",
        "content": "",
        "tool_calls": [
          {
            "name": "bash",
            "args": {},
            "id": "call_1",
            "type": "tool_call"
          }
        ],
        "invalid_tool_calls": [],
        "additional_kwargs": {},
        "response_metadata": {},
        "name": null
      },
      {
        "type": "tool",
        "content": "[Tool call was interrupted and did not return a result.]",
        "additional_kwargs": {},
        "response_metadata": {},
        "tool_call_id": "call_1",
        "name": "bash",
        "status": "error"
      }
    ]
  }
];
