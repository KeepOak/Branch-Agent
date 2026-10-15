---
name: reverse-engineer-anything
description: Reverse engineer native, managed, Electron/JavaScript, packaged, firmware, and browser targets with REA on Branch Agent. Use shipped-artifact or requested runtime evidence to explain features, compare versions, decompile code, or guide a reconstruction. Skip REA for ordinary source-repository architecture analysis. Copy code only from permissively licensed sources.
metadata:
  version: "37"
---

<!-- Adapted for Branch Agent from Nous Research's official REA plugin at https://github.com/NousResearch/hermes-official-plugins/tree/3a102d9a387983e9c95bf84379d08fa2492b1de8/rea/skills/reverse-engineer-anything (MIT). That plugin adapts REA's bundled skill (rea-agents 6.4.0, https://github.com/morluto/rea, MIT, Copyright (c) 2026 morluto). Changes: Branch tool names, Branch connection, approval before command, app, and overwrite tools, and a Branch recovery guide. -->

# REA

Copy code only from permissively licensed sources. Closed apps (like an Electron app) may only be studied for behavior and design, never copied.

Use REA when a claim depends on a shipped binary or package, decompilation,
passive application runtime evidence, or comparison with
behavior not established by available source. For ordinary analysis of a
complete source repository, use normal repository tools and do not run REA
readiness or provider commands.

## Connect only when needed

In Branch Agent this skill ships inside the Harvest plugin, and the same plugin
registers the REA MCP server. The server is the locked `rea-agents` 6.4.0
install under `rea-pin`, started with `node` on
`rea-pin/node_modules/rea-agents/scripts/rea.mjs`. Call each
tool as `rea__<tool>`, for example `rea__open_binary`. Nothing else needs
registering: never run `rea-agents setup`, `rea setup`, or `branch mcp add rea`.
Setup would add a second `mcp.servers.rea` entry that replaces the plugin's
server and its pinned version. Do not start the server with `npx -y` or an
unpinned package name.

The enabled server advertises its tools directly. A tool it does not advertise
is not available in this session.

If no REA tools are found, a call fails to start, or a required provider is
unavailable, read [connection and recovery](references/connection-and-recovery.md).
Diagnose the observed blocker, continue useful supported work, and resume the
original task after repair.

## Route the target first

Choose the first tool from the target the user supplied. Use `rea__open_binary` for
active-target native or archive workflows; target-free tools take their own
explicit path or endpoint and do not need it.

- ASAR or extracted JavaScript/Electron tree:
  `rea__analyze_javascript_application`.
- Archive/package member inventory (ZIP/APK/IPA/MSIX/AppX or DMG):
  `rea__open_binary` with the supplied local path; use `rea__inspect_artifact` when its
  graph and findings help answer the question.
- Android APK code, classes, methods, or incoming references:
  `rea__inspect_android_package`, then focused Android tools when advertised.
  Archive member inventory still uses the archive route above.
- Managed PE/CLI assembly: `rea__inspect_managed_artifact`.
- Firmware image: `rea__inspect_firmware_regions` when advertised. Use
  `rea__extract_firmware` when extraction is requested, with a caller-selected new
  absolute output directory. These tools use caller-supplied Binwalk/Unblob on
  Linux; see the [firmware guide](https://github.com/morluto/rea/blob/main/docs/firmware-analysis.md).
- .NET NativeAOT PE/ELF: native Ghidra analysis. Native code can yield pseudocode;
  consult the NativeAOT workflow in `references/native-and-artifacts.md` for
  optional metadata recovery and its supported host/layout boundary.
- User-owned browser page already open: `rea__list_browser_targets`.
- Retained HAR/native mitmproxy capture: `rea__inspect_web_network_capture`. Select
  original record ordinals when useful; inspect producer fields and byte/number
  sidecars without fetching recorded URLs or claiming live attribution. See
  [historical captures](https://github.com/morluto/rea/blob/main/docs/web-network-captures.md) for the exact upstream
  profile and credential exclusions.
- User-owned Electron runtime already open: `rea__list_electron_targets`.
- Explicit local EVM bytecode carrier: `rea__inspect_evm_interface` with caller-selected
  `raw` or `hex` encoding. Preserve carrier/decoded digests and treat selectors,
  argument strings and mutability as inferred candidates; this performs no chain
  lookup or target execution. See the
  [EVM bytecode guide](https://github.com/morluto/rea/blob/main/docs/evm-bytecode.md).
- Explicit Linux ELF file for offline layout, symbols, relocations or static
  mitigation evidence: `rea__inspect_binary_layout`. This target-free operation uses
  caller-supplied pwntools without opening a disassembler database. Preserve its
  raw locations and inference/coverage limits; see the
  [offline binary guide](https://github.com/morluto/rea/blob/main/docs/binary-diagnostics.md).
- Supplied Linux x86-64 ELF core: `rea__inspect_recorded_crash`. Read every recorded
  thread, raw note and source-bound register without opening a live target.
  Historical PIDs do not select live processes. Request `include_debugger_context`
  only when core-only mapping candidates help; see the
  [recorded crash guide](https://github.com/morluto/rea/blob/main/docs/recorded-crashes.md).
- PE resource type/name/language trees and static icon group references:
  `rea__inspect_pe_resources` with an explicit path. This portable operation requires
  no active target or engine; opaque payloads retain file ranges and SHA-256.
- Native executable, library, or analysis database: `rea__open_binary`, then
  use focused analysis tools directly; call `rea__binary_overview` when metadata or
  inventory context is useful and available from the selected provider.

For an existing IDA MCP configuration, use `rea__open_binary` with the original
input binary and `provider_id: "ida"`; do not pass an `.idb` or `.i64` database.
The legacy attached profile binds the already-open GUI input by SHA-256 and
leaves its database open. The modern headless profile creates and closes an
owned private database without saving. Installation and registration reuse
[mrexodia/ida-pro-mcp](https://github.com/mrexodia/ida-pro-mcp); see the
[IDA provider guide](https://github.com/morluto/rea/blob/main/docs/ida-provider.md).
Proceed directly to `rea__analyze_function`, pseudocode, or function/string searches
after opening; IDA does not supply `rea__binary_overview`. Consult session availability
when composing broader workflows. Modern direct callers and unsupported dossier
facets remain unknown; live IDA results are not replayed from snapshots.

If the user says only "my app" without a name, path, or target already selected
for this task, ask which app before searching for artifacts. Paths in unrelated
saved reports and nearby test fixtures do not select the user's target. Resolve
an actual human-readable app name to one clear installed artifact when possible;
ask when matches are ambiguous. Never choose an example app on the user's behalf.

In a target-free session, use `rea__open_binary` to bind any archive/package or
native target whose analysis tool operates on the active target. Do not call an
unadvertised tool; inspect `rea__binary_session` with `{}` and its
`result.tool_availability` for availability reasons and remediation. The tool
list stays complete; availability depends on the operation, target, and host.

## Native startup and interpretation

Before the first Ghidra-backed query, explain that importing and analyzing a
large executable can take several minutes. `rea__open_binary` validates the target;
it does not mean native analysis has completed. This plugin allows 900 seconds
for Ghidra startup and 1000 seconds for an REA MCP call. The user can still
cancel. Do not invent progress percentages or promise a fixed completion time.

Keep the target open for related queries: the first native query does the
expensive import, and later queries reuse that analysis. Do not reopen the
binary or start another server to "check progress". On a timeout, read
[connection and recovery](references/connection-and-recovery.md) before retrying.

Generated pseudocode is an interpretation, not original source. Corroborate
important branches with assembly, references and callers. Keep inferred
function names/types distinct from symbols actually present in the artifact;
report type-propagation warnings and missing symbols rather than filling gaps
with plausible source. When evaluating an unfamiliar target, record findings
before reading matching-version source, then label source-only corrections.

## Work summary-first

Start with the default result and use its inline Evidence and graph context.
For a JavaScript application or ELF layout whose size is unknown or large,
call `rea__analyze_javascript_application` or `rea__inspect_binary_layout` with
`"detail": "summary"`, then inspect the retained `parent_evidence_id` with
`rea__inspect_analysis_view`.
Page module identities and select the returned `node_id` before requesting an
item; a single file path can represent several graph roles. Do not repeat an
identical analysis or rejected call without a changed input or resolved blocker.
Recheck session state when a lifecycle change makes that status useful.
Make a focused follow-up only when the
returned result leaves a specific question unanswered.

If MCP reports `resource_constraint` with `details.resource: "transport"`, call
`rea__inspect_analysis_view` with its reported same-session Evidence reference for a
summary, one section/module, or a stable page. Use `rea__trace_application_feature`
once a seed is known, or call `rea__export_evidence_bundle` to write the complete
session to a selected path. The analysis remains complete in the ledger; avoid
repeating it merely to request the same oversized response. Complete CLI JSON
output also streams without a single MCP frame.

When the retained parent ID is unknown, use `rea__get_evidence_bundle` with
`detail: "summary"` and exact filters for operation, target SHA-256,
analysis-profile digest or canonical procedure address. Select its returned
Evidence ID for the next view instead of requesting the complete bundle.
`retention: "complete-record"` means the whole record is stored; native
value-flow truncation and unknown metadata remain separate. For an exported
portable bundle, use `node` on the locked `rea-pin/node_modules/rea-agents/scripts/rea.mjs`
with `inspect-evidence-bundle` and JSON containing `path`,
`detail: "summary"` and the same `filters`. Reading that file still requires
validating its full contents within the local memory budget.

A client can also truncate a successful tool result without a REA transport
error. Treat that preview as incomplete; use the retained parent ID for smaller
views or export when the full record is needed. Do not parse the preview as
canonical JSON or repeat the producer. For JavaScript, read the
[module-view and trace recipes](references/javascript-applications.md) before
drilling into a large graph; a broad bidirectional trace can expand unrelated
containment relationships even after summary analysis.

Every conclusion must distinguish observations, inferences, and unknowns. Cite
Evidence IDs, preserve limitations and incomplete coverage, and never imply
that static analysis observed execution. Runtime requests execute the declared
target and lifecycle; do not broaden the target or action beyond those fields.

Within the user's requested investigation, call REA tools that only read
evidence already in the session directly. Branch asks before any REA tool that
runs a command, drives an app, writes or overwrites a file, or otherwise
changes state. A yes covers that one call only. Put the exact command, app,
device, or output path in the call so the user can see it. The ask-first tools
are:

`rea__annotate_native_function`, `rea__capture_adb_screen`, `rea__capture_browser_scenario`,
`rea__capture_electron_scenario`, `rea__capture_native_ui_scenario`,
`rea__capture_process_scenario`, `rea__close_binary`, `rea__collect_adb_bugreport`,
`rea__decode_android_resources`, `rea__demangle_swift`, `rea__export_evidence_bundle`,
`rea__export_web_scripts`, `rea__extract_artifact`, `rea__extract_firmware`, `rea__goto_address`,
`rea__inspect_adb_client`, `rea__inspect_adb_device`, `rea__inspect_adb_display`,
`rea__inspect_adb_package`, `rea__inspect_adb_window`, `rea__inspect_android_class`,
`rea__inspect_android_method`, `rea__inspect_android_package`, `rea__inspect_apktool_client`,
`rea__inspect_artifact`, `rea__inspect_asset_catalog`, `rea__inspect_binary_layout`,
`rea__inspect_evm_interface`, `rea__inspect_firmware_regions`, `rea__inspect_macho`,
`rea__inspect_plist`, `rea__inspect_recorded_crash`, `rea__inspect_signature`,
`rea__inspect_web_network_capture`, `rea__install_adb_package`, `rea__list_adb_devices`,
`rea__list_adb_directory`, `rea__list_adb_features`, `rea__list_adb_packages`,
`rea__list_adb_processes`, `rea__list_adb_services`, `rea__list_architectures`,
`rea__observe_native_calls`, `rea__observe_native_ui`, `rea__observe_web_execution`,
`rea__open_binary`, `rea__pull_adb_file`, `rea__pull_adb_package`, `rea__push_adb_file`,
`rea__read_adb_logcat`, `rea__read_adb_setting`, `rea__recover_javascript_sources`,
`rea__resolve_adb_packages`, `rea__search_android_classes`, `rea__set_address_name`,
`rea__set_addresses_names`, `rea__set_bookmark`, `rea__set_comment`, `rea__set_inline_comment`,
`rea__start_adb_activity`, `rea__start_adb_app`, `rea__stop_adb_app`,
`rea__trace_android_references`, `rea__trace_web_module_imports`,
`rea__trace_web_source_location`, `rea__uninstall_adb_package`, `rea__unset_bookmark`.

Never run an untrusted target outside an environment the user chose for it.
In a scheduled or unattended run with nobody to ask, skip these calls and
report the step that needs approval.

## Plan broader investigations

For requests that span multiple features or subsystems, use a staged workflow:

1. Turn the request into a checklist of questions and the evidence each answer
   needs. Resolve target identity and constraints from the conversation and
   workspace before asking for information again.
2. Inspect the current REA session, artifact identity, saved analysis database,
   bookmarks, and prior evidence. Reuse matching state; do not open duplicate
   sessions or repeat identical analysis.
3. Start with the smallest useful overview or inventory. Follow each question
   from its entry point through relevant data and state changes to its result.
   Batch related operations around a specific hypothesis, then expand only when
   the returned evidence leaves a concrete gap.
4. Inspect relevant packaged resources and configuration alongside code when
   they affect the question. Use format-aware inventory and parsers; do not
   infer behavior from filenames, strings, or layout alone.
5. Corroborate a conclusion with the evidence type it requires. Use runtime
   observation only when static evidence cannot answer the question and the
   required host runtime and OS access are available. For JavaScript behavior,
   run probes against the actual app through the available browser, Electron,
   or process capture workflow.
6. Decompose work into independent questions. When parallel workers are
   available and the questions do not depend on one another, assign distinct
   scopes, point workers to existing evidence, and ask them to return sources,
   conclusions, and unresolved gaps. Otherwise, work sequentially.
7. Keep a concise finding ledger linking each conclusion to Evidence IDs,
   confidence/evidence type, search boundary, and remaining unknowns. Update
   the shared index or investigation report so later passes can reuse results.

Before finishing, revisit the original checklist. Mark each question as
answered, partially answered, or unresolved based on its evidence; keep
bounded negative searches bounded, and do not describe a broad investigation
as complete while required questions remain open.

## Read only the relevant guide

- Native binaries, managed assemblies, archives, and extraction:
  [references/native-and-artifacts.md](references/native-and-artifacts.md)
- ASARs, extracted JavaScript, feature tracing, and version comparison:
  [references/javascript-applications.md](references/javascript-applications.md)
- Android APK declarations, classes, methods, and static references:
  [references/android-applications.md](references/android-applications.md)
- Passive browser/Electron observation and static/runtime reconciliation:
  [references/runtime-observation.md](references/runtime-observation.md)
- Evidence paging, comparisons, residual unknowns, and verification:
  [references/evidence-workflows.md](references/evidence-workflows.md)

## Finish the task

Explain findings in plain language and tie them to returned evidence. When the
user asks to build something, use normal coding tools and separate observed
behavior from design choices. Close an opened native session with
`rea__close_binary` when the investigation is complete.
