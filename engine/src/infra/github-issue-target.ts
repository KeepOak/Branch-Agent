/**
 * Branch-owned GitHub repository that receives crash and update failure reports
 * filed with the user's own gh credentials. Reports never go to the upstream tracker.
 */
export const GITHUB_ISSUE_REPOSITORY = "KeepOak/Branch-Agent";

/** Repository argument for gh issue lookups. */
export const GITHUB_ISSUE_REPOSITORY_REF = "github.com/" + GITHUB_ISSUE_REPOSITORY;

/** REST endpoint that creates an issue in the report repository. */
export const GITHUB_ISSUE_CREATE_API = "repos/" + GITHUB_ISSUE_REPOSITORY + "/issues";

/** Browser page that opens a prefilled issue in the report repository. */
export const GITHUB_ISSUE_NEW_URL = "https://github.com/" + GITHUB_ISSUE_REPOSITORY + "/issues/new";

/** Path of a created issue in the report repository. */
export const GITHUB_CREATED_ISSUE_PATH_RE = /^\/KeepOak\/Branch-Agent\/issues\/\d+$/u;

/** Path of the prefilled new-issue page in the report repository. */
export const GITHUB_NEW_ISSUE_PATH_RE = /^\/KeepOak\/Branch-Agent\/issues\/new$/u;
