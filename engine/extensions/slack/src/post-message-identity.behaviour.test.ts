// Branch behaviour coverage for CHAT-APPS-0169; upstream records no test for this feature.
import { describe, expect, it } from "vitest";
import {
  postSlackMessageWithIdentityFallback,
  type SlackPostMessageIdentity,
} from "./post-message-identity.js";
import type { SlackPostMessagePayload } from "./post-message-payload.js";

function slackError(code: string, needed?: string): Error {
  return Object.assign(new Error(code), { data: { error: code, needed } });
}

describe("Slack custom posting identity", () => {
  const basePayload = { channel: "C123", text: "Hello" };
  const identity: SlackPostMessageIdentity = {
    username: "Alex",
    iconEmoji: ":seedling:",
  };

  it("posts with the authorized user's requested name and icon", async () => {
    const posts: Array<{ payload: SlackPostMessagePayload; identity?: SlackPostMessageIdentity }> = [];
    const result = await postSlackMessageWithIdentityFallback({
      basePayload,
      identity,
      post: async (payload, postedIdentity) => {
        posts.push({ payload, identity: postedIdentity });
        return "sent";
      },
    });

    expect(result).toBe("sent");
    expect(posts).toEqual([
      {
        payload: { ...basePayload, username: "Alex", icon_emoji: ":seedling:" },
        identity,
      },
    ]);
  });

  it("retries without custom identity only when Slack lacks the customization scope", async () => {
    const posts: SlackPostMessagePayload[] = [];
    const result = await postSlackMessageWithIdentityFallback({
      basePayload,
      identity,
      post: async (payload) => {
        posts.push(payload);
        if (posts.length === 1) {
          throw slackError("missing_scope", "chat:write.customize");
        }
        return "sent";
      },
    });

    expect(result).toBe("sent");
    expect(posts).toEqual([
      { ...basePayload, username: "Alex", icon_emoji: ":seedling:" },
      basePayload,
    ]);
  });

  it("does not retry an unrelated posting failure", async () => {
    const posts: SlackPostMessagePayload[] = [];
    const failure = slackError("channel_not_found");
    await expect(
      postSlackMessageWithIdentityFallback({
        basePayload,
        identity,
        post: async (payload) => {
          posts.push(payload);
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
    expect(posts).toHaveLength(1);
  });
});
