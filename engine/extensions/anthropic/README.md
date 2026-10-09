# Anthropic

Use Claude models in Branch Agent through the Anthropic API or an existing Claude
Code CLI login. The plugin also supports image and PDF understanding and
discovery of native Claude conversations.

## Get started

Run `branch onboard` and choose **Anthropic API key** or **Claude CLI**. API
access requires an Anthropic API key. The CLI route requires Claude Code to be
installed and signed in on the host running Branch Agent.

After setup, browse the available models with
`branch models list --provider anthropic`.

See the [Anthropic guide](https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/providers/anthropic) for
authentication, model selection, and native session discovery.
