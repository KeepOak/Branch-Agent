// Shared config names let the build wrapper isolate the large unified DTS graph.
export const TSDOWN_PACKAGE_CONFIG_GROUP = "branch-packages";
export const TSDOWN_UNIFIED_CONFIG_GROUP = "branch-unified";
export const TSDOWN_UNIFIED_DTS_CONFIG_GROUPS = [
  "branch-dts-base",
  "branch-dts-plugin-sdk-1",
  "branch-dts-plugin-sdk-2",
  "branch-dts-extensions-1",
  "branch-dts-extensions-2",
  "branch-dts-extensions-3",
  "branch-dts-extensions-4",
  "branch-dts-extensions-5",
] as const;

export const TSDOWN_PLUGIN_SDK_DTS_CONFIG_GROUPS = TSDOWN_UNIFIED_DTS_CONFIG_GROUPS.slice(1, 3);

export const TSDOWN_NON_SDK_DTS_CONFIG_GROUPS = TSDOWN_UNIFIED_DTS_CONFIG_GROUPS.filter(
  (group) => !TSDOWN_PLUGIN_SDK_DTS_CONFIG_GROUPS.includes(group),
);
