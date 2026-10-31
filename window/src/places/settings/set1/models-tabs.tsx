// Second opinion and Media inside the shared Models & accounts section.
import { visible } from "../adapter";
import { Btn, Ctl, Sec, Switch } from "../kit";
import { refOf, type ModelsCtx } from "./models-data";

const NEED_MODEL = "Connect a model first.";
const SECOND_OFF = "A second model isn’t ready to turn on yet.";
const VIDEO_OFF = "Short videos aren’t ready to turn on yet.";
const MEDIA_TOOLS_OFF = "Checking those programs isn’t ready yet.";
/** Coming stub when Double-check is mounted without models data (#1708). Hidden at Regular/Advanced. */
const NONE = "Branch has no setting for this yet.";

function usableName(m: ModelsCtx, ref: string): string {
  return m.models.find((model) => model.ref === ref && model.available)?.name ?? "";
}

function hasUsable(m: ModelsCtx): boolean {
  return m.models.some((model) => model.available);
}

export function SecondTab({ m }: { m?: ModelsCtx } = {}) {
  const off = !m ? NONE : hasUsable(m) ? SECOND_OFF : NEED_MODEL;
  return (
    <Sec title="">
      <Ctl title="Ask a second model on hard questions" sub="Shows both answers side by side when they disagree." help="Shows both answers side by side when they disagree. Off until you choose: it doubles the cost." off={off}><Switch checked={false} label="Ask a second model on hard questions" onChange={() => undefined} /></Ctl>
    </Sec>
  );
}
export function SecondMore() {
  return (
    <Sec title="Second opinion, more" group="Second opinion">
      <Ctl title="Stress-test the answer" sub="A second model argues against the first answer before you see it." off={SECOND_OFF}><Btn sm>Show an example</Btn></Ctl>
    </Sec>
  );
}

/** Media: making pictures and video. The engine picks its own media models unless one is set (mediaModels.*). */
export function MediaTab({ m }: { m: ModelsCtx }) {
  const imageName = usableName(m, refOf(m.cfg.get(m.shared("mediaModels", "image"))));
  const videoName = usableName(m, refOf(m.cfg.get(m.shared("mediaModels", "video"))));
  const need = !hasUsable(m);
  return (
    <Sec title="">
      <Ctl title="Make pictures" sub={imageName ? `Uses ${visible(imageName)}.` : "Uses the first connected service that makes pictures."} off={need ? NEED_MODEL : "Pictures can’t be turned off separately yet; pick the service in Pictures with (Advanced)."}>
        <Switch checked label="Make pictures" onChange={() => undefined} />
      </Ctl>
      <Ctl title="Make short videos" sub={videoName ? `Uses ${visible(videoName)}.` : "Off until you choose: each video costs money."} off={need ? NEED_MODEL : VIDEO_OFF}>
        <Switch checked={Boolean(videoName)} label="Make short videos" onChange={() => undefined} />
      </Ctl>
    </Sec>
  );
}
export function MediaMore() {
  return (
    <Sec title="Media, technical" group="Media">
      <Ctl title="Programs for sound and video" sub="Where Branch finds ffmpeg and yt-dlp. Found by itself." off={MEDIA_TOOLS_OFF}><Btn sm>Check</Btn></Ctl>
    </Sec>
  );
}
