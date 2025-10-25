/* eslint-disable functional/immutable-data */
/* eslint-disable functional/prefer-readonly-type */
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
interface SchedulerState {
  readonly now: TimePoint;
  readonly queue: readonly PhaseTimeout[];
}

export class InMemoryScheduler implements Scheduler {
  readonly #dispatch: (command: PhaseTimeout) => Promise<void> | void;
  #state: SchedulerState = { now: 0, queue: [] };

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

    const fireAt = this.#state.now + delayMs;
    const command = new PhaseTimeout(roundId, phase, fireAt);
    const insertAt = this.#state.queue.findIndex((existing) => existing.at > command.at);
    const queue =
      insertAt === -1
        ? [...this.#state.queue, command]
        : [
            ...this.#state.queue.slice(0, insertAt),
            command,
            ...this.#state.queue.slice(insertAt),
          ];

    this.#state = { ...this.#state, queue };
  }

  async runFor(milliseconds: number): Promise<void> {
    if (milliseconds < 0) {
      throw new Error("Cannot run scheduler backwards in time");
    }

    const targetTime = this.#state.now + milliseconds;
    let state = this.#state;

    while (state.queue.length > 0) {
      const [next, ...remaining] = state.queue;
      if (!next) {
        break;
      }
      if (next.at > targetTime) {
        break;
      }

      state = { now: next.at, queue: remaining };
      this.#state = state;
      await this.#dispatch(next);
      state = this.#state;
    }

    this.#state = { now: targetTime, queue: state.queue };
  }
}
