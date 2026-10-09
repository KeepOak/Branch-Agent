# @branch/comfy-provider

Official ComfyUI image, video, and music generation provider plugin for
Branch Agent.

## Install

```bash
branch plugins install @branch/comfy-provider
branch gateway restart
```

## Configure

Local ComfyUI workflows do not require credentials. Comfy Cloud workflows use
`COMFY_API_KEY` or `COMFY_CLOUD_API_KEY`.

Full workflow, model, and provider configuration:

- https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/providers/comfy

## Package

- Plugin id: `comfy`
- Package: `@branch/comfy-provider`
- Minimum Branch Agent host: `2026.7.2`
