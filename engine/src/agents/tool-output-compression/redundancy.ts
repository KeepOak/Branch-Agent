// From JuliusBrussee/caveman@b39c90862855ad2f0813ce775b8bf07a9d6d2a50:engine/compressors/redundancy.go (atlas AGENT-LOOP-0349).
// Guarantees every distinct kind of content survives an elision at least once; it
// separates eliding repetition from truncating a document. Deterministic in document order.

/** Share of a dropped unit's vocabulary one surviving unit must carry to represent it. */
const REDUNDANT_UNIT_CONTAINMENT = 0.9;
/** How many already-kept units seed the class list. */
const REDUNDANCY_MAX_CLASSES = 64;
/** First-of-their-kind promotions before the payload is treated as a document and kept. */
const REDUNDANCY_MAX_PROMOTIONS = 128;
/** Vocabulary bound per unit, so one long line cannot make the gate quadratic. */
const REDUNDANCY_MAX_UNIT_TOKENS = 128;
/** Letter-bearing tokens a unit needs before digit masking is applied. */
const REDUNDANCY_MIN_WORD_TOKENS = 1;

type Profile = { vocab: Set<string>; masked: boolean };

const DIGIT = /\p{Nd}/u;
const LETTER = /\p{L}/u;

function tokenize(unit: string, maskDigits: boolean): { vocab: Set<string>; words: number } {
  const vocab = new Set<string>();
  let words = 0;
  let token = "";
  let hasLetter = false;
  let inDigits = false;
  const flush = () => {
    if (token.length > 0 && !vocab.has(token)) {
      vocab.add(token);
      words += hasLetter ? 1 : 0;
    }
    token = "";
    hasLetter = false;
    inDigits = false;
  };
  for (const char of unit.toLowerCase()) {
    if (DIGIT.test(char)) {
      if (!maskDigits) {
        token += char;
      } else if (!inDigits) {
        token += "#";
        inDigits = true;
      }
    } else if (LETTER.test(char) || char === "_") {
      token += char;
      hasLetter = true;
      inDigits = false;
    } else {
      flush();
    }
    if (vocab.size >= REDUNDANCY_MAX_UNIT_TOKENS) {
      return { vocab, words };
    }
  }
  flush();
  return { vocab, words };
}

function unitVocabulary(unit: string): Profile {
  const masked = tokenize(unit, true);
  if (masked.words >= REDUNDANCY_MIN_WORD_TOKENS) {
    return { vocab: masked.vocab, masked: true };
  }
  return { vocab: tokenize(unit, false).vocab, masked: false };
}

function representedBy(dropped: Profile, classes: Profile[]): boolean {
  if (dropped.vocab.size === 0) {
    return true;
  }
  const need = Math.trunc(REDUNDANT_UNIT_CONTAINMENT * dropped.vocab.size + 0.999999);
  return classes.some((profile) => {
    if (profile.masked !== dropped.masked) {
      return false;
    }
    let hit = 0;
    for (const token of dropped.vocab) {
      if (profile.vocab.has(token) && ++hit >= need) {
        return true;
      }
    }
    return false;
  });
}

function seedClasses(units: string[], keep: boolean[]): Profile[] {
  const kept = keep.flatMap((value, index) => (value ? [index] : []));
  const step =
    kept.length > REDUNDANCY_MAX_CLASSES ? Math.trunc(kept.length / REDUNDANCY_MAX_CLASSES) : 1;
  const classes: Profile[] = [];
  for (let n = 0; n < kept.length && classes.length < REDUNDANCY_MAX_CLASSES; n += step) {
    classes.push(unitVocabulary(units[kept[n] ?? 0] ?? ""));
  }
  return classes;
}

/** Keeps the first unit of every class no surviving unit already represents. */
export function keepNonRedundant(units: string[], keep: boolean[]): void {
  if (units.length !== keep.length) {
    return;
  }
  const classes = seedClasses(units, keep);
  let promotions = 0;
  units.forEach((unit, i) => {
    if (keep[i]) {
      return;
    }
    if (promotions >= REDUNDANCY_MAX_PROMOTIONS) {
      keep[i] = true;
      return;
    }
    const vocab = unitVocabulary(unit);
    if (representedBy(vocab, classes)) {
      return;
    }
    keep[i] = true;
    promotions++;
    classes.push(vocab);
  });
}
