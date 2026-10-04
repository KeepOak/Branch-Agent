// Adapted from mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421
// packages/evals/src/scorers/code/content-similarity/index.ts and code/completeness/index.ts.
// Completeness reads compromise's term list (the superset of its noun/verb/topic lists) with a
// plain word tokenizer, since compromise is not a Branch dependency.
import { createScorer } from "./scorer.js";
import { compareTwoStrings } from "./string-similarity.js";
import {
  getTextContentFromMessage,
  type AgentScorerRun,
  type EvalMessage,
  type ScorerRunOutputForAgent,
} from "./scorer-utils.js";

type AgentRunInput = AgentScorerRun["input"];

export type ContentSimilarityOptions = {
  ignoreCase?: boolean;
  ignoreWhitespace?: boolean;
};

/** Similarity between the input messages and the output messages (Dice coefficient). */
export function createContentSimilarityScorer(
  { ignoreCase, ignoreWhitespace }: ContentSimilarityOptions = {
    ignoreCase: true,
    ignoreWhitespace: true,
  },
) {
  return createScorer<AgentRunInput, ScorerRunOutputForAgent>({
    id: "content-similarity-scorer",
    name: "Content Similarity Scorer",
    description:
      "Calculates content similarity between input and output messages using string comparison algorithms.",
  })
    .preprocess(({ run }) => {
      let processedInput =
        run.input?.inputMessages.map((message) => getTextContentFromMessage(message)).join(", ") ||
        "";
      let processedOutput =
        run.output.map((message) => getTextContentFromMessage(message)).join(", ") || "";
      if (ignoreCase) {
        processedInput = processedInput.toLowerCase();
        processedOutput = processedOutput.toLowerCase();
      }
      if (ignoreWhitespace) {
        processedInput = processedInput.replace(/\s+/g, " ").trim();
        processedOutput = processedOutput.replace(/\s+/g, " ").trim();
      }
      return { processedInput, processedOutput };
    })
    .generateScore(({ results }) =>
      compareTwoStrings(
        results.preprocessStepResult.processedInput,
        results.preprocessStepResult.processedOutput,
      ),
    );
}

function normalizeString(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function extractElements(text: string): string[] {
  const cleanAndSplitTerm = (term: string): string[] =>
    normalizeString(term)
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0);
  const terms = text.trim().split(/\s+/).filter(Boolean);
  return [...new Set(terms.flatMap(cleanAndSplitTerm))];
}

function calculateCoverage(original: string[], simplified: string[]): number {
  if (original.length === 0) {
    return simplified.length === 0 ? 1 : 0;
  }
  // Exact match for short words (3 chars or less), >60% substring overlap for longer ones.
  const covered = original.filter((element) =>
    simplified.some((candidate) => {
      const elem = normalizeString(element);
      const simp = normalizeString(candidate);
      if (elem.length <= 3) {
        return elem === simp;
      }
      const longer = elem.length > simp.length ? elem : simp;
      const shorter = elem.length > simp.length ? simp : elem;
      if (longer.includes(shorter)) {
        return shorter.length / longer.length > 0.6;
      }
      return false;
    }),
  );
  return covered.length / original.length;
}

function hasMissingContent(messages: EvalMessage[] | null | undefined): boolean {
  return (
    !messages ||
    messages.some((message) => {
      const content = getTextContentFromMessage(message) as string | null | undefined;
      return content === null || content === undefined;
    })
  );
}

/** How much of the input's terms the output still covers. */
export function createCompletenessScorer() {
  return createScorer<AgentRunInput, ScorerRunOutputForAgent>({
    id: "completeness-scorer",
    name: "Completeness Scorer",
    description: "Extracts terms from the input and output and calculates the coverage.",
  })
    .preprocess(({ run }) => {
      if (!run.input || hasMissingContent(run.input.inputMessages) || hasMissingContent(run.output)) {
        throw new Error("Inputs cannot be null or undefined");
      }
      const input = run.input.inputMessages
        .map((message) => getTextContentFromMessage(message))
        .join(", ");
      const output = run.output.map((message) => getTextContentFromMessage(message)).join(", ");
      const inputElements = extractElements(input);
      const outputElements = extractElements(output);
      return {
        inputElements,
        outputElements,
        missingElements: inputElements.filter((element) => !outputElements.includes(element)),
        elementCounts: { input: inputElements.length, output: outputElements.length },
      };
    })
    .generateScore(({ results }) =>
      calculateCoverage(
        results.preprocessStepResult.inputElements,
        results.preprocessStepResult.outputElements,
      ),
    );
}
