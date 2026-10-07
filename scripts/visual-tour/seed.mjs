// Seed through the same gateway RPCs the window calls. All names and credentials are fixtures.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { gatewayPort } from './gateway-port.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const port = gatewayPort();
const token = process.env.BRANCH_GATEWAY_TOKEN;
if (!token) throw new Error('BRANCH_GATEWAY_TOKEN is required');

function call(method, params = {}) {
  const result = spawnSync(process.execPath, [resolve(root, 'engine/branch.mjs'), 'gateway', 'call', method,
    '--url', `ws://127.0.0.1:${port}`, '--token', token, '--params', JSON.stringify(params), '--json'],
    { cwd: resolve(root, 'engine'), encoding: 'utf8', env: process.env, windowsHide: true, timeout: 30000 });
  if (result.status !== 0) throw new Error(`${method}: ${(result.stderr || result.stdout).slice(0, 1000)}`);
  try { return JSON.parse(result.stdout); } catch { throw new Error(`${method}: invalid JSON: ${result.stdout.slice(0, 500)}`); }
}

const agents = [];
for (const name of ['Researcher', 'Builder', 'Planner']) {
  const response = call('agents.create', { name });
  agents.push(response.agentId ?? response.result?.agentId);
}
if (agents.some((id) => !id)) throw new Error('agents.create did not return three Trunk ids');

const notes = [
  ['visual-research', 'Research notes', 'Summarize the customer interviews and list three open questions.'],
  ['visual-roadmap', 'October roadmap', 'Draft milestones for the next release.'],
  ['visual-design', 'Design review', 'Compare the Grove with the preview.'],
];
const researchKey = `agent:${agents[0]}:visual-research`;
for (const [index, [suffix, title, message]] of notes.entries()) {
  const agentId = agents[index];
  const key = `agent:${agentId}:${suffix}`;
  call('sessions.create', { key, agentId, displayName: title });
  // An initial sessions.create message starts an agent run. Inject a fixture
  // transcript entry instead so screenshots need no model or provider access.
  call('chat.inject', { sessionKey: key, agentId, message, label: 'Tour fixture' });
  // For the research conversation, add computer activity for stage screenshots
  if (suffix === 'visual-research') {
    call('chat.inject', { sessionKey: key, agentId, message: 'Looking at the customer feedback spreadsheet.', label: 'Computer activity', blockType: 'step', blockTitle: 'Opened customer_feedback.xlsx', blockTool: 'computer', blockStatus: 'ok' });
  }
}
const roomResponse = call('rooms.create', { name: 'Planning circle', members: [
  { kind: 'trunk', id: agents[0], role: 'lead' }, { kind: 'trunk', id: agents[1] },
] });
const roomId = roomResponse.room?.roomId ?? roomResponse.result?.room?.roomId;
if (!roomId) throw new Error('rooms.create did not return a group');
// The tour only inspects UI state. Do not install fake credentials: the gateway
// validates provider keys on write, which can make a real provider request.
const config = call('config.get');
if (!config.hash) throw new Error('config.get did not return a revision for fixture setup');
call('config.patch', {
  baseHash: config.hash,
  raw: JSON.stringify({ wizard: { lastRunAt: new Date().toISOString(), lastRunCommand: 'window', lastRunMode: 'local' } }),
});
writeFileSync(resolve(process.env.VISUAL_OUT ?? 'visual-tour-output', 'fixture.json'), JSON.stringify({ researchKey }));
console.log(`Seeded ${agents.length} Trunks, ${notes.length} conversations, and one group without provider credentials.`);
