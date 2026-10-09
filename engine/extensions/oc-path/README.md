# OC Path

Inspect or edit a specific value inside a workspace file using an `oc://`
address. The plugin adds `branch path` commands for Markdown, JSON/JSONC,
JSONL, and YAML files, with operations to resolve, find, validate, and edit
their contents.

## Get started

Enable the plugin and inspect the command reference:

```bash
branch plugins enable oc-path
branch path --help
```

Use `set --dry-run` to review an edit before applying it. Commands run locally
on the CLI host and do not require a running Gateway.

This is a file-editing interface; it does not replace higher-level configuration
or memory management.

See the [OC Path guide](https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/plugins/oc-path) for addressing
syntax and worked examples.
