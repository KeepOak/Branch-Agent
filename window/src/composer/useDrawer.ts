// Which list opens above the box for what is typed (DESIGN-SPEC §4.3.5): the slash drawer at the start, a
// command's choices after it, the Skills popover for a mid-message "/", and the mention popover for "@".
import { useCallback, useEffect, useState } from "react";
import { agentOf, errorText, list, rec, str, type WindowEngine } from "./engine";
import { invocationName } from "../display-names";
import { matches, skillTokenAt, tokenAt, type Token } from "./mention";
import { argQuery, filterChoices, filterCommands, readCommands, slashQuery, type SlashCommand } from "./slash";
import type { DrawerRow } from "./SlashDrawer";
import type { Level } from "./model";
import type { Trunk } from "./useConversation";

export type Pick =
  | { kind: "command"; command: SlashCommand }
  | { kind: "choice"; command: SlashCommand; value: string }
  | { kind: "skill"; token: Token; name: string }
  | { kind: "trunk"; token: Token; name: string }
  | { kind: "person"; token: Token; name: string; profileId: string }
  | { kind: "context"; token: Token; key: ContextKey };

/** "@" adds context (the preview's CTX list, Cline's and Claude Code's @-mentions). */
export type ContextKey = "file" | "folder" | "diff" | "git" | "url" | "web" | "conversation";
export const CONTEXT: ReadonlyArray<{ key: ContextKey; icon: string; title: string; line: string }> = [
  { key: "file", icon: "doc", title: "A file", line: "Its text goes with the message" },
  { key: "folder", icon: "folder", title: "A folder", line: "What’s in it, as a list" },
  { key: "diff", icon: "edit", title: "Changes not yet saved", line: "Your uncommitted changes" },
  { key: "git", icon: "branch", title: "Recent commits", line: "The last few, with their messages" },
  { key: "url", icon: "link", title: "A web page", line: "It reads the page once" },
  { key: "web", icon: "search", title: "Search the web", line: "It searches before it answers" },
  { key: "conversation", icon: "chat", title: "Another conversation", line: "It may read that conversation for this task" },
];

export type DrawerView = { kind: "slash" | "mention" | "skills"; label: string; rows: DrawerRow[]; picks: Pick[]; groups: Array<string | undefined>; footer?: string };

type Person = { profileId: string; name: string };

function useCatalogs(engine: WindowEngine | undefined) {
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const [skills, setSkills] = useState<string[]>([]);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const agentId = engine?.agentId ?? agentOf(engine?.sessionKey);
  useEffect(() => {
    setPeople(null);
    setPeopleError(null);
  }, [engine?.sessionKey]);
  useEffect(() => {
    if (!engine) return;
    const params = agentId ? { agentId, includeArgs: true, scope: "text" } : { includeArgs: true, scope: "text" };
    engine.request("commands.list", params).then((r) => setCommands(readCommands(r)), (e: unknown) => console.warn("commands.list failed:", errorText(e)));
    engine
      .request("skills.status", agentId ? { agentId } : {})
      .then((r) => setSkills(list(rec(r).skills).filter((s) => s.userInvocable !== false && s.eligible !== false && s.disabled !== true).map((s) => str(s.name))), (e: unknown) => console.warn("skills.status failed:", errorText(e)));
  }, [engine, agentId]);
  const loadPeople = useCallback(() => {
    if (!engine?.sessionKey || people !== null) return;
    engine.request("users.mentionable", { sessionKey: engine.sessionKey }).then(
      (r) => setPeople(list(rec(r).users).map((u) => ({ profileId: str(u.profileId), name: str(u.displayName) }))),
      (e: unknown) => {
        // A conversation with no first message yet has no one in it to tell; it is asked again next time.
        if (!/not found|unknown session/i.test(errorText(e))) setPeopleError(`Couldn't load People. Try again. (${errorText(e)})`);
      },
    );
  }, [engine, people]);
  return { commands, skills, people, peopleError, loadPeople };
}

function slashView(text: string, commands: SlashCommand[], levels: Level[], current: Record<string, string>): DrawerView | null {
  const arg = argQuery(text, commands);
  if (arg) {
    const all = arg.command.dynamic ? levels.map((l) => ({ value: l.id, label: l.label })) : arg.command.choices;
    const choices = filterChoices(all, arg.prefix);
    if (choices.length === 0) return null;
    return {
      kind: "slash",
      label: "Commands and saved prompts",
      rows: choices.map((c) => ({ id: c.value, main: c.value, line: c.label !== c.value ? c.label : undefined, checked: current[arg.command.name] === c.value })),
      picks: choices.map((c) => ({ kind: "choice", command: arg.command, value: c.value })),
      groups: [],
    };
  }
  const q = slashQuery(text);
  if (q === null) return null;
  const found = filterCommands(commands, q);
  if (found.length === 0) return null;
  return {
    kind: "slash",
    label: "Commands and saved prompts",
    rows: found.map((c) => ({ id: c.name, main: `/${c.name}`, hint: c.hint, line: c.description, owner: c.owner })),
    picks: found.map((c) => ({ kind: "command", command: c })),
    groups: [],
    footer: "The same commands work on the phone, in the terminal and in chat apps.",
  };
}

export function useDrawer(engine: WindowEngine | undefined, trunks: Trunk[], levels: Level[], current: Record<string, string>) {
  const cat = useCatalogs(engine);
  const view = useCallback(
    (text: string, caret: number): DrawerView | null => {
      const slash = slashView(text, cat.commands, levels, current);
      if (slash) return slash;
      const skill = skillTokenAt(text, caret);
      if (skill) {
        const names = cat.skills.filter((n) => matches(invocationName(n), skill.query));
        if (names.length === 0) return null;
        return { kind: "skills", label: "Skills", rows: names.map((n) => ({ id: n, main: `/${invocationName(n)}` })), picks: names.map((n) => ({ kind: "skill", token: skill, name: n })), groups: [] };
      }
      const at = tokenAt(text, caret, "@");
      if (!at) return null;
      const ts = trunks.filter((t) => matches(t.name, at.query));
      const ps = (cat.people ?? []).filter((x) => matches(x.name, at.query));
      const cx = CONTEXT.filter((c) => !at.query || c.key.startsWith(at.query) || c.title.toLowerCase().includes(at.query));
      if (ts.length + ps.length + cx.length === 0) return null;
      return {
        kind: "mention",
        label: "Call a Trunk",
        rows: [
          ...ts.map((t) => ({ id: `t:${t.id}`, main: t.name, face: t.name })),
          ...ps.map((x) => ({ id: `p:${x.profileId}`, main: x.name })),
          ...cx.map((c) => ({ id: `c:${c.key}`, main: `@${c.key}`, line: `${c.title} · ${c.line}`, icon: c.icon })),
        ],
        picks: [
          ...ts.map((t): Pick => ({ kind: "trunk", token: at, name: t.name })),
          ...ps.map((x): Pick => ({ kind: "person", token: at, name: x.name, profileId: x.profileId })),
          ...cx.map((c): Pick => ({ kind: "context", token: at, key: c.key })),
        ],
        groups: [...ts.map(() => undefined), ...ps.map((_, i) => (i === 0 ? "People" : undefined)), ...cx.map((_, i) => (i === 0 ? "Add as context" : undefined))],
      };
    },
    [cat, trunks, levels, current],
  );
  return { view, commands: cat.commands, skills: cat.skills, peopleError: cat.peopleError, loadPeople: cat.loadPeople };
}
