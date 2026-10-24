// Always-ask floor for interactive input (atlas SAFETY-0020). The exec floor only sees the launch
// string, so a shell started with pty:true could be handed a floor command later through process
// write, paste, submit or send-keys. This tracks, per session, the line the shell is editing and
// checks every completed line before any byte of the write reaches stdin. A hit asks the owner
// once; without allow-once nothing from that write is sent.
import {
  detectExecHardlineFloor,
  formatExecHardlineFloorWarning,
  MALFORMED_EXEC_DESCRIPTION,
  PARSER_LIMIT_DESCRIPTION,
  type HardlineFinding,
} from "../infra/exec-hardline-floor.js";
import type { ProcessSession } from "./bash-process-registry.js";
import { requestExecFloorApproval } from "./bash-tools.exec-floor-approval.js";

type LineState = { line: string; killed: string; pending: string };

const lineStates = new WeakMap<ProcessSession, LineState>();
const MAX_PENDING_CHARS = 64 * 1024;
// CSI, OSC, SS3 and two-byte escapes (arrow keys, bracketed-paste markers) carry no command text.
const ESCAPE_SEQUENCE_RE =
  // oxlint-disable-next-line eslint/no-control-regex -- terminal escape sequences are the input here.
  /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|O.|[@-Z\\-_])/g;
// A trailing unescaped backslash continues the line in the shell.
const CONTINUED_LINE_RE = /(?:^|[^\\])(?:\\\\)*\\$/;

export type ProcessInputScan = {
  finding: HardlineFinding | null;
  line: string;
  /** Record the edited line state once the write is allowed. */
  commit: () => void;
};

/** Apply input to the session's line state and check each completed line against the floor. */
export function scanProcessInputForFloor(
  session: ProcessSession,
  data: string | Buffer,
): ProcessInputScan {
  const state: LineState = {
    ...(lineStates.get(session) ?? { line: "", killed: "", pending: "" }),
  };
  // Assigned inside complete(); the cast keeps the declared union instead of narrowing to null.
  let hit = null as { finding: HardlineFinding; line: string } | null;
  const complete = () => {
    const candidate = state.pending ? `${state.pending}\n${state.line}` : state.line;
    state.line = "";
    if (!candidate.trim()) {
      state.pending = "";
      return;
    }
    const continued = CONTINUED_LINE_RE.test(candidate);
    const finding = continued ? null : detectExecHardlineFloor(candidate);
    // An open quote or a trailing backslash keeps the shell reading; check the joined command.
    if (continued || finding?.description === MALFORMED_EXEC_DESCRIPTION) {
      state.pending = candidate;
      if (candidate.length > MAX_PENDING_CHARS) {
        hit ??= { finding: { description: PARSER_LIMIT_DESCRIPTION }, line: candidate };
      }
      return;
    }
    state.pending = "";
    if (finding) {
      hit ??= { finding, line: candidate };
    }
  };
  const text = (typeof data === "string" ? data : data.toString("utf8")).replace(
    ESCAPE_SEQUENCE_RE,
    "",
  );
  for (const ch of text) {
    if (ch === "\r" || ch === "\n") {
      complete();
    } else if (ch === "\x7f" || ch === "\b") {
      state.line = state.line.slice(0, -1);
    } else if (ch === "\x03") {
      state.line = "";
      state.pending = "";
    } else if (ch === "\x15") {
      state.killed = state.line;
      state.line = "";
    } else if (ch === "\x17") {
      const word = /\S+\s*$/.exec(state.line);
      if (word) {
        state.killed = word[0];
        state.line = state.line.slice(0, word.index);
      }
    } else if (ch === "\x19") {
      state.line += state.killed;
    } else if (ch >= " " || ch === "\t") {
      state.line += ch;
    }
  }
  return {
    finding: hit?.finding ?? null,
    line: hit?.line ?? "",
    commit: () => lineStates.set(session, state),
  };
}

export type ProcessInputGate =
  | { allowed: true; commit: () => void }
  | { allowed: false; message: string };

/** Check input for a running session; a floor hit needs the owner's allow-once first. */
export async function gateProcessInput(params: {
  session: ProcessSession;
  sessionId: string;
  data: string | Buffer;
  toolCallId?: string;
}): Promise<ProcessInputGate> {
  const scan = scanProcessInputForFloor(params.session, params.data);
  if (!scan.finding) {
    return { allowed: true, commit: scan.commit };
  }
  const outcome = await requestExecFloorApproval({
    command: scan.line,
    finding: scan.finding,
    source: `input written to running session ${params.sessionId}`,
    workdir: params.session.cwd,
    agentId: params.session.agentId,
    sessionKey: params.session.sessionKey,
    toolCallId: params.toolCallId,
  });
  if (outcome.approved) {
    return { allowed: true, commit: scan.commit };
  }
  return {
    allowed: false,
    message: `Input not written to session ${params.sessionId}. ${formatExecHardlineFloorWarning(scan.finding)} Approval was not granted (${outcome.reason}); nothing from this call was sent.`,
  };
}
