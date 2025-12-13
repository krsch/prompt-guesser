import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, defineProject } from "vitest/config";

const ROOT_DIR = dirname(fileURLToPath(import.meta.url));

const shared = {
  resolve: {
    alias: {
      "@prompt-guesser/core": resolve(ROOT_DIR, "src"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    coverage: {
      enabled: true,
      reporter: ["text", "html", "lcov", "json", "json-summary"],
    },
  },
};

export default defineConfig({
  test: {
    projects: [
      defineProject({
        ...shared,
        test: {
          ...shared.test,
          include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
        },
      }),
      defineProject({
        ...shared,
        test: {
          ...shared.test,
          include: ["packages/backend-local/tests/**/*.test.ts"],
        },
      }),
    ],
  },
});
