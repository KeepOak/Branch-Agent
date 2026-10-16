// Test fixture only (Private #1103 item 2): the expanded work-steps list and the Pair a phone dialog, each fed a very
// long code, path and step, at a narrow width. scripts/playwright-visual-routes.mjs opens it as ?overflow=steps or
// ?overflow=pair and fails if any descendant's box runs past the panel or the dialog.
import { StepsList } from "../src/screens/chat/Steps";
import { PairDialog } from "../src/places/customize/pairing";
import type { WindowEngine } from "../src/connect/engine";
import type { Block } from "../src/thread/model";
import "../src/glass/glass.css";
import "../src/thread/thread.css";
import "../src/screens/chat/chat.css";
import "../src/places/customize/customize.css";

type Step = Extract<Block, { kind: "step" }>;
const LONG_TOKEN = "eyJ1cmwiOiJ3c3M6Ly9icmFuY2gtZ2F0ZXdheS5leGFtcGxlLnRzLm5ldDoxODc4OSIsImJvb3RzdHJhcFRva2VuIjoi" + "Zm9vYmFyYmF6cXV4".repeat(14);
const LONG_PATH = "/Users/someone/Documents/projects/example-app/src/screens/chat/very-long-folder-name-without-any-breaks/" + "a".repeat(80) + ".tsx";
const LONG_COMMAND = "./node_modules/.bin/vitest run --reporter=verbose --pool=forks " + "src/screens/chat/" + "x".repeat(140) + ".test.tsx";

const OVERFLOW_STEPS: Step[] = [
  { kind: "step", key: "o1", tool: "read", title: LONG_PATH, detail: "", status: "ok", input: JSON.stringify({ path: LONG_PATH }), output: LONG_TOKEN },
  { kind: "step", key: "o2", tool: "exec", title: LONG_COMMAND, detail: "Exit 1", status: "failed", input: JSON.stringify({ command: LONG_COMMAND }), output: "Error: ENOENT: no such file or directory, open '" + LONG_PATH + "'" },
  { kind: "step", key: "o3", tool: "edit", title: "Edited " + LONG_PATH, detail: "", status: "ok", changes: [{ path: LONG_PATH, added: 12, removed: 3 }] },
  { kind: "step", key: "o4", tool: "web_fetch", title: "https://example.com/" + "segment/".repeat(30) + "?q=" + LONG_TOKEN, detail: "", status: "ok", output: "ok" },
];

const pairEngine = {
  sessionKey: "agent:main:main", agentId: "main", scopes: ["operator.admin"],
  request: async (method: string) => {
    if (method === "device.pair.setupCode") return { setupId: "s1", setupCode: LONG_TOKEN, qrDataUrl: "", joinUrl: "branch://join?code=" + LONG_TOKEN, expiresAtMs: Date.UTC(2026, 9, 16, 22, 0), accessDowngraded: true };
    return {};
  },
  onEvent: () => () => undefined,
} as unknown as WindowEngine;

export function OverflowPreview({ kind }: { kind: string }) {
  if (kind === "pair") return <PairDialog engine={pairEngine} close={() => undefined} />;
  return <div data-testid="overflow-panel" style={{ width: 360, padding: 12, background: "var(--bg, #f6f6f4)", boxSizing: "border-box" }}>
    <div className="r1c"><div className="r1c-row r1c-b"><div className="r1c-gut" /><div className="r1c-body">
      <StepsList steps={OVERFLOW_STEPS} live={false} mode="verbose" />
    </div></div></div>
  </div>;
}
