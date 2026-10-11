# Mention monitor

Inspired by Lenny Rachitsky's [Overheard](https://x.ai/bot/marketplace/bots/overheard).

Install the built-in template with Gateway RPC `trunks.template.create` and
`{"templateId":"mention-monitor"}`. Open the new Trunk's chat to begin the
watch-list interview. The bundled `mention-monitor` skill is included even when
default skill visibility is filtered.

The interview collects names, brands, URLs, owner profiles to exclude, selected
sources, and the owner's timezone. It creates **Daily mention monitor** disabled,
weekdays at 08:30 local unless changed. A direct yes to the enable question is
required before scheduled digests start. The digest stays in the setup chat;
external delivery or posting needs separate approval.

Reddit, Hacker News, news and X start on. YouTube, Instagram and TikTok need
opt-in; LinkedIn is only added on request. X uses an existing connector when
connected, otherwise web search/browser. No paid API setup is required.

Every sweep appends a workspace `mentions-YYYY-MM-DD.md` ledger using the owner's
local date. Real, inspected links and concise summaries are retained; own posts,
owned URLs, spam, bots, unverified evidence and syndicated duplicates are dropped.
Quiet sweeps stay silent; unavailable sources are recorded as incomplete coverage.

## Verification

`src/trunks/mention-monitor.test.ts` replays a historical Hacker News comment
fixture through the shipped helper and the real scheduler with an injected
recorded-evidence runner. It checks disabled creation, explicit test enable,
filtering, quiet/partial coverage, and ledger writes. The Gateway handler test
checks template persona and skill installation. This deterministic replay does
not claim a live model completed an interview or searched every social source.

The helper never opens network connections or sends messages. Source inspection
and classification belong to the agent; the helper validates/filter records and
writes the ledger. Changing a boolean to `verified` is not proof of a live page.
