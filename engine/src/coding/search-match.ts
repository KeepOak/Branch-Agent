// Adapted from continuedev/continue@5522c6f44ca0ac3528b37244818fbfa39b5af470
// core/edit/searchAndReplace/findSearchMatch.ts; active strategies retained.
/**
 * Represents a basic match result with start and end character positions
 */
interface BasicMatchResult {
  /** The starting character index of the match in the file content */
  startIndex: number;
  /** The ending character index of the match in the file content (NOT inclusive - e.g. like slice)*/
  endIndex: number;
}

/**
 * Represents a match result with start and end character positions
 */
export interface SearchMatchResult extends BasicMatchResult {
  /** The name of the strategy that successfully matched */
  strategyName: string;
}

/**
 * Strategy function type for finding matches
 */
type MatchStrategy = (fileContent: string, searchContent: string) => BasicMatchResult | null;

/**
 * Exact string matching strategy
 */
function exactMatch(fileContent: string, searchContent: string): BasicMatchResult | null {
  const exactIndex = fileContent.indexOf(searchContent);
  if (exactIndex !== -1) {
    return {
      startIndex: exactIndex,
      endIndex: exactIndex + searchContent.length,
    };
  }
  return null;
}

/**
 * Trimmed content matching strategy
 */
function trimmedMatch(fileContent: string, searchContent: string): BasicMatchResult | null {
  const trimmedSearchContent = searchContent.trim();
  const trimmedIndex = fileContent.indexOf(trimmedSearchContent);
  if (trimmedIndex !== -1) {
    return {
      startIndex: trimmedIndex,
      endIndex: trimmedIndex + trimmedSearchContent.length,
    };
  }
  return null;
}

/**
 * Case-insensitive matching strategy
 */
function caseInsensitiveMatch(fileContent: string, searchContent: string): BasicMatchResult | null {
  const offsets: Array<{ start: number; end: number }> = [];
  let originalOffset = 0;
  for (const character of fileContent) {
    const folded = character.toLowerCase();
    offsets.push(
      ...Array.from({ length: folded.length }, () => ({
        start: originalOffset,
        end: originalOffset + character.length,
      })),
    );
    originalOffset += character.length;
  }
  const lowerFileContent = fileContent.toLowerCase();
  const lowerSearchContent = searchContent.toLowerCase();
  const index = lowerFileContent.indexOf(lowerSearchContent);
  if (index !== -1) {
    return {
      startIndex: offsets[index]!.start,
      endIndex: offsets[index + lowerSearchContent.length - 1]!.end,
    };
  }
  return null;
}

/**
 * Whitespace-ignored matching strategy
 * Removes all whitespace from both content and search, then finds the match
 */
function whitespaceIgnoredMatch(
  fileContent: string,
  searchContent: string,
): BasicMatchResult | null {
  // Remove all whitespace (spaces, tabs, newlines, etc.)
  const strippedFileContent = fileContent.replace(/\s/g, "");
  const strippedSearchContent = searchContent.replace(/\s/g, "");

  if (strippedSearchContent === "") {
    return null; // Empty search after stripping whitespace
  }

  const strippedIndex = strippedFileContent.indexOf(strippedSearchContent);
  if (strippedIndex === -1) {
    return null;
  }

  // Map the stripped position back to the original file content
  let originalStartIndex = -1;
  let strippedCharCount = 0;

  // Find the original start position by counting non-whitespace characters
  for (let i = 0; i < fileContent.length; i++) {
    if (!/\s/.test(fileContent.charAt(i))) {
      if (strippedCharCount === strippedIndex) {
        originalStartIndex = i;
        break;
      }
      strippedCharCount++;
    }
  }

  if (originalStartIndex === -1) {
    return null; // Should not happen if strippedIndex was valid
  }

  // Find the end position by counting through all characters (including whitespace)
  // that correspond to the stripped search content length
  let originalEndIndex = originalStartIndex;
  let matchedNonWhitespaceChars = 0;

  for (let i = originalStartIndex; i < fileContent.length; i++) {
    if (!/\s/.test(fileContent.charAt(i))) {
      matchedNonWhitespaceChars++;
      if (matchedNonWhitespaceChars === strippedSearchContent.length) {
        originalEndIndex = i + 1;
        break;
      }
    }
    // Always update end index to include current position (whether whitespace or not)
    originalEndIndex = i + 1;
  }

  return {
    startIndex: originalStartIndex,
    endIndex: originalEndIndex,
  };
}

/**
 * Ordered list of matching strategies to try with their names
 */
const matchingStrategies: Array<{ strategy: MatchStrategy; name: string }> = [
  { strategy: exactMatch, name: "exactMatch" },
  { strategy: trimmedMatch, name: "trimmedMatch" },
  { strategy: caseInsensitiveMatch, name: "caseInsensitiveMatch" },
  { strategy: whitespaceIgnoredMatch, name: "whitespaceIgnoredMatch" },
  // { strategy: findFuzzyMatch, name: "jaroWinklerFuzzyMatch" },
];

/**
 * Find the exact match position for search content in file content.
 * Uses multiple matching strategies in order of preference.
 *
 * Matching Strategy:
 * 1. If search content is empty, matches at the beginning of file (position 0)
 * 2. Try each matching strategy in order until one succeeds
 *
 * @param fileContent - The complete content of the file to search in
 * @param searchContent - The content to search for
 * @param config - Configuration options for matching behavior
 * @returns Match result with character positions, or null if no match found
 */
export function findSearchMatch(
  fileContent: string,
  searchContent: string,
): SearchMatchResult | null {
  const trimmedSearchContent = searchContent.trim();

  if (trimmedSearchContent === "") {
    // Empty search content matches the beginning of the file
    return { startIndex: 0, endIndex: 0, strategyName: "emptySearch" };
  }

  // Try each matching strategy in order
  for (const { strategy, name } of matchingStrategies) {
    const result = strategy(fileContent, searchContent);
    if (result !== null) {
      return { ...result, strategyName: name };
    }
  }

  return null;
}

/**
 * Find all matches for search content in file content.
 * Uses the same matching strategies as findSearchMatch, applied iteratively.
 *
 * @param fileContent - The complete content of the file to search in
 * @param searchContent - The content to search for
 * @returns Array of match results with character positions, empty array if no matches found
 */
export function findSearchMatches(fileContent: string, searchContent: string): SearchMatchResult[] {
  const matches: SearchMatchResult[] = [];

  // Special case: empty search string always matches at position 0
  if (searchContent.trim() === "") {
    return [{ startIndex: 0, endIndex: 0, strategyName: "emptySearch" }];
  }

  let remainingContent = fileContent;
  let currentOffset = 0;

  while (remainingContent.length > 0) {
    const match = findSearchMatch(remainingContent, searchContent);

    if (match === null) {
      break;
    }

    // Adjust match positions to account for the current offset
    const adjustedMatch: SearchMatchResult = {
      startIndex: match.startIndex + currentOffset,
      endIndex: match.endIndex + currentOffset,
      strategyName: match.strategyName,
    };

    // Prevent infinite loops by ensuring we're making progress
    // If the new match starts at or before the last match's start position, break
    if (matches.length > 0 && adjustedMatch.startIndex <= matches.at(-1)!.startIndex) {
      break;
    }

    matches.push(adjustedMatch);

    // Update offset and truncate content after the current match
    currentOffset = adjustedMatch.endIndex;
    remainingContent = fileContent.slice(currentOffset);
  }

  return matches;
}
