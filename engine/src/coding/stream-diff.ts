// Adapted from continuedev/continue@5522c6f44ca0ac3528b37244818fbfa39b5af470
// core/diff/streamDiff.ts and the matching portion of core/diff/util.ts.
// Synchronous iterator adaptation for the existing cumulative tool-argument caller.
import { distance } from "./continue-levenshtein.js";
export type DiffType = "same" | "new" | "old";
export type DiffLine = { type: DiffType; line: string };

export type MatchLineResult = {
  /**
   * -1 if it's a new line, otherwise the index of the first match
   * in the old lines.
   */
  matchIndex: number;
  isPerfectMatch: boolean;
  newLine: string;
};

function linesMatchPerfectly(lineA: string, lineB: string): boolean {
  return lineA === lineB && lineA !== "";
}

const END_BRACKETS = new Set(["}", "});", "})"]);

function linesMatch(lineA: string, lineB: string, linesBetween = 0): boolean {
  // Require a perfect (without padding) match for these lines
  // Otherwise they are edit distance 1 from empty lines and other single char lines (e.g. each other)
  if (["}", "*", "});", "})"].includes(lineA.trim())) {
    return lineA.trim() === lineB.trim();
  }

  const d = distance(lineA, lineB);

  return (
    // Should be more unlikely for lines to fuzzy match if they are further away
    (d / Math.max(lineA.length, lineB.length) <= Math.max(0, 0.48 - linesBetween * 0.06) ||
      lineA.trim() === lineB.trim()) &&
    lineA.trim() !== ""
  );
}

/**
 * Used to find a match for a new line in an array of old lines.
 *
 * Return the index of the first match and whether it is a perfect match
 * Also return a version of the line with correct indentation if needs fixing
 */
export function matchLine(
  newLine: string,
  oldLines: string[],
  permissiveAboutIndentation = false,
): MatchLineResult {
  // Only match empty lines if it's the next one:
  if (newLine.trim() === "" && oldLines[0]?.trim() === "") {
    return {
      matchIndex: 0,
      isPerfectMatch: true,
      newLine: newLine.trim(),
    };
  }

  const isEndBracket = END_BRACKETS.has(newLine.trim());

  for (let i = 0; i < oldLines.length; i++) {
    // trims trailing whitespaces from the lines before comparison
    //this ensures trailing spaces don't affect matching.
    const oldLineTrimmed = oldLines[i]!.trimEnd();
    const newLineTrimmed = newLine.trimEnd();

    // Don't match end bracket lines if too far away
    if (i > 4 && isEndBracket) {
      return { matchIndex: -1, isPerfectMatch: false, newLine };
    }

    if (linesMatchPerfectly(newLineTrimmed, oldLineTrimmed)) {
      return { matchIndex: i, isPerfectMatch: true, newLine };
    }
    if (linesMatch(newLineTrimmed, oldLineTrimmed, i)) {
      // This is a way to fix indentation, but only for sufficiently long lines to avoid matching whitespace or short lines
      if (
        newLineTrimmed.trimStart() === oldLineTrimmed.trimStart() &&
        (permissiveAboutIndentation || newLine.trim().length > 8)
      ) {
        return {
          matchIndex: i,
          isPerfectMatch: true,
          newLine: oldLines[i]!,
        };
      }
      return { matchIndex: i, isPerfectMatch: false, newLine };
    }
  }

  return { matchIndex: -1, isPerfectMatch: false, newLine };
}

/**
 * https://blog.jcoglan.com/2017/02/12/the-myers-diff-algorithm-part-1/
 * Invariants:
 * - new + same = newLines.length
 * - old + same = oldLinesCopy.length
 * ^ (above two guarantee that all lines get represented)
 * - Lines are always output in order, at least among old and new separately
 * - Old lines in a hunk are always output before the new lines
 */
export function* diffLines(oldLines: string[], newLines: Iterable<string>): Generator<DiffLine> {
  const oldLinesCopy = [...oldLines];

  // If one indentation mistake is made, others are likely. So we are more permissive about matching
  let seenIndentationMistake = false;

  const iterator = newLines[Symbol.iterator]();
  let newLineResult = iterator.next();

  while (oldLinesCopy.length > 0 && !newLineResult.done) {
    const { matchIndex, isPerfectMatch, newLine } = matchLine(
      newLineResult.value,
      oldLinesCopy,
      seenIndentationMistake,
    );

    if (!seenIndentationMistake && newLineResult.value !== newLine) {
      seenIndentationMistake = true;
    }

    let type: DiffType;

    const isNewLine = matchIndex === -1;

    if (isNewLine) {
      type = "new";
    } else {
      // Insert all deleted lines before match
      for (let i = 0; i < matchIndex; i++) {
        yield { type: "old", line: oldLinesCopy.shift()! };
      }
      type = isPerfectMatch ? "same" : "old";
    }

    switch (type) {
      case "new":
        yield { type, line: newLine };
        break;

      case "same":
        yield { type, line: oldLinesCopy.shift()! };
        break;

      case "old":
        yield { type, line: oldLinesCopy.shift()! };
        yield { type: "new", line: newLine };
        break;

      default:
        console.error(`Error streaming diff, unrecognized diff type: ${type}`);
    }
    newLineResult = iterator.next();
  }

  // Once at the edge, only one choice
  if (newLineResult.done && oldLinesCopy.length > 0) {
    for (const oldLine of oldLinesCopy) {
      yield { type: "old", line: oldLine };
    }
  }

  if (!newLineResult.done && oldLinesCopy.length === 0) {
    yield { type: "new", line: newLineResult.value };
    for (let result = iterator.next(); !result.done; result = iterator.next()) {
      yield { type: "new", line: result.value };
    }
  }
}
