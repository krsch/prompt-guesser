import type { CommandContext } from "@prompt-guesser/core/domain/commands/Command.js";
import { PhaseTimeout } from "@prompt-guesser/core/domain/commands/PhaseTimeout.js";
import type { Logger } from "@prompt-guesser/core/domain/ports/Logger.js";
import type { Scheduler } from "@prompt-guesser/core/domain/ports/Scheduler.js";
import type { RoundId } from "@prompt-guesser/core/domain/typedefs.js";

import type { dispatchCommand } from "../dispatchCommand.js";

interface RealSchedulerOptions {
  readonly dispatch: typeof dispatchCommand;
  readonly contextFactory: () => Promise<CommandContext>;
  readonly logger?: Logger;
}

type TimeoutKey = string;

export class RealScheduler implements Scheduler {
  // eslint-disable-next-line functional/prefer-readonly-type
  #timers: ReadonlyMap<TimeoutKey, ReturnType<typeof setTimeout>> = new Map();
  readonly #dispatch: typeof dispatchCommand;
  readonly #contextFactory: RealSchedulerOptions["contextFactory"];
  readonly #logger: Logger | undefined;

  constructor(options: RealSchedulerOptions) {
    this.#dispatch = options.dispatch;
    this.#contextFactory = options.contextFactory;
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
    const timersWithoutKey = existing
      ? new Map(
          [...this.#timers.entries()].filter(([existingKey]) => existingKey !== key),
        )
      : this.#timers;
    if (existing) {
      clearTimeout(existing);
      this.#logger?.warn?.("Rescheduling timeout", { roundId, phase, delayMs });
    }

    const timer = setTimeout(async () => {
      const remainingTimers = new Map(
        [...this.#timers.entries()].filter(([existingKey]) => existingKey !== key),
      );
      // eslint-disable-next-line functional/immutable-data
      this.#timers = remainingTimers;
      try {
        const context = await this.#contextFactory();
        await this.#dispatch(new PhaseTimeout(roundId, phase, Date.now()), context);
      } catch (error) {
        this.#logger?.error?.("Failed to dispatch scheduled timeout", {
          roundId,
          phase,
          error,
        });
      }
    }, delayMs);

    const timers = new Map([...timersWithoutKey.entries(), [key, timer] as const]);
    // eslint-disable-next-line functional/immutable-data
    this.#timers = timers;
    this.#logger?.info?.("Timeout scheduled", { roundId, phase, delayMs });
  }

  #toKey(roundId: RoundId, phase: PhaseTimeout["phase"]): TimeoutKey {
    return `${roundId}:${phase}`;
  }
}
