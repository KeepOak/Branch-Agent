import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

function desktopDataDirectory(env) {
  if (env.BRANCH_DESKTOP_DATA) return env.BRANCH_DESKTOP_DATA;
  const legacy = join(homedir(), 'BranchApp');
  if (existsSync(join(legacy, 'desktop.json')) ||
      existsSync(join(legacy, 'gateway-token')) && existsSync(join(legacy, 'engine-current.txt'))) return legacy;
  if (process.platform === 'win32') return join(env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'BranchAgent');
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'BranchAgent');
  return join(env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'BranchAgent');
}

export function gatewayPort(env = process.env) {
  const ownerData = desktopDataDirectory(env);
  if (env.BRANCH_HOME && resolve(env.BRANCH_HOME) === resolve(ownerData)) {
    throw new Error('BRANCH_HOME must not be the desktop data folder');
  }
  let ownerPort;
  try {
    ownerPort = readFileSync(join(ownerData, 'gateway-port'), 'utf8').trim();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  let port = env.VISUAL_GATEWAY_PORT;
  if (!port && env.BRANCH_HOME) {
    try { port = readFileSync(join(env.BRANCH_HOME, 'gateway-port'), 'utf8').trim(); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!port) throw new Error('VISUAL_GATEWAY_PORT or a BRANCH_HOME with gateway-port is required');
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('Invalid visual tour gateway port');
  if (Number(port) === 19031 || ownerPort && Number(port) === Number(ownerPort)) {
    throw new Error('Visual tour refuses the owner gateway port');
  }
  return port;
}
