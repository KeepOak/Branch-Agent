import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { list, rec, str, who, type Rec } from "./hub-shared.js";
import { ok, type TrunkGateway, type TrunkToolsOptions } from "./trunk-tools.js";

/** Graft hub board: Canopy cards with status, owner (the claim), linked PRs and attributed comments. */
export const DEFAULT_BOARD = "branch";

/** A card as an agent reads it: status, owner, linked PRs and the last comments. */
export function readCard(card: Rec): Rec {
  const meta = rec(card.metadata);
  const claim = rec(meta.claim);
  const links = list(meta.links);
  return {
    id: card.id,
    title: card.title,
    status: card.status,
    owner: str(claim.ownerId) ?? str(card.agentId) ?? null,
    labels: card.labels ?? [],
    prs: links
      .map((l) => str(l.url))
      .filter((u): u is string => Boolean(u && /\/pull\/\d+/.test(u))),
    links: links.map((l) => ({
      type: l.type,
      url: l.url,
      title: l.title,
      card: l.targetCardId,
    })),
    comments: list(meta.comments)
      .slice(-5)
      .map((c) => ({ text: c.body, at: c.createdAt })),
    notes: typeof card.notes === "string" ? card.notes.slice(0, 600) : undefined,
    updated_at: card.updatedAt,
  };
}

/** Canopy is a plugin that is off by default; say so plainly instead of "unknown method". */
async function canopy(gw: TrunkGateway, method: string, params: Rec): Promise<Rec> {
  try {
    return rec(await gw.request(method, params));
  } catch (error) {
    if (/unknown method: canopy\./.test(String(error))) {
      throw new Error(
        "The board needs Branch's Canopy plugin, which is off on this Branch (plugins.entries.canopy.enabled).",
        { cause: error },
      );
    }
    throw error;
  }
}

export async function ensureBoard(gw: TrunkGateway, boardId: string, name?: string): Promise<void> {
  const boards = list((await canopy(gw, "canopy.boards.list", {})).boards);
  if (boards.some((b) => b.id === boardId)) {
    return;
  }
  await canopy(gw, "canopy.boards.upsert", {
    id: boardId,
    name: name ?? boardId,
  });
}

const STATUSES = [
  "triage",
  "backlog",
  "todo",
  "scheduled",
  "ready",
  "running",
  "review",
  "blocked",
  "done",
] as const;

export function registerBoardTools(
  server: McpServer,
  gw: TrunkGateway,
  opts: TrunkToolsOptions,
): void {
  const boardArg = z.string().optional().describe('Board id. Default: "branch".');
  server.tool(
    "board_list",
    "List board cards with status, owner, linked PRs and recent comments.",
    { board: boardArg, status: z.enum(STATUSES).optional() },
    async ({ board, status }) => {
      const boardId = board ?? DEFAULT_BOARD;
      const cards = list((await canopy(gw, "canopy.cards.list", { boardId })).cards)
        .filter((c) => !status || c.status === status)
        .map(readCard);
      return ok(`${cards.length} cards`, { board: boardId, cards });
    },
  );

  server.tool(
    "board_create",
    "Create a board card. Pass key (for example P12) to make it idempotent: the same key never makes a second card.",
    {
      title: z.string().min(1).max(300),
      notes: z.string().max(20_000).optional(),
      status: z.enum(STATUSES).optional(),
      key: z.string().max(120).optional(),
      labels: z.array(z.string()).max(20).optional(),
      pr_urls: z.array(z.string().url()).max(20).optional(),
      board: boardArg,
    },
    async (input) => ok("card", { card: readCard(await createCard(gw, opts, input)) }),
  );

  server.tool(
    "board_claim",
    "Claim a card so others see this agent owns it. Returns the claim token (keep it to release or complete).",
    {
      card_id: z.string().min(1),
      ttl_seconds: z.number().int().min(60).max(86_400).optional(),
    },
    async ({ card_id, ttl_seconds }) => {
      const author = await who(opts);
      const claimed = await canopy(gw, "canopy.cards.claim", {
        id: card_id,
        ownerId: author.id,
        ttlSeconds: ttl_seconds ?? 3600,
      });
      opts.activity?.(`Working on card ${card_id}`);
      return ok("claimed", {
        card: readCard(rec(claimed.card)),
        token: claimed.token ?? null,
      });
    },
  );

  server.tool(
    "board_update",
    "Update a card: status, title, notes, labels, or link a PR.",
    {
      card_id: z.string().min(1),
      status: z.enum(STATUSES).optional(),
      title: z.string().min(1).max(300).optional(),
      notes: z.string().max(20_000).optional(),
      labels: z.array(z.string()).max(20).optional(),
      pr_url: z.string().url().optional(),
    },
    async ({ card_id, pr_url, ...patch }) => {
      const fields = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      let card = Object.keys(fields).length
        ? rec(
            (
              await canopy(gw, "canopy.cards.update", {
                id: card_id,
                patch: fields,
              })
            ).card,
          )
        : undefined;
      if (pr_url) {
        card = await linkPr(gw, card_id, pr_url);
      }
      return ok("updated", { card: card ? readCard(card) : null });
    },
  );

  server.tool(
    "board_comment",
    "Comment on a card; the comment carries this agent's name.",
    { card_id: z.string().min(1), text: z.string().min(1).max(1800) },
    async ({ card_id, text }) => {
      const author = await who(opts);
      const card = await canopy(gw, "canopy.cards.comment", {
        id: card_id,
        body: `${author.name}: ${text}`,
      });
      return ok("commented", { card: readCard(rec(card.card ?? card)) });
    },
  );
}

async function linkPr(gw: TrunkGateway, id: string, url: string): Promise<Rec> {
  const number = /\/pull\/(\d+)/.exec(url)?.[1];
  const result = await canopy(gw, "canopy.cards.link", {
    id,
    type: "relates_to",
    url,
    title: number ? `PR #${number}` : url,
  });
  return rec(result.card ?? result);
}

async function createCard(
  gw: TrunkGateway,
  opts: TrunkToolsOptions,
  input: {
    title: string;
    notes?: string;
    status?: string;
    key?: string;
    labels?: string[];
    pr_urls?: string[];
    board?: string;
  },
): Promise<Rec> {
  const boardId = input.board ?? DEFAULT_BOARD;
  await ensureBoard(gw, boardId, boardId === DEFAULT_BOARD ? "Branch" : boardId);
  const author = await who(opts);
  const existing = input.key
    ? list((await canopy(gw, "canopy.cards.list", { boardId })).cards).find(
        (c) => rec(rec(c.metadata).graft).key === input.key,
      )
    : undefined;
  let card =
    existing ??
    rec(
      (
        await canopy(gw, "canopy.cards.create", {
          boardId,
          title: input.title,
          ...(input.notes ? { notes: input.notes } : {}),
          status: input.status ?? "backlog",
          labels: input.labels ?? [],
          ...(input.key ? { idempotencyKey: `graft:${boardId}:${input.key}` } : {}),
          metadata: {
            graft: {
              key: input.key ?? null,
              by: `${author.name} (${author.id})`,
            },
          },
        })
      ).card,
    );
  const have = new Set(list(rec(card.metadata).links).map((l) => l.url));
  for (const url of input.pr_urls ?? []) {
    if (!have.has(url)) {
      card = await linkPr(gw, String(card.id), url);
    }
  }
  return card;
}
