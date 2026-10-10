import { Type } from "typebox";
import type { BranchConfig } from "../../config/types.branch.js";
import { optionalPositiveIntegerSchema } from "../schema/typebox.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readToolStringParam } from "./common.js";
import {
  callAgentToolGatewayRequest,
  type AgentToolGatewayRequestCaller,
} from "./in-process-gateway.js";

/** Group-chat tools for a Trunk. The Gateway takes the caller's identity from the run, never from params. */
type TrunkRoomToolOptions = {
  config?: BranchConfig;
  callGateway?: AgentToolGatewayRequestCaller;
};

const EmptySchema = Type.Object({}, { additionalProperties: false });

const RoomReadSchema = Type.Object(
  {
    roomId: Type.String({ minLength: 1 }),
    cursor: Type.Optional(Type.Integer({ minimum: 0 })),
    limit: optionalPositiveIntegerSchema(),
  },
  { additionalProperties: false },
);

const RoomPostSchema = Type.Object(
  {
    roomId: Type.String({ minLength: 1 }),
    text: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

function roomTool(params: {
  name: string;
  label: string;
  description: string;
  parameters: AnyAgentTool["parameters"];
  method: string;
  toParams: (args: Record<string, unknown>) => Record<string, unknown>;
  options: TrunkRoomToolOptions;
}): AnyAgentTool {
  const gatewayCall = params.options.callGateway ?? callAgentToolGatewayRequest;
  return {
    label: params.label,
    name: params.name,
    displaySummary: params.description,
    description: params.description,
    parameters: params.parameters,
    execute: async (_toolCallId, args, signal) => {
      const request = {
        method: params.method,
        params: params.toParams(args as Record<string, unknown>),
        ...(params.options.config ? { config: params.options.config } : {}),
        ...(signal ? { signal } : {}),
      };
      return jsonResult(await gatewayCall(request));
    },
  };
}

export function createRoomListTool(options: TrunkRoomToolOptions = {}): AnyAgentTool {
  return roomTool({
    name: "room_list",
    label: "Room List",
    description: "List the group chats you are an enabled member of, with their members and rule.",
    parameters: EmptySchema,
    method: "rooms.trunk.list",
    toParams: () => ({}),
    options,
  });
}

export function createRoomReadTool(options: TrunkRoomToolOptions = {}): AnyAgentTool {
  return roomTool({
    name: "room_read",
    label: "Room Read",
    description: "Read a group chat you are in: its events in order, from an optional cursor.",
    parameters: RoomReadSchema,
    method: "rooms.trunk.read",
    toParams: (args) => {
      const roomId = readToolStringParam(args, "roomId", { required: true });
      const cursor = typeof args.cursor === "number" ? args.cursor : undefined;
      const limit = typeof args.limit === "number" ? args.limit : undefined;
      return {
        roomId,
        ...(cursor !== undefined ? { cursor } : {}),
        ...(limit !== undefined ? { limit } : {}),
      };
    },
    options,
  });
}

export function createRoomPostTool(options: TrunkRoomToolOptions = {}): AnyAgentTool {
  return roomTool({
    name: "room_post",
    label: "Room Post",
    description:
      "Post to a group chat you are in, as yourself. Posting records the message; it does not start other Trunks. To wake a Trunk, use trunk_message.",
    parameters: RoomPostSchema,
    method: "rooms.trunk.post",
    toParams: (args) => ({
      roomId: readToolStringParam(args, "roomId", { required: true }),
      message: readToolStringParam(args, "text", { required: true }),
    }),
    options,
  });
}
