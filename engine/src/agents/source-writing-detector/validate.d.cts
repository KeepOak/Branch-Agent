export type PreservationFinding = { code: string; message: string };
export type PreservationResult = {
  ok: boolean;
  errors: PreservationFinding[];
  warnings: PreservationFinding[];
  preservation: { ok: boolean; errors: PreservationFinding[]; warnings: PreservationFinding[] };
  quality: { status: string; policy: "error" | "warn"; [key: string]: unknown };
  [key: string]: unknown;
};
declare const validator: {
  validate(original: string, rewritten: string, options?: {
    residualPolicy?: "error" | "warn";
    skipResidual?: boolean;
    maxShrinkRatio?: number;
  }): PreservationResult;
};
export default validator;
