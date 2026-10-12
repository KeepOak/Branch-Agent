// Settings › Appearance (DESIGN-SPEC §4.7.3): how Branch looks on this computer. Light or dark, the theme (themes.list,
// themes.set, themes.import) with its gallery and colour editor, the accent and fonts (users.prefs "ui.accent",
// "ui.fontUi", "ui.fontChat"), and the person's other look rows (users.prefs "ui.window.look"); text size and width
// stay on this device. See appearance-store for how the look reaches the window.
import { useState } from "react";
import type { SettingsPageProps } from "../index";
import { errorText, record, visible } from "../adapter";
import { Page, Status, useSaveRunner } from "../kit";
import { setThemeChoice } from "../../../theme/theme";
import { ThemeEditor, type EditStart } from "./appearance-editor";
import { DEFAULT_THEME, SLATE, toPalette, type Pair } from "./appearance-look";
import { AppearanceMore } from "./appearance-more";
import { PetSec } from "./appearance-pet";
import { AgentsSec, BackgroundSec, LanguageSec, ReadingSec, ShownSec, TraySec, WindowSec, type Look } from "./appearance-sections";
import { useLook } from "./appearance-store";
import { localId, newThemeId, themeName, ThemesDialog, useThemes, type Extra, type ThemeDesc, type Themes } from "./appearance-themes";
import { LightDarkSec, ThemeSec, useThemeChoice, useTrunk } from "./appearance-top";
import "./appearance.css";

export { APPEARANCE_ROWS } from "./appearance-rows";

type Open = { kind: "gallery" } | { kind: "edit"; start: EditStart } | null;

export function AppearancePage(props: SettingsPageProps) {
  const look = useLook(props.engine);
  const extra = record(look.val("themeExtra", {})) as Extra;
  const themes = useThemes(props.engine, extra);
  const trunk = useTrunk(props.engine);
  const [, mode] = useThemeChoice();
  const [open, setOpen] = useState<Open>(null);
  const profile = look.snap.where === "profile";
  const currentId = profile ? themes.current?.id ?? DEFAULT_THEME : String(look.val("theme", themes.current?.id ?? DEFAULT_THEME));
  const current = themes.list.find((t) => t.id === currentId);
  const pair = themes.pairOf(currentId) ?? SLATE;
  const acts = useThemeActs(props, look, themes, extra, profile);
  const make = (withAccent: boolean) => setOpen({ kind: "edit", start: startFrom(current, currentId, pair, withAccent ? String(look.val("accent", "")) : "") });
  return (
    <Page title={props.title} lede="How Branch looks on this computer. Changes show as you pick.">
      <WhereStatus look={look} />
      <LightDarkSec engine={props.engine} pair={pair} trunk={trunk.name} profile={profile} />
      <ThemeSec look={look} pair={pair} themes={themes} current={current} mode={mode} onBrowse={() => setOpen({ kind: "gallery" })} onMake={make} />
      <AgentsSec look={look} />
      <BackgroundSec look={look} />
      <ReadingSec look={look} />
      <PetSec look={look} />
      <ShownSec look={look} />
      <LanguageSec />
      <TraySec />
      <WindowSec look={look} />
      <AppearanceMore engine={props.engine} look={look} trunk={trunk} openSettings={props.openSettings} />
      {open?.kind === "gallery" ? (
        <ThemesDialog themes={themes} currentId={currentId} mode={mode} contrast={look.val("contrast", false) === true}
          onContrast={(on) => void look.store.set("contrast", on ? true : null)} onPick={acts.pick} onMake={() => make(false)} onImport={acts.add} onDelete={acts.remove}
          onEdit={(t) => setOpen({ kind: "edit", start: { id: localId(t.id), name: t.name, base: currentId, pair: themes.pairOf(t.id) ?? SLATE } })} onClose={() => setOpen(null)} />
      ) : null}
      {open?.kind === "edit" ? (
        <ThemeEditor start={open.start} themes={themes} mode={mode} trunks={trunk.agents.map(trunk.nameOf)} onPreview={look.store.setPreviewFn} onSave={acts.saveOwn} onClose={() => setOpen(null)} />
      ) : null}
    </Page>
  );
}

function startFrom(t: ThemeDesc | undefined, id: string, pair: Pair, accent: string): EditStart {
  const name = id === DEFAULT_THEME || !t ? "My theme" : `My ${themeName(t)}`.slice(0, 40);
  const withAccent = (m: "light" | "dark") => ({ ...pair[m], ...(/^#[0-9a-f]{6}$/.test(accent) ? { accent } : {}) });
  return { name, base: id, pair: { light: withAccent("light"), dark: withAccent("dark") } };
}

function WhereStatus({ look }: { look: Look }) {
  if (look.snap.where !== "device") return null;
  return (
    <Status tone="idle" title="Kept on this computer">
      {look.snap.error ? `Your look couldn’t be read from Branch: ${visible(look.snap.error)}` : "This window has no signed-in profile, so your look stays here instead of following you."}
    </Status>
  );
}

const definition = (name: string, pair: Pair) => ({ name, description: "Made in Branch.", light: toPalette(pair.light), dark: toPalette(pair.dark) });
const NEEDS_PROFILE = "Saving a theme needs a signed-in profile on this Branch.";

function useThemeActs({ engine }: SettingsPageProps, look: Look, themes: Themes, extra: Extra, profile: boolean) {
  const save = useSaveRunner();
  const keepExtra = (id: string, pair: Pair | null) => {
    const next: Extra = { ...extra };
    if (pair) next[id] = { light: { ok: pair.light.ok, warn: pair.light.warn }, dark: { ok: pair.dark.ok, warn: pair.dark.warn } }; else delete next[id];
    return look.store.set("themeExtra", Object.keys(next).length ? next : null);
  };
  const pick = (id: string) => save(async () => {
    const t = themes.list.find((x) => x.id === id);
    if (!profile) {
      await look.store.set("theme", id === DEFAULT_THEME ? null : id);
      for (const k of ["accent", "fontUi", "fontChat"]) await look.store.set(k, null);
      await look.store.syncTheme();
    } else {
      await engine.request("themes.set", { id, appearance: { accent: null, fontUi: null, fontChat: null } });
      await Promise.all([themes.reload(), look.store.load()]);
    }
    if (t?.modes?.length === 1) setThemeChoice(t.modes[0]);
  });
  const imp = async (id: string, name: string, pair: Pair, apply: boolean) => {
    if (!profile) throw new Error(NEEDS_PROFILE);
    await engine.request("themes.import", { id, definition: definition(name, pair), ...(apply ? { apply: true } : {}) });
    await keepExtra(id, pair);
    await Promise.all([themes.reload(), look.store.load()]);
  };
  const saveOwn = (name: string, pair: Pair, id?: string) => save(async () => {
    await imp(id ?? newThemeId(name), name, pair, true);
    await look.store.set("accent", null);
  });
  const add = (name: string, pair: Pair) => save(() => imp(newThemeId(name), name, pair, false));
  const remove = (t: ThemeDesc) => save(async () => {
    if (!profile) throw new Error(NEEDS_PROFILE);
    const r = record(await engine.request("users.prefs.set", { entries: { [`ui.themeDefinition.${localId(t.id)}`]: null } }));
    if (r.status !== "ok") throw new Error(`The theme wasn’t deleted (${errorText(r.status)}).`);
    await keepExtra(localId(t.id), null);
    await Promise.all([themes.reload(), look.store.load()]);
  });
  return { pick, saveOwn, add, remove };
}
