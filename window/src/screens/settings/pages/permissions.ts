// Settings › Permissions: the approved preview's fourteen cards (preview.html PG permissions), in order and at the
// preview's levels. Each card draws the Classic Permissions sections the preview maps to it (set1/permissions-*.tsx), as
// Classic's own blocks without their Classic headings (permissions-live.tsx).
import type { Row } from "../rows";

const block = (id: string, card: string, level: 0 | 1 | 2, calls: string[] = ["config.get", "config.patch"]): Row =>
  ({ id, page: "permissions", card, label: card, level, control: "custom", bare: true, source: { kind: "slot", calls, reason: `${card} comes in a later update.` } });

const FILE = ["exec.approvals.get", "exec.approvals.set", "config.get", "config.patch"];
export const PERMISSIONS_ROWS: Row[] = [
  block("permissions.mode.block", "Mode", 0, ["config.get", "config.patch", "agents.list"]),
  block("permissions.lockdown.block", "Lockdown", 0),
  block("permissions.without.block", "Without asking", 0),
  block("permissions.rules.block", "Rules for each tool and folder", 1, [...FILE, "node.list"]),
  block("permissions.commands.block", "Commands by default", 1, [...FILE, "agents.list"]),
  block("permissions.checks.block", "Checks before anything runs", 1),
  block("permissions.approvals.block", "Approvals", 1, ["exec.approval.list", "approval.history", "config.get", "config.patch"]),
  block("permissions.guards.block", "Guards", 1),
  block("permissions.money.block", "Money", 1),
  block("permissions.connectors.block", "What each connector may do", 1),
  block("permissions.isolation.block", "Isolation and sandbox", 1),
  block("permissions.network.block", "Network and sandbox", 2),
  block("permissions.policy.block", "Company policy", 2),
  block("permissions.privacy.block", "Privacy", 0),
];
