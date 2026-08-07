import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    // Generous per-test timeout: many suites spin up an in-memory MongoDB per
    // file, which can exceed the 5s default when files run in parallel.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // On loaded Windows boxes, spawning one mongodb-memory-server per file in
    // parallel can exceed the mongod teardown window ("didnt exit" SIGKILL).
    // Cap parallelism so the full suite shuts down cleanly.
    maxWorkers: 2,
    minWorkers: 1,
    coverage: {
      provider: 'v8',
      include: ['src/modules/ai/**'],
      reporter: ['text', 'lcov'],
    },
  },
});
