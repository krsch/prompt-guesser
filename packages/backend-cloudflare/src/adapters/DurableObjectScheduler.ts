import type { DurableObjectState } from "@cloudflare/workers-types";

import { PhaseTimeout } from "../core.js";
import type { GameId, Logger, RoundId, Scheduler } from "../core.js";

interface AlarmState {
  readonly roundId: RoundId;
  readonly phase: PhaseTimeout["phase"];
  readonly runAt: number;
  readonly gameId: GameId;
}

export class DurableObjectScheduler implements Scheduler {
  readonly #state: DurableObjectState;
  readonly #logger: Logger | undefined;
  readonly #runTimeout: (cmd: PhaseTimeout, gameId: GameId) => Promise<void>;

  constructor(options: {
    readonly state: DurableObjectState;
    readonly logger?: Logger;
    readonly runTimeout: (cmd: PhaseTimeout, gameId: GameId) => Promise<void>;
  }) {
    this.#state = options.state;
    this.#logger = options.logger;
    this.#runTimeout = options.runTimeout;
  }

  async scheduleTimeout(
    roundId: RoundId,
    phase: PhaseTimeout["phase"],
    delayMs: number,
    gameId: GameId,
  ): Promise<void> {
    if (delayMs < 0) {
      throw new Error("Timeout delay must be non-negative");
    }

    const runAt = Date.now() + delayMs;
    const alarmState: AlarmState = { roundId, phase, runAt, gameId };
    await this.#state.storage.put("alarm", alarmState);
    await this.#state.storage.setAlarm(runAt);
    this.#logger?.info?.("Scheduled Durable Object alarm", { roundId, phase, runAt });
  }

  async triggerAlarm(): Promise<void> {
    const alarmState = (await this.#state.storage.get("alarm")) as AlarmState | undefined;
    if (!alarmState) {
      this.#logger?.warn?.("Alarm fired with no scheduled state");
      return;
    }

    if (alarmState.runAt > Date.now()) {
      await this.#state.storage.setAlarm(alarmState.runAt);
      return;
    }

    await this.#state.storage.delete("alarm");
    try {
      await this.#runTimeout(
        new PhaseTimeout(alarmState.roundId, alarmState.phase),
        alarmState.gameId,
      );
    } catch (error) {
      this.#logger?.error?.("Failed to dispatch alarm", { error });
    }
  }
}
