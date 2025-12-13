import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, defineProject } from "vitest/config";

const ROOT_DIR = dirname(fileURLToPath(import.meta.url));

const sharedResolve = {
  alias: {
    "@prompt-guesser/core": resolve(ROOT_DIR, "src"),
  },
};

export default defineConfig({
  resolve: sharedResolve,
  test: {
    globals: true,
    environment: "node",
    coverage: {
      enabled: true,
      reporter: ["text", "html", "lcov", "json", "json-summary"],
    },
    projects: [
      defineProject({
        resolve: sharedResolve,
        test: {
          include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
        },
      }),
      defineProject({
        resolve: sharedResolve,
        test: {
          include: ["packages/backend-local/tests/**/*.test.ts"],
        },
      }),
    ],
  },
});
