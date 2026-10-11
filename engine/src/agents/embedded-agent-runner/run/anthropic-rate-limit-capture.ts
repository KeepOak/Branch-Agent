import { recordAnthropicUnifiedRateLimits } from "../../auth-profiles/usage-rate-limits.js";
import type { StreamFn } from "../../runtime/index.js";

/**
 * Keep the subscription usage each Anthropic response reports in its
 * `anthropic-ratelimit-unified-*` headers, under the run's auth profile.
 * Responses without those headers (other providers, API keys) record nothing.
 */
export function wrapStreamFnWithAnthropicRateLimitCapture(
  streamFn: StreamFn,
  resolveProfileId: () => string | undefined,
): StreamFn {
  return (model, context, options) =>
    streamFn(model, context, {
      ...options,
      onResponse: (response, responseModel) => {
        const profileId = resolveProfileId();
        if (profileId) {
          recordAnthropicUnifiedRateLimits({ profileId, headers: response.headers });
        }
        return options?.onResponse?.(response, responseModel);
      },
    });
}
