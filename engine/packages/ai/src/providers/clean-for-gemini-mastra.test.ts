// Ported Google tuple/propertyNames cases from mastra-ai/mastra
// packages/schema-compat/src/provider-compats/google.test.ts at
// 486d3b7f35edfeaeab47b1230b56880e672cc421.
import { describe, expect, it } from "vitest";
import { normalizeToolParameterSchema } from "./agent-tools-parameter-schema.js";
import { cleanSchemaForGemini } from "./clean-for-gemini.js";
import { buildGoogleGenerateContentParams } from "./google-shared.js";
import { makeModel } from "./google-shared.test-helpers.js";

function tupleSchema() {
  return {
    type: "object",
    properties: {
      coords: {
        type: "array",
        items: [{ type: "number" }, { type: "string" }],
        minItems: 2,
        maxItems: 2,
      },
    },
    required: ["coords"],
  };
}

describe("Mastra Google schema compatibility", () => {
  it("converts legacy tuple items to a single anyOf schema without losing member types", () => {
    const schema = tupleSchema();
    const original = structuredClone(schema);
    expect(cleanSchemaForGemini(schema)).toEqual({
      type: "object",
      properties: {
        coords: { type: "array", items: { anyOf: [{ type: "number" }, { type: "string" }] } },
      },
      required: ["coords"],
    });
    expect(schema).toEqual(original);
  });

  it("cleans referenced and nested tuple members before combining their schemas", () => {
    expect(
      cleanSchemaForGemini({
        type: "array",
        items: [
          { $ref: "#/$defs/mode" },
          { type: "array", items: [{ type: "integer", minimum: 0 }, { type: "boolean" }] },
        ],
        $defs: { mode: { type: "string", const: "fast", propertyNames: { pattern: "^x" } } },
      }),
    ).toEqual({
      type: "array",
      items: {
        anyOf: [
          { type: "string", enum: ["fast"] },
          { type: "array", items: { anyOf: [{ type: "integer" }, { type: "boolean" }] } },
        ],
      },
    });
  });

  it.each([
    [{ type: "string" }, { type: "null" }],
    [
      { type: "string", const: "left" },
      { type: "string", const: "right" },
    ],
  ])("normalizes tuple null and literal members like direct unions: %j", (...items) => {
    const direct = cleanSchemaForGemini({ anyOf: items });
    expect(cleanSchemaForGemini({ type: "array", items })).toEqual({
      type: "array",
      items: direct,
    });
    const model = makeModel("gemini-2.5-flash");
    const parameters = normalizeToolParameterSchema(
      { type: "object", properties: { values: { type: "array", items } } },
      { modelProvider: model.provider, modelId: model.id },
    );
    const payload = buildGoogleGenerateContentParams(model, {
      messages: [],
      tools: [{ name: "tuple", description: "Read tuple", parameters }],
    });
    expect(payload.config?.tools).toEqual([
      {
        functionDeclarations: [
          expect.objectContaining({
            parametersJsonSchema: {
              type: "object",
              properties: { values: { type: "array", items: direct } },
            },
          }),
        ],
      },
    ]);
  });

  it("strips propertyNames constraints without dropping literal property names or defaults", () => {
    const schema = {
      type: "object",
      propertyNames: { pattern: "^[a-z]+$" },
      properties: {
        propertyNames: { type: "string" },
        nested: { type: "object", propertyNames: { type: "string" }, properties: {} },
      },
      default: { propertyNames: "literal data" },
    };
    expect(cleanSchemaForGemini(schema)).toEqual({
      type: "object",
      properties: {
        propertyNames: { type: "string" },
        nested: { type: "object", properties: {} },
      },
      default: { propertyNames: "literal data" },
    });
    expect(schema).toHaveProperty("propertyNames.pattern", "^[a-z]+$");
  });

  it("sends the normalized tuple and object schema through the native Google request builder", () => {
    const model = makeModel("gemini-2.5-flash");
    const source = { ...tupleSchema(), propertyNames: { pattern: "^[a-z]+$" } };
    const parameters = normalizeToolParameterSchema(source, {
      modelProvider: model.provider,
      modelId: model.id,
    });
    const payload = buildGoogleGenerateContentParams(model, {
      messages: [],
      tools: [{ name: "coordinates", description: "Read coordinates", parameters }],
    });
    expect(payload.config?.tools).toEqual([
      {
        functionDeclarations: [
          {
            name: "coordinates",
            description: "Read coordinates",
            parametersJsonSchema: {
              type: "object",
              properties: {
                coords: {
                  type: "array",
                  items: { anyOf: [{ type: "number" }, { type: "string" }] },
                },
              },
              required: ["coords"],
            },
          },
        ],
      },
    ]);
    expect(source).toHaveProperty("properties.coords.items", [
      { type: "number" },
      { type: "string" },
    ]);
  });

  it.each(["openai", "anthropic"])("preserves tuple and object constraints for %s", (provider) => {
    const schema = { ...tupleSchema(), propertyNames: { pattern: "^[a-z]+$" } };
    const normalized = normalizeToolParameterSchema(schema, { modelProvider: provider });
    expect(normalized).toEqual(schema);
  });
});
