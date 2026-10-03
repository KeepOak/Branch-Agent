# `@branch/ai`

Reusable model API contracts, provider adapters, and streaming primitives from
Branch Agent. The package supports isolated runtime instances; importing it does not
register providers globally.

```ts
import { createLlmRuntime } from "@branch/ai";
import { registerBuiltInApiProviders } from "@branch/ai/providers";

const runtime = createLlmRuntime();
registerBuiltInApiProviders(runtime.registry);
```

Provider-neutral contracts, validation, diagnostics, and event streams are
available from the package root and focused subpaths such as
`@branch/ai/event-stream`, `@branch/ai/transports`, and
`@branch/ai/validation`. No second Branch Agent runtime package is required.

Provider ids, credentials, model catalogs, retries, and failover remain
application concerns. Branch Agent supplies those policies around this package.
Host policy (request fetch guarding, secret redaction, strict-tool defaults,
provider plugin hooks, and diagnostics logging) can be injected with
`configureAiTransportHost`; the defaults are inert. Node callers that need
runtime-local policy can use `createNodeLlmRuntime`; it preserves that host across
provider work without replacing the process default. `createLlmRuntime` continues
to use the process-default host.

The explicit `@branch/ai/internal/anthropic`, `google-model-family`, `openai`,
`openai-completions-compat`, `openai-responses-payload-policy`, `retry-after`, `runtime`, `shared`, and
`tool-schema` subpaths exist for the Branch Agent application itself.
They carry no semver guarantee and can change or disappear in any release; do
not depend on them outside Branch Agent.
