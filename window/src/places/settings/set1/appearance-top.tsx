// Settings › Appearance: Light or dark (live mirrors of the open conversation in each mode, and "Match this computer")
// and Theme (the theme now, Browse all N themes, Make your own, Accent colour, More contrast). The light/dark choice
// goes through the window's own theme switch (theme/theme.ts) and, with a signed-in profile, themes.set {mode} too.
import { useEffect, useState } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { effectiveDark, readThemeChoice, setThemeChoice, type ThemeChoice } from "../../../theme/theme";
import { errorText, list, record, visible, type RecordValue } from "../adapter";
import { useResource } from "../hooks";
import { Acts, Btn, Ctl, LinkBtn, Sec, useSaveRunner } from "../kit";
import { ACCENTS } from "./appearance-editor";
import { isHex, SLATE, type Mode, type Pair } from "./appearance-look";
import { rowOf } from "./appearance-rows";
import { SpecRow, type Look } from "./appearance-sections";
import { PALETTE_ICON, Swatch, themeGroup, themeName, type ThemeDesc, type Themes } from "./appearance-themes";

/** The window's light/dark choice, kept in step with the top bar's button. */
export function useThemeChoice(): [ThemeChoice, Mode] {
  const [choice, setChoice] = useState<ThemeChoice>(readThemeChoice);
  const [sys, setSys] = useState(0);
  useEffect(() => {
    const changed = (e: Event) => {
      const detail = (e as CustomEvent<unknown>).detail;
      setChoice(detail === "system" || detail === "light" || detail === "dark" ? detail : readThemeChoice());
    };
    const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
    const flip = () => setSys((n) => n + 1);
    window.addEventListener("branch:theme-change", changed);
    media?.addEventListener("change", flip);
    return () => { window.removeEventListener("branch:theme-change", changed); media?.removeEventListener("change", flip); };
  }, []);
  return [choice, sys >= 0 && effectiveDark(choice) ? "dark" : "light"];
}

/** Words for the mirrors: the open conversation's last message and reply. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  return list(content).map((p) => (typeof p.text === "string" ? p.text : "")).join(" ");
}
function useMirrorWords(engine: WindowEngine): { user: string; reply: string } {
  const [msgs, setMsgs] = useState<RecordValue[]>([]);
  useEffect(() => {
    if (!engine.sessionKey) return;
    let live = true;
    engine.request<RecordValue>("chat.history", { sessionKey: engine.sessionKey, limit: 20 }).then(
      (h) => { if (live) setMsgs(list(h.messages)); },
      (e: unknown) => console.warn("The mirrors show no words: chat.history failed:", errorText(e)),
    );
    return () => { live = false; };
  }, [engine]);
  const last = (role: string) => textOf([...msgs].reverse().find((m) => m.role === role)?.content).replace(/\s+/g, " ").trim();
  return { user: last("user").slice(0, 60) || "Hello", reply: last("assistant").slice(0, 90) || "What should Branch do?" };
}

type TopProps = { engine: WindowEngine; pair: Pair; trunk: string; profile: boolean };

export function LightDarkSec({ engine, pair, trunk, profile }: TopProps) {
  const save = useSaveRunner();
  const [choice] = useThemeChoice();
  const words = useMirrorWords(engine);
  const pick = (c: ThemeChoice) => {
    setThemeChoice(c);
    if (profile) void save(() => engine.request("themes.set", { mode: c }));
  };
  return (
    <Sec title="Light or dark">
      <div className="mirrors ap-k" data-row="Match this computer">
        {(["light", "dark"] as const).map((m) => <Mirror key={m} c={pair[m]} label={`${m === "dark" ? "Dark" : "Light"}${trunk ? ` · live mirror of ${trunk}` : ""}`} words={words} on={choice === m} onPick={() => pick(m)} />)}
        <button className="mirror" type="button" aria-pressed={choice === "system"} onClick={() => pick("system")}>
          <span className="mm mm-split"><span style={{ background: pair.light.bg }} /><span style={{ background: pair.dark.bg }} /></span>
          <b>Match this computer</b>
        </button>
      </div>
    </Sec>
  );
}

function Mirror({ c, label, words, on, onPick }: { c: Pair["light"]; label: string; words: { user: string; reply: string }; on: boolean; onPick: () => void }) {
  const fill = `color-mix(in srgb, ${c.ink} 7%, ${c.bg})`;
  return (
    <button className="mirror" type="button" aria-pressed={on} onClick={onPick}>
      <span className="mm" style={{ background: c.bg }}>
        <span className="mm-s" style={{ background: c.side }}>{[0, 1, 2, 3].map((i) => <span key={i} className="mm-r"><i style={{ background: i === 0 ? c.accent : c.ink3 }} /><u style={{ background: c.ink3, opacity: 0.5 }} /></span>)}</span>
        <span className="mm-m">
          <span><span className="mm-b" style={{ background: fill, color: c.ink }}>{words.user}</span><span className="mm-t" style={{ color: c.ink }}>{words.reply}</span></span>
          <span className="mm-c" style={{ border: `1px solid ${c.line}` }}><i style={{ background: c.accent }} /></span>
        </span>
      </span>
      <b>{label}</b>
    </button>
  );
}

type ThemeProps = { look: Look; pair: Pair; themes: Themes; current: ThemeDesc | undefined; mode: Mode; onBrowse: () => void; onMake: (withAccent: boolean) => void };

export function ThemeSec({ look, pair, themes, current, mode, onBrowse, onMake }: ThemeProps) {
  const save = useSaveRunner();
  const accent = look.val("accent", null);
  const setAccent = (v: string | null) => void save(() => look.store.set("accent", v));
  const contrast = look.val("contrast", false) === true;
  return (
    <Sec title="Theme">
      <div className="theme-now ap-k" data-row="Theme">
        <Swatch c={pair[mode]} />
        <span className="grow">
          <b>{current ? themeName(current) : themes.loading ? "Reading your theme…" : "Branch Slate"}</b>
          <small>{[current ? themeGroup(current) : "Branch", mode === "dark" ? "Moonlight" : "Daylight", contrast ? "more contrast" : ""].filter(Boolean).join(" · ")}</small>
          {themes.error ? <small className="why-k">{visible(themes.error)}</small> : null}
          <Acts>
            <Btn pri sm disabled={themes.loading || Boolean(themes.error)} onClick={onBrowse}>{themes.list.length ? `Browse all ${themes.list.length} themes` : "Browse themes"}</Btn>
            <Btn sm disabled={themes.loading} onClick={() => onMake(false)}>{PALETTE_ICON}Make your own</Btn>
          </Acts>
        </span>
      </div>
      <Ctl title="Accent colour" sub={<>Only for what wants you: the working ring, the waiting dot, the yes button. <LinkBtn disabled={themes.loading} onClick={() => onMake(true)}>Save as a theme</LinkBtn></>}>
        <span className="accs">
          <button type="button" className="acc theme-acc" aria-pressed={!isHex(accent)} aria-label="The theme’s own accent" onClick={() => setAccent(null)}>A</button>
          {ACCENTS.map((a) => <button key={a} type="button" className="acc" style={{ ["--c" as string]: a }} aria-pressed={accent === a} aria-label={`Accent ${a.toUpperCase()}`} onClick={() => setAccent(a)} />)}
          <label className="acc acc-pick" aria-label="Any colour"><input type="color" value={isHex(accent) ? accent : (pair[mode] ?? SLATE[mode]).accent} onChange={(e) => setAccent(e.target.value.toLowerCase())} /></label>
        </span>
      </Ctl>
      <SpecRow r={rowOf("contrast")} look={look} />
    </Sec>
  );
}

/** The Trunk the mirrors show: the open conversation's, or the default one. */
export function useTrunk(engine: WindowEngine) {
  const res = useResource<RecordValue>(engine, "agents.list", {});
  const agents = list(res.data?.agents);
  const id = engine.agentId ?? (typeof res.data?.defaultId === "string" ? res.data.defaultId : "");
  const a = agents.find((x) => x.id === id) ?? agents[0];
  const nameOf = (x: RecordValue) => visible(x.name ?? record(x.identity).name ?? x.id);
  return { name: a ? nameOf(a) : "", agents, nameOf, defaultId: id, reload: res.reload };
}
