import type { Static } from "typebox";
import { Type } from "typebox";
import { closedObject } from "./closed-object.js";
import { NonEmptyString } from "./primitives.js";

/** The Branch account on this device: its Google sign-in (the refresh token itself stays in the OS keychain). */
export const AccountGoogleStatusSchema = closedObject({
  available: Type.Boolean(),
  reason: Type.Optional(Type.String()),
  signedIn: Type.Boolean(),
  email: Type.Optional(Type.String()),
  signedInAt: Type.Optional(Type.Number()),
  keychain: Type.Optional(Type.String()),
});
export const AccountStatusParamsSchema = closedObject({});
export const AccountStatusResultSchema = closedObject({ google: AccountGoogleStatusSchema });
/** Starts the browser sign-in as a wizard session (wizard.next / wizard.cancel drive it). */
export const AccountGoogleSignInParamsSchema = closedObject({ sessionId: NonEmptyString });
export const AccountSignOutParamsSchema = closedObject({});
export type AccountGoogleStatus = Static<typeof AccountGoogleStatusSchema>;
export type AccountStatusParams = Static<typeof AccountStatusParamsSchema>;
export type AccountStatusResult = Static<typeof AccountStatusResultSchema>;
export type AccountGoogleSignInParams = Static<typeof AccountGoogleSignInParamsSchema>;
export type AccountSignOutParams = Static<typeof AccountSignOutParamsSchema>;
