// Stop the fallback supervisor first, then the child, with identity checks
// before any SIGKILL or taskkill /T /F.
import { signalVerifiedGatewayPidSync } from "../../infra/gateway-processes.js";
import { isPidAlive } from "../../shared/pid-alive.js";
import {
  type AppChildSleepFn,
  DEFAULT_CHILD_STOP_WAIT_MS,
  forceKillPid,
  signalProcess,
  waitForPidExit,
} from "./app-child-process.js";
import {
  type AppChildReadStartTime,
  GATEWAY_CHILD_ESCALATED_STOP_MESSAGE,
  GATEWAY_CHILD_STOP_FAILED_MESSAGE,
  GATEWAY_CHILD_STOPPED_MESSAGE,
  canEscalateRecordedPid,
  clearAppChildRecord,
  defaultReadStartTime,
  isSameRecordedProcess,
  markAppChildStopRequested,
  readAppChildRecord,
  writeFailedAppChildRecord,
} from "./app-child-record.js";
import {
  forgetAppChildSupervisor,
  getAppChildSupervisor,
} from "./app-child-registry.js";

export type AppChildStopOutcome = {
  stopped: boolean;
  escalated: boolean;
  message: string;
};

async function stopRecordedPid(params: {
  pid?: number;
  startedAt?: number;
  waitMs: number;
  sleep?: AppChildSleepFn;
  isAlive: (pid: number) => boolean;
  readStartTime: AppChildReadStartTime;
  forceKillPid?: (pid: number) => void;
  signal?: (pid: number) => void;
}): Promise<{ gone: boolean; escalated: boolean }> {
  const { pid, startedAt } = params;
  if (!pid || !params.isAlive(pid)) {
    return { gone: true, escalated: false };
  }
  if (!isSameRecordedProcess(pid, startedAt, params.readStartTime, params.isAlive)) {
    return { gone: true, escalated: false };
  }
  params.signal?.(pid);
  let gone =
    params.waitMs > 0
      ? await waitForPidExit({
          pid,
          timeoutMs: params.waitMs,
          sleep: params.sleep,
          isAlive: params.isAlive,
        })
      : !params.isAlive(pid);
  let escalated = false;
  if (!gone && canEscalateRecordedPid(pid, startedAt, params.readStartTime, params.isAlive)) {
    escalated = true;
    (params.forceKillPid ?? ((target: number) => forceKillPid(target)))(pid);
    gone =
      params.waitMs > 0
        ? await waitForPidExit({
            pid,
            timeoutMs: params.waitMs,
            sleep: params.sleep,
            isAlive: params.isAlive,
          })
        : !params.isAlive(pid);
  }
  return { gone, escalated };
}

export async function stopAppChildGateway(params: {
  port: number;
  env?: NodeJS.ProcessEnv;
  signalPid?: typeof signalVerifiedGatewayPidSync;
  signalSupervisor?: (pid: number) => void;
  stopWaitMs?: number;
  sleep?: AppChildSleepFn;
  forceKillPid?: (pid: number) => void;
  isAlive?: (pid: number) => boolean;
  readStartTime?: AppChildReadStartTime;
  keepError?: string;
}): Promise<AppChildStopOutcome> {
  const env = params.env ?? process.env;
  const supervisor = getAppChildSupervisor(params.port);
  if (supervisor) {
    const outcome = await supervisor.stop({ keepError: params.keepError });
    forgetAppChildSupervisor(params.port);
    return outcome;
  }
  const recorded = readAppChildRecord(env);
  if (!recorded || recorded.port !== params.port) {
    clearAppChildRecord(env);
    return { stopped: false, escalated: false, message: GATEWAY_CHILD_STOPPED_MESSAGE };
  }
  markAppChildStopRequested(env);
  const waitMs = params.stopWaitMs ?? DEFAULT_CHILD_STOP_WAIT_MS;
  const alive = params.isAlive ?? isPidAlive;
  const readStartTime = params.readStartTime ?? ((pid: number) => defaultReadStartTime(pid, env));
  const supervisorStop = await stopRecordedPid({
    pid: recorded.supervisorPid,
    startedAt: recorded.supervisorStartedAt,
    waitMs,
    sleep: params.sleep,
    isAlive: alive,
    readStartTime,
    forceKillPid: params.forceKillPid,
    signal: (pid) => (params.signalSupervisor ?? ((target) => signalProcess(target, "SIGTERM")))(pid),
  });
  const childStop = await stopRecordedPid({
    pid: recorded.pid,
    startedAt: recorded.startedAt,
    waitMs,
    sleep: params.sleep,
    isAlive: alive,
    readStartTime,
    forceKillPid: params.forceKillPid,
    signal: (pid) =>
      (params.signalPid ?? signalVerifiedGatewayPidSync)(pid, "SIGTERM", { env, port: params.port }),
  });
  const stopped = supervisorStop.gone && childStop.gone;
  const escalated = supervisorStop.escalated || childStop.escalated;
  if (stopped) {
    if (params.keepError) {
      writeFailedAppChildRecord(params.port, params.keepError, env);
    } else {
      clearAppChildRecord(env);
    }
  }
  return {
    stopped,
    escalated,
    message: stopped
      ? escalated
        ? GATEWAY_CHILD_ESCALATED_STOP_MESSAGE
        : GATEWAY_CHILD_STOPPED_MESSAGE
      : GATEWAY_CHILD_STOP_FAILED_MESSAGE,
  };
}
