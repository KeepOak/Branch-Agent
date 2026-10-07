# Bulk audit — 2026-10-07

## Scope and status

Measurement only. No runtime or window source was changed. The intended baseline is the NAS test copy (gateway `19700`, window `5700`) **after** the office-sprite fix. That baseline could not be measured: the NAS endpoints were unreachable from this Windows host and the available SSH identities were refused; the office-sprite fix [PR #438](https://github.com/KeepOak/Branch-Agent/pull/438) was still open at measurement time. The quantitative data below are from an isolated Windows scratch gateway and a local build of today's main. They are diagnostics, **not** NAS or post-fix performance claims. This document should remain draft until the NAS measurements are added.

Window source: `origin/main` `725e2905f`; scratch gateway source: its preceding main commit `8a82c40b1`. Scratch profiles used unique data folders and ports `19702`–`19704`; neither the installed desktop nor its data folder was modified. The installed packaged window was inspected read-only.

## Cold start

| Checkpoint | NAS post-fix | Local scratch diagnostic |
| --- | ---: | ---: |
| Window shown | Not measured | Not measured as an Electron window. Headless Chromium probes of the earlier `8a82c40b1` window build yielded 2,408 ms first paint in one connected run, 3,220 ms in a cold-ish run, and 700 ms in a warmed repeat. These are browser probes, not desktop startup or timings of the later `725e2905f` build. |
| Gateway ready | Not measured | 383,205 ms from the gateway's startup clock on an untraced, busy Windows run. `http.bound` was at 128,194 ms; readiness waited for plugins and sidecars. Not a representative latency estimate. |
| First Trunk message admitted | Not measured | Not measured from cold start. A post-ready `chat.send` trace was 72.9 ms, but does not answer the requested checkpoint. |

The top 20 **recorded startup phase spans** in that scratch run follow. They are sorted by duration, not a critical-path decomposition. Nested/overlapping spans and repeated config-validation calls are retained; broad parent summaries were omitted. Durations must not be added together. The process was under substantial host contention, so no row is a predicted optimization saving.

| Rank | Phase | Span (ms) |
| ---: | --- | ---: |
| 1 | `plugins.runtime-post-bind` | 175,362 |
| 2 | `sidecars.model-runtime` | 54,279 |
| 3 | `sidecars.reply-runtime` | 13,622 |
| 4 | `gateway.server-start-import` | 13,472 |
| 5 | `sidecars.main-session-recovery-scan` | 7,281 |
| 6 | `cli.command.config.snapshot.read.validate` (first) | 6,545 |
| 7 | `cli.command.config.snapshot.read.validate` (second) | 6,210 |
| 8 | `cli.bootstrap.admission.session-runtime-import` | 4,447 |
| 9 | `cli.bootstrap.admission.database-runtime-import` | 3,928 |
| 10 | `cli.bootstrap.admission.workspace-runtime-import` | 3,917 |
| 11 | `sidecars.plugin-services` | 3,409 |
| 12 | `cli.main.gateway-run-select-environment` | 2,846 |
| 13 | `plugins.bootstrap` | 2,844 |
| 14 | `state.ownership` | 2,819 |
| 15 | `sidecars.plugin-services.memory-core.memory-core-rings` | 2,771 |
| 16 | `entry.run-main-import` | 2,213 |
| 17 | `gateway.kernel-state` | 1,813 |
| 18 | `sessions.projection` | 1,642 |
| 19 | `gateway.shutdown-runtime-import` | 1,211 |
| 20 | `cli.bootstrap.admission.agent-inventory` | 1,020 |

The plugin-load portion reported 17 plugins, 42 gateway handlers, and 175,241 ms in this scratch run. Individual load spans were canvas 61,807 ms, ACPX 54,708 ms, Anthropic 18,337 ms, memory-core 10,403 ms, OpenAI 7,642 ms, CUA 5,110 ms, xAI 3,582 ms, Ollama 3,262 ms, and smaller plugins below 2,500 ms. A separate instrumented run gave materially different times (for example canvas 13,562 ms), so these spans identify investigation targets, not stable savings.

## What loads at boot

An ESM resolve hook snapshotted the **main gateway thread at readiness** with channels skipped: 6,850 unique module URLs, of which 6,808 were files totaling 59,781,172 on-disk bytes. That file set comprised 4,044 `engine/dist` files (43,081,536 bytes), 2,673 dependency files (15,276,431 bytes), 15 extension paths (121,702 bytes), and 76 other files (1,301,503 bytes). Across the gateway process and worker snapshots, the union was 7,253 URLs / 7,210 files / 69,892,695 on-disk bytes. These are **imported file bytes, not RSS or compiled code bytes**. The hook misses plugin source transformed and loaded through jiti/CJS, so the 15 extension paths are a lower bound, not the plugin inventory.

With `BRANCH_SKIP_CHANNELS` removed but no channels configured, the main thread snapshot had 6,845 URLs / 6,803 files / 58,252,503 file bytes. It added no files relative to the channels-skipped set; five files were absent. This does not quantify a configured channel's cost. The gateway's own plugin trace is the better evidence for activated extensions: canvas, ACPX, OpenAI, Anthropic, xAI, memory-core, Ollama, CUA computer, Google Meet, Teams Meetings, Zoom Meetings, file transfer, geolocation, Linux node, GitHub, talk voice, and device pair loaded before readiness. Their `engine/extensions/*` source trees (excluding tests and `node_modules`) total about 6.3 MiB, but that is repository size, not incremental boot memory.

### Window chunks

Today's-main Vite build transformed 740 modules. All 11 emitted JS/CSS chunks total 4,580,102 raw bytes / 1,658,232 gzip bytes. The initial HTML, imports, and stylesheet request **five** files, 3,091,611 raw / 880,971 gzip bytes. Gzip values here are from Node's default `gzipSync` on each artifact. The local Python server sent uncompressed responses, so these are artifact sizes, not observed network transfer.

| Chunk | Raw bytes | Gzip bytes | First paint request? |
| --- | ---: | ---: | --- |
| `index-BXREdDns.js` | 2,446,278 | 726,015 | Yes |
| `mount-BsOj9BAa.js` (Office) | 999,684 | 632,602 | No |
| `index-ggwnZBUH.css` | 424,464 | 85,852 | Yes |
| `katex-ABQTMfj3.js` | 263,726 | 76,835 | No |
| `client-7uA6GfvB.js` | 210,585 | 64,973 | Yes |
| `rfb-DEarvyZV.js` | 187,488 | 56,129 | No |
| `katex-D-WqhgTN.css` | 28,390 | 7,904 | No |
| `jsx-runtime-D3jfb0Ew.js` | 8,901 | 3,382 | Yes |
| `office-DYkSbp3b.js` | 8,717 | 3,517 | No |
| `preload-helper-DjzSQ1t3.js` | 1,383 | 749 | Yes |
| `office-C2gaTCdA.css` | 486 | 274 | No |

A read-only inspection of the installed packaged window (`0.4.4-build-883857e58eca`, **older than today's main**) found 11 JS/CSS chunks totaling 4,497,359 raw bytes; its main JS was 2,399,984 raw / 710,544 gzip and its Office mount was 996,254 raw / 634,714 gzip. Its initial-request pattern matched the source build. The installed packaged gateway did not report ready within the benchmark's 30-second limit, so no packaged cold-start timing is asserted.

Sourcemap attribution for the main JS assigned 2,437,320 generated bytes to source files. Settings accounted for 970,140 mapped bytes (~40%); other non-default Places included Canopy 93,155, Automations 89,489, Customize 86,011, Library 77,158, People 64,050, and Inbox 57,610. Office's separate chunk mapped 973,447 bytes to Office. Mapped bytes are attribution, not measured removable bytes; shared imports, compression, and split boundaries must be tested before claiming an actual reduction.

## Memory and database

| Requested measurement | Result |
| --- | --- |
| Gateway RSS, idle with 1 Trunk | NAS: not measured. Scratch `memory.ready` reported 586.4 MiB RSS; subsequent OS samples with one dashboard session were 1,172.2, 1,167.2, and 1,163.9 MiB while background work was active. |
| Gateway RSS, idle with 15 Trunks | NAS: not measured. The scratch gateway confirmed 15 sessions, but later RSS ranged roughly 805.7–1,025.5 MiB and was falling across the sample. GC/background work overwhelmed any session-count effect. A 1-vs-15 delta cannot be inferred. |
| Window RSS, idle with 1 and 15 Trunks | Not measured on NAS or in a representative packaged Electron process. A headless browser probe is not a substitute. |
| Startup SQLite holds | NAS: not measured. Scratch reported `cron.history-maintenance` at 16,936 ms (`immediate`, worker thread). `bootstrap.prune` and `cron.config-mutation` did not appear in this scratch startup log; absence is not a zero-cost result. |

The slow-transaction logger's threshold is 1,000 ms. A startup database pass on the NAS should record transaction operation, elapsed time, database path, thread, and whether it blocks admission. In particular, capture `bootstrap.prune` and `cron.config-mutation` if they occur, plus a baseline with no configured cron entries. Do not compare the scratch `cron.history-maintenance` hold to a production profile without controlling its data volume.

## Absorbed-agent feature areas

| Area | Boot evidence on unconfigured scratch gateway | Measured cost / limit |
| --- | --- | --- |
| Channels | Channel manager imported (`gateway.channel-manager-import` 145.8 ms); `sidecars.channels` 22.4 ms with no configured channels. ESM file-set comparison with/without `BRANCH_SKIP_CHANNELS` added zero files. | Configured channel import, RSS, and startup cost **not measured**. Channel-specific source may be loaded by a plugin loader outside the ESM hook. |
| Integrations | Canvas, meetings, GitHub, file transfer, geolocation, device pair, talk voice, and CUA plugins loaded before readiness, despite a minimal scratch profile. | Scratch individual plugin load spans are listed above; combined span is not additive due shared imports/host contention. No NAS incremental cost measured. |
| Provider extensions | Anthropic, OpenAI, xAI, and Ollama plugins loaded; model-runtime sidecar also ran before readiness. | Scratch provider plugin spans were 18,337, 7,642, 3,582, and 3,262 ms respectively; `sidecars.model-runtime` 54,279 ms overlaps work and is not a per-provider cost. No NAS incremental cost measured. |
| Harvest ports | No independently named `harvest` startup phase or source tree was found in this checkout. Generic ports and provider/integration modules are inside the engine's eager import graph, but the current trace cannot assign their transitive costs. | **Not separately measurable with the existing hook/log labels.** Instrument import ownership or a feature-off comparison before estimating a harvest-specific saving. |

## Ranked opportunities and bounded estimates

These are prioritization bounds, **not measured savings**. The safest engineering sequence remains a small core, lazy-loading behind actual use, and optional plugins only at clean feature edges. Re-run the same baseline after each change; don't subtract overlapping startup spans.

| Rank | Move | Evidence | Estimated avoidable boot cost / confidence |
| ---: | --- | --- | --- |
| 1 | Lazy-load non-default Settings in the window. | Settings owns 970,140 mapped raw bytes in the 2.45 MB initial JS. | Up to ~970 kB raw / ~288 kB gzip on the initial path if isolated; **low confidence upper bound** using main-chunk compression ratio. Actual saving requires a rebuilt chunk comparison. |
| 2 | Lazy-load other non-default Places individually. | Canopy, Automations, Customize, Library, People, and Inbox together map ~468 kB raw inside the initial main chunk. | Up to ~468 kB raw / ~139 kB gzip initial-path bound, before shared-code effects; low confidence. Office is **already deferred** and is not a new win. |
| 3 | Defer integration plugin registration/services until used or configured. | 17 plugins loaded before readiness; `plugins.runtime-post-bind` spanned 175,362 ms under contention. Canvas and ACPX were the largest individual spans in this run. | No defensible millisecond or RSS saving yet; **upper-bound exposure** is 17 plugin loads / 175 s of overlapping, host-specific wall time. Measure per-plugin off/on on the NAS before choosing a boundary. |
| 4 | Make standalone meeting/geolocation/file-transfer/device features optional plugins where their APIs are already clean. | Google Meet, Teams Meetings, Zoom Meetings, geolocation, file transfer, device pair, talk voice, and CUA all loaded on an unconfigured profile. | Eight boot-loaded plugin entries are candidates, not eight independent costs. Source-tree size and trace spans cannot be converted to RSS savings. Preserve core communication and required setup paths. |
| 5 | Lazy-load provider extensions and model catalog only at provider selection/first use. | Four provider plugins loaded before readiness; model-runtime build occupied a 54,279 ms scratch span. | Up to four boot plugin loads plus some model-runtime work could move off the admission path. The 54 s is a **non-additive, non-representative ceiling**, not a forecast. |
| 6 | Keep channel adapters out of the no-channel core, then measure configured adapters individually. | No configured channels; channel manager still imported, while `BRANCH_SKIP_CHANNELS` produced no material file-set difference. | Current evidence supports **no quantified win** for the unconfigured profile. Avoid an optional-plugin move until an actual channel baseline identifies cost. |

## Required completion pass

On the NAS test copy, after PR #438 is merged into the tested main build: capture one uncontended cold process launch with timestamps for Electron window shown, gateway readiness, and first Trunk message admission; save its top 20 startup phases and plugin-load records. Repeat an idle RSS sample with exactly one and exactly 15 Trunks (gateway PID plus Electron main/renderer PIDs, same dwell period, three samples each), and capture SQLite slow holds. Inspect the NAS packaged build's chunk requests on first paint. Only then replace the `not measured` cells and promote this draft audit to a final recommendation. The scratch timings above must remain labeled as such.
