import type { PhaseTimeout } from "../commands/PhaseTimeout.js";
import type { RoundId } from "../typedefs.js";

/**
 * Infrastructure abstraction responsible for delivering time-based commands to the domain.
 *
 * Implementations may rely on in-memory timers, job queues, or external schedulers. They must
 * ensure that only one timeout per round phase is active at a time and that commands are executed
 * exactly once or in an idempotent manner.
 */
export interface Scheduler {
  scheduleTimeout(
    roundId: RoundId,
    phase: PhaseTimeout["phase"],
    delayMs: number,
  ): Promise<void>;
}
