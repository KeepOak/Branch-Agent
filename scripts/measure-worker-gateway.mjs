// Reuse the engine's composed scratch gateway: real admission, placement,
// inference, transcript and live-event handlers; only the model is fake.
process.stderr.write('Scratch gateway: loading engine\n');
const { ComposedGatewayHarness, doneOutcome } = await import('../engine/src/worker/worker-fault-injection.test-support.ts');
const { createDeferred } = await import('../engine/test/helpers/promise.ts');

process.stderr.write('Scratch gateway: opening state\n');
const gateway = await ComposedGatewayHarness.create(process.env.BRANCH_MEASURE_ROOT);
try {
  process.stderr.write('Scratch gateway: binding loopback\n');
  await gateway.start({ loopback: true });
  const started = createDeferred();
  const release = createDeferred();
  gateway.providerPlan = { kind: 'pending', started, release };
  void started.promise.then(() => {
    process.send({ type: 'provider-started' });
    release.resolve(doneOutcome('done'));
  });
  const descriptor = await gateway.createDescriptor();
  process.stderr.write('Scratch gateway: assignment ready\n');
  descriptor.assignment.prompt = 'Say done.';
  process.send({ type: 'gateway-ready', descriptor });
  await new Promise(resolve => process.once('message', resolve));
  if (gateway.providerCalls !== 1 || !gateway.requestParams('worker.transcript.commit').length) {
    throw new Error('The measured turn did not run inference and commit its transcript');
  }
  process.send({ type: 'gateway-proof', providerCalls: gateway.providerCalls,
    transcriptCommits: gateway.requestParams('worker.transcript.commit').length });
} finally {
  await gateway.close();
  process.disconnect();
}
