// Built fresh from the owner's list (atlas VOICE-0128): what Settings › Voice shows before anyone changes it.
// Listening and dictation start on push to talk; anything that keeps the microphone open by itself (the wake word),
// plays sound at a fixed time (the spoken morning brief) or reads every reply aloud ships off. Live dictation stops
// after 1.5 s of silence.
export const VOICE_DEFAULTS = {
  listening: "Push to talk",
  dictation: true,
  wakeWord: false,
  morningBrief: false,
  silenceSeconds: 1.5,
} as const;
