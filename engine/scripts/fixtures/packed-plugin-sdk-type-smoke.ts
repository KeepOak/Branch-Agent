// Packed Plugin Sdk Type Smoke script supports Branch Agent repository automation.
import { defineToolPlugin } from "branch/plugin-sdk/tool-plugin";
import "./packed-plugin-sdk-setup-consumer.js";
type PublicPluginSdkModules = [
  typeof import("branch/plugin-sdk/core"),
  typeof import("branch/plugin-sdk/channel-entry-contract"),
  typeof import("branch/plugin-sdk/config-contracts"),
  typeof import("branch/plugin-sdk/plugin-entry"),
  typeof import("branch/plugin-sdk/runtime-env"),
  typeof import("branch/plugin-sdk/tool-plugin"),
];

const resolvedModules = null as unknown as PublicPluginSdkModules;
void resolvedModules;
void defineToolPlugin;
