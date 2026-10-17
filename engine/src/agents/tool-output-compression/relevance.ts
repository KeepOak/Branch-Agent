// From JuliusBrussee/caveman@b39c90862855ad2f0813ce775b8bf07a9d6d2a50:engine/compressors/relevance.go and engine/contextwindow/contextwindow.go BM25 (atlas AGENT-LOOP-0349).
import { utf8Length } from "./line-ends.js";

const BM25_K1 = 1.5;
const BM25_B = 0.75;
const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
]);
const TERM_CHAR = /[\p{L}\p{Nd}_]/u;

function termFreq(text: string): Map<string, number> {
  const freq = new Map<string, number>();
  let current = "";
  const flush = () => {
    if (utf8Length(current) >= 2 && !STOPWORDS.has(current)) {
      freq.set(current, (freq.get(current) ?? 0) + 1);
    }
    current = "";
  };
  for (const char of text.toLowerCase()) {
    if (TERM_CHAR.test(char)) {
      current += char;
    } else {
      flush();
    }
  }
  flush();
  return freq;
}

/** Okapi BM25 (k1=1.5, b=0.75); scores are unnormalized and comparable only within docs. */
export function bm25(query: string, docs: string[]): number[] {
  const queryTerms = termFreq(query);
  const out = docs.map(() => 0);
  if (queryTerms.size === 0 || docs.length === 0) {
    return out;
  }
  const freqs = docs.map(termFreq);
  const docLen = freqs.map((tf) => [...tf.values()].reduce((sum, count) => sum + count, 0));
  const df = new Map<string, number>();
  for (const tf of freqs) {
    for (const term of tf.keys()) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }
  const totalLen = docLen.reduce((sum, len) => sum + len, 0);
  const avgdl = totalLen > 0 ? totalLen / docs.length : 1;
  freqs.forEach((tf, i) => {
    for (const term of queryTerms.keys()) {
      const count = tf.get(term) ?? 0;
      if (count === 0) {
        continue;
      }
      const termDf = df.get(term) ?? 0;
      const idf = Math.log(1 + (docs.length - termDf + 0.5) / (termDf + 0.5));
      const denom = count + BM25_K1 * (1 - BM25_B + (BM25_B * (docLen[i] ?? 0)) / avgdl);
      out[i] = (out[i] ?? 0) + (idf * (count * (BM25_K1 + 1))) / denom;
    }
  });
  return out;
}

/**
 * Adds the highest-scoring BM25 documents to keep. Existing force-keeps are never
 * removed. Score descending, source order for ties; threshold is relative to the best score.
 */
export function keepQueryRelevant(
  keep: boolean[],
  docs: string[],
  query: string,
  limit: number,
  threshold: number,
): void {
  if (query === "" || docs.length === 0 || keep.length !== docs.length || limit <= 0) {
    return;
  }
  const scores = bm25(query, docs);
  const maxScore = Math.max(0, ...scores);
  if (maxScore === 0) {
    return;
  }
  const candidates = scores
    .map((score, index) => ({ index, score }))
    .filter(({ index, score }) => !keep[index] && score / maxScore >= threshold)
    .toSorted((a, b) => (a.score === b.score ? a.index - b.index : b.score - a.score));
  for (const candidate of candidates.slice(0, limit)) {
    keep[candidate.index] = true;
  }
}
