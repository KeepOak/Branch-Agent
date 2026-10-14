// Small shell parser for the always-ask floor (atlas SAFETY-0020): splits a command into
// segments on ; && || | & ( ) and newlines, dequotes words, keeps heredoc bodies with the segment
// that reads them, and returns command substitutions so the caller can scan them again.
// Variable and command expansions become UNRESOLVED in a word's value; $HOME at the start of a
// word becomes ~ so the home rules can resolve it.

/** Marks a part of a word the floor cannot resolve statically. */
export const UNRESOLVED = "\u0001";

export type Word = { value: string; literal: string; unresolved: boolean; substitutions: string[] };
export type Segment = {
  words: Word[];
  redirects: Word[];
  hereDocs: string[];
  pipedFrom: Segment | null;
};

function findBacktickEnd(text: string, start: number): number {
  for (let j = start + 1; j < text.length; j++) {
    if (text[j] === "\\") {
      j++;
    } else if (text[j] === "\x60") {
      return j;
    }
  }
  return text.length;
}

function skipDouble(text: string, start: number): number {
  for (let j = start + 1; j < text.length; j++) {
    const ch = text.charAt(j);
    if (ch === "\\") {
      j++;
    } else if (ch === '"') {
      return j;
    } else if (ch === "$" && text[j + 1] === "(") {
      j = matchParen(text, j + 1);
    } else if (ch === "\x60") {
      j = findBacktickEnd(text, j);
    }
  }
  return text.length;
}

function matchParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text.charAt(i);
    if (ch === "\\") {
      i++;
    } else if (ch === "'") {
      const end = text.indexOf("'", i + 1);
      i = end < 0 ? text.length : end;
    } else if (ch === '"') {
      i = skipDouble(text, i);
    } else if (ch === "\x60") {
      i = findBacktickEnd(text, i);
    } else if (ch === "(") {
      depth++;
    } else if (ch === ")" && --depth === 0) {
      return i;
    }
  }
  return text.length;
}

function decodeAnsiC(body: string): string {
  return body.replace(/\\(x[0-9a-fA-F]{1,2}|[0-7]{1,3}|.)/g, (_m, esc: string) => {
    if (esc[0] === "x") {
      return String.fromCharCode(Number.parseInt(esc.slice(1), 16));
    }
    if (/^[0-7]/.test(esc)) {
      return String.fromCharCode(Number.parseInt(esc, 8));
    }
    return ({ n: "\n", t: "\t", r: "\r" } as Record<string, string>)[esc] ?? esc;
  });
}

class WordBuilder {
  value = "";
  literal = "";
  unresolved = false;
  quoted = false;
  started = false;
  substitutions: string[] = [];
  add(text: string): void {
    this.value += text;
    this.literal += text;
    this.started = true;
  }
  addUnresolved(raw: string): void {
    this.value += UNRESOLVED;
    this.literal += raw;
    this.unresolved = true;
    this.started = true;
  }
  addHome(raw: string): void {
    if (this.value === "") {
      this.value = "~";
      this.literal += raw;
      this.started = true;
    } else {
      this.addUnresolved(raw);
    }
  }
}

/** Split a command into segments of dequoted words; substitutions are returned for rescans. */
export function parseShell(text: string): { segments: Segment[]; substitutions: string[] } {
  const segments: Segment[] = [];
  const substitutions: string[] = [];
  const newSegment = (pipedFrom: Segment | null): Segment => ({
    words: [],
    redirects: [],
    hereDocs: [],
    pipedFrom,
  });
  let seg = newSegment(null);
  let word = new WordBuilder();
  let redirect: null | "target" | "heredoc" | "herestring" = null;
  let heredocStrip = false;
  const pendingHeredocs: Array<{ delimiter: string; strip: boolean; segment: Segment }> = [];

  const flush = () => {
    if (!word.started) {
      return;
    }
    const done: Word = {
      value: word.value,
      literal: word.literal,
      unresolved: word.unresolved,
      substitutions: word.substitutions,
    };
    if (redirect === "target") {
      seg.redirects.push(done);
    } else if (redirect === "heredoc") {
      pendingHeredocs.push({ delimiter: done.literal, strip: heredocStrip, segment: seg });
    } else if (redirect === "herestring") {
      seg.hereDocs.push(done.literal);
    } else {
      seg.words.push(done);
    }
    redirect = null;
    word = new WordBuilder();
  };
  const endSegment = (pipe: boolean) => {
    flush();
    const ended = seg;
    if (ended.words.length || ended.redirects.length || ended.hereDocs.length) {
      segments.push(ended);
    }
    seg = newSegment(pipe ? ended : null);
  };
  const substitute = (inner: string, raw: string) => {
    substitutions.push(inner);
    word.substitutions.push(inner);
    word.addUnresolved(raw);
  };
  const readDollar = (i: number): number => {
    const next = text[i + 1];
    if (next === "(") {
      const end = matchParen(text, i + 1);
      if (text[i + 2] === "(") {
        word.addUnresolved(text.slice(i, end + 1));
      } else {
        substitute(text.slice(i + 2, end), text.slice(i, end + 1));
      }
      return end;
    }
    if (next === "{") {
      const close = text.indexOf("}", i + 2);
      const end = close < 0 ? text.length : close;
      const raw = text.slice(i, end + 1);
      if (text.slice(i + 2, end) === "HOME") {
        word.addHome(raw);
      } else {
        word.addUnresolved(raw);
      }
      return end;
    }
    if (next === "'") {
      const close = text.indexOf("'", i + 2);
      const end = close < 0 ? text.length : close;
      word.add(decodeAnsiC(text.slice(i + 2, end)));
      word.quoted = true;
      return end;
    }
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i + 1))?.[0];
    if (name) {
      if (name === "HOME") {
        word.addHome(text.slice(i, i + 1 + name.length));
      } else {
        word.addUnresolved(text.slice(i, i + 1 + name.length));
      }
      return i + name.length;
    }
    if (next !== undefined && /[0-9@*#?$!-]/.test(next)) {
      word.addUnresolved(text.slice(i, i + 2));
      return i + 1;
    }
    word.add("$");
    return i;
  };
  const readDouble = (start: number): number => {
    word.quoted = true;
    word.started = true;
    for (let j = start + 1; j < text.length; j++) {
      const ch = text.charAt(j);
      if (ch === "\\") {
        const esc = text[j + 1];
        if (esc !== undefined && '"\\$\x60'.includes(esc)) {
          word.add(esc);
        } else if (esc !== "\n") {
          word.add("\\" + (esc ?? ""));
        }
        j++;
      } else if (ch === '"') {
        return j;
      } else if (ch === "$") {
        j = readDollar(j);
      } else if (ch === "\x60") {
        const end = findBacktickEnd(text, j);
        substitute(text.slice(j + 1, end), text.slice(j, end + 1));
        j = end;
      } else {
        word.add(ch);
      }
    }
    return text.length;
  };
  const consumeHeredocs = (from: number): number => {
    let pos = from;
    for (const doc of pendingHeredocs.splice(0)) {
      const body: string[] = [];
      while (pos < text.length) {
        const nl = text.indexOf("\n", pos);
        const line = text.slice(pos, nl < 0 ? text.length : nl);
        pos = nl < 0 ? text.length : nl + 1;
        if ((doc.strip ? line.replace(/^\t+/, "") : line) === doc.delimiter) {
          break;
        }
        body.push(line);
      }
      doc.segment.hereDocs.push(body.join("\n"));
    }
    return pos;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (ch === "\\") {
      if (text[i + 1] !== "\n" && i + 1 < text.length) {
        word.add(text.charAt(i + 1));
      }
      i++;
    } else if (ch === "'") {
      const close = text.indexOf("'", i + 1);
      const end = close < 0 ? text.length : close;
      word.add(text.slice(i + 1, end));
      word.quoted = true;
      i = end;
    } else if (ch === '"') {
      i = readDouble(i);
    } else if (ch === "\x60") {
      const end = findBacktickEnd(text, i);
      substitute(text.slice(i + 1, end), text.slice(i, end + 1));
      i = end;
    } else if (ch === "$") {
      i = readDollar(i);
    } else if (ch === " " || ch === "\t") {
      flush();
    } else if (ch === "\n") {
      endSegment(false);
      i = consumeHeredocs(i + 1) - 1;
    } else if (ch === ";") {
      endSegment(false);
    } else if (ch === "&") {
      if (text[i + 1] === ">") {
        flush();
        i += text[i + 2] === ">" ? 2 : 1;
        redirect = "target";
      } else {
        endSegment(false);
        if (text[i + 1] === "&") {
          i++;
        }
      }
    } else if (ch === "|") {
      if (text[i + 1] === "|") {
        endSegment(false);
        i++;
      } else {
        if (text[i + 1] === "&") {
          i++;
        }
        endSegment(true);
      }
    } else if (ch === "(" || ch === ")") {
      endSegment(false);
    } else if (ch === "<" || ch === ">") {
      if (text[i + 1] === "(") {
        const end = matchParen(text, i + 1);
        substitute(text.slice(i + 2, end), text.slice(i, end + 1));
        i = end;
        continue;
      }
      if (word.started && !word.quoted && /^\d+$/.test(word.literal)) {
        word = new WordBuilder();
      } else {
        flush();
      }
      if (text.startsWith("<<<", i)) {
        redirect = "herestring";
        i += 2;
      } else if (text.startsWith("<<", i)) {
        heredocStrip = text[i + 2] === "-";
        redirect = "heredoc";
        i += heredocStrip ? 2 : 1;
      } else {
        if (">|&".includes(text[i + 1] ?? " ") || (ch === "<" && text[i + 1] === ">")) {
          i++;
        }
        redirect = "target";
      }
    } else if (ch === "#" && !word.started) {
      const nl = text.indexOf("\n", i);
      i = (nl < 0 ? text.length : nl) - 1;
    } else {
      word.add(ch);
    }
  }
  endSegment(false);
  return { segments, substitutions };
}
