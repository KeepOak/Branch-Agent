import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { readProviderJsonResponse } from "branch/plugin-sdk/provider-http";
import {
  fetchWithSsrFGuard,
  ssrfPolicyFromHttpBaseUrlAllowedOrigin,
} from "branch/plugin-sdk/ssrf-runtime";
import { z } from "zod";

const cardSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  iconUrl: z.string().optional(),
  icon_url: z.string().optional(),
  skills: z
    .array(z.object({ name: z.string().min(1), description: z.string().optional() }).passthrough())
    .default([]),
});

export type CachedA2aCard = {
  name: string;
  description: string;
  iconUrl?: string;
  skills: { name: string; description?: string }[];
  fetchedAt: number;
};
export type A2aPeerSummary = {
  name: string;
  where: string | null;
  card?: CachedA2aCard;
  online: boolean;
};

const cards = new Map<string, { url: string; card: CachedA2aCard }>();
const TIMEOUT_MS = 10_000;

function configuredPeers(cfg: BranchConfig): Record<string, { url?: string }> {
  return cfg.channels?.a2a?.peers ?? {};
}

export function listA2aPeers(cfg: BranchConfig): A2aPeerSummary[] {
  return Object.entries(configuredPeers(cfg)).map(([name, peer]) => {
    let where: string | null = null;
    try {
      if (peer.url) where = new URL(peer.url).host;
    } catch {
      // Invalid or missing operator configuration has no discoverable host.
    }
    const cached = peer.url && cards.get(name);
    const card = cached && cached.url === peer.url ? cached.card : undefined;
    return { name, where, ...(card ? { card } : {}), online: Boolean(card) };
  });
}

/** Refresh only operator-configured URLs. A failed fetch leaves no stale online card. */
export async function refreshA2aPeerCards(cfg: BranchConfig): Promise<A2aPeerSummary[]> {
  const peers = configuredPeers(cfg);
  for (const name of cards.keys()) {
    if (!peers[name]?.url) cards.delete(name);
  }
  await Promise.all(
    Object.entries(peers).map(async ([name, peer]) => {
      if (!peer.url) return;
      cards.delete(name);
      try {
        const cardUrl = new URL("/.well-known/agent-card.json", peer.url).href;
        const { response, release } = await fetchWithSsrFGuard({
          url: cardUrl,
          timeoutMs: TIMEOUT_MS,
          signal: AbortSignal.timeout(TIMEOUT_MS),
          policy: ssrfPolicyFromHttpBaseUrlAllowedOrigin(peer.url),
          auditContext: "a2a.agent_card",
          maxRedirects: 0,
          init: { method: "GET" },
        });
        try {
          if (!response.ok) return;
          const parsed = cardSchema.safeParse(
            await readProviderJsonResponse(response, `peer ${name} agent card`),
          );
          if (!parsed.success) return;
          cards.set(name, {
            url: peer.url,
            card: {
              name: parsed.data.name,
              description: parsed.data.description,
              ...((parsed.data.iconUrl ?? parsed.data.icon_url)
                ? { iconUrl: parsed.data.iconUrl ?? parsed.data.icon_url }
                : {}),
              skills: parsed.data.skills.map((skill) => ({
                name: skill.name,
                ...(skill.description ? { description: skill.description } : {}),
              })),
              fetchedAt: Date.now(),
            },
          });
        } finally {
          await release();
        }
      } catch {
        // Offline peers remain visible from operator config, without a cached card.
      }
    }),
  );
  return listA2aPeers(cfg);
}
