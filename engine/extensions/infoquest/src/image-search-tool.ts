import type { BranchPluginApi } from "branch/plugin-sdk/plugin-runtime";
import { jsonResult, readStringParam } from "branch/plugin-sdk/provider-web-search";
import { Type } from "typebox";
import { runInfoQuestSearch } from "./client.js";
export function createInfoQuestImageSearchTool(api: BranchPluginApi, assertCurrent?: () => void) {
  return {
    name: "infoquest_image_search",
    label: "InfoQuest Image Search",
    resultContentSource: "network" as const,
    description:
      "Search for reference images using BytePlus InfoQuest. Returns original image URLs and titles. Time range and image size follow configured imageSearch settings.",
    parameters: Type.Object(
      {
        query: Type.String({ description: "Image search query." }),
        site: Type.Optional(Type.String({ description: "Optional site filter." })),
      },
      { additionalProperties: false },
    ),
    execute: async (
      _toolCallId: string,
      rawParams: Record<string, unknown>,
      signal?: AbortSignal,
    ) => {
      signal?.throwIfAborted();
      assertCurrent?.();
      const query = readStringParam(rawParams, "query", { required: true });
      const result = await runInfoQuestSearch({
        cfg: api.config,
        query,
        images: true,
        site: readStringParam(rawParams, "site"),
        signal,
        assertCurrent,
      });
      signal?.throwIfAborted();
      assertCurrent?.();
      return jsonResult(result);
    },
  };
}
