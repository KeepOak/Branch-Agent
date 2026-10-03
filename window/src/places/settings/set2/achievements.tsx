// Settings › Achievements (DESIGN-SPEC §4.7.18). The engine keeps no achievements ledger yet, so nothing can be
// counted or unlocked: the page says so plainly and shows no badge as earned or waiting.
import type { SettingsPageProps } from "../index";
import { Ctl, Page, Sec, Status, Switch, type RowEntry } from "../kit";

const NO_LEDGER = "Needs the engine’s achievements ledger.";

export const ROWS: RowEntry[] = [{ page: "achievements", title: "Keep achievements quiet", sec: "Settings", lv: 0 }];

export function AchievementsPage(props: SettingsPageProps) {
  return (
    <Page title={props.title} lede="Private to you, never nagging.">
      <Status tone="idle" title="Achievements aren’t counted yet">Branch notices what you’ve done once the engine keeps an achievements ledger. Until then nothing is shown as earned.</Status>
      <Sec title="Settings">
        <Ctl title="Keep achievements quiet" sub="No pop-ups. They still unlock. Bronze and Silver pop small for a few seconds; Gold and up get the big one with confetti." off={NO_LEDGER}>
          <Switch label="Keep achievements quiet" checked={false} onChange={() => undefined} />
        </Ctl>
      </Sec>
    </Page>
  );
}
