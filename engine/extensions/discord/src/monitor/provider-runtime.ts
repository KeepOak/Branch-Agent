import {
  listNativeCommandSpecsForConfig,
  listSkillCommandsForAgents,
} from "branch/plugin-sdk/command-auth-native";
import {
  resolveNativeCommandsEnabled,
  resolveNativeSkillsEnabled,
} from "branch/plugin-sdk/native-command-config-runtime";
import { isVerbose, shouldLogVerbose } from "branch/plugin-sdk/runtime-env";
import { resolveDiscordAccount } from "../accounts.js";
import { Client } from "../internal/discord.js";
import { probeDiscordApplicationId } from "../probe.js";
import { createDiscordNativeCommand } from "./native-command.js";
import { runDiscordGatewayLifecycle } from "./provider.lifecycle.js";

export const discordProviderRuntime = {
  probeDiscordApplicationId,
  createDiscordNativeCommand,
  runDiscordGatewayLifecycle,
  loadDiscordVoiceRuntime: () => import("../voice/voice-runtime.js"),
  loadDiscordProviderSessionRuntime: () => import("./provider-session.runtime.js"),
  createClient: (...args: ConstructorParameters<typeof Client>) => new Client(...args),
  resolveDiscordAccount,
  resolveNativeCommandsEnabled,
  resolveNativeSkillsEnabled,
  listNativeCommandSpecsForConfig,
  listSkillCommandsForAgents,
  isVerbose,
  shouldLogVerbose,
};
