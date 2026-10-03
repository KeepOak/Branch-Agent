import {
  openBranchStateDatabase,
  type BranchStateDatabaseOptions,
} from "./branch-state-db.js";
import {
  inspectProfileAvatarInDatabase,
  readUserProfileAvatarCommand,
} from "./user-profiles-internal.js";

export function getProfileAvatar(profileId: string, options: BranchStateDatabaseOptions = {}) {
  const { db } = openBranchStateDatabase(options);
  const { profile, avatar } = inspectProfileAvatarInDatabase(db, profileId);
  return profile && avatar
    ? readUserProfileAvatarCommand(db, {
        type: "userProfiles.avatar.read",
        profileId,
        expected: { canonicalProfileId: profile.id, sha256: avatar.sha256, mime: avatar.mime },
      }).avatar
    : undefined;
}
