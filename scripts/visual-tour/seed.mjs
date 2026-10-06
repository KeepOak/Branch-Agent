// Seed through the same gateway RPCs the window calls. All names and credentials are fixtures.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const port = process.env.VISUAL_GATEWAY_PORT;
const token = process.env.BRANCH_GATEWAY_TOKEN;
if (!port || !token) throw new Error('VISUAL_GATEWAY_PORT and BRANCH_GATEWAY_TOKEN are required');

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
for (const [index, [suffix, title, message]] of notes.entries()) {
  const agentId = agents[index];
  call('sessions.create', { key: `agent:${agentId}:${suffix}`, agentId, displayName: title, message });
}
const roomResponse = call('rooms.create', { name: 'Planning circle', members: [
  { kind: 'trunk', id: agents[0], role: 'lead' }, { kind: 'trunk', id: agents[1] },
] });
const roomId = roomResponse.room?.roomId ?? roomResponse.result?.room?.roomId;
if (!roomId) throw new Error('rooms.create did not return a group');
call('rooms.send', { roomId, message: 'Let’s review the October plan together.' });
for (const provider of ['anthropic', 'openai']) {
  call('models.authSetApiKey', {
    agentId: agents[0],
    provider,
    apiKey: provider === 'openai'
      ? 'sk-visual-tour-fixture-openai-never-valid'
      : `visual-tour-fixture-${provider}-never-valid`,
  });
}
console.log(`Seeded ${agents.length} Trunks, ${notes.length} conversations, one group, and two fake accounts.`);
