// Integration tests against the dev database (pnpm test:db). Each test makes its own company and
// users and removes them afterwards. Kept out of `pnpm test` so unit tests need no database.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    include: ["db/tests/**/*.test.ts"],
    setupFiles: ["db/tests/setup.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // One file at a time keeps the number of pooler connections small.
    fileParallelism: false,
  },
});
