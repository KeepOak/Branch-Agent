// Second opinion and Media inside the shared Models & accounts section.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { visible } from "../adapter";
import { Btn, Ctl, Sec, Switch } from "../kit";
import { refOf, type ModelsCtx } from "./models-data";

const NONE = "Branch has no setting for this yet.";
export function SecondTab() {
  return (
    <Sec title="">
      <Ctl title="Ask a second model on hard questions" sub="Shows both answers side by side when they disagree." help="Shows both answers side by side when they disagree. Off until you choose: it doubles the cost." off={NONE}><Switch checked={false} label="Ask a second model on hard questions" onChange={() => undefined} /></Ctl>
    </Sec>
  );
}
export function SecondMore() {
  return (
    <Sec title="Second opinion, more" group="Second opinion">
      <Ctl title="Stress-test the answer" sub="A second model argues against the first answer before you see it." off={NONE}><Btn sm>Show an example</Btn></Ctl>
    </Sec>
  );
}

/** Media: making pictures and video. The engine picks its own media models unless one is set (mediaModels.*). */
export function MediaTab({ m }: { m: ModelsCtx }) {
  const image = refOf(m.cfg.get(m.shared("mediaModels", "image")));
  const video = refOf(m.cfg.get(m.shared("mediaModels", "video")));
  return (
    <Sec title="">
      <Ctl title="Make pictures" sub={image ? `Uses ${visible(image)}.` : "Uses the first connected service that makes pictures."} off="Pictures can’t be turned off separately yet; pick the service in Pictures with (Advanced).">
        <Switch checked label="Make pictures" onChange={() => undefined} />
      </Ctl>
      <Ctl title="Make short videos" sub={video ? `Uses ${visible(video)}.` : "Off until you choose: each video costs money."} off={NONE}>
        <Switch checked={Boolean(video)} label="Make short videos" onChange={() => undefined} />
      </Ctl>
    </Sec>
  );
}
export function MediaMore() {
  return (
    <Sec title="Media, technical" group="Media">
      <Ctl title="Programs for sound and video" sub="Where Branch finds ffmpeg and yt-dlp. Found by itself." off={NONE}><Btn sm>Check</Btn></Ctl>
    </Sec>
  );
}
