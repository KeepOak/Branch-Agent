import { afterEach, describe, expect, it, vi } from "vitest";
import { listA2aPeers, refreshA2aPeerCards } from "./card-cache.js";
import { sendA2aChannelText } from "./outbound.js";
import type { A2aCoreConfig } from "./types.js";

afterEach(() => vi.restoreAllMocks());

describe("A2A outside contact cards", () => {
  it("fetches only configured peer URLs and never returns credentials", async () => {
    const cfg: A2aCoreConfig = {
      channels: {
        a2a: {
          peers: {
            remote: {
              token: "inbound-secret",
              outboundToken: "outbound-secret",
              url: "https://peer.example/a2a/v1",
            },
            inbound: { token: "inbound-only" },
          },
        },
      },
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          name: "Remote Agent",
          description: "Does work",
          iconUrl: "https://peer.example/icon.png",
          skills: [{ name: "Research" }],
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
    const peers = await refreshA2aPeerCards(cfg);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://peer.example/.well-known/agent-card.json",
    );
    expect(peers).toMatchObject([
      {
        name: "remote",
        where: "peer.example",
        online: true,
        card: { name: "Remote Agent", skills: [{ name: "Research" }] },
      },
      { name: "inbound", where: null, online: false },
    ]);
    expect(JSON.stringify(peers)).not.toContain("secret");
    expect(listA2aPeers(cfg)[0]?.card?.fetchedAt).toEqual(expect.any(Number));
  });

  it("drops a card when the configured address is removed", async () => {
    const cfg: A2aCoreConfig = { channels: { a2a: { peers: { remote: { token: "token" } } } } };
    expect((await refreshA2aPeerCards(cfg))[0]).toMatchObject({ online: false });
  });

  it("applies the directional per-pair gate before outbound network I/O", async () => {
    const cfg: A2aCoreConfig = {
      agents: { entries: { scout: { agentToAgent: { deny: ["a2a:remote"] } } } },
      channels: {
        a2a: { peers: { remote: { token: "inbound", url: "https://peer.example/a2a/v1" } } },
      },
    };
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(
      sendA2aChannelText({ cfg, agentId: "scout", to: "remote", text: "hello" }),
    ).rejects.toThrow("may not message A2A peer remote");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
