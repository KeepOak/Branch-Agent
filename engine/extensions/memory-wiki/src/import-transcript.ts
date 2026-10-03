// Active-branch insight parsing adapted from the pinned OpenClaw importer.
export type TranscriptTurn = {
  role: "user" | "assistant";
  text: string;
};

export function parseTranscriptTurns(body: string): TranscriptTurn[] {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === "## Active Branch Transcript");
  if (start < 0) {
    return [];
  }
  const turns: TranscriptTurn[] = [];
  let currentRole: TranscriptTurn["role"] | null = null;
  let currentLines: string[] = [];
  let fence: { marker: string; length: number } | undefined;
  const flush = () => {
    if (currentRole) {
      const text = currentLines.join("\n").trim();
      if (text) {
        turns.push({ role: currentRole, text });
      }
    }
    currentLines = [];
  };

  for (const [offset, rawLine] of lines.slice(start + 1).entries()) {
    const line = rawLine.trimEnd();
    const fenced = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    const notesHeading = /^ {0,3}## Notes[ \t]*$/.test(line);
    // The importer appends this exact host marker even after an unclosed fence.
    const hostNotes = lines[start + offset + 2]?.trim() === "<!-- branch:human:start -->";
    if (notesHeading && (!fence || hostNotes)) {
      break;
    }
    if (fence) {
      if (currentRole) {
        currentLines.push(line);
      }
      // A closing fence has the same marker, at least the opener's length,
      // and no info string. Shorter/different fences remain message content.
      if (fenced && fenced[1]![0] === fence.marker &&
          fenced[1]!.length >= fence.length && fenced[2]!.trim() === "") {
        fence = undefined;
      }
      continue;
    }
    if (fenced && !(fenced[1]![0] === "`" && fenced[2]!.includes("`"))) {
      fence = { marker: fenced[1]![0]!, length: fenced[1]!.length };
      if (currentRole) {
        currentLines.push(line);
      }
      continue;
    }
    // ChatGPT source pages put their human Notes after the full transcript.
    // Other Markdown headings belong to the current turn, not the host page.
    const speaker = /^ {0,3}### (User|Assistant)[ \t]*$/.exec(line);
    if (speaker) {
      flush();
      currentRole = speaker[1] === "User" ? "user" : "assistant";
      continue;
    }
    if (currentRole) {
      currentLines.push(line);
    }
  }
  flush();
  return turns;
}
