// From openclaw/openclaw@40ee2cbdd25bd2eadf01ea9685464502509771e3:src/process/supervisor/linux-child-subreaper.ts (atlas SESSIONS-0102). Changed for Branch: discover PPID and waitid candidates when optional procfs task children files are absent; admit a source-loaded owner only when that census is empty.
import type { ChildProcess } from "node:child_process";
import { Buffer } from "node:buffer";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { hasErrnoCode } from "../../infra/errno.js";

const PR_SET_CHILD_SUBREAPER = 36;
const PR_GET_CHILD_SUBREAPER = 37;
const P_ALL = 0;
const P_PID = 1;
const WNOHANG = 1;
const WEXITED = 4;
const WNOWAIT = 0x0100_0000;
// Non-SIGCHLD clone children are otherwise invisible to an ECHILD observation.
const WALL = 0x4000_0000;
const ECHILD = 10;
const EINTR = 4;

function isAbsentProcEntry(error: unknown): boolean {
  return (
    hasErrnoCode(error, "ENOENT") ||
    hasErrnoCode(error, "ESRCH") ||
    hasErrnoCode(error, "EACCES") ||
    hasErrnoCode(error, "EPERM")
  );
}

/** comm can contain whitespace and parentheses; PPID is the second field after the final ')'. */
function parentPidFromStat(stat: string): number | null {
  const close = stat.lastIndexOf(")");
  if (close < 0) {
    return null;
  }
  const fields = stat.slice(close + 1).trim().split(/\s+/u);
  // fields[0] is state; fields[1] is PPID.
  if (fields.length < 2) {
    return null;
  }
  const ppid = Number(fields[1]);
  return Number.isSafeInteger(ppid) && ppid >= 0 ? ppid : null;
}

/** Kernels without CONFIG_PROC_CHILDREN still expose parent identities in stat. */
function childPidsFromParentIdentity(): number[] {
  const children: number[] = [];
  let names: string[];
  try {
    names = readdirSync("/proc");
  } catch (error) {
    if (isAbsentProcEntry(error)) {
      return children;
    }
    throw error;
  }
  for (const name of names) {
    if (!/^\d+$/u.test(name)) {
      continue;
    }
    let stat: string;
    try {
      stat = readFileSync(`/proc/${name}/stat`, "utf8");
    } catch (error) {
      if (isAbsentProcEntry(error)) {
        continue;
      }
      throw error;
    }
    let ppid = parentPidFromStat(stat);
    if (ppid === null) {
      try {
        const status = readFileSync(`/proc/${name}/status`, "utf8");
        const match = /^PPid:\s+(\d+)\s*$/mu.exec(status);
        ppid = match ? Number(match[1]) : null;
      } catch (error) {
        if (!isAbsentProcEntry(error)) {
          throw error;
        }
      }
    }
    if (ppid === process.pid) {
      children.push(Number(name));
    }
  }
  return children;
}

function childPids(): number[] {
  const children = new Set<number>();
  let readableThreads = 0;
  let absentThreads = 0;
  for (const thread of readdirSync("/proc/self/task")) {
    let value: string;
    try {
      value = readFileSync("/proc/self/task/" + thread + "/children", "utf8");
    } catch (error) {
      // A thread can retire, or this kernel can omit task children files.
      // Partial visibility is not a complete census; merge the PPID scan.
      if (isAbsentProcEntry(error)) {
        absentThreads += 1;
        continue;
      }
      throw error;
    }
    readableThreads += 1;
    for (const pid of value.trim().split(/\s+/u).filter(Boolean)) {
      if (!/^\d+$/u.test(pid) || !Number.isSafeInteger(Number(pid)) || Number(pid) <= 0) {
        throw new Error("Linux process owner could not enumerate its children");
      }
      children.add(Number(pid));
    }
  }
  if (readableThreads === 0 || absentThreads > 0) {
    for (const pid of childPidsFromParentIdentity()) {
      children.add(pid);
    }
  }
  return [...children];
}

/** One dedicated process acquires adoption before launching any application work. */
export function acquireLinuxChildSubreaper() {
  if (process.platform !== "linux" || process.versions.bun) {
    throw new Error("Linux child ownership requires the Node runtime");
  }
  // Source loaders are allowed only when they leave no compiler children.
  // Named CI runs the owner through tsx; the kernel census, not the file
  // extension, decides whether this process is still a dedicated owner.
  // This module is host-owned, never a native dependency of the portable worker archive.
  const koffi: typeof import("koffi").default = createRequire(import.meta.url)("koffi");
  const libc = koffi.load(null);
  const prctl = libc.func(
    "int prctl(int, unsigned long, unsigned long, unsigned long, unsigned long)",
  );
  const getSubreaper = libc.func(
    "int prctl(int, _Out_ int *, unsigned long, unsigned long, unsigned long)",
  );
  // Linux permits a null siginfo pointer for presence. Naming a child needs a
  // 128-byte siginfo_t; koffi copies a Buffer back only for _Inout_ pointers.
  // 64-bit layout places si_pid at offset 16 after si_signo/si_errno/si_code/pad.
  const SIGINFO_SIZE = 128;
  const SI_PID_OFFSET = 16;
  const waitidProbe = libc.func("int waitid(int, unsigned int, void *, int)");
  const waitidInfo = libc.func("int waitid(int, unsigned int, _Inout_ uint8_t *, int)");
  const waitpid = libc.func("int waitpid(int, int *, int)");
  const fail = (operation: string, errno = koffi.errno()): never => {
    throw new Error("Linux child ownership " + operation + " failed (errno " + errno + ")");
  };
  const probeWaitid = (idtype: number, id: number, options: number) => {
    for (;;) {
      const rc = waitidProbe(idtype, id, null, options);
      if (rc === 0) {
        return { rc, errno: 0 };
      }
      const errno = koffi.errno();
      if (errno !== EINTR) {
        return { rc, errno };
      }
    }
  };
  const observeWaitid = (idtype: number, id: number, options: number) => {
    for (;;) {
      const info = Buffer.alloc(SIGINFO_SIZE);
      const rc = waitidInfo(idtype, id, info, options);
      if (rc === 0) {
        const pid = info.readInt32LE(SI_PID_OFFSET);
        return { rc, errno: 0, pid: Number.isSafeInteger(pid) && pid > 0 ? pid : 0 };
      }
      const errno = koffi.errno();
      if (errno !== EINTR) {
        return { rc, errno, pid: 0 };
      }
    }
  };
  if (prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) !== 0) {
    fail("admission");
  }
  const admitted = [0];
  if (getSubreaper(PR_GET_CHILD_SUBREAPER, admitted, 0, 0, 0) !== 0 || admitted[0] !== 1) {
    fail("admission verification");
  }
  const libuvChildren = new Set<number>();
  const signaledChildren = new Map<number, "SIGTERM" | "SIGKILL">();
  const retainLibuvChild = (pid: number, child: Pick<ChildProcess, "pid" | "once">) => {
    if (child.pid !== pid || !Number.isSafeInteger(pid) || pid <= 0) {
      throw new Error("Linux child ownership requires a spawned root");
    }
    libuvChildren.add(pid);
    // libuv reaps before emitting exit, in this same event-loop turn. Retire the
    // signal reservation here so a newly adopted reuse of this PID gets its own signal.
    child.once("exit", () => {
      libuvChildren.delete(pid);
      signaledChildren.delete(pid);
    });
  };
  // A loader thread can reap its compiler concurrently with this thread. That
  // would invalidate numeric-PID pinning. Admit only the dedicated built owner,
  // before its one libuv-owned application root has been spawned.
  if (childPids().length > 0) {
    throw new Error("Linux child ownership requires a dedicated owner without existing children");
  }
  let closed = false;
  const owns = (pid: number): boolean => {
    const observed = probeWaitid(P_PID, pid, WEXITED | WNOHANG | WNOWAIT | WALL);
    if (observed.rc === 0) {
      return true;
    }
    if (observed.errno === ECHILD) {
      return false;
    }
    fail("child wait", observed.errno);
  };
  /** When task children files and /proc PPID scans miss a descendant, waitid still names one. */
  const childPidsFromWaitOwnership = (): number[] => {
    const observed = observeWaitid(P_ALL, 0, WEXITED | WNOHANG | WNOWAIT | WALL);
    if (observed.rc === 0) {
      return observed.pid > 0 ? [observed.pid] : [];
    }
    if (observed.errno === ECHILD) {
      return [];
    }
    fail("child wait", observed.errno);
  };
  return {
    retainLibuvChild,
    /** Discovery selects candidates; a retained kernel wait pins every signal target. */
    drain(signal?: "SIGTERM" | "SIGKILL"): boolean {
      if (closed) {
        return true;
      }
      const discovered = new Set(childPids());
      for (const pid of childPidsFromWaitOwnership()) {
        discovered.add(pid);
      }
      for (const pid of discovered) {
        if (!owns(pid)) {
          continue;
        }
        const previousSignal = signaledChildren.get(pid);
        if (signal && previousSignal !== signal && previousSignal !== "SIGKILL") {
          try {
            // No await, reap, or event-loop callback may cross this ownership/signal pair.
            process.kill(pid, signal);
          } catch (error) {
            if (!hasErrnoCode(error, "ESRCH")) {
              throw error;
            }
          }
          signaledChildren.set(pid, signal);
        }
        if (libuvChildren.has(pid)) {
          continue;
        }
        const reaped = waitpid(pid, null, WNOHANG | WALL);
        if (reaped === pid) {
          signaledChildren.delete(pid);
        } else if (reaped < 0) {
          const errno = koffi.errno();
          if (errno === ECHILD) {
            signaledChildren.delete(pid);
          } else if (errno !== EINTR) {
            fail("adopted child reap", errno);
          }
        }
      }
      const remaining = probeWaitid(P_ALL, 0, WEXITED | WNOHANG | WNOWAIT | WALL);
      if (remaining.rc === 0) {
        return false;
      }
      if (remaining.errno === EINTR) {
        return false;
      }
      if (remaining.errno !== ECHILD) {
        fail("extinction observation", remaining.errno);
      }
      closed = true;
      return true;
    },
  };
}
