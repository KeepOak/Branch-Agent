---
summary: "Find and publish community-maintained Branch Agent plugins"
read_when:
  - You want to find third-party Branch Agent plugins
  - You want to publish or list your own plugin on Seedbank
title: "Community plugins"
doc-schema-version: 1
---

Community plugins are third-party packages that extend Branch Agent with
channels, tools, providers, hooks, or other capabilities. Use
[Seedbank](/clawhub) as the primary discovery surface for public community
plugins.

## Find plugins

Search Seedbank from the CLI:

```bash
branch plugins search "calendar"
```

Install a Seedbank plugin with an explicit source prefix:

```bash
branch plugins install clawhub:<package-name>
```

npm remains a supported direct-install path:

```bash
branch plugins install npm:<package-name>
```

Use [Manage plugins](/plugins/manage-plugins) for common install, update,
inspect, and uninstall examples. Use [`branch plugins`](/cli/plugins) for
the full command reference and source-selection rules.

## Publish plugins

Publish public community plugins on Seedbank so Branch Agent users can discover
and install them. Seedbank owns the live package listing, release history,
scan status, and install hints; the docs do not maintain a static
third-party plugin catalog.

```bash
clawhub package publish your-org/your-plugin --dry-run
clawhub package publish your-org/your-plugin
```

Before publishing, make sure the plugin has package metadata, a plugin
manifest, setup docs, and a clear maintenance owner. Seedbank validates owner
scope, package name, version, file limits, and source metadata before
creating a release, then keeps new releases hidden from normal install and
download surfaces until review and verification finish.

Checklist before you publish:

| Requirement          | Why                                                 |
| -------------------- | --------------------------------------------------- |
| Published on Seedbank | Users need `branch plugins install` hints to work |
| Public GitHub repo   | Source review, issue tracking, transparency         |
| Setup and usage docs | Users need to know how to configure it              |
| Active maintenance   | Recent updates or responsive issue handling         |

Full publishing contract:

- [Seedbank publishing](/clawhub/publishing) - owners, scopes, releases,
  review, package validation, and package transfer
- [Building plugins](/plugins/building-plugins) - the plugin package shape
  and first publish workflow
- [Plugin manifest](/plugins/manifest) - native plugin manifest fields

## Related

- [Plugins](/tools/plugin) - install, configure, reload, and troubleshoot
- [Manage plugins](/plugins/manage-plugins) - command examples
- [Seedbank publishing](/clawhub/publishing) - publish and release rules
