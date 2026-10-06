// Settings › Achievements (DESIGN-SPEC §4.7.18): the catalogue in the preview's order, tier chips, category tabs and
// the pets you've had. The engine keeps no achievements ledger, so only badges the window can see for itself count:
// the Settings level reached (Advanced, Technical). Every other badge stays locked. The pets come from the look the
// window keeps (users.prefs "ui.window.look": pet, petsHad, petFirst).
import { useState } from "react";
import type { SettingsPageProps } from "../index";
import { Icon } from "../../../shell/icons";
import { Ctl, Hint, Page, Sec, Switch, Tabs, useLevel, useSaveRunner, type Lv, type RowEntry } from "../kit";
import { DEFAULT_PET, PETS, PIXEL, PixelPet, petsHad } from "../set1/appearance-pet";
import { useLook } from "../set1/appearance-store";
import "./achievements.css";

const NO_LEDGER = "Branch doesn’t count most achievements yet.";

export const ROWS: RowEntry[] = [{ page: "achievements", title: "Keep achievements quiet", sec: "Settings", group: "Settings", lv: 0 }];

export const TIERS = ["Bronze", "Silver", "Gold", "Diamond", "Godly", "SSS+"] as const;
export type Tier = (typeof TIERS)[number];
const TIER_COL: Record<Tier, string> = { Bronze: "#A86A3D", Silver: "#8C959E", Gold: "#C9982E", Diamond: "#4F8FB8", Godly: "#8A5AA8", "SSS+": "#C2412D" };
export type Badge = { cat: string; tier: Tier; name: string; desc: string };
const badges = (cat: string, tier: Tier, list: [string, string][]): Badge[] => list.map(([name, desc]) => ({ cat, tier, name, desc }));

/** The whole catalogue, as the preview defines it. */
export const BADGES: Badge[] = [
  ...badges("Getting started", "Bronze", [
    ["First words", "Send your first message."],
    ["It did the thing", "A task finished for the first time."],
    ["Yes, please", "Answer your first approval."],
    ["Not that one", "Say no to an approval."],
    ["Stop right there", "Stop a task that was running."],
    ["Undo, undo", "Undo a change from Activity."],
    ["Name tag", "Give your assistant a name."],
    ["About you", "Write something in USER.md."],
    ["A soul of its own", "Edit SOUL.md."],
    ["House rules", "Edit AGENTS.md."],
    ["Connected", "Connect your first model."],
    ["Signed in with ChatGPT", "Use your ChatGPT account with Branch."],
    ["Keeps itself fresh", "Let Branch update by itself."],
    ["Stays up late", "Keep Branch running in the background."],
    ["Found the palette", "Open Find anything with Ctrl K."],
    ["Walkthrough guide", "Finish the guided walkthrough."],
    ["Asked first", "Use \"Check with me\"."],
    ["Temporary", "Have a temporary conversation."],
    ["Picture this", "Attach a picture to a message."],
    ["Paper trail", "Attach a document."],
  ]),
  ...badges("Trunks & devices", "Silver", [
    ["A Trunk of your own", "Make your first Trunk."],
    ["Three's company", "Have three Trunks."],
    ["Dressed up", "Change a Trunk's face and colour."],
    ["Shape shifter", "Give a Trunk a new shape."],
    ["Paired", "Pair a second computer."],
    ["In your pocket", "Pair your phone."],
    ["Borrowed browser", "Let a Trunk use another computer's browser."],
    ["Group of two", "Have a conversation with two Trunks."],
    ["@ you", "Mention a Trunk with @."],
    ["Handoff", "One Trunk hands work to another."],
    ["Renamed", "Give a computer a friendly name."],
    ["Rearranged", "Drag the rail into your own order."],
    ["KeepOak account", "Connect a KeepOak account."],
    ["Lent a hand", "Lend a device's screen or files for a task."],
    ["Family", "Add a second person on this computer."],
    ["Kids' corner", "Add a child's profile."],
    ["Right back", "Switch back to the owner with your PIN."],
  ]),
  ...badges("Automations", "Silver", [
    ["On a schedule", "Make your first automation."],
    ["Good morning", "The Weekday brief ran on its own."],
    ["While you slept", "A task finished overnight."],
    ["Saved steps", "Save a procedure."],
    ["Run it again", "Run a saved procedure again."],
    ["Tripwire", "Start work from a trigger."],
    ["Webhook hello", "A webhook reached Branch."],
    ["Chat app on duty", "A chat app started a task."],
    ["Standing order", "Give a standing order."],
    ["Inbox zero", "Clear everything waiting for you in the Inbox."],
    ["Check-in", "Let Branch check in with news only."],
    ["Waiting line", "Reorder the waiting line."],
  ]),
  ...badges("Looks & fun", "Bronze", [
    ["Every leaf on the tree", "Try all 46 themes."],
    ["Night shift", "Switch to Moonlight."],
    ["Daylight saving", "Switch to Daylight."],
    ["Follow the sun", "Let Branch follow your computer's light or dark."],
    ["Four seasons", "See the oak in every season."],
    ["Rings of time", "Put the growth rings behind the glass."],
    ["Your own view", "Put your own picture behind the glass."],
    ["Moving pictures", "Put a video behind the glass."],
    ["Third dimension", "Choose the 3D style."],
    ["Pet project", "Meet the pet."],
    ["Name that squirrel", "Give your pet a name."],
    ["Pat pat", "Pat your pet ten times."],
    ["Moving house", "Move the pet to another spot."],
    ["See-through", "Change how see-through the panes are."],
    ["Clear view", "Clear the view to see the oak."],
    ["Wide load", "Use the full-width conversation."],
    ["Resized", "Drag a pane to a new width."],
    ["It's lonely over here", "Hide everything that can be hidden."],
    ["Minimalist", "Hide five parts of the window."],
  ]),
  ...badges("Streaks", "Gold", [
    ["Back again", "Use Branch two days running."],
    ["Week of work", "Use Branch every day for a week."],
    ["Weekend off", "Take a weekend off. Rest counts too."],
    ["Early bird", "Finish a task before 7 in the morning."],
    ["Night owl", "Finish a task after midnight."],
    ["Lunch break", "Finish a task at noon."],
    ["Monday person", "Start the week with a task on Monday."],
    ["Anniversary", "One year with Branch."],
  ]),
  ...badges("Safety", "Silver", [
    ["Lockdown drill", "Turn Lockdown on for the first time."],
    ["And off again", "Turn Lockdown off."],
    ["Plan first", "Use Plan first in a conversation."],
    ["Read only", "Use Read only for a task."],
    ["Second look", "Let a second model review an approval."],
    ["Kept secret", "Store a secret in Secrets."],
    ["Keychain keeper", "Use a password from your Mac's Keychain."],
    ["Safety copy", "Let an update keep a safety copy first."],
    ["Checkpoint", "Save everyone's progress at 95%."],
    ["Budgeted", "Set a monthly limit."],
    ["Pinned", "Pin a setting so it can't change."],
    ["No surprises", "Refuse a risky command."],
    ["Health check", "Run \"Check that everything works\"."],
    ["Walled garden", "Turn on the wall around programs."],
  ]),
  ...badges("Explorer", "Diamond", [
    ["Technical", "Reach the Technical level."],
    ["Advanced", "Reach the Advanced level."],
    ["Hidden setting", "Find a setting only Technical shows."],
    ["Every page", "Open every page of Settings."],
    ["Terminal tourist", "Open Branch in a terminal."],
    ["Side drawer", "Open every tab of the side drawer."],
    ["Browser tab", "Watch Branch use the browser."],
    ["Shell game", "Run a command in the Terminal tab."],
    ["Memory lane", "Look through what Branch remembers."],
    ["Library card", "Open every part of the Library."],
    ["Made for you", "Open a page Branch made."],
    ["Second opinion", "Ask a second model."],
    ["Local hero", "Run a model on this computer."],
    ["Voice of reason", "Talk live for the first time."],
    ["Dictation", "Dictate a message."],
    ["Answered by voice", "Answer an approval by voice."],
    ["Skill up", "Install a skill."],
    ["Plugged in", "Add a plugin."],
    ["Tool server", "Connect a tool server."],
    ["Multilingual", "Change the language."],
  ]),
  ...badges("Secrets", "Godly", [
    ["Knock knock", "Pat the pet exactly 100 times."],
    ["Winter oak in summer", "Pick winter in the middle of summer."],
    ["Everything, everywhere", "Turn on Show everything at Technical."],
    ["The long way round", "Find a setting by browsing, not searching."],
    ["Quiet please", "Turn achievement pop-ups off. (This one doesn't pop up.)"],
    ["Still life", "Turn on Keep things still."],
    ["Midnight oak", "Clear the view at midnight."],
    ["Palette cleanser", "Search for \"theme\" in Find anything."],
  ]),
  ...badges("Secrets", "SSS+", [
    ["Ten-year streak", "Use Branch every single day for ten years."],
    ["The whole tree", "Unlock every one of the other 500 achievements."],
    ["A million tasks", "1,000,000 finished tasks."],
    ["Every leaf, every season, every light", "Wear every theme in every season, by daylight and by moonlight."],
    ["Solstice at midnight", "Hide everything and bring it back at midnight on the winter solstice."],
  ]),
  ...badges("Looks & fun", "Silver", [
    ["Painter", "Save a theme of your own."],
  ]),
  ...badges("Getting started", "Bronze", [
    ["Spare key", "Add a second account for one service."],
  ]),
  ...badges("Getting started", "Gold", [
    ["Grown up", "Connect your keepoak.com account."],
  ]),
  ...badges("Getting started", "Bronze", [
    ["Home grown", "Run a model on this computer."],
    ["Pen pal", "Connect a chat app."],
  ]),
];
export const CATS = ["All", ...new Set(BADGES.map((b) => b.cat))];

/** The preview's medal (shell icons have none). */
function Medal() {
  return (
    <svg className="icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="14" r="5.5" /><path d="M8.5 9.5L6 3h4l2 4 2-4h4l-2.5 6.5" />
    </svg>
  );
}

/** The badges the window can see for itself: the Settings level reached. */
export function unlockedAt(level: Lv): Set<string> {
  const got = new Set<string>();
  if (level >= 1) got.add("Advanced");
  if (level >= 2) got.add("Technical");
  return got;
}

function Summary({ got }: { got: Set<string> }) {
  return (
    <>
      <div className="ach-sum">
        {TIERS.map((t) => {
          const all = BADGES.filter((b) => b.tier === t);
          return <span key={t} className="tierc"><i style={{ background: TIER_COL[t] }} />{`${t} · ${all.filter((b) => got.has(b.name)).length}/${all.length}`}</span>;
        })}
      </div>
      <Hint>{NO_LEDGER}</Hint>
    </>
  );
}

function BadgeGrid({ got }: { got: Set<string> }) {
  const [cat, setCat] = useState("All");
  const list = BADGES.filter((b) => cat === "All" || b.cat === cat);
  return (
    <>
      <Tabs tabs={CATS.map((c) => ({ id: c, label: c }))} value={cat} onChange={setCat} label="Achievement categories" />
      <div className="achs">
        {list.map((b) => {
          const on = got.has(b.name);
          return (
            <div key={b.name} className={`ach${on ? "" : " locked"}`} title={b.tier} data-badge={b.name}>
              <span className="medal" style={{ background: TIER_COL[b.tier] }}>{on ? <Medal /> : <Icon name="lock" small />}</span>
              <b>{b.name}</b>
              <small>{b.desc}</small>
            </div>
          );
        })}
      </div>
    </>
  );
}

/** Every pet but "None": the three pixel pets first (named as the preview names them), then the drawn ones. */
const PET_LIST = [...PETS.filter((p) => PIXEL[p.id]).map((p) => ({ ...p, name: p.name.replace(/^Pixel /, "").replace(/^./, (c) => c.toUpperCase()) })),
  ...PETS.filter((p) => p.id !== "none" && !PIXEL[p.id])];

function PetsSec({ engine, openSettings }: Pick<SettingsPageProps, "engine" | "openSettings">) {
  const look = useLook(engine);
  const save = useSaveRunner();
  const had = new Set(petsHad(look)), now = String(look.val("pet", DEFAULT_PET)), first = String(look.val("petFirst", "") || "");
  const go = (id: string) => void save(() => look.store.set("pet", id === DEFAULT_PET ? null : id)).then((ok) => { if (ok) openSettings?.("appearance"); });
  const met = PET_LIST.filter((p) => had.has(p.id)).length;
  return (
    <Sec title="Pets you’ve had" hint={`${met} of ${PET_LIST.length} met${met && first ? ` · first ${first}` : ""}`}>
      <div className="achs">
        {PET_LIST.map((p) => had.has(p.id) ? (
          <button key={p.id} type="button" className="ach pet18u" data-pet={p.id} onClick={() => go(p.id)}>
            <span className="medal petm18u">{p.still ? <img src={p.still} alt="" /> : <PixelPet p={PIXEL[p.id]} />}</span>
            <b>{p.name}</b>
            <small>{p.id === now ? "With you now" : "Met"}</small>
          </button>
        ) : (
          <div key={p.id} className="ach locked pet18u" data-pet={p.id}>
            <span className="medal"><Icon name="lock" small /></span>
            <b>{p.name}</b>
            <small>Not met yet</small>
          </div>
        ))}
      </div>
    </Sec>
  );
}

export function AchievementsPage(props: SettingsPageProps) {
  const got = unlockedAt(useLevel());
  return (
    <Page title={props.title} lede={`Private to you, never nagging. ${got.size} of ${BADGES.length} unlocked.`}>
      <Summary got={got} />
      <BadgeGrid got={got} />
      <PetsSec engine={props.engine} openSettings={props.openSettings} />
      <Sec title="Settings">
        <Ctl title="Keep achievements quiet" sub="No pop-ups." help="No pop-ups. They still unlock. Bronze and Silver pop small for a few seconds; Gold and up get the big one with confetti." off={NO_LEDGER}>
          <Switch label="Keep achievements quiet" checked={false} onChange={() => undefined} />
        </Ctl>
        <Hint>Hints: Bronze and Silver get a pet hint at most once an hour; Gold and up get none.</Hint>
      </Sec>
    </Page>
  );
}
