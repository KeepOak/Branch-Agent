/** Branch adapter of pinned elizaOS/eliza CALCULATE action; no Eliza runtime dependency. */
import type { TSchema } from "typebox";
import { evaluateArithmetic, ExpressionError } from "./arithmetic.js";
import type { AnyAgentTool } from "./common.js";

export function createCalculatorTool(): AnyAgentTool {
  return {
    name: "calculate",
    label: "Calculator",
    description:
      "Exact arithmetic: evaluates a numeric expression (+ - * / % ^ parentheses, decimals, unary minus) deterministically. Use for any multi-digit arithmetic instead of mental math. Integer results are exact; decimal and division results disclose floating-point precision.",
    parameters: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description:
            'The bare numeric expression, e.g. "3847 * 292" or "(12.5 + 3) / 4". Numbers and + - * / % ^ ( ) only, no words or variables.',
        },
      },
      required: ["expression"],
      additionalProperties: false,
    } as TSchema,
    async execute(_id, input, signal) {
      signal?.throwIfAborted();
      const expression =
        input &&
        typeof input === "object" &&
        "expression" in input &&
        typeof input.expression === "string"
          ? input.expression.trim()
          : undefined;
      if (!expression) {
        return {
          content: [
            {
              type: "text",
              text: 'CALCULATE requires an `expression` parameter, e.g. "3847 * 292".',
            },
          ],
          details: {
            success: false,
            actionName: "CALCULATE",
            error: "CALCULATE_MISSING_EXPRESSION",
          },
        };
      }
      try {
        const { text, exact } = evaluateArithmetic(expression);
        return {
          content: [
            {
              type: "text",
              text: `${expression} = ${text}${exact ? "" : " (floating-point; 15 significant digits)"}`,
            },
          ],
          details: { success: true, actionName: "CALCULATE", expression, result: text, exact },
        };
      } catch (error) {
        const reason = error instanceof ExpressionError ? error.message : "unparseable input";
        return {
          content: [
            {
              type: "text",
              text: `CALCULATE could not evaluate "${expression}": ${reason}. Supported: numbers with + - * / % ^ and parentheses.`,
            },
          ],
          details: {
            success: false,
            actionName: "CALCULATE",
            error: "CALCULATE_INVALID_EXPRESSION",
            expression,
            reason,
          },
        };
      }
    },
  };
}
