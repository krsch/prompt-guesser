import { PhaseTimeout } from "../../domain/commands/PhaseTimeout.js";
import type { Scheduler } from "../../domain/ports/Scheduler.js";
import type { RoundId, TimePoint } from "../../domain/typedefs.js";

/**
 * Deterministic in-memory scheduler used exclusively in tests.
 *
 * Instead of relying on {@link setTimeout}, the scheduler records queued commands and exposes a
 * {@link runFor} helper that advances the virtual clock (in milliseconds). This makes it possible
 * for tests to control timer progression without depending on real time or fake timers.
 */
export class InMemoryScheduler implements Scheduler {
  #dispatch: (command: PhaseTimeout) => Promise<void> | void;
  #now: TimePoint = 0;
  #queue: PhaseTimeout[] = [];

  constructor(dispatch: (command: PhaseTimeout) => Promise<void> | void) {
    this.#dispatch = dispatch;
  }

  async scheduleTimeout(
    roundId: RoundId,
    phase: PhaseTimeout["phase"],
    delayMs: number,
  ): Promise<void> {
    if (delayMs < 0) {
      throw new Error("Timeout delay must be non-negative");
    }

    const fireAt = this.#now + delayMs;
    const command = new PhaseTimeout(roundId, phase, fireAt);
    this.#queue.push(command);
    this.#queue.sort((left, right) => left.at - right.at);
  }

  async runFor(milliseconds: number): Promise<void> {
    if (milliseconds < 0) {
      throw new Error("Cannot run scheduler backwards in time");
    }

    const targetTime = this.#now + milliseconds;

    while (this.#queue.length > 0) {
      const next = this.#queue[0]!;
      if (next.at > targetTime) {
        break;
      }

      this.#queue.shift();
      this.#now = next.at;
      await this.#dispatch(next);
    }

    this.#now = targetTime;
  }
}
