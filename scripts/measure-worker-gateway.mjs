// Reuse the engine's composed scratch gateway: real admission, placement,
// inference, transcript and live-event handlers; only the model is fake.
import { ComposedGatewayHarness } from '../engine/src/worker/worker-fault-injection.test-support.ts';
import { createDeferred } from '../engine/test/helpers/promise.ts';
import { doneOutcome } from '../engine/src/worker/worker-fault-injection.test-support.ts';

const gateway = await ComposedGatewayHarness.create(process.env.BRANCH_MEASURE_ROOT);
try {
  await gateway.start({ loopback: true });
  const started = createDeferred();
  const release = createDeferred();
  gateway.providerPlan = { kind: 'pending', started, release };
  void started.promise.then(() => {
    process.send({ type: 'provider-started' });
    release.resolve(doneOutcome('done'));
  });
  const descriptor = await gateway.createDescriptor();
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
