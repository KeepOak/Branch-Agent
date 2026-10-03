export type WritingContext = "general" | "technical" | "marketing" | "personal";
export type WritingSourceMode = "plain" | "rendered-markdown";
export type WritingFinding = { type: string; text: string; severity?: string; [key: string]: unknown };
export type WritingAnalysis = {
  issues: WritingFinding[];
  stats: { wordCount: number; [key: string]: unknown };
  score: number;
  tooLong?: boolean;
  tooShort?: boolean;
  unsupportedScript?: boolean;
  [key: string]: unknown;
};
declare const detector: {
  analyzeText(text: string, options?: { contextMode?: WritingContext; sourceMode?: WritingSourceMode }): WritingAnalysis;
};
export default detector;
