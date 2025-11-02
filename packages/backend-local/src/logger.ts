import type { Logger } from "@prompt-guesser/core/domain/ports/Logger.js";

export function createConsoleLogger(namespace: string): Logger {
  const prefix = `[${namespace}]`;
  return {
    info(message: string, meta?: unknown) {
      console.info(prefix, message, meta ?? "");
    },
    warn(message: string, meta?: unknown) {
      console.warn(prefix, message, meta ?? "");
    },
    error(message: string, meta?: unknown) {
      console.error(prefix, message, meta ?? "");
    },
    debug(message: string, meta?: unknown) {
      if (process.env["DEBUG"]) {
        console.debug(prefix, message, meta ?? "");
      }
    },
  } satisfies Logger;
}
