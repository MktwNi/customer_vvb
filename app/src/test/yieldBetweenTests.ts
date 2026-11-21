import { afterEach } from 'vitest';

/**
 * After each test, let the worker's event loop take one full turn (vite.config.ts `test.setupFiles`).
 *
 * A worker talks to vitest's main process by messages, and every call it makes there (onTaskUpdate, sent as
 * tests finish) gives up after 60 seconds. Between tests of one file the runner only chains promises, so a
 * file whose tests never wait on a timer or I/O keeps the worker from reading the main process's replies
 * until the file ends; when it ends, the expired 60-second timer runs before the reply is read, and the run
 * fails with "[vitest-worker]: Timeout calling onTaskUpdate" though every test passed. That was the
 * registry import tests (registryXlsx.engine*.test.ts, about a minute per file on a busy machine), which is
 * why the deploy once had to let a failing `npm test` through. One setImmediate here lets the replies in.
 * It is the real one, taken before any test runs: vi.useFakeTimers() replaces setImmediate too, and a fake
 * one would never fire.
 */
const realSetImmediate = globalThis.setImmediate;

afterEach(() => new Promise<void>((done) => realSetImmediate(() => done())));
