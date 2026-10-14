// Settings › Voice & calls: the rows of the R1 page, in the approved preview's cards (preview.html PG voice: Talking,
// Listening, Speaking back, Live voice, Calls & meetings, Voice services). They come from Classic Voice (set1/voice*.tsx)
// at Classic's own levels. A config row saves the talk.* / tts.* / plugin key Classic saved, a "slot" row is drawn by the
// page (voice-live.tsx) on Classic's engine calls, and every row Classic greyed is a Coming row with Classic's reason.
import type { Level } from "../nav";
import type { Codec, Control, Row, RowOption } from "../rows";

type Extra = { help?: string; level?: Level; control?: Control; options?: RowOption[]; unit?: string; codec?: Codec };
const slot = (id: string, card: string, label: string, calls: string[], extra: Extra = {}): Row =>
  ({ id, page: "voice", card, label, level: 0, control: "custom", ...extra, source: { kind: "slot", calls, reason: `${label} comes in a later update.` } });
const config = (id: string, card: string, label: string, path: string, control: Control, extra: Extra = {}): Row =>
  ({ id, page: "voice", card, label, level: 0, ownerLevel: true, control, ...extra, source: { kind: "config", path } });

export const TALKING = "Talking";
export const LISTENING = "Listening";
export const SPEAKING = "Speaking back";
export const LIVE = "Live voice";
export const CALLS = "Calls & meetings";
export const SERVICES = "Voice services";

/** Classic's two reasons for a greyed Voice row (voice-kit.tsx). */
const APP = "This runs in the Branch app on your computer.";
const NO_KEY = "Branch has no setting for this yet.";
const NEED: Record<string, string> = { [APP]: "desktop: the Branch app’s voice", [NO_KEY]: "engine: a setting for it" };

/** One greyed Classic row, as Classic describes it: its control, and why it is greyed (APP unless said). */
type Grey = { t: string; sub?: string; c?: { sw: boolean } | { btn: string } | { seg: string[] } | { pick: string[] } | { field: string; unit?: string } | { area: string }; why?: string };
/** A Coming row's reason is one plain sentence in the preview's words (R1-10): a reason that names how Branch works
 *  inside becomes "<label> comes in a later update."; the call it waits for stays in `need`. */
export const plainReason = (label: string, reason: string): string =>
  /engine|gateway call|method|config|\b[a-z]+\.[a-z]+\b/i.test(reason) ? `${label} comes in a later update.` : reason;
const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
function grey(card: string, level: Level, why: string, rows: Grey[]): Row[] {
  return rows.map((g) => {
    const c = g.c;
    const reason = g.why ?? why;
    const control: Control = !c ? "custom" : "sw" in c ? "toggle" : "seg" in c ? "segmented" : "pick" in c ? "select" : "field" in c ? (/^[\d.]+$/.test(c.field) || c.field === "" ? "number" : "text") : "area" in c ? "text" : "custom";
    const options = c && "seg" in c ? c.seg.map((v) => ({ v, label: v })) : c && "pick" in c ? c.pick.map((v) => ({ v, label: v })) : undefined;
    return { id: `voice.${slug(card)}.${slug(g.t)}`, page: "voice", card, label: g.t, level, control, ...(options ? { options } : {}), ...(c && "field" in c && c.unit ? { unit: c.unit } : {}),
      ...(g.sub ? { help: g.sub } : {}), source: { kind: "coming", need: NEED[reason] ?? "engine: a setting for it", reason: plainReason(g.t, reason) } } satisfies Row;
  });
}
const text: Codec = { read: (v) => (typeof v === "string" ? v : ""), write: (v) => (typeof v === "string" && v.trim() ? v.trim() : null) };
const choice = (fallback: string): Codec => ({ read: (v) => (typeof v === "string" && v ? v : fallback), write: (v) => (v === "" ? null : v) });
const onUnlessOff: Codec = { read: (v) => v !== false, write: (v) => v === true };
const opts = (pairs: [string, string][]): RowOption[] => pairs.map(([v, label]) => ({ v, label }));
const LANGS: [string, string][] = [["", "This computer’s language"], ["en-US", "English (US)"], ["en-GB", "English (UK)"], ["es-ES", "Spanish"], ["fr-FR", "French"], ["de-DE", "German"], ["pt-BR", "Portuguese"],
  ["it-IT", "Italian"], ["nl-NL", "Dutch"], ["ja-JP", "Japanese"], ["zh-CN", "Chinese"], ["ko-KR", "Korean"], ["ar-SA", "Arabic"], ["hi-IN", "Hindi"], ["yo-NG", "Yoruba"]];
const CALL = "plugins.entries.voice-call";

/** The commands Voice services shows (Technical), by row id. */
export const VOICE_CODE: Record<string, string> = {
  "voice.services.file": 'branch infer tts convert --text "Your build is done" --output done.mp3',
  "voice.services.status": "branch infer tts status",
  "voice.services.call-setup": "branch voicecall setup",
  "voice.services.call-speak": 'branch voicecall start --to <number> --message "Hello"',
  "voice.services.during": "branch voicecall speak|dtmf|end --call-id <id>",
  "voice.services.tail": "branch voicecall tail",
  "voice.services.latency": "branch voicecall latency",
  "voice.services.expose": "branch voicecall expose --mode serve",
};

const TURN: Grey[] = [
  { t: "Set up voice", sub: "Pick how it listens and speaks, add keys, and get what runs here.", c: { btn: "Start" } },
  { t: "Keep voice ready", sub: "While voice is on somewhere, the engines stay loaded so the first word is quick.", c: { sw: true } },
  { t: "Speak while the answer is written", sub: "Each sentence is spoken as soon as it’s done.", c: { sw: true } },
  { t: "Remember spoken lines", sub: "A line said before plays at once; a new voice never replays an old one.", c: { sw: true } },
  { t: "Trunks may change their voice in a reply", sub: "A reply can ask for another voice or engine for a line.", c: { sw: false } },
  { t: "Send dictation by itself", sub: "When you stop, the words go after a short countdown you can cancel.", c: { sw: false }, why: APP },
  { t: "Countdown", c: { field: "3", unit: "s" }, why: APP },
  { t: "Wait while I’m mid-thought", sub: "A pause that sounds unfinished doesn’t end your turn.", c: { sw: true } },
  { t: "Ignore its own voice", sub: "Its speech, filler sounds and people nearby are kept out of what it hears.", c: { sw: true } },
  { t: "Stop phrases", sub: "Saying one ends the voice session. One per line.", c: { area: "" } },
  { t: "Start answering while I finish", sub: "On this computer: it gets ready as you speak and drops the draft if you keep going.", c: { sw: false } },
  { t: "Talk to a Trunk by name", sub: "A Trunk’s name at the start or end of what you say goes to that Trunk.", c: { sw: true } },
  { t: "Act on each part as I say it", sub: "“Open the browser and find flights”: the first part starts before you finish. Off until you choose: it acts before you’ve finished.", c: { sw: false } },
  { t: "Clean up background noise", sub: "Fans, traffic and typing are filtered before it listens. Uses a little processor.", c: { sw: false }, why: APP },
  { t: "Lower other sound while we talk", sub: "Music and videos get quieter while it listens or speaks.", c: { sw: true }, why: APP },
  { t: "Tell a real interruption from a cough", sub: "A short “uh-huh” pauses it instead of stopping it.", c: { sw: true } },
  { t: "While it thinks", sub: "So a pause doesn’t sound like a dropped call.", c: { seg: ["Silence", "Soft typing", "A low hum"] } },
  { t: "Say how background tasks are going", sub: "Waits for a pause in the talk, then a short line.", c: { sw: true } },
  { t: "Hand slow work to a Trunk and keep talking", sub: "Anything slower than a few seconds goes to a Trunk; the voice carries on.", c: { sw: true } },
  { t: "Every spoken turn ends with speech", sub: "If it fails, is stopped or runs out, it says a short sentence instead of going quiet.", c: { sw: true } },
  { t: "Risky actions asked by voice need a spoken yes", sub: "Bound to that one task.", c: { sw: true } },
  { t: "Quick spoken commands", sub: "“Stop”, “louder”, “next”: matched before any model is asked.", c: { sw: true } },
  { t: "Notice how I sound", sub: "A hint to the Trunk when it’s fairly sure you sound stressed or rushed. Off until you choose: it reads your tone.", c: { sw: false } },
  { t: "Dictate into any app", sub: "Hold the key below anywhere; the words appear tidied where you type.", c: { sw: false }, why: APP },
  { t: "Dictate-anywhere key", c: { field: "Right Ctrl" }, why: APP },
];

export const VOICE_ROWS: Row[] = [
  // Talking (Classic Talking, Talking more, What Trunks may use, A spoken turn)
  ...grey(TALKING, 0, APP, [
    { t: "Listening", sub: "Push to talk holds the key; the wake word listens for it.", c: { seg: ["Off", "Push to talk", "Wake word"] } },
    { t: "Push-to-talk key", sub: "Hold it anywhere on this computer.", c: { btn: "Change" } },
    { t: "Microphone", sub: "Used for dictation, push to talk, the wake word and live voice. A change applies to the next dictation or call.", c: { pick: ["System default"] } },
    { t: "Test the microphone", sub: "Watch the level as you speak, and try the wake word.", c: { btn: "Test" } },
  ]),
  ...grey(TALKING, 1, APP, [{ t: "Answer approvals by voice", sub: "Say yes or no to an approval, or hold the phone key to talk turn by turn.", c: { btn: "Try one" } }]),
  config("voice.talking.talking-over", TALKING, "Talking over it stops it", "talk.interruptOnSpeech", "toggle", { level: 1, codec: onUnlessOff,
    help: "Speak while it is talking and it stops to listen. On a Mac, pressing the right Option key does the same at any time." }),
  ...grey(TALKING, 1, APP, [
    { t: "Hold the microphone to dictate", sub: "Hold the microphone button until it listens, then let go and keep talking. Done puts the words in the message box.", c: { sw: true } },
    { t: "Trunks may listen through the microphone", sub: "A Trunk can record and turn speech into text on this computer when a task needs it. Setup turns it on; it stays off if setup is skipped.", c: { sw: true } },
    { t: "Trunks may speak on this computer’s speakers", sub: "A Trunk can say something out loud here, such as a reminder, in the chosen voice. Setup turns it on; it stays off if setup is skipped.", c: { sw: true } },
  ]),
  ...grey(TALKING, 1, NO_KEY, TURN),

  // Listening (Classic Hearing more, Listening more)
  ...grey(LISTENING, 1, APP, [
    { t: "Microphone level", sub: "Level, the point where it starts listening, and the pitch it hears.", c: { btn: "Test" } },
    { t: "Wake word", sub: "Heard on this computer only. Off until you choose: it keeps the microphone open.", c: { sw: false } },
  ]),
  slot("voice.listening.wake-words", LISTENING, "Wake words", ["voicewake.get", "voicewake.set"], { level: 1,
    help: "Saying one of these starts listening. One per line, up to 32, each up to 64 characters. Shared by every computer and phone on this Branch. Clear the list to go back to the standard words." }),
  ...grey(LISTENING, 1, APP, [
    { t: "The wake word starts live voice", sub: "Saying a wake word opens live voice with the default Trunk. Off: the wake word starts dictation into the message box.", c: { sw: false } },
    { t: "Stop listening after silence", sub: "For live dictation.", c: { field: "2.5", unit: "s" } },
  ]),
  slot("voice.listening.aloud", LISTENING, "Answer aloud", ["tts.status", "tts.enable", "tts.disable"], { level: 1 }),
  ...grey(LISTENING, 1, NO_KEY, [{ t: "Spoken morning brief", sub: "The written brief, read out at 7:30 on the speaker you choose.", c: { sw: true } }]),
  config("voice.listening.language", LISTENING, "Speech language", "talk.speechLocale", "select", { level: 1, codec: choice(""), options: opts(LANGS), help: "What you say is recognised in these languages." }),
  ...grey(LISTENING, 1, NO_KEY, [{ t: "Also understand", sub: "None added.", c: { pick: ["Add a language…"] } }]),
  ...grey(LISTENING, 1, APP, [
    { t: "Speech model", sub: "Turns your voice into text on this computer. Bigger understands more and takes more disk and memory.", c: { seg: ["Tiny", "Base", "Small"] } },
    { t: "Test voice input", sub: "Say something, and see the words it heard.", c: { btn: "Try it" } },
    { t: "Chime when listening starts and stops", sub: "A short sound when push to talk, the wake word or dictation starts and stops listening.", c: { sw: true } },
  ]),

  // Speaking back (Classic Speaking back, Speaking back more)
  slot("voice.speaking.voice", SPEAKING, "Voice", ["tts.status", "tts.providers", "tts.setPersona", "tts.enable", "tts.disable"], { help: "Read replies out loud in this voice." }),
  ...grey(SPEAKING, 0, APP, [{ t: "Dictation in the message box", sub: "The microphone button turns speech into text.", c: { sw: false } }]),
  slot("voice.speaking.engine", SPEAKING, "Speaking engine", ["tts.providers", "tts.setProvider"], { level: 1,
    help: "Voices on this computer are free and private. A service needs its key and gets the text it reads out." }),
  slot("voice.speaking.preview", SPEAKING, "Preview", ["tts.speak"], { level: 1, help: "Plays “This is how replies will sound.”" }),
  slot("voice.speaking.services", SPEAKING, "Voice services", ["tts.providers"], { level: 1, help: "Each speaking service and whether it has a key. Keys live in Sign-ins & keys." }),
  slot("voice.speaking.named", SPEAKING, "Named voices", ["tts.status"], { level: 1, help: "A name for a voice that keeps sounding the same, whichever engine speaks." }),
  ...grey(SPEAKING, 1, "Change it with /tts limit in a conversation for now.", [{ t: "Read in full up to", sub: "Longer replies are shortened before they are read.", c: { field: "", unit: "characters" } }]),
  ...grey(SPEAKING, 1, "Change it with /tts summary in a conversation for now.", [{ t: "Shorten longer replies first", sub: "A longer reply is summarised before it is read out.", c: { sw: true } }]),

  // Live voice (Classic Live voice more, technical, more services)
  slot("voice.live.status", LIVE, "Live voice", ["talk.catalog"], { level: 1 }),
  slot("voice.live.through", LIVE, "Live voice through", ["talk.catalog", "config.get", "config.patch"], { level: 1 }),
  slot("voice.live.model", LIVE, "Live voice model", ["talk.catalog", "config.get", "config.patch"], { level: 1, help: "The model that listens and answers in live voice." }),
  slot("voice.live.speaker", LIVE, "Speaker voice", ["talk.catalog", "config.get", "config.patch"], { level: 1, help: "The voice for spoken replies in live voice. Some services keep it fixed once a call starts." }),
  slot("voice.live.gateway", LIVE, "Live voice through the Gateway", ["talk.catalog", "config.get", "config.patch"], { level: 1,
    help: "This computer’s microphone and speaker use the Gateway’s live-voice session. Off until you choose: your voice goes through the Gateway to that service." }),
  config("voice.live.stop", LIVE, "Stop talking when I start", "talk.interruptOnSpeech", "toggle", { level: 1, codec: onUnlessOff, help: "When you start speaking, it stops and listens." }),
  slot("voice.live.who", LIVE, "Who answers live voice", ["agents.list", "config.get", "config.patch"], { level: 1,
    help: "For live voice started by the wake word or the phone’s Talk button. A call started from a conversation is always with that conversation’s Trunk." }),
  config("voice.live.instructions", LIVE, "How it talks in live voice", "talk.realtime.instructions", "text", { level: 1, codec: text,
    help: "Style for the voice service, such as pace and tone. Added to Branch’s own live-voice instructions, never replacing them." }),
  ...grey(LIVE, 1, APP, [
    { t: "Shift stops it talking", sub: "Press Shift while it speaks to stop it and talk.", c: { sw: true } },
    { t: "Sounds as it listens and answers", sub: "A soft sound when live voice starts listening, starts thinking and starts to speak.", c: { sw: true } },
    { t: "Wake sound", sub: "The sound when the wake word is heard.", c: { pick: ["System sound", "None"] } },
    { t: "Sent sound", sub: "The sound when what you said is sent.", c: { pick: ["System sound", "None"] } },
    { t: "Camera", sub: "For showing something during live voice. The camera starts only when you turn it on in a call.", c: { pick: ["System default"] } },
  ]),
  config("voice.live.mode", LIVE, "How it runs", "talk.realtime.mode", "segmented", { level: 2, codec: choice(""),
    options: opts([["", "Service default"], ["realtime", "Live"], ["stt-tts", "Speech to text, then voice"], ["transcription", "Transcribe only"]]) }),
  config("voice.live.brain", LIVE, "Who does the thinking", "talk.realtime.brain", "segmented", { level: 2, codec: choice("agent-consult"),
    options: opts([["agent-consult", "The Trunk"], ["direct-tools", "The service, with tools"], ["none", "No one (transcribe)"]]) }),
  config("voice.live.routing", LIVE, "Final words go to", "talk.realtime.consultRouting", "segmented", { level: 2, codec: choice("provider-direct"),
    options: opts([["provider-direct", "The service’s own reply"], ["force-agent-consult", "Always the Trunk"]]) }),
  config("voice.live.thinking", LIVE, "Thinking during live voice", "talk.consultThinkingLevel", "select", { level: 2, codec: choice(""),
    options: opts([["", "As the conversation"], ["off", "Off"], ["minimal", "Minimal"], ["low", "Low"], ["medium", "Medium"], ["high", "High"], ["xhigh", "Extra high"], ["adaptive", "Adaptive"], ["max", "Max"], ["ultra", "Ultra"]]) }),
  config("voice.live.fast", LIVE, "Fast answers during live voice", "talk.consultFastMode", "segmented", { level: 2,
    codec: { read: (v) => (v === true ? "on" : v === false ? "off" : ""), write: (v) => (v === "" ? null : v === "on") }, options: opts([["", "As the conversation"], ["on", "On"], ["off", "Off"]]) }),
  config("voice.live.vad", LIVE, "Voice detection", "talk.realtime.vadThreshold", "number", { level: 2, unit: "0–1", help: "0 hears the quietest sound, 1 only clear speech. Blank keeps the service default." }),
  config("voice.live.silence", LIVE, "Silence before it answers", "talk.realtime.silenceDurationMs", "number", { level: 2, unit: "ms", help: "Blank keeps the service default." }),
  config("voice.live.prefix", LIVE, "Sound kept before speech", "talk.realtime.prefixPaddingMs", "number", { level: 2, unit: "ms", help: "Blank keeps the service default." }),
  config("voice.live.reasoning", LIVE, "Reasoning", "talk.realtime.reasoningEffort", "select", { level: 2, codec: choice(""),
    options: opts([["", "Service default"], ["minimal", "Minimal"], ["low", "Low"], ["medium", "Medium"], ["high", "High"]]) }),
  config("voice.live.pause", LIVE, "Pause before sending (talk on a device)", "talk.silenceTimeoutMs", "number", { level: 2, unit: "ms", help: "Blank: 700 ms on a Mac and Android, 900 ms on iPhone." }),
  config("voice.live.connection", LIVE, "Connection", "talk.realtime.transport", "segmented", { level: 2, codec: choice(""), help: "How live-voice sound travels between you and the service.",
    options: opts([["", "Chosen by the service"], ["webrtc", "Direct (WebRTC)"], ["provider-websocket", "The service’s socket"], ["gateway-relay", "Through the Gateway"], ["managed-room", "Managed room"]]) }),
  slot("voice.live.services", LIVE, "Live-voice services", ["talk.catalog", "config.get", "config.patch"], { level: 2, help: "Each live-voice service, and which one is in use." }),
  ...grey(LIVE, 2, NO_KEY, [{ t: "Live voice with a ChatGPT plan", sub: "Use your ChatGPT sign-in for live voice instead of a key.", c: { sw: true } }]),

  // Calls & meetings (Classic Calls and meetings, more)
  config("voice.calls.phone", CALLS, "Phone calls", `${CALL}.enabled`, "toggle", { level: 1, codec: { read: (v) => v === true, write: (v) => v === true },
    help: "Call you, or call someone for you. Off until you choose: calls cost money by the minute and reach people outside Branch." }),
  config("voice.calls.from", CALLS, "Calling from", `${CALL}.config.fromNumber`, "text", { level: 1, codec: text, help: "Your Twilio number. Its key is in the locker." }),
  ...grey(CALLS, 1, NO_KEY, [
    { t: "Who it may call", sub: "Numbers you approve once, or anyone you name in a message.", c: { seg: ["People I approve", "Anyone I name"] } },
    { t: "Recording", sub: "It always says first that it’s an AI assistant calling for you.", c: { seg: ["Only if they agree", "Never"] } },
  ]),
  slot("voice.calls.test", CALLS, "Test call", ["voicecall.initiate"], { level: 1, help: "Rings your own number with a short message, so you know calls work." }),
  ...grey(CALLS, 1, "Branch lists only calls in progress yet.", [{ t: "Calls", sub: "Every call: who, when, how long and how it ended.", c: { btn: "See" } }]),
  config("voice.calls.transcripts", CALLS, "Keep meeting transcripts", "transcripts.enabled", "toggle", { level: 1, codec: onUnlessOff,
    help: "Lets a Trunk save what’s said in a meeting. It records nothing by itself: “Meeting notes” and the places below decide when." }),
  slot("voice.calls.notes", CALLS, "Meeting notes", ["config.get", "config.patch"], { level: 1, help: "A Trunk joins Meet, Teams or Zoom as a guest and brings the notes back." }),
  ...grey(CALLS, 1, "Branch can’t add a place from here yet.", [{ t: "Start notes by itself in", sub: "Empty until you add a place. A Trunk then keeps notes there by itself.", c: { btn: "Add a place" } }]),
  ...grey(CALLS, 1, NO_KEY, [
    { t: "Meeting notes now", sub: "Whether saving is on, and the notes saved so far.", c: { btn: "Check again" } },
    { t: "Join from your calendar", sub: "It never joins a meeting by itself unless you pick the second.", c: { seg: ["Only when I ask", "Meetings I’m invited to"] } },
    { t: "Send notes afterwards", sub: "Sending to other people asks you first.", c: { seg: ["To me", "To everyone there"] } },
    { t: "Recognise who is speaking", sub: "Voices are told apart and remembered; say “that was Jill” to name one.", c: { sw: false } },
    { t: "Split recordings by speaker", sub: "On this computer, as it records.", c: { sw: true }, why: APP },
    { t: "Notes from any call, without joining", sub: "Records this computer’s sound and your microphone during a call you’re in. Off until you choose: it records your calls.", c: { sw: false }, why: APP },
    { t: "Record and transcribe", sub: "Start a recording on this computer; it becomes a transcript in Meetings.", c: { btn: "Start recording" }, why: APP },
    { t: "Answer questions it hears", sub: "While transcribing, it answers when someone asks something worth answering. Off until you choose: it speaks up in your calls.", c: { sw: false } },
    { t: "Sum up each call", sub: "Who, what was decided and how it ended, for every call.", c: { sw: true } },
    { t: "Call numbers", sub: "Talk-over and silence measured on recorded calls.", c: { btn: "See" } },
    { t: "Press keypad tones on phone menus", sub: "When it reaches a recorded menu, it listens and presses the right number.", c: { sw: true } },
    { t: "Call a list of people", sub: "One call each, from a list, with retries and a cap on calls at once.", c: { btn: "Choose a list" } },
    { t: "Practice calls", sub: "Run a voice Trunk against made-up callers and check what it said.", c: { btn: "Run" } },
    { t: "FaceTime", sub: "Answers FaceTime from people you pick, and calls you after a yes.", c: { btn: "Set up" }, why: APP },
    { t: "A face on live voice", sub: "A moving face for spoken replies. Off until you choose: a service draws it.", c: { pick: ["The Trunk’s own face", "A video avatar service"] } },
    { t: "Smart glasses", sub: "Even Realities G1: replies on the lenses, notes and notifications.", c: { btn: "Pair" }, why: APP },
    { t: "Make a podcast from a document", sub: "Two voices talk it through.", c: { btn: "Choose a document" } },
    { t: "Narrate a screen recording", sub: "Spoken notes from timed comments.", c: { btn: "Choose a recording" } },
    { t: "Make a voice of your own", sub: "Train a voice on your recordings, on this computer.", c: { btn: "Start" }, why: APP },
  ]),

  // Voice services (Classic Voice technical, Listening services)
  ...[["file", "Speak into a file", "Uses the speaking engine above."], ["status", "Speaking status", "Which engine, voice and named voice are in use, and whether it reads replies aloud."]]
    .map(([id, label, help]) => slot(`voice.services.${id}`, SERVICES, label, [], { level: 2, control: "text", help })),
  ...grey(SERVICES, 2, NO_KEY, [
    { t: "Voice nicknames", sub: "A Trunk can switch voice by nickname, such as “Roger”. Short names for voices of the chosen engine." },
    { t: "Audio format", sub: "The file format spoken replies are made in.", c: { pick: ["Engine default"] } },
  ]),
  ...[["call-setup", "Check the call setup"], ["call-speak", "Call and speak"], ["during", "During a call"], ["tail", "Follow the call log"], ["latency", "Answer delay"], ["expose", "Reach call webhooks from outside"]]
    .map(([id, label]) => slot(`voice.services.${id}`, SERVICES, label, [], { level: 2, control: "text", ...(id === "expose" ? { help: "Off by default." } : {}) })),
  slot("voice.services.all", SERVICES, "All voice settings", ["config.get", "config.patch"], { level: 2,
    help: "Every live-voice and speaking setting the engine has, by its key. The rows above and this list change the same settings." }),
  slot("voice.services.listening", SERVICES, "Listening engine", ["talk.catalog", "config.get", "config.patch"], { level: 1,
    help: "What turns your voice into words. A service needs its key and hears the recording." }),
  config("voice.services.program", SERVICES, "A program of yours as an engine", "tts.providers.tts-local-cli.command", "text", { level: 1, codec: text,
    help: "{{Text}} and {{OutputPath}} are filled in for you." }),
  ...grey(SERVICES, 1, NO_KEY, [
    { t: "Try again when a service hiccups", sub: "A wrong key stops at once instead of using up your allowance.", c: { sw: true } },
    { t: "Use the chat app’s own transcript first", sub: "Where an app sends its own words with a voice note.", c: { sw: true } },
  ]),
  config("voice.services.audio-files", SERVICES, "Turn audio and video files into documents", "tools.media.audio.enabled", "toggle", { level: 1, codec: onUnlessOff,
    help: "Files you add to Library are transcribed." }),
  slot("voice.services.listen-keys", SERVICES, "Listening services", ["talk.catalog"], { level: 1, help: "Each listening service and whether it has a key." }),
];
