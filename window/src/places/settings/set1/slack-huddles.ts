// Settings › Chat apps › Slack › Join huddles. The switch writes the slack-huddles plugin entry the
// meeting runtime already reads (plugins.entries.slack-huddles.enabled and config.enabled). The plugin
// stays off until that entry is on, and a loaded plugin refuses to join while config.enabled is false.

export const SLACK_HUDDLES_PLUGIN_ID = "slack-huddles";
export const SLACK_HUDDLES_ENTRY = `plugins.entries.${SLACK_HUDDLES_PLUGIN_ID}`;
export const SLACK_HUDDLES_ENABLED = `${SLACK_HUDDLES_ENTRY}.enabled`;
export const SLACK_HUDDLES_CONFIG_ENABLED = `${SLACK_HUDDLES_ENTRY}.config.enabled`;

export const JOIN_HUDDLES_LABEL = "Join huddles";
export const JOIN_HUDDLES_HELP =
  "A Trunk joins an active Slack huddle and the transcript shows in Meetings. Off until you choose.";

/** On only when the plugin entry is on and its config does not refuse joining. Unset stays off. */
export function joinHuddlesOn(get: (path: string) => unknown): boolean {
  return get(SLACK_HUDDLES_ENABLED) === true && get(SLACK_HUDDLES_CONFIG_ENABLED) !== false;
}

/** The plugin entry the slack-huddles runtime reads. A merge patch keeps any other huddle settings. */
export function joinHuddlesEntry(on: boolean): { enabled: boolean; config: { enabled: boolean } } {
  return { enabled: on, config: { enabled: on } };
}

export async function setJoinHuddles(
  set: (path: string, value: unknown) => Promise<unknown>,
  on: boolean,
): Promise<void> {
  await set(SLACK_HUDDLES_ENTRY, joinHuddlesEntry(on));
}
