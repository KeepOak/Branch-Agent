// Workspace editor compatibility rules from cline/cline 0809928ab28783c0d2b41c1e56edaf0951dadcab.
import {
  extractExternalRulePaths,
  externalRuleMatches,
  parseExternalRule,
} from "./external-project-rules.conditions.js";
import {
  createExternalRuleFiles,
  discoverExternalRuleLayouts,
  type ExternalRulesBridge,
} from "./external-project-rules.files.js";
import {
  readExternalRuleState,
  refreshExternalRuleState,
  updateExternalRuleState,
  type ExternalRuleState,
  type ExternalRuleStateScope,
} from "./external-project-rules.state.js";

export type ExternalRuleOptions = ExternalRuleStateScope & {
  executionWorkspace?: string;
  bridge?: ExternalRulesBridge;
  prompt?: string;
};

export async function inspectExternalProjectRules(options: ExternalRuleOptions) {
  const files = createExternalRuleFiles({
    workspace: options.executionWorkspace ?? options.workspace,
    logicalWorkspace: options.workspace,
    bridge: options.bridge,
    assertCurrent: options.assertCurrent,
  });
  const layouts = await discoverExternalRuleLayouts(files);
  options.assertCurrent?.();
  const state = refreshExternalRuleState(await readExternalRuleState(options), layouts);
  return { files, layouts, state };
}

export async function toggleExternalProjectRule(
  options: ExternalRuleOptions,
  provider: "cursor" | "windsurf",
  relative: string,
  enabled: boolean,
): Promise<ExternalRuleState> {
  if (!relative || typeof enabled !== "boolean")
    throw new Error("Missing or invalid rule toggle parameters");
  const { layouts } = await inspectExternalProjectRules(options);
  if (
    !layouts.some(
      (layout) => layout.provider === provider && !layout.error && layout.files.includes(relative),
    )
  ) {
    throw new Error(
      `Rule is not an available ${provider} rule in the selected workspace: ${relative}`,
    );
  }
  return updateExternalRuleState(options, (previous) => {
    const state = refreshExternalRuleState(previous, layouts);
    state[provider][relative] = enabled;
    return state;
  });
}

async function prepareExternalRuleSections(options: ExternalRuleOptions): Promise<string[]> {
  const { files, layouts } = await inspectExternalProjectRules(options);
  const state = await updateExternalRuleState(options, (previous) =>
    refreshExternalRuleState(previous, layouts),
  );
  const candidates = extractExternalRulePaths(options.prompt ?? "");
  const sections: string[] = [];
  for (const layout of layouts) {
    if (layout.error) {
      sections.push(`External project rules unavailable (${layout.source}): ${layout.error}`);
      continue;
    }
    const content: string[] = [];
    for (const relative of layout.files) {
      if (state[layout.provider][relative] === false) continue;
      try {
        const raw = (await files.read(relative)).trim();
        if (!raw) continue;
        const parsed = parseExternalRule(raw);
        if (parsed.parseError || externalRuleMatches(parsed.data, candidates).passed) {
          content.push(`${relative}\n${parsed.parseError ? raw : parsed.body.trim()}`);
        }
      } catch (error) {
        options.assertCurrent?.();
        content.push(`External project rule unavailable (${relative}): ${String(error)}`);
      }
    }
    if (content.length)
      sections.push(
        `# ${layout.source}\n\nUser instructions for this working directory (${options.executionWorkspace ?? options.workspace}):\n\n${content.join("\n\n")}`,
      );
  }
  return sections;
}

/** Fresh attempt-owned prompt content; disabling never relies on historical tool results. */
export async function prepareExternalProjectRulesPrompt(
  options: ExternalRuleOptions,
): Promise<string | undefined> {
  try {
    const sections = await prepareExternalRuleSections(options);
    options.assertCurrent?.();
    return sections.join("\n\n") || undefined;
  } catch (error) {
    options.assertCurrent?.();
    return `External project rules unavailable: ${String(error)}`;
  }
}
