// Whether a sandbox can write to host paths (atlas SAFETY-0020): the exec always-ask floor only
// skips sandbox runs that cannot, so an rw workspace or a docker bind without :ro keeps it on.

function isReadOnlyBind(bind: string): boolean {
  const parts = bind.split(":");
  return parts.length >= 3 && (parts.at(-1) ?? "").split(",").includes("ro");
}

/** True when the sandbox mounts a host path read-write (rw workspace or a docker bind without ro). */
export function sandboxHasWritableHostMounts(sandbox: {
  workspaceAccess?: string;
  docker?: { binds?: readonly string[] };
}): boolean {
  if (sandbox.workspaceAccess === "rw") {
    return true;
  }
  return (sandbox.docker?.binds ?? []).some((bind) => !isReadOnlyBind(bind));
}
