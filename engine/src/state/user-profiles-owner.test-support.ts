import {
  openBranchStateDatabase,
  type BranchStateDatabaseOptions,
} from "./branch-state-db.js";
import { setUserProfileRole } from "./user-profile-writes.worker.js";
import { ensureProfileForEmail } from "./user-profiles.js";

export function profileState(options: BranchStateDatabaseOptions) {
  const db = openBranchStateDatabase(options).db;
  return {
    profiles: db.prepare("SELECT * FROM user_profiles ORDER BY id").all(),
    emails: db.prepare("SELECT * FROM user_profile_emails ORDER BY email").all(),
    identities: db
      .prepare("SELECT * FROM user_profile_identities ORDER BY provider, subject")
      .all(),
  };
}

export function mergeOwnerIntoPerson(ownerId: string, options: BranchStateDatabaseOptions) {
  const person = ensureProfileForEmail("person@example.test", options);
  setUserProfileRole(person.id, "guest", options);
  openBranchStateDatabase(options)
    .db.prepare("UPDATE user_profiles SET merged_into = ?, updated_at = 1 WHERE id = ?")
    .run(person.id, ownerId);
  return person;
}
