# OpenRouter

Access models from multiple providers through an OpenRouter account. Alongside
chat models, the plugin supports audio transcription, speech output, and image,
music, and video generation through Branch Agent's media features.

## Get started

Sign in or add an API key:

```bash
branch models auth login --provider openrouter
```

The Gateway also accepts `OPENROUTER_API_KEY`. Browse chat models with
`branch models list --provider openrouter`, then choose your agent's model.
Media and speech settings can select different models from chat.

Tool use, inputs, and output formats depend on the selected model and upstream
provider. See the [OpenRouter guide](https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/providers/openrouter)
for setup and routing options.
