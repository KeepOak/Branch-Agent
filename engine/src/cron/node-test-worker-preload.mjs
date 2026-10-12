// Bootstrap real TypeScript workers against an existing read-only dependency tree.
import { pathToFileURL } from 'node:url';
const dependencyRoot = process.env.BRANCH_AUTOMATION_TEST_DEPENDENCY_ROOT;
if (!dependencyRoot) throw new Error('BRANCH_AUTOMATION_TEST_DEPENDENCY_ROOT is required');
await import(pathToFileURL(`${dependencyRoot}/node_modules/tsx/dist/esm/index.mjs`).href);
await import('./node-test-dependencies.mjs');
