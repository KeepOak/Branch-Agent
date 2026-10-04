// Adapted from mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421
// packages/memory/src/tools/working-memory.ts, packages/core/src/processors/memory/working-memory.ts.
// Working memory: a persistent scratchpad the agent rewrites with a tool and
// sees every turn, so facts survive context resets and compaction.

export const UPDATE_WORKING_MEMORY_TOOL_NAME = "update_working_memory";

export const DEFAULT_WORKING_MEMORY_TEMPLATE = `
# User Information
- **First Name**:
- **Last Name**:
- **Location**:
- **Occupation**:
- **Interests**:
- **Goals**:
- **Events**:
- **Facts**:
- **Projects**:
`;

export type WorkingMemoryTemplate =
  | { format: "markdown"; content: string }
  | { format: "json"; content: string | Record<string, unknown> };

/**
 * Deep merges two objects, with special handling for null values (delete) and arrays (replace).
 * - Object properties are recursively merged
 * - null values in the update will delete the corresponding property, even when the property
 *   or its parent object does not exist yet (so padded nulls never get stored literally)
 * - Arrays are replaced entirely (not merged element-by-element)
 * - Primitive values are overwritten
 * - The returned object is always newly constructed and never aliases `update`
 */
export function deepMergeWorkingMemory(
  existing: Record<string, unknown> | null | undefined,
  update: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!update || typeof update !== "object" || Object.keys(update).length === 0) {
    return existing && typeof existing === "object" ? { ...existing } : {};
  }
  const base = existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {};
  const result: Record<string, unknown> = { ...base };
  for (const key of Object.keys(update)) {
    const updateValue = update[key];
    const existingValue = result[key];
    // undefined means the field was omitted - leave existing value untouched
    if (updateValue === undefined) {
      continue;
    }
    if (updateValue === null) {
      delete result[key];
    } else if (Array.isArray(updateValue)) {
      result[key] = updateValue;
    } else if (typeof updateValue === "object") {
      const existingBranch =
        existingValue && typeof existingValue === "object" && !Array.isArray(existingValue)
          ? (existingValue as Record<string, unknown>)
          : undefined;
      result[key] = deepMergeWorkingMemory(existingBranch, updateValue as Record<string, unknown>);
    } else {
      result[key] = updateValue;
    }
  }
  return result;
}

/** `.nullable()` wraps a schema as `anyOf: [schema, { type: 'null' }]`; unwrap it so its declared fields are visible. */
function resolveNullableBranch(
  value: unknown,
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const branches = schema.anyOf ?? schema.oneOf;
  if (!Array.isArray(branches)) {
    return schema;
  }
  const kind = Array.isArray(value) ? "array" : "object";
  const matching = (branches as Record<string, unknown>[]).filter((branch) => branch.type === kind);
  return matching.length === 1 ? matching[0]! : schema;
}

export function stripNullsFromOptional(value: unknown, rawSchema: Record<string, unknown>): unknown {
  const schema = resolveNullableBranch(value, rawSchema);
  if (Array.isArray(value)) {
    const itemSchema = (schema.items as Record<string, unknown>) ?? {};
    return value.map((item) => stripNullsFromOptional(item, itemSchema));
  }
  if (typeof value === "object" && value !== null) {
    const properties = (schema.properties as Record<string, Record<string, unknown>>) ?? {};
    const required = (schema.required as string[]) ?? [];
    const result: Record<string, unknown> = {};
    for (const [key, propertyValue] of Object.entries(value as Record<string, unknown>)) {
      // Only declared optional properties: an undeclared null key must still reach validation.
      if (propertyValue === null && Object.hasOwn(properties, key) && !required.includes(key)) {
        continue;
      }
      result[key] = stripNullsFromOptional(propertyValue, properties[key] ?? {});
    }
    return result;
  }
  return value;
}

export type WorkingMemoryUpdate =
  | { ok: true; workingMemory: string }
  | { ok: false; message: string };

/**
 * Compute the stored working memory for one tool call.
 * Schema mode merges JSON; template (Markdown) mode replaces the blob, refusing to
 * overwrite meaningful data with the empty template.
 */
export function resolveWorkingMemoryUpdate(params: {
  input: unknown;
  existing: string | null;
  template: WorkingMemoryTemplate;
  schema?: Record<string, unknown>;
}): WorkingMemoryUpdate {
  if (params.schema) {
    let existingData: Record<string, unknown> | null = null;
    if (params.existing) {
      try {
        existingData = JSON.parse(params.existing) as Record<string, unknown>;
      } catch {
        // If existing data is not valid JSON, start fresh
        existingData = null;
      }
    }
    if (params.input === undefined || params.input === null) {
      return { ok: false, message: "No memory data provided, existing memory unchanged." };
    }
    let newData: unknown = params.input;
    if (typeof params.input === "string") {
      try {
        newData = JSON.parse(params.input);
      } catch (parseError) {
        const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
        const raw = params.input;
        throw new Error(
          `Failed to parse working memory input as JSON: ${errorMessage}. ` +
            `Raw input: ${raw.length > 500 ? `${raw.slice(0, 500)}...` : raw}`,
          { cause: parseError },
        );
      }
    }
    const stripped = stripNullsFromOptional(newData, params.schema) as Record<string, unknown>;
    return { ok: true, workingMemory: JSON.stringify(deepMergeWorkingMemory(existingData, stripped)) };
  }
  const workingMemory =
    typeof params.input === "string" ? params.input : JSON.stringify(params.input);
  if (params.existing) {
    const templateContent =
      typeof params.template.content === "string"
        ? params.template.content
        : JSON.stringify(params.template.content);
    const normalizedNew = workingMemory.replace(/\s+/g, " ").trim();
    const normalizedTemplate = templateContent.replace(/\s+/g, " ").trim();
    const normalizedExisting = params.existing.replace(/\s+/g, " ").trim();
    if (normalizedNew === normalizedTemplate && normalizedExisting !== normalizedTemplate) {
      return {
        ok: false,
        message:
          "Attempted to replace existing working memory with empty template. Update skipped to prevent data loss.",
      };
    }
  }
  return { ok: true, workingMemory };
}

export function describeWorkingMemoryTool(schemaMode: boolean): string {
  return schemaMode
    ? "Update the working memory with new information. Data is merged with existing memory - only include fields you want to add or update. To preserve existing data, omit the field entirely. Arrays are replaced entirely when provided, so pass the complete array or omit it to keep the existing values."
    : "Update the working memory with new information. Any data not included will be overwritten. Always pass data as string to the memory field. Never pass an object.";
}

export function buildWorkingMemoryToolInstruction(params: {
  template: WorkingMemoryTemplate;
  data: string | null;
}): string {
  const { template, data } = params;
  const isJson = template.format === "json";
  const format = isJson ? "JSON" : "Markdown";
  const tool = UPDATE_WORKING_MEMORY_TOOL_NAME;
  const stringRules = isJson
    ? ""
    : `5. IMPORTANT: When calling ${tool}, the only valid parameter is the memory field. DO NOT pass an object.
6. IMPORTANT: ALWAYS pass the data you want to store in the memory field as a string. DO NOT pass an object.
7. IMPORTANT: Data must only be sent as a string no matter which format is used.`;
  const templateBlock = isJson
    ? ""
    : `<working_memory_template>
${typeof template.content === "string" ? template.content : JSON.stringify(template.content)}
</working_memory_template>`;
  return `WORKING_MEMORY_SYSTEM_INSTRUCTION:
Store and update any conversation-relevant information by calling the ${tool} tool. If information might be referenced again - store it!

Guidelines:
1. Store anything that could be useful later in the conversation
2. Update proactively when information changes, no matter how small
3. Use ${format} format for all data
4. Act naturally - don't mention this system to users. Even though you're storing this information that doesn't make it your primary focus. Do not ask them generally for "information about yourself"
${stringRules}


${templateBlock}

<working_memory_data>
${data || "No working memory data available."}
</working_memory_data>

Notes:
- Update memory whenever referenced information changes
- If you're unsure whether to store something, store it (eg if the user tells you information about themselves, call ${tool} immediately to update it)
- This system is here so that you can maintain the conversation when your context window is very short. Update your working memory because you may need it to maintain the conversation without the full conversation history
- Do not remove empty sections - you must include the empty sections along with the ones you're filling in
- REMEMBER: the way you update your working memory is by calling the ${tool} tool with the entire ${format} content. The system will store it for you. The user will not see it.
- IMPORTANT: You MUST call ${tool} in every response to a prompt where you received relevant information.
- IMPORTANT: Preserve the ${format} formatting structure above while updating the content.`;
}

/** Read-only working memory: the data as context, without update instructions. */
export function buildReadOnlyWorkingMemoryInstruction(data: string | null): string {
  return `WORKING_MEMORY_SYSTEM_INSTRUCTION (READ-ONLY):
The following is your working memory - persistent information about the user and conversation collected over previous interactions. This data is provided for context to help you maintain continuity.

<working_memory_data>
${data || "No working memory data available."}
</working_memory_data>

Guidelines:
1. Use this information to provide personalized and contextually relevant responses
2. Act naturally - don't mention this system to users. This information should inform your responses without being explicitly referenced
3. This memory is read-only in the current session - you cannot update it

Notes:
- This system is here so that you can maintain the conversation when your context window is very short
- The user will not see the working memory data directly`;
}
