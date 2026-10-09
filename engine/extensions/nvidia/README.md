# NVIDIA

Use NVIDIA-hosted models through NVIDIA's OpenAI-compatible API. Branch Agent provides
model setup and a catalog of supported chat models, including available
NVIDIA and third-party models.

## Get started

Create an NVIDIA API key and run:

```bash
branch onboard --auth-choice nvidia-api-key
```

You can also supply `NVIDIA_API_KEY` in the Gateway's environment. Browse models
with `branch models list --provider nvidia` and select an available model for
your agent.

This plugin calls NVIDIA's hosted service; it does not install local GPU models.
Catalog entries and supported inputs depend on NVIDIA's current inventory.

See the [NVIDIA guide](https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/providers/nvidia) for authentication
and model selection.
