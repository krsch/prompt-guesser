/* eslint-disable no-console */
import type { Logger } from "@prompt-guesser/core/domain/ports/Logger.js";

export function createConsoleLogger(namespace: string): Logger {
  const prefix = `[${namespace}]`;
  return {
    info(message: string, meta?: unknown): void {
      console.info(prefix, message, meta ?? "");
    },
    warn(message: string, meta?: unknown): void {
      console.warn(prefix, message, meta ?? "");
    },
    error(message: string, meta?: unknown): void {
      console.error(prefix, message, meta ?? "");
    },
    debug(message: string, meta?: unknown): void {
      if (process.env["DEBUG"]) {
        console.debug(prefix, message, meta ?? "");
      }
    },
  } satisfies Logger;
}
