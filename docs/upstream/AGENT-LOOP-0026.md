# AGENT-LOOP-0026 — partial

Source: `mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421`; the filtered clone HEAD matches the pin.

Copied the generate-to-stream adapter and adapted the v1/v2/v3 dispatch, prompt projection and event reducer to Branch's canonical provider protocol. `bindAiSdkModel` attaches the factory-backed runtime to a native model; adapter and tests are ported but no product caller in Branch engine yet uses it. The existing production LLM facade does not select the bound runtime. The factory receives Branch's guarded transport and resolved credentials. Managed-transport requirements remain enforced; Branch's admitted loop executes client tools. Provider-executed tools and non-native parts remain in provider metadata instead of being executed again.

The user authorized pinned dependencies and necessary adapters on retry. Added the upstream provider aliases at 1.1.3 / 2.0.3 / 3.0.14 and the upstream E2E OpenAI alias at 2.0.115 using repo pnpm. The lockfile retains only those dependency additions; frozen installation passes.

Both cited test files are ported: six generate-to-stream tests and all nine model-loop tests with their assertions. The latter uses the actual pinned OpenAI SDK encoder/decoder with a guarded fetch recording fixture instead of Mastra workers and its recorder. A test-only projection reads canonical structured JSON text events as the original suite's replayable object view; it validates the final object with the original schema. This verifies the Branch protocol adaptation; it does not claim to install Mastra's worker infrastructure. The `.e2e.test.ts` filename triggered unrelated managed-Gateway preparation before assertions, so the port is named `model.loop.harvest.test.ts` and runs in the self-contained named unit shard.

Additional Branch contract tests cover all three SDK majors in one runtime, native generate/stream events, cached-token accounting, lossless unknown content, provider/client tool ownership, missing finish events, abort cancellation, managed transport, resolved credentials and payload hooks. All three files are registered in the Harvest list. No UI changes; screenshots are not applicable.

Validation: `cd engine && CI=1 node scripts/run-vitest.mjs run packages/ai/src/aisdk/generate-to-stream.test.ts packages/ai/src/aisdk/model.loop.harvest.test.ts packages/ai/src/aisdk/runtime.test.ts`. Targeted strict TypeScript includes every new file. Repository strict typecheck also passes.

Next: Wire product caller in production LLM facade to actually use the binding.
