---
summary: "How Branch Agent discovers Ollama models implicitly, plus narrow smoke tests"
read_when:
  - You want to know which models Branch Agent discovers and how
  - You need capability, reasoning, or cost detection rules
  - You want a narrow text or vision probe that skips the agent tool surface
title: "Ollama model discovery"
sidebarTitle: "Model discovery"
---

## Model discovery (implicit provider)

When `OLLAMA_API_KEY` (or an auth profile) is set and neither
`models.providers.ollama` nor another custom provider with `api: "ollama"` is
defined, Branch Agent discovers models from `http://127.0.0.1:11434`:

| Behavior             | Detail                                                                                                                                                                                                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalog query        | `/api/tags`                                                                                                                                                                                                                                                                                   |
| Capability detection | Best-effort `/api/show` reads `contextWindow`, `num_ctx` Modelfile parameters, and capabilities (vision/tools/thinking)                                                                                                                                                                       |
| Vision models        | A `vision` capability from `/api/show` marks the model image-capable (`input: ["text", "image"]`)                                                                                                                                                                                             |
| Reasoning detection  | Uses the `thinking` capability from `/api/show` when available; falls back to a name heuristic (`r1`, `reason`, `reasoning`, `think`) when Ollama omits capabilities. `glm-5.2:cloud` and `deepseek-v4-flash\|pro:cloud` are always treated as reasoning regardless of reported capabilities. |
| Token limits         | `maxTokens` defaults to Branch Agent's Ollama max-token cap                                                                                                                                                                                                                                       |
| Costs                | All costs are `0`                                                                                                                                                                                                                                                                             |

```bash
ollama list
branch models list
```

A **nonempty** `models.providers.ollama.models` list selects manual models and
skips discovery. When Ollama is in the agent's model scope, an explicit
self-hosted endpoint with `models: []` remains eligible for discovery;
`models.providers.ollama.apiKey` alone does not select that provider for Gateway
model browsing.

Failed discovery records an unavailable or catalog-authentication failure and
keeps the last successful inventory for the same endpoint and credentials. A
successful empty response clears discovered models. Manual models stay separate.

Hosted `https://ollama.com` entries skip discovery because Ollama Cloud models
are provider-managed. Without an explicit Ollama endpoint, a custom provider
with `api: "ollama"` and a non-loopback `baseUrl` suppresses ambient localhost
discovery; list that custom provider's models manually (see
[Configuration](/providers/ollama/configuration)). Loopback custom providers such as
`http://127.0.0.2:11434` keep ambient local discovery eligible.

You can use a full ref such as `ollama/<pulled-model>:latest` without a
hand-written `models.json` entry; Branch Agent resolves it live. For signed-in
hosts, selecting an unlisted `ollama/<model>:cloud` ref validates that exact
model with `/api/show` and adds it to the runtime catalog only if Ollama
confirms metadata — typos still fail as unknown models.

### Smoke tests

For a narrow text probe that skips the full agent tool surface:

```bash
OLLAMA_API_KEY=ollama-local \
  branch infer model run \
    --local \
    --model ollama/llama3.2:latest \
    --prompt "Reply with exactly: pong" \
    --json
```

Add `--file` with an image for a lean vision-model probe (accepts PNG/JPEG/WebP;
non-image files are rejected before Ollama is called — use
`branch infer audio transcribe` for audio):

```bash
OLLAMA_API_KEY=ollama-local \
  branch infer model run \
    --local \
    --model ollama/qwen2.5vl:7b \
    --prompt "Describe this image in one sentence." \
    --file ./photo.jpg \
    --json
```

Neither path loads chat tools, memory, or session context. If it succeeds
while normal agent replies fail, the issue is likely the model's tool/agent
capacity, not the endpoint.

Selecting a model with `/model ollama/<model>` is an exact user choice: if the
configured `baseUrl` is unreachable, the next reply fails with the provider
error instead of silently falling back to another configured model.

Isolated cron jobs add one local safety check before starting the agent turn:
if the selected model resolves to a local/private-network/`.local` Ollama
provider and `/api/tags` is unreachable, Branch Agent records that run as
`skipped` with the model in the error text. This endpoint check is cached for
5 minutes per host, so repeated cron jobs against a stopped daemon do not all
launch failing requests.

Live verification. These are contributor commands: run them from a checkout of
the `openclaw/openclaw` repository with `pnpm install` already done, not from a
packaged CLI install.

```bash
BRANCH_LIVE_TEST=1 BRANCH_LIVE_OLLAMA=1 BRANCH_LIVE_OLLAMA_WEB_SEARCH=0 \
  pnpm test:live -- extensions/ollama/ollama.live.test.ts
```

For Ollama Cloud, point the same live test at the hosted endpoint (skips
embeddings by default; force with `BRANCH_LIVE_OLLAMA_EMBEDDINGS=1` since a
cloud key may not authorize `/api/embed`):

```bash
export OLLAMA_API_KEY='<your-ollama-cloud-api-key>'
BRANCH_LIVE_TEST=1 BRANCH_LIVE_OLLAMA=1 \
BRANCH_LIVE_OLLAMA_BASE_URL=https://ollama.com \
BRANCH_LIVE_OLLAMA_MODEL=glm-5.1:cloud \
BRANCH_LIVE_OLLAMA_WEB_SEARCH=1 \
pnpm test:live -- extensions/ollama/ollama.live.test.ts
```

To add a model, pull it and it is discovered automatically:

```bash
ollama pull mistral
```
