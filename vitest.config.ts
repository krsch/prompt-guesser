import { defineConfig } from "vitest/config";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@prompt-guesser/core": resolve(ROOT_DIR, "src"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: [
      "src/**/*.test.ts",
      "tests/**/*.test.ts",
      "packages/backend-local/tests/**/*.test.ts",
    ],
    coverage: {
      reporter: ["text", "html", "lcov"],
    },
  },
});
