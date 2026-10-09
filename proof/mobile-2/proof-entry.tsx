// Proof harness only (not part of the app): the real App and screens on the in-memory fake engine,
// with a hook the capture script uses to press Approve "on the computer".
import { registerRootComponent } from 'expo';
import App from './App';
import { createFakeSession } from './src/testing/fakeSession';

const { session, engine } = createFakeSession();
(globalThis as { branchProof?: { approve: () => void } }).branchProof = { approve: () => engine.approve() };

registerRootComponent(() => <App session={session} />);
