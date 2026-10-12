import {
  createAliasOnlyPresetAppliers,
  type BranchConfig,
} from "branch/plugin-sdk/provider-onboard";
import { DEEPINFRA_DEFAULT_MODEL_REF } from "./provider-static-catalog.js";

export function applyDeepInfraConfig(
  cfg: BranchConfig,
  modelRef: string = DEEPINFRA_DEFAULT_MODEL_REF,
): BranchConfig {
  return createAliasOnlyPresetAppliers({ modelRef, alias: "DeepInfra" }).applyConfig(cfg);
}
