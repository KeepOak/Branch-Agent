import type { AcpSessionUpdateTag } from "@branch/acp-core/runtime/types";
import type { z } from "zod";
import type { BranchSchemaShape } from "./zod-schema.root-shape.js";

type SchemaAcpConfig = NonNullable<z.input<typeof BranchSchemaShape.acp>>;

export type AcpDispatchConfig = NonNullable<SchemaAcpConfig["dispatch"]>;
export type AcpStreamConfig = Omit<NonNullable<SchemaAcpConfig["stream"]>, "tagVisibility"> & {
  tagVisibility?: Partial<Record<AcpSessionUpdateTag, boolean>>;
};
export type AcpRuntimeConfig = NonNullable<SchemaAcpConfig["runtime"]>;
export type AcpConfig = Omit<SchemaAcpConfig, "stream"> & { stream?: AcpStreamConfig };
