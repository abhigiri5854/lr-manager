// Integration tests against the dev database. Each test makes its own company and users and
// removes them afterwards. Kept out of `pnpm test` so unit tests need no database.
// pnpm test:db skips *.slow.test.ts; pnpm test:db:slow runs everything.
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
