/* eslint-disable functional/immutable-data */
/* eslint-disable functional/prefer-readonly-type */
import type { Logger, RoundId, Scheduler } from "../core.js";
import { PhaseTimeout } from "../core.js";

interface RealSchedulerOptions {
  readonly runTimeout: (cmd: PhaseTimeout) => Promise<void>;
  readonly logger?: Logger;
}

type TimeoutKey = string;

export class RealScheduler implements Scheduler {
  #timers: Map<TimeoutKey, ReturnType<typeof setTimeout>> = new Map();
  readonly #runTimeout: RealSchedulerOptions["runTimeout"];
  readonly #logger: Logger | undefined;

  constructor(options: RealSchedulerOptions) {
    this.#runTimeout = options.runTimeout;
    this.#logger = options.logger;
  }

  async scheduleTimeout(
    roundId: RoundId,
    phase: PhaseTimeout["phase"],
    delayMs: number,
  ): Promise<void> {
    if (delayMs < 0) {
      throw new Error("Timeout delay must be non-negative");
    }

    const key = this.#toKey(roundId, phase);
    const existing = this.#timers.get(key);
    if (existing) {
      clearTimeout(existing);
      this.#timers.delete(key);
      this.#logger?.warn?.("Rescheduling timeout", { roundId, phase, delayMs });
    }

    const timer = setTimeout(async () => {
      this.#timers.delete(key);
      try {
        await this.#runTimeout(new PhaseTimeout(roundId, phase));
      } catch (error) {
        this.#logger?.error?.("Failed to dispatch scheduled timeout", {
          roundId,
          phase,
          error,
        });
      }
    }, delayMs);

    this.#timers.set(key, timer);
    this.#logger?.info?.("Timeout scheduled", { roundId, phase, delayMs });
  }

  #toKey(roundId: RoundId, phase: PhaseTimeout["phase"]): TimeoutKey {
    return `${roundId}:${phase}`;
  }
}
