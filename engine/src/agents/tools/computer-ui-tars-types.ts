/*
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */
// UI-TARS shared constants and strict local projection of parser contracts.
export const IMAGE_FACTOR = 28;
export const MIN_PIXELS = 100 * IMAGE_FACTOR * IMAGE_FACTOR;
export const MAX_PIXELS_V1_5 = 16384 * IMAGE_FACTOR * IMAGE_FACTOR;
export const MAX_RATIO = 200;
export const UITarsModelVersion = {
  V1_0: "1.0",
  V1_5: "1.5",
  DOUBAO_1_5_15B: "doubao-1.5-15B",
  DOUBAO_1_5_20B: "doubao-1.5-20B",
} as const;
export type UITarsModelVersion = (typeof UITarsModelVersion)[keyof typeof UITarsModelVersion];
export type ActionInputs = Record<string, string | number[] | undefined>;
export type PredictionParsed = {
  reflection: string | null;
  thought: string;
  action_type: string;
  action_inputs: ActionInputs;
};
export type Coordinates = { raw: { x: number; y: number }; normalized?: { x: number; y: number } };
export type BaseAction = { type: string; inputs: Record<string, unknown> };
export type NormalizeCoordinates = (coordinates: Coordinates) => {
  normalized: { x: number; y: number };
};
