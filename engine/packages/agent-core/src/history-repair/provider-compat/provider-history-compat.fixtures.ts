// From mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421:packages/core/__recordings__/core-src-processors-provider-history-compat-native-anthropic-foreign-reasoning.e2e.json (atlas AGENT-LOOP-0095). Pinned real provider response recordings for offline replay.
export const foreignFirst = {
  id: "gen-1779104135-EodzGuIvRvaYbjZ3ZNqR",
  object: "chat.completion",
  created: 1779104135,
  model: "minimax/minimax-m2.5-20260211",
  provider: "AkashML",
  system_fingerprint: null,
  choices: [
    {
      index: 0,
      logprobs: null,
      finish_reason: "stop",
      native_finish_reason: "stop",
      message: {
        role: "assistant",
        content: "19 multiplied by 23 equals 437.",
        refusal: null,
        reasoning:
          'We need to answer 19 * 23. 19*20 = 380; 19*3 = 57; sum = 437. The user says: "What is 19 * 23? Reply with one sentence." So respond with one sentence that gives the answer. Could be "19 multiplied by 23 equals 437." Or just "19 * 23 = 437." Use one sentence. Provide answer.\n\nWe must abide by guidelines: it\'s a simple math request, no policy issues.\n\nAnswer: "19 multiplied by 23 equals 437."\n\nOne sentence. Ensure it\'s exactly one sentence.\n',
        reasoning_details: [
          {
            type: "reasoning.text",
            text: 'We need to answer 19 * 23. 19*20 = 380; 19*3 = 57; sum = 437. The user says: "What is 19 * 23? Reply with one sentence." So respond with one sentence that gives the answer. Could be "19 multiplied by 23 equals 437." Or just "19 * 23 = 437." Use one sentence. Provide answer.\n\nWe must abide by guidelines: it\'s a simple math request, no policy issues.\n\nAnswer: "19 multiplied by 23 equals 437."\n\nOne sentence. Ensure it\'s exactly one sentence.\n',
            format: "unknown",
            index: 0,
          },
        ],
      },
    },
  ],
  usage: {
    prompt_tokens: 38,
    completion_tokens: 138,
    total_tokens: 176,
    cost: 0.0001644,
    is_byok: false,
    prompt_tokens_details: {
      cached_tokens: 0,
      cache_write_tokens: 0,
      audio_tokens: 0,
      video_tokens: 0,
    },
    cost_details: {
      upstream_inference_cost: 0.0001644,
      upstream_inference_prompt_cost: 5.7e-6,
      upstream_inference_completions_cost: 0.0001587,
    },
    completion_tokens_details: {
      reasoning_tokens: 116,
      image_tokens: 0,
      audio_tokens: 0,
    },
  },
} as const;
export const foreignReply = {
  model: "claude-haiku-4-5-20251001",
  id: "msg_01MMsmbxQtiCJebiibpZMKiD",
  type: "message",
  role: "assistant",
  content: [
    {
      type: "text",
      text: "OK",
    },
  ],
  stop_reason: "end_turn",
  stop_sequence: null,
  stop_details: null,
  usage: {
    input_tokens: 50,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation: {
      ephemeral_5m_input_tokens: 0,
      ephemeral_1h_input_tokens: 0,
    },
    output_tokens: 4,
    service_tier: "standard",
    inference_geo: "not_available",
  },
} as const;
export const nativeFirst = {
  model: "claude-haiku-4-5-20251001",
  id: "msg_012YuD8YNLmmR7VBkCEBmKWf",
  type: "message",
  role: "assistant",
  content: [
    {
      type: "thinking",
      thinking:
        "17 * 29 = ?\n\nLet me calculate this:\n17 * 29 = 17 * (30 - 1) = 17 * 30 - 17 * 1 = 510 - 17 = 493\n\nOr I can do it another way:\n17 * 29 = (20 - 3) * 29 = 20 * 29 - 3 * 29 = 580 - 87 = 493\n\nSo 17 * 29 = 493\n\nThe user wants me to reply with one sentence.",
      signature:
        "Er8DCmMIDRgCKkBgSQbx81IQ2ur3Tn1d4mDMWQZXVrKVZMPP5dMdd9UBmQ34nOsBuqxm7SYj8aoKHrG0+2fQEq9T8o6UuIomqg7pMhljbGF1ZGUtaGFpa3UtNC01LTIwMjUxMDAxOAASDPlToVuoe8e0cWDDphoM6XlVcQSyw0jihcynIjC9TqkffDCLrtpoZKUt+p9D1tPjrLVGjY9rk02cB0vUq9tunBjhMhFMVe6XDL71yhcqiQJdpO4vdEc2Srq6FbqC/XY+K1Wq/aLZW3x2utXCGrHwxhfR4L+gCXiKoPXd9kulkKeEV4p5p5ZPADfLd2cOPjgThsO7gE0safmaaal5X8m22UaIccZl7C5JrFeQGg2f+F4ymcpm/W5WrZ8uuMxIPgYJ44OOs9Kp5+1IpsjtKeI7FzdQG/6gLVTTFMryOIMfaKpfCSRO4N/jdYAUt3jxwuC+KVINdgq3UsfI/82OWEWkf5KCJQjZmLWD77g9mWJtwGlsMAxFhzj0UDCGPl46pyfbdMhDf1zcrc6t5LGImygxhmvib9ZeHfTjTZijeV/5+Oj+bvRmSo0Z//U4KMKuue1WqZKSBgVH+urmGAE=",
    },
    {
      type: "text",
      text: "17 * 29 equals 493.",
    },
  ],
  stop_reason: "end_turn",
  stop_sequence: null,
  stop_details: null,
  usage: {
    input_tokens: 56,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation: {
      ephemeral_5m_input_tokens: 0,
      ephemeral_1h_input_tokens: 0,
    },
    output_tokens: 159,
    service_tier: "standard",
    inference_geo: "not_available",
  },
} as const;
export const nativeReply = {
  model: "claude-haiku-4-5-20251001",
  id: "msg_018w3U7C7yFQ1GzWzcxMYspq",
  type: "message",
  role: "assistant",
  content: [
    {
      type: "thinking",
      thinking:
        'The user is asking me to reply with only "OK". This is a straightforward request that I should follow.',
      signature:
        "EqsCCmMIDRgCKkAVPbTmXhDmIgKo9CLil0RUO4LLF8mTxCaCrMb7l6nHTM8GSNXqB2x20Z6vpqJqMRBvwKQ1ZTzpoQK2DkfExQI/MhljbGF1ZGUtaGFpa3UtNC01LTIwMjUxMDAxOAASDNtS+X1ypEtpOv6awhoMqpIFtqf7l/U7r/5SIjAkPErSklxRLWmLhnqrQnRZJ24VK9/lVY7yDMoUxFHi+oTyafUvBpbyyGFVbKx2gcYqdhqo8BghImMQWmqkWzcAcl6UcVPDKaTSBuxVbhxonq/TWZLf2/m1FgBI/ho1jm+qrVaeimWu3wxF1ntOWjzrYmgzoLLDG5WR1NSPtTvXlMISmZ++xAvWuXThkAtxYsSm24+O7aYzGnLBK2sQBwfVblHKkQYdwcwYAQ==",
    },
    {
      type: "text",
      text: "OK",
    },
  ],
  stop_reason: "end_turn",
  stop_sequence: null,
  stop_details: null,
  usage: {
    input_tokens: 78,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation: {
      ephemeral_5m_input_tokens: 0,
      ephemeral_1h_input_tokens: 0,
    },
    output_tokens: 35,
    service_tier: "standard",
    inference_geo: "not_available",
  },
} as const;
