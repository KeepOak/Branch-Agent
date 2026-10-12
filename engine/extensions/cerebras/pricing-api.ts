import {
  normalizeModelPricingCatalog,
  normalizeOpenRouterModelPricing,
} from "branch/plugin-sdk/model-catalog-pricing";
import { asOptionalRecord } from "branch/plugin-sdk/string-coerce-runtime";

export function parseCerebrasPricingCatalog(payload: unknown) {
  return normalizeModelPricingCatalog(
    asOptionalRecord(payload)?.data,
    normalizeOpenRouterModelPricing,
  );
}
