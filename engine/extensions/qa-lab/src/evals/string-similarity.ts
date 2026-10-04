// Adapted from aceakash/string-similarity@41b2e0682f32cbd3c64eda62070fd2fdbddab381 src/index.js
// (compareTwoStrings, the Dice coefficient over character bigrams that mastra's scorers call).

/** Dice coefficient of two strings over bigrams, ignoring whitespace. Returns 0..1. */
export function compareTwoStrings(firstInput: string, secondInput: string): number {
  const first = firstInput.replace(/\s+/g, "");
  const second = secondInput.replace(/\s+/g, "");

  if (first === second) {
    return 1; // identical or empty
  }
  if (first.length < 2 || second.length < 2) {
    return 0; // a 0-letter or 1-letter string
  }

  const firstBigrams = new Map<string, number>();
  for (let i = 0; i < first.length - 1; i += 1) {
    const bigram = first.substring(i, i + 2);
    firstBigrams.set(bigram, (firstBigrams.get(bigram) ?? 0) + 1);
  }

  let intersectionSize = 0;
  for (let i = 0; i < second.length - 1; i += 1) {
    const bigram = second.substring(i, i + 2);
    const count = firstBigrams.get(bigram) ?? 0;
    if (count > 0) {
      firstBigrams.set(bigram, count - 1);
      intersectionSize += 1;
    }
  }

  return (2.0 * intersectionSize) / (first.length + second.length - 2);
}
