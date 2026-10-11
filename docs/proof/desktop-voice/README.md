# Desktop voice bridge proof

The screenshots show the real Voice settings components and production styles in an isolated browser preview. The before screen uses the original Voice page; the after and narrow screens use this change. Desktop IPC and gateway replies were mocked. The preview exercised listening-mode changes and shortcut persistence and had no page errors or horizontal overflow at 430 px.

Automated coverage includes preload method forwarding and event unsubscription, audio-only permission boundaries, shortcut conflicts and persistence, selected microphone capture, dictation toggling, wake-phrase matching and cleanup, and the existing recording cancellation tests. The preload regression fails with the original preload because `voice` is absent.

Runtime behavior:

- A conversation must be open for the global shortcut. Press once to dictate, again to finish into the message box.
- Wake mode listens while the conversation is focused, using the configured transcription service. A configured wake phrase starts live talk. Both transcription and realtime voice services must be available. Blur, navigation, another recording or a live call releases wake capture.
- Microphone selection applies to subsequent dictation, wake capture and live calls. The microphone level test stays local.
- Settings are local to this desktop installation. Camera requests remain denied.

Physical microphone access, OS shortcut registration, packaged macOS permission prompts and real speech-provider sessions were not exercised in this browser preview. Desktop CI runs the bridge regression on Linux, macOS and Windows; it does not replace these hardware checks.
