// Comfy helper module supports test helpers behavior.
import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import * as providerAuth from "branch/plugin-sdk/provider-auth-runtime";
import { expect, vi } from "vitest";

type FetchGuardMock = ReturnType<typeof vi.fn>;

type FetchGuardRequest = {
  init?: {
    body?: unknown;
  };
};

type ComfyCloudJobResponseOptions = {
  body: BodyInit;
  contentType: string;
  filename: string;
  outputKind: "gifs" | "images";
  promptId: string;
};

export function buildComfyConfig(config: Record<string, unknown>): BranchConfig {
  return {
    plugins: {
      entries: {
        comfy: { config },
      },
    },
  } as unknown as BranchConfig;
}

export function buildLegacyComfyConfig(config: Record<string, unknown>): BranchConfig {
  return {
    models: {
      providers: {
        comfy: config,
      },
    },
  } as unknown as BranchConfig;
}

export function parseComfyJsonBody(
  fetchWithSsrFGuardMock: FetchGuardMock,
  call: number,
): Record<string, unknown> {
  const request = fetchWithSsrFGuardMock.mock.calls[call - 1]?.[0] as FetchGuardRequest | undefined;
  const body = request?.init?.body;
  expect(body).toBeTruthy();
  if (typeof body !== "string") {
    throw new Error(`Missing Comfy request body for fetch call ${call}`);
  }
  return JSON.parse(body) as Record<string, unknown>;
}

export function mockComfyProviderApiKey(apiKey = "comfy-test-key") {
  return vi.spyOn(providerAuth, "resolveApiKeyForProvider").mockResolvedValue({
    apiKey,
    source: "env",
    mode: "api-key",
  });
}

export function mockComfyCloudJobResponses(
  fetchWithSsrFGuardMock: FetchGuardMock,
  options: ComfyCloudJobResponseOptions,
) {
  fetchWithSsrFGuardMock
    .mockResolvedValueOnce(fetchGuardJson({ prompt_id: options.promptId }))
    .mockResolvedValueOnce(fetchGuardJson({ status: "completed" }))
    .mockResolvedValueOnce(
      fetchGuardJson({
        [options.promptId]: {
          outputs: {
            "9": {
              [options.outputKind]: [{ filename: options.filename, subfolder: "", type: "output" }],
            },
          },
        },
      }),
    )
    .mockResolvedValueOnce(
      fetchGuardResponse(
        new Response(options.body, {
          status: 200,
          headers: { "content-type": options.contentType },
        }),
      ),
    );
}

export function fetchGuardJson(body: unknown) {
  return fetchGuardResponse(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

function fetchGuardResponse(response: Response) {
  return {
    response,
    release: vi.fn(async () => {}),
  };
}
