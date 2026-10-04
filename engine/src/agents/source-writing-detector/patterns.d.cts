declare namespace detector {
  type WritingContext = "general" | "technical" | "marketing" | "personal";
  type WritingSourceMode = "plain" | "rendered-markdown";
  type WritingFinding = { type: string; text: string; severity?: string; [key: string]: unknown };
  type WritingAnalysis = {
    issues: WritingFinding[];
    stats: { wordCount: number; [key: string]: unknown };
    score: number;
    tooLong?: boolean;
    tooShort?: boolean;
    unsupportedScript?: boolean;
    [key: string]: unknown;
  };
  function analyzeText(text: string, options?: { contextMode?: WritingContext; sourceMode?: WritingSourceMode }): WritingAnalysis;
}
export = detector;
