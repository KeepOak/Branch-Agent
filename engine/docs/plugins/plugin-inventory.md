---
summary: "Generated inventory of Branch Agent plugins shipped in core, published externally, or kept source-only"
read_when:
  - You are deciding whether a plugin ships in the core npm package or installs separately
  - You are updating bundled plugin package metadata or release automation
  - You need the canonical internal vs external plugin list
title: "Plugin inventory"
---

<!-- Generated file. Do not edit by hand.
Run `pnpm plugins:inventory:gen` to rebuild it. -->

This page lists every Branch Agent plugin with its package, install route, and
description. Operators use it to find a plugin and to see whether that plugin
needs a separate install. Maintainers use it to check bundled plugin metadata
and release automation.

## Definitions

- **Core npm package:** built into the `branch` npm package and available without a separate plugin install.
- **Official external package:** Branch-maintained plugin omitted from the core npm package, kept in this official inventory, and installed on demand through Seedbank and/or npm.
- **Source checkout only:** repo-local plugin omitted from published npm artifacts and not advertised as an installable package.

Source checkouts are different from npm installs: after `pnpm install`, bundled
plugins load from `extensions/<id>` so local edits and package-local workspace
dependencies are available.

## Install a plugin

Use the install route in each entry to decide whether install is needed. Plugins
that say `included in Branch Agent` are already present in the core package.
Official external packages need one install. Installation applies to the running
local Gateway without restarting it; start the Gateway if it was stopped.

For example, Discord is an official external package:

```bash
branch plugins install @branch/discord
branch plugins inspect discord --runtime --json
```

Ordinary bare package specs install from npm. Use `clawhub:@branch/discord`
or `npm:@branch/discord` when you need an explicit source. After install,
follow the plugin's setup doc, such as [Discord](/channels/discord), to add
credentials and channel config. See
[Manage plugins](/plugins/manage-plugins) for update, uninstall, and publishing
commands.

Each entry lists the package, distribution route, and description.

## Core npm package

65 plugins

- **[a2a](/plugins/reference/a2a)** (`@branch/a2a`) - included in Branch Agent. A2A v1.0 Agent-to-Agent protocol channel plugin.

- **[active-memory](/plugins/reference/active-memory)** (`branch`) - included in Branch Agent. Runs bounded pre-reply memory retrieval and implements per-agent Remember across conversations for eligible private conversations.

- **[admin-http-rpc](/plugins/reference/admin-http-rpc)** (`@branch/admin-http-rpc`) - included in Branch Agent. Branch Agent admin HTTP RPC endpoint.

- **[agentsapi](/plugins/reference/agentsapi)** (`@branch/agentsapi`) - included in Branch Agent. OpenAI Agents API harness with hosted or self-hosted sessions.

- **[alibaba](/plugins/reference/alibaba)** (`@branch/alibaba-provider`) - included in Branch Agent. Adds video generation provider support.

- **[anthropic](/plugins/reference/anthropic)** (`@branch/anthropic-provider`) - included in Branch Agent. Anthropic models, Claude CLI, and native Claude session catalog.

- **[apple-fm](/plugins/reference/apple-fm)** (`@branch/apple-fm-provider`) - included in Branch Agent. On-device Apple Intelligence inference for lightweight setup and short tasks.

- **[azure-speech](/plugins/reference/azure-speech)** (`@branch/azure-speech`) - included in Branch Agent. Azure AI Speech text-to-speech (MP3, native Ogg/Opus voice notes, PCM telephony).

- **[beam](/plugins/reference/beam)** (`@branch/beam`) - included in Branch Agent. Read-only coding-session Beam receiver.

- **[bonjour](/plugins/reference/bonjour)** (`@branch/bonjour`) - included in Branch Agent. Advertise the local Branch Agent gateway over Bonjour/mDNS.

- **[browser](/plugins/reference/browser)** (`@branch/browser-plugin`) - included in Branch Agent. Adds agent-callable tools.

- **[canvas](/plugins/reference/canvas)** (`@branch/canvas-plugin`) - included in Branch Agent. Presents hosted widget documents on paired macOS panels.

- **[clawrouter](/plugins/reference/clawrouter)** (`@branch/clawrouter`) - included in Branch Agent. Adds Rootway model provider support to Branch Agent.

- **[cloudflare](/plugins/reference/cloudflare)** (`@branch/cloudflare`) - included in Branch Agent, and also from npm or Seedbank: `clawhub:@branch/cloudflare`. Cloudflare R2 storage for named Branch Agent storage locations.

- **[code-mode-quickjs](/plugins/reference/code-mode-quickjs)** (`@branch/code-mode-quickjs`) - included in Branch Agent. Hardened JavaScript execution for Code Mode using QuickJS in WebAssembly.

- **[copilot-proxy](/plugins/reference/copilot-proxy)** (`@branch/copilot-proxy`) - included in Branch Agent. Adds Copilot Proxy model provider support to Branch Agent.

- **[crabbox](/plugins/reference/crabbox)** (`@branch/crabbox-provider`) - included in Branch Agent. Cloud worker provider and lease-backed sandbox backend for the Cuttings CLI.

- **[cua-computer](/plugins/reference/cua-computer)** (`@branch/cua-computer`) - included in Branch Agent. Experimental CUA Driver computer control for macOS, Windows, and Linux node hosts.

- **[deepgram](/plugins/reference/deepgram)** (`@branch/deepgram-provider`) - included in Branch Agent. Deepgram audio transcription with Nova and Flux models, plus realtime speech recognition.

- **[device-pair](/plugins/reference/device-pair)** (`branch`) - included in Branch Agent. Generate setup codes and approve device pairing requests.

- **[document-extract](/plugins/reference/document-extract)** (`@branch/document-extract-plugin`) - included in Branch Agent. Extract text and fallback page images from local document attachments.

- **[elevenlabs](/plugins/reference/elevenlabs)** (`@branch/elevenlabs-speech`) - included in Branch Agent. Adds media understanding provider support. Adds realtime transcription provider support. Adds text-to-speech provider support.

- **[fal](/plugins/reference/fal)** (`@branch/fal-provider`) - included in Branch Agent. Adds fal model provider support to Branch Agent.

- **[file-transfer](/plugins/reference/file-transfer)** (`@branch/file-transfer`) - included in Branch Agent. Fetch, list, and write files on paired nodes via dedicated node commands. Bypasses bash stdout truncation by using base64 over node.invoke for binaries up to 16 MB.

- **[geolocation](/plugins/reference/geolocation)** (`@branch/geolocation-plugin`) - included in Branch Agent. Resolves client IP addresses to a coarse city using a locally cached IP-geolocation database.

- **[github](/plugins/reference/github)** (`@branch/github`) - included in Branch Agent. Public GitHub link previews and document reader.

- **[github-copilot](/plugins/reference/github-copilot)** (`@branch/github-copilot-provider`) - included in Branch Agent. Adds GitHub Copilot model provider support to Branch Agent.

- **[google](/plugins/reference/google)** (`@branch/google-plugin`) - included in Branch Agent. Adds Google, Google Gemini CLI, Google Vertex model provider support to Branch Agent.

- **[huggingface](/plugins/reference/huggingface)** (`@branch/huggingface-provider`) - included in Branch Agent. Adds Hugging Face model provider support to Branch Agent.

- **[imap](/plugins/reference/imap)** (`@branch/imap`) - included in Branch Agent. Watch IMAP mailboxes and dispatch authenticated incoming email to isolated agent sessions.

- **[kie](/plugins/reference/kie)** (`@branch/kie-provider`) - included in Branch Agent. Adds Kie model provider support to Branch Agent.

- **[linux-node](/plugins/reference/linux-node)** (`@branch/linux-node`) - included in Branch Agent. Desktop notifications, camera capture, and location for Linux node hosts.

- **[litellm](/plugins/reference/litellm)** (`@branch/litellm-provider`) - included in Branch Agent. Adds LiteLLM model provider support to Branch Agent.

- **[llm-task](/plugins/reference/llm-task)** (`@branch/llm-task`) - included in Branch Agent. Generic JSON-only LLM tool for structured tasks callable from workflows.

- **[lmstudio](/plugins/reference/lmstudio)** (`@branch/lmstudio-provider`) - included in Branch Agent. Adds LM Studio model provider support to Branch Agent.

- **[logbook](/plugins/reference/logbook)** (`@branch/logbook`) - included in Branch Agent. Automatic work journal: captures periodic screen snapshots from a paired node and turns them into a reviewable timeline of your day.

- **[memory-core](/plugins/reference/memory-core)** (`@branch/memory-core`) - included in Branch Agent. Adds agent-callable tools.

- **[memory-wiki](/plugins/reference/memory-wiki)** (`@branch/memory-wiki`) - included in Branch Agent. Persistent wiki compiler and Obsidian-friendly knowledge vault for Branch Agent.

- **[microsoft](/plugins/reference/microsoft)** (`@branch/microsoft-speech`) - included in Branch Agent. Adds text-to-speech provider support.

- **[microsoft-foundry](/plugins/reference/microsoft-foundry)** (`@branch/microsoft-foundry`) - included in Branch Agent. Adds Microsoft Foundry model provider support to Branch Agent.

- **[migrate-claude](/plugins/reference/migrate-claude)** (`@branch/migrate-claude`) - included in Branch Agent. Imports Claude Code and Claude Desktop instructions, MCP servers, skills, and safe configuration into Branch Agent.

- **[migrate-hermes](/plugins/reference/migrate-hermes)** (`@branch/migrate-hermes`) - included in Branch Agent. Imports Hermes configuration, memories, skills, and supported credentials into Branch Agent.

- **[minimax](/plugins/reference/minimax)** (`@branch/minimax-provider`) - included in Branch Agent. Adds MiniMax, MiniMax Portal model provider support to Branch Agent.

- **[nvidia](/plugins/reference/nvidia)** (`@branch/nvidia-provider`) - included in Branch Agent. Adds NVIDIA model provider support to Branch Agent.

- **[oc-path](/plugins/reference/oc-path)** (`@branch/oc-path`) - included in Branch Agent. Adds the branch path CLI for oc:// workspace file addressing.

- **[ollama](/plugins/reference/ollama)** (`@branch/ollama-provider`) - included in Branch Agent. Adds Ollama, Ollama Cloud model provider support to Branch Agent.

- **[onepassword](/plugins/reference/onepassword)** (`@branch/onepassword`) - included in Branch Agent. 1Password SecretRef resolver and curated agent broker with approval policy and SQLite audit history.

- **[openai](/plugins/reference/openai)** (`@branch/openai-provider`) - included in Branch Agent. Adds OpenAI model provider support to Branch Agent.

- **[opencode-go](/plugins/reference/opencode-go)** (`@branch/opencode-go-provider`) - included in Branch Agent. Adds OpenCode Go model provider support to Branch Agent.

- **[openrouter](/plugins/reference/openrouter)** (`@branch/openrouter-provider`) - included in Branch Agent. Adds OpenRouter model provider support to Branch Agent.

- **[policy](/plugins/reference/policy)** (`@branch/policy`) - included in Branch Agent. Adds policy-backed doctor checks for workspace conformance.

- **[reef](/plugins/reference/reef)** (`@branch/reef`) - included in Branch Agent. Guarded end-to-end encrypted grove channel.

- **[runway](/plugins/reference/runway)** (`@branch/runway-provider`) - included in Branch Agent. Adds video generation provider support.

- **[senseaudio](/plugins/reference/senseaudio)** (`@branch/senseaudio-provider`) - included in Branch Agent. Adds media understanding provider support.

- **[session-share](/plugins/reference/session-share)** (`@branch/session-share`) - included in Branch Agent. Read-only Branch Agent sessions on paired gateways.

- **[sglang](/plugins/reference/sglang)** (`@branch/sglang-provider`) - included in Branch Agent. Adds SGLang model provider support to Branch Agent.

- **[talk-voice](/plugins/reference/talk-voice)** (`branch`) - included in Branch Agent. Manage Talk voice selection (list/set).

- **[telegram](/plugins/reference/telegram)** (`@branch/telegram`) - included in Branch Agent. Branch Agent Telegram channel plugin.

- **[together](/plugins/reference/together)** (`@branch/together-provider`) - included in Branch Agent. Adds Together model provider support to Branch Agent.

- **[tts-local-cli](/plugins/reference/tts-local-cli)** (`@branch/tts-local-cli`) - included in Branch Agent. Adds text-to-speech provider support.

- **[vault](/plugins/reference/vault)** (`@branch/vault`) - included in Branch Agent. HashiCorp Vault SecretRef provider integration.

- **[vllm](/plugins/reference/vllm)** (`@branch/vllm-provider`) - included in Branch Agent. Adds vLLM model provider support to Branch Agent.

- **[web-readability](/plugins/reference/web-readability)** (`@branch/web-readability-plugin`) - included in Branch Agent. Extract readable article content from local HTML web fetch responses.

- **[canopy](/plugins/reference/canopy)** (`@branch/canopy`) - included in Branch Agent. Dashboard canopy for agent-owned issues and sessions.

- **[xai](/plugins/reference/xai)** (`@branch/xai-plugin`) - included in Branch Agent. Adds xAI model provider support to Branch Agent.

## Official external packages

96 plugins

- **[acpx](/plugins/reference/acpx)** (`@branch/acpx`) - npm or Seedbank: `clawhub:@branch/acpx`. Branch Agent ACP runtime backend with plugin-owned session and transport management.

- **[amazon-bedrock](/plugins/reference/amazon-bedrock)** (`@branch/amazon-bedrock-provider`) - npm or Seedbank: `clawhub:@branch/amazon-bedrock-provider`. Branch Agent Amazon Bedrock provider plugin with model discovery, embeddings, and guardrail support.

- **[amazon-bedrock-mantle](/plugins/reference/amazon-bedrock-mantle)** (`@branch/amazon-bedrock-mantle-provider`) - npm or Seedbank: `clawhub:@branch/amazon-bedrock-mantle-provider`. Branch Agent Amazon Bedrock Mantle provider plugin for OpenAI-compatible model routing.

- **[anthropic-vertex](/plugins/reference/anthropic-vertex)** (`@branch/anthropic-vertex-provider`) - npm or Seedbank: `clawhub:@branch/anthropic-vertex-provider`. Branch Agent Anthropic Vertex provider plugin for Claude models on Google Vertex AI.

- **[arcee](/plugins/reference/arcee)** (`@branch/arcee-provider`) - npm or Seedbank: `clawhub:@branch/arcee-provider`. Adds Arcee model provider support to Branch Agent.

- **[baseten](/plugins/reference/baseten)** (`@branch/baseten-provider`) - npm or Seedbank: `clawhub:@branch/baseten-provider`. Branch Agent Baseten provider plugin.

- **[brave](/plugins/reference/brave)** (`@branch/brave-plugin`) - npm or Seedbank: `clawhub:@branch/brave-plugin`. Branch Agent Brave Search provider plugin for web search.

- **[buzz](/plugins/reference/buzz)** (`@branch/buzz`) - npm or Seedbank: `clawhub:@branch/buzz`. Connect Branch Agent agents to Buzz rooms.

- **[byteplus](/plugins/reference/byteplus)** (`@branch/byteplus-provider`) - npm or Seedbank: `clawhub:@branch/byteplus-provider`. Adds BytePlus, BytePlus Plan model provider support to Branch Agent.

- **[cerebras](/plugins/reference/cerebras)** (`@branch/cerebras-provider`) - npm or Seedbank: `clawhub:@branch/cerebras-provider`. Adds Cerebras model provider support to Branch Agent.

- **[chutes](/plugins/reference/chutes)** (`@branch/chutes-provider`) - npm or Seedbank: `clawhub:@branch/chutes-provider`. Adds Chutes model provider support to Branch Agent.

- **[clickclack](/plugins/reference/clickclack)** (`@branch/clickclack`) - npm or Seedbank: `clawhub:@branch/clickclack`. Branch Agent ClickClack channel plugin.

- **[cloudflare-ai-gateway](/plugins/reference/cloudflare-ai-gateway)** (`@branch/cloudflare-ai-gateway-provider`) - npm or Seedbank: `clawhub:@branch/cloudflare-ai-gateway-provider`. Adds Cloudflare AI Gateway model provider support to Branch Agent.

- **[codex](/plugins/reference/codex)** (`@branch/codex`) - npm or Seedbank: `clawhub:@branch/codex`. Codex app-server harness and native session catalog.

- **[cohere](/plugins/reference/cohere)** (`@branch/cohere-provider`) - npm or Seedbank: `clawhub:@branch/cohere-provider`. Branch Agent Cohere provider plugin.

- **[comfy](/plugins/reference/comfy)** (`@branch/comfy-provider`) - npm or Seedbank: `clawhub:@branch/comfy-provider`. Adds ComfyUI model provider support to Branch Agent.

- **[copilot](/plugins/reference/copilot)** (`@branch/copilot`) - npm or Seedbank: `clawhub:@branch/copilot`. Registers the GitHub Copilot agent runtime.

- **[deepinfra](/plugins/reference/deepinfra)** (`@branch/deepinfra-provider`) - npm or Seedbank: `clawhub:@branch/deepinfra-provider`. Adds DeepInfra model provider support to Branch Agent.

- **[deepseek](/plugins/reference/deepseek)** (`@branch/deepseek-provider`) - npm or Seedbank: `clawhub:@branch/deepseek-provider`. Adds DeepSeek model provider support to Branch Agent.

- **[diagnostics-otel](/plugins/reference/diagnostics-otel)** (`@branch/diagnostics-otel`) - npm or Seedbank: `clawhub:@branch/diagnostics-otel`. Branch Agent diagnostics OpenTelemetry exporter for metrics, traces, and logs.

- **[diagnostics-prometheus](/plugins/reference/diagnostics-prometheus)** (`@branch/diagnostics-prometheus`) - npm or Seedbank: `clawhub:@branch/diagnostics-prometheus`. Branch Agent diagnostics Prometheus exporter for runtime metrics.

- **[diffs](/plugins/reference/diffs)** (`@branch/diffs`) - npm or Seedbank: `clawhub:@branch/diffs`. Branch Agent read-only diff viewer plugin and file renderer for agents.

- **[diffs-language-pack](/plugins/reference/diffs-language-pack)** (`@branch/diffs-language-pack`) - npm or Seedbank: `clawhub:@branch/diffs-language-pack`. Adds syntax highlighting for languages outside the default diffs viewer set.

- **[discord](/plugins/reference/discord)** (`@branch/discord`) - npm or Seedbank: `clawhub:@branch/discord`. Branch Agent Discord channel plugin for channels, DMs, commands, and app events.

- **[duckduckgo](/plugins/reference/duckduckgo)** (`@branch/duckduckgo-plugin`) - npm or Seedbank: `clawhub:@branch/duckduckgo-plugin`. Adds web search provider support.

- **[exa](/plugins/reference/exa)** (`@branch/exa-plugin`) - npm or Seedbank: `clawhub:@branch/exa-plugin`. Adds web search provider support.

- **[facetime](/plugins/reference/facetime)** (`@branch/facetime`) - npm or Seedbank: `clawhub:@branch/facetime`. Experimental FaceTime realtime voice carrier for Branch Agent agents.

- **[featherless](/plugins/reference/featherless)** (`@branch/featherless-provider`) - npm or Seedbank: `clawhub:@branch/featherless-provider`. Branch Agent Featherless AI provider plugin.

- **[feishu](/plugins/reference/feishu)** (`@branch/feishu`) - npm or Seedbank: `clawhub:@branch/feishu`. Branch Agent Feishu/Lark channel plugin for chats and workplace tools (community maintained by @m1heng).

- **[firecrawl](/plugins/reference/firecrawl)** (`@branch/firecrawl-plugin`) - npm or Seedbank: `clawhub:@branch/firecrawl-plugin`. Adds agent-callable tools. Adds web fetch provider support. Adds web search provider support.

- **[fireworks](/plugins/reference/fireworks)** (`@branch/fireworks-provider`) - npm or Seedbank: `clawhub:@branch/fireworks-provider`. Adds Fireworks model provider support to Branch Agent.

- **[fish-audio-speech](/plugins/reference/fish-audio-speech)** (`@branch/fish-audio-speech`) - npm or Seedbank: `clawhub:@branch/fish-audio-speech`. Fish Audio S2.1 hosted text-to-speech with streaming, voice notes, and telephony output.

- **[gmi](/plugins/reference/gmi)** (`@branch/gmi-provider`) - npm or Seedbank: `clawhub:@branch/gmi-provider`. Branch Agent GMI Cloud provider plugin.

- **[google-meet](/plugins/reference/google-meet)** (`@branch/google-meet`) - npm or Seedbank: `clawhub:@branch/google-meet`. Branch Agent Google Meet participant plugin for joining calls through Chrome or Twilio transports.

- **[googlechat](/plugins/reference/googlechat)** (`@branch/googlechat`) - npm or Seedbank: `clawhub:@branch/googlechat`. Branch Agent Google Chat channel plugin for spaces and direct messages.

- **[gradium](/plugins/reference/gradium)** (`@branch/gradium-speech`) - npm or Seedbank: `clawhub:@branch/gradium-speech`. Adds text-to-speech provider support.

- **[groq](/plugins/reference/groq)** (`@branch/groq-provider`) - npm or Seedbank: `clawhub:@branch/groq-provider`. Adds Groq model provider support to Branch Agent.

- **[imessage](/plugins/reference/imessage)** (`@branch/imessage`) - npm or Seedbank: `clawhub:@branch/imessage`. Branch Agent iMessage channel plugin using imsg on a signed-in Mac.

- **[inworld](/plugins/reference/inworld)** (`@branch/inworld-speech`) - npm or Seedbank: `clawhub:@branch/inworld-speech`. Inworld streaming text-to-speech (MP3, OGG_OPUS, PCM telephony).

- **[irc](/plugins/reference/irc)** (`@branch/irc`) - npm or Seedbank: `clawhub:@branch/irc`. Branch Agent IRC channel plugin.

- **[kilocode](/plugins/reference/kilocode)** (`@branch/kilocode-provider`) - npm or Seedbank: `clawhub:@branch/kilocode-provider`. Adds Kilocode model provider support to Branch Agent.

- **[kimi](/plugins/reference/kimi)** (`@branch/kimi-provider`) - npm or Seedbank: `clawhub:@branch/kimi-provider`. Adds Kimi, Kimi Code, Kimi Coding model provider support to Branch Agent.

- **[line](/plugins/reference/line)** (`@branch/line`) - npm or Seedbank: `clawhub:@branch/line`. Branch Agent LINE channel plugin for LINE Bot API chats.

- **[llama-cpp](/plugins/reference/llama-cpp)** (`@branch/llama-cpp-provider`) - npm or Seedbank: `clawhub:@branch/llama-cpp-provider`. Managed and external llama.cpp servers for GGUF chat and embeddings.

- **[trellis](/plugins/reference/trellis)** (`@branch/trellis`) - npm or Seedbank: `clawhub:@branch/trellis`. Trellis workflow tool plugin for typed pipelines and resumable approvals.

- **[longcat](/plugins/reference/longcat)** (`@branch/longcat-provider`) - npm or Seedbank: `clawhub:@branch/longcat-provider`. Branch Agent LongCat provider plugin.

- **[matrix](/plugins/reference/matrix)** (`@branch/matrix`) - npm or Seedbank: `clawhub:@branch/matrix`. Branch Agent Matrix channel plugin for rooms and direct messages.

- **[mattermost](/plugins/reference/mattermost)** (`@branch/mattermost`) - npm or Seedbank: `clawhub:@branch/mattermost`. Branch Agent Mattermost channel plugin.

- **[memory-lancedb](/plugins/reference/memory-lancedb)** (`@branch/memory-lancedb`) - npm or Seedbank: `clawhub:@branch/memory-lancedb`. Branch Agent LanceDB-backed long-term memory plugin with auto-recall, auto-capture, and vector search.

- **[meta](/plugins/reference/meta)** (`@branch/meta-provider`) - npm or Seedbank: `clawhub:@branch/meta-provider`. Adds Meta model provider support to Branch Agent.

- **[mistral](/plugins/reference/mistral)** (`@branch/mistral-provider`) - npm or Seedbank: `clawhub:@branch/mistral-provider`. Adds Mistral model provider support to Branch Agent.

- **[moonshot](/plugins/reference/moonshot)** (`@branch/moonshot-provider`) - npm or Seedbank: `clawhub:@branch/moonshot-provider`. Adds Moonshot model provider support to Branch Agent.

- **[msteams](/plugins/reference/msteams)** (`@branch/msteams`) - npm or Seedbank: `clawhub:@branch/msteams`. Branch Agent Microsoft Teams channel plugin for bot conversations.

- **[mxc](/plugins/reference/mxc)** (`@branch/mxc-sandbox`) - npm or Seedbank: `clawhub:@branch/mxc-sandbox`. OS-level sandboxed tool execution via MXC: runs commands in a Windows ProcessContainer with configured MXC policy files.

- **[nextcloud-talk](/plugins/reference/nextcloud-talk)** (`@branch/nextcloud-talk`) - npm or Seedbank: `clawhub:@branch/nextcloud-talk`. Branch Agent Nextcloud Talk channel plugin for conversations.

- **[nostr](/plugins/reference/nostr)** (`@branch/nostr`) - npm or Seedbank: `clawhub:@branch/nostr`. Branch Agent Nostr channel plugin for NIP-04 encrypted direct messages.

- **[novita](/plugins/reference/novita)** (`@branch/novita-provider`) - npm or Seedbank: `clawhub:@branch/novita-provider`. Adds Novita, Novita AI, Novitaai model provider support to Branch Agent.

- **[onnx](/plugins/reference/onnx)** (`@branch/onnx`) - npm or Seedbank: `clawhub:@branch/onnx`. Local typed decisions using pinned ONNX classifiers.

- **[opencode](/plugins/reference/opencode)** (`@branch/opencode-provider`) - npm or Seedbank: `clawhub:@branch/opencode-provider`. Adds OpenCode model provider support to Branch Agent.

- **[openshell](/plugins/reference/openshell)** (`@branch/openshell-sandbox`) - npm or Seedbank: `clawhub:@branch/openshell-sandbox`. Branch Agent sandbox backend for the NVIDIA OpenShell CLI with mirrored local workspaces and SSH command execution.

- **[parallel](/tools/parallel-search)** (`@branch/parallel-plugin`) - npm or Seedbank: `clawhub:@branch/parallel-plugin`. Adds web search provider support.

- **[perplexity](/plugins/reference/perplexity)** (`@branch/perplexity-plugin`) - npm or Seedbank: `clawhub:@branch/perplexity-plugin`. Adds web search provider support.

- **[pixverse](/plugins/reference/pixverse)** (`@branch/pixverse-provider`) - npm or Seedbank: `clawhub:@branch/pixverse-provider`. Branch Agent PixVerse video generation provider plugin.

- **[qianfan](/plugins/reference/qianfan)** (`@branch/qianfan-provider`) - npm or Seedbank: `clawhub:@branch/qianfan-provider`. Adds Qianfan model provider support to Branch Agent.

- **[qqbot](/plugins/reference/qqbot)** (`@tencent-connect/branch-qqbot`) - npm. Branch Agent QQ Bot channel plugin for group and direct-message workflows.

- **[qwen](/plugins/reference/qwen)** (`@branch/qwen-provider`) - npm or Seedbank: `clawhub:@branch/qwen-provider`. Adds Qwen, Qwen Cloud, Model Studio, DashScope, Qwen Token Plan, Bailian Token Plan model provider support to Branch Agent.

- **[radius](/plugins/reference/radius)** (`@branch/radius-provider`) - npm or Seedbank: `clawhub:@branch/radius-provider`. Radius model gateway provider.

- **[raft](/plugins/reference/raft)** (`@branch/raft`) - npm or Seedbank: `clawhub:@branch/raft`. Branch Agent Raft channel plugin for secure CLI wake bridges.

- **[searxng](/plugins/reference/searxng)** (`@branch/searxng-plugin`) - npm or Seedbank: `clawhub:@branch/searxng-plugin`. Adds web search provider support.

- **[signal](/plugins/reference/signal)** (`@branch/signal`) - npm or Seedbank: `clawhub:@branch/signal`. Branch Agent Signal channel plugin.

- **[slack](/plugins/reference/slack)** (`@branch/slack`) - npm or Seedbank: `clawhub:@branch/slack`. Branch Agent Slack channel plugin for channels, DMs, commands, and app events.

- **[slack-huddles](/plugins/reference/slack-huddles)** (`@branch/slack-huddles`) - npm or Seedbank: `clawhub:@branch/slack-huddles`. Join Slack huddles through a dedicated Slack user in Chrome.

- **[sms](/plugins/reference/sms)** (`@branch/sms`) - npm or Seedbank: `clawhub:@branch/sms`. Twilio SMS/MMS channel plugin for Branch Agent messages.

- **[stepfun](/plugins/reference/stepfun)** (`@branch/stepfun-provider`) - npm or Seedbank: `clawhub:@branch/stepfun-provider`. Adds StepFun, StepFun Plan model provider support to Branch Agent.

- **[synology-chat](/plugins/reference/synology-chat)** (`@branch/synology-chat`) - npm or Seedbank: `clawhub:@branch/synology-chat`. Synology Chat channel plugin for Branch Agent channels and direct messages.

- **[synthetic](/plugins/reference/synthetic)** (`@branch/synthetic-provider`) - npm or Seedbank: `clawhub:@branch/synthetic-provider`. Adds Synthetic model provider support to Branch Agent.

- **[tavily](/plugins/reference/tavily)** (`@branch/tavily-plugin`) - npm or Seedbank: `clawhub:@branch/tavily-plugin`. Adds agent-callable tools. Adds web search provider support.

- **[team-reports](/plugins/reference/team-reports)** (`@branch/team-reports`) - npm or Seedbank: `clawhub:@branch/team-reports`. Daily, weekly, and monthly team activity reports from GitHub and Discord, with model-written summaries, served in the Control UI.

- **[teams-meetings](/plugins/reference/teams-meetings)** (`@branch/teams-meetings`) - npm or Seedbank: `clawhub:@branch/teams-meetings`. Join Microsoft Teams meetings as a Chrome browser guest.

- **[tencent](/plugins/reference/tencent)** (`@branch/tencent-provider`) - npm or Seedbank: `clawhub:@branch/tencent-provider`. Adds Tencent TokenHub, Tencent Tokenplan model provider support to Branch Agent.

- **[tlon](/plugins/reference/tlon)** (`@branch/tlon`) - npm or Seedbank: `clawhub:@branch/tlon`. Branch Agent Tlon/Urbit channel plugin for chat workflows.

- **[tokenjuice](/plugins/reference/tokenjuice)** (`@branch/tokenjuice`) - npm or Seedbank: `clawhub:@branch/tokenjuice`. Compacts exec and bash tool results with tokenjuice reducers.

- **[twitch](/plugins/reference/twitch)** (`@branch/twitch`) - npm or Seedbank: `clawhub:@branch/twitch`. Branch Agent Twitch channel plugin for chat and moderation workflows.

- **[typesafe](/plugins/reference/typesafe)** (`@branch/typesafe`) - npm or Seedbank: `clawhub:@branch/typesafe`. Typed decision provider for hosted Jev and local System One models.

- **[venice](/plugins/reference/venice)** (`@branch/venice-provider`) - npm or Seedbank: `clawhub:@branch/venice-provider`. Adds Venice model provider support to Branch Agent.

- **[vercel-ai-gateway](/plugins/reference/vercel-ai-gateway)** (`@branch/vercel-ai-gateway-provider`) - npm or Seedbank: `clawhub:@branch/vercel-ai-gateway-provider`. Adds Vercel AI Gateway model provider support to Branch Agent.

- **[voice-call](/plugins/reference/voice-call)** (`@branch/voice-call`) - npm or Seedbank: `clawhub:@branch/voice-call`. Branch Agent voice-call plugin for Twilio, Telnyx, and Plivo phone calls.

- **[volcengine](/plugins/reference/volcengine)** (`@branch/volcengine-provider`) - npm or Seedbank: `clawhub:@branch/volcengine-provider`. Adds Volcengine, Volcengine Plan model provider support to Branch Agent.

- **[voyage](/plugins/reference/voyage)** (`@branch/voyage-provider`) - npm or Seedbank: `clawhub:@branch/voyage-provider`. Adds embedding provider support, including memory search.

- **[vydra](/plugins/reference/vydra)** (`@branch/vydra-provider`) - npm or Seedbank: `clawhub:@branch/vydra-provider`. Adds Vydra model provider support to Branch Agent.

- **[whatsapp](/plugins/reference/whatsapp)** (`@branch/whatsapp`) - npm or Seedbank: `clawhub:@branch/whatsapp`. Branch Agent WhatsApp channel plugin for WhatsApp Web chats.

- **[xiaomi](/plugins/reference/xiaomi)** (`@branch/xiaomi-provider`) - npm or Seedbank: `clawhub:@branch/xiaomi-provider`. Adds Xiaomi, Xiaomi Token Plan model provider support to Branch Agent.

- **[zai](/plugins/reference/zai)** (`@branch/zai-provider`) - npm or Seedbank: `clawhub:@branch/zai-provider`. Adds Z.AI model provider support to Branch Agent.

- **[zalo](/plugins/reference/zalo)** (`@branch/zalo`) - npm or Seedbank: `clawhub:@branch/zalo`. Branch Agent Zalo channel plugin for bot and webhook chats.

- **[zalouser](/plugins/reference/zalouser)** (`@branch/zalouser`) - npm or Seedbank: `clawhub:@branch/zalouser`. Branch Agent Zalo Personal Account plugin via native zca-js integration.

- **[zoom-meetings](/plugins/reference/zoom-meetings)** (`@branch/zoom-meetings`) - npm or Seedbank: `clawhub:@branch/zoom-meetings`. Join Zoom meetings as a Chrome browser guest.

## Source checkout only

3 plugins

- **[qa-channel](/plugins/reference/qa-channel)** (`@branch/qa-channel`) - source checkout only. Branch Agent QA synthetic channel plugin.

- **[qa-lab](/plugins/reference/qa-lab)** (`@branch/qa-lab`) - source checkout only. Branch Agent QA lab plugin with private debugger UI and scenario runner.

- **[visitor-access](/plugins/reference/visitor-access)** (`@branch/visitor-access`) - source checkout only. Manage expiring visitor grants through one Cloudflare Access email policy.

## How this page is built

Branch Agent generates this page from the top-level
`extensions/*/branch.plugin.json` manifests and the root npm package
`files` exclusions. Optional `package.json` metadata enriches package and
distribution details. Regenerate the page with:

```bash
pnpm plugins:inventory:gen
```
