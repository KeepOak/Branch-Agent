# @branch/pixverse-provider

Official PixVerse video generation provider plugin for Branch Agent.

This plugin registers PixVerse as a `video_generate` provider for text-to-video and image-to-video workflows.

## Install

```bash
branch plugins install @branch/pixverse-provider
```

Restart the Gateway after installing or updating the plugin.

## Configure

Store your PixVerse API key in Branch Agent config or expose the supported environment variable to the Gateway. Then select PixVerse as a video generation provider.

Full setup and model/provider examples:

- https://docs.openclaw.ai/providers/pixverse

## Package

- Plugin id: `pixverse`
- Package: `@branch/pixverse-provider`
- Minimum Branch Agent host: `2026.5.26`
