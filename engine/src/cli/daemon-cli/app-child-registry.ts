// In-process registry for a fallback supervisor that this CLI still holds.
export type AppChildStoppable = {
  stop: (options?: { keepError?: string }) => Promise<{
    stopped: boolean;
    escalated: boolean;
    message: string;
  }>;
};

const supervisors = new Map<number, AppChildStoppable>();

export function getAppChildSupervisor(port: number): AppChildStoppable | undefined {
  return supervisors.get(port);
}

export function rememberAppChildSupervisor(port: number, supervisor: AppChildStoppable): void {
  supervisors.set(port, supervisor);
}

export function forgetAppChildSupervisor(port: number): void {
  supervisors.delete(port);
}
