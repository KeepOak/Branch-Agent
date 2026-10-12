---
summary: "Cloud worker provider and lease-backed sandbox backend for the Cuttings CLI."
read_when:
  - You are installing, configuring, or auditing the crabbox plugin
title: "Cuttings plugin reference"
---

<!-- Generated file. Do not edit by hand.
Run `pnpm plugins:inventory:gen` to rebuild it. Hand-written text survives only
between the branch-plugin-reference:manual-start and
branch-plugin-reference:manual-end comment markers. -->

Cloud worker provider and lease-backed sandbox backend for the Cuttings CLI.

## Distribution

- Package: `@branch/crabbox-provider`
- Install route: included in Branch Agent

## Surface

- CLI commands: `branch crabbox`
- Contracts: `tools`, `workerProviders`
- Skills

<!-- branch-plugin-reference:manual-start -->

## Configure

See [Cloud worker environments](/gateway/config-cloud-workers#crabbox-profile) for the profile schema and lifecycle notes.

Forward Gateway environment variables to an operator-provided setup script by listing their names in the Cuttings profile settings:

```json5 validate=false
{
  setup: 'install-worker "$BRANCH_WORKER_ARTIFACT_TOKEN"',
  setupEnv: ["BRANCH_WORKER_ARTIFACT_TOKEN"],
}
```

`setupEnv` explicitly forwards up to 16 unique environment variable names to the setup command only. Values are read from the Gateway process environment and are never stored in the profile configuration. Missing variables fail before a machine is allocated.

<!-- branch-plugin-reference:manual-end -->
