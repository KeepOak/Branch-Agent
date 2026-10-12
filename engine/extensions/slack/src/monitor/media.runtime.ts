import { createSubsystemLogger } from "branch/plugin-sdk/runtime-env";

export const slackMediaLog = createSubsystemLogger("gateway/channels/slack").child("media");
export { fetchWithRuntimeDispatcher } from "branch/plugin-sdk/runtime-fetch";
export type { FetchLike } from "branch/plugin-sdk/media-runtime";
export { captureChannelReadAuthority } from "branch/plugin-sdk/fetch-runtime";
export { saveRemoteMedia, unlinkIfExists } from "branch/plugin-sdk/media-runtime";
