import type { RouteLocation } from "@openclaw/uirouter";
import { isValidCanopyBoardId } from "@branch/canopy-contract";
import {
  INTERNAL_CANOPY_PATH_PARAM,
  pathForRoute,
  pathForCanopyBoard,
  restoreBridgedRouteLocation,
  canopyBoardIdFromPath,
} from "../../app-route-paths.ts";
// Existing Canopy URLs persist this value for the all-boards route.
const CANOPY_ALL_BOARDS_FILTER = "__all__";

export type CanopyRouteData = {
  boardFilter: string;
  canonicalLocation?: RouteLocation;
  search: string;
};

export function canopyRouteLocation(location: RouteLocation): RouteLocation {
  // The router's private bridge must not masquerade as the public legacy
  // `board` query, or its canonical redirect survives after the real path wins.
  return restoreBridgedRouteLocation(location, INTERNAL_CANOPY_PATH_PARAM);
}

export function resolveCanopyRouteLocation(
  sourceLocation: RouteLocation,
  basePath = "",
): CanopyRouteData {
  const location = canopyRouteLocation(sourceLocation);
  const pathBoardId = canopyBoardIdFromPath(location.pathname, basePath);
  const params = new URLSearchParams(location.search);
  const hadLegacyBoard = params.has("board");
  if (!pathBoardId && !hadLegacyBoard) {
    return { boardFilter: CANOPY_ALL_BOARDS_FILTER, search: location.search };
  }
  const legacyBoardValue = params.get("board")?.trim() ?? "";
  params.delete("board");
  const search = params.toString();
  const boardFilter =
    pathBoardId ??
    (isValidCanopyBoardId(legacyBoardValue) ? legacyBoardValue : CANOPY_ALL_BOARDS_FILTER);
  return {
    boardFilter,
    search: search ? `?${search}` : "",
    ...(hadLegacyBoard
      ? {
          canonicalLocation: {
            pathname:
              boardFilter === CANOPY_ALL_BOARDS_FILTER
                ? pathForRoute("canopy", basePath)
                : pathForCanopyBoard(boardFilter, basePath),
            search: search ? `?${search}` : "",
            hash: location.hash,
          },
        }
      : {}),
  };
}
