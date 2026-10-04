// Settings › Models tabs On this computer, Second opinion and Media (§4.7.6), with their own Advanced/Technical rows.
import { visible } from "../adapter";
import { Btn, Ctl, Plist, Prow, Sec, Status, Switch } from "../kit";
import { refOf, type ModelsCtx } from "./models-data";

const NONE = "Branch has no setting for this yet.";
const words = (n: number) => (n >= 1000 ? `${Math.round((n * 0.75) / 1000)}K words of context` : `${n} tokens of context`);

export function LocalTab({ m, openSettings }: { m: ModelsCtx; openSettings?: (page: string) => void }) {
  const local = m.models.filter((x) => x.local);
  const primary = refOf(m.ownOrShared("model"));
  const ready = local.find((x) => x.ref === primary) ?? local[0];
  const raw = m.catalog.data?.models as { id?: string; provider?: string; contextWindow?: number }[] | undefined;
  const ctx = ready ? raw?.find((x) => `${x.provider}/${x.id}` === ready.ref)?.contextWindow : undefined;
  if (m.catalog.loading) return <Status tone="idle" title="Reading models on this computer…" />;
  if (m.catalog.error) return <Status tone="bad" title="Branch couldn’t read models on this computer" action={<Btn sm onClick={() => void m.catalog.reload()}>Try again</Btn>}>{visible(m.catalog.error)}</Status>;
  return (
    <>
      {ready
        ? <Status title={`${ready.name} is ready on this computer`}>Loaded when first asked{ctx ? ` · ${words(ctx)}` : ""} · nothing leaves this computer.</Status>
        : <Status tone="idle" title="No model on this computer yet">A model here is free and private. Branch checks what fits before it offers one.</Status>}
      {local.length ? (
        <Sec title="">
          <Plist>
            {local.map((x) => (
              <Prow key={x.ref} title={x.name} sub={[visible(x.provider), x.ref === primary ? "in use" : x.available ? "ready" : "not running"].join(" · ")}>
                <Btn sm disabled={x.ref === primary} onClick={() => void m.cfg.set(m.own("model", "primary"), x.ref)}>Use this</Btn>
              </Prow>
            ))}
          </Plist>
        </Sec>
      ) : null}
      <div className="acts">{openSettings ? <Btn onClick={() => openSettings("local")}>Get another model</Btn> : null}</div>
    </>
  );
}

export function LocalMore({ openSettings }: { openSettings?: (page: string) => void }) {
  return (
    <Sec title="Will it fit on this computer?" hint="Each model is checked against this computer’s graphics memory, memory and free space.">
      <Ctl title="Models that fit here" sub="The full list, with a fit for each, is in Settings › On this computer.">{openSettings ? <Btn sm onClick={() => openSettings("local")}>See what fits</Btn> : null}</Ctl>
    </Sec>
  );
}

export function SecondTab() {
  return (
    <Sec title="">
      <Ctl title="Ask a second model on hard questions" sub="Shows both answers side by side when they disagree. Off until you choose: it doubles the cost." off={NONE}><Switch checked={false} label="Ask a second model on hard questions" onChange={() => undefined} /></Ctl>
    </Sec>
  );
}
export function SecondMore() {
  return (
    <Sec title="Second opinion, more">
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
    <Sec title="Media, technical">
      <Ctl title="Programs for sound and video" sub="Where Branch finds ffmpeg and yt-dlp. Found by itself." off={NONE}><Btn sm>Check</Btn></Ctl>
    </Sec>
  );
}
