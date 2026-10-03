export type MatrixManagedDeviceInfo = {
  deviceId: string;
  displayName: string | null;
  current: boolean;
};

type MatrixDeviceHealthSummary = {
  currentDeviceId: string | null;
  staleBranchDevices: MatrixManagedDeviceInfo[];
  currentBranchDevices: MatrixManagedDeviceInfo[];
};

const BRANCH_DEVICE_NAME_PREFIX = "Branch Agent ";

export function isBranchManagedMatrixDevice(displayName: string | null | undefined): boolean {
  return displayName?.startsWith(BRANCH_DEVICE_NAME_PREFIX) === true;
}

export function summarizeMatrixDeviceHealth(
  devices: MatrixManagedDeviceInfo[],
): MatrixDeviceHealthSummary {
  const currentDeviceId = devices.find((device) => device.current)?.deviceId ?? null;
  const branchDevices = devices.filter((device) =>
    isBranchManagedMatrixDevice(device.displayName),
  );
  return {
    currentDeviceId,
    staleBranchDevices: branchDevices.filter((device) => !device.current),
    currentBranchDevices: branchDevices.filter((device) => device.current),
  };
}
